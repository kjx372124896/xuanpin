import assert from "node:assert/strict";
import test from "node:test";
import { DmpAiService } from "./dmp-ai.service";
import { DmpJobsService } from "./dmp-jobs.service";

const ids = ["1072161563583", "1072161563584"];
const header = "| 商品ID | 上期销售额 | 销售额 | 点击率 | 转化率 | 加购率 | 加购成本 | 投产比 | 件单价 | 花费 | CPC |";
const separator = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
const row = (id: string) => `| ${id} | 5万-6万 | 6万-7万 | 2%-3% | 3%-4% | 8%-9% | 12-15 | 3-4 | 45-50 | 800-1000 | 0.8-1 |`;
const markdown = (productIds: string[]) => [header, separator, ...productIds.map(row)].join("\n");

function fixture(cached: string, incoming: string) {
  const run = { id: "run-1", clientRunId: "client-run-1", batchNumber: 1, productIdsJson: JSON.stringify(ids), sessionId: "original-session", status: "NEEDS_REVIEW", markdown: cached, errorMessage: null, updatedAt: new Date() };
  const requests: Array<{ path: string; method: string }> = [];
  const prisma = { dmpAiRun: {
    findUnique: async () => run, findUniqueOrThrow: async () => run,
    update: async ({ data }: any) => { Object.assign(run, data); return run; },
  } };
  const auth = {
    getCredentials: async () => ({}),
    request: async (_: unknown, __: unknown, path: string, method: string) => { requests.push({ path, method }); return {}; },
    readJsonData: () => [{ role: "assistant", contentList: [{ renderCode: "markdown", content: incoming }] }],
  };
  return { run, requests, service: new DmpAiService(prisma as never, auth as never) };
}

test("部分Markdown恢复时只GET原会话历史并补全，不重发收费请求", async () => {
  const { service, requests, run } = fixture(markdown(ids.slice(0, 1)), markdown(ids));
  const result = await service.recoverRun("admin", "client-run-1");
  assert.equal(result.status, "COMPLETED");
  assert.equal(run.markdown, markdown(ids));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.match(requests[0].path, /original-session/);
});

test("恢复结果仍缺商品时保持待处理，较差的历史回复不覆盖已有结果", async () => {
  const partial = fixture("尚在生成", markdown(ids.slice(0, 1)));
  assert.equal((await partial.service.recoverRun("admin", "client-run-1")).status, "NEEDS_REVIEW");
  const worse = fixture(markdown(ids.slice(0, 1)), "尚在生成");
  assert.equal((await worse.service.recoverRun("admin", "client-run-1")).markdown, markdown(ids.slice(0, 1)));
});

test("完整结果复用缓存，后台部分完成批次允许重新查询而非直接重放旧Markdown", async () => {
  const complete = fixture(markdown(ids), "unused");
  await complete.service.recoverRun("admin", "client-run-1");
  assert.equal(complete.requests.length, 0);
  let queued = false;
  const task = { id: "task-1", createdById: "admin", createdAt: new Date(), updatedAt: new Date(), status: "PARTIAL", productIdsJson: JSON.stringify(ids), batches: [] as any[] };
  const batch = { id: "batch-1", taskId: task.id, task, batchNumber: 1, clientRunId: "client-run-1", productIdsJson: JSON.stringify(ids), previousClientRunIdsJson: "[]", status: "PARTIAL", createdAt: new Date(), updatedAt: new Date() };
  task.batches.push(batch);
  const prisma = {
    dmpCollectionBatch: { findUnique: async () => batch, update: async ({ data }: any) => { queued = data.status === "RECOVERING"; } },
    dmpCollectionTask: { findUnique: async () => task, update: async () => ({}) },
    dmpAiRun: { findUnique: async () => ({ sessionId: "original-session", markdown: markdown(ids.slice(0, 1)) }) },
  };
  const jobs = new DmpJobsService(prisma as never, {} as never, {} as never, { importAiMetrics: () => { throw new Error("Must read history first"); } } as never);
  try {
    const result = await jobs.recoverBatch(task.id, 1);
    assert.equal(queued, true);
    assert.equal(result.batches[0].canRecover, true);
  } finally { jobs.onModuleDestroy(); }
});
