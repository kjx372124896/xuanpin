import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { IMPORT_KEY, PUBLIC_KEY, ROLES_KEY } from "./auth.decorators";
import { IpService } from "./ip.service";
import { toSafeUser, type AuthenticatedRequest } from "./request-user";
import { normalizeClientIp } from "./client-ip";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly ipService: IpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = request.cookies?.sid as string | undefined;
    if (!rawToken) throw new UnauthorizedException("请先登录。");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const session = await this.prisma.loginSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException("登录已过期，请重新登录。");

    const user = session.user;
    if (user.accountStatus !== "ACTIVE" || user.employmentStatus !== "ACTIVE") {
      throw new UnauthorizedException("账号已停用或员工状态不是在职，请联系管理员。");
    }
    if (user.role === "EMPLOYEE") await this.ipService.assertEmployeeIp(normalizeClientIp(request.ip ?? request.socket.remoteAddress));

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (requiredRoles?.length && !requiredRoles.includes(user.role)) throw new ForbiddenException("没有权限访问此功能。");
    const needsImport = this.reflector.getAllAndOverride<boolean>(IMPORT_KEY, [context.getHandler(), context.getClass()]);
    if (needsImport && user.role === "EMPLOYEE" && !user.canImport) throw new ForbiddenException("当前账号没有数据导入权限。");

    request.user = toSafeUser(user);
    request.sessionTokenHash = tokenHash;
    return true;
  }
}
