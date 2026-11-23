import { Injectable, NotFoundException, OnModuleInit, BadRequestException } from "@nestjs/common";
import { Prisma, ImportBatchStatus, ImportFileStatus, ImportKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaService } from "../prisma/prisma.service";
import { parseImportWorkbook, type ParsedImportRow } from "./import-parser";
import { parseSearchImportWorkbook, type ParsedSearchImportRow } from "./search-import-parser";
import { NO_SECOND_LEVEL_CATEGORY } from "./metric-parser";
import { deduplicateProductImportRows, productImportBusinessKey } from "./product-import-dedup";

type UploadedFile = Express.Multer.File;
type RowWithFile = { row: ParsedImportRow; fileId: string; fileName: string };
type SearchRowWithFile = { row: ParsedSearchImportRow; fileId: string; fileName: string };

function sha256(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function dayKey(date: Date) { return date.toISOString().slice(0, 10); }
function categoryRegistryName(level1: string, level2: string) {
  const suffix = ` / ${level2}`;
  const fullName = `${level1}${suffix}`;
  if (Array.from(fullName).length <= 255) return fullName;
  const digest = createHash("md5").update(level1).digest("hex").slice(0, 8);
  const marker = `~${digest}${suffix}`;
  return `${Array.from(level1).slice(0, 255 - Array.from(marker).length).join("")}${marker}`;
}
function historyData(item: RowWithFile): Prisma.ProductHistoryCreateManyInput {
  const { row, fileId, fileName } = item;
  return {
    productId: row.productId, boardType: row.boardType, weekStart: row.weekStart, weekEnd: row.weekEnd, rawPeriod: row.rawPeriod,
    categoryName: row.categoryName, categoryLevel1: row.categoryLevel1, categoryLevel2: row.categoryLevel2,
    rank: row.rank, trend: row.trend,
    visitorRaw: row.visitor.raw, visitorMin: row.visitor.min, visitorMax: row.visitor.max, visitorMedian: row.visitor.median,
    buyerRaw: row.buyer.raw, buyerMin: row.buyer.min, buyerMax: row.buyer.max, buyerMedian: row.buyer.median,
    cartRaw: row.cart.raw, cartMin: row.cart.min, cartMax: row.cart.max, cartMedian: row.cart.median,
    productKeyword: row.productKeyword,
    exportTime: row.exportTime, sourceFileId: fileId, sourceFileName: row.sourceName || fileName,
    sourceRowNumber: row.sourceRowNumber,
  };
}

function searchBusinessKey(row: ParsedSearchImportRow) {
  return JSON.stringify([row.searchTerm, row.categoryName, row.searchTermType, row.boardType, row.dimension, dayKey(row.searchDate)]);
}

function searchHistoryData(item: SearchRowWithFile): Prisma.SearchTermHistoryCreateManyInput {
  const { row, fileId, fileName } = item;
  return {
    searchTerm: row.searchTerm,
    categoryName: row.categoryName,
    classificationName: row.classificationName,
    searchTermType: row.searchTermType,
    boardType: row.boardType,
    dimension: row.dimension,
    searchDate: row.searchDate,
    rank: row.rank,
    searchPeopleRaw: row.searchPeople.raw,
    searchPeopleMin: row.searchPeople.min,
    searchPeopleMax: row.searchPeople.max,
    searchPeopleMedian: row.searchPeople.median,
    clickRate: row.clickRate,
    paymentConversionRate: row.paymentConversionRate,
    exportTime: row.exportTime,
    sourceFileId: fileId,
    sourceFileName: fileName,
    sourceRowNumber: row.sourceRowNumber,
  };
}

function parseProductImportFileMeta(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "null");
    return {
      errors: Array.isArray(parsed) ? parsed : Array.isArray(parsed?.errors) ? parsed.errors : [],
      duplicateRows: Array.isArray(parsed) ? 0 : Number.isInteger(parsed?.duplicateRows) ? Math.max(0, parsed.duplicateRows) : 0,
    };
  } catch {
    return { errors: [], duplicateRows: 0 };
  }
}

async function readProductPreviewRows(storagePath: string): Promise<ParsedImportRow[]> {
  const artifact = JSON.parse(await readFile(storagePath, "utf8")) as { version?: number; rows?: Array<Record<string, unknown>> };
  if (artifact.version !== 1 || !Array.isArray(artifact.rows)) {
    throw new Error("商品榜单预览归并文件格式无效，请重新上传并预览。");
  }
  return artifact.rows.map((row) => ({
    ...row,
    weekStart: new Date(String(row.weekStart)),
    weekEnd: new Date(String(row.weekEnd)),
    exportTime: row.exportTime ? new Date(String(row.exportTime)) : null,
  })) as unknown as ParsedImportRow[];
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

  async createPreview(files: UploadedFile[], operatorId: string, importKind: ImportKind = ImportKind.PRODUCT_BOARD) {
    if (importKind === ImportKind.SEARCH_BOARD) return this.createSearchPreview(files, operatorId);
    return this.createProductPreview(files, operatorId);
  }

  private async createSearchPreview(files: UploadedFile[], operatorId: string) {
    const batch = await this.prisma.importBatch.create({ data: { operatorId, importKind: ImportKind.SEARCH_BOARD, totalFiles: files.length } });
    const seenHashes = new Set<string>();
    const previewRows: Array<Record<string, unknown>> = [];
    const fileSummaries: Array<Record<string, unknown>> = [];
    let totalRows = 0;
    let errorRows = 0;

    for (const file of files) {
      const hash = sha256(await readFile(file.path));
      let parsed: Awaited<ReturnType<typeof parseSearchImportWorkbook>> | null = null;
      let parseError: string | null = null;
      try {
        parsed = await parseSearchImportWorkbook(file.path);
      } catch (error) {
        parseError = error instanceof Error ? error.message : "搜索榜单 Excel 文件解析失败。";
      }
      const previous = seenHashes.has(hash) || Boolean(await this.prisma.importFile.findFirst({
        where: { sha256: hash, status: "COMPLETED", batch: { importKind: ImportKind.SEARCH_BOARD } },
        select: { id: true },
      }));
      seenHashes.add(hash);
      const status: ImportFileStatus = parseError ? "FAILED" : previous ? "DUPLICATE" : "PREVIEW";
      const rowCount = parsed?.rowCount ?? 0;
      const rowErrors = parsed?.errors ?? [];
      totalRows += rowCount;
      errorRows += rowErrors.length;
      const record = await this.prisma.importFile.create({
        data: {
          batchId: batch.id,
          originalName: file.originalname,
          sha256: hash,
          fileSize: BigInt(file.size),
          sheetName: parsed?.sheetName,
          periodStart: parsed?.periodStart,
          periodEnd: parsed?.periodEnd,
          searchCategoryName: parsed?.searchCategoryName,
          searchTermType: parsed?.searchTermType,
          searchBoardType: parsed?.searchBoardType,
          dimension: parsed?.dimension,
          rowCount,
          errorCount: rowErrors.length,
          status,
          storagePath: file.path,
          errorsJson: JSON.stringify({ parseError, errors: rowErrors.slice(0, 200) }),
        },
      });
      if (parsed && !previous) {
        for (const row of parsed.rows.slice(0, Math.max(0, 20 - previewRows.length))) {
          previewRows.push({
            searchTerm: row.searchTerm,
            categoryName: row.categoryName,
            classificationName: row.classificationName,
            searchTermType: row.searchTermType,
            boardType: row.boardType,
            dimension: row.dimension,
            searchDate: dayKey(row.searchDate),
            rank: row.rank,
            searchPeople: row.searchPeople,
          });
        }
      }
      fileSummaries.push({
        id: record.id,
        originalName: record.originalName,
        status,
        sheetName: record.sheetName,
        periodStart: record.periodStart ? dayKey(record.periodStart) : null,
        periodEnd: record.periodEnd ? dayKey(record.periodEnd) : null,
        searchCategoryName: record.searchCategoryName,
        searchTermType: record.searchTermType,
        searchBoardType: record.searchBoardType,
        dimension: record.dimension,
        rowCount,
        validRows: previous ? 0 : parsed?.rows.length ?? 0,
        errorCount: rowErrors.length,
        parseError,
        errors: rowErrors.slice(0, 20),
      });
    }

    await this.prisma.importBatch.update({ where: { id: batch.id }, data: { totalRows, errorRows } });
    return {
      batchId: batch.id,
      importKind: ImportKind.SEARCH_BOARD,
      status: "PREVIEW",
      totalFiles: files.length,
      totalRows,
      validRows: fileSummaries.reduce((sum, item) => sum + (item.status === "PREVIEW" ? Number(item.validRows ?? 0) : 0), 0),
      errorRows,
      duplicateFiles: fileSummaries.filter((item) => item.status === "DUPLICATE").length,
      files: fileSummaries,
      previewRows,
    };
  }

  private async createProductPreview(files: UploadedFile[], operatorId: string) {
    const batch = await this.prisma.importBatch.create({ data: { operatorId, totalFiles: files.length } });
    const seenHashes = new Set<string>();
    const fileItems: Array<{
      id: string;
      originalName: string;
      originalPath: string;
      status: ImportFileStatus;
      parsed: Awaited<ReturnType<typeof parseImportWorkbook>> | null;
      parseError: string | null;
      rowCount: number;
      rowErrors: Array<{ row: number; productId?: string; message: string }>;
    }> = [];
    const fileSummaries: Array<Record<string, unknown>> = [];
    const candidates: RowWithFile[] = [];
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
          boardType: parsed?.boardType ?? null,
          sheetName: parsed?.sheetName, weekStart: parsed?.weekStart, weekEnd: parsed?.weekEnd,
          categoryName: parsed?.categoryName, rowCount, errorCount: rowErrors.length, status,
          storagePath: file.path, sourceName: parsed?.sourceNames.join("；") || null,
          errorsJson: JSON.stringify({ parseError, errors: rowErrors.slice(0, 200) }),
        },
      });
      if (parsed && !previous) {
        for (const row of parsed.rows) candidates.push({ row, fileId: record.id, fileName: file.originalname });
      }
      fileItems.push({
        id: record.id, originalName: file.originalname, originalPath: file.path, status,
        parsed, parseError, rowCount, rowErrors,
      });
    }

    const deduplicated = deduplicateProductImportRows(candidates);
    const rowsByFile = new Map<string, ParsedImportRow[]>();
    for (const item of deduplicated.rows) {
      const rows = rowsByFile.get(item.fileId) ?? [];
      rows.push(item.row);
      rowsByFile.set(item.fileId, rows);
    }

    for (const item of fileItems) {
      const duplicateRows = deduplicated.duplicateCountsByFile.get(item.id) ?? 0;
      const retainedRows = item.status === "PREVIEW" ? rowsByFile.get(item.id) ?? [] : [];
      if (item.status === "PREVIEW") {
        const previewPath = `${item.originalPath}.preview.json`;
        await writeFile(previewPath, JSON.stringify({ version: 1, rows: retainedRows }), "utf8");
        await this.prisma.importFile.update({
          where: { id: item.id },
          data: {
            storagePath: previewPath,
            errorsJson: JSON.stringify({ parseError: item.parseError, errors: item.rowErrors.slice(0, 200), duplicateRows }),
          },
        });
      }
      fileSummaries.push({
        id: item.id, originalName: item.originalName, status: item.status, sheetName: item.parsed?.sheetName ?? null,
        boardType: item.parsed?.boardType ?? null,
        weekStart: item.parsed?.weekStart ? dayKey(item.parsed.weekStart) : null,
        weekEnd: item.parsed?.weekEnd ? dayKey(item.parsed.weekEnd) : null,
        categoryName: item.parsed?.categoryName ?? null, rowCount: item.rowCount, validRows: retainedRows.length,
        duplicateRows, errorCount: item.rowErrors.length, parseError: item.parseError, errors: item.rowErrors.slice(0, 20),
      });
    }

    const previewRows = deduplicated.rows.slice(0, 20).map(({ row }) => ({
      boardType: row.boardType,
      productId: row.productId, productName: row.productName, categoryName: row.categoryName,
      categoryLevel1: row.categoryLevel1, categoryLevel2: row.categoryLevel2,
      weekStart: dayKey(row.weekStart), weekEnd: dayKey(row.weekEnd), rank: row.rank, visitor: row.visitor, buyer: row.buyer,
    }));
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { totalRows, errorRows, duplicateRows: deduplicated.duplicateRows },
    });
    return {
      batchId: batch.id, status: "PREVIEW", totalFiles: files.length, totalRows,
      validRows: fileSummaries.reduce((sum, item) => sum + (item.status === "PREVIEW" ? Number(item.validRows ?? 0) : 0), 0),
      duplicateRows: deduplicated.duplicateRows,
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

  async listBatches(importKind?: ImportKind) {
    return this.prisma.importBatch.findMany({
      where: importKind ? { importKind } : undefined,
      take: 50, orderBy: { createdAt: "desc" },
      include: { files: { select: { id: true, originalName: true, boardType: true, weekStart: true, weekEnd: true, periodStart: true, periodEnd: true, categoryName: true, searchCategoryName: true, searchTermType: true, searchBoardType: true, dimension: true, rowCount: true, importedCount: true, errorCount: true, status: true } } },
    });
  }

  async getBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId }, include: { files: true } });
    if (!batch) throw new NotFoundException("导入批次不存在。");
    return { ...batch, files: batch.files.map((file) => ({ ...file, fileSize: file.fileSize.toString() })) };
  }

  private async processSearchBatch(batch: Prisma.ImportBatchGetPayload<{ include: { files: true } }>) {
    await this.prisma.importBatch.update({ where: { id: batch.id }, data: { status: "PROCESSING", startedAt: new Date() } });

    const allRows: SearchRowWithFile[] = [];
    const fileErrors = new Map<string, Array<{ row: number; searchTerm?: string; message: string }>>();
    const fileValidCounts = new Map<string, number>();
    let errorRows = 0;
    let duplicateRows = 0;

    for (const file of batch.files) {
      if (file.status === "DUPLICATE") {
        duplicateRows += file.rowCount;
        continue;
      }
      if (file.status !== "PREVIEW") continue;
      await this.prisma.importFile.update({ where: { id: file.id }, data: { status: "PROCESSING" } });
      const parsed = await parseSearchImportWorkbook(file.storagePath);
      fileErrors.set(file.id, parsed.errors);
      errorRows += parsed.errors.length;
      fileValidCounts.set(file.id, parsed.rows.length);
      for (const row of parsed.rows) allRows.push({ row, fileId: file.id, fileName: file.originalName });
    }

    const existingMap = new Map<string, { id: string; exportTime: Date | null }>();
    if (allRows.length) {
      const terms = [...new Set(allRows.map((item) => item.row.searchTerm))];
      const categories = [...new Set(allRows.map((item) => item.row.categoryName))];
      const termTypes = [...new Set(allRows.map((item) => item.row.searchTermType))];
      const boardTypes = [...new Set(allRows.map((item) => item.row.boardType))];
      const dates = [...new Map(allRows.map((item) => [dayKey(item.row.searchDate), item.row.searchDate])).values()];
      const existing = await this.prisma.searchTermHistory.findMany({
        where: {
          searchTerm: { in: terms },
          categoryName: { in: categories },
          searchTermType: { in: termTypes },
          boardType: { in: boardTypes },
          dimension: "日",
          searchDate: { in: dates },
        },
        select: {
          id: true,
          searchTerm: true,
          categoryName: true,
          searchTermType: true,
          boardType: true,
          dimension: true,
          searchDate: true,
          exportTime: true,
        },
      });
      for (const row of existing) {
        const key = JSON.stringify([row.searchTerm, row.categoryName, row.searchTermType, row.boardType, row.dimension, dayKey(row.searchDate)]);
        existingMap.set(key, { id: row.id, exportTime: row.exportTime });
      }
    }

    const createRows = new Map<string, SearchRowWithFile>();
    const updateRows = new Map<string, SearchRowWithFile>();
    for (const item of allRows) {
      const key = searchBusinessKey(item.row);
      const existing = existingMap.get(key);
      if (!existing) {
        const pending = createRows.get(key);
        if (!pending) createRows.set(key, item);
        else if (item.row.exportTime && (!pending.row.exportTime || item.row.exportTime > pending.row.exportTime)) {
          createRows.set(key, item);
          duplicateRows += 1;
        } else duplicateRows += 1;
        continue;
      }

      const pendingUpdate = updateRows.get(existing.id);
      const currentExportTime = pendingUpdate?.row.exportTime ?? existing.exportTime;
      if (item.row.exportTime && (!currentExportTime || item.row.exportTime > currentExportTime)) {
        if (pendingUpdate) duplicateRows += 1;
        updateRows.set(existing.id, item);
      } else duplicateRows += 1;
    }

    const fileImportedCounts = new Map<string, number>();
    for (const item of createRows.values()) fileImportedCounts.set(item.fileId, (fileImportedCounts.get(item.fileId) ?? 0) + 1);
    for (const item of updateRows.values()) fileImportedCounts.set(item.fileId, (fileImportedCounts.get(item.fileId) ?? 0) + 1);

    let createdHistories = 0;
    let updatedHistories = 0;
    const createData = [...createRows.values()].map(searchHistoryData);
    for (let index = 0; index < createData.length; index += 1000) {
      const result = await this.prisma.searchTermHistory.createMany({ data: createData.slice(index, index + 1000), skipDuplicates: true });
      createdHistories += result.count;
    }

    const updates = [...updateRows.entries()];
    for (let index = 0; index < updates.length; index += 100) {
      const chunk = updates.slice(index, index + 100);
      await Promise.all(chunk.map(([id, item]) => this.prisma.searchTermHistory.update({
        where: { id },
        data: {
          classificationName: item.row.classificationName,
          rank: item.row.rank,
          searchPeopleRaw: item.row.searchPeople.raw,
          searchPeopleMin: item.row.searchPeople.min,
          searchPeopleMax: item.row.searchPeople.max,
          searchPeopleMedian: item.row.searchPeople.median,
          clickRate: item.row.clickRate,
          paymentConversionRate: item.row.paymentConversionRate,
          exportTime: item.row.exportTime,
          sourceFileId: item.fileId,
          sourceFileName: item.fileName,
          sourceRowNumber: item.row.sourceRowNumber,
          importedAt: new Date(),
        },
      })));
      updatedHistories += chunk.length;
    }

    for (const file of batch.files) {
      if (file.status === "DUPLICATE") continue;
      const errors = fileErrors.get(file.id) ?? [];
      const validCount = fileValidCounts.get(file.id) ?? 0;
      await this.prisma.importFile.update({
        where: { id: file.id },
        data: {
          status: validCount ? "COMPLETED" : "FAILED",
          importedCount: fileImportedCounts.get(file.id) ?? 0,
          errorCount: errors.length,
          errorsJson: JSON.stringify({ parseError: null, errors: errors.slice(0, 200) }),
        },
      });
    }

    const importedRows = createdHistories + updatedHistories;
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: importedRows || duplicateRows ? "COMPLETED" : "FAILED",
        importedRows,
        duplicateRows,
        errorRows,
        newProducts: 0,
        createdHistories,
        updatedHistories,
        errorSummary: errorRows ? "有 " + errorRows + " 行搜索词数据未通过校验，详情请查看各文件错误明细。" : null,
        completedAt: new Date(),
      },
    });
  }

  private async processBatch(batchId: string) {
    if (this.processing.has(batchId)) return;
    this.processing.add(batchId);
    try {
      const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId }, include: { files: true } });
      if (!batch || batch.status !== "QUEUED") return;
      if (batch.importKind === ImportKind.SEARCH_BOARD) {
        await this.processSearchBatch(batch);
        return;
      }
      await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: "PROCESSING", startedAt: new Date() } });

      let allRows: RowWithFile[] = [];
      const fileErrors = new Map<string, Array<{ row: number; productId?: string; message: string }>>();
      const fileValidCounts = new Map<string, number>();
      const fileErrorCounts = new Map<string, number>();
      const fileDuplicateCounts = new Map<string, number>();
      let errorRows = 0;
      let duplicateRows = 0;

      for (const file of batch.files) {
        if (file.status === "DUPLICATE") { duplicateRows += file.rowCount; continue; }
        if (file.status !== "PREVIEW") continue;
        await this.prisma.importFile.update({ where: { id: file.id }, data: { status: "PROCESSING" } });
        let rows: ParsedImportRow[];
        let errors: Array<{ row: number; productId?: string; message: string }>;
        let storedDuplicateRows = 0;
        let fileErrorCount = 0;
        if (file.storagePath.endsWith(".preview.json")) {
          rows = await readProductPreviewRows(file.storagePath);
          const meta = parseProductImportFileMeta(file.errorsJson);
          errors = meta.errors;
          storedDuplicateRows = meta.duplicateRows;
          fileErrorCount = file.errorCount;
        } else {
          // Backward compatibility for batches previewed before pre-deduplication was introduced.
          const parsed = await parseImportWorkbook(file.storagePath);
          rows = parsed.rows;
          errors = parsed.errors;
          fileErrorCount = parsed.errors.length;
        }
        fileErrors.set(file.id, errors);
        fileErrorCounts.set(file.id, fileErrorCount);
        fileDuplicateCounts.set(file.id, storedDuplicateRows);
        errorRows += fileErrorCount;
        duplicateRows += storedDuplicateRows;
        for (const row of rows) allRows.push({ row, fileId: file.id, fileName: file.originalName });
      }

      // Sidecar rows are already deduplicated in preview. This second pass only
      // affects legacy queued batches that still point to their original XLSX files.
      const batchDeduplication = deduplicateProductImportRows(allRows);
      allRows = batchDeduplication.rows;
      duplicateRows += batchDeduplication.duplicateRows;
      for (const [fileId, count] of batchDeduplication.duplicateCountsByFile) {
        fileDuplicateCounts.set(fileId, (fileDuplicateCounts.get(fileId) ?? 0) + count);
      }
      fileValidCounts.clear();
      for (const item of allRows) fileValidCounts.set(item.fileId, (fileValidCounts.get(item.fileId) ?? 0) + 1);

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

        const categoryByKey = new Map<string, Prisma.CategoryCreateManyInput>();
        for (const { row } of allRows) {
          const parentKey = `parent\u0000${row.categoryLevel1}`;
          if (!categoryByKey.has(parentKey)) {
            categoryByKey.set(parentKey, {
              categoryName: row.categoryLevel1,
              categoryLevel1: row.categoryLevel1,
              categoryLevel2: null,
            });
          }
          const childKey = `child\u0000${row.categoryLevel1}\u0000${row.categoryLevel2}`;
          categoryByKey.set(childKey, {
            categoryName: row.categoryLevel2 === NO_SECOND_LEVEL_CATEGORY
              ? categoryRegistryName(row.categoryLevel1, row.categoryLevel2)
              : row.categoryName,
            categoryLevel1: row.categoryLevel1,
            categoryLevel2: row.categoryLevel2,
          });
        }
        const categoryNames = [...new Set(allRows.map(({ row }) => row.categoryName))];
        await this.prisma.category.createMany({ data: [...categoryByKey.values()], skipDuplicates: true });

        const starts = [...new Map(allRows.map((item) => [dayKey(item.row.weekStart), item.row.weekStart])).values()];
        const existing = await this.prisma.productHistory.findMany({
          where: {
            productId: { in: productIds }, weekStart: { in: starts }, categoryName: { in: categoryNames },
            boardType: { in: [...new Set(allRows.map((item) => item.row.boardType))] },
          },
          select: { id: true, boardType: true, productId: true, weekStart: true, categoryName: true, exportTime: true },
        });
        const existingMap = new Map(existing.map((row) => [`${row.boardType}|${row.productId}|${dayKey(row.weekStart)}|${row.categoryName}`, row]));
        const toCreate: Prisma.ProductHistoryCreateManyInput[] = [];
        const toUpdate: Array<{ id: string; data: Prisma.ProductHistoryUpdateInput }> = [];
        for (const item of allRows) {
          const previous = existingMap.get(productImportBusinessKey(item.row));
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
            SELECT DISTINCT ON (h."商品ID", h."榜单类型") h."商品ID", h."榜单类型", h."周开始日期", h."周结束日期", h."类目名称", h."行业排名",
              h."一级类目", h."二级类目",
              h."访客数原值", h."访客数下限", h."访客数上限", h."访客数中值",
              h."支付买家数原值", h."支付买家数下限", h."支付买家数上限", h."支付买家数中值"
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql})
            ORDER BY h."商品ID", h."榜单类型", h."周开始日期" DESC,
              CASE WHEN h."二级类目" = '无二级类目' THEN 1 ELSE 0 END ASC,
              h."导出时间" DESC NULLS LAST, h."导入时间" DESC, h."类目名称" ASC
          ),
          counts AS (
            SELECT h."商品ID", h."榜单类型", MIN(h."周开始日期") AS first_week, COUNT(*)::int AS record_count,
              COUNT(DISTINCT h."周开始日期")::int AS week_count
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql}) GROUP BY h."商品ID", h."榜单类型"
          ),
          week_rows AS (
            SELECT DISTINCT h."商品ID", h."榜单类型", h."周开始日期",
              ROW_NUMBER() OVER (PARTITION BY h."商品ID", h."榜单类型" ORDER BY h."周开始日期" DESC) AS rn,
              MAX(h."周开始日期") OVER (PARTITION BY h."商品ID", h."榜单类型") AS latest_week
            FROM "商品上榜历史表" h WHERE h."商品ID" IN (${idsSql})
          ),
          streak AS (
            SELECT "商品ID", "榜单类型", COUNT(*) FILTER (
              WHERE "周开始日期" = latest_week - ((rn - 1) * INTERVAL '7 days')
            )::int AS streak_count
            FROM week_rows GROUP BY "商品ID", "榜单类型"
          )
          INSERT INTO "商品榜单统计表" (
            "商品ID", "榜单类型", "最新类目名称", "最新一级类目", "最新二级类目",
            "首次上榜日期", "最近上榜日期", "最近上榜结束日期", "最近行业排名",
            "历史上榜周数", "历史记录条数", "连续上榜周数",
            "最新访客数原值", "最新访客数下限", "最新访客数上限", "最新访客数中值",
            "最新支付买家数原值", "最新支付买家数下限", "最新支付买家数上限", "最新支付买家数中值", "更新时间"
          )
          SELECT
            l."商品ID", l."榜单类型", l."类目名称", l."一级类目", l."二级类目",
            c.first_week, l."周开始日期", l."周结束日期", l."行业排名",
            c.week_count, c.record_count, COALESCE(s.streak_count, 0),
            l."访客数原值", l."访客数下限", l."访客数上限", l."访客数中值",
            l."支付买家数原值", l."支付买家数下限", l."支付买家数上限", l."支付买家数中值", now()
          FROM latest l
          JOIN counts c ON c."商品ID" = l."商品ID" AND c."榜单类型" = l."榜单类型"
          LEFT JOIN streak s ON s."商品ID" = l."商品ID" AND s."榜单类型" = l."榜单类型"
          ON CONFLICT ("商品ID", "榜单类型") DO UPDATE SET
            "最新类目名称" = EXCLUDED."最新类目名称",
            "最新一级类目" = EXCLUDED."最新一级类目",
            "最新二级类目" = EXCLUDED."最新二级类目",
            "首次上榜日期" = EXCLUDED."首次上榜日期",
            "最近上榜日期" = EXCLUDED."最近上榜日期",
            "最近上榜结束日期" = EXCLUDED."最近上榜结束日期",
            "最近行业排名" = EXCLUDED."最近行业排名",
            "历史上榜周数" = EXCLUDED."历史上榜周数",
            "历史记录条数" = EXCLUDED."历史记录条数",
            "连续上榜周数" = EXCLUDED."连续上榜周数",
            "最新访客数原值" = EXCLUDED."最新访客数原值",
            "最新访客数下限" = EXCLUDED."最新访客数下限",
            "最新访客数上限" = EXCLUDED."最新访客数上限",
            "最新访客数中值" = EXCLUDED."最新访客数中值",
            "最新支付买家数原值" = EXCLUDED."最新支付买家数原值",
            "最新支付买家数下限" = EXCLUDED."最新支付买家数下限",
            "最新支付买家数上限" = EXCLUDED."最新支付买家数上限",
            "最新支付买家数中值" = EXCLUDED."最新支付买家数中值",
            "更新时间" = now()
        `);
      }

      for (const file of batch.files) {
        if (file.status === "DUPLICATE") continue;
        const errors = fileErrors.get(file.id) ?? [];
        const validCount = fileValidCounts.get(file.id) ?? 0;
        const duplicateCount = fileDuplicateCounts.get(file.id) ?? 0;
        await this.prisma.importFile.update({ where: { id: file.id }, data: {
          status: validCount || duplicateCount ? "COMPLETED" : "FAILED",
          importedCount: fileImportedCounts.get(file.id) ?? 0,
          errorCount: fileErrorCounts.get(file.id) ?? errors.length,
          errorsJson: JSON.stringify({ parseError: null, errors: errors.slice(0, 200), duplicateRows: duplicateCount }),
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
