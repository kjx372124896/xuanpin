import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { buildSearchTrendComparisonPeriods, calculateSearchTrendGrowthRate, shiftUtcMonthsClamped, type SearchTrendComparisonMode } from "./search-trends.helpers";

type SearchTrendFilters = {
  startDate?: string;
  endDate?: string;
  category?: string | string[];
  searchTermType?: string | string[];
  boardType?: string | string[];
  keyword?: string;
  searchPeopleMin?: string | number;
  searchPeopleMax?: string | number;
  comparisonMode?: string;
  minGrowthRate?: string | number;
  sortBy?: string;
  sortOrder?: string;
  page?: string | number;
  pageSize?: string | number;
};

type SearchGroupRow = {
  searchTerm: string;
  categoryName: string;
  classificationName: string | null;
  searchTermType: string;
  boardType: string;
  dimension: string;
  latestDate: Date;
  latestRank: number | null;
  latestSearchPeopleRaw: string | null;
  latestSearchPeopleMin: Prisma.Decimal | null;
  latestSearchPeopleMax: Prisma.Decimal | null;
  latestSearchPeopleMedian: Prisma.Decimal | null;
  daysWithData: number;
  previousDailyAverage: Prisma.Decimal | null;
  currentDailyAverage: Prisma.Decimal | null;
  previousDaysWithData: number | null;
  currentDaysWithData: number | null;
};

type SearchGroupQueryRow = Omit<SearchGroupRow, "searchTerm"> & {
  searchTerm: string | null;
  total: bigint;
};

type SearchTrendOptionsResult = {
  categories: string[];
  searchTermTypes: string[];
  boardTypes: string[];
  latestDate: string | null;
};

function parseDate(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new BadRequestException(label + "格式必须为 YYYY-MM-DD。");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException(label + "不是有效日期。");
  }
  return date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function numeric(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new BadRequestException(label + "必须是大于等于0的数字。");
  return result;
}

function signedGrowthRate(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const result = Number(value);
  if (!Number.isFinite(result) || result < -100) {
    throw new BadRequestException("最低环比增长率必须是大于等于-100的数字。");
  }
  return result;
}

function numberOrNull(value: Prisma.Decimal | number | null) {
  return value === null ? null : Number(value);
}

function groupKey(value: { searchTerm: string; categoryName: string; searchTermType: string; boardType: string; dimension: string }) {
  return JSON.stringify([value.searchTerm, value.categoryName, value.searchTermType, value.boardType, value.dimension]);
}

@Injectable()
export class SearchTrendsService {
  private readonly optionsCacheTtlMs = 5_000;
  private optionsCache: { expiresAt: number; value: SearchTrendOptionsResult } | null = null;
  private optionsInFlight: Promise<SearchTrendOptionsResult> | null = null;
  private readonly maxConcurrentListQueries = 2;
  private readonly maxQueuedListQueries = 40;
  private readonly listQueryQueueTimeoutMs = 15_000;
  private activeListQueries = 0;
  private readonly listQueryWaiters: Array<() => void> = [];

  constructor(private readonly prisma: PrismaService) {}

  private async withListQuerySlot<T>(operation: () => Promise<T>): Promise<T> {
    let queuedAt: number | undefined;
    if (this.activeListQueries >= this.maxConcurrentListQueries) {
      if (this.listQueryWaiters.length >= this.maxQueuedListQueries) {
        throw new ServiceUnavailableException("当前搜索趋势查询较多，请稍后重试。");
      }
      queuedAt = Date.now();
      await new Promise<void>((resolve, reject) => {
        const waiter = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = this.listQueryWaiters.indexOf(waiter);
          if (index >= 0) this.listQueryWaiters.splice(index, 1);
          reject(new ServiceUnavailableException("搜索趋势查询排队时间过长，请稍后重试。"));
        }, this.listQueryQueueTimeoutMs);
        this.listQueryWaiters.push(waiter);
      });
    } else {
      this.activeListQueries += 1;
    }

    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      const next = this.listQueryWaiters.shift();
      if (next) next();
      else this.activeListQueries -= 1;

      const durationMs = Date.now() - startedAt;
      const queueMs = queuedAt ? startedAt - queuedAt : 0;
      if (durationMs >= 1_000 || queueMs >= 1_000) {
        console.warn(`[performance] search-trends.list duration_ms=${durationMs} queue_ms=${queueMs}`);
      }
    }
  }

  async options() {
    const now = Date.now();
    if (this.optionsCache && this.optionsCache.expiresAt > now) return this.optionsCache.value;
    if (this.optionsInFlight) return this.optionsInFlight;

    const request = (async (): Promise<SearchTrendOptionsResult> => {
      const [categories, termTypes, boardTypes, latest] = await Promise.all([
        this.prisma.searchTermHistory.findMany({ distinct: ["categoryName"], select: { categoryName: true }, orderBy: { categoryName: "asc" } }),
        this.prisma.searchTermHistory.findMany({ distinct: ["searchTermType"], select: { searchTermType: true }, orderBy: { searchTermType: "asc" } }),
        this.prisma.searchTermHistory.findMany({ distinct: ["boardType"], select: { boardType: true }, orderBy: { boardType: "asc" } }),
        this.prisma.searchTermHistory.aggregate({ _max: { searchDate: true } }),
      ]);
      const value = {
        categories: categories.map((item) => item.categoryName),
        searchTermTypes: termTypes.map((item) => item.searchTermType),
        boardTypes: boardTypes.map((item) => item.boardType),
        latestDate: latest._max.searchDate ? dateKey(latest._max.searchDate) : null,
      };
      this.optionsCache = { expiresAt: Date.now() + this.optionsCacheTtlMs, value };
      return value;
    })();
    this.optionsInFlight = request;
    try {
      return await request;
    } finally {
      if (this.optionsInFlight === request) this.optionsInFlight = null;
    }
  }

  async list(filters: SearchTrendFilters) {
    return this.withListQuerySlot(() => this.listInternal(filters));
  }

  private async listInternal(filters: SearchTrendFilters) {
    // 前端通常会传入完整日期范围；只有缺少任一端点时才需要查询最新日期来补默认值。
    const latestDate = !filters.startDate || !filters.endDate
      ? (await this.prisma.searchTermHistory.aggregate({ _max: { searchDate: true } }))._max.searchDate ?? new Date()
      : null;
    const defaultEndSource = latestDate ?? new Date();
    const defaultEnd = new Date(Date.UTC(defaultEndSource.getUTCFullYear(), defaultEndSource.getUTCMonth(), defaultEndSource.getUTCDate()));
    const defaultStart = new Date(defaultEnd);
    defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);

    const startDate = parseDate(filters.startDate, "开始日期") ?? defaultStart;
    const endDate = parseDate(filters.endDate, "结束日期") ?? defaultEnd;
    if (startDate > endDate) throw new BadRequestException("开始日期不能晚于结束日期。");
    if (endDate > shiftUtcMonthsClamped(startDate, 13)) {
      throw new BadRequestException("单次最多查询13个月，请缩小日期范围。");
    }

    const comparisonMode = (filters.comparisonMode?.trim() || "previousMonth") as SearchTrendComparisonMode;
    if (comparisonMode !== "previousMonth" && comparisonMode !== "previousYear") {
      throw new BadRequestException("对比方式仅支持环比上月同期或环比去年同期。");
    }
    const periods = buildSearchTrendComparisonPeriods(startDate, endDate, comparisonMode);
    const currentDays = Math.round((periods.currentEndDate.getTime() - periods.currentStartDate.getTime()) / 86_400_000) + 1;
    const previousDays = Math.round((periods.previousEndDate.getTime() - periods.previousStartDate.getTime()) / 86_400_000) + 1;

    const categories = parseList(filters.category);
    const termTypes = parseList(filters.searchTermType);
    const boardTypes = parseList(filters.boardType);
    const keyword = filters.keyword?.trim();
    const min = numeric(filters.searchPeopleMin, "搜索人数最小值");
    const max = numeric(filters.searchPeopleMax, "搜索人数最大值");
    const minGrowth = signedGrowthRate(filters.minGrowthRate);
    if (min !== undefined && max !== undefined && min > max) throw new BadRequestException("搜索人数最小值不能大于最大值。");

    const commonConditions: Prisma.Sql[] = [Prisma.sql`"统计维度" = '日'`];
    if (categories.length) commonConditions.push(Prisma.sql`"类目" IN (${Prisma.join(categories)})`);
    if (termTypes.length) commonConditions.push(Prisma.sql`"搜索词类型" IN (${Prisma.join(termTypes)})`);
    if (boardTypes.length) commonConditions.push(Prisma.sql`"搜索榜单类型" IN (${Prisma.join(boardTypes)})`);
    if (keyword) commonConditions.push(Prisma.sql`"搜索词" ILIKE ${"%" + keyword + "%"}`);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"统计日期" >= ${startDate}::date`,
      Prisma.sql`"统计日期" <= ${endDate}::date`,
      ...commonConditions,
    ];
    const periodConditions: Prisma.Sql[] = [
      Prisma.sql`(("统计日期" >= ${periods.previousStartDate}::date AND "统计日期" <= ${periods.previousEndDate}::date) OR ("统计日期" >= ${periods.currentStartDate}::date AND "统计日期" <= ${periods.currentEndDate}::date))`,
      ...commonConditions,
    ];

    const whereSql = Prisma.join(conditions, " AND ");
    const periodWhereSql = Prisma.join(periodConditions, " AND ");
    const selectedConditions: Prisma.Sql[] = [];
    if (min !== undefined) selectedConditions.push(Prisma.sql`latest."搜索人数中值" >= ${min}`);
    if (max !== undefined) selectedConditions.push(Prisma.sql`latest."搜索人数中值" <= ${max}`);
    if (minGrowth !== undefined) selectedConditions.push(Prisma.sql`metrics."growthRate" >= ${minGrowth}`);
    const selectedFilterSql = selectedConditions.length ? Prisma.sql`WHERE ${Prisma.join(selectedConditions, " AND ")}` : Prisma.sql``;

    const sortBy = filters.sortBy === "growthRate" ? "growthRate" : "latestRank";
    const sortOrder = filters.sortOrder === "desc" ? "desc" : "asc";
    const orderBySql = sortBy === "growthRate"
      ? sortOrder === "asc"
        ? Prisma.sql`"growthRate" ASC NULLS LAST, "搜索词" ASC`
        : Prisma.sql`"growthRate" DESC NULLS LAST, "搜索词" ASC`
      : sortOrder === "asc"
        ? Prisma.sql`"排名" ASC NULLS LAST, "搜索人数中值" DESC NULLS LAST, "搜索词" ASC`
        : Prisma.sql`"排名" DESC NULLS LAST, "搜索人数中值" DESC NULLS LAST, "搜索词" ASC`;

    const cte = Prisma.sql`
      WITH filtered AS (
        SELECT "搜索词", "类目", "分类名称", "搜索词类型", "搜索榜单类型", "统计维度",
               "统计日期", "排名", "搜索人数原值", "搜索人数下限", "搜索人数上限", "搜索人数中值",
               "导出时间", "导入时间"
        FROM "搜索词日历史表"
        WHERE ${whereSql}
      ),
      latest AS (
        SELECT DISTINCT ON ("搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度")
               "搜索词", "类目", "分类名称", "搜索词类型", "搜索榜单类型", "统计维度",
               "统计日期" AS "最新日期", "排名", "搜索人数原值", "搜索人数下限", "搜索人数上限", "搜索人数中值"
        FROM filtered
        ORDER BY "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度",
                 "统计日期" DESC, "导出时间" DESC NULLS LAST, "导入时间" DESC
      ),
      counts AS (
        SELECT "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度", COUNT(*)::int AS "有数据天数"
        FROM filtered
        GROUP BY "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度"
      ),
      period_averages AS (
        SELECT
          "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度",
          AVG("搜索人数中值") FILTER (WHERE "统计日期" >= ${periods.previousStartDate}::date AND "统计日期" <= ${periods.previousEndDate}::date) AS "previousDailyAverage",
          COUNT("搜索人数中值") FILTER (WHERE "统计日期" >= ${periods.previousStartDate}::date AND "统计日期" <= ${periods.previousEndDate}::date)::int AS "previousDaysWithData",
          AVG("搜索人数中值") FILTER (WHERE "统计日期" >= ${periods.currentStartDate}::date AND "统计日期" <= ${periods.currentEndDate}::date) AS "currentDailyAverage",
          COUNT("搜索人数中值") FILTER (WHERE "统计日期" >= ${periods.currentStartDate}::date AND "统计日期" <= ${periods.currentEndDate}::date)::int AS "currentDaysWithData"
        FROM "搜索词日历史表"
        WHERE ${periodWhereSql}
        GROUP BY "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度"
      ),
      period_metrics AS (
        SELECT period_averages.*,
               CASE
                 WHEN "previousDailyAverage" IS NULL OR "previousDailyAverage" <= 0 OR "currentDailyAverage" IS NULL THEN NULL
                 ELSE (("currentDailyAverage" - "previousDailyAverage") / "previousDailyAverage") * 100
               END AS "growthRate"
        FROM period_averages
      ),
      selected AS MATERIALIZED (
        SELECT latest.*, counts."有数据天数",
               metrics."previousDailyAverage", metrics."currentDailyAverage",
               metrics."previousDaysWithData", metrics."currentDaysWithData",
               metrics."growthRate"
        FROM latest
        JOIN counts USING ("搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度")
        LEFT JOIN period_metrics metrics USING ("搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度")
        ${selectedFilterSql}
      )
    `;

    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(Number(filters.pageSize) || 50)));
    const offset = (page - 1) * pageSize;

    // COUNT 与分页从同一份物化结果读取，避免分别执行两遍完整聚合 CTE。
    const resultRows = await this.prisma.$queryRaw<SearchGroupQueryRow[]>(Prisma.sql`
      ${cte}
      , totals AS (
        SELECT COUNT(*)::bigint AS total FROM selected
      ),
      page_rows AS (
        SELECT * FROM selected
        ORDER BY ${orderBySql}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT
        page_rows."搜索词" AS "searchTerm",
        page_rows."类目" AS "categoryName",
        page_rows."分类名称" AS "classificationName",
        page_rows."搜索词类型" AS "searchTermType",
        page_rows."搜索榜单类型" AS "boardType",
        page_rows."统计维度" AS "dimension",
        page_rows."最新日期" AS "latestDate",
        page_rows."排名" AS "latestRank",
        page_rows."搜索人数原值" AS "latestSearchPeopleRaw",
        page_rows."搜索人数下限" AS "latestSearchPeopleMin",
        page_rows."搜索人数上限" AS "latestSearchPeopleMax",
        page_rows."搜索人数中值" AS "latestSearchPeopleMedian",
        page_rows."有数据天数" AS "daysWithData",
        page_rows."previousDailyAverage",
        page_rows."currentDailyAverage",
        page_rows."previousDaysWithData",
        page_rows."currentDaysWithData",
        totals.total
      FROM totals
      LEFT JOIN page_rows ON TRUE
    `);
    const total = Number(resultRows[0]?.total ?? 0n);
    // LEFT JOIN 保证越界页和零结果也能带回总数；占位行的搜索词为 NULL，应过滤掉。
    const groups = resultRows.filter((row) => row.searchTerm !== null) as SearchGroupRow[];

    const comparison = {
      mode: comparisonMode,
      days: currentDays,
      currentDays,
      previousDays,
      previousStartDate: dateKey(periods.previousStartDate),
      previousEndDate: dateKey(periods.previousEndDate),
      currentStartDate: dateKey(periods.currentStartDate),
      currentEndDate: dateKey(periods.currentEndDate),
    };

    if (!groups.length) {
      return { items: [], page, pageSize, total, totalPages: Math.ceil(total / pageSize), startDate: dateKey(startDate), endDate: dateKey(endDate), comparison };
    }

    const trendRows = await this.prisma.searchTermHistory.findMany({
      where: {
        AND: [
          { OR: [
            { searchDate: { gte: periods.currentStartDate, lte: periods.currentEndDate } },
            { searchDate: { gte: periods.previousStartDate, lte: periods.previousEndDate } },
          ] },
          { OR: groups.map((group) => ({
            searchTerm: group.searchTerm,
            categoryName: group.categoryName,
            searchTermType: group.searchTermType,
            boardType: group.boardType,
            dimension: group.dimension,
          })) },
        ],
      },
      orderBy: [{ searchDate: "asc" }, { searchTerm: "asc" }],
      select: {
        searchTerm: true,
        categoryName: true,
        searchTermType: true,
        boardType: true,
        dimension: true,
        searchDate: true,
        rank: true,
        searchPeopleRaw: true,
        searchPeopleMin: true,
        searchPeopleMax: true,
        searchPeopleMedian: true,
      },
    });

    const rowsByGroup = new Map<string, Map<string, typeof trendRows[number]>>();
    for (const row of trendRows) {
      const key = groupKey(row);
      const daily = rowsByGroup.get(key) ?? new Map<string, typeof row>();
      daily.set(dateKey(row.searchDate), row);
      rowsByGroup.set(key, daily);
    }

    const buildDates = (from: Date, to: Date) => {
      const result: string[] = [];
      for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) result.push(dateKey(cursor));
      return result;
    };
    const currentDates = buildDates(periods.currentStartDate, periods.currentEndDate);
    const previousDates = buildDates(periods.previousStartDate, periods.previousEndDate);
    const trendLength = Math.max(currentDates.length, previousDates.length);

    const items = groups.map((group) => {
      const daily = rowsByGroup.get(groupKey(group)) ?? new Map();
      const trend = Array.from({ length: trendLength }, (_, index) => {
        const date = currentDates[index] ?? null;
        const comparisonDate = previousDates[index] ?? null;
        const row = date ? daily.get(date) : undefined;
        const comparisonRow = comparisonDate ? daily.get(comparisonDate) : undefined;
        return {
          date,
          comparisonDate,
          rank: row?.rank ?? null,
          raw: row?.searchPeopleRaw ?? null,
          min: row ? numberOrNull(row.searchPeopleMin) : null,
          max: row ? numberOrNull(row.searchPeopleMax) : null,
          median: row ? numberOrNull(row.searchPeopleMedian) : null,
          comparisonRank: comparisonRow?.rank ?? null,
          comparisonRaw: comparisonRow?.searchPeopleRaw ?? null,
          comparisonMin: comparisonRow ? numberOrNull(comparisonRow.searchPeopleMin) : null,
          comparisonMax: comparisonRow ? numberOrNull(comparisonRow.searchPeopleMax) : null,
          comparisonMedian: comparisonRow ? numberOrNull(comparisonRow.searchPeopleMedian) : null,
        };
      });
      return {
        searchTerm: group.searchTerm,
        categoryName: group.categoryName,
        classificationName: group.classificationName,
        searchTermType: group.searchTermType,
        boardType: group.boardType,
        dimension: group.dimension,
        latestDate: dateKey(group.latestDate),
        latestRank: group.latestRank,
        latestSearchPeople: {
          raw: group.latestSearchPeopleRaw,
          min: numberOrNull(group.latestSearchPeopleMin),
          max: numberOrNull(group.latestSearchPeopleMax),
          median: numberOrNull(group.latestSearchPeopleMedian),
        },
        daysWithData: group.daysWithData,
        previousDailyAverage: numberOrNull(group.previousDailyAverage),
        currentDailyAverage: numberOrNull(group.currentDailyAverage),
        previousDaysWithData: group.previousDaysWithData ?? 0,
        currentDaysWithData: group.currentDaysWithData ?? 0,
        growthRate: calculateSearchTrendGrowthRate(
          numberOrNull(group.previousDailyAverage),
          numberOrNull(group.currentDailyAverage),
        ),
        trend,
      };
    });

    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize), startDate: dateKey(startDate), endDate: dateKey(endDate), comparison };
  }
}
