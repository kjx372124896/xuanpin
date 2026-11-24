import { Worker } from "node:worker_threads";
import { BoundedWorkQueue } from "../common/bounded-work-queue";
import type { ImportParseResult } from "./import-parser";
import type { SearchImportParseResult } from "./search-import-parser";

const parserQueue = new BoundedWorkQueue(10);
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
if (workerData.tsxPath) require(workerData.tsxPath);
parentPort.on('message', async ({ filePath, kind }) => {
  try {
    const parser = require(kind === 'product' ? workerData.productPath : workerData.searchPath);
    const result = await parser[kind === 'product' ? 'parseImportWorkbook' : 'parseSearchImportWorkbook'](filePath);
    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : 'Excel 解析失败。' });
  }
});
`;
let sharedWorker: Worker | undefined;
let completedFiles = 0;

function getWorker() {
  if (sharedWorker) return sharedWorker;
  const productPath = require.resolve("./import-parser");
  const worker = new Worker(workerSource, {
    eval: true, execArgv: [],
    workerData: {
      productPath, searchPath: require.resolve("./search-import-parser"),
      tsxPath: productPath.endsWith(".ts") ? require.resolve("tsx/cjs") : undefined,
    },
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
  });
  worker.on("error", () => { if (sharedWorker === worker) sharedWorker = undefined; });
  worker.on("exit", () => { if (sharedWorker === worker) sharedWorker = undefined; });
  sharedWorker = worker;
  completedFiles = 0;
  return worker;
}

export function parseWorkbookFile(filePath: string, kind: "product"): Promise<ImportParseResult>;
export function parseWorkbookFile(filePath: string, kind: "search"): Promise<SearchImportParseResult>;
export function parseWorkbookFile(filePath: string, kind: "product" | "search") {
  return parserQueue.run(() => new Promise<ImportParseResult | SearchImportParseResult>((resolve, reject) => {
    const worker = getWorker();
    worker.ref();
    let settled = false;
    const finish = (error?: Error, result?: ImportParseResult | SearchImportParseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeListener("message", onMessage);
      worker.removeListener("error", onError);
      worker.removeListener("exit", onExit);
      completedFiles += 1;
      if (error || completedFiles >= 20) {
        if (sharedWorker === worker) sharedWorker = undefined;
        // Keep the slot until the previous worker has actually exited.
        void worker.terminate().then(() => error ? reject(error) : resolve(result!), reject);
      } else {
        worker.unref();
        resolve(result!);
      }
    };
    const timer = setTimeout(() => finish(new Error("Excel 解析超过60秒，请拆分工作簿后重试。")), 60_000);
    const onMessage = (message: { error?: string; result?: ImportParseResult | SearchImportParseResult }) => finish(message.error ? new Error(message.error) : undefined, message.result);
    const onError = () => finish(new Error("Excel 解析资源不足或工作线程异常，请拆分工作簿后重试。"));
    const onExit = (code: number) => {
      if (!settled) finish(new Error(`Excel 解析工作线程提前结束（${code}），请重试。`));
    };
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.postMessage({ filePath, kind });
  }));
}
