import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Roles } from "../auth/auth.decorators";
import { CategoriesService } from "./categories.service";

class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(255) categoryLevel1!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) categoryLevel2?: string;
  @IsOptional() @IsString() responsibleUserId?: string | null;
}

class UpdateCategoryResponsibleDto {
  @IsOptional() @IsString() responsibleUserId?: string | null;
}

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get("overview")
  overview() {
    return this.categoriesService.overview();
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
