import test from "node:test";
import assert from "node:assert/strict";
import { ProductsService } from "./products.service";

test("类目选项按当前榜单类型查询，选择一级类目后只收窄二级类目", async () => {
  const calls: Array<{ where: Record<string, unknown> }> = [];
  const prisma = {
    productHistory: {
      groupBy: async (args: { where: Record<string, unknown> }) => {
        calls.push(args);
        return [
          { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架" },
          { categoryLevel1: "厨房用品", categoryLevel2: "调料收纳" },
          { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫" },
        ];
      },
    },
  };

  const service = new ProductsService(prisma as never);
  const result = await service.categories(["厨房用品"], "TRANSACTION_GROWTH");

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, ["厨房置物架", "调料收纳"]);
  assert.deepEqual(calls[0].where, { boardType: "TRANSACTION_GROWTH" });
});

test("未选择一级类目时保留当前榜单的全部一级选项且不展示二级选项", async () => {
  const prisma = {
    productHistory: {
      groupBy: async () => [
        { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架" },
        { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫" },
      ],
    },
  };

  const result = await new ProductsService(prisma as never).categories(undefined, "NEW_PRODUCT_TRAFFIC");

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, []);
});

test("商品列表按当前榜单读取独立统计，且不向页面返回加购人数", async () => {
  let statsWhere: Record<string, unknown> | undefined;
  let historyWhere: Record<string, unknown> | undefined;
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
    productHistory: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        historyWhere = args.where;
        return [];
      },
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
  assert.deepEqual(historyWhere, { productId: { in: ["1070000000000"] }, boardType: "TRANSACTION_GROWTH" });
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
    productHistory: {
      findMany: async () => historyRows,
    },
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

test("二级类目筛选使用同周期优先类目匹配商品，并在分页前生效", async () => {
  let rawQueryCount = 0;
  let statsWhere: Record<string, unknown> | undefined;
  const prisma = {
    $queryRaw: async () => {
      rawQueryCount += 1;
      return [{ productId: "product-a" }];
    },
    productBoardStats: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        statsWhere = args.where;
        return [];
      },
      count: async () => 0,
    },
    productHistory: {
      findMany: async () => [],
    },
    productFavorite: {
      findMany: async () => [],
    },
  };

  const result = await new ProductsService(prisma as never).list({
    categoryLevel2: ["咖啡杯"],
    userId: "user-1",
  });

  assert.equal(rawQueryCount, 1);
  assert.deepEqual(statsWhere?.productId, { in: ["product-a"] });
  assert.equal(result.total, 0);
});