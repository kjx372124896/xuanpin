import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSearchImportWorkbook } from "./search-import-parser";

const headers = [
  "栏目", "菜单", "数据点", "维度", "日期范围", "类目", "搜索词类型", "榜单类型",
  "导出时间", "排名", "分类名称", "搜索词", "预估搜索人气", "搜索人数",
  "预估搜索人气", "点击率", "预估点击人数", "支付转化率", "预估支付转化率",
];

async function parseRows(rows: ExcelJS.CellValue[][], columns = headers) {
  const directory = await mkdtemp(join(tmpdir(), "selection-search-parser-"));
  const filePath = join(directory, "search.xlsx");
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("搜索排行");
    sheet.addRow(columns);
    rows.forEach((row) => sheet.addRow(row));
    await workbook.xlsx.writeFile(filePath);
    return await parseSearchImportWorkbook(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sampleRow(overrides: Record<string, ExcelJS.CellValue> = {}): ExcelJS.CellValue[] {
  const row: Record<string, ExcelJS.CellValue> = {
    栏目: "市场",
    菜单: "搜索排行",
    数据点: "搜索排行",
    维度: "日",
    日期范围: "2026-11-01|2026-11-01",
    类目: "居家日用",
    搜索词类型: "核心词",
    榜单类型: "搜索人气",
    导出时间: "2026-11-22 16:48:46",
    排名: 1,
    分类名称: "居家日用",
    搜索词: "手套",
    预估搜索人气: null,
    搜索人数: "12万 ~ 20万",
    点击率: "80.00%",
    预估点击人数: null,
    支付转化率: "30% ~ 35%",
    预估支付转化率: null,
    ...overrides,
  };
  return columnsToValues(row);
}

function columnsToValues(row: Record<string, ExcelJS.CellValue>) {
  return headers.map((header) => row[header] ?? null);
}

test("搜索排行按表头解析日数据，允许重复的可选表头", async () => {
  const result = await parseRows([sampleRow()]);
  assert.equal(result.sheetName, "搜索排行");
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.periodStart?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(result.periodEnd?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(result.searchCategoryName, "居家日用");
  assert.equal(result.searchTermType, "核心词");
  assert.equal(result.searchBoardType, "搜索人气");
  assert.equal(result.dimension, "日");
  assert.equal(result.rows[0].searchTerm, "手套");
  assert.equal(result.rows[0].rank, 1);
  assert.deepEqual(result.rows[0].searchPeople, {
    raw: "12万 ~ 20万",
    min: 120000,
    max: 200000,
    median: 160000,
    valid: true,
  });
  assert.equal(result.rows[0].clickRate, "80.00%");
  assert.equal(result.rows[0].paymentConversionRate, "30% ~ 35%");
});

test("列顺序变化时仍按表头匹配字段", async () => {
  const originalValues = sampleRow();
  const valueByHeader = new Map<string, ExcelJS.CellValue>();
  headers.forEach((header, index) => {
    if (!valueByHeader.has(header)) valueByHeader.set(header, originalValues[index] ?? null);
  });
  const reorderedHeaders = [...headers].reverse();
  const reorderedValues = reorderedHeaders.map((header) => valueByHeader.get(header) ?? null);
  const result = await parseRows([reorderedValues], reorderedHeaders);
  assert.equal(result.rows[0].searchTerm, "手套");
  assert.equal(result.rows[0].searchPeople.median, 160000);
  assert.equal(result.rows[0].searchDate.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("必要表头重复时拒绝解析，非必要重复表头不影响导入", async () => {
  const duplicateRequired = [...headers, "搜索词"];
  await assert.rejects(() => parseRows([sampleRow()], duplicateRequired), /必要表头存在重复字段：搜索词/);
});

test("只接受日维度且每行日期范围必须是单日", async () => {
  const result = await parseRows([
    sampleRow({ 维度: "周" }),
    sampleRow({ 搜索词: "雨伞", 日期范围: "2026-11-01|2026-11-07" }),
  ]);
  assert.equal(result.rowCount, 2);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /仅支持日维度/);
  assert.match(result.errors[1].message, /必须是同一天/);
});

test("搜索人数区间异常记录进入错误明细，不会写成零", async () => {
  const result = await parseRows([sampleRow({ 搜索人数: "无法识别" })]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /搜索人数无法解析/);
});
