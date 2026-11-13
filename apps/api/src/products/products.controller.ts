import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ProductsService } from "./products.service";
import type { AuthenticatedRequest } from "../auth/request-user";
import { Roles } from "../auth/auth.decorators";

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
    return this.productsService.list({
      ...query,
      latestWeekStarts,
      latestBuyerMedianGt: numeric(query.latestBuyerMedianGt),
      historyWeekCountMin: numeric(query.historyWeekCountMin),
      consecutiveWeekCountMin: numeric(query.consecutiveWeekCountMin),
      aiMetricsStatus: query.aiMetricsStatus === "NOT_FETCHED" || query.aiMetricsStatus === "FETCHED" ? query.aiMetricsStatus : undefined,
      favoritesOnly: query.favoritesOnly === "true" || query.favoritesOnly === true,
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
    return this.productsService.teamFavorites({
      ...query,
      latestWeekStarts,
      latestBuyerMedianGt: numeric(query.latestBuyerMedianGt),
      historyWeekCountMin: numeric(query.historyWeekCountMin),
      consecutiveWeekCountMin: numeric(query.consecutiveWeekCountMin),
      aiMetricsStatus: query.aiMetricsStatus === "NOT_FETCHED" || query.aiMetricsStatus === "FETCHED" ? query.aiMetricsStatus : undefined,
      adminUserId: request.user.id,
    });
  }
  @Get("categories") categories(@Query("level1") level1?: string) { return this.productsService.categories(level1); }
  @Get("periods") periods() { return this.productsService.periods(); }
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
  @Get(":productId") detail(@Param("productId") productId: string) { return this.productsService.detail(productId); }
}
