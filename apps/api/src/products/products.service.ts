import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseAiMetricsMarkdown } from "./ai-metrics-parser";
import { aiMetricsStatusWhere, type AiMetricsStatus } from "./ai-metrics-status";
import { calculateListingDate } from "./listing-date";

type ProductBoardType = "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH";

type ProductListQuery = {
  page?: number;
  pageSize?: number;
  cursor?: string;
  keyword?: string;
  categoryLevel1?: string[];
  categoryLevel2?: string[];
  categoryLevel3?: string[];
  shopType?: string;
  listingDateFrom?: string;
  listingDateTo?: string;
  latestWeekStarts?: string[];
  latestBuyerMedianMin?: number;
  latestBuyerMedianMax?: number;
  historyWeekCountMin?: number;
  historyWeekCountMax?: number;
  consecutiveWeekCountMin?: number;
  consecutiveWeekCountMax?: number;
  aiMetricsStatus?: AiMetricsStatus;
  favoritesOnly?: boolean;
  boardType?: ProductBoardType;
  userId: string;
  sort?: string;
  direction?: string;
};

type TeamFavoritesQuery = Omit<ProductListQuery, "favoritesOnly" | "userId" | "sort" | "direction"> & {
  memberKeyword?: string;
  adminUserId: string;
};

type ProductSortField = "latestWeekStart" | "latestRank" | "historyWeekCount" | "consecutiveWeekCount" | "productName" | "latestBuyerMedian";
type ProductSortConfig = {
  field: ProductSortField;
  direction: "asc" | "desc";
  nulls: "first" | "last" | null;
};
type ProductCursorPayload = {
  version: 1;
  productId: string;
  field: ProductSortField;
  direction: "asc" | "desc";
  boardType: ProductBoardType;
  filterHash: string;
  value: string | number | null;
};
type ProductTrendHistoryRow = {
  productId: string;
  weekStart: Date;
  weekEnd: Date;
  buyerRaw: string | null;
  buyerMin: Prisma.Decimal | null;
  buyerMax: Prisma.Decimal | null;
  buyerMedian: Prisma.Decimal | null;
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string;
  categoryLevel3: string;
};

function normalizePeriodStarts(values?: string[]): string[] {
  return [...new Set(values ?? [])].filter((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
}

function range(
  raw: string | null,
  min: Prisma.Decimal | null,
  max: Prisma.Decimal | null,
  median: Prisma.Decimal | null,
) {
  return {
    raw,
    min: min === null ? null : Number(min),
    max: max === null ? null : Number(max),
    median: median === null ? null : Number(median),
  };
}

function mapProduct(stats: any, product: any = stats) {
  return {
    productId: product.productId,
    listingDate: product.listingDate?.toISOString?.().slice(0, 10) ?? calculateListingDate(product.productId),
    productName: product.productName,
    productUrl: product.productUrl,
    shopName: product.shopName,
    shopType: product.shopType,
    imageUrl: product.imageUrl,
    latestCategory: stats.latestCategory,
    latestCategoryLevel1: stats.latestCategoryLevel1,
    latestCategoryLevel2: stats.latestCategoryLevel2,
    latestCategoryLevel3: stats.latestCategoryLevel3,
    latestWeekStart: stats.latestWeekStart?.toISOString() ?? null,
    latestWeekEnd: stats.latestWeekEnd?.toISOString() ?? null,
    latestRank: stats.latestRank,
    historyWeekCount: stats.historyWeekCount,
    historyRecordCount: stats.historyRecordCount,
    consecutiveWeekCount: stats.consecutiveWeekCount,
    firstWeekStart: stats.firstWeekStart?.toISOString() ?? null,
    visitor: range(stats.latestVisitorRaw, stats.latestVisitorMin, stats.latestVisitorMax, stats.latestVisitorMedian),
    buyer: range(stats.latestBuyerRaw, stats.latestBuyerMin, stats.latestBuyerMax, stats.latestBuyerMedian),
    aiPreviousSales: product.aiPreviousSales,
    aiSales: product.aiSales,
    aiClickRate: product.aiClickRate,
    aiConversionRate: product.aiConversionRate,
    aiAddToCartRate: product.aiAddToCartRate,
    aiAddToCartCost: product.aiAddToCartCost,
    aiRoi: product.aiRoi,
    aiUnitPrice: product.aiUnitPrice,
    aiSpend: product.aiSpend,
    aiCpc: product.aiCpc,
  };
}

const NO_SECOND_LEVEL_CATEGORY = "无二级类目";
const NO_THIRD_LEVEL_CATEGORY = "无三级类目";

function compareHistoryRowsForDisplay<T extends {
  productId: string;
  weekStart: Date;
  categoryLevel2: string;
  categoryLevel3: string;
  exportTime: Date | null;
  importedAt: Date;
  categoryName: string;
}>(a: T, b: T) {
  return a.productId.localeCompare(b.productId)
    || a.weekStart.getTime() - b.weekStart.getTime()
    || Number(a.categoryLevel2 === NO_SECOND_LEVEL_CATEGORY) - Number(b.categoryLevel2 === NO_SECOND_LEVEL_CATEGORY)
    || Number(a.categoryLevel3 === NO_THIRD_LEVEL_CATEGORY) - Number(b.categoryLevel3 === NO_THIRD_LEVEL_CATEGORY)
    || (b.exportTime?.getTime() ?? 0) - (a.exportTime?.getTime() ?? 0)
    || b.importedAt.getTime() - a.importedAt.getTime()
    || a.categoryName.localeCompare(b.categoryName);
}

@Injectable()
export class ProductsService {
  private readonly countCache = new Map<string, { expiresAt: number; promise: Promise<number> }>();
  private readonly countCacheTtlMs = 15_000;
  private readonly maxCachedCounts = 256;
  private readonly maxConcurrentListQueries = 2;
  private readonly maxQueuedListQueries = 40;
  private activeListQueries = 0;
  private readonly listQueryWaiters: Array<() => void> = [];

  constructor(private readonly prisma: PrismaService) {}

  private listingDateFilter(fromValue?: string, toValue?: string): { gte?: Date; lte?: Date } | undefined {
    const normalizeDate = (value?: string) => {
      if (value === undefined || value === "") return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("上架日期格式不正确。");
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException("上架日期无效。");
      }
      return date;
    };
    const from = normalizeDate(fromValue);
    const to = normalizeDate(toValue);
    if (!from && !to) return undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException("上架日期范围的开始日期不能晚于结束日期。");
    }
    return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  private async withListQuerySlot<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let queuedAt: number | undefined;
    if (this.activeListQueries >= this.maxConcurrentListQueries) {
      if (this.listQueryWaiters.length >= this.maxQueuedListQueries) {
        throw new ServiceUnavailableException("当前商品筛选请求较多，请稍后重试。");
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
          reject(new ServiceUnavailableException("商品筛选排队时间过长，请稍后重试。"));
        }, 15_000);
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
        console.warn(`[performance] ${label} duration_ms=${durationMs} queue_ms=${queueMs}`);
      }
    }
  }

  private countWithShortCache(key: string, load: () => Promise<number>): Promise<number> {
    const now = Date.now();
    const cached = this.countCache.get(key);
    if (cached && (cached.expiresAt === 0 || cached.expiresAt > now)) {
      this.countCache.delete(key);
      this.countCache.set(key, cached);
      return cached.promise;
    }
    if (cached) this.countCache.delete(key);

    const entry: { expiresAt: number; promise: Promise<number> } = {
      expiresAt: 0,
      promise: Promise.resolve(0),
    };
    entry.promise = load().then((value) => {
      entry.expiresAt = Date.now() + this.countCacheTtlMs;
      return value;
    }).catch((error) => {
      if (this.countCache.get(key) === entry) this.countCache.delete(key);
      throw error;
    });
    this.countCache.set(key, entry);
    while (this.countCache.size > this.maxCachedCounts) {
      const oldestKey = this.countCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.countCache.delete(oldestKey);
    }
    return entry.promise;
  }

  private productSortConfig(sort?: string, requestedDirection?: string): ProductSortConfig {
    const supported: ProductSortField[] = [
      "latestWeekStart", "latestRank", "historyWeekCount", "consecutiveWeekCount", "productName", "latestBuyerMedian",
    ];
    const field: ProductSortField = supported.includes(sort as ProductSortField)
      ? sort as ProductSortField
      : "latestBuyerMedian";
    const defaultDirection: Record<ProductSortField, "asc" | "desc"> = {
      latestWeekStart: "desc",
      latestRank: "asc",
      historyWeekCount: "desc",
      consecutiveWeekCount: "desc",
      productName: "asc",
      latestBuyerMedian: "desc",
    };
    const direction = field === "latestWeekStart"
      ? "desc"
      : requestedDirection === "asc" || requestedDirection === "desc"
        ? requestedDirection
        : defaultDirection[field];
    const nulls = field === "latestBuyerMedian"
      ? "last"
      : field === "latestWeekStart" || (field === "latestRank" && direction === "desc")
        ? "first"
        : field === "latestRank" ? "last" : null;
    return { field, direction, nulls };
  }

  private productSortOrderBy(config: ProductSortConfig): Prisma.ProductBoardStatsOrderByWithRelationInput[] {
    let primary: Prisma.ProductBoardStatsOrderByWithRelationInput;
    if (config.field === "productName") {
      primary = { product: { productName: config.direction } };
    } else if (config.nulls) {
      primary = { [config.field]: { sort: config.direction, nulls: config.nulls } } as Prisma.ProductBoardStatsOrderByWithRelationInput;
    } else {
      primary = { [config.field]: config.direction } as Prisma.ProductBoardStatsOrderByWithRelationInput;
    }
    // A unique, fixed tie-breaker is required for a stable keyset boundary.
    return [primary, { productId: "asc" }];
  }

  private cursorFilterHash(where: Prisma.ProductBoardStatsWhereInput): string {
    return createHash("sha256").update(JSON.stringify(where)).digest("hex");
  }

  private decodeProductCursor(
    token: string,
    config: ProductSortConfig,
    boardType: ProductBoardType,
    filterHash: string,
  ): ProductCursorPayload {
    let payload: Partial<ProductCursorPayload>;
    try {
      if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("invalid token");
      payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<ProductCursorPayload>;
    } catch {
      throw new BadRequestException("分页游标无效，请返回第一页重新查询。");
    }
    if (!payload || typeof payload !== "object") {
      throw new BadRequestException("分页游标无效，请返回第一页重新查询。");
    }

    const value = payload.value;
    const validBase = payload.version === 1
      && typeof payload.productId === "string"
      && payload.productId.length > 0
      && payload.productId.length <= 80
      && payload.field === config.field
      && payload.direction === config.direction
      && payload.boardType === boardType
      && payload.filterHash === filterHash
      && (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value)));
    if (!validBase) throw new BadRequestException("分页游标已失效，筛选条件或排序已变化，请返回第一页重新查询。");

    if (value !== null) {
      const validValue = config.field === "productName"
        ? typeof value === "string"
        : config.field === "latestWeekStart"
          ? typeof value === "string" && !Number.isNaN(new Date(value).getTime())
          : config.field === "latestBuyerMedian"
            ? typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)
            : typeof value === "number" && Number.isFinite(value);
      if (!validValue) throw new BadRequestException("分页游标数据格式不正确，请返回第一页重新查询。");
    } else if (config.field === "productName") {
      throw new BadRequestException("分页游标数据格式不正确，请返回第一页重新查询。");
    }

    return payload as ProductCursorPayload;
  }

  private productCursorWhere(payload: ProductCursorPayload, config: ProductSortConfig): Prisma.ProductBoardStatsWhereInput {
    const field = config.field;
    const idAfter = { productId: { gt: payload.productId } };
    if (payload.value === null) {
      const remainingNulls = { AND: [{ [field]: null }, idAfter] } as Prisma.ProductBoardStatsWhereInput;
      // DESC sorts NULL first in PostgreSQL; after the final NULL row, all non-NULL values follow.
      return config.nulls === "first"
        ? { OR: [remainingNulls, { [field]: { not: null } }] } as Prisma.ProductBoardStatsWhereInput
        : remainingNulls;
    }

    const value = field === "latestWeekStart"
      ? new Date(payload.value as string)
      : field === "latestBuyerMedian"
        ? new Prisma.Decimal(payload.value as string)
        : payload.value;
    const comparison = config.direction === "asc" ? "gt" : "lt";
    const afterValue: Prisma.ProductBoardStatsWhereInput = field === "productName"
      ? { product: { productName: { [comparison]: value as string } } }
      : { [field]: { [comparison]: value } } as Prisma.ProductBoardStatsWhereInput;
    const sameValueAndId: Prisma.ProductBoardStatsWhereInput = field === "productName"
      ? { product: { productName: value as string }, ...idAfter }
      : { [field]: value, ...idAfter } as Prisma.ProductBoardStatsWhereInput;
    const alternatives: Prisma.ProductBoardStatsWhereInput[] = [afterValue, sameValueAndId];
    if (config.nulls === "last" && field !== "productName") {
      alternatives.push({ [field]: null } as Prisma.ProductBoardStatsWhereInput);
    }
    return { OR: alternatives };
  }

  private createProductCursor(
    row: any,
    config: ProductSortConfig,
    boardType: ProductBoardType,
    filterHash: string,
  ): string {
    const rawValue = config.field === "productName"
      ? row.product.productName
      : row[config.field];
    const value: string | number | null = rawValue === null || rawValue === undefined
      ? null
      : config.field === "latestWeekStart"
        ? (rawValue as Date).toISOString()
        : config.field === "latestBuyerMedian"
          ? String(rawValue)
          : rawValue as string | number;
    const payload: ProductCursorPayload = {
      version: 1,
      productId: row.productId,
      field: config.field,
      direction: config.direction,
      boardType,
      filterHash,
      value,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  private async findRecentTrendHistory(productIds: string[], boardType: ProductBoardType): Promise<ProductTrendHistoryRow[]> {
    if (!productIds.length) return [];
    return this.prisma.$queryRaw<ProductTrendHistoryRow[]>(Prisma.sql`
      WITH ranked_categories AS (
        SELECT
          h."商品ID" AS "productId",
          h."周开始日期" AS "weekStart",
          h."周结束日期" AS "weekEnd",
          h."支付买家数原值" AS "buyerRaw",
          h."支付买家数下限" AS "buyerMin",
          h."支付买家数上限" AS "buyerMax",
          h."支付买家数中值" AS "buyerMedian",
          h."类目名称" AS "categoryName",
          h."一级类目" AS "categoryLevel1",
          h."二级类目" AS "categoryLevel2",
          h."三级类目" AS "categoryLevel3",
          ROW_NUMBER() OVER (
            PARTITION BY h."商品ID", h."周开始日期"
            ORDER BY
              CASE WHEN h."二级类目" = ${NO_SECOND_LEVEL_CATEGORY} THEN 1 ELSE 0 END ASC,
              CASE WHEN h."三级类目" = ${NO_THIRD_LEVEL_CATEGORY} THEN 1 ELSE 0 END ASC,
              h."导出时间" DESC NULLS LAST,
              h."导入时间" DESC,
              h."类目名称" ASC
          ) AS "categoryRank"
        FROM "商品上榜历史表" h
        WHERE h."榜单类型" = CAST(${boardType} AS "榜单类型")
          AND h."商品ID" IN (${Prisma.join(productIds)})
      ), ranked_weeks AS (
        SELECT
          "productId", "weekStart", "weekEnd", "buyerRaw", "buyerMin", "buyerMax", "buyerMedian",
          "categoryName", "categoryLevel1", "categoryLevel2", "categoryLevel3",
          ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "weekStart" DESC) AS "weekRank"
        FROM ranked_categories
        WHERE "categoryRank" = 1
      )
      SELECT "productId", "weekStart", "weekEnd", "buyerRaw", "buyerMin", "buyerMax", "buyerMedian",
        "categoryName", "categoryLevel1", "categoryLevel2", "categoryLevel3"
      FROM ranked_weeks
      WHERE "weekRank" <= 12
      ORDER BY "productId" ASC, "weekStart" ASC
    `);
  }

  async list(query: ProductListQuery) {
    return this.withListQuerySlot("products.list", () => this.listWithSlot(query));
  }

  private async listWithSlot(query: ProductListQuery) {
    const requestedPage = Number(query.page ?? 1);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
    const requestedPageSize = Number(query.pageSize ?? 20);
    const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(10, Math.floor(requestedPageSize))) : 20;
    if (page > 1 && !query.cursor) {
      throw new BadRequestException("翻页游标缺失，请刷新商品列表后继续翻页。");
    }
    const boardType = query.boardType ?? "NEW_PRODUCT_TRAFFIC";
    const productConditions: Prisma.ProductWhereInput[] = [];
    const listingDate = this.listingDateFilter(query.listingDateFrom, query.listingDateTo);
    if (listingDate) productConditions.push({ listingDate });
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      productConditions.push({
        OR: [
          { productId: { contains: keyword } },
          { productName: { contains: keyword, mode: "insensitive" } },
          { shopName: { contains: keyword, mode: "insensitive" } },
        ],
      });
    }
    if (query.shopType) productConditions.push({ shopType: query.shopType });
    const aiWhere = aiMetricsStatusWhere(query.aiMetricsStatus);
    if (Object.keys(aiWhere).length) productConditions.push(aiWhere);
    if (query.favoritesOnly) productConditions.push({ favorites: { some: { userId: query.userId } } });

    const where: Prisma.ProductBoardStatsWhereInput = {
      boardType,
      product: { AND: productConditions },
    };
    if (query.categoryLevel1?.length) where.latestCategoryLevel1 = { in: query.categoryLevel1 };
    if (query.categoryLevel2?.length) where.latestCategoryLevel2 = { in: query.categoryLevel2 };
    if (query.categoryLevel3?.length) where.latestCategoryLevel3 = { in: query.categoryLevel3 };

    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        productConditions.push({
          periodStreaks: {
            some: {
              boardType,
              weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) },
              consecutiveWeekCount: {
                ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
                ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
              },
            },
          },
        });
      } else {
        productConditions.push({
          histories: {
            some: {
              boardType,
              weekStart: { in: selectedPeriods.map((value) => new Date(value + "T00:00:00.000Z")) },
            },
          },
        });
      }
    } else if (hasConsecutiveWeekRange) {
      where.consecutiveWeekCount = {
        ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
        ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
      };
    }
    if (query.latestBuyerMedianMin !== undefined || query.latestBuyerMedianMax !== undefined) {
      where.latestBuyerMedian = {
        ...(query.latestBuyerMedianMin !== undefined && Number.isFinite(query.latestBuyerMedianMin)
          ? { gte: new Prisma.Decimal(query.latestBuyerMedianMin) }
          : {}),
        ...(query.latestBuyerMedianMax !== undefined && Number.isFinite(query.latestBuyerMedianMax)
          ? { lte: new Prisma.Decimal(query.latestBuyerMedianMax) }
          : {}),
      };
    }
    if (query.historyWeekCountMin !== undefined || query.historyWeekCountMax !== undefined) {
      where.historyWeekCount = {
        ...(query.historyWeekCountMin !== undefined ? { gte: query.historyWeekCountMin } : {}),
        ...(query.historyWeekCountMax !== undefined ? { lte: query.historyWeekCountMax } : {}),
      };
    }

    const sortConfig = this.productSortConfig(query.sort, query.direction);
    const orderBy = this.productSortOrderBy(sortConfig);
    const filterHash = this.cursorFilterHash(where);
    const cursorPayload = query.cursor
      ? this.decodeProductCursor(query.cursor, sortConfig, boardType, filterHash)
      : undefined;
    const cursorWhere = cursorPayload ? this.productCursorWhere(cursorPayload, sortConfig) : undefined;
    const pageWhere: Prisma.ProductBoardStatsWhereInput = cursorWhere ? { AND: [where, cursorWhere] } : where;
    const fetchedItems = await this.prisma.productBoardStats.findMany({
      where: pageWhere,
      orderBy,
      take: pageSize + 1,
      include: { product: true },
    });
    const hasNextPage = fetchedItems.length > pageSize;
    const items = fetchedItems.slice(0, pageSize);
    const nextCursor = hasNextPage && items.length
      ? this.createProductCursor(items[items.length - 1], sortConfig, boardType, filterHash)
      : null;
    const total = await this.countWithShortCache(JSON.stringify(where), () => this.prisma.productBoardStats.count({ where }));

    const productIds = items.map((item) => item.productId);
    const [historyRows, favoriteRows] = await Promise.all([
      this.findRecentTrendHistory(productIds, boardType),
      productIds.length
        ? this.prisma.productFavorite.findMany({
          where: { userId: query.userId, productId: { in: productIds } },
          select: { productId: true },
        })
        : [],
    ]);
    const favoriteIds = new Set(favoriteRows.map((row) => row.productId));
    const trendByProduct = new Map<string, Array<{ weekStart: string; weekEnd: string; raw: string | null; min: number | null; max: number | null; median: number | null }>>();
    const preferredHistoryByProductWeek = new Map<string, (typeof historyRows)[number]>();
    for (const row of historyRows) {
      const weekKey = row.productId + "|" + row.weekStart.toISOString().slice(0, 10);
      preferredHistoryByProductWeek.set(weekKey, row);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({
        weekStart: row.weekStart.toISOString(),
        weekEnd: row.weekEnd.toISOString(),
        raw: row.buyerRaw,
        min: row.buyerMin === null ? null : Number(row.buyerMin),
        max: row.buyerMax === null ? null : Number(row.buyerMax),
        median: row.buyerMedian === null ? null : Number(row.buyerMedian),
      });
      trendByProduct.set(row.productId, trend);
    }

    return {
      items: items.map((item) => {
        const latestWeekKey = item.latestWeekStart
          ? item.productId + "|" + item.latestWeekStart.toISOString().slice(0, 10)
          : "";
        const preferredLatestHistory = preferredHistoryByProductWeek.get(latestWeekKey);
        return {
          ...mapProduct(item, item.product),
          ...(preferredLatestHistory ? {
            latestCategory: preferredLatestHistory.categoryName,
            latestCategoryLevel1: preferredLatestHistory.categoryLevel1,
            latestCategoryLevel2: preferredLatestHistory.categoryLevel2,
            latestCategoryLevel3: preferredLatestHistory.categoryLevel3,
          } : {}),
          isFavorited: favoriteIds.has(item.productId),
          buyerTrend: (trendByProduct.get(item.productId) ?? []).slice(-12),
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasPreviousPage: page > 1,
      hasNextPage,
      nextCursor,
    };
  }

  async listLegacy(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    categoryLevel1?: string[];
    categoryLevel2?: string[];
    categoryLevel3?: string[];
    shopType?: string;
    listingDateFrom?: string;
    listingDateTo?: string;
    latestWeekStarts?: string[];
    latestBuyerMedianMin?: number;
    latestBuyerMedianMax?: number;
    historyWeekCountMin?: number;
    historyWeekCountMax?: number;
    consecutiveWeekCountMin?: number;
    consecutiveWeekCountMax?: number;
    aiMetricsStatus?: AiMetricsStatus;
    favoritesOnly?: boolean;
    userId: string;
    sort?: string;
    direction?: string;
  }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize ?? 20)));
    const where: Prisma.ProductWhereInput = {};
    const listingDate = this.listingDateFilter(query.listingDateFrom, query.listingDateTo);
    if (listingDate) where.listingDate = listingDate;
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { productId: { contains: keyword } },
        { productName: { contains: keyword, mode: "insensitive" } },
        { shopName: { contains: keyword, mode: "insensitive" } },
      ];
    }
    if (query.categoryLevel1?.length) where.latestCategoryLevel1 = { in: query.categoryLevel1 };
    if (query.categoryLevel2?.length) where.latestCategoryLevel2 = { in: query.categoryLevel2 };
    if (query.categoryLevel3?.length) where.latestCategoryLevel3 = { in: query.categoryLevel3 };
    if (query.shopType) where.shopType = query.shopType;
    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        where.periodStreaks = {
          some: {
            boardType: "NEW_PRODUCT_TRAFFIC",
            weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) },
            consecutiveWeekCount: {
              ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
              ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
            },
          },
        };
      } else {
        where.histories = {
          some: { weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) } },
        };
      }
    } else if (hasConsecutiveWeekRange) {
      where.consecutiveWeekCount = {
        ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
        ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
      };
    }
    if (query.latestBuyerMedianMin !== undefined || query.latestBuyerMedianMax !== undefined) {
      where.latestBuyerMedian = {
        ...(query.latestBuyerMedianMin !== undefined && Number.isFinite(query.latestBuyerMedianMin)
          ? { gte: new Prisma.Decimal(query.latestBuyerMedianMin) }
          : {}),
        ...(query.latestBuyerMedianMax !== undefined && Number.isFinite(query.latestBuyerMedianMax)
          ? { lte: new Prisma.Decimal(query.latestBuyerMedianMax) }
          : {}),
      };
    }
    if (query.historyWeekCountMin !== undefined || query.historyWeekCountMax !== undefined) {
      where.historyWeekCount = {
        ...(query.historyWeekCountMin !== undefined ? { gte: query.historyWeekCountMin } : {}),
        ...(query.historyWeekCountMax !== undefined ? { lte: query.historyWeekCountMax } : {}),
      };
    }
    Object.assign(where, aiMetricsStatusWhere(query.aiMetricsStatus));
    if (query.favoritesOnly) where.favorites = { some: { userId: query.userId } };

    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      latestWeekStart: { latestWeekStart: "desc" },
      latestRank: { latestRank: query.direction === "desc" ? "desc" : "asc" },
      historyWeekCount: { historyWeekCount: query.direction === "asc" ? "asc" : "desc" },
      consecutiveWeekCount: { consecutiveWeekCount: query.direction === "asc" ? "asc" : "desc" },
      productName: { productName: query.direction === "desc" ? "desc" : "asc" },
      latestBuyerMedian: {
        latestBuyerMedian: {
          sort: query.direction === "asc" ? "asc" : "desc",
          nulls: "last",
        },
      },
    };
    const orderBy = sortMap[query.sort ?? "latestBuyerMedian"] ?? sortMap.latestBuyerMedian;
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.product.count({ where }),
    ]);

    const productIds = items.map((item) => item.productId);
    const [historyRows, favoriteRows] = await Promise.all([
      productIds.length
        ? this.prisma.productHistory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, weekStart: true, weekEnd: true, buyerRaw: true, buyerMin: true, buyerMax: true, buyerMedian: true, exportTime: true, categoryName: true },
      })
        : [],
      productIds.length
        ? this.prisma.productFavorite.findMany({
          where: { userId: query.userId, productId: { in: productIds } },
          select: { productId: true },
        })
        : [],
    ]);
    const favoriteIds = new Set(favoriteRows.map((row) => row.productId));
    historyRows.sort((a, b) => a.productId.localeCompare(b.productId)
      || a.weekStart.getTime() - b.weekStart.getTime()
      || (b.exportTime?.getTime() ?? 0) - (a.exportTime?.getTime() ?? 0)
      || a.categoryName.localeCompare(b.categoryName));
    const trendByProduct = new Map<string, Array<{ weekStart: string; weekEnd: string; raw: string | null; min: number | null; max: number | null; median: number | null }>>();
    const seenProductWeeks = new Set<string>();
    for (const row of historyRows) {
      const weekKey = `${row.productId}|${row.weekStart.toISOString().slice(0, 10)}`;
      if (seenProductWeeks.has(weekKey)) continue;
      seenProductWeeks.add(weekKey);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({
        weekStart: row.weekStart.toISOString(),
        weekEnd: row.weekEnd.toISOString(),
        raw: row.buyerRaw,
        min: row.buyerMin === null ? null : Number(row.buyerMin),
        max: row.buyerMax === null ? null : Number(row.buyerMax),
        median: row.buyerMedian === null ? null : Number(row.buyerMedian),
      });
      trendByProduct.set(row.productId, trend);
    }

    return {
      items: items.map((item) => ({ ...mapProduct(item), isFavorited: favoriteIds.has(item.productId), buyerTrend: (trendByProduct.get(item.productId) ?? []).slice(-12) })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async teamFavoritesLegacy(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    memberKeyword?: string;
    categoryLevel1?: string[];
    categoryLevel2?: string[];
    categoryLevel3?: string[];
    shopType?: string;
    listingDateFrom?: string;
    listingDateTo?: string;
    latestWeekStarts?: string[];
    latestBuyerMedianMin?: number;
    latestBuyerMedianMax?: number;
    historyWeekCountMin?: number;
    historyWeekCountMax?: number;
    consecutiveWeekCountMin?: number;
    consecutiveWeekCountMax?: number;
    aiMetricsStatus?: AiMetricsStatus;
    adminUserId: string;
  }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize ?? 50)));
    const memberConditions: Prisma.UserWhereInput[] = [
      { OR: [{ role: "EMPLOYEE" }, { id: query.adminUserId }] },
    ];
    if (query.memberKeyword?.trim()) {
      const memberKeyword = query.memberKeyword.trim();
      memberConditions.push({
        OR: [
          { name: { contains: memberKeyword, mode: "insensitive" } },
          { username: { contains: memberKeyword, mode: "insensitive" } },
          { department: { contains: memberKeyword, mode: "insensitive" } },
        ],
      });
    }
    const memberWhere: Prisma.UserWhereInput = { AND: memberConditions };
    const where: Prisma.ProductWhereInput = { favorites: { some: { user: memberWhere } } };
    const listingDate = this.listingDateFilter(query.listingDateFrom, query.listingDateTo);
    if (listingDate) where.listingDate = listingDate;
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { productId: { contains: keyword } },
        { productName: { contains: keyword, mode: "insensitive" } },
        { shopName: { contains: keyword, mode: "insensitive" } },
      ];
    }
    if (query.categoryLevel1?.length) where.latestCategoryLevel1 = { in: query.categoryLevel1 };
    if (query.categoryLevel2?.length) where.latestCategoryLevel2 = { in: query.categoryLevel2 };
    if (query.categoryLevel3?.length) where.latestCategoryLevel3 = { in: query.categoryLevel3 };
    if (query.shopType) where.shopType = query.shopType;
    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        where.periodStreaks = {
          some: {
            boardType: "NEW_PRODUCT_TRAFFIC",
            weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) },
            consecutiveWeekCount: {
              ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
              ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
            },
          },
        };
      } else {
        where.histories = {
          some: { weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) } },
        };
      }
    } else if (hasConsecutiveWeekRange) {
      where.consecutiveWeekCount = {
        ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
        ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
      };
    }
    if (query.latestBuyerMedianMin !== undefined || query.latestBuyerMedianMax !== undefined) {
      where.latestBuyerMedian = {
        ...(query.latestBuyerMedianMin !== undefined && Number.isFinite(query.latestBuyerMedianMin)
          ? { gte: new Prisma.Decimal(query.latestBuyerMedianMin) }
          : {}),
        ...(query.latestBuyerMedianMax !== undefined && Number.isFinite(query.latestBuyerMedianMax)
          ? { lte: new Prisma.Decimal(query.latestBuyerMedianMax) }
          : {}),
      };
    }
    if (query.historyWeekCountMin !== undefined || query.historyWeekCountMax !== undefined) {
      where.historyWeekCount = {
        ...(query.historyWeekCountMin !== undefined ? { gte: query.historyWeekCountMin } : {}),
        ...(query.historyWeekCountMax !== undefined ? { lte: query.historyWeekCountMax } : {}),
      };
    }
    Object.assign(where, aiMetricsStatusWhere(query.aiMetricsStatus));

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { latestBuyerMedian: { sort: "desc", nulls: "last" } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          favorites: {
            where: { user: memberWhere },
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, name: true, username: true, department: true } } },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const productIds = items.map((item) => item.productId);
    const [historyRows, adminFavorites] = await Promise.all([
      productIds.length ? this.prisma.productHistory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, weekStart: true, weekEnd: true, buyerRaw: true, buyerMin: true, buyerMax: true, buyerMedian: true, exportTime: true, categoryName: true },
      }) : [],
      productIds.length ? this.prisma.productFavorite.findMany({
        where: { userId: query.adminUserId, productId: { in: productIds } },
        select: { productId: true },
      }) : [],
    ]);
    historyRows.sort((a, b) => a.productId.localeCompare(b.productId)
      || a.weekStart.getTime() - b.weekStart.getTime()
      || (b.exportTime?.getTime() ?? 0) - (a.exportTime?.getTime() ?? 0)
      || a.categoryName.localeCompare(b.categoryName));
    const trendByProduct = new Map<string, Array<{ weekStart: string; weekEnd: string; raw: string | null; min: number | null; max: number | null; median: number | null }>>();
    const seenProductWeeks = new Set<string>();
    for (const row of historyRows) {
      const weekKey = `${row.productId}|${row.weekStart.toISOString().slice(0, 10)}`;
      if (seenProductWeeks.has(weekKey)) continue;
      seenProductWeeks.add(weekKey);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({
        weekStart: row.weekStart.toISOString(),
        weekEnd: row.weekEnd.toISOString(),
        raw: row.buyerRaw,
        min: row.buyerMin === null ? null : Number(row.buyerMin),
        max: row.buyerMax === null ? null : Number(row.buyerMax),
        median: row.buyerMedian === null ? null : Number(row.buyerMedian),
      });
      trendByProduct.set(row.productId, trend);
    }
    const adminFavoriteIds = new Set(adminFavorites.map((row) => row.productId));
    return {
      items: items.map((item) => ({
        ...mapProduct(item),
        isFavorited: adminFavoriteIds.has(item.productId),
        buyerTrend: (trendByProduct.get(item.productId) ?? []).slice(-12),
        favoriteCount: item.favorites.length,
        favoriteUsers: item.favorites.map((favorite) => ({
          userId: favorite.user.id,
          name: favorite.user.name,
          username: favorite.user.username,
          department: favorite.user.department,
          favoritedAt: favorite.createdAt.toISOString(),
        })),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async teamFavorites(query: TeamFavoritesQuery) {
    return this.withListQuerySlot("products.teamFavorites", () => this.teamFavoritesWithSlot(query));
  }

  private async teamFavoritesWithSlot(query: TeamFavoritesQuery) {
    const requestedPage = Number(query.page ?? 1);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
    const requestedPageSize = Number(query.pageSize ?? 50);
    const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(10, Math.floor(requestedPageSize))) : 50;
    if (page > 1 && !query.cursor) {
      throw new BadRequestException("翻页游标缺失，请刷新商品列表后继续翻页。");
    }
    const boardType = query.boardType ?? "NEW_PRODUCT_TRAFFIC";
    const memberConditions: Prisma.UserWhereInput[] = [
      { OR: [{ role: "EMPLOYEE" }, { id: query.adminUserId }] },
    ];
    if (query.memberKeyword?.trim()) {
      const memberKeyword = query.memberKeyword.trim();
      memberConditions.push({
        OR: [
          { name: { contains: memberKeyword, mode: "insensitive" } },
          { username: { contains: memberKeyword, mode: "insensitive" } },
          { department: { contains: memberKeyword, mode: "insensitive" } },
        ],
      });
    }
    const memberWhere: Prisma.UserWhereInput = { AND: memberConditions };
    const productConditions: Prisma.ProductWhereInput[] = [
      { favorites: { some: { user: memberWhere } } },
    ];
    const listingDate = this.listingDateFilter(query.listingDateFrom, query.listingDateTo);
    if (listingDate) productConditions.push({ listingDate });
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      productConditions.push({
        OR: [
          { productId: { contains: keyword } },
          { productName: { contains: keyword, mode: "insensitive" } },
          { shopName: { contains: keyword, mode: "insensitive" } },
        ],
      });
    }
    if (query.shopType) productConditions.push({ shopType: query.shopType });
    const aiWhere = aiMetricsStatusWhere(query.aiMetricsStatus);
    if (Object.keys(aiWhere).length) productConditions.push(aiWhere);

    const where: Prisma.ProductBoardStatsWhereInput = {
      boardType,
      product: { AND: productConditions },
    };
    if (query.categoryLevel1?.length) where.latestCategoryLevel1 = { in: query.categoryLevel1 };
    if (query.categoryLevel2?.length) where.latestCategoryLevel2 = { in: query.categoryLevel2 };
    if (query.categoryLevel3?.length) where.latestCategoryLevel3 = { in: query.categoryLevel3 };
    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        productConditions.push({
          periodStreaks: {
            some: {
              boardType,
              weekStart: { in: selectedPeriods.map((value) => new Date(`${value}T00:00:00.000Z`)) },
              consecutiveWeekCount: {
                ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
                ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
              },
            },
          },
        });
      } else {
        productConditions.push({
          histories: {
            some: {
              boardType,
              weekStart: { in: selectedPeriods.map((value) => new Date(value + "T00:00:00.000Z")) },
            },
          },
        });
      }
    } else if (hasConsecutiveWeekRange) {
      where.consecutiveWeekCount = {
        ...(query.consecutiveWeekCountMin !== undefined ? { gte: query.consecutiveWeekCountMin } : {}),
        ...(query.consecutiveWeekCountMax !== undefined ? { lte: query.consecutiveWeekCountMax } : {}),
      };
    }
    if (query.latestBuyerMedianMin !== undefined || query.latestBuyerMedianMax !== undefined) {
      where.latestBuyerMedian = {
        ...(query.latestBuyerMedianMin !== undefined && Number.isFinite(query.latestBuyerMedianMin)
          ? { gte: new Prisma.Decimal(query.latestBuyerMedianMin) }
          : {}),
        ...(query.latestBuyerMedianMax !== undefined && Number.isFinite(query.latestBuyerMedianMax)
          ? { lte: new Prisma.Decimal(query.latestBuyerMedianMax) }
          : {}),
      };
    }
    if (query.historyWeekCountMin !== undefined || query.historyWeekCountMax !== undefined) {
      where.historyWeekCount = {
        ...(query.historyWeekCountMin !== undefined ? { gte: query.historyWeekCountMin } : {}),
        ...(query.historyWeekCountMax !== undefined ? { lte: query.historyWeekCountMax } : {}),
      };
    }

    const sortConfig = this.productSortConfig("latestBuyerMedian", "desc");
    const filterHash = this.cursorFilterHash(where);
    const cursorPayload = query.cursor
      ? this.decodeProductCursor(query.cursor, sortConfig, boardType, filterHash)
      : undefined;
    const cursorWhere = cursorPayload ? this.productCursorWhere(cursorPayload, sortConfig) : undefined;
    const pageWhere: Prisma.ProductBoardStatsWhereInput = cursorWhere ? { AND: [where, cursorWhere] } : where;
    const fetchedItems = await this.prisma.productBoardStats.findMany({
      where: pageWhere,
      orderBy: this.productSortOrderBy(sortConfig),
      take: pageSize + 1,
      include: {
        product: {
          include: {
            favorites: {
              where: { user: memberWhere },
              orderBy: { createdAt: "desc" },
              include: { user: { select: { id: true, name: true, username: true, department: true } } },
            },
          },
        },
      },
    });
    const hasNextPage = fetchedItems.length > pageSize;
    const items = fetchedItems.slice(0, pageSize);
    const nextCursor = hasNextPage && items.length
      ? this.createProductCursor(items[items.length - 1], sortConfig, boardType, filterHash)
      : null;
    const total = await this.countWithShortCache(JSON.stringify(where), () => this.prisma.productBoardStats.count({ where }));
    const productIds = items.map((item) => item.productId);
    const [historyRows, adminFavorites] = await Promise.all([
      this.findRecentTrendHistory(productIds, boardType),
      productIds.length ? this.prisma.productFavorite.findMany({
        where: { userId: query.adminUserId, productId: { in: productIds } },
        select: { productId: true },
      }) : [],
    ]);
    const trendByProduct = new Map<string, Array<{ weekStart: string; weekEnd: string; raw: string | null; min: number | null; max: number | null; median: number | null }>>();
    const preferredHistoryByProductWeek = new Map<string, (typeof historyRows)[number]>();
    for (const row of historyRows) {
      const weekKey = row.productId + "|" + row.weekStart.toISOString().slice(0, 10);
      preferredHistoryByProductWeek.set(weekKey, row);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({
        weekStart: row.weekStart.toISOString(),
        weekEnd: row.weekEnd.toISOString(),
        raw: row.buyerRaw,
        min: row.buyerMin === null ? null : Number(row.buyerMin),
        max: row.buyerMax === null ? null : Number(row.buyerMax),
        median: row.buyerMedian === null ? null : Number(row.buyerMedian),
      });
      trendByProduct.set(row.productId, trend);
    }
    const adminFavoriteIds = new Set(adminFavorites.map((row) => row.productId));
    return {
      items: items.map((item) => {
        const latestWeekKey = item.latestWeekStart
          ? item.productId + "|" + item.latestWeekStart.toISOString().slice(0, 10)
          : "";
        const preferredLatestHistory = preferredHistoryByProductWeek.get(latestWeekKey);
        return {
          ...mapProduct(item, item.product),
          ...(preferredLatestHistory ? {
            latestCategory: preferredLatestHistory.categoryName,
            latestCategoryLevel1: preferredLatestHistory.categoryLevel1,
            latestCategoryLevel2: preferredLatestHistory.categoryLevel2,
            latestCategoryLevel3: preferredLatestHistory.categoryLevel3,
          } : {}),
          isFavorited: adminFavoriteIds.has(item.productId),
          buyerTrend: (trendByProduct.get(item.productId) ?? []).slice(-12),
          favoriteCount: item.product.favorites.length,
          favoriteUsers: item.product.favorites.map((favorite) => ({
            userId: favorite.user.id,
            name: favorite.user.name,
            username: favorite.user.username,
            department: favorite.user.department,
            favoritedAt: favorite.createdAt.toISOString(),
          })),
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasPreviousPage: page > 1,
      hasNextPage,
      nextCursor,
    };
  }

  async periods(boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC") {
    const rows = await this.prisma.productHistory.findMany({
      where: { boardType },
      distinct: ["weekStart"],
      orderBy: { weekStart: "desc" },
      select: { weekStart: true },
    });
    return { periods: rows.map((row) => row.weekStart.toISOString().slice(0, 10)) };
  }

  async categories(
    level1?: string[],
    level2?: string[],
    boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC",
  ) {
    const selectedLevel1 = [...new Set(level1 ?? [])].filter(Boolean);
    const selectedLevel2 = [...new Set(level2 ?? [])].filter(Boolean);
    const rows = await this.prisma.productHistory.groupBy({
      by: ["categoryLevel1", "categoryLevel2", "categoryLevel3"],
      where: { boardType },
      orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }, { categoryLevel3: "asc" }],
    });
    return {
      level1: [...new Set(rows.map((row) => row.categoryLevel1))],
      level2: selectedLevel1.length
        ? [...new Set(rows.filter((row) => selectedLevel1.includes(row.categoryLevel1)).map((row) => row.categoryLevel2))]
        : [],
      level3: selectedLevel1.length && selectedLevel2.length
        ? [...new Set(rows.filter((row) => selectedLevel1.includes(row.categoryLevel1) && selectedLevel2.includes(row.categoryLevel2)).map((row) => row.categoryLevel3))]
        : [],
    };
  }

  async detail(productId: string, boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC") {
    const product = await this.prisma.product.findUnique({
      where: { productId },
      include: {
        histories: {
          where: { boardType },
          orderBy: [{ weekStart: "asc" }, { exportTime: "asc" }],
        },
        boardStats: { where: { boardType } },
      },
    });
    const stats = product?.boardStats[0];
    if (!product || !stats) throw new NotFoundException("该商品在当前榜单中没有历史记录。");
    const histories = product.histories.map((row) => ({
      id: row.id,
      weekStart: row.weekStart.toISOString(),
      weekEnd: row.weekEnd.toISOString(),
      categoryName: row.categoryName,
      categoryLevel1: row.categoryLevel1,
      categoryLevel2: row.categoryLevel2,
      categoryLevel3: row.categoryLevel3,
      rank: row.rank,
      trend: row.trend,
      visitor: range(row.visitorRaw, row.visitorMin, row.visitorMax, row.visitorMedian),
      buyer: range(row.buyerRaw, row.buyerMin, row.buyerMax, row.buyerMedian),
      exportTime: row.exportTime?.toISOString() ?? null,
      sourceFileName: row.sourceFileName,
    }));
    return { product: mapProduct(stats, product), histories };
  }

  async periodsLegacy() {
    const rows = await this.prisma.productHistory.findMany({
      distinct: ["weekStart"],
      orderBy: { weekStart: "desc" },
      select: { weekStart: true },
    });
    return { periods: rows.map((row) => row.weekStart.toISOString().slice(0, 10)) };
  }

  async importAiMetrics(productIdsInput: unknown, markdownInput: unknown) {
    if (!Array.isArray(productIdsInput)) throw new BadRequestException("商品ID列表格式不正确。");
    const productIds = [...new Set(productIdsInput.map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (!productIds.length) throw new BadRequestException("请至少提供一个商品ID。");
    if (productIds.length > 50) throw new BadRequestException("单批最多只能导入50个商品ID。");
    if (productIds.some((id) => !/^\d{6,20}$/.test(id))) throw new BadRequestException("商品ID必须为6至20位数字。");
    if (typeof markdownInput !== "string" || !markdownInput.trim()) throw new BadRequestException("AI管家没有返回可解析的Markdown表格。");
    if (markdownInput.length > 300_000) throw new BadRequestException("AI管家返回内容过长，已拒绝导入。");

    const parsed = parseAiMetricsMarkdown(markdownInput, productIds);
    if (parsed.errors.length) {
      throw new BadRequestException({ message: "AI管家返回的表格格式不符合要求，未写入本批数据。", errors: parsed.errors });
    }
    if (!parsed.rows.length) throw new BadRequestException("AI管家返回的表格中没有匹配到本批商品。");

    const existing = await this.prisma.product.findMany({
      where: { productId: { in: parsed.rows.map((row) => row.productId) } },
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((row) => row.productId));
    const rowsToSave = parsed.rows.filter((row) => existingIds.has(row.productId));

    if (rowsToSave.length) {
      await this.prisma.$transaction(rowsToSave.map((row) => this.prisma.product.update({
        where: { productId: row.productId },
        data: {
          aiPreviousSales: row.previousSales,
          aiSales: row.sales,
          aiClickRate: row.clickRate,
          aiConversionRate: row.conversionRate,
          aiAddToCartRate: row.addToCartRate,
          aiAddToCartCost: row.addToCartCost,
          aiRoi: row.roi,
          aiUnitPrice: row.unitPrice,
          aiSpend: row.spend,
          aiCpc: row.cpc,
          aiMetricsFetchedAt: new Date(),
        },
      })));
    }

    const savedProductIds = rowsToSave.map((row) => row.productId);
    return {
      requestedCount: productIds.length,
      parsedCount: parsed.rows.length,
      savedCount: savedProductIds.length,
      savedProductIds,
      missingAiProductIds: parsed.missingProductIds,
      missingDatabaseProductIds: parsed.rows.filter((row) => !existingIds.has(row.productId)).map((row) => row.productId),
    };
  }

  async favorite(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { productId }, select: { productId: true } });
    if (!product) throw new NotFoundException("没有找到这件商品。");
    await this.prisma.productFavorite.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
    return { productId, isFavorited: true };
  }

  async unfavorite(userId: string, productId: string) {
    await this.prisma.productFavorite.deleteMany({ where: { userId, productId } });
    return { productId, isFavorited: false };
  }

  async categoriesLegacy(level1?: string[], level2?: string[]) {
    const selectedLevel1 = [...new Set(level1 ?? [])].filter(Boolean);
    const selectedLevel2 = [...new Set(level2 ?? [])].filter(Boolean);
    const rows = await this.prisma.category.findMany({
      // 一级类目始终完整返回；二级、三级选项按已选上级逐级收窄。
      where: { enabled: true },
      orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }, { categoryLevel3: "asc" }],
      select: { categoryLevel1: true, categoryLevel2: true, categoryLevel3: true },
    });
    return {
      level1: [...new Set(rows.map((row) => row.categoryLevel1))],
      level2: selectedLevel1.length
        ? [...new Set(rows.filter((row) => selectedLevel1.includes(row.categoryLevel1)).map((row) => row.categoryLevel2).filter((value): value is string => Boolean(value)))]
        : [],
      level3: selectedLevel1.length && selectedLevel2.length
        ? [...new Set(rows.filter((row) => selectedLevel1.includes(row.categoryLevel1) && row.categoryLevel2 !== null && selectedLevel2.includes(row.categoryLevel2)).map((row) => row.categoryLevel3).filter((value): value is string => Boolean(value)))]
        : [],
    };
  }

  async detailLegacy(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { productId },
      include: { histories: { orderBy: [{ weekStart: "asc" }, { exportTime: "asc" }] } },
    });
    if (!product) throw new NotFoundException("没有找到这件商品。");
    const histories = product.histories.map((row) => ({
      id: row.id,
      weekStart: row.weekStart.toISOString(),
      weekEnd: row.weekEnd.toISOString(),
      categoryName: row.categoryName,
      categoryLevel1: row.categoryLevel1,
      categoryLevel2: row.categoryLevel2,
      categoryLevel3: row.categoryLevel3,
      rank: row.rank,
      trend: row.trend,
      visitor: range(row.visitorRaw, row.visitorMin, row.visitorMax, row.visitorMedian),
      buyer: range(row.buyerRaw, row.buyerMin, row.buyerMax, row.buyerMedian),
      cart: range(row.cartRaw, row.cartMin, row.cartMax, row.cartMedian),
      exportTime: row.exportTime?.toISOString() ?? null,
      sourceFileName: row.sourceFileName,
    }));
    return { product: mapProduct(product), histories };
  }
}
