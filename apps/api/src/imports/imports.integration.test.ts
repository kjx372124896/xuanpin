import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient, type ImportBatch, type User } from "@prisma/client";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

integration("PostgreSQL：归档旧斜杠拆分的空类目，保留真实分支、手工类目和负责人", async () => {
  const migration = await readFile(path.resolve(__dirname, "../../../../prisma/migrations/20261126160000_archive_legacy_category_nodes/migration.sql"), "utf8");
  const statements = migration.replace(/^BEGIN;|^COMMIT;/gm, "").split(";").map((sql) => sql.trim()).filter(Boolean);
  await prisma!.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "商品上榜历史表" (
      "类目名称" TEXT, "一级类目" TEXT
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "搜索词日历史表" (
      "类目" TEXT, "一级类目" TEXT
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "类目表" (
      "类目ID" TEXT PRIMARY KEY, "类目名称" TEXT UNIQUE,
      "一级类目" TEXT, "二级类目" TEXT, "三级类目" TEXT,
      "负责人ID" TEXT, "是否启用" BOOLEAN, "创建时间" TIMESTAMP DEFAULT NOW(), "更新时间" TIMESTAMP DEFAULT NOW()
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "类目路径迁移异常表" (
      "来源表" TEXT, "来源记录ID" TEXT, "原始类目路径" TEXT, "异常类型" TEXT,
      "记录时间" TIMESTAMP DEFAULT NOW(), PRIMARY KEY ("来源表", "来源记录ID")
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`INSERT INTO "商品上榜历史表" VALUES
      ('家庭/个人清洁工具 / 清洁刷', '家庭/个人清洁工具'),
      ('五金/工具 / 扳手', '五金/工具'),
      ('服饰配件/皮带/帽子/围巾 / 配件', '服饰配件/皮带/帽子/围巾'),
      ('玩具/童车/益智 / 拼图', '玩具/童车/益智'),
      ('运动包/户外包/配件 / 腰包', '运动包/户外包/配件'),
      ('箱包皮具/热销女包/男包 / 手提包', '箱包皮具/热销女包/男包')`);
    await tx.$executeRawUnsafe(`INSERT INTO "搜索词日历史表" VALUES
      ('玩具', '玩具'),
      ('服饰配件/其他 / 发饰', '服饰配件/其他')`);
    await tx.$executeRawUnsafe(`INSERT INTO "类目表"
      ("类目ID", "类目名称", "一级类目", "二级类目", "三级类目", "负责人ID", "是否启用") VALUES
      ('old-family', '家庭', '家庭', NULL, NULL, 'employee-1', TRUE),
      ('old-family-none', '家庭 / 无二级类目', '家庭', '无二级类目', NULL, NULL, TRUE),
      ('new-family', '家庭/个人清洁工具', '家庭/个人清洁工具', NULL, NULL, NULL, TRUE),
      ('old-hardware', '五金', '五金', NULL, NULL, 'employee-1', TRUE),
      ('new-hardware', '五金/工具', '五金/工具', NULL, NULL, 'employee-2', FALSE),
      ('old-accessories', '服饰配件', '服饰配件', NULL, NULL, 'employee-3', TRUE),
      ('new-accessories', '服饰配件/皮带/帽子/围巾', '服饰配件/皮带/帽子/围巾', NULL, NULL, NULL, TRUE),
      ('new-accessories-other', '服饰配件/其他', '服饰配件/其他', NULL, NULL, NULL, TRUE),
      ('real-toys', '玩具', '玩具', NULL, NULL, 'employee-4', TRUE),
      ('new-toys', '玩具/童车/益智', '玩具/童车/益智', NULL, NULL, NULL, TRUE),
      ('manual-sports-root', '运动包', '运动包', NULL, NULL, NULL, TRUE),
      ('manual-sports-child', '运动包 / 手工分类', '运动包', '手工分类', NULL, NULL, TRUE),
      ('new-sports', '运动包/户外包/配件', '运动包/户外包/配件', NULL, NULL, NULL, TRUE),
      ('manual-bags-root', '箱包皮具', '箱包皮具', NULL, NULL, NULL, TRUE),
      ('manual-bags-child', '箱包皮具 / 已停用分类', '箱包皮具', '已停用分类', NULL, NULL, FALSE),
      ('new-bags', '箱包皮具/热销女包/男包', '箱包皮具/热销女包/男包', NULL, NULL, NULL, TRUE),
      ('manual-empty', '手工空类目', '手工空类目', NULL, NULL, NULL, TRUE)`);

    for (const sql of statements) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRawUnsafe<Array<{ name: string; owner: string | null; enabled: boolean }>>(`
      SELECT "类目名称" AS name, "负责人ID" AS owner, "是否启用" AS enabled FROM "类目表"
    `);
    for (const name of ["家庭", "家庭 / 无二级类目", "五金", "服饰配件"]) {
      assert.equal(rows.some((row) => row.name === name), false, name);
    }
    for (const name of ["玩具", "运动包", "运动包 / 手工分类", "箱包皮具", "箱包皮具 / 已停用分类", "手工空类目"]) {
      assert.ok(rows.some((row) => row.name === name), name);
    }
    assert.deepEqual(rows.find((row) => row.name === "家庭/个人清洁工具"), {
      name: "家庭/个人清洁工具", owner: "employee-1", enabled: true,
    });
    assert.deepEqual(rows.find((row) => row.name === "五金/工具"), {
      name: "五金/工具", owner: "employee-2", enabled: false,
    });
    assert.equal(rows.find((row) => row.name === "服饰配件/皮带/帽子/围巾")?.owner, "employee-3");
    assert.equal(rows.find((row) => row.name === "服饰配件/其他")?.owner, "employee-3");
    const archived = await tx.$queryRawUnsafe<Array<{ sourceData: { 负责人ID: string | null; 是否启用: boolean } }>>(`
      SELECT "原始记录" AS "sourceData" FROM "类目路径迁移异常表"
    `);
    assert.equal(archived.length, 4);
    assert.ok(archived.some((row) => row.sourceData.负责人ID === "employee-1" && row.sourceData.是否启用));
    assert.deepEqual(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "商品上榜历史表"`), [{ count: 6 }]);
    assert.deepEqual(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "搜索词日历史表"`), [{ count: 2 }]);

    // A later import may legitimately use a previously obsolete first-level name again.
    await tx.$executeRawUnsafe(`INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "是否启用")
      VALUES ('reimport-family', '家庭', '家庭', TRUE)`);
    assert.deepEqual(await tx.$queryRawUnsafe(`SELECT "是否启用" AS enabled FROM "类目表" WHERE "类目名称" = '家庭'`), [{ enabled: true }]);
  });
});

integration("PostgreSQL：三级迁移合并空格不同的缺省节点，并保留已有负责人和启用状态", async () => {
  const migration = await readFile(path.resolve(__dirname, "../../../../prisma/migrations/20261126100000_three_level_categories/migration.sql"), "utf8");
  const start = migration.indexOf("WITH third_levels AS (");
  const end = migration.indexOf("-- Refresh the latest category snapshots", start);
  assert.ok(start >= 0 && end > start);
  const query = migration.slice(start, end);

  await prisma!.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "商品上榜历史表" (
      "类目名称" TEXT, "一级类目" TEXT, "二级类目" TEXT, "三级类目" TEXT
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "搜索词日历史表" (
      "类目" TEXT, "一级类目" TEXT, "二级类目" TEXT, "三级类目" TEXT
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "类目表" (
      "类目ID" TEXT PRIMARY KEY, "类目名称" TEXT UNIQUE,
      "一级类目" TEXT, "二级类目" TEXT, "三级类目" TEXT,
      "负责人ID" TEXT, "是否启用" BOOLEAN, "创建时间" TIMESTAMP, "更新时间" TIMESTAMP
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`INSERT INTO "商品上榜历史表" VALUES
      ('餐饮具 / 杯子', '餐饮具', '杯子', '无三级类目'),
      ('餐饮具  /  杯子', '餐饮具', '杯子', '无三级类目'),
      ('餐饮具 / 杯子 / 奶杯', '餐饮具', '杯子', '奶杯')`);
    await tx.$executeRawUnsafe(`INSERT INTO "搜索词日历史表" VALUES
      ('餐饮具   /   杯子', '餐饮具', '杯子', '无三级类目')`);
    await tx.$executeRawUnsafe(`INSERT INTO "类目表" VALUES
      ('existing-node', '餐饮具 / 杯子 / 无三级类目', '餐饮具', '杯子', '无三级类目', 'employee-1', FALSE, NOW(), NOW())`);

    assert.equal(await tx.$executeRawUnsafe(query), 2);
    assert.equal(await tx.$executeRawUnsafe(query), 2);
    const rows = await tx.$queryRawUnsafe<Array<{ name: string; owner: string | null; enabled: boolean }>>(`
      SELECT "类目名称" AS name, "负责人ID" AS owner, "是否启用" AS enabled
      FROM "类目表" ORDER BY "类目名称"
    `);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((row) => row.name === "餐饮具 / 杯子 / 奶杯"));
    assert.deepEqual(rows.find((row) => row.name === "餐饮具 / 杯子 / 无三级类目"), {
      name: "餐饮具 / 杯子 / 无三级类目", owner: "employee-1", enabled: false,
    });
  });
});

integration("PostgreSQL：搜索词收藏隔离账号和分组，成员筛选、计数分页及幂等取消保持一致", async () => {
  const prefix = `favorite-${unique()}`;
  const userIds: string[] = [];
  try {
    const users: User[] = [];
    for (const [index, role] of ["EMPLOYEE", "EMPLOYEE", "ADMIN", "ADMIN"].entries()) {
      const user = await prisma!.user.create({ data: {
        username: `${prefix}-${index}`, passwordHash: "integration-fixture", name: `${prefix}-成员${index}`,
        department: `${prefix}-部门${index}`, role: role as "EMPLOYEE" | "ADMIN",
      } });
      users.push(user);
      userIds.push(user.id);
    }
    const identities = Array.from({ length: 12 }, (_, index) => ({
      searchTerm: `${prefix}-${index}`, categoryName: "收藏测试类目", searchTermType: "核心词", boardType: "热搜榜", dimension: "日",
    }));
    const otherCategory = { ...identities[0], categoryName: "另一个类目" };
    const otherAdminOnly = { ...identities[0], searchTerm: `${prefix}-other-admin` };
    await prisma!.searchTermHistory.createMany({ data: [...identities, otherCategory, otherAdminOnly].flatMap((identity, index) => Array.from({ length: 4 }, (_, day) => ({
      ...identity, categoryLevel1: identity.categoryName, categoryLevel2: "无二级类目",
      searchDate: new Date(Date.UTC(2026, 9, 28 + day)), rank: index + 1, searchPeopleMedian: 100,
    }))) });
    const service = new SearchTrendsService(prisma as never);
    for (const identity of identities) await service.favorite(users[0].id, identity);
    await service.favorite(users[0].id, identities[0]);
    await service.favorite(users[1].id, identities[0]);
    await service.favorite(users[2].id, identities[1]);
    await service.favorite(users[3].id, otherAdminOnly);
    const filters = { startDate: "2026-10-01", endDate: "2026-10-31", keyword: prefix, pageSize: 10 };
    const mine = await service.list({ ...filters, favoritesOnly: true }, { userId: users[0].id });
    assert.equal(mine.total, 12);
    assert.equal(mine.items.length, 10);
    assert.ok(mine.items.every((item) => item.isFavorited && item.categoryName === identities[0].categoryName));
    const second = await service.list({ ...filters, favoritesOnly: true, page: 2 }, { userId: users[0].id });
    assert.equal(second.total, 12);
    assert.equal(second.items.length, 2);
    const anotherMember = await service.list({ ...filters, favoritesOnly: true }, { userId: users[1].id });
    assert.equal(anotherMember.total, 1);
    const viewer = { userId: users[2].id, teamFavorites: true };
    const team = await service.list({ ...filters, pageSize: 50 }, viewer);
    assert.equal(team.total, 12);
    assert.equal(team.items[0].favoriteCount, 2);
    assert.equal(team.items[0].isFavorited, false);
    assert.equal(team.items[1].isFavorited, true);
    assert.ok(team.items[0].favoriteUsers?.some((user) => user.userId === users[1].id));
    const member = await service.list(filters, { ...viewer, memberKeyword: users[1].department! });
    assert.equal(member.total, 1);
    assert.equal(member.items[0].favoriteCount, 1);
    assert.equal(member.items[0].favoriteUsers?.[0].userId, users[1].id);
    await service.unfavorite(users[0].id, identities[0]);
    await service.unfavorite(users[0].id, identities[0]);
    assert.equal((await service.list({ ...filters, favoritesOnly: true }, { userId: users[0].id })).total, 11);
    assert.equal((await service.list(filters, viewer)).total, 12);
    await service.unfavorite(users[1].id, identities[0]);
    assert.equal((await service.list(filters, viewer)).total, 11);
  } finally {
    await prisma!.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm: { startsWith: prefix } } });
  }
});

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
    await upsertHistories(prisma!, "search", rows.flatMap((row) => Array.from({ length: 4 }, (_, day) => ({
      ...row, searchDate: `2026-11-${23 + day}`,
    }))));
    const service = new SearchTrendsService(prisma as never);
    for (const sortBy of ["latestRank", "growthRate"]) {
      const filters = { startDate: "2026-11-23", endDate: "2026-11-26", keyword: searchTerm, sortBy, pageSize: 10 };
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
  const categoryLevel1 = `集成测试-${unique()}`;
  const service = new ImportsService(prisma as never);
  const batchIds: string[] = [];
  async function preview(name: string, week: string, end: string, exported: string, title: string, buyer: string) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("合并数据");
    sheet.addRow(["商品ID", "商品名称", "日期范围", "类目名称", "访客数", "支付买家数", "加购人数", "导出时间"]);
    sheet.addRow([productId, title, `${week}~${end}`, `${categoryLevel1} / 杯子 / 奶杯`, "1000", buyer, "10", exported]);
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
    assert.equal(stats.latestCategoryLevel3, "奶杯");
    assert.ok((await prisma!.productHistory.findMany({ where: { productId } })).every((row) => row.categoryLevel3 === "奶杯"));
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { productId } })).latestCategoryLevel3, "奶杯");
    assert.ok(await prisma!.category.findFirst({ where: { categoryLevel1, categoryLevel2: "杯子", categoryLevel3: "奶杯" } }));
    assert.equal((await prisma!.importBatch.findUniqueOrThrow({ where: { id: older } })).duplicateRows, 1);
  } finally {
    service.onModuleDestroy();
    await prisma!.product.deleteMany({ where: { productId } });
    await prisma!.importBatch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma!.category.deleteMany({ where: { categoryLevel1 } });
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
      { categoryName: `${level1} / 未导入子类`, categoryLevel1: level1, categoryLevel2: "未导入子类", categoryLevel3: "无三级类目" },
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
    assert.ok(saved.every((row) => row.categoryLevel1 === level1 || row.categoryLevel1 === `${level1}/家庭整理用具`));
    assert.equal(saved.filter((row) => row.categoryLevel1 === `${level1}/家庭整理用具` && row.categoryLevel2 === "无二级类目").length, 1);
    assert.equal(saved.filter((row) => row.categoryName === level1 && row.categoryLevel2 === "无二级类目").length, 7);
    const categoryService = new CategoriesService(prisma as never);
    const overview = await categoryService.searchOverview("核心词");
    const parent = overview.categories.find((row) => row.categoryLevel1 === level1)!;
    const unclassified = parent.children.find((row) => row.categoryLevel2 === "无二级类目")!;
    const child = parent.children.find((row) => row.categoryLevel2 === "家庭整理用具")!;
    const missing = parent.children.find((row) => row.categoryLevel2 === "未导入子类")!;
    assert.equal(unclassified.weekCounts[11].daysWithData, 7);
    assert.equal(child.weekCounts[11].daysWithData, 2);
    assert.equal(child.weekCounts[11].recordCount, 2);
    assert.equal(missing.weekCounts[11].daysWithData, 0);
    assert.deepEqual(parent.weekProgress[11], { weekStart: weekStart.toISOString().slice(0, 10), imported: 1, total: 3, partial: 1, recordCount: 9 });
    await prisma!.searchTermHistory.createMany({ data: Array.from({ length: 3 }, (_, day) => ({
      searchTerm: term, categoryName: level1, categoryLevel1: level1, categoryLevel2: "无二级类目",
      searchTermType: "搜索词", boardType: "热搜榜", dimension: "日",
      searchDate: new Date(weekStart.getTime() + day * 24 * 60 * 60 * 1000), searchPeopleMedian: 100,
    })) });
    const searchOverview = await categoryService.searchOverview("搜索词");
    const searchParent = searchOverview.categories.find((row) => row.categoryLevel1 === level1)!;
    const searchUnclassified = searchParent.children.find((row) => row.categoryLevel2 === "无二级类目")!;
    assert.equal(searchUnclassified.weekCounts[11].daysWithData, 3);
    assert.equal(searchUnclassified.weekCounts[11].recordCount, 3);
    assert.equal(searchParent.weekProgress[11].imported, 0);
    const coreOverview = await categoryService.searchOverview("核心词");
    const coreParent = coreOverview.categories.find((row) => row.categoryLevel1 === level1)!;
    assert.deepEqual(coreParent.weekProgress[11], parent.weekProgress[11]);
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
    { categoryName: `${level1} / 家庭整理用具 / 衣柜/抽屉收纳`, categoryLevel1: level1, categoryLevel2: "家庭整理用具", categoryLevel3: "衣柜/抽屉收纳", value: 100 },
    { categoryName: `${otherLevel1} / 家庭整理用具`, categoryLevel1: otherLevel1, categoryLevel2: "家庭整理用具", value: 400 },
  ];
  try {
    await upsertHistories(prisma!, "search", rows.flatMap((row) => ["2026-09-01", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date, index) => ({
      ...row, searchTerm, searchTermType: "核心词", boardType: "热搜榜", dimension: "日", searchDate: date,
      searchPeopleRaw: String(row.value * (index === 0 ? 1 : 2)), searchPeopleMedian: row.value * (index === 0 ? 1 : 2), sourceFileId: source.files[0].id,
    }))));
    const service = new SearchTrendsService(prisma as never);
    const filters = { startDate: "2026-10-01", endDate: "2026-10-04", keyword: searchTerm };
    const parent = await service.list({ ...filters, categoryLevel1: level1 });
    assert.equal(parent.total, 2);
    const child = await service.list({ ...filters, categoryLevel1: [level1], categoryLevel2: ["家庭整理用具"] });
    assert.equal(child.total, 1);
    assert.equal(child.items[0].categoryName, `${level1} / 家庭整理用具 / 衣柜/抽屉收纳`);
    assert.deepEqual([child.items[0].categoryLevel1, child.items[0].categoryLevel2, child.items[0].categoryLevel3], [level1, "家庭整理用具", "衣柜/抽屉收纳"]);
    assert.equal(child.items[0].previousDailyAverage, 100);
    assert.equal(child.items[0].currentDailyAverage, 200);
    assert.equal(child.items[0].growthRate, 100);
    assert.equal(child.items[0].trend[0].comparisonMedian, 100);
    assert.equal(child.items[0].trend[0].median, 200);
    const unclassified = await service.list({ ...filters, categoryLevel1: level1, categoryLevel2: "无二级类目" });
    assert.equal(unclassified.total, 1);
    assert.equal(unclassified.items[0].categoryName, level1);
    assert.deepEqual([unclassified.items[0].categoryLevel1, unclassified.items[0].categoryLevel2, unclassified.items[0].categoryLevel3], [level1, "无二级类目", "无三级类目"]);
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

integration("PostgreSQL：搜索趋势排除当期有效0至3天，保留4天，空值和对比期不计入且分页总数一致", async () => {
  const prefix = `effective-days-${unique()}`;
  const identity = (name: string) => ({
    searchTerm: `${prefix}-${name}`, categoryName: "有效天数测试", categoryLevel1: "有效天数测试",
    categoryLevel2: "无二级类目",
    searchTermType: "核心词", boardType: "热搜榜", dimension: "日",
  });
  try {
    // 每个词当期都有4条记录，只有中值非空的日期才计入有效天数；0也是有效数值。
    await prisma!.searchTermHistory.createMany({ data: [
      ...Array.from({ length: 4 }, (_, validDays) => Array.from({ length: 4 }, (_, day) => ({
        ...identity(`excluded-${validDays}`), searchDate: new Date(Date.UTC(2026, 9, day + 1)),
        rank: 1, searchPeopleMedian: day < validDays ? 100 : null,
      }))).flat(),
      ...Array.from({ length: 4 }, (_, validDays) => Array.from({ length: 7 }, (_, day) => ({
        ...identity(`excluded-${validDays}`), searchDate: new Date(Date.UTC(2026, 8, day + 1)), searchPeopleMedian: 100,
      }))).flat(),
      ...Array.from({ length: 12 }, (_, index) => Array.from({ length: 4 }, (_, day) => ({
        ...identity(`included-${String(index).padStart(2, "0")}`), searchDate: new Date(Date.UTC(2026, 9, day + 1)),
        rank: index + 10, searchPeopleMedian: index === 0 ? 0 : 100,
      }))).flat(),
    ] });
    const service = new SearchTrendsService(prisma as never);
    const filters = { startDate: "2026-10-01", endDate: "2026-10-07", keyword: prefix, pageSize: 10 };
    const first = await service.list(filters);
    const second = await service.list({ ...filters, page: 2 });
    assert.equal(first.total, 12);
    assert.equal(second.total, 12);
    assert.equal(first.totalPages, 2);
    assert.equal(first.items.length, 10);
    assert.equal(second.items.length, 2);
    const items = [...first.items, ...second.items];
    assert.equal(new Set(items.map((item) => item.searchTerm)).size, 12);
    assert.ok(items.every((item) => item.searchTerm.includes("included-") && item.currentDaysWithData === 4));
    assert.equal(first.items[0].currentDailyAverage, 0);
    const shortPeriod = await service.list({ ...filters, endDate: "2026-10-03" });
    assert.equal(shortPeriod.total, 0);
    assert.deepEqual(shortPeriod.items, []);
  } finally {
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm: { startsWith: prefix } } });
  }
});

integration("PostgreSQL：对比期缺失的正数搜索词按100%展示、筛选和排序，正常增长率不受影响", async () => {
  const source = await sourceFiles();
  const prefix = `growth-${unique()}`;
  const row = (name: string, searchDate: string, value: number) => ({
    searchTerm: `${prefix}-${name}`, categoryName: "增长率测试", categoryLevel1: "增长率测试", categoryLevel2: "无二级类目",
    searchTermType: "核心词", boardType: "热搜榜", dimension: "日", searchDate,
    searchPeopleRaw: String(value), searchPeopleMedian: value, sourceFileId: source.files[0].id,
  });
  try {
    await upsertHistories(prisma!, "search", [
      ...["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date) => row("new", date, 50_925)),
      row("normal", "2026-09-01", 100), row("high", "2026-09-01", 100), row("previous-zero", "2026-09-01", 0),
      ...["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].flatMap((date) => [
        row("normal", date, 150), row("high", date, 250), row("empty-zero", date, 0), row("previous-zero", date, 10),
      ]),
    ]);
    const service = new SearchTrendsService(prisma as never);
    const filters = { startDate: "2026-10-01", endDate: "2026-10-31", keyword: prefix, sortBy: "growthRate", sortOrder: "desc" };
    const all = await service.list(filters);
    assert.equal(all.total, 5);
    assert.deepEqual(all.items.map((item) => item.growthRate), [150, 100, 50, null, null]);
    const fresh = all.items.find((item) => item.searchTerm === `${prefix}-new`)!;
    assert.equal(fresh.previousDailyAverage, null);
    assert.equal(fresh.previousDaysWithData, 0);
    assert.equal(fresh.currentDailyAverage, 50_925);
    assert.equal(fresh.currentDaysWithData, 4);
    assert.equal(fresh.growthRate, 100);
    const atLeast100 = await service.list({ ...filters, minGrowthRate: 100 });
    assert.equal(atLeast100.total, 2);
    assert.deepEqual(atLeast100.items.map((item) => item.growthRate), [150, 100]);
    const above100 = await service.list({ ...filters, minGrowthRate: 101 });
    assert.equal(above100.total, 1);
    assert.equal(above100.items[0].growthRate, 150);
    const ascending = await service.list({ ...filters, sortOrder: "asc" });
    assert.deepEqual(ascending.items.map((item) => item.growthRate), [50, 100, 150, null, null]);
  } finally {
    await prisma!.searchTermHistory.deleteMany({ where: { searchTerm: { startsWith: prefix } } });
    await prisma!.importBatch.delete({ where: { id: source.id } });
  }
});
