import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Roles } from "../auth/auth.decorators";
import type { AuthenticatedRequest } from "../auth/request-user";
import { AdminService } from "./admin.service";
import { normalizeClientIp } from "../auth/client-ip";

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

class DeviceReviewDto {
  @IsOptional() @IsString() note?: string;
}

@Roles("SUPER_ADMIN", "ADMIN")
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("users") listUsers() { return this.adminService.listUsers(); }
  @Post("users") createUser(@Req() req: AuthenticatedRequest, @Body() dto: CreateUserDto) { return this.adminService.createUser(req.user, dto); }
  @Patch("users/:id") updateUser(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: UpdateUserDto) { return this.adminService.updateUser(req.user, id, dto); }
  @Post("users/:id/reset-password") resetPassword(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: ResetPasswordDto) { return this.adminService.resetPassword(req.user, id, dto.password); }

  @Get("devices") listDevices() { return this.adminService.listDevices(); }
  @Get("device-requests") listDeviceRequests() { return this.adminService.listDeviceRequests(); }
  @Get("device-audit-logs") listDeviceAuditLogs() { return this.adminService.listDeviceAuditLogs(); }
  @Patch("device-requests/:id/approve") approveDeviceRequest(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: DeviceReviewDto) {
    return this.adminService.approveDeviceRequest(req.user, id, dto.note, normalizeClientIp(req.ip ?? req.socket.remoteAddress) ?? null);
  }
  @Patch("device-requests/:id/reject") rejectDeviceRequest(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: DeviceReviewDto) {
    return this.adminService.rejectDeviceRequest(req.user, id, dto.note, normalizeClientIp(req.ip ?? req.socket.remoteAddress) ?? null);
  }
  @Delete("devices/:userId") unbindDevice(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    return this.adminService.unbindDevice(req.user, userId, normalizeClientIp(req.ip ?? req.socket.remoteAddress) ?? null);
  }

  @Get("imports") listImports() { return this.adminService.listImportBatches(); }
}
