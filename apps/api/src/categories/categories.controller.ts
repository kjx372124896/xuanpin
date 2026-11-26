import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Roles } from "../auth/auth.decorators";
import { CategoriesService } from "./categories.service";

class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(255) categoryLevel1!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) categoryLevel2?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) categoryLevel3?: string;
  @IsOptional() @IsString() responsibleUserId?: string | null;
}

class UpdateCategoryResponsibleDto {
  @IsOptional() @IsString() responsibleUserId?: string | null;
}

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get("overview")
  overview(@Query("boardType") boardType?: string) {
    if (boardType && boardType !== "NEW_PRODUCT_TRAFFIC" && boardType !== "TRANSACTION_GROWTH") {
      throw new BadRequestException("榜单类型无效。");
    }
    return this.categoriesService.overview(boardType as "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" | undefined);
  }

  @Get("search-overview")
  searchOverview(@Query("searchTermType") searchTermType?: string) {
    if (searchTermType && searchTermType !== "搜索词" && searchTermType !== "核心词") {
      throw new BadRequestException("搜索词类型无效。");
    }
    return this.categoriesService.searchOverview(searchTermType as "搜索词" | "核心词" | undefined);
  }

  @Roles("ADMIN", "SUPER_ADMIN")
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Roles("ADMIN", "SUPER_ADMIN")
  @Patch(":id/responsible")
  updateResponsible(
    @Param("id") id: string,
    @Body() dto: UpdateCategoryResponsibleDto,
  ) {
    return this.categoriesService.updateResponsible(id, dto.responsibleUserId ?? null);
  }
}
