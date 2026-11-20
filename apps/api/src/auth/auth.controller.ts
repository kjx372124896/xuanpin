import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { IsString, MinLength } from "class-validator";
import { Public } from "./auth.decorators";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./request-user";
import { normalizeClientIp } from "./client-ip";
import { DEVICE_COOKIE_NAME } from "./device-binding.service";
import { parseDeviceInfo } from "./device-info";

class LoginDto {
  @IsString() username!: string;
  @IsString() @MinLength(1) password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(
      dto.username,
      dto.password,
      req.cookies?.[DEVICE_COOKIE_NAME] as string | undefined,
      parseDeviceInfo(req.headers["user-agent"]),
      normalizeClientIp(req.ip ?? req.socket.remoteAddress),
    );
    const cookieBase = {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax" as const,
      path: "/",
    };
    res.cookie(DEVICE_COOKIE_NAME, result.deviceToken, {
      ...cookieBase,
      expires: result.deviceTokenExpiresAt,
    });
    if (result.status === "PENDING_APPROVAL") {
      res.clearCookie("sid", cookieBase);
      return { status: result.status, requestId: result.requestId };
    }
    res.cookie("sid", result.token, {
      ...cookieBase,
      expires: result.expiresAt,
    });
    return { status: result.status, user: result.user };
  }

  @Public()
  @Get("device-requests/:id/status")
  deviceRequestStatus(@Param("id") id: string, @Req() req: Request) {
    return this.authService.getDeviceRequestStatus(id, req.cookies?.[DEVICE_COOKIE_NAME] as string | undefined);
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.sid as string | undefined);
    res.clearCookie("sid", { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/" });
    return { success: true };
  }

  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user };
  }
}
