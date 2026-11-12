import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseCategoryName, parseExportTime, parseMetric, parseWeekPeriod } from "./metric-parser";

export interface ParsedImportRow {
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
  categoryLevel2: string | null;
  rank: number | null;
  trend: string | null;
  visitor: ReturnType<typeof parseMetric>;
  buyer: ReturnType<typeof parseMetric>;
  cart: ReturnType<typeof parseMetric>;
  exportTime: Date | null;
  sourceName: string | null;
  sourceRowNumber: number;
}

export interface ImportParseResult {
  sheetName: string;
  rows: ParsedImportRow[];
  rowCount: number;
  errors: Array<{ row: number; productId?: string; message: string }>;
  weekStart: Date | null;
  weekEnd: Date | null;
  categoryName: string | null;
  sourceNames: string[];
}

async function readWorkbookBuffer(filePath: string) {
  const original = await readFile(filePath);
  const archive = unzipSync(original);
  for (const name of Object.keys(archive)) {
    if (!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) continue;
    const xml = strFromU8(archive[name]);
    const normalized = xml.replace(/Target="\/xl\/tables\//g, 'Target="../tables/');
    if (normalized !== xml) archive[name] = strToU8(normalized);
  }
  return Buffer.from(zipSync(archive, { level: 1 }));
}

function cellText(value: ExcelJS.CellValue | undefined): string {
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

function findWorksheet(workbook: ExcelJS.Workbook) {
  const combined = workbook.getWorksheet("合并数据");
  if (combined) return combined;
  const raw = workbook.getWorksheet("市场排行-商品-新品流量");
  if (raw) return raw;
  return workbook.worksheets.find((sheet) => {
    const headers = new Set<string>();
    sheet.getRow(1).eachCell((cell) => headers.add(cellText(cell.value)));
    return headers.has("商品ID") && headers.has("日期范围") && headers.has("类目名称");
  });
}

export async function parseImportWorkbook(filePath: string): Promise<ImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await readWorkbookBuffer(filePath)) as any);
  const worksheet = findWorksheet(workbook);
  if (!worksheet) throw new Error("没有找到有效的商品榜单工作表。");

  const columns = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, col) => columns.set(cellText(cell.value), col));
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
    const cartRaw = columns.has("加购人数") ? cellText(read(row, "加购人数")) : "";
    const cart = cartRaw ? parseMetric(cartRaw) : { raw: null, min: null, max: null, median: null, valid: true };
    const problems: string[] = [];
    if (!productId) problems.push("商品ID为空");
    if (!productName) problems.push("商品名称为空");
    if (!period) problems.push("日期范围格式错误");
    if (!category) problems.push("类目名称为空或一级类目无法识别");
    if (!visitor.valid) problems.push(`访客数无法解析：${visitor.raw ?? "空值"}`);
    if (!buyer.valid) problems.push(`支付买家数无法解析：${buyer.raw ?? "空值"}`);
    if (!cart.valid) problems.push(`加购人数无法解析：${cart.raw ?? "空值"}`);
    if (problems.length || !period) {
      errors.push({ row: rowNo, ...(productId ? { productId } : {}), message: problems.join("；") });
      continue;
    }

    const sourceName = cellText(read(row, "来源文件")) || null;
    if (sourceName) sourceNames.add(sourceName);
    const rankText = cellText(read(row, "行业排名"));
    const rankNumber = Number(rankText);
    rows.push({
      productId, productName, productUrl: cellText(read(row, "商品链接")) || null,
      shopName: cellText(read(row, "店铺名称")) || null, shopType: cellText(read(row, "店铺类型")) || null,
      imageUrl: cellText(read(row, "商品图片链接")) || null,
      weekStart: period.start, weekEnd: period.end, rawPeriod: period.raw, categoryName,
      categoryLevel1: category!.level1, categoryLevel2: category!.level2,
      rank: rankText && Number.isFinite(rankNumber) ? rankNumber : null,
      trend: cellText(read(row, "趋势")) || null,
      visitor, buyer, cart, exportTime: parseExportTime(read(row, "导出时间")),
      sourceName, sourceRowNumber: rowNo,
    });
  }

  return {
    sheetName: worksheet.name, rows, rowCount, errors,
    weekStart: rows.length ? rows.reduce((a, b) => a.weekStart < b.weekStart ? a : b).weekStart : null,
    weekEnd: rows.length ? rows.reduce((a, b) => a.weekEnd > b.weekEnd ? a : b).weekEnd : null,
    categoryName: [...new Set(rows.map((row) => row.categoryName))].join("；") || null,
    sourceNames: [...sourceNames],
  };
}
