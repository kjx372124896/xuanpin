import test from "node:test";
import assert from "node:assert/strict";
import { ProductsService } from "./products.service";

test("类目选项按当前榜单类型查询，并按一级、二级类目逐级收窄三级选项", async () => {
  const calls: Array<{ where: Record<string, unknown> }> = [];
  const prisma = {
    productHistory: {
      groupBy: async (args: { where: Record<string, unknown> }) => {
        calls.push(args);
        return [
          { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架", categoryLevel3: "调料架" },
          { categoryLevel1: "厨房用品", categoryLevel2: "调料收纳", categoryLevel3: "调料盒" },
          { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫", categoryLevel3: "防水垫" },
        ];
      },
    },
  };

  const service = new ProductsService(prisma as never);
  const result = await service.categories(["厨房用品"], ["厨房置物架"], "TRANSACTION_GROWTH");

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, ["厨房置物架", "调料收纳"]);
  assert.deepEqual(result.level3, ["调料架"]);
  assert.deepEqual(calls[0].where, { boardType: "TRANSACTION_GROWTH" });
});

test("未选择一级类目时保留当前榜单的全部一级选项且不展示二级选项", async () => {
  const prisma = {
    productHistory: {
      groupBy: async () => [
        { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架", categoryLevel3: "调料架" },
        { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫", categoryLevel3: "防水垫" },
      ],
    },
  };

  const result = await new ProductsService(prisma as never).categories(undefined, undefined, "NEW_PRODUCT_TRAFFIC");

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, []);
  assert.deepEqual(result.level3, []);
});

test("商品列表按当前榜单读取独立统计，且不向页面返回加购人数", async () => {
  let statsWhere: Record<string, unknown> | undefined;
  let historyQuery: { sql?: string } | undefined;
  const latestWeekStart = new Date("2026-11-02T00:00:00.000Z");
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        statsWhere = args.where;
        return [{
          productId: "1070000000000",
          boardType: "TRANSACTION_GROWTH",
          latestCategory: "厨房用品/厨房置物架",
          latestCategoryLevel1: "厨房用品",
          latestCategoryLevel2: "厨房置物架",
          firstWeekStart: latestWeekStart,
          latestWeekStart,
          latestWeekEnd: new Date("2026-11-08T00:00:00.000Z"),
          latestRank: 1,
          historyWeekCount: 1,
          historyRecordCount: 1,
          consecutiveWeekCount: 1,
          latestVisitorRaw: "100",
          latestVisitorMin: 100,
          latestVisitorMax: 100,
          latestVisitorMedian: 100,
          latestBuyerRaw: "10",
          latestBuyerMin: 10,
          latestBuyerMax: 10,
          latestBuyerMedian: 10,
          product: {
            productId: "1070000000000",
            productName: "测试商品",
            productUrl: null,
            shopName: "测试店铺",
            shopType: "天猫",
            imageUrl: null,
            aiPreviousSales: null,
            aiSales: null,
            aiSalesChange: null,
            aiSalesChangeRate: null,
            aiPrice: null,
            aiCategoryRank: null,
            aiSalesRank: null,
            aiFetchedAt: null,
            aiMetricsFetchedAt: null,
          },
        }];
      },
      count: async () => 1,
    },
    $queryRaw: async (query: { sql?: string }) => {
      historyQuery = query;
      return [];
    },
    productFavorite: {
      findMany: async () => [],
    },
  };

  const result = await new ProductsService(prisma as never).list({
    boardType: "TRANSACTION_GROWTH",
    userId: "user-1",
  });

  assert.equal(statsWhere?.boardType, "TRANSACTION_GROWTH");
  assert.match(historyQuery?.sql ?? "", /ROW_NUMBER\(\) OVER/);
  assert.match(historyQuery?.sql ?? "", /weekRank.*<= 12/s);
  assert.match(historyQuery?.sql ?? "", /CASE WHEN h\."二级类目"/);
  assert.match(historyQuery?.sql ?? "", /"导出时间" DESC NULLS LAST/);
  assert.equal(result.items[0].latestWeekStart, latestWeekStart.toISOString());
  assert.equal("cart" in result.items[0], false);
});

test("同一商品同一周期同时存在一级类目和真实二级类目时，列表只展示二级类目记录", async () => {
  const latestWeekStart = new Date("2026-11-02T00:00:00.000Z");
  const previousWeekStart = new Date("2026-10-26T00:00:00.000Z");
  const makeProduct = (productId: string, productName: string) => ({
    productId,
    productName,
    productUrl: null,
    shopName: "测试店铺",
    shopType: "天猫",
    imageUrl: null,
    aiPreviousSales: null,
    aiSales: null,
    aiClickRate: null,
    aiConversionRate: null,
    aiAddToCartRate: null,
    aiAddToCartCost: null,
    aiRoi: null,
    aiUnitPrice: null,
    aiSpend: null,
    aiCpc: null,
  });
  const makeStats = (productId: string, productName: string, latestWeek: Date) => ({
    productId,
    boardType: "TRANSACTION_GROWTH",
    latestCategory: "餐饮具",
    latestCategoryLevel1: "餐饮具",
    latestCategoryLevel2: "无二级类目",
    firstWeekStart: previousWeekStart,
    latestWeekStart: latestWeek,
    latestWeekEnd: new Date(latestWeek.getTime() + 6 * 24 * 60 * 60 * 1000),
    latestRank: 1,
    historyWeekCount: 2,
    historyRecordCount: 3,
    consecutiveWeekCount: 2,
    latestVisitorRaw: "100",
    latestVisitorMin: 100,
    latestVisitorMax: 100,
    latestVisitorMedian: 100,
    latestBuyerRaw: "20",
    latestBuyerMin: 20,
    latestBuyerMax: 20,
    latestBuyerMedian: 20,
    product: makeProduct(productId, productName),
  });
  const historyRows = [
    {
      productId: "product-a",
      weekStart: latestWeekStart,
      weekEnd: new Date("2026-11-08T00:00:00.000Z"),
      buyerRaw: "20",
      buyerMin: 20,
      buyerMax: 20,
      buyerMedian: 20,
      exportTime: new Date("2026-11-23T15:00:00.000Z"),
      importedAt: new Date("2026-11-23T15:01:00.000Z"),
      categoryName: "餐饮具",
      categoryLevel1: "餐饮具",
      categoryLevel2: "无二级类目",
    },
    {
      productId: "product-a",
      weekStart: latestWeekStart,
      weekEnd: new Date("2026-11-08T00:00:00.000Z"),
      buyerRaw: "20",
      buyerMin: 20,
      buyerMax: 20,
      buyerMedian: 20,
      exportTime: new Date("2026-11-23T14:00:00.000Z"),
      importedAt: new Date("2026-11-23T14:01:00.000Z"),
      categoryName: "餐饮具 / 咖啡杯",
      categoryLevel1: "餐饮具",
      categoryLevel2: "咖啡杯",
    },
    {
      productId: "product-b",
      weekStart: previousWeekStart,
      weekEnd: new Date("2026-11-01T00:00:00.000Z"),
      buyerRaw: "15",
      buyerMin: 15,
      buyerMax: 15,
      buyerMedian: 15,
      exportTime: new Date("2026-11-01T15:00:00.000Z"),
      importedAt: new Date("2026-11-01T15:01:00.000Z"),
      categoryName: "餐饮具 / 咖啡杯",
      categoryLevel1: "餐饮具",
      categoryLevel2: "咖啡杯",
    },
    {
      productId: "product-b",
      weekStart: latestWeekStart,
      weekEnd: new Date("2026-11-08T00:00:00.000Z"),
      buyerRaw: "20",
      buyerMin: 20,
      buyerMax: 20,
      buyerMedian: 20,
      exportTime: new Date("2026-11-23T15:00:00.000Z"),
      importedAt: new Date("2026-11-23T15:01:00.000Z"),
      categoryName: "餐饮具",
      categoryLevel1: "餐饮具",
      categoryLevel2: "无二级类目",
    },
  ];
  const prisma = {
    productBoardStats: {
      findMany: async () => [
        makeStats("product-a", "商品A", latestWeekStart),
        makeStats("product-b", "商品B", latestWeekStart),
      ],
      count: async () => 2,
    },
    $queryRaw: async () => [historyRows[1], historyRows[2], historyRows[3]],
    productFavorite: {
      findMany: async () => [],
    },
  };

  const result = await new ProductsService(prisma as never).list({
    boardType: "TRANSACTION_GROWTH",
    userId: "user-1",
  });

  const productA = result.items.find((item) => item.productId === "product-a");
  const productB = result.items.find((item) => item.productId === "product-b");
  assert.equal(result.total, 2);
  assert.equal(productA?.latestCategory, "餐饮具 / 咖啡杯");
  assert.equal(productA?.latestCategoryLevel2, "咖啡杯");
  assert.equal(productA?.buyerTrend.length, 1);
  assert.equal(productB?.latestCategoryLevel2, "无二级类目");
  assert.equal(productB?.buyerTrend.length, 2);
});

test("二级类目筛选直接使用统计表的优先二级类目，不再先查询商品ID", async () => {
  let rawQueryCount = 0;
  let statsWhere: Record<string, unknown> | undefined;
  const prisma = {
    $queryRaw: async () => {
      rawQueryCount += 1;
      return [];
    },
    productBoardStats: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        statsWhere = args.where;
        return [];
      },
      count: async () => 0,
    },
    productHistory: { findMany: async () => [] },
    productFavorite: { findMany: async () => [] },
  };

  const result = await new ProductsService(prisma as never).list({
    categoryLevel2: ["咖啡杯"],
    userId: "user-1",
  });

  assert.equal(rawQueryCount, 0);
  assert.deepEqual(statsWhere?.latestCategoryLevel2, { in: ["咖啡杯"] });
  assert.equal(result.total, 0);
});

test("上架日期筛选直接下推到商品关联条件，不再生成商品ID数组", async () => {
  let statsWhere: Record<string, unknown> | undefined;
  let rawQueryCount = 0;
  const prisma = {
    $queryRaw: async () => { rawQueryCount += 1; return []; },
    productBoardStats: {
      findMany: async (args: { where: Record<string, unknown> }) => { statsWhere = args.where; return []; },
      count: async () => 0,
    },
    productHistory: { findMany: async () => [] },
    productFavorite: { findMany: async () => [] },
  };

  await new ProductsService(prisma as never).list({
    listingDateFrom: "2026-11-01",
    listingDateTo: "2026-11-15",
    userId: "user-1",
  });

  const productWhere = statsWhere?.product as { AND: Array<Record<string, unknown>> };
  assert.deepEqual(productWhere.AND.find((condition) => "listingDate" in condition), {
    listingDate: { gte: new Date("2026-11-01T00:00:00.000Z"), lte: new Date("2026-11-15T00:00:00.000Z") },
  });
  assert.equal(rawQueryCount, 0);
});

test("选中周期的连续上榜筛选使用周期统计表关系，不回传大批商品ID", async () => {
  let statsWhere: Record<string, unknown> | undefined;
  let rawQueryCount = 0;
  const prisma = {
    $queryRaw: async () => { rawQueryCount += 1; return []; },
    productBoardStats: {
      findMany: async (args: { where: Record<string, unknown> }) => { statsWhere = args.where; return []; },
      count: async () => 0,
    },
    productHistory: { findMany: async () => [] },
    productFavorite: { findMany: async () => [] },
  };

  await new ProductsService(prisma as never).list({
    latestWeekStarts: ["2026-11-23"],
    consecutiveWeekCountMin: 2,
    consecutiveWeekCountMax: 4,
    userId: "user-1",
  });

  const productWhere = statsWhere?.product as { AND: Array<Record<string, any>> };
  const streakCondition = productWhere.AND.find((condition) => "periodStreaks" in condition);
  assert.deepEqual(streakCondition, {
    periodStreaks: {
      some: {
        boardType: "NEW_PRODUCT_TRAFFIC",
        weekStart: { in: [new Date("2026-11-23T00:00:00.000Z")] },
        consecutiveWeekCount: { gte: 2, lte: 4 },
      },
    },
  });
  assert.equal(rawQueryCount, 0);
});

test("商品列表的总数统计与列表查询串行执行，并在15秒内复用相同筛选统计", async () => {
  const calls: string[] = [];
  const prisma = {
    productBoardStats: {
      findMany: async () => { calls.push("findMany"); return []; },
      count: async () => { calls.push("count"); return 12; },
    },
    productHistory: { findMany: async () => [] },
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);

  const first = await service.list({ userId: "user-1" });
  const second = await service.list({ userId: "user-1", page: 1 });

  assert.equal(first.total, 12);
  assert.equal(second.total, 12);
  assert.deepEqual(calls, ["findMany", "count", "findMany"]);
});

test("商品列表和团队收藏查询共用并发闸门，最多同时执行两条重查询", async () => {
  let active = 0;
  let maximumActive = 0;
  const prisma = {
    productBoardStats: {
      findMany: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return [];
      },
      count: async () => 0,
    },
    productHistory: { findMany: async () => [] },
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);

  await Promise.all(Array.from({ length: 6 }, (_, index) => index % 2 === 0
    ? service.list({ userId: `user-${index}` })
    : service.teamFavorites({ adminUserId: `admin-${index}` })));

  assert.equal(maximumActive, 2);
});

test("商品列表使用 Keyset 游标和商品ID稳定排序，相同支付买家数不会跨页重复", async () => {
  const calls: Array<{ where: Record<string, any>; orderBy: unknown; take: number; skip?: number }> = [];
  const rows = Array.from({ length: 11 }, (_, index) => {
    const productId = "product-" + String(index + 1).padStart(2, "0");
    return {
      productId,
      boardType: "NEW_PRODUCT_TRAFFIC",
      latestCategory: "餐饮具",
      latestCategoryLevel1: "餐饮具",
      latestCategoryLevel2: "咖啡杯",
      firstWeekStart: new Date("2026-09-01T00:00:00.000Z"),
      latestWeekStart: new Date("2026-11-16T00:00:00.000Z"),
      latestWeekEnd: new Date("2026-11-22T00:00:00.000Z"),
      latestRank: 1,
      historyWeekCount: 12,
      historyRecordCount: 12,
      consecutiveWeekCount: 12,
      latestVisitorRaw: "100",
      latestVisitorMin: 100,
      latestVisitorMax: 100,
      latestVisitorMedian: 100,
      latestBuyerRaw: "50",
      latestBuyerMin: 50,
      latestBuyerMax: 50,
      latestBuyerMedian: 100,
      product: {
        productId,
        productName: "测试商品" + (index + 1),
        productUrl: null,
        shopName: "测试店铺",
        shopType: "天猫",
        imageUrl: null,
        listingDate: null,
        aiPreviousSales: null,
        aiSales: null,
        aiClickRate: null,
        aiConversionRate: null,
        aiAddToCartRate: null,
        aiAddToCartCost: null,
        aiRoi: null,
        aiUnitPrice: null,
        aiSpend: null,
        aiCpc: null,
      },
    };
  });
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, any>; orderBy: unknown; take: number; skip?: number }) => {
        calls.push(args);
        return calls.length === 1 ? rows : [rows[10]];
      },
      count: async () => 11,
    },
    $queryRaw: async () => [],
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);

  const first = await service.list({ userId: "user-1", page: 1, pageSize: 10 });
  assert.equal(first.items.length, 10);
  assert.equal(first.hasNextPage, true);
  assert.ok(first.nextCursor);
  assert.deepEqual(calls[0].orderBy, [
    { latestBuyerMedian: { sort: "desc", nulls: "last" } },
    { productId: "asc" },
  ]);
  assert.equal("skip" in calls[0], false);

  const cursorPayload = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
  assert.equal(cursorPayload.productId, "product-10");
  const second = await service.list({ userId: "user-1", page: 2, pageSize: 10, cursor: first.nextCursor! });

  assert.deepEqual(second.items.map((item) => item.productId), ["product-11"]);
  assert.equal(second.hasPreviousPage, true);
  assert.equal(second.hasNextPage, false);
  assert.equal(second.nextCursor, null);
  assert.equal("skip" in calls[1], false);
  const cursorCondition = calls[1].where.AND[1];
  assert.equal(cursorCondition.OR[1].productId.gt, "product-10");
  assert.equal(cursorCondition.OR[1].latestBuyerMedian.toString(), "100");
  await assert.rejects(
    service.list({ userId: "user-1", page: 2, pageSize: 10, cursor: first.nextCursor!, keyword: "条件已变化" }),
    (error: any) => error?.status === 400,
  );
  await assert.rejects(
    service.list({ userId: "user-1", page: 2, pageSize: 10, cursor: Buffer.from("null").toString("base64url") }),
    (error: any) => error?.status === 400,
  );
});

test("支付买家数为空时，Keyset 游标按 nulls last 和商品ID继续翻页", async () => {
  const calls: Array<{ where: Record<string, any> }> = [];
  const rows = Array.from({ length: 11 }, (_, index) => {
    const productId = "null-product-" + String(index + 1).padStart(2, "0");
    return { productId, latestBuyerMedian: null, product: { productId, productName: "商品" + (index + 1) } };
  });
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, any> }) => {
        calls.push(args);
        return calls.length === 1 ? rows : [rows[10]];
      },
      count: async () => 11,
    },
    $queryRaw: async () => [],
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);
  const first = await service.list({ userId: "user-1", pageSize: 10 });
  assert.ok(first.nextCursor);
  const second = await service.list({ userId: "user-1", page: 2, pageSize: 10, cursor: first.nextCursor! });

  assert.equal(second.items[0].productId, "null-product-11");
  assert.deepEqual(calls[1].where.AND[1], {
    AND: [{ latestBuyerMedian: null }, { productId: { gt: "null-product-10" } }],
  });
});

test("最近上榜日期为 NULL 时，nulls first 游标下一页仍包含非空日期", async () => {
  const calls: Array<{ where: Record<string, any> }> = [];
  const rows = Array.from({ length: 11 }, (_, index) => {
    const productId = "date-product-" + String(index + 1).padStart(2, "0");
    return {
      productId,
      latestWeekStart: index === 10 ? new Date("2026-11-16T00:00:00.000Z") : null,
      product: { productId, productName: "日期商品" + (index + 1) },
    };
  });
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, any> }) => {
        calls.push(args);
        return calls.length === 1 ? rows : [rows[10]];
      },
      count: async () => 11,
    },
    $queryRaw: async () => [],
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);
  const first = await service.list({ userId: "user-1", pageSize: 10, sort: "latestWeekStart" });
  const second = await service.list({ userId: "user-1", page: 2, pageSize: 10, sort: "latestWeekStart", cursor: first.nextCursor! });

  assert.equal(second.items[0].productId, "date-product-11");
  assert.deepEqual(calls[1].where.AND[1], {
    OR: [
      { AND: [{ latestWeekStart: null }, { productId: { gt: "date-product-10" } }] },
      { latestWeekStart: { not: null } },
    ],
  });
});

test("商品名称排序的 Keyset 游标使用商品关联字段比较并保留商品ID尾键", async () => {
  const calls: Array<{ where: Record<string, any>; orderBy: unknown }> = [];
  const rows = Array.from({ length: 11 }, (_, index) => {
    const productId = "name-product-" + String(index + 1).padStart(2, "0");
    return {
      productId,
      latestBuyerMedian: 10,
      product: { productId, productName: "商品名称" + String(index + 1).padStart(2, "0") },
    };
  });
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, any>; orderBy: unknown }) => {
        calls.push(args);
        return calls.length === 1 ? rows : [rows[10]];
      },
      count: async () => 11,
    },
    $queryRaw: async () => [],
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);
  const first = await service.list({ userId: "user-1", pageSize: 10, sort: "productName" });
  assert.deepEqual(calls[0].orderBy, [
    { product: { productName: "asc" } },
    { productId: "asc" },
  ]);
  await service.list({ userId: "user-1", page: 2, pageSize: 10, sort: "productName", cursor: first.nextCursor! });
  assert.equal(calls[1].where.AND[1].OR[0].product.productName.gt, "商品名称10");
  assert.equal(calls[1].where.AND[1].OR[1].product.productName, "商品名称10");
  assert.equal(calls[1].where.AND[1].OR[1].productId.gt, "name-product-10");
});

test("管理员成员收藏列表同样使用 Keyset 游标，不使用 OFFSET 深分页", async () => {
  const calls: Array<{ where: Record<string, any>; orderBy: unknown; take: number; skip?: number }> = [];
  const rows = Array.from({ length: 11 }, (_, index) => {
    const productId = "team-product-" + String(index + 1).padStart(2, "0");
    return {
      productId,
      latestBuyerMedian: 88,
      product: {
        productId,
        productName: "团队收藏商品" + (index + 1),
        productUrl: null,
        shopName: "测试店铺",
        shopType: "天猫",
        imageUrl: null,
        listingDate: null,
        aiPreviousSales: null,
        aiSales: null,
        aiClickRate: null,
        aiConversionRate: null,
        aiAddToCartRate: null,
        aiAddToCartCost: null,
        aiRoi: null,
        aiUnitPrice: null,
        aiSpend: null,
        aiCpc: null,
        favorites: [],
      },
    };
  });
  const prisma = {
    productBoardStats: {
      findMany: async (args: { where: Record<string, any>; orderBy: unknown; take: number; skip?: number }) => {
        calls.push(args);
        return calls.length === 1 ? rows : [rows[10]];
      },
      count: async () => 11,
    },
    $queryRaw: async () => [],
    productFavorite: { findMany: async () => [] },
  };
  const service = new ProductsService(prisma as never);
  const first = await service.teamFavorites({ adminUserId: "admin-1", pageSize: 10 });
  assert.ok(first.nextCursor);
  const second = await service.teamFavorites({ adminUserId: "admin-1", page: 2, pageSize: 10, cursor: first.nextCursor! });

  assert.equal(second.items[0].productId, "team-product-11");
  assert.equal("skip" in calls[0], false);
  assert.equal("skip" in calls[1], false);
  assert.deepEqual(calls[0].orderBy, [
    { latestBuyerMedian: { sort: "desc", nulls: "last" } },
    { productId: "asc" },
  ]);
});