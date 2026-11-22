import { BadRequestException, Injectable } from "@nestjs/common";
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
  constructor(private readonly prisma: PrismaService) {}

  async options() {
    const [categories, termTypes, boardTypes, latest] = await Promise.all([
      this.prisma.searchTermHistory.findMany({ distinct: ["categoryName"], select: { categoryName: true }, orderBy: { categoryName: "asc" } }),
      this.prisma.searchTermHistory.findMany({ distinct: ["searchTermType"], select: { searchTermType: true }, orderBy: { searchTermType: "asc" } }),
      this.prisma.searchTermHistory.findMany({ distinct: ["boardType"], select: { boardType: true }, orderBy: { boardType: "asc" } }),
      this.prisma.searchTermHistory.aggregate({ _max: { searchDate: true } }),
    ]);
    return {
      categories: categories.map((item) => item.categoryName),
      searchTermTypes: termTypes.map((item) => item.searchTermType),
      boardTypes: boardTypes.map((item) => item.boardType),
      latestDate: latest._max.searchDate ? dateKey(latest._max.searchDate) : null,
    };
  }

  async list(filters: SearchTrendFilters) {
    const latestAggregate = await this.prisma.searchTermHistory.aggregate({ _max: { searchDate: true } });
    const latestDate = latestAggregate._max.searchDate ?? new Date();
    const defaultEnd = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate()));
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
      selected AS (
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

    const totalResult = await this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*)::bigint AS total FROM selected`);
    const total = Number(totalResult[0]?.total ?? 0n);
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(Number(filters.pageSize) || 50)));
    const offset = (page - 1) * pageSize;

    const groups = await this.prisma.$queryRaw<SearchGroupRow[]>(Prisma.sql`
      ${cte}
      SELECT
        "搜索词" AS "searchTerm",
        "类目" AS "categoryName",
        "分类名称" AS "classificationName",
        "搜索词类型" AS "searchTermType",
        "搜索榜单类型" AS "boardType",
        "统计维度" AS "dimension",
        "最新日期" AS "latestDate",
        "排名" AS "latestRank",
        "搜索人数原值" AS "latestSearchPeopleRaw",
        "搜索人数下限" AS "latestSearchPeopleMin",
        "搜索人数上限" AS "latestSearchPeopleMax",
        "搜索人数中值" AS "latestSearchPeopleMedian",
        "有数据天数" AS "daysWithData",
        "previousDailyAverage",
        "currentDailyAverage",
        "previousDaysWithData",
        "currentDaysWithData"
      FROM selected
      ORDER BY ${orderBySql}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

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
