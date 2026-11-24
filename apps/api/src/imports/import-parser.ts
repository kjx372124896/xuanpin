import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, zipSync } from "fflate";
import { parseCategoryName, parseExportTime, parseMetric, parseWeekPeriod } from "./metric-parser";
import { assertWorkbookLimits, readBoundedArchive } from "./workbook-limits";

export type ImportBoardType = "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH";

export interface ParsedImportRow {
  boardType: ImportBoardType;
  productId: string;
  productName: string;
  productUrl: string | null;
  shopName: string | null;
  shopType: string | null;
  imageUrl: string | null;
  weekStart: Date;
  weekEnd: Date;
  rawPeriod: string;
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string;
  rank: number | null;
  trend: string | null;
  visitor: ReturnType<typeof parseMetric>;
  buyer: ReturnType<typeof parseMetric>;
  cart: ReturnType<typeof parseMetric>;
  productKeyword: string | null;
  exportTime: Date | null;
  sourceName: string | null;
  sourceRowNumber: number;
}

export interface ImportParseResult {
  boardType: ImportBoardType;
  sheetName: string;
  rows: ParsedImportRow[];
  rowCount: number;
  errors: Array<{ row: number; productId?: string; message: string }>;
  weekStart: Date | null;
  weekEnd: Date | null;
  categoryName: string | null;
  sourceNames: string[];
}

export async function readWorkbookBuffer(filePath: string) {
  const original = await readFile(filePath);
  const archive = readBoundedArchive(original);
  for (const name of Object.keys(archive)) {
    if (!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) continue;
    const xml = strFromU8(archive[name]);
    const normalized = xml.replace(/Target="\/xl\/tables\//g, 'Target="../tables/');
    if (normalized !== xml) archive[name] = strToU8(normalized);
  }
  return Buffer.from(zipSync(archive, { level: 1 }));
}

export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink;
  }
  return String(value).trim();
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s\u00A0]+/g, "")
    .trim();
}

export function detectBoardType(headers: Iterable<string>): ImportBoardType {
  const normalized = new Set([...headers].map(normalizeHeader));
  const hasCart = normalized.has("加购人数");
  const hasProductKeyword = normalized.has("商品关键词");
  if (hasCart === hasProductKeyword) {
    throw new Error(hasCart
      ? "无法识别榜单类型：表头同时包含「加购人数」和「商品关键词」，请检查文件。"
      : "无法识别榜单类型：未找到「加购人数」或「商品关键词」字段，请确认上传的是新品流量或交易增速榜单。由此不能仅凭共有字段判断榜单类型。");
  }
  return hasCart ? "NEW_PRODUCT_TRAFFIC" : "TRANSACTION_GROWTH";
}

function findWorksheet(workbook: ExcelJS.Workbook) {
  const candidates = workbook.worksheets.filter((sheet) => {
    const headers = new Set<string>();
    sheet.getRow(1).eachCell((cell) => headers.add(normalizeHeader(cellText(cell.value))));
    return headers.has("商品ID") && headers.has("日期范围") && headers.has("类目名称");
  });
  const combined = workbook.getWorksheet("合并数据");
  if (combined && candidates.includes(combined)) return combined;
  return candidates.find((sheet) => sheet.name === "市场排行-商品-新品流量") ?? candidates[0];
}

export async function parseImportWorkbook(filePath: string): Promise<ImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await readWorkbookBuffer(filePath)) as any);
  assertWorkbookLimits(workbook);
  const worksheet = findWorksheet(workbook);
  if (!worksheet) throw new Error("没有找到有效的商品榜单工作表。");

  const columns = new Map<string, number>();
  const duplicateHeaders = new Set<string>();
  worksheet.getRow(1).eachCell((cell, col) => {
    const header = normalizeHeader(cellText(cell.value));
    if (!header) return;
    if (columns.has(header)) duplicateHeaders.add(header);
    columns.set(header, col);
  });
  if (duplicateHeaders.size) throw new Error(`表头存在重复字段：${[...duplicateHeaders].join("、")}`);
  const boardType = detectBoardType(columns.keys());
  const required = ["日期范围", "类目名称", "商品名称", "商品ID", "访客数", "支付买家数"];
  const missing = required.filter((header) => !columns.has(header));
  if (missing.length) throw new Error(`缺少必要字段：${missing.join("、")}`);

  const read = (row: ExcelJS.Row, header: string) => {
    const col = columns.get(header);
    return col ? row.getCell(col).value : undefined;
  };
  const rows: ParsedImportRow[] = [];
  const errors: ImportParseResult["errors"] = [];
  let rowCount = 0;
  const sourceNames = new Set<string>();

  for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const productId = cellText(read(row, "商品ID"));
    const productName = cellText(read(row, "商品名称"));
    if (!productId && !productName) continue;
    rowCount += 1;

    const period = parseWeekPeriod(cellText(read(row, "日期范围")));
    const category = parseCategoryName(cellText(read(row, "类目名称")));
    const categoryName = category?.raw ?? "";
    const visitor = parseMetric(cellText(read(row, "访客数")));
    const buyer = parseMetric(cellText(read(row, "支付买家数")));
    const cartRaw = boardType === "NEW_PRODUCT_TRAFFIC" ? cellText(read(row, "加购人数")) : "";
    const cart = boardType === "NEW_PRODUCT_TRAFFIC" && cartRaw
      ? parseMetric(cartRaw)
      : { raw: null, min: null, max: null, median: null, valid: true };
    const productKeyword = boardType === "TRANSACTION_GROWTH"
      ? cellText(read(row, "商品关键词")) || null
      : null;
    const problems: string[] = [];
    if (!productId) problems.push("商品ID为空");
    if (!productName) problems.push("商品名称为空");
    if (!period) problems.push("日期范围格式错误");
    if (!category) problems.push("类目名称为空或一级类目无法识别");
    if (!visitor.valid) problems.push(`访客数无法解析：${visitor.raw ?? "空值"}`);
    if (!buyer.valid) problems.push(`支付买家数无法解析：${buyer.raw ?? "空值"}`);
    if (boardType === "NEW_PRODUCT_TRAFFIC" && !cart.valid) problems.push(`加购人数无法解析：${cart.raw ?? "空值"}`);
    if (problems.length || !period) {
      errors.push({ row: rowNo, ...(productId ? { productId } : {}), message: problems.join("；") });
      continue;
    }

    const sourceName = cellText(read(row, "来源文件")) || null;
    if (sourceName) sourceNames.add(sourceName);
    const rankText = cellText(read(row, "行业排名"));
    const rankNumber = Number(rankText);
    rows.push({
      boardType, productId, productName, productUrl: cellText(read(row, "商品链接")) || null,
      shopName: cellText(read(row, "店铺名称")) || null, shopType: cellText(read(row, "店铺类型")) || null,
      imageUrl: cellText(read(row, "商品图片链接")) || null,
      weekStart: period.start, weekEnd: period.end, rawPeriod: period.raw, categoryName,
      categoryLevel1: category!.level1, categoryLevel2: category!.level2,
      rank: rankText && Number.isFinite(rankNumber) ? rankNumber : null,
      trend: cellText(read(row, "趋势")) || null,
      visitor, buyer, cart, productKeyword, exportTime: parseExportTime(read(row, "导出时间")),
      sourceName, sourceRowNumber: rowNo,
    });
  }

  return {
    boardType, sheetName: worksheet.name, rows, rowCount, errors,
    weekStart: rows.length ? rows.reduce((a, b) => a.weekStart < b.weekStart ? a : b).weekStart : null,
    weekEnd: rows.length ? rows.reduce((a, b) => a.weekEnd > b.weekEnd ? a : b).weekEnd : null,
    categoryName: [...new Set(rows.map((row) => row.categoryName))].join("；") || null,
    sourceNames: [...sourceNames],
  };
}
