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