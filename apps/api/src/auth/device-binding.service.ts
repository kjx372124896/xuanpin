import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { DeviceInfo } from "./device-info";

export const DEVICE_COOKIE_NAME = "device_token";
export const DEVICE_TOKEN_DAYS = 365;
export const DEVICE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export interface DeviceLoginContext {
  tokenHash: string;
  info: DeviceInfo;
  ip: string | null;
}

@Injectable()
export class DeviceBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async authorizeLogin(userId: string, context: DeviceLoginContext): Promise<{ allowed: true } | { allowed: false; requestId: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
      const binding = await tx.userDeviceBinding.findUnique({ where: { userId } });
      const now = new Date();
      if (!binding) {
        await tx.userDeviceBinding.create({
          data: {
            userId,
            tokenHash: context.tokenHash,
            browserName: context.info.browserName,
            browserVersion: context.info.browserVersion,
            operatingSystem: context.info.operatingSystem,
            userAgent: context.info.userAgent,
            firstBoundAt: now,
            lastSeenAt: now,
            lastLoginIp: context.ip,
          },
        });
        await tx.deviceAuditLog.create({
          data: {
            userId,
            action: "FIRST_BIND",
            ip: context.ip,
            detailsJson: JSON.stringify({ browserName: context.info.browserName, operatingSystem: context.info.operatingSystem }),
          },
        });
        return { allowed: true as const };
      }

      if (binding.tokenHash === context.tokenHash) {
        await tx.userDeviceBinding.update({
          where: { userId },
          data: {
            browserName: context.info.browserName,
            browserVersion: context.info.browserVersion,
            operatingSystem: context.info.operatingSystem,
            userAgent: context.info.userAgent,
            lastSeenAt: now,
            lastLoginIp: context.ip,
          },
        });
        return { allowed: true as const };
      }

      const existing = await tx.deviceChangeRequest.findFirst({
        where: { userId, tokenHash: context.tokenHash, status: "PENDING" },
        select: { id: true, requestedAt: true },
      });
      if (existing && existing.requestedAt.getTime() + DEVICE_REQUEST_TTL_MS > now.getTime()) {
        return { allowed: false as const, requestId: existing.id };
      }
      if (existing) {
        await tx.deviceChangeRequest.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
      }

      const request = await tx.deviceChangeRequest.create({
        data: {
          userId,
          tokenHash: context.tokenHash,
          browserName: context.info.browserName,
          browserVersion: context.info.browserVersion,
          operatingSystem: context.info.operatingSystem,
          userAgent: context.info.userAgent,
          requestIp: context.ip,
          status: "PENDING",
        },
      });
      await tx.deviceAuditLog.create({
        data: {
          userId,
          action: "CHANGE_REQUEST",
          ip: context.ip,
          detailsJson: JSON.stringify({ requestId: request.id, browserName: context.info.browserName, operatingSystem: context.info.operatingSystem }),
        },
      });
      return { allowed: false as const, requestId: request.id };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if ((code !== "P2002" && code !== "P2034") || attempt === 2) throw error;
      }
    }
    throw new Error("设备绑定并发操作失败，请重试登录。");
  }

  async getRequestStatus(id: string, tokenHash: string) {
    const request = await this.prisma.deviceChangeRequest.findUnique({ where: { id } });
    if (!request || request.tokenHash !== tokenHash) throw new UnauthorizedException("设备申请不存在或当前浏览器无权查看。");
    if (request.status === "PENDING" && request.requestedAt.getTime() + DEVICE_REQUEST_TTL_MS <= Date.now()) {
      await this.prisma.deviceChangeRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      return { status: "EXPIRED", requestedAt: request.requestedAt, reviewedAt: null, reviewNote: null };
    }
    return { status: request.status, requestedAt: request.requestedAt, reviewedAt: request.reviewedAt, reviewNote: request.reviewNote };
  }

  async listRequests() {
    await this.expireStaleRequests();
    const rows = await this.prisma.deviceChangeRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { requestedAt: "asc" },
      include: {
        user: {
          select: {
            id: true, username: true, name: true, role: true,
            deviceBinding: { select: { browserName: true, browserVersion: true, operatingSystem: true, lastSeenAt: true, lastLoginIp: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      userName: row.user.name,
      role: row.user.role,
      browserName: row.browserName,
      browserVersion: row.browserVersion,
      operatingSystem: row.operatingSystem,
      requestIp: row.requestIp,
      requestedAt: row.requestedAt,
      currentDevice: row.user.deviceBinding,
    }));
  }

  async listDevices() {
    const rows = await this.prisma.userDeviceBinding.findMany({
      orderBy: { lastSeenAt: "desc" },
      include: { user: { select: { id: true, username: true, name: true, role: true, accountStatus: true, employmentStatus: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      userName: row.user.name,
      role: row.user.role,
      accountStatus: row.user.accountStatus,
      employmentStatus: row.user.employmentStatus,
      browserName: row.browserName,
      browserVersion: row.browserVersion,
      operatingSystem: row.operatingSystem,
      firstBoundAt: row.firstBoundAt,
      lastSeenAt: row.lastSeenAt,
      lastLoginIp: row.lastLoginIp,
    }));
  }

  async listAuditLogs() {
    const rows = await this.prisma.deviceAuditLog.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { username: true, name: true } },
        actor: { select: { username: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetUser: row.user,
      actor: row.actor,
      ip: row.ip,
      createdAt: row.createdAt,
      detailsJson: row.detailsJson,
    }));
  }

  async approveRequest(id: string, actorUserId: string, note: string | undefined, ip: string | null) {
    const request = await this.prisma.deviceChangeRequest.findUnique({
      where: { id },
      include: { user: { select: { accountStatus: true, employmentStatus: true } } },
    });
    if (!request) throw new NotFoundException("设备更换申请不存在。");
    if (request.status !== "PENDING") throw new BadRequestException("该申请已处理，不能重复审批。");
    if (request.userId === actorUserId) throw new ForbiddenException("不能审批自己的设备更换申请，请由其他管理员处理。");
    if (request.requestedAt.getTime() + DEVICE_REQUEST_TTL_MS <= Date.now()) {
      await this.prisma.deviceChangeRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("该设备申请已超过 24 小时，已自动过期，请员工重新申请。");
    }
    if (request.user.accountStatus !== "ACTIVE" || request.user.employmentStatus !== "ACTIVE") {
      throw new BadRequestException("该员工账号已停用或员工状态不是在职，不能更换设备。");
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.deviceChangeRequest.findUnique({ where: { id } });
      if (!latest || latest.status !== "PENDING") throw new BadRequestException("该申请已被其他管理员处理。");
      await tx.userDeviceBinding.upsert({
        where: { userId: request.userId },
        create: {
          userId: request.userId,
          tokenHash: request.tokenHash,
          browserName: request.browserName,
          browserVersion: request.browserVersion,
          operatingSystem: request.operatingSystem,
          userAgent: request.userAgent,
          firstBoundAt: now,
          lastSeenAt: now,
          lastLoginIp: request.requestIp,
        },
        update: {
          tokenHash: request.tokenHash,
          browserName: request.browserName,
          browserVersion: request.browserVersion,
          operatingSystem: request.operatingSystem,
          userAgent: request.userAgent,
          firstBoundAt: now,
          lastSeenAt: now,
          lastLoginIp: request.requestIp,
        },
      });
      await tx.deviceChangeRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedById: actorUserId, reviewedAt: now, reviewNote: note?.trim() || null },
      });
      await tx.deviceChangeRequest.updateMany({
        where: { userId: request.userId, status: "PENDING", id: { not: id } },
        data: { status: "EXPIRED", reviewedById: actorUserId, reviewedAt: now, reviewNote: "该账号已完成其他设备绑定。" },
      });
      await tx.loginSession.deleteMany({ where: { userId: request.userId } });
      await tx.deviceAuditLog.create({
        data: {
          userId: request.userId,
          actorUserId,
          action: "APPROVE_CHANGE",
          ip,
          detailsJson: JSON.stringify({ requestId: id, browserName: request.browserName, operatingSystem: request.operatingSystem }),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { success: true };
  }

  async rejectRequest(id: string, actorUserId: string, note: string | undefined, ip: string | null) {
    const request = await this.prisma.deviceChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("设备更换申请不存在。");
    if (request.status !== "PENDING") throw new BadRequestException("该申请已处理，不能重复审批。");
    if (request.userId === actorUserId) throw new ForbiddenException("不能处理自己的设备更换申请，请由其他管理员处理。");
    if (request.requestedAt.getTime() + DEVICE_REQUEST_TTL_MS <= Date.now()) {
      await this.prisma.deviceChangeRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("该设备申请已超过 24 小时，已自动过期。");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.deviceChangeRequest.findUnique({ where: { id } });
      if (!latest || latest.status !== "PENDING") throw new BadRequestException("该申请已被其他管理员处理。");
      await tx.deviceChangeRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedById: actorUserId, reviewedAt: now, reviewNote: note?.trim() || null },
      });
      await tx.deviceAuditLog.create({
        data: { userId: request.userId, actorUserId, action: "REJECT_CHANGE", ip, detailsJson: JSON.stringify({ requestId: id, note: note?.trim() || null }) },
      });
    });
    return { success: true };
  }

  async unbindDevice(userId: string, actorUserId: string, ip: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("员工账号不存在。");
    await this.prisma.$transaction(async (tx) => {
      await tx.userDeviceBinding.deleteMany({ where: { userId } });
      await tx.loginSession.deleteMany({ where: { userId } });
      await tx.deviceChangeRequest.updateMany({
        where: { userId, status: "PENDING" },
        data: { status: "EXPIRED", reviewedById: actorUserId, reviewedAt: new Date(), reviewNote: "管理员已手动解除设备绑定。" },
      });
      await tx.deviceAuditLog.create({ data: { userId, actorUserId, action: "ADMIN_UNBIND", ip } });
    });
    return { success: true };
  }

  private async expireStaleRequests() {
    await this.prisma.deviceChangeRequest.updateMany({
      where: { status: "PENDING", requestedAt: { lt: new Date(Date.now() - DEVICE_REQUEST_TTL_MS) } },
      data: { status: "EXPIRED" },
    });
  }
}
