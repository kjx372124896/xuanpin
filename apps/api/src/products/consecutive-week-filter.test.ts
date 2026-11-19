import assert from "node:assert/strict";
import test from "node:test";
import { consecutiveWeekCountEndingAt, isConsecutiveWeekCountInRange } from "./consecutive-week-filter";

const anchor = "2026-11-23";

test("以11月23日为终点，只统计向前连续上榜周数", () => {
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-09", "2026-11-16", "2026-11-23"]), 3);
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-16", "2026-11-23"]), 2);
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]), 4);
});

test("选中周期本身必须有上榜记录，不能使用更早的历史记录补足", () => {
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-09", "2026-11-16"]), 0);
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-02", "2026-11-09", "2026-11-16"]), 0);
});

test("中间缺周时，只计算选中周期开始的连续段", () => {
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-10-26", "2026-11-09", "2026-11-16", "2026-11-23"]), 3);
  assert.equal(consecutiveWeekCountEndingAt(anchor, ["2026-11-02", "2026-11-16", "2026-11-23"]), 2);
});

test("连续周数区间包含最小值和最大值边界", () => {
  for (const count of [2, 3, 4]) assert.equal(isConsecutiveWeekCountInRange(count, 2, 4), true);
  assert.equal(isConsecutiveWeekCountInRange(1, 2, 4), false);
  assert.equal(isConsecutiveWeekCountInRange(5, 2, 4), false);
  assert.equal(isConsecutiveWeekCountInRange(0, 0, 4), false);
});
