import { Body, Controller, Delete, Get, Post, Query, Req } from "@nestjs/common";
import { SearchTrendsService } from "./search-trends.service";
import { Roles } from "../auth/auth.decorators";
import type { AuthenticatedRequest } from "../auth/request-user";

@Controller("search-trends")
export class SearchTrendsController {
  constructor(private readonly searchTrendsService: SearchTrendsService) {}

  @Get("options")
  options() {
    return this.searchTrendsService.options();
  }

  @Get()
  list(@Query() query: Record<string, string | string[] | undefined>, @Req() request: AuthenticatedRequest) {
    return this.searchTrendsService.list(query, { userId: request.user.id });
  }

  @Roles("ADMIN", "SUPER_ADMIN")
  @Get("team-favorites")
  teamFavorites(@Query() query: Record<string, string | string[] | undefined>, @Req() request: AuthenticatedRequest) {
    return this.searchTrendsService.list(query, {
      userId: request.user.id,
      teamFavorites: true,
      memberKeyword: typeof query.memberKeyword === "string" ? query.memberKeyword : undefined,
    });
  }

  @Post("favorite")
  favorite(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.searchTrendsService.favorite(request.user.id, body);
  }

  @Delete("favorite")
  unfavorite(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.searchTrendsService.unfavorite(request.user.id, body);
  }
}
