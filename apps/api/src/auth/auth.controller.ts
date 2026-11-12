import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { IsString, MinLength } from "class-validator";
import { Public } from "./auth.decorators";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./request-user";

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
    const result = await this.authService.login(dto.username, dto.password, req.ip ?? req.socket.remoteAddress);
    res.cookie("sid", result.token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });
    return { user: result.user };
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
