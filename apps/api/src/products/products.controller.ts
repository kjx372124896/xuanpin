import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ProductsService } from "./products.service";
import type { AuthenticatedRequest } from "../auth/request-user";
import { Roles } from "../auth/auth.decorators";

function parseBoardType(value: unknown): "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" {
  if (value === undefined || value === null || value === "") return "NEW_PRODUCT_TRAFFIC";
  if (value === "NEW_PRODUCT_TRAFFIC" || value === "TRANSACTION_GROWTH") return value;
  throw new BadRequestException("榜单类型无效。");
}

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get() list(@Query() query: any, @Req() request: AuthenticatedRequest) {
    const numeric = (value: unknown) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const latestWeekStarts = typeof query.latestWeekStarts === "string"
      ? query.latestWeekStarts.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.latestWeekStarts) ? query.latestWeekStarts.map(String) : undefined;
    const categoryLevel1 = typeof query.categoryLevel1 === "string"
      ? query.categoryLevel1.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.categoryLevel1) ? query.categoryLevel1.map(String).filter(Boolean) : undefined;
    const categoryLevel2 = typeof query.categoryLevel2 === "string"
      ? query.categoryLevel2.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.categoryLevel2) ? query.categoryLevel2.map(String).filter(Boolean) : undefined;
    return this.productsService.list({
      ...query,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      latestWeekStarts,
      categoryLevel1,
      categoryLevel2,
      listingDateFrom: typeof query.listingDateFrom === "string" ? query.listingDateFrom : undefined,
      listingDateTo: typeof query.listingDateTo === "string" ? query.listingDateTo : undefined,
      latestBuyerMedianMin: numeric(query.latestBuyerMedianMin),
      latestBuyerMedianMax: numeric(query.latestBuyerMedianMax),
      historyWeekCountMin: numeric(query.historyWeekCountMin),
      historyWeekCountMax: numeric(query.historyWeekCountMax),
      consecutiveWeekCountMin: numeric(query.consecutiveWeekCountMin),
      consecutiveWeekCountMax: numeric(query.consecutiveWeekCountMax),
      aiMetricsStatus: query.aiMetricsStatus === "NOT_FETCHED" || query.aiMetricsStatus === "FETCHED" ? query.aiMetricsStatus : undefined,
      favoritesOnly: query.favoritesOnly === "true" || query.favoritesOnly === true,
      boardType: parseBoardType(query.boardType),
      userId: request.user.id,
    });
  }
  @Roles("ADMIN", "SUPER_ADMIN")
  @Get("team-favorites") teamFavorites(@Query() query: any, @Req() request: AuthenticatedRequest) {
    const numeric = (value: unknown) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const latestWeekStarts = typeof query.latestWeekStarts === "string"
      ? query.latestWeekStarts.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.latestWeekStarts) ? query.latestWeekStarts.map(String) : undefined;
    const categoryLevel1 = typeof query.categoryLevel1 === "string"
      ? query.categoryLevel1.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.categoryLevel1) ? query.categoryLevel1.map(String).filter(Boolean) : undefined;
    const categoryLevel2 = typeof query.categoryLevel2 === "string"
      ? query.categoryLevel2.split(",").map((value: string) => value.trim()).filter(Boolean)
      : Array.isArray(query.categoryLevel2) ? query.categoryLevel2.map(String).filter(Boolean) : undefined;
    return this.productsService.teamFavorites({
      ...query,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      latestWeekStarts,
      categoryLevel1,
      categoryLevel2,
      listingDateFrom: typeof query.listingDateFrom === "string" ? query.listingDateFrom : undefined,
      listingDateTo: typeof query.listingDateTo === "string" ? query.listingDateTo : undefined,
      latestBuyerMedianMin: numeric(query.latestBuyerMedianMin),
      latestBuyerMedianMax: numeric(query.latestBuyerMedianMax),
      historyWeekCountMin: numeric(query.historyWeekCountMin),
      historyWeekCountMax: numeric(query.historyWeekCountMax),
      consecutiveWeekCountMin: numeric(query.consecutiveWeekCountMin),
      consecutiveWeekCountMax: numeric(query.consecutiveWeekCountMax),
      aiMetricsStatus: query.aiMetricsStatus === "NOT_FETCHED" || query.aiMetricsStatus === "FETCHED" ? query.aiMetricsStatus : undefined,
      boardType: parseBoardType(query.boardType),
      adminUserId: request.user.id,
    });
  }
  @Get("categories") categories(@Query("level1") level1?: string | string[], @Query("boardType") boardType?: string) {
    const levels = typeof level1 === "string"
      ? level1.split(",").map((value) => value.trim()).filter(Boolean)
      : Array.isArray(level1) ? level1.map(String).filter(Boolean) : undefined;
    return this.productsService.categories(levels, parseBoardType(boardType));
  }
  @Get("periods") periods(@Query("boardType") boardType?: string) { return this.productsService.periods(parseBoardType(boardType)); }
  @Roles("ADMIN", "SUPER_ADMIN")
  @Post("ai-metrics/import") importAiMetrics(@Body() body: { productIds?: unknown; markdown?: unknown } | undefined) {
    return this.productsService.importAiMetrics(body?.productIds, body?.markdown);
  }
  @Post(":productId/favorite") favorite(@Param("productId") productId: string, @Req() request: AuthenticatedRequest) {
    return this.productsService.favorite(request.user.id, productId);
  }
  @Delete(":productId/favorite") unfavorite(@Param("productId") productId: string, @Req() request: AuthenticatedRequest) {
    return this.productsService.unfavorite(request.user.id, productId);
  }
  @Get(":productId") detail(@Param("productId") productId: string, @Query("boardType") boardType?: string) {
    return this.productsService.detail(productId, parseBoardType(boardType));
  }
}
