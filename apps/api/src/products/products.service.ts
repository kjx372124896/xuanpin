import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseAiMetricsMarkdown } from "./ai-metrics-parser";
import { aiMetricsStatusWhere, type AiMetricsStatus } from "./ai-metrics-status";

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

  async list(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    categoryLevel1?: string;
    categoryLevel2?: string;
    shopType?: string;
    latestWeekStarts?: string[];
    latestBuyerMedianGt?: number;
    historyWeekCountMin?: number;
    consecutiveWeekCountMin?: number;
    aiMetricsStatus?: AiMetricsStatus;
    favoritesOnly?: boolean;
    userId: string;
    sort?: string;
    direction?: string;
  }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize ?? 20)));
    const where: Prisma.ProductWhereInput = {};
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { productId: { contains: keyword } },
        { productName: { contains: keyword, mode: "insensitive" } },
        { shopName: { contains: keyword, mode: "insensitive" } },
      ];
    }
    if (query.categoryLevel1) where.latestCategoryLevel1 = query.categoryLevel1;
    if (query.categoryLevel2) where.latestCategoryLevel2 = query.categoryLevel2;
    if (query.shopType) where.shopType = query.shopType;
    if (query.latestWeekStarts?.length) {
      where.latestWeekStart = { in: query.latestWeekStarts.map((value) => new Date(value + "T00:00:00.000Z")) };
    }
    if (query.latestBuyerMedianGt !== undefined && Number.isFinite(query.latestBuyerMedianGt)) {
      where.latestBuyerMedian = { gt: new Prisma.Decimal(query.latestBuyerMedianGt) };
    }
    if (query.historyWeekCountMin !== undefined) where.historyWeekCount = { gte: query.historyWeekCountMin };
    if (query.consecutiveWeekCountMin !== undefined) where.consecutiveWeekCount = { gte: query.consecutiveWeekCountMin };
    Object.assign(where, aiMetricsStatusWhere(query.aiMetricsStatus));
    if (query.favoritesOnly) where.favorites = { some: { userId: query.userId } };

    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      latestWeekStart: { latestWeekStart: "desc" },
      latestRank: { latestRank: query.direction === "desc" ? "desc" : "asc" },
      historyWeekCount: { historyWeekCount: query.direction === "asc" ? "asc" : "desc" },
      consecutiveWeekCount: { consecutiveWeekCount: query.direction === "asc" ? "asc" : "desc" },
      productName: { productName: query.direction === "desc" ? "desc" : "asc" },
      latestBuyerMedian: { latestBuyerMedian: query.direction === "asc" ? "asc" : "desc" },
    };
    const orderBy = sortMap[query.sort ?? "latestWeekStart"] ?? sortMap.latestWeekStart;
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.product.count({ where }),
    ]);

    const productIds = items.map((item) => item.productId);
    const [historyRows, favoriteRows] = await Promise.all([
      productIds.length
        ? this.prisma.productHistory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, weekStart: true, buyerMedian: true, exportTime: true, categoryName: true },
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
    const trendByProduct = new Map<string, Array<{ weekStart: string; median: number | null }>>();
    const seenProductWeeks = new Set<string>();
    for (const row of historyRows) {
      const weekKey = `${row.productId}|${row.weekStart.toISOString().slice(0, 10)}`;
      if (seenProductWeeks.has(weekKey)) continue;
      seenProductWeeks.add(weekKey);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({
        weekStart: row.weekStart.toISOString(),
        median: row.buyerMedian === null ? null : Number(row.buyerMedian),
      });
      trendByProduct.set(row.productId, trend);
    }

    return {
      items: items.map((item) => ({ ...mapProduct(item), isFavorited: favoriteIds.has(item.productId), buyerTrend: trendByProduct.get(item.productId) ?? [] })),
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
    categoryLevel1?: string;
    categoryLevel2?: string;
    shopType?: string;
    latestWeekStarts?: string[];
    latestBuyerMedianGt?: number;
    historyWeekCountMin?: number;
    consecutiveWeekCountMin?: number;
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
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { productId: { contains: keyword } },
        { productName: { contains: keyword, mode: "insensitive" } },
        { shopName: { contains: keyword, mode: "insensitive" } },
      ];
    }
    if (query.categoryLevel1) where.latestCategoryLevel1 = query.categoryLevel1;
    if (query.categoryLevel2) where.latestCategoryLevel2 = query.categoryLevel2;
    if (query.shopType) where.shopType = query.shopType;
    if (query.latestWeekStarts?.length) where.latestWeekStart = { in: query.latestWeekStarts.map((value) => new Date(value + "T00:00:00.000Z")) };
    if (query.latestBuyerMedianGt !== undefined && Number.isFinite(query.latestBuyerMedianGt)) {
      where.latestBuyerMedian = { gt: new Prisma.Decimal(query.latestBuyerMedianGt) };
    }
    if (query.historyWeekCountMin !== undefined) where.historyWeekCount = { gte: query.historyWeekCountMin };
    if (query.consecutiveWeekCountMin !== undefined) where.consecutiveWeekCount = { gte: query.consecutiveWeekCountMin };
    Object.assign(where, aiMetricsStatusWhere(query.aiMetricsStatus));

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { latestWeekStart: "desc" },
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
        select: { productId: true, weekStart: true, buyerMedian: true, exportTime: true, categoryName: true },
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
    const trendByProduct = new Map<string, Array<{ weekStart: string; median: number | null }>>();
    const seenProductWeeks = new Set<string>();
    for (const row of historyRows) {
      const weekKey = `${row.productId}|${row.weekStart.toISOString().slice(0, 10)}`;
      if (seenProductWeeks.has(weekKey)) continue;
      seenProductWeeks.add(weekKey);
      const trend = trendByProduct.get(row.productId) ?? [];
      trend.push({ weekStart: row.weekStart.toISOString(), median: row.buyerMedian === null ? null : Number(row.buyerMedian) });
      trendByProduct.set(row.productId, trend);
    }
    const adminFavoriteIds = new Set(adminFavorites.map((row) => row.productId));
    return {
      items: items.map((item) => ({
        ...mapProduct(item),
        isFavorited: adminFavoriteIds.has(item.productId),
        buyerTrend: trendByProduct.get(item.productId) ?? [],
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
    const rows = await this.prisma.product.findMany({
      where: { latestWeekStart: { not: null } },
      distinct: ["latestWeekStart"],
      orderBy: { latestWeekStart: "desc" },
      select: { latestWeekStart: true },
    });
    return { periods: rows.map((row) => row.latestWeekStart!.toISOString().slice(0, 10)) };
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

  async categories(level1?: string) {
    const rows = await this.prisma.category.findMany({
      where: { enabled: true, ...(level1 ? { categoryLevel1: level1 } : {}) },
      orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }],
      select: { categoryLevel1: true, categoryLevel2: true },
    });
    return {
      level1: [...new Set(rows.map((row) => row.categoryLevel1))],
      level2: level1 ? [...new Set(rows.map((row) => row.categoryLevel2).filter((value): value is string => Boolean(value)))] : [],
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
