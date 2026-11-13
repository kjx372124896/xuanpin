import assert from "node:assert/strict";
import test from "node:test";
import { parseAiMetricsMarkdown } from "./ai-metrics-parser";

const header = "| **品ID** | **上期销售额** | **销售额** | **点击率** | **转化率** | **加购率** | **加购成本** | **投产比** | **件单价** | **花费** | **CPC** |";
const separator = "| :------ | :-------- | :------ | :------ | :------ | :------ | :------- | :------ | :------ | :----- | :------ |";

test("解析11列表格，区间值按原始文本保留", () => {
  const markdown = [header, separator, "| 1072161563583 | 5万-6万 | 6万-7万 | 2.1%-2.8% | 3%-4% | 8%-9% | 12元-15元 | 3-4 | 45元-50元 | 800-1000 | 0.8元-1元 |"].join("\n");
  const result = parseAiMetricsMarkdown(markdown, ["1072161563583"]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].previousSales, "5万-6万");
  assert.equal(result.rows[0].sales, "6万-7万");
  assert.equal(result.rows[0].clickRate, "2.1%-2.8%");
  assert.equal(result.rows[0].cpc, "0.8元-1元");
  assert.deepEqual(result.missingProductIds, []);
});

test("兼容商品ID表头，并报告未返回的商品", () => {
  const markdown = [header.replace("品ID", "商品ID"), separator, "| 1072161563583 | 5万-6万 | 6万-7万 | 2%-3% | 3%-4% | 8%-9% | 12-15 | 3-4 | 45-50 | 800-1000 | 0.8-1 |"].join("\n");
  const result = parseAiMetricsMarkdown(markdown, ["1072161563583", "1072161563584"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missingProductIds, ["1072161563584"]);
});

test("缺少字段或出现未知字段时拒绝整表", () => {
  const markdown = ["| 品ID | 上期销售额 | 销售额 | 点击率 | 转化率 | 加购率 | 加购成本 | 投产比 | 件单价 | 花费 | 其他 |", separator, "| 1072161563583 | 5万-6万 | 6万-7万 | 2%-3% | 3%-4% | 8%-9% | 12-15 | 3-4 | 45-50 | 800-1000 | xxx |"].join("\n");
  const result = parseAiMetricsMarkdown(markdown, ["1072161563583"]);
  assert.ok(result.errors.some((error) => error.includes("未知字段")));
  assert.deepEqual(result.rows, []);
});

test("拒绝AI回复中不属于本批次的商品ID", () => {
  const markdown = [header, separator, "| 1072161563584 | 5万-6万 | 6万-7万 | 2%-3% | 3%-4% | 8%-9% | 12-15 | 3-4 | 45-50 | 800-1000 | 0.8-1 |"].join("\n");
  const result = parseAiMetricsMarkdown(markdown, ["1072161563583"]);
  assert.ok(result.errors.some((error) => error.includes("不属于本批次")));
  assert.deepEqual(result.rows, []);
});
