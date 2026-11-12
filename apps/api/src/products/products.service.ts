import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

  async periods() {
    const rows = await this.prisma.product.findMany({
      where: { latestWeekStart: { not: null } },
      distinct: ["latestWeekStart"],
      orderBy: { latestWeekStart: "desc" },
      select: { latestWeekStart: true },
    });
    return { periods: rows.map((row) => row.latestWeekStart!.toISOString().slice(0, 10)) };
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
