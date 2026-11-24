import ExcelJS from "exceljs";
import {
  cellText,
  normalizeHeader,
  readWorkbookBuffer,
} from "./import-parser";
import { parseCategoryName, parseExportTime, parseMetric, parseWeekPeriod } from "./metric-parser";
import { assertWorkbookLimits } from "./workbook-limits";

export interface ParsedSearchImportRow {
  searchTerm: string;
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string;
  classificationName: string | null;
  searchTermType: string;
  boardType: string;
  dimension: "日";
  searchDate: Date;
  rank: number | null;
  searchPeople: ReturnType<typeof parseMetric>;
  clickRate: string | null;
  paymentConversionRate: string | null;
  exportTime: Date | null;
  sourceRowNumber: number;
}

export interface SearchImportParseResult {
  sheetName: string;
  rows: ParsedSearchImportRow[];
  rowCount: number;
  errors: Array<{ row: number; searchTerm?: string; message: string }>;
  periodStart: Date | null;
  periodEnd: Date | null;
  searchCategoryName: string | null;
  searchTermType: string | null;
  searchBoardType: string | null;
  dimension: string | null;
}

const REQUIRED_HEADERS = [
  "日期范围",
  "维度",
  "类目",
  "搜索词类型",
  "榜单类型",
  "搜索词",
  "搜索人数",
];

function findSearchWorksheet(workbook: ExcelJS.Workbook) {
  const candidates = workbook.worksheets.filter((sheet) => {
    const headers = new Set<string>();
    sheet.getRow(1).eachCell((cell) => headers.add(normalizeHeader(cellText(cell.value))));
    return REQUIRED_HEADERS.every((header) => headers.has(header));
  });
  const named = workbook.getWorksheet("搜索排行");
  if (named && candidates.includes(named)) return named;
  if (candidates.length > 1) {
    throw new Error("发现多个符合搜索榜单格式的工作表：" + candidates.map((sheet) => sheet.name).join("、") + "。请保留一个搜索排行工作表。");
  }
  return candidates[0];
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function parseSearchImportWorkbook(filePath: string): Promise<SearchImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await readWorkbookBuffer(filePath)) as any);
  assertWorkbookLimits(workbook);
  const worksheet = findSearchWorksheet(workbook);
  if (!worksheet) {
    throw new Error("没有找到有效的搜索榜单工作表，必须包含：" + REQUIRED_HEADERS.join("、") + "。");
  }

  const columns = new Map<string, number>();
  const counts = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, col) => {
    const header = normalizeHeader(cellText(cell.value));
    if (!header) return;
    counts.set(header, (counts.get(header) ?? 0) + 1);
    if (!columns.has(header)) columns.set(header, col);
  });

  const duplicateRequired = REQUIRED_HEADERS.filter((header) => (counts.get(header) ?? 0) > 1);
  if (duplicateRequired.length) {
    throw new Error("必要表头存在重复字段：" + duplicateRequired.join("、") + "。可选的重复字段会被忽略。");
  }
  const missing = REQUIRED_HEADERS.filter((header) => !columns.has(header));
  if (missing.length) throw new Error("缺少必要字段：" + missing.join("、"));

  const read = (row: ExcelJS.Row, header: string) => {
    const col = columns.get(header);
    return col ? row.getCell(col).value : undefined;
  };
  const rows: ParsedSearchImportRow[] = [];
  const errors: SearchImportParseResult["errors"] = [];
  let rowCount = 0;

  for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const searchTerm = cellText(read(row, "搜索词"));
    const periodRaw = cellText(read(row, "日期范围"));
    const categoryName = cellText(read(row, "类目"));
    const category = parseCategoryName(categoryName);
    const termType = cellText(read(row, "搜索词类型"));
    const boardType = cellText(read(row, "榜单类型"));
    const dimensionRaw = cellText(read(row, "维度"));
    const searchPeopleRaw = cellText(read(row, "搜索人数"));
    if (![searchTerm, periodRaw, categoryName, termType, boardType, dimensionRaw, searchPeopleRaw].some(Boolean)) continue;
    rowCount += 1;

    const problems: string[] = [];
    const period = parseWeekPeriod(periodRaw);
    if (!searchTerm) problems.push("搜索词为空");
    if (!period) problems.push("日期范围格式错误：" + (periodRaw || "空值"));
    else if (dateKey(period.start) !== dateKey(period.end)) problems.push("日维度数据的日期范围必须是同一天");
    if (dimensionRaw !== "日") problems.push("暂不支持「" + (dimensionRaw || "空") + "」维度，仅支持日维度");
    if (!category) problems.push("类目为空或一级类目无法识别");
    if (!termType) problems.push("搜索词类型为空");
    if (!boardType) problems.push("榜单类型为空");

    const searchPeople = parseMetric(searchPeopleRaw);
    if (!searchPeople.valid) problems.push("搜索人数无法解析：" + (searchPeople.raw ?? "空值"));

    const rankRaw = cellText(read(row, "排名"));
    const rankNumber = rankRaw ? Number(rankRaw.replace(/,/g, "")) : null;
    if (rankRaw && (!Number.isInteger(rankNumber) || (rankNumber ?? 0) < 1)) {
      problems.push("排名格式错误：" + rankRaw);
    }

    if (problems.length || !period) {
      errors.push({ row: rowNo, ...(searchTerm ? { searchTerm } : {}), message: problems.join("；") });
      continue;
    }

    rows.push({
      searchTerm,
      categoryName: category!.raw,
      categoryLevel1: category!.level1,
      categoryLevel2: category!.level2,
      classificationName: cellText(read(row, "分类名称")) || null,
      searchTermType: termType,
      boardType,
      dimension: "日",
      searchDate: period.start,
      rank: rankNumber,
      searchPeople,
      clickRate: cellText(read(row, "点击率")) || null,
      paymentConversionRate: cellText(read(row, "支付转化率")) || null,
      exportTime: parseExportTime(read(row, "导出时间")),
      sourceRowNumber: rowNo,
    });
  }

  const dates = rows.map((row) => row.searchDate).sort((a, b) => a.getTime() - b.getTime());
  const uniqueValues = (values: string[]) => [...new Set(values.filter(Boolean))];
  const categories = uniqueValues(rows.map((row) => row.categoryName));
  const termTypes = uniqueValues(rows.map((row) => row.searchTermType));
  const boardTypes = uniqueValues(rows.map((row) => row.boardType));
  const dimensions = uniqueValues(rows.map((row) => row.dimension));

  return {
    sheetName: worksheet.name,
    rows,
    rowCount,
    errors,
    periodStart: dates[0] ?? null,
    periodEnd: dates.at(-1) ?? null,
    searchCategoryName: categories.length ? categories.join("；") : null,
    searchTermType: termTypes.length === 1 ? termTypes[0] : termTypes.join("；") || null,
    searchBoardType: boardTypes.length === 1 ? boardTypes[0] : boardTypes.join("；") || null,
    dimension: dimensions.length === 1 ? dimensions[0] : dimensions.join("；") || null,
  };
}
