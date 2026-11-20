import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseAiMetricsMarkdown } from "./ai-metrics-parser";
import { aiMetricsStatusWhere, type AiMetricsStatus } from "./ai-metrics-status";
import { consecutiveWeekCountEndingAt, isConsecutiveWeekCountInRange } from "./consecutive-week-filter";
import { calculateListingDate } from "./listing-date";

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

function mapProduct(product: any) {
  return {
    productId: product.productId,
    listingDate: calculateListingDate(product.productId),
    productName: product.productName,
    productUrl: product.productUrl,
    shopName: product.shopName,
    shopType: product.shopType,
    imageUrl: product.imageUrl,
    latestCategory: product.latestCategory,
    latestCategoryLevel1: product.latestCategoryLevel1,
    latestCategoryLevel2: product.latestCategoryLevel2,
    latestWeekStart: product.latestWeekStart?.toISOString() ?? null,
    latestWeekEnd: product.latestWeekEnd?.toISOString() ?? null,
    latestRank: product.latestRank,
    historyWeekCount: product.historyWeekCount,
    historyRecordCount: product.historyRecordCount,
    consecutiveWeekCount: product.consecutiveWeekCount,
    firstWeekStart: product.firstWeekStart?.toISOString() ?? null,
    visitor: range(product.latestVisitorRaw, product.latestVisitorMin, product.latestVisitorMax, product.latestVisitorMedian),
    buyer: range(product.latestBuyerRaw, product.latestBuyerMin, product.latestBuyerMax, product.latestBuyerMedian),
    cart: range(product.latestCartRaw, product.latestCartMin, product.latestCartMax, product.latestCartMedian),
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

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 以筛选器选中的上榜周期为终点，按每个商品的历史周记录向前回溯。
   * 同一商品在一个周期命中多个类目时，只按一个上榜周计算。
   */
  private async findProductsByConsecutiveWeeksAtPeriods(
    periods: string[],
    min?: number,
    max?: number,
  ): Promise<string[]> {
    if (!periods.length) return [];

    const selectedPeriods = periods.map((value) => Prisma.sql`(${value}::date)`);
    const rows = await this.prisma.$queryRaw<Array<{
      productId: string;
      anchorDate: string;
      weekStarts: string[];
    }>>(Prisma.sql`
      WITH selected_periods("anchor_date") AS (
        VALUES ${Prisma.join(selectedPeriods)}
      ),
      anchor_products AS (
        SELECT DISTINCT h."商品ID", sp."anchor_date"
        FROM "商品上榜历史表" h
        INNER JOIN selected_periods sp ON h."周开始日期" = sp."anchor_date"
      ),
      history_weeks AS (
        SELECT DISTINCT "商品ID", "周开始日期"
        FROM "商品上榜历史表"
      )
      SELECT
        a."商品ID" AS "productId",
        to_char(a."anchor_date", 'YYYY-MM-DD') AS "anchorDate",
        ARRAY_AGG(to_char(hw."周开始日期", 'YYYY-MM-DD') ORDER BY hw."周开始日期" DESC) AS "weekStarts"
      FROM anchor_products a
      INNER JOIN history_weeks hw
        ON hw."商品ID" = a."商品ID"
       AND hw."周开始日期" <= a."anchor_date"
      GROUP BY a."商品ID", a."anchor_date"
    `);

    const matchingProductIds = new Set<string>();
    for (const row of rows) {
      const count = consecutiveWeekCountEndingAt(row.anchorDate, row.weekStarts);
      if (isConsecutiveWeekCountInRange(count, min, max)) {
        matchingProductIds.add(row.productId);
      }
    }
    return [...matchingProductIds];
  }

  /** 按商品ID推算出的上架日期筛选；SQL ROUND 与 Excel ROUND 一样按半值远离0取整。 */
  private async findProductIdsByListingDateRange(fromValue?: string, toValue?: string): Promise<string[] | undefined> {
    const normalizeDate = (value?: string) => {
      if (value === undefined || value === "") return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("上架日期格式不正确。");
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException("上架日期无效。");
      }
      return value;
    };
    const from = normalizeDate(fromValue);
    const to = normalizeDate(toValue);
    if (!from && !to) return undefined;
    if (from && to && from > to) throw new BadRequestException("上架日期范围的开始日期不能晚于结束日期。");

    const listingDayOffset = Prisma.sql`ROUND((p."商品ID"::numeric - 1070000000000::numeric) / 278550000::numeric)`;
    const rows = await this.prisma.$queryRaw<Array<{ productId: string }>>(Prisma.sql`
      SELECT p."商品ID" AS "productId"
      FROM "商品主表" p
      WHERE p."商品ID" ~ '^[0-9]+$'
      ${from ? Prisma.sql`AND ${listingDayOffset} >= (${from}::date - DATE '2026-07-29')` : Prisma.empty}
      ${to ? Prisma.sql`AND ${listingDayOffset} <= (${to}::date - DATE '2026-07-29')` : Prisma.empty}
    `);
    return rows.map((row) => row.productId);
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    categoryLevel1?: string[];
    categoryLevel2?: string[];
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
    const listingDateProductIds = await this.findProductIdsByListingDateRange(query.listingDateFrom, query.listingDateTo);
    if (listingDateProductIds !== undefined) where.AND = [{ productId: { in: listingDateProductIds } }];
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
    if (query.shopType) where.shopType = query.shopType;
    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        where.productId = {
          in: await this.findProductsByConsecutiveWeeksAtPeriods(
            selectedPeriods,
            query.consecutiveWeekCountMin,
            query.consecutiveWeekCountMax,
          ),
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

  async teamFavorites(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    memberKeyword?: string;
    categoryLevel1?: string[];
    categoryLevel2?: string[];
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
    const listingDateProductIds = await this.findProductIdsByListingDateRange(query.listingDateFrom, query.listingDateTo);
    if (listingDateProductIds !== undefined) where.AND = [{ productId: { in: listingDateProductIds } }];
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
    if (query.shopType) where.shopType = query.shopType;
    const selectedPeriods = normalizePeriodStarts(query.latestWeekStarts);
    const hasConsecutiveWeekRange = query.consecutiveWeekCountMin !== undefined || query.consecutiveWeekCountMax !== undefined;
    if (query.latestWeekStarts?.length) {
      if (hasConsecutiveWeekRange) {
        where.productId = {
          in: await this.findProductsByConsecutiveWeeksAtPeriods(
            selectedPeriods,
            query.consecutiveWeekCountMin,
            query.consecutiveWeekCountMax,
          ),
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

  async periods() {
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

  async categories(level1?: string[]) {
    const selectedLevel1 = [...new Set(level1 ?? [])].filter(Boolean);
    const rows = await this.prisma.category.findMany({
      // 一级类目选项必须始终完整返回；选中项只用于收窄二级类目选项。
      where: { enabled: true },
      orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }],
      select: { categoryLevel1: true, categoryLevel2: true },
    });
    return {
      level1: [...new Set(rows.map((row) => row.categoryLevel1))],
      level2: selectedLevel1.length
        ? [...new Set(rows.filter((row) => selectedLevel1.includes(row.categoryLevel1)).map((row) => row.categoryLevel2).filter((value): value is string => Boolean(value)))]
        : [],
    };
  }

  async detail(productId: string) {
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
