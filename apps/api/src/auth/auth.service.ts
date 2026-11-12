import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { IpService } from "./ip.service";
import { toSafeUser } from "./request-user";

const SESSION_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly ipService: IpService) {}

  async login(username: string, password: string, ip: string | undefined) {
    const user = await this.prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("账号或密码不正确。");
    }
    if (user.accountStatus !== "ACTIVE" || user.employmentStatus !== "ACTIVE") {
      throw new ForbiddenException("账号已停用或员工状态不是在职，请联系管理员。");
    }
    if (user.role === "EMPLOYEE") await this.ipService.assertEmployeeIp(ip);

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.loginSession.create({ data: { userId: user.id, tokenHash, expiresAt } });
    return { token, user: toSafeUser(user), expiresAt };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.prisma.loginSession.deleteMany({ where: { tokenHash } });
  }
}
