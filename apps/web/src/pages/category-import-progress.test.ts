import assert from "node:assert/strict";
import test from "node:test";
import {
  childImportBranches, getLevelImportProgress, grandchildImportBranches, hasIncompleteImport,
  parentImportBranches, type ImportWeekCount,
} from "./category-import-progress";

const periods = Array.from({ length: 12 }, (_, index) => ({
  weekStart: new Date(Date.UTC(2026, 7, 31 + index * 7)).toISOString().slice(0, 10),
}));
const weeks = (count: number): ImportWeekCount[] => periods.map((period) => ({ ...period, count }));

test("一级直接导入完成不受实际二级和三级缺失影响，无层级占位项不计为下级类目", () => {
  const parent = {
    weekCounts: weeks(10),
    children: [
      { categoryLevel2: "无二级类目", weekCounts: weeks(10), grandchildren: [] },
      { categoryLevel2: "杯子", weekCounts: weeks(0), grandchildren: [
        { categoryLevel3: "无三级类目", weekCounts: weeks(0) },
        { categoryLevel3: "水杯", weekCounts: weeks(0) },
      ] },
    ],
  };
  const result = getLevelImportProgress(parentImportBranches(parent), periods, false);
  assert.equal(result[1]?.complete, true);
  assert.equal(result[2]?.complete, false);
  assert.equal(result[3]?.complete, false);
  assert.equal(result[2]?.total, 1);
  assert.equal(result[3]?.total, 1);
  assert.equal(hasIncompleteImport(result), true);

  const onlyParent = getLevelImportProgress(parentImportBranches({ ...parent, children: [parent.children[0]] }), periods, false);
  assert.equal(onlyParent[1]?.complete, true);
  assert.equal(onlyParent[2], null);
  assert.equal(onlyParent[3], null);
  assert.equal(hasIncompleteImport(onlyParent), false);
});

test("实际三级数据不能代替二级直接导入，实际二级数据也不能代替一级导入", () => {
  const child = { categoryLevel2: "杯子", weekCounts: weeks(0), grandchildren: [
    { categoryLevel3: "水杯", weekCounts: weeks(8) },
    { categoryLevel3: "无三级类目", weekCounts: weeks(0) },
  ] };
  const result = getLevelImportProgress(parentImportBranches({ weekCounts: weeks(0), children: [child] }), periods, false);
  assert.equal(result[1]?.complete, false);
  assert.equal(result[2]?.complete, false);
  assert.equal(result[3]?.complete, true);
  const childResult = getLevelImportProgress(childImportBranches(child), periods, false);
  assert.equal(childResult[1], null);
  assert.equal(childResult[2]?.complete, false);
  assert.equal(childResult[3]?.complete, true);

  child.weekCounts = weeks(4);
  const secondImported = getLevelImportProgress(parentImportBranches({ weekCounts: weeks(0), children: [child] }), periods, false);
  assert.equal(secondImported[1]?.complete, false);
  assert.equal(secondImported[2]?.complete, true);
});

test("同层级所有类目都完整才完成，汇总统计保持每个类目的完成数", () => {
  const result = getLevelImportProgress({ 2: [weeks(1), weeks(0)] }, periods, false);
  assert.equal(result[2]?.complete, false);
  assert.equal(result[2]?.total, 2);
  assert.equal(result[2]?.imported, 1);
  assert.equal(result[2]?.completedWeeks, 0);
});

test("占位行的导入数据归属于原始导入层级", () => {
  assert.deepEqual(Object.keys(childImportBranches({ categoryLevel2: "无二级类目", weekCounts: weeks(1), grandchildren: [] })), ["1"]);
  assert.deepEqual(Object.keys(grandchildImportBranches({ categoryLevel2: "杯子", categoryLevel3: "无三级类目", weekCounts: weeks(1) })), ["2"]);
  assert.deepEqual(Object.keys(grandchildImportBranches({ categoryLevel2: "杯子", categoryLevel3: "水杯", weekCounts: weeks(1) })), ["3"]);
});

test("搜索词仍要求每个类目每周7天覆盖，不合并不同类目的天数", () => {
  const full = weeks(100).map((week) => ({ ...week, daysWithData: 7 }));
  const partial = full.map((week) => ({ ...week, daysWithData: 3 }));
  const result = getLevelImportProgress({ 1: [full], 2: [partial, full] }, periods, true);
  assert.equal(result[1]?.complete, true);
  assert.equal(result[2]?.complete, false);
  assert.equal(result[2]?.imported, 1);
  assert.equal(result[2]?.total, 2);
});

test("缺周、重复周及统计范围以外的数据不能填补12周导入进度", () => {
  const missing = weeks(1).slice(1);
  const result = getLevelImportProgress({ 1: [[...missing, missing[0], { weekStart: "2020-01-01", count: 9 }]] }, periods, false);
  assert.equal(result[1]?.complete, false);
  assert.equal(result[1]?.completedWeeks, 11);
  assert.equal(getLevelImportProgress({ 1: [weeks(1)] }, [], false)[1]?.complete, false);
});
