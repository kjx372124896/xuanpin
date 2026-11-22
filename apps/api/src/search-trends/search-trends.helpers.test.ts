import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchTrendComparisonPeriods, calculateSearchTrendGrowthRate } from "./search-trends.helpers";

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

test("上月同期：10月1日至31日映射为9月1日至30日", () => {
  const periods = buildSearchTrendComparisonPeriods(
    new Date("2026-10-01T00:00:00.000Z"),
    new Date("2026-10-31T00:00:00.000Z"),
    "previousMonth",
  );
  assert.equal(dateKey(periods.previousStartDate), "2026-09-01");
  assert.equal(dateKey(periods.previousEndDate), "2026-09-30");
  assert.equal(dateKey(periods.currentStartDate), "2026-10-01");
  assert.equal(dateKey(periods.currentEndDate), "2026-10-31");
});

test("上月同期：月末日期按目标月份最后一天截断", () => {
  const periods = buildSearchTrendComparisonPeriods(
    new Date("2026-03-30T00:00:00.000Z"),
    new Date("2026-03-31T00:00:00.000Z"),
    "previousMonth",
  );
  assert.equal(dateKey(periods.previousStartDate), "2026-02-28");
  assert.equal(dateKey(periods.previousEndDate), "2026-02-28");
});

test("上月同期：跨年时正确映射年份", () => {
  const periods = buildSearchTrendComparisonPeriods(
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-31T00:00:00.000Z"),
    "previousMonth",
  );
  assert.equal(dateKey(periods.previousStartDate), "2025-12-01");
  assert.equal(dateKey(periods.previousEndDate), "2025-12-31");
});

test("去年同期：按相同月日映射", () => {
  const periods = buildSearchTrendComparisonPeriods(
    new Date("2026-10-01T00:00:00.000Z"),
    new Date("2026-10-31T00:00:00.000Z"),
    "previousYear",
  );
  assert.equal(dateKey(periods.previousStartDate), "2025-10-01");
  assert.equal(dateKey(periods.previousEndDate), "2025-10-31");
});

test("去年同期：闰日映射到上一年2月最后一天", () => {
  const periods = buildSearchTrendComparisonPeriods(
    new Date("2024-02-29T00:00:00.000Z"),
    new Date("2024-02-29T00:00:00.000Z"),
    "previousYear",
  );
  assert.equal(dateKey(periods.previousStartDate), "2023-02-28");
  assert.equal(dateKey(periods.previousEndDate), "2023-02-28");
});

test("25天有效记录与30天有效记录按日均比较", () => {
  const previousDailyAverage = 250_000 / 25;
  const currentDailyAverage = 450_000 / 30;
  assert.equal(previousDailyAverage, 10_000);
  assert.equal(currentDailyAverage, 15_000);
  assert.equal(calculateSearchTrendGrowthRate(previousDailyAverage, currentDailyAverage), 50);
});

test("上期无效或为0时增长率为空，当前为0时增长率为-100%", () => {
  assert.equal(calculateSearchTrendGrowthRate(null, 10), null);
  assert.equal(calculateSearchTrendGrowthRate(0, 10), null);
  assert.equal(calculateSearchTrendGrowthRate(10, null), null);
  assert.equal(calculateSearchTrendGrowthRate(10, 0), -100);
});
