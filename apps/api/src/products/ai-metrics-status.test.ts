import assert from "node:assert/strict";
import { test } from "node:test";
import { aiMetricsStatusWhere } from "./ai-metrics-status";

test("未获取状态只匹配没有采集完成标记的商品", () => {
  assert.deepEqual(aiMetricsStatusWhere("NOT_FETCHED"), { aiMetricsFetchedAt: null });
});

test("已获取状态按采集完成标记过滤，不依赖单个指标是否为空", () => {
  assert.deepEqual(aiMetricsStatusWhere("FETCHED"), { aiMetricsFetchedAt: { not: null } });
});

test("未选择状态时不添加过滤条件", () => {
  assert.deepEqual(aiMetricsStatusWhere(undefined), {});
});
