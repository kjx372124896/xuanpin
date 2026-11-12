import { Injectable, NotFoundException, OnModuleInit, BadRequestException } from "@nestjs/common";
import { Prisma, ImportBatchStatus, ImportFileStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaService } from "../prisma/prisma.service";
import { parseImportWorkbook, type ParsedImportRow } from "./import-parser";

type UploadedFile = Express.Multer.File;
type RowWithFile = { row: ParsedImportRow; fileId: string; fileName: string };

function sha256(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function dayKey(date: Date) { return date.toISOString().slice(0, 10); }
function businessKey(row: Pick<ParsedImportRow, "productId" | "weekStart" | "categoryName">) {
  return `${row.productId}|${dayKey(row.weekStart)}|${row.categoryName}`;
}
function historyData(item: RowWithFile): Prisma.ProductHistoryCreateManyInput {
  const { row, fileId, fileName } = item;
  return {
    productId: row.productId, weekStart: row.weekStart, weekEnd: row.weekEnd, rawPeriod: row.rawPeriod,
    categoryName: row.categoryName, categoryLevel1: row.categoryLevel1, categoryLevel2: row.categoryLevel2,
    rank: row.rank, trend: row.trend,
    visitorRaw: row.visitor.raw, visitorMin: row.visitor.min, visitorMax: row.visitor.max, visitorMedian: row.visitor.median,
    buyerRaw: row.buyer.raw, buyerMin: row.buyer.min, buyerMax: row.buyer.max, buyerMedian: row.buyer.median,
    cartRaw: row.cart.raw, cartMin: row.cart.min, cartMax: row.cart.max, cartMedian: row.cart.median,
    exportTime: row.exportTime, sourceFileId: fileId, sourceFileName: row.sourceName || fileName,
    sourceRowNumber: row.sourceRowNumber,
  };
}

@Injectable()
export class ImportsService implements OnModuleInit {
  private processing = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.importBatch.updateMany({ where: { status: "PROCESSING" }, data: { status: "QUEUED" } });
    await this.prisma.importFile.updateMany({ where: { status: { in: ["PROCESSING", "COMPLETED"] }, batch: { status: "QUEUED" } }, data: { status: "PREVIEW" } });
    const queued = await this.prisma.importBatch.findMany({ where: { status: "QUEUED" }, select: { id: true } });
    for (const batch of queued) setImmediate(() => void this.processBatch(batch.id));
  }

  async createPreview(files: UploadedFile[], operatorId: string) {
    const batch = await this.prisma.importBatch.create({ data: { operatorId, totalFiles: files.length } });
    const seenHashes = new Set<string>();
    const previewRows: Array<Record<string, unknown>> = [];
    const fileSummaries: Array<Record<string, unknown>> = [];
    let totalRows = 0;
    let errorRows = 0;

    for (const file of files) {
      const hash = sha256(await readFile(file.path));
      let parsed: Awaited<ReturnType<typeof parseImportWorkbook>> | null = null;
      let parseError: string | null = null;
      try {
        parsed = await parseImportWorkbook(file.path);
      } catch (error) {
        parseError = error instanceof Error ? error.message : "Excel 文件解析失败。";
      }
      const previous = seenHashes.has(hash) || Boolean(await this.prisma.importFile.findFirst({ where: { sha256: hash, status: "COMPLETED" }, select: { id: true } }));
      seenHashes.add(hash);
      const status: ImportFileStatus = parseError ? "FAILED" : previous ? "DUPLICATE" : "PREVIEW";
      const rowCount = parsed?.rowCount ?? 0;
      const rowErrors = parsed?.errors ?? [];
      totalRows += rowCount;
      errorRows += rowErrors.length;
      const record = await this.prisma.importFile.create({
        data: {
          batchId: batch.id, originalName: file.originalname, sha256: hash, fileSize: BigInt(file.size),
          sheetName: parsed?.sheetName, weekStart: parsed?.weekStart, weekEnd: parsed?.weekEnd,
          categoryName: parsed?.categoryName, rowCount, errorCount: rowErrors.length, status,
          storagePath: file.path, sourceName: parsed?.sourceNames.join("；") || null,
          errorsJson: JSON.stringify({ parseError, errors: rowErrors.slice(0, 200) }),
        },
      });
      if (parsed && !previous) {
        for (const row of parsed.rows.slice(0, Math.max(0, 20 - previewRows.length))) {
          previewRows.push({
            productId: row.productId, productName: row.productName, categoryName: row.categoryName,
            categoryLevel1: row.categoryLevel1, categoryLevel2: row.categoryLevel2,
            weekStart: dayKey(row.weekStart), weekEnd: dayKey(row.weekEnd), rank: row.rank, visitor: row.visitor, buyer: row.buyer,
          });
        }
      }
      fileSummaries.push({
        id: record.id, originalName: record.originalName, status, sheetName: record.sheetName,
        weekStart: record.weekStart ? dayKey(record.weekStart) : null,
        weekEnd: record.weekEnd ? dayKey(record.weekEnd) : null,
        categoryName: record.categoryName, rowCount, validRows: previous ? 0 : parsed?.rows.length ?? 0,
        errorCount: rowErrors.length, parseError, errors: rowErrors.slice(0, 20),
      });
    }

    await this.prisma.importBatch.update({ where: { id: batch.id }, data: { totalRows, errorRows } });
    return {
      batchId: batch.id, status: "PREVIEW", totalFiles: files.length, totalRows,
      validRows: fileSummaries.reduce((sum, item) => sum + (item.status === "PREVIEW" ? Number(item.validRows ?? 0) : 0), 0),
      errorRows, duplicateFiles: fileSummaries.filter((item) => item.status === "DUPLICATE").length,
      files: fileSummaries, previewRows,
    };
  }

  async confirm(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("导入批次不存在。");
    if (batch.status !== "PREVIEW") throw new BadRequestException("该批次已经提交或处理，不能重复确认。");
    const validFiles = await this.prisma.importFile.count({ where: { batchId, status: "PREVIEW" } });
    if (!validFiles) throw new BadRequestException("批次中没有可导入的有效文件。");
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: "QUEUED" } });
    setImmediate(() => void this.processBatch(batchId));
    return { batchId, status: "QUEUED", message: "导入任务已加入队列。" };
  }

  async listBatches() {
    return this.prisma.importBatch.findMany({
      take: 50, orderBy: { createdAt: "desc" },
      include: { files: { select: { id: true, originalName: true, weekStart: true, weekEnd: true, categoryName: true, rowCount: true, importedCount: true, errorCount: true, status: true } } },
    });
  }

  async getBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId }, include: { files: true } });
    if (!batch) throw new NotFoundException("导入批次不存在。");
    return { ...batch, files: batch.files.map((file) => ({ ...file, fileSize: file.fileSize.toString() })) };
  }

  private async processBatch(batchId: string) {
    if (this.processing.has(batchId)) return;
    this.processing.add(batchId);
    try {
      const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId }, include: { files: true } });
      if (!batch || batch.status !== "QUEUED") return;
      await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: "PROCESSING", startedAt: new Date() } });

      const allRows: RowWithFile[] = [];
      const fileErrors = new Map<string, Array<{ row: number; productId?: string; message: string }>>();
      const fileValidCounts = new Map<string, number>();
      let errorRows = 0;
      let duplicateRows = 0;

      for (const file of batch.files) {
        if (file.status === "DUPLICATE") { duplicateRows += file.rowCount; continue; }
        if (file.status !== "PREVIEW") continue;
        await this.prisma.importFile.update({ where: { id: file.id }, data: { status: "PROCESSING" } });
        const parsed = await parseImportWorkbook(file.storagePath);
        fileErrors.set(file.id, parsed.errors);
        errorRows += parsed.errors.length;
        fileValidCounts.set(file.id, parsed.rows.length);
        for (const row of parsed.rows) allRows.push({ row, fileId: file.id, fileName: file.originalName });
      }

      const productIds = [...new Set(allRows.map((item) => item.row.productId))];
      const metadataByProduct = new Map<string, ParsedImportRow>();
      for (const item of allRows) {
        const current = metadataByProduct.get(item.row.productId);
        if (!current || item.row.weekStart > current.weekStart ||
          (item.row.weekStart.getTime() === current.weekStart.getTime() && (item.row.exportTime?.getTime() ?? 0) > (current.exportTime?.getTime() ?? 0))) {
          metadataByProduct.set(item.row.productId, item.row);
        }
      }

      let newProducts = 0;
      let createdHistories = 0;
      let updatedHistories = 0;
      const fileImportedCounts = new Map<string, number>();
      if (allRows.length) {
        const products = [...metadataByProduct.values()].map((row) => ({
          productId: row.productId, productName: row.productName, productUrl: row.productUrl,
          shopName: row.shopName, shopType: row.shopType, imageUrl: row.imageUrl,
        }));
        for (let i = 0; i < products.length; i += 1000) {
          const result = await this.prisma.product.createMany({ data: products.slice(i, i + 1000), skipDuplicates: true });
          newProducts += result.count;
        }

        const metadataJson = JSON.stringify([...metadataByProduct.values()].map((row) => ({
          "商品ID": row.productId, "商品名称": row.productName, "商品链接": row.productUrl,
          "店铺名称": row.shopName, "店铺类型": row.shopType, "商品图片链接": row.imageUrl,
          "周开始日期": dayKey(row.weekStart),
        })));
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE "商品主表" AS p
          SET "商品名称" = v."商品名称", "商品链接" = v."商品链接", "店铺名称" = v."店铺名称",
              "店铺类型" = v."店铺类型", "商品图片链接" = v."商品图片链接", "更新时间" = now()
          FROM jsonb_to_recordset(${metadataJson}::jsonb) AS v(
            "商品ID" text, "商品名称" text, "商品链接" text, "店铺名称" text,
            "店铺类型" text, "商品图片链接" text, "周开始日期" date
          )
          WHERE p."商品ID" = v."商品ID"
            AND (p."最近上榜日期" IS NULL OR v."周开始日期" >= p."最近上榜日期")
        `);

        const categoryByName = new Map(allRows.map(({ row }) => [row.categoryName, {
          categoryName: row.categoryName, categoryLevel1: row.categoryLevel1, categoryLevel2: row.categoryLevel2,
        }]));
        const categoryNames = [...categoryByName.keys()];
        await this.prisma.category.createMany({ data: [...categoryByName.values()], skipDuplicates: true });

        const starts = [...new Map(allRows.map((item) => [dayKey(item.row.weekStart), item.row.weekStart])).values()];
        const existing = await this.prisma.productHistory.findMany({
          where: { productId: { in: productIds }, weekStart: { in: starts }, categoryName: { in: categoryNames } },
          select: { id: true, productId: true, weekStart: true, categoryName: true, exportTime: true },
        });
        const existingMap = new Map(existing.map((row) => [`${row.productId}|${dayKey(row.weekStart)}|${row.categoryName}`, row]));
        const toCreate: Prisma.ProductHistoryCreateManyInput[] = [];
        const toUpdate: Array<{ id: string; data: Prisma.ProductHistoryUpdateInput }> = [];
        for (const item of allRows) {
          const previous = existingMap.get(businessKey(item.row));
          const data = historyData(item);
          if (!previous) {
            toCreate.push(data);
            fileImportedCounts.set(item.fileId, (fileImportedCounts.get(item.fileId) ?? 0) + 1);
          }
          else if (item.row.exportTime && (!previous.exportTime || item.row.exportTime > previous.exportTime)) {
            toUpdate.push({ id: previous.id, data: { ...data, importedAt: new Date() } });
            fileImportedCounts.set(item.fileId, (fileImportedCounts.get(item.fileId) ?? 0) + 1);
          } else duplicateRows += 1;
        }
        for (let i = 0; i < toCreate.length; i += 1000) {
          const result = await this.prisma.productHistory.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true });
          createdHistories += result.count;
        }
        for (let i = 0; i < toUpdate.length; i += 100) {
          const chunk = toUpdate.slice(i, i + 100);
          await Promise.all(chunk.map((item) => this.prisma.productHistory.update({ where: { id: item.id }, data: item.data })));
          updatedHistories += chunk.length;
        }

        const idsSql = Prisma.join(productIds);
        await this.prisma.$executeRaw(Prisma.sql`
          WITH latest AS (
            SELECT DISTINCT ON (h."商品ID") h."商品ID", h."周开始日期", h."周结束日期", h."类目名称", h."行业排名",
              h."一级类目", h."二级类目",
              h."访客数原值", h."访客数下限", h."访客数上限", h."访客数中值",
              h."支付买家数原值", h."支付买家数下限", h."支付买家数上限", h."支付买家数中值",
              h."加购人数原值", h."加购人数下限", h."加购人数上限", h."加购人数中值"
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql})
            ORDER BY h."商品ID", h."周开始日期" DESC, h."导出时间" DESC NULLS LAST, h."导入时间" DESC, h."类目名称" ASC
          ),
          counts AS (
            SELECT h."商品ID", MIN(h."周开始日期") AS first_week, COUNT(*)::int AS record_count,
              COUNT(DISTINCT h."周开始日期")::int AS week_count
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql}) GROUP BY h."商品ID"
          ),
          week_rows AS (
            SELECT DISTINCT h."商品ID", h."周开始日期",
              ROW_NUMBER() OVER (PARTITION BY h."商品ID" ORDER BY h."周开始日期" DESC) AS rn,
              MAX(h."周开始日期") OVER (PARTITION BY h."商品ID") AS latest_week
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql})
          ),
          streak AS (
            SELECT "商品ID", COUNT(*) FILTER (
              WHERE "周开始日期" = latest_week - ((rn - 1) * INTERVAL '7 days')
            )::int AS streak_count
            FROM week_rows GROUP BY "商品ID"
          )
          UPDATE "商品主表" p SET
            "首次上榜日期" = c.first_week, "最近上榜日期" = l."周开始日期", "最近上榜结束日期" = l."周结束日期",
            "最近行业排名" = l."行业排名", "最新类目名称" = l."类目名称",
            "最新一级类目" = l."一级类目", "最新二级类目" = l."二级类目",
            "历史上榜周数" = c.week_count, "历史记录条数" = c.record_count,
            "连续上榜周数" = COALESCE(s.streak_count, 0),
            "最新访客数原值" = l."访客数原值", "最新访客数下限" = l."访客数下限", "最新访客数上限" = l."访客数上限", "最新访客数中值" = l."访客数中值",
            "最新支付买家数原值" = l."支付买家数原值", "最新支付买家数下限" = l."支付买家数下限", "最新支付买家数上限" = l."支付买家数上限", "最新支付买家数中值" = l."支付买家数中值",
            "最新加购人数原值" = l."加购人数原值", "最新加购人数下限" = l."加购人数下限", "最新加购人数上限" = l."加购人数上限", "最新加购人数中值" = l."加购人数中值",
            "更新时间" = now()
          FROM latest l JOIN counts c ON c."商品ID" = l."商品ID"
          LEFT JOIN streak s ON s."商品ID" = l."商品ID"
          WHERE p."商品ID" = l."商品ID"
        `);
      }

      for (const file of batch.files) {
        if (file.status === "DUPLICATE") continue;
        const errors = fileErrors.get(file.id) ?? [];
        const validCount = fileValidCounts.get(file.id) ?? 0;
        await this.prisma.importFile.update({ where: { id: file.id }, data: {
          status: validCount ? "COMPLETED" : "FAILED",
          importedCount: fileImportedCounts.get(file.id) ?? 0,
          errorCount: errors.length,
          errorsJson: JSON.stringify(errors.slice(0, 200)),
        } });
      }

      const importedRows = createdHistories + updatedHistories;
      await this.prisma.importBatch.update({ where: { id: batchId }, data: {
        status: importedRows || duplicateRows ? "COMPLETED" : "FAILED",
        importedRows, duplicateRows, errorRows, newProducts, createdHistories, updatedHistories,
        errorSummary: errorRows ? `有 ${errorRows} 行数据未通过校验，详情请查看各文件错误明细。` : null,
        completedAt: new Date(),
      } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入处理失败。";
      await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: ImportBatchStatus.FAILED, errorSummary: message, completedAt: new Date() } }).catch(() => undefined);
      await this.prisma.importFile.updateMany({ where: { batchId, status: ImportFileStatus.PROCESSING }, data: { status: ImportFileStatus.FAILED } }).catch(() => undefined);
    } finally {
      this.processing.delete(batchId);
    }
  }
}
