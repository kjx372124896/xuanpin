import assert from "node:assert/strict";
import test from "node:test";
import { SearchTrendsService } from "./search-trends.service";

type RawQuery = { sql: string; values: unknown[] };

function emptyPageRow(total = 0n) {
  return { searchTerm: null, total };
}

function createPrisma(options: {
  queryRows?: unknown[];
  trendRows?: unknown[];
  latestDate?: Date | null;
  queryDelayMs?: number;
} = {}) {
  const calls = {
    aggregate: 0,
    rawQueries: [] as RawQuery[],
    trendFindMany: 0,
    activeRawQueries: 0,
    maxActiveRawQueries: 0,
  };
  const prisma = {
    searchTermHistory: {
      aggregate: async () => {
        calls.aggregate += 1;
        return { _max: { searchDate: options.latestDate ?? null } };
      },
      findMany: async () => {
        calls.trendFindMany += 1;
        return options.trendRows ?? [];
      },
    },
    $queryRaw: async (query: RawQuery) => {
      calls.rawQueries.push(query);
      calls.activeRawQueries += 1;
      calls.maxActiveRawQueries = Math.max(calls.maxActiveRawQueries, calls.activeRawQueries);
      if (options.queryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.queryDelayMs));
      }
      calls.activeRawQueries -= 1;
      return options.queryRows ?? [emptyPageRow()];
    },
  };
  return { prisma, calls };
}

const filters = {
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  comparisonMode: "previousMonth",
  page: 1,
  pageSize: 50,
};

test("显式日期跳过最新日期聚合，COUNT 与分页合并为一次 SQL", async () => {
  const queryGroup = {
    searchTerm: "厨房置物架",
    categoryName: "厨房用品",
    classificationName: null,
    searchTermType: "核心词",
    boardType: "NEW_PRODUCT_TRAFFIC",
    dimension: "日",
    latestDate: new Date("2026-10-31T00:00:00.000Z"),
    latestRank: 1,
    latestSearchPeopleRaw: "100",
    latestSearchPeopleMin: 90,
    latestSearchPeopleMax: 110,
    latestSearchPeopleMedian: 100,
    daysWithData: 30,
    previousDailyAverage: 50,
    currentDailyAverage: 75,
    previousDaysWithData: 30,
    currentDaysWithData: 31,
    total: 1n,
  };
  const trendRows = [
    {
      searchTerm: "厨房置物架",
      categoryName: "厨房用品",
      searchTermType: "核心词",
      boardType: "NEW_PRODUCT_TRAFFIC",
      dimension: "日",
      searchDate: new Date("2026-10-01T00:00:00.000Z"),
      rank: 1,
      searchPeopleRaw: "75",
      searchPeopleMin: 70,
      searchPeopleMax: 80,
      searchPeopleMedian: 75,
    },
    {
      searchTerm: "厨房置物架",
      categoryName: "厨房用品",
      searchTermType: "核心词",
      boardType: "NEW_PRODUCT_TRAFFIC",
      dimension: "日",
      searchDate: new Date("2026-09-01T00:00:00.000Z"),
      rank: 2,
      searchPeopleRaw: "50",
      searchPeopleMin: 45,
      searchPeopleMax: 55,
      searchPeopleMedian: 50,
    },
  ];
  const { prisma, calls } = createPrisma({ queryRows: [queryGroup], trendRows });
  const result = await new SearchTrendsService(prisma as never).list(filters);

  assert.equal(calls.aggregate, 0);
  assert.equal(calls.rawQueries.length, 1);
  assert.match(calls.rawQueries[0].sql, /selected AS MATERIALIZED/);
  assert.match(calls.rawQueries[0].sql, /COUNT\(\*\)::bigint AS total/);
  assert.match(calls.rawQueries[0].sql, /LIMIT/);
  assert.match(calls.rawQueries[0].sql, /OFFSET/);
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].growthRate, 50);
  assert.equal(result.items[0].trend.length, 31);
  assert.equal(result.items[0].trend[0].date, "2026-10-01");
  assert.equal(result.items[0].trend[0].comparisonDate, "2026-09-01");
  assert.equal(result.items[0].trend[0].median, 75);
  assert.equal(result.items[0].trend[0].comparisonMedian, 50);
});

test("越界页仍返回真实总数占位行，不触发趋势明细查询", async () => {
  const { prisma, calls } = createPrisma({ queryRows: [emptyPageRow(3n)] });
  const result = await new SearchTrendsService(prisma as never).list({ ...filters, page: 10 });

  assert.equal(result.total, 3);
  assert.deepEqual(result.items, []);
  assert.equal(calls.rawQueries.length, 1);
  assert.equal(calls.trendFindMany, 0);
});

test("缺少日期时仍按数据库最新日期生成默认30天范围", async () => {
  const { prisma, calls } = createPrisma({
    latestDate: new Date("2026-10-31T00:00:00.000Z"),
    queryRows: [emptyPageRow()],
  });
  const result = await new SearchTrendsService(prisma as never).list({ comparisonMode: "previousMonth" });

  assert.equal(calls.aggregate, 1);
  assert.equal(result.startDate, "2026-10-02");
  assert.equal(result.endDate, "2026-10-31");
});

test("筛选选项请求并发合并，并在短缓存有效期内复用结果", async () => {
  let optionFindManyCalls = 0;
  let aggregateCalls = 0;
  const prisma = {
    searchTermHistory: {
      findMany: async (args: { distinct?: string[] }) => {
        optionFindManyCalls += 1;
        const field = args.distinct?.[0];
        if (field === "categoryName") return [{ categoryName: "厨房用品" }];
        if (field === "searchTermType") return [{ searchTermType: "核心词" }];
        return [{ boardType: "NEW_PRODUCT_TRAFFIC" }];
      },
      aggregate: async () => {
        aggregateCalls += 1;
        return { _max: { searchDate: new Date("2026-10-31T00:00:00.000Z") } };
      },
    },
  };
  const service = new SearchTrendsService(prisma as never);
  const [first, second] = await Promise.all([service.options(), service.options()]);
  const third = await service.options();

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.deepEqual(first.categories, ["厨房用品"]);
  assert.deepEqual(first.searchTermTypes, ["核心词"]);
  assert.deepEqual(first.boardTypes, ["NEW_PRODUCT_TRAFFIC"]);
  assert.equal(first.latestDate, "2026-10-31");
  assert.equal(optionFindManyCalls, 3);
  assert.equal(aggregateCalls, 1);
});

test("搜索趋势重查询最多并发执行两条，超出请求排队", async () => {
  const { prisma, calls } = createPrisma({ queryRows: [emptyPageRow()], queryDelayMs: 15 });
  const service = new SearchTrendsService(prisma as never);

  await Promise.all(Array.from({ length: 6 }, () => service.list(filters)));

  assert.equal(calls.rawQueries.length, 6);
  assert.equal(calls.maxActiveRawQueries, 2);
  assert.equal(calls.activeRawQueries, 0);
});
