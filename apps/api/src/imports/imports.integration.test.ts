import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient, type ImportBatch } from "@prisma/client";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { upsertHistories } from "./history-upsert";
import { productMetadataQuery } from "./product-metadata";
import { ImportsService } from "./imports.service";
import { AdminService } from "../admin/admin.service";
import { CategoriesService } from "../categories/categories.service";
import { buildCategoryRegistryRows } from "./category-registry";
import { SearchTrendsService } from "../search-trends/search-trends.service";

const databaseUrl = process.env.SELECTION_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/\/(selection_review|selection_test)$/.test(url.pathname)) {
    throw new Error("Integration tests require an explicitly named, isolated local review/test database.");
  }
}
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null;
after(async () => { await prisma?.$disconnect(); });
const integration = (name: string, run: () => Promise<void>) => test(name, { skip: !prisma }, run);
const unique = () => randomBytes(10).toString("hex");

async function sourceFiles() {
  return prisma!.importBatch.create({ data: { files: { create: ["old", "new"].map((name) => ({
    originalName: name, sha256: "a".repeat(64), fileSize: 0n, storagePath: "integration-fixture",
  })) } }, include: { files: true } });
}

function productRow(productId: string, fileId: string, exportTime: string | null, buyer = "100") {
  return {
    productId, boardType: "NEW_PRODUCT_TRAFFIC", weekStart: "2026-11-23", weekEnd: "2026-11-29",
    rawPeriod: "2026-11-23~2026-11-29", categoryName: "测试 / 杯子", categoryLevel1: "测试", categoryLevel2: "杯子",
    exportTime, sourceFileId: fileId, sourceFileName: "fixture.xlsx", sourceRowNumber: 2,
    buyerRaw: buyer, buyerMin: Number(buyer), buyerMax: Number(buyer), buyerMedian: Number(buyer),
  };
}

integration("PostgreSQL：并发创建、更新商品历史始终保留最新导出时间，统计来自实际写入结果", async () => {
  const source = await sourceFiles();
  const productId = `review-${unique()}`;
  try {
    await prisma!.product.create({ data: { productId, productName: "fixture" } });
    const older = productRow(productId, source.files[0].id, "2026-11-24T09:00:00Z", "100");
    const newer = productRow(productId, source.files[1].id, "2026-11-24T12:00:00Z", "200");
    const results = await Promise.all([upsertHistories(prisma!, "product", [newer]), upsertHistories(prisma!, "product", [older])]);
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
    assert.equal((await prisma!.productHistory.findFirstOrThrow({ where: { productId } })).buyerRaw, "200");
    const update = await upsertHistories(prisma!, "product", [{ ...newer, buyerRaw: "300", exportTime: "2026-11-24T14:00:00Z" }]);
    assert.equal(update.updated, 1);
    assert.equal(update.fileCounts.get(source.files[1].id), 1);
    const duplicate = await upsertHistories(prisma!, "product", [{ ...older, exportTime: null }]);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(duplicate.fileCounts.size, 0);
    assert.equal((await prisma!.productHistory.findFirstOrThrow({ where: { productId } })).buyerRaw, "300");
  } finally {
    await prisma!.product.deleteMany({ where: { productId } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});

integration("PostgreSQL：搜索历史冲突原子比较时间，缺失导出时间不会覆盖已有值", async () => {
  const source = await sourceFiles();
  const searchTerm = `review-${unique()}`;
  try {
    const row = { searchTerm, categoryName: "测试", categoryLevel1: "测试", categoryLevel2: "无二级类目", searchTermType: "核心词", boardType: "热搜榜", dimension: "日", searchDate: "2026-11-23", searchPeopleRaw: "100", sourceFileId: source.files[0].id, exportTime: null };
    await upsertHistories(prisma!, "search", [row]);
    const older = { ...row, searchPeopleRaw: "200", exportTime: "2026-11-24T09:00:00Z" };
    const newer = { ...row, sourceFileId: source.files[1].id, searchPeopleRaw: "300", exportTime: "2026-11-24T12:00:00Z" };
    await Promise.all([upsertHistories(prisma!, "search", [newer]), upsertHistories(prisma!, "search", [older])]);
    assert.equal((await prisma!.searchTermHistory.findFirstOrThrow({ where: { searchTerm } })).searchPeopleRaw, "300");
    assert.equal((await upsertHistories(prisma!, "search", [row])).duplicates, 1);
  } finally {
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});

integration("PostgreSQL：主表最近上榜日期为空时，补导旧周或同周旧导出仍不能覆盖商品资料", async () => {
  const source = await sourceFiles();
  const productId = `review-${unique()}`;
  try {
    await prisma!.product.create({ data: { productId, productName: "最新商品" } });
    await upsertHistories(prisma!, "product", [productRow(productId, source.files[0].id, "2026-11-24T12:00:00Z")]);
    const metadata = (week: string, exported: string | null, name: string) => JSON.stringify([{
      商品ID: productId, 商品名称: name, 商品链接: null, 店铺名称: null, 店铺类型: null, 商品图片链接: null,
      上架日期: null, 周开始日期: week, 导出时间: exported,
    }]);
    for (const [week, exported] of [["2026-11-16", "2026-11-25T12:00:00Z"], ["2026-11-23", "2026-11-24T09:00:00Z"], ["2026-11-23", null]]) {
      assert.equal(await prisma!.$executeRaw(productMetadataQuery(metadata(week!, exported, "旧商品"))), 0);
    }
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { productId } })).productName, "最新商品");
    assert.equal(await prisma!.$executeRaw(productMetadataQuery(metadata("2026-11-23", "2026-11-24T14:00:00Z", "更新商品"))), 1);
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { productId } })).productName, "更新商品");
  } finally {
    await prisma!.product.deleteMany({ where: { productId } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});

integration("PostgreSQL：禁止管理员自停用，并发降级时保留最后一个有效超级管理员", async () => {
  const prefix = unique();
  const service = new AdminService(prisma as never, {} as never);
  const users = await Promise.all([1, 2].map((index) => prisma!.user.create({ data: { username: `review-${prefix}-${index}`, name: "fixture", passwordHash: "fixture", role: "SUPER_ADMIN" } })));
  const actors = users.map((user) => ({ ...user, role: "SUPER_ADMIN" as const }));
  try {
    await assert.rejects(service.updateUser(actors[0], users[0].id, { accountStatus: "DISABLED" }), /不能停用当前登录账号/);
    const result = await Promise.allSettled([
      service.updateUser(actors[0], users[1].id, { role: "EMPLOYEE" }),
      service.updateUser(actors[1], users[0].id, { role: "EMPLOYEE" }),
    ]);
    assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(await prisma!.user.count({ where: { id: { in: users.map((user) => user.id) }, role: "SUPER_ADMIN", accountStatus: "ACTIVE", employmentStatus: "ACTIVE" } }), 1);
  } finally { await prisma!.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }); }
});

integration("PostgreSQL：搜索词、排名和人数均相同时，不同类目的分页仍稳定且不重复", async () => {
  const source = await sourceFiles();
  const searchTerm = `review-${unique()}`;
  try {
    const rows = Array.from({ length: 15 }, (_, index) => ({
      searchTerm, categoryName: `review-category-${String(index).padStart(2, "0")}`, categoryLevel1: `review-category-${String(index).padStart(2, "0")}`, categoryLevel2: "无二级类目", searchTermType: "核心词", boardType: "热搜榜", dimension: "日",
      searchDate: "2026-11-23", searchPeopleRaw: "100", searchPeopleMedian: 100, rank: 1, sourceFileId: source.files[0].id,
    }));
    await upsertHistories(prisma!, "search", rows);
    const service = new SearchTrendsService(prisma as never);
    for (const sortBy of ["latestRank", "growthRate"]) {
      const filters = { startDate: "2026-11-23", endDate: "2026-11-23", keyword: searchTerm, sortBy, pageSize: 10 };
      const first = await service.list({ ...filters, page: 1 });
      const second = await service.list({ ...filters, page: 2 });
      const categories = [...first.items, ...second.items].map((item) => item.categoryName);
      assert.equal(categories.length, 15);
      assert.equal(new Set(categories).size, 15);
      assert.deepEqual(categories, rows.map((row) => row.categoryName));
    }
  } finally {
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});

integration("PostgreSQL：真实Excel预览、并发确认、后台串行入库和旧文件补导完整流程", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "selection-import-review-"));
  const productId = `107${Date.now().toString().slice(-10)}`;
  const service = new ImportsService(prisma as never);
  const batchIds: string[] = [];
  async function preview(name: string, week: string, end: string, exported: string, title: string, buyer: string) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("合并数据");
    sheet.addRow(["商品ID", "商品名称", "日期范围", "类目名称", "访客数", "支付买家数", "加购人数", "导出时间"]);
    sheet.addRow([productId, title, `${week}~${end}`, "集成测试 / 杯子", "1000", buyer, "10", exported]);
    const filePath = path.join(directory, name);
    await workbook.xlsx.writeFile(filePath);
    const result = await service.createPreview([{ path: filePath, originalname: name, size: (await stat(filePath)).size } as Express.Multer.File], "review-operator");
    batchIds.push(result.batchId);
    return result.batchId;
  }
  async function waitBatch(batchId: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const batch: ImportBatch = await prisma!.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.status === "COMPLETED" || batch.status === "FAILED") {
        assert.equal(batch.status, "COMPLETED", batch.errorSummary ?? "");
        return batch;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Import batch did not complete");
  }
  try {
    const newer = await preview("new.xlsx", "2026-11-23", "2026-11-29", "2026-11-24 12:00:00", "最新商品", "200");
    const older = await preview("old.xlsx", "2026-11-23", "2026-11-29", "2026-11-24 09:00:00", "旧商品", "100");
    const confirms = await Promise.allSettled([service.confirm(newer), service.confirm(newer)]);
    assert.equal(confirms.filter((entry) => entry.status === "fulfilled").length, 1);
    await service.confirm(older);
    await Promise.all([waitBatch(newer), waitBatch(older)]);
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { productId } })).productName, "最新商品");
    assert.equal((await prisma!.productHistory.findFirstOrThrow({ where: { productId } })).buyerRaw, "200");
    const priorWeek = await preview("prior.xlsx", "2026-11-16", "2026-11-22", "2026-11-25 12:00:00", "更早商品", "50");
    await service.confirm(priorWeek);
    await waitBatch(priorWeek);
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { productId } })).productName, "最新商品");
    const stats = await prisma!.productBoardStats.findUniqueOrThrow({ where: { productId_boardType: { productId, boardType: "NEW_PRODUCT_TRAFFIC" } } });
    assert.equal(stats.historyWeekCount, 2);
    assert.equal(Number(stats.latestBuyerMedian), 200);
    assert.equal((await prisma!.importBatch.findUniqueOrThrow({ where: { id: older } })).duplicateRows, 1);
  } finally {
    service.onModuleDestroy();
    await prisma!.product.deleteMany({ where: { productId } });
    await prisma!.importBatch.deleteMany({ where: { id: { in: batchIds } } });
    const relative = path.relative(tmpdir(), directory);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) await rm(directory, { recursive: true, force: true });
  }
});

integration("PostgreSQL：搜索Excel拆分层级并保存，父级数据只计入无二级类目，同日不同原文不重复计天", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "selection-search-levels-"));
  const level1 = `搜索层级测试-${unique()}`;
  const term = `搜索词-${unique()}`;
  const service = new ImportsService(prisma as never);
  let batchId: string | undefined;
  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (now.getUTCDay() + 6) % 7 - 7));
  try {
    await prisma!.category.createMany({ data: buildCategoryRegistryRows([
      { categoryName: `${level1} / 未导入子类`, categoryLevel1: level1, categoryLevel2: "未导入子类" },
    ]), skipDuplicates: true });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("搜索排行");
    sheet.addRow(["日期范围", "维度", "类目", "搜索词类型", "榜单类型", "搜索词", "搜索人数", "导出时间"]);
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(weekStart.getTime() + day * 86_400_000).toISOString().slice(0, 10);
      const add = (category: string) => sheet.addRow([`${date}|${date}`, "日", category, "核心词", "热搜榜", term, "100", "2026-11-24 12:00:00"]);
      add(level1);
      if (day < 2) add(`${level1} / 家庭整理用具`);
      if (day === 0) add(`${level1}/家庭整理用具`);
    }
    const filePath = path.join(directory, "search.xlsx");
    await workbook.xlsx.writeFile(filePath);
    const preview = await service.createPreview([{ path: filePath, originalname: "search.xlsx", size: (await stat(filePath)).size } as Express.Multer.File], "review-operator", "SEARCH_BOARD");
    batchId = preview.batchId;
    assert.equal(preview.validRows, 10);
    assert.equal((preview.previewRows[0] as any).categoryLevel1, level1);
    assert.equal((preview.previewRows[0] as any).categoryLevel2, "无二级类目");
    assert.equal((preview.previewRows[1] as any).categoryLevel2, "家庭整理用具");
    await service.confirm(batchId);
    let complete = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const batch: ImportBatch = await prisma!.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.status === "FAILED") assert.fail(batch.errorSummary ?? "搜索词导入失败");
      if (batch.status === "COMPLETED") { complete = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(complete, true);
    const saved = await prisma!.searchTermHistory.findMany({ where: { searchTerm: term } });
    assert.equal(saved.length, 10);
    assert.ok(saved.every((row) => row.categoryLevel1 === level1));
    assert.equal(saved.filter((row) => row.categoryName === level1 && row.categoryLevel2 === "无二级类目").length, 7);
    const overview = await new CategoriesService(prisma as never).searchOverview();
    const parent = overview.categories.find((row) => row.categoryLevel1 === level1)!;
    const unclassified = parent.children.find((row) => row.categoryLevel2 === "无二级类目")!;
    const child = parent.children.find((row) => row.categoryLevel2 === "家庭整理用具")!;
    const missing = parent.children.find((row) => row.categoryLevel2 === "未导入子类")!;
    assert.equal(unclassified.weekCounts[11].daysWithData, 7);
    assert.equal(child.weekCounts[11].daysWithData, 2);
    assert.equal(child.weekCounts[11].recordCount, 3);
    assert.equal(missing.weekCounts[11].daysWithData, 0);
    assert.deepEqual(parent.weekProgress[11], { weekStart: weekStart.toISOString().slice(0, 10), imported: 1, total: 3, partial: 1, recordCount: 10 });
  } finally {
    service.onModuleDestroy();
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm: term } });
    await prisma!.category.deleteMany({ where: { categoryLevel1: level1 } });
    if (batchId) await prisma!.importBatch.deleteMany({ where: { id: batchId } });
    const relative = path.relative(tmpdir(), directory);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) await rm(directory, { recursive: true, force: true });
  }
});

integration("PostgreSQL：搜索趋势按一级、二级类目组合筛选，日均和对比趋势使用相同筛选", async () => {
  const source = await sourceFiles();
  const level1 = `筛选测试-${unique()}`;
  const otherLevel1 = `${level1}其他`;
  const searchTerm = `类目筛选-${unique()}`;
  const rows = [
    { categoryName: level1, categoryLevel1: level1, categoryLevel2: "无二级类目", value: 50 },
    { categoryName: `${level1} / 家庭整理用具`, categoryLevel1: level1, categoryLevel2: "家庭整理用具", value: 100 },
    { categoryName: `${otherLevel1} / 家庭整理用具`, categoryLevel1: otherLevel1, categoryLevel2: "家庭整理用具", value: 400 },
  ];
  try {
    await upsertHistories(prisma!, "search", rows.flatMap((row) => ["2026-09-01", "2026-10-01"].map((date, index) => ({
      ...row, searchTerm, searchTermType: "核心词", boardType: "热搜榜", dimension: "日", searchDate: date,
      searchPeopleRaw: String(row.value * (index + 1)), searchPeopleMedian: row.value * (index + 1), sourceFileId: source.files[0].id,
    }))));
    const service = new SearchTrendsService(prisma as never);
    const filters = { startDate: "2026-10-01", endDate: "2026-10-01", keyword: searchTerm };
    const parent = await service.list({ ...filters, categoryLevel1: level1 });
    assert.equal(parent.total, 2);
    const child = await service.list({ ...filters, categoryLevel1: [level1], categoryLevel2: ["家庭整理用具"] });
    assert.equal(child.total, 1);
    assert.equal(child.items[0].categoryName, `${level1} / 家庭整理用具`);
    assert.equal(child.items[0].previousDailyAverage, 100);
    assert.equal(child.items[0].currentDailyAverage, 200);
    assert.equal(child.items[0].growthRate, 100);
    assert.equal(child.items[0].trend[0].comparisonMedian, 100);
    assert.equal(child.items[0].trend[0].median, 200);
    const unclassified = await service.list({ ...filters, categoryLevel1: level1, categoryLevel2: "无二级类目" });
    assert.equal(unclassified.total, 1);
    assert.equal(unclassified.items[0].categoryName, level1);
    const multi = await service.list({ ...filters, categoryLevel1: `${level1},${otherLevel1}`, categoryLevel2: "家庭整理用具" });
    assert.equal(multi.total, 2);
    const missing = await service.list({ ...filters, categoryLevel1: level1, categoryLevel2: "不存在的二级类目" });
    assert.equal(missing.total, 0);
    const options = await service.options();
    assert.deepEqual(options.categoryLevels.filter((item) => item.categoryLevel1 === level1).map((item) => item.categoryLevel2).sort(), ["家庭整理用具", "无二级类目"].sort());
    assert.ok(options.categoryLevels.some((item) => item.categoryLevel1 === otherLevel1 && item.categoryLevel2 === "家庭整理用具"));
  } finally {
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});
