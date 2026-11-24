import assert from "node:assert/strict";
import test from "node:test";
import { BoundedWorkQueue } from "./bounded-work-queue";

test("导入解析串行且队列有上限，任务失败后继续执行下一个", async () => {
  const queue = new BoundedWorkQueue(2);
  const order: number[] = [];
  let release!: () => void;
  const first = queue.run(async () => { order.push(1); await new Promise<void>((resolve) => { release = resolve; }); throw new Error("fixture"); });
  const rejected = assert.rejects(first, /fixture/);
  const second = queue.run(async () => { order.push(2); });
  const third = queue.run(async () => { order.push(3); });
  await assert.rejects(queue.run(async () => { order.push(4); }), (error: any) => error.getStatus() === 503);
  assert.deepEqual(order, [1]);
  release();
  await Promise.all([rejected, second, third]);
  assert.deepEqual(order, [1, 2, 3]);
  await queue.run(async () => order.push(5));
  assert.deepEqual(order, [1, 2, 3, 5]);
});
