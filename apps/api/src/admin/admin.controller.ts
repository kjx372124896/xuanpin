import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Roles } from "../auth/auth.decorators";
import type { AuthenticatedRequest } from "../auth/request-user";
import { AdminService } from "./admin.service";

class CreateUserDto {
  @IsString() username!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsIn(["ADMIN", "EMPLOYEE"]) role?: "ADMIN" | "EMPLOYEE";
  @IsOptional() @IsBoolean() canImport?: boolean;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() department?: string | null;
  @IsOptional() @IsIn(["SUPER_ADMIN", "ADMIN", "EMPLOYEE"]) role?: "SUPER_ADMIN" | "ADMIN" | "EMPLOYEE";
  @IsOptional() @IsIn(["ACTIVE", "RESIGNED", "SUSPENDED"]) employmentStatus?: "ACTIVE" | "RESIGNED" | "SUSPENDED";
  @IsOptional() @IsIn(["ACTIVE", "DISABLED"]) accountStatus?: "ACTIVE" | "DISABLED";
  @IsOptional() @IsBoolean() canImport?: boolean;
}

class ResetPasswordDto {
  @IsString() @MinLength(8) password!: string;
}

class IpRuleDto {
  @IsString() cidr!: string;
  @IsString() label!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateIpRuleDto {
  @IsOptional() @IsString() cidr?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@Roles("SUPER_ADMIN", "ADMIN")
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("users") listUsers() { return this.adminService.listUsers(); }
  @Post("users") createUser(@Req() req: AuthenticatedRequest, @Body() dto: CreateUserDto) { return this.adminService.createUser(req.user, dto); }
  @Patch("users/:id") updateUser(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: UpdateUserDto) { return this.adminService.updateUser(req.user, id, dto); }
  @Post("users/:id/reset-password") resetPassword(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: ResetPasswordDto) { return this.adminService.resetPassword(req.user, id, dto.password); }

  @Get("ip-rules") listIpRules() { return this.adminService.listIpRules(); }
  @Post("ip-rules") createIpRule(@Body() dto: IpRuleDto) { return this.adminService.createIpRule(dto.cidr, dto.label, dto.enabled ?? true); }
  @Patch("ip-rules/:id") updateIpRule(@Param("id") id: string, @Body() dto: UpdateIpRuleDto) { return this.adminService.updateIpRule(id, dto); }
  @Delete("ip-rules/:id") deleteIpRule(@Param("id") id: string) { return this.adminService.deleteIpRule(id); }

  @Get("imports") listImports() { return this.adminService.listImportBatches(); }
}
