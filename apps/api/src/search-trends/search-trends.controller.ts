import { Controller, Get, Query } from "@nestjs/common";
import { SearchTrendsService } from "./search-trends.service";

@Controller("search-trends")
export class SearchTrendsController {
  constructor(private readonly searchTrendsService: SearchTrendsService) {}

  @Get("options")
  options() {
    return this.searchTrendsService.options();
  }

  @Get()
  list(@Query() query: Record<string, string | string[] | undefined>) {
    return this.searchTrendsService.list(query);
  }
}
