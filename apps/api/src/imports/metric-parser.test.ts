import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCategoryName, parseMetric, parseWeekPeriod } from "./metric-parser";
import { detectBoardType, normalizeHeader, parseImportWorkbook } from "./import-parser";

test("根据专属表头自动识别两种榜单，并严格区分关键词字段", () => {
  assert.equal(detectBoardType(["商品ID", "加购人数", "关键词"]), "NEW_PRODUCT_TRAFFIC");
  assert.equal(detectBoardType(["商品ID", "商品关键词", "关键词"]), "TRANSACTION_GROWTH");
  assert.equal(normalizeHeader(" 商品关键词\r\n"), "商品关键词");
  assert.throws(() => detectBoardType(["加购人数", "商品关键词"]), /同时包含/);
  assert.throws(() => detectBoardType(["商品ID", "关键词"]), /未找到/);
});

async function parseWorkbook(headers: string[], specialValue: string) {
  const directory = await mkdtemp(join(tmpdir(), "selection-board-parser-"));
  const filePath = join(directory, "sample.xlsx");
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("合并数据");
    sheet.addRow(headers);
    const values: ExcelJS.CellValue[] = [
      "市场", "商品排行", "商品", "周", "2026-11-02 至 2026-11-08", "厨房用品",
      "2026-11-09 12:00:00", 1, "上升", "厨房用品/厨房置物架", "测试商品",
      "1070000000000", "https://item.taobao.com/item.htm?id=1070000000000", "测试店铺",
      "天猫", "100~200", "10~20", specialValue, "https://img.example.com/item.jpg",
    ];
    sheet.addRow(values);
    await workbook.xlsx.writeFile(filePath);
    return await parseImportWorkbook(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("新品流量文件解析后保存加购人数，商品关键词保持为空", async () => {
  const base = ["栏目", "菜单", "数据点", "维度", "日期范围", "关键词", "导出时间", "行业排名", "趋势", "类目名称", "商品名称", "商品ID", "商品链接", "店铺名称", "店铺类型", "访客数", "支付买家数", "商品图片链接"];
  const headers = [...base.slice(0, 17), "加购人数", base[17]];
  const result = await parseWorkbook(headers, "8");
  assert.equal(result.boardType, "NEW_PRODUCT_TRAFFIC");
  assert.equal(result.rows[0].cart.raw, "8");
  assert.equal(result.rows[0].productKeyword, null);
});

test("交易增速文件解析后保存商品关键词，加购人数保持为空", async () => {
  const base = ["栏目", "菜单", "数据点", "维度", "日期范围", "关键词", "导出时间", "行业排名", "趋势", "类目名称", "商品名称", "商品ID", "商品链接", "店铺名称", "店铺类型", "访客数", "支付买家数", "商品图片链接"];
  const headers = [...base.slice(0, 17), "商品关键词", base[17]];
  const result = await parseWorkbook(headers, "调料架 厨房收纳");
  assert.equal(result.boardType, "TRANSACTION_GROWTH");
  assert.equal(result.rows[0].cart.raw, null);
  assert.equal(result.rows[0].productKeyword, "调料架 厨房收纳");
});

test("解析精确值与常见区间", () => {
  assert.deepEqual(parseMetric("0").min, 0);
  assert.equal(parseMetric("6").max, 6);
  assert.equal(parseMetric("10 ~ 50").median, 30);
  assert.equal(parseMetric("1万 ~ 2.5万").min, 10000);
  assert.equal(parseMetric("1万 ~ 2.5万").max, 25000);
  assert.equal(parseMetric("2,500～5,000").median, 3750);
  assert.equal(parseMetric("2500-5000").median, 3750);
});

test("异常区间不伪装成零", () => {
  assert.equal(parseMetric("无法识别").valid, false);
  assert.equal(parseMetric("50 ~ 10").valid, false);
  assert.equal(parseMetric("").min, null);
  assert.equal(parseMetric("").median, null);
  assert.deepEqual(parseMetric("{}"), { raw: null, min: null, max: null, median: null, valid: true });
});

test("类目按第一个斜杠拆成一级和二级，保留原始类目", () => {
  assert.deepEqual(parseCategoryName("餐饮具 / 咖啡杯"), { raw: "餐饮具 / 咖啡杯", level1: "餐饮具", level2: "咖啡杯" });
  assert.deepEqual(parseCategoryName(" 家居用品/收纳/旅行收纳 "), { raw: "家居用品/收纳/旅行收纳", level1: "家居用品", level2: "收纳/旅行收纳" });
  assert.deepEqual(parseCategoryName("厨房用品"), { raw: "厨房用品", level1: "厨房用品", level2: "无二级类目" });
  assert.deepEqual(parseCategoryName("餐饮具 / "), { raw: "餐饮具 /", level1: "餐饮具", level2: "无二级类目" });
  assert.equal(parseCategoryName(" / 咖啡杯"), null);
});

test("解析周周期", () => {
  const period = parseWeekPeriod("2026-08-31|2026-09-06");
  assert.equal(period?.start.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(period?.end.toISOString(), "2026-09-06T00:00:00.000Z");
  assert.equal(parseWeekPeriod("2026/08/31 - 2026/09/06")?.start.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(parseWeekPeriod("2026-08-31 ~ 2026-09-06")?.end.toISOString(), "2026-09-06T00:00:00.000Z");
  assert.equal(parseWeekPeriod("2026-02-31|2026-03-06"), null);
  assert.equal(parseWeekPeriod("2026-09-06|2026-08-31"), null);
});
