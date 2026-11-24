import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ImportKind, type Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import express from "express";
import multer from "multer";
import { normalizeImportFilename } from "./import-filename";
import { ImportsService } from "./imports.service";

const misdecode = (name: string) => Buffer.from(name, "utf8").toString("latin1");

test("还原上传文件名的UTF-8字节，保留中文、日期、空格和特殊字符", () => {
  for (const name of [
    "市场-搜索排行-居家日用-核心词-搜索人气-日-2026-09-14_2026-09-14.xlsx",
    "商品排行-新品流量-收纳架（第1批）.xlsx",
    "交易增速_咖啡杯 + café 😀.xlsx",
    "café.xlsx",
    "😀.xlsx",
  ]) {
    assert.equal(normalizeImportFilename(misdecode(name)), name);
    assert.equal(normalizeImportFilename(name), name);
  }
});

test("正常文件名和无法完整还原的字节保持原样，避免二次解码或替换字符", () => {
  for (const name of ["", "report-2026-11-24.xlsx", "收纳架.xlsx", "café.xlsx", "£价格.xlsx", "ä¸.xlsx", "\u00ff.xlsx", "\ufffd.xlsx"]) {
    assert.equal(normalizeImportFilename(name), name);
  }
});

async function workbookBlob(kind: ImportKind) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("榜单");
  if (kind === ImportKind.SEARCH_BOARD) {
    sheet.addRow(["维度", "日期范围", "类目", "搜索词类型", "榜单类型", "排名", "搜索词", "搜索人数"]);
    sheet.addRow(["日", "2026-09-14|2026-09-14", "居家日用", "核心词", "搜索人气", 1, "收纳架", "100~200"]);
  } else {
    sheet.addRow(["栏目", "菜单", "数据点", "维度", "日期范围", "行业排名", "趋势", "类目名称", "商品名称", "商品ID", "商品链接", "店铺名称", "店铺类型", "访客数", "支付买家数", "加购人数"]);
    sheet.addRow(["市场", "商品排行", "商品", "周", "2026-11-09 至 2026-11-15", 1, "上升", "收纳整理 / 衣架", "测试衣架", "123456", "https://item.taobao.com/item.htm?id=123456", "测试店铺", "天猫", "100~200", "10~20", "8"]);
  }
  return new Blob([new Uint8Array(Buffer.from(await workbook.xlsx.writeBuffer()))]);
}

for (const kind of [ImportKind.PRODUCT_BOARD, ImportKind.SEARCH_BOARD]) {
  test(`${kind}：真实multipart上传后，预览、保存记录和批次详情均使用正常中文文件名`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "selection-filename-"));
    const records: Array<Prisma.ImportFileUncheckedCreateInput & { id: string }> = [];
    const prisma = {
      importBatch: {
        create: async () => ({ id: "batch-1" }),
        update: async () => ({}),
        findUnique: async () => ({ id: "batch-1", importKind: kind, files: records }),
        findMany: async () => [{ id: "batch-1", importKind: kind, files: records }],
      },
      importFile: {
        findFirst: async () => null,
        create: async ({ data }: { data: Prisma.ImportFileUncheckedCreateInput }) => {
          const record = { ...data, id: `file-${records.length + 1}` };
          records.push(record);
          return record;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const record = records.find((item) => item.id === where.id)!;
          Object.assign(record, data);
          return record;
        },
      },
    };
    const service = new ImportsService(prisma as never);
    // 使用真实Multer默认解码和浏览器FormData格式，覆盖乱码实际产生的边界。
    const app = express();
    app.post("/preview", multer({ dest: directory }).array("files", 100), async (req, res, next) => {
      try {
        res.json(await service.createPreview(req.files as Express.Multer.File[], "operator-1", kind));
      } catch (error) { next(error); }
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const filename = kind === ImportKind.SEARCH_BOARD
        ? "市场-搜索排行-居家日用-核心词-日-2026-09-14_2026-09-14.xlsx"
        : "商品排行-新品流量-衣架（第1批） café 😀.xlsx";
      const invalidFilename = "中文解析失败文件.xlsx";
      const form = new FormData();
      form.append("files", await workbookBlob(kind), filename);
      form.append("files", new Blob(["invalid Excel"]), invalidFilename);
      const response = await fetch(`http://127.0.0.1:${address.port}/preview`, { method: "POST", body: form });
      assert.equal(response.status, 200);
      const result = await response.json() as { validRows: number; files: Array<{ originalName: string; status: string }> };
      assert.equal(result.validRows, 1);
      assert.deepEqual(result.files.map((file) => [file.originalName, file.status]), [[filename, "PREVIEW"], [invalidFilename, "FAILED"]]);
      assert.deepEqual(records.map((file) => file.originalName), [filename, invalidFilename]);
      assert.deepEqual((await service.getBatch("batch-1")).files.map((file) => file.originalName), [filename, invalidFilename]);
      assert.deepEqual((await service.listBatches(kind))[0].files.map((file) => file.originalName), [filename, invalidFilename]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    }
  });

  test(`${kind}：历史批次的乱码文件名在列表和详情中恢复显示`, async () => {
    const filename = "市场-榜单-居家日用-2026-09-14.xlsx";
    const batch = { id: "old-batch", importKind: kind, files: [{ id: "old-file", originalName: misdecode(filename), fileSize: 123n }] };
    const service = new ImportsService({ importBatch: {
      findMany: async (args: { where: { importKind: ImportKind } }) => {
        assert.equal(args.where.importKind, kind);
        return [batch];
      },
      findUnique: async () => batch,
    } } as never);
    assert.equal((await service.listBatches(kind))[0].files[0].originalName, filename);
    const detail = await service.getBatch(batch.id);
    assert.equal(detail.files[0].originalName, filename);
    assert.equal(detail.files[0].fileSize, "123");
    assert.equal(batch.files[0].originalName, misdecode(filename));
  });
}
