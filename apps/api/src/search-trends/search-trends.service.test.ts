import assert from "node:assert/strict";
import test from "node:test";
import { SearchTrendsService } from "./search-trends.service";
import { SearchTrendsController } from "./search-trends.controller";
import { ROLES_KEY } from "../auth/auth.decorators";

type RawQuery = { sql: string; values: unknown[] };

function emptyPageRow(total = 0n) {
  return { searchTerm: null, total };
}

function createPrisma(options: {
  queryRows?: unknown[];
  trendRows?: unknown[];
  latestDate?: Date | null;
  queryDelayMs?: number;
  favoriteRows?: unknown[];
  teamFavoriteRows?: unknown[];
} = {}) {
  const calls = {
    aggregate: 0,
    rawQueries: [] as RawQuery[],
    trendFindMany: 0,
    activeRawQueries: 0,
    maxActiveRawQueries: 0,
    favoriteQueries: [] as any[],
  };
  const prisma = {
    searchTermFavorite: {
      findMany: async (query: any) => {
        calls.favoriteQueries.push(query);
        return query.where.user ? options.teamFavoriteRows ?? [] : options.favoriteRows ?? [];
      },
    },
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

const favoriteIdentity = {
  searchTerm: "厨房置物架", categoryName: "厨房用品", searchTermType: "核心词", boardType: "搜索热榜", dimension: "日",
};

function favoriteGroup(identity = favoriteIdentity) {
  return {
    ...identity, classificationName: null, latestDate: new Date("2026-10-31T00:00:00Z"), latestRank: 1,
    latestSearchPeopleRaw: "100", latestSearchPeopleMin: 90, latestSearchPeopleMax: 110, latestSearchPeopleMedian: 100,
    daysWithData: 4, previousDailyAverage: 50, currentDailyAverage: 100, previousDaysWithData: 1, currentDaysWithData: 4, total: 2n,
  };
}

test("搜索词收藏状态限定当前用户及完整分组，同名不同类目不串收藏", async () => {
  const otherIdentity = { ...favoriteIdentity, categoryName: "收纳用品" };
  const { prisma, calls } = createPrisma({
    queryRows: [favoriteGroup(), favoriteGroup(otherIdentity)], favoriteRows: [favoriteIdentity],
  });
  const result = await new SearchTrendsService(prisma as never).list(filters, { userId: "member-A" });
  assert.deepEqual(result.items.map((item) => item.isFavorited), [true, false]);
  assert.equal(calls.favoriteQueries[0].where.userId, "member-A");
  assert.deepEqual(calls.favoriteQueries[0].where.OR, [favoriteIdentity, otherIdentity]);
  assert.equal("favoriteUsers" in result.items[0], false);
});

test("仅看我的收藏在分页与计数之前按完整分组过滤，账号通过 SQL 参数绑定", async () => {
  const { prisma, calls } = createPrisma();
  await new SearchTrendsService(prisma as never).list({ ...filters, favoritesOnly: "true" }, { userId: "member-A" });
  const query = calls.rawQueries[0];
  assert.match(query.sql, /EXISTS\s*\(/);
  for (const field of ["搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度"]) {
    assert.ok(query.sql.includes(`favorite."${field}" = latest."${field}"`));
  }
  assert.ok(query.values.includes("member-A"));
  assert.ok(query.sql.indexOf("EXISTS") < query.sql.indexOf("COUNT(*)::bigint"));
  assert.equal(query.sql.includes("member-A"), false);
  assert.equal(calls.favoriteQueries.length, 0);
});

test("搜索词列表和成员收藏均在计数、排序与分页前过滤当期日均有效天数不超过3天的数据", async () => {
  for (const viewer of [{}, { userId: "admin-A", teamFavorites: true }]) {
    const { prisma, calls } = createPrisma();
    await new SearchTrendsService(prisma as never).list(filters, viewer);
    const query = calls.rawQueries[0];
    assert.match(query.sql, /COUNT\("搜索人数中值"\) FILTER \(WHERE "统计日期" >= .*? AND "统计日期" <= .*?\)::int AS "currentDaysWithData"/);
    const condition = query.sql.indexOf('COALESCE(metrics."currentDaysWithData", 0) > ?');
    assert.ok(query.values.includes(3));
    assert.ok(condition > query.sql.indexOf("selected AS MATERIALIZED"));
    assert.ok(condition < query.sql.indexOf("COUNT(*)::bigint AS total"));
    assert.ok(condition < query.sql.indexOf("page_rows AS"));
  }
});

test("日均列四项筛选在计数分页前组合且数值通过SQL参数绑定", async () => {
  const { prisma, calls } = createPrisma();
  await new SearchTrendsService(prisma as never).list({ ...filters, metricFilters: JSON.stringify({
    currentDaysWithData: { operator: "eq", value: 2 },
    previousDaysWithData: { operator: "gte", value: 10 },
    currentDailyAverage: { operator: "between", value: 1234, max: 5678 },
    previousDailyAverage: { operator: "gt", value: 9012 },
  }) });
  const query = calls.rawQueries[0];
  assert.match(query.sql, /COALESCE\(metrics\."currentDaysWithData", 0\) = \?/);
  assert.match(query.sql, /COALESCE\(metrics\."previousDaysWithData", 0\) >= \?/);
  assert.match(query.sql, /ROUND\(metrics\."currentDailyAverage"\) BETWEEN \? AND \?/);
  assert.match(query.sql, /ROUND\(metrics\."previousDailyAverage"\) > \?/);
  for (const value of [2, 10, 1234, 5678, 9012]) assert.ok(query.values.includes(value));
  assert.equal(query.sql.includes("1234"), false);
  assert.ok(query.sql.indexOf('ROUND(metrics."previousDailyAverage") > ?') < query.sql.indexOf("COUNT(*)::bigint AS total"));
});

test("无效日均筛选拒绝查询，包括未知字段、操作符、非数字、负数、非整数天数和倒置区间", async () => {
  const { prisma, calls } = createPrisma();
  const service = new SearchTrendsService(prisma as never);
  for (const metricFilters of ["{", "null", "[]", "x".repeat(2001), ...[
    { injectedField: { operator: "gt", value: 1 } },
    { currentDaysWithData: { operator: "DROP TABLE", value: 1 } },
    { currentDaysWithData: { operator: "gt", value: 1.5 } },
    { currentDaysWithData: { operator: "eq", value: -1 } },
    { currentDailyAverage: { operator: "eq", value: "100" } },
    { currentDailyAverage: { operator: "eq", value: null } },
    { previousDailyAverage: { operator: "between", value: 10 } },
    { previousDailyAverage: { operator: "between", value: 10, max: 5 } },
    { previousDaysWithData: { operator: "between", value: 1, max: 2.5 } },
  ].map((value) => JSON.stringify(value))]) {
    await assert.rejects(service.list({ ...filters, metricFilters }), (error: any) => error.getStatus() === 400);
  }
  assert.equal(calls.rawQueries.length, 0);
});

test("管理员成员收藏保留自己的收藏状态并返回成员信息，成员关键词同步用于列表和成员明细", async () => {
  const user = { id: "member-B", name: "张三", username: "zhang", department: "选品部" };
  const createdAt = new Date("2026-11-24T08:00:00Z");
  const { prisma, calls } = createPrisma({
    queryRows: [favoriteGroup()], favoriteRows: [favoriteIdentity], teamFavoriteRows: [{ ...favoriteIdentity, user, createdAt }],
  });
  const result = await new SearchTrendsService(prisma as never).list({ ...filters, favoritesOnly: true }, {
    userId: "admin-A", teamFavorites: true, memberKeyword: " 张三 ",
  });
  assert.equal(result.items[0].isFavorited, true);
  assert.equal(result.items[0].favoriteCount, 1);
  assert.deepEqual(result.items[0].favoriteUsers, [{ userId: user.id, name: user.name, username: user.username, department: user.department, favoritedAt: createdAt.toISOString() }]);
  assert.ok(calls.rawQueries[0].values.includes("%张三%"));
  assert.match(calls.rawQueries[0].sql, /用户角色" = 'EMPLOYEE'/);
  assert.equal(calls.favoriteQueries[0].where.userId, "admin-A");
  assert.deepEqual(calls.favoriteQueries[1].where.user.AND[0], { OR: [{ role: "EMPLOYEE" }, { id: "admin-A" }] });
  assert.equal(calls.favoriteQueries[1].where.user.AND[1].OR[0].name.contains, "张三");
});

test("收藏和取消收藏幂等且只操作当前账号，不接受请求体伪造的用户ID", async () => {
  const upserts: any[] = [];
  const deletes: any[] = [];
  const prisma = {
    searchTermHistory: { findFirst: async () => ({ id: "history-A" }) },
    searchTermFavorite: {
      upsert: async (args: unknown) => { upserts.push(args); },
      deleteMany: async (args: unknown) => { deletes.push(args); },
    },
  };
  const service = new SearchTrendsService(prisma as never);
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await service.favorite("member-A", { ...favoriteIdentity, userId: "member-B" })).isFavorited, true);
    assert.equal((await service.unfavorite("member-A", { ...favoriteIdentity, userId: "member-B" })).isFavorited, false);
  }
  assert.deepEqual(upserts[0], {
    where: { userId_searchTerm_categoryName_searchTermType_boardType_dimension: { userId: "member-A", ...favoriteIdentity } },
    create: { userId: "member-A", ...favoriteIdentity }, update: {},
  });
  assert.deepEqual(upserts[0], upserts[1]);
  assert.deepEqual(deletes[0], { where: { userId: "member-A", ...favoriteIdentity } });
});

test("无效收藏参数及不存在的搜索词不会写入收藏", async () => {
  let writes = 0;
  const service = new SearchTrendsService({
    searchTermHistory: { findFirst: async () => null },
    searchTermFavorite: { upsert: async () => { writes += 1; } },
  } as never);
  for (const body of [null, [], {}, { ...favoriteIdentity, dimension: "周" }, { ...favoriteIdentity, searchTerm: "x".repeat(501) }]) {
    await assert.rejects(service.favorite("member-A", body), /搜索词收藏参数无效|仅支持收藏日搜索趋势/);
  }
  await assert.rejects(service.favorite("member-A", favoriteIdentity), /搜索词不存在/);
  await assert.rejects(service.list({ ...filters, favoritesOnly: true }), /缺少当前用户/);
  assert.equal(writes, 0);
});

test("成员收藏接口只允许管理员，查询上下文始终来自登录用户", () => {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, SearchTrendsController.prototype.teamFavorites), ["ADMIN", "SUPER_ADMIN"]);
  const contexts: unknown[] = [];
  const controller = new SearchTrendsController({ list: (_query: unknown, viewer: unknown) => contexts.push(viewer) } as never);
  const request = { user: { id: "member-A" } } as never;
  controller.list({ userId: "admin-B", teamFavorites: "true" }, request);
  assert.deepEqual(contexts[0], { userId: "member-A" });
});

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
        if (field === "categoryName") return [{ categoryName: "厨房用品", categoryLevel1: "厨房用品", categoryLevel2: "无二级类目", categoryLevel3: "无三级类目" }];
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
  assert.deepEqual(first.categoryLevels, [{ categoryLevel1: "厨房用品", categoryLevel2: "无二级类目", categoryLevel3: "无三级类目" }]);
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


test("三级类目筛选在分页前通过 SQL 参数绑定", async () => {
  const { prisma, calls } = createPrisma();
  await new SearchTrendsService(prisma as never).list({ ...filters, categoryLevel3: ["衣柜/抽屉收纳"] });
  const query = calls.rawQueries[0];
  assert.match(query.sql, /"三级类目" IN/);
  assert.ok(query.values.includes("衣柜/抽屉收纳"));
  assert.equal(query.sql.includes("衣柜/抽屉收纳"), false);
});
