import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportsService } from "./imports.service";
import { deduplicateProductImportRows } from "./product-import-dedup";

function candidate(
  fileId: string,
  boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC",
  exportTime: string | null = "2026-11-23T10:00:00.000Z",
  categoryName = "餐饮具 / 咖啡杯",
  weekStart = "2026-11-09T00:00:00.000Z",
) {
  return {
    fileId,
    fileName: `${fileId}.xlsx`,
    row: {
      boardType,
      productId: "123456",
      weekStart: new Date(weekStart),
      categoryName,
      exportTime: exportTime ? new Date(exportTime) : null,
    },
  };
}

test("混合批次按榜单类型隔离，重复商品保留导出时间最新的文件记录", () => {
  const result = deduplicateProductImportRows([
    candidate("A", "NEW_PRODUCT_TRAFFIC", "2026-11-23T10:00:00.000Z"),
    candidate("B", "NEW_PRODUCT_TRAFFIC", "2026-11-23T15:00:00.000Z"),
    candidate("C", "TRANSACTION_GROWTH", "2026-11-23T14:00:00.000Z"),
  ]);

  assert.deepEqual(result.rows.map((item) => item.fileId), ["B", "C"]);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.duplicateCountsByFile.get("A"), 1);
  assert.equal(result.duplicateCountsByFile.has("B"), false);
  assert.equal(result.duplicateCountsByFile.has("C"), false);
});

test("导出时间较新的记录即使先上传也优先保留", () => {
  const result = deduplicateProductImportRows([
    candidate("newer", "NEW_PRODUCT_TRAFFIC", "2026-11-23T15:00:00.000Z"),
    candidate("older", "NEW_PRODUCT_TRAFFIC", "2026-11-23T10:00:00.000Z"),
  ]);

  assert.deepEqual(result.rows.map((item) => item.fileId), ["newer"]);
  assert.equal(result.duplicateCountsByFile.get("older"), 1);
});

test("不同周期或不同类目不合并", () => {
  const result = deduplicateProductImportRows([
    candidate("base"),
    candidate("other-category", "NEW_PRODUCT_TRAFFIC", "2026-11-23T11:00:00.000Z", "餐饮具 / 水杯"),
    candidate("other-week", "NEW_PRODUCT_TRAFFIC", "2026-11-23T12:00:00.000Z", "餐饮具 / 咖啡杯", "2026-11-16T00:00:00.000Z"),
  ]);

  assert.equal(result.rows.length, 3);
  assert.equal(result.duplicateRows, 0);
});

test("导出时间相同或都缺失时稳定保留先出现的记录", () => {
  const equalTime = deduplicateProductImportRows([
    candidate("first", "NEW_PRODUCT_TRAFFIC", "2026-11-23T10:00:00.000Z"),
    candidate("second", "NEW_PRODUCT_TRAFFIC", "2026-11-23T10:00:00.000Z"),
  ]);
  const missingTime = deduplicateProductImportRows([
    candidate("first-null", "NEW_PRODUCT_TRAFFIC", null),
    candidate("second-null", "NEW_PRODUCT_TRAFFIC", null),
  ]);

  assert.deepEqual(equalTime.rows.map((item) => item.fileId), ["first"]);
  assert.deepEqual(missingTime.rows.map((item) => item.fileId), ["first-null"]);
  assert.equal(equalTime.duplicateRows, 1);
  assert.equal(missingTime.duplicateRows, 1);
});

async function createWorkbook(directory: string, name: string, boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH", exportTime: string) {
  const filePath = join(directory, name);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("合并数据");
  const baseHeaders = ["栏目", "菜单", "数据点", "维度", "日期范围", "关键词", "导出时间", "行业排名", "趋势", "类目名称", "商品名称", "商品ID", "商品链接", "店铺名称", "店铺类型", "访客数", "支付买家数"];
  sheet.addRow([...baseHeaders, boardType === "NEW_PRODUCT_TRAFFIC" ? "加购人数" : "商品关键词", "商品图片链接"]);
  sheet.addRow([
    "市场", "商品排行", "商品", "周", "2026-11-09 至 2026-11-15", "厨房用品", new Date(exportTime),
    1, "上升", "餐饮具 / 咖啡杯", "测试商品", "123456", "https://item.taobao.com/item.htm?id=123456",
    "测试店铺", "天猫", "100~200", "10~20", boardType === "NEW_PRODUCT_TRAFFIC" ? "8" : "厨房收纳",
    "https://img.example.com/item.jpg",
  ]);
  await workbook.xlsx.writeFile(filePath);
  return {
    path: filePath,
    originalname: name,
    size: (await readFile(filePath)).byteLength,
  } as Express.Multer.File;
}

test("商品榜单预览阶段跨文件归并，并把胜出行保存为后台入库数据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selection-product-import-preview-"));
  try {
    const files = [
      await createWorkbook(directory, "A.xlsx", "NEW_PRODUCT_TRAFFIC", "2026-11-23T10:00:00.000Z"),
      await createWorkbook(directory, "B.xlsx", "NEW_PRODUCT_TRAFFIC", "2026-11-23T15:00:00.000Z"),
      await createWorkbook(directory, "C.xlsx", "TRANSACTION_GROWTH", "2026-11-23T14:00:00.000Z"),
    ];
    const fileRecords: Array<Record<string, any>> = [];
    let nextFileId = 0;
    let batchUpdate: Record<string, unknown> | undefined;
    const prisma = {
      importBatch: {
        create: async () => ({ id: "batch-1" }),
        update: async (args: { data: Record<string, unknown> }) => { batchUpdate = args.data; return args.data; },
      },
      importFile: {
        findFirst: async () => null,
        create: async (args: { data: Record<string, any> }) => {
          const record = { id: `file-${++nextFileId}`, ...args.data };
          fileRecords.push(record);
          return record;
        },
        update: async (args: { where: { id: string }; data: Record<string, any> }) => {
          const record = fileRecords.find((item) => item.id === args.where.id)!;
          Object.assign(record, args.data);
          return record;
        },
      },
    };
    const result = await new ImportsService(prisma as never).createPreview(files, "operator-1") as unknown as {
      validRows: number;
      duplicateRows: number;
      previewRows: Array<{ boardType: string }>;
      files: Array<{ originalName: string; validRows: number; duplicateRows: number }>;
    };

    assert.equal(result.validRows, 2);
    assert.equal(result.duplicateRows, 1);
    assert.deepEqual(result.previewRows.map((row: any) => row.boardType).sort(), ["NEW_PRODUCT_TRAFFIC", "TRANSACTION_GROWTH"]);
    assert.deepEqual(result.files.map((file: any) => [file.originalName, file.validRows, file.duplicateRows]), [
      ["A.xlsx", 0, 1], ["B.xlsx", 1, 0], ["C.xlsx", 1, 0],
    ]);
    assert.equal(batchUpdate?.duplicateRows, 1);

    const aArtifact = JSON.parse(await readFile(fileRecords[0].storagePath, "utf8"));
    const bArtifact = JSON.parse(await readFile(fileRecords[1].storagePath, "utf8"));
    const cArtifact = JSON.parse(await readFile(fileRecords[2].storagePath, "utf8"));
    assert.equal(aArtifact.rows.length, 0);
    assert.equal(bArtifact.rows.length, 1);
    assert.equal(bArtifact.rows[0].exportTime, "2026-11-23T15:00:00.000Z");
    assert.equal(cArtifact.rows.length, 1);
    assert.equal(cArtifact.rows[0].boardType, "TRANSACTION_GROWTH");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
