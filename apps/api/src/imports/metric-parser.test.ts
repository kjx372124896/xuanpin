import test from "node:test";
import assert from "node:assert/strict";
import { parseCategoryName, parseMetric, parseWeekPeriod } from "./metric-parser";

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
});

test("类目按第一个斜杠拆成一级和二级，保留原始类目", () => {
  assert.deepEqual(parseCategoryName("餐饮具 / 咖啡杯"), { raw: "餐饮具 / 咖啡杯", level1: "餐饮具", level2: "咖啡杯" });
  assert.deepEqual(parseCategoryName(" 家居用品/收纳/旅行收纳 "), { raw: "家居用品/收纳/旅行收纳", level1: "家居用品", level2: "收纳/旅行收纳" });
  assert.deepEqual(parseCategoryName("厨房用品"), { raw: "厨房用品", level1: "厨房用品", level2: null });
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
