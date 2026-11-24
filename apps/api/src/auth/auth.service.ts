import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { toSafeUser } from "./request-user";
import { DeviceBindingService, DEVICE_TOKEN_DAYS, hashDeviceToken } from "./device-binding.service";
import type { DeviceInfo } from "./device-info";
import { LoginRateLimiter } from "./login-rate-limiter";

const SESSION_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceBindingService: DeviceBindingService,
    private readonly loginRateLimiter: LoginRateLimiter = new LoginRateLimiter(),
  ) {}

  async login(username: string, password: string, deviceToken: string | undefined, deviceInfo: DeviceInfo, ip: string | undefined) {
    const release = this.loginRateLimiter.start(username, ip);
    let passwordVerified = false;
    try {
      const user = await this.prisma.user.findUnique({ where: { username: username.trim() } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedException("账号或密码不正确。");
      }
      passwordVerified = true;
      if (user.accountStatus !== "ACTIVE" || user.employmentStatus !== "ACTIVE") {
        throw new ForbiddenException("账号已停用或员工状态不是在职，请联系管理员。");
      }
      const normalizedDeviceToken = /^[a-f0-9]{64}$/i.test(deviceToken ?? "")
        ? deviceToken as string
        : randomBytes(32).toString("hex");
      const deviceTokenHash = hashDeviceToken(normalizedDeviceToken);
      const deviceResult = await this.deviceBindingService.authorizeLogin(user.id, {
        tokenHash: deviceTokenHash,
        info: deviceInfo,
        ip: ip ?? null,
      });
      const deviceTokenExpiresAt = new Date(Date.now() + DEVICE_TOKEN_DAYS * 24 * 60 * 60 * 1000);

      if (!deviceResult.allowed) {
        return {
          status: "PENDING_APPROVAL" as const,
          requestId: deviceResult.requestId,
          deviceToken: normalizedDeviceToken,
          deviceTokenExpiresAt,
        };
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
      await this.prisma.loginSession.create({ data: { userId: user.id, tokenHash, deviceTokenHash, expiresAt } });
      return {
        status: "AUTHENTICATED" as const,
        token,
        user: toSafeUser(user),
        expiresAt,
        deviceToken: normalizedDeviceToken,
        deviceTokenExpiresAt,
      };
    } finally {
      release(passwordVerified);
    }
  }

  getDeviceRequestStatus(id: string, deviceToken: string | undefined) {
    if (!deviceToken || !/^[a-f0-9]{64}$/i.test(deviceToken)) {
      throw new UnauthorizedException("当前浏览器缺少设备凭证，请返回登录页重新申请。");
    }
    return this.deviceBindingService.getRequestStatus(id, hashDeviceToken(deviceToken));
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.prisma.loginSession.deleteMany({ where: { tokenHash } });
  }
}
