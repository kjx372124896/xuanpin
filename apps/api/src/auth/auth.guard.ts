import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { IMPORT_KEY, PUBLIC_KEY, ROLES_KEY } from "./auth.decorators";
import { toSafeUser, type AuthenticatedRequest } from "./request-user";
import { DEVICE_COOKIE_NAME, hashDeviceToken } from "./device-binding.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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
    const rawDeviceToken = request.cookies?.[DEVICE_COOKIE_NAME] as string | undefined;
    if (!rawDeviceToken || !/^[a-f0-9]{64}$/i.test(rawDeviceToken)) {
      throw new UnauthorizedException("当前浏览器缺少设备凭证，请重新登录并完成设备绑定。");
    }
    const deviceTokenHash = hashDeviceToken(rawDeviceToken);
    if (!session.deviceTokenHash || session.deviceTokenHash !== deviceTokenHash) {
      throw new UnauthorizedException("当前浏览器与登录会话不匹配，请重新登录。");
    }
    const binding = await this.prisma.userDeviceBinding.findUnique({
      where: { userId: user.id },
      select: { tokenHash: true },
    });
    if (!binding || binding.tokenHash !== deviceTokenHash) {
      throw new UnauthorizedException("当前设备已解除绑定或被其他设备替换，请重新登录并申请绑定。");
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (requiredRoles?.length && !requiredRoles.includes(user.role)) throw new ForbiddenException("没有权限访问此功能。");
    const needsImport = this.reflector.getAllAndOverride<boolean>(IMPORT_KEY, [context.getHandler(), context.getClass()]);
    if (needsImport && user.role === "EMPLOYEE" && !user.canImport) throw new ForbiddenException("当前账号没有数据导入权限。");

    request.user = toSafeUser(user);
    request.sessionTokenHash = tokenHash;
    return true;
  }
}
