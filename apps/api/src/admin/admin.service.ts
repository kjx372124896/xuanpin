import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { DeviceBindingService } from "../auth/device-binding.service";
import type { RequestUser } from "../auth/request-user";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly deviceBindingService: DeviceBindingService) {}

  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, username: true, name: true, employeeNo: true, department: true, role: true,
        employmentStatus: true, accountStatus: true, canImport: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async createUser(actor: RequestUser, input: {
    username: string; password: string; name: string; employeeNo?: string; department?: string;
    role?: "ADMIN" | "EMPLOYEE"; canImport?: boolean;
  }) {
    const role = input.role ?? "EMPLOYEE";
    if (actor.role !== "SUPER_ADMIN" && role !== "EMPLOYEE") {
      throw new ForbiddenException("只有超级管理员可以创建管理员账号。");
    }
    if (input.password.length < 8) throw new BadRequestException("初始密码至少需要 8 位。");
    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.prisma.user.create({
      data: {
        username: input.username.trim(), passwordHash, name: input.name.trim(),
        employeeNo: input.employeeNo?.trim() || null, department: input.department?.trim() || null,
        role, canImport: role === "EMPLOYEE" ? Boolean(input.canImport) : true,
      },
      select: {
        id: true, username: true, name: true, employeeNo: true, department: true, role: true,
        employmentStatus: true, accountStatus: true, canImport: true, createdAt: true,
      },
    });
  }

  async updateUser(actor: RequestUser, id: string, input: {
    name?: string; department?: string | null; role?: "SUPER_ADMIN" | "ADMIN" | "EMPLOYEE";
    employmentStatus?: "ACTIVE" | "RESIGNED" | "SUSPENDED";
    accountStatus?: "ACTIVE" | "DISABLED"; canImport?: boolean;
  }) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("员工账号不存在。");
    if (actor.role !== "SUPER_ADMIN" && target.role !== "EMPLOYEE") throw new ForbiddenException("普通管理员只能管理普通员工账号。");
    if (actor.role !== "SUPER_ADMIN" && input.role && input.role !== "EMPLOYEE") throw new ForbiddenException("只有超级管理员可以设置管理员角色。");
    if (actor.id === id && input.role && input.role !== actor.role) throw new BadRequestException("不能在当前登录账号中修改自己的角色。");
    const data: Record<string, unknown> = { ...input };
    if (input.role && input.role !== "EMPLOYEE") data.canImport = true;
    const user = await this.prisma.user.update({
      where: { id }, data,
      select: {
        id: true, username: true, name: true, employeeNo: true, department: true, role: true,
        employmentStatus: true, accountStatus: true, canImport: true, createdAt: true, updatedAt: true,
      },
    });
    if (input.employmentStatus && input.employmentStatus !== "ACTIVE" || input.accountStatus === "DISABLED") {
      await this.prisma.loginSession.deleteMany({ where: { userId: id } });
    }
    return user;
  }

  async resetPassword(actor: RequestUser, id: string, password: string) {
    if (password.length < 8) throw new BadRequestException("新密码至少需要 8 位。");
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target) throw new NotFoundException("员工账号不存在。");
    if (actor.role !== "SUPER_ADMIN" && target.role !== "EMPLOYEE") throw new ForbiddenException("普通管理员只能重置普通员工密码。");
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.loginSession.deleteMany({ where: { userId: id } });
    return { success: true };
  }

  listDevices() { return this.deviceBindingService.listDevices(); }
  listDeviceRequests() { return this.deviceBindingService.listRequests(); }
  listDeviceAuditLogs() { return this.deviceBindingService.listAuditLogs(); }
  async approveDeviceRequest(actor: RequestUser, id: string, note: string | undefined, ip: string | null) {
    const request = await this.prisma.deviceChangeRequest.findUnique({ where: { id }, select: { user: { select: { role: true } } } });
    if (request && actor.role !== "SUPER_ADMIN" && request.user.role !== "EMPLOYEE") {
      throw new ForbiddenException("只有超级管理员可以审批管理员账号的设备更换申请。");
    }
    return this.deviceBindingService.approveRequest(id, actor.id, note, ip);
  }
  async rejectDeviceRequest(actor: RequestUser, id: string, note: string | undefined, ip: string | null) {
    const request = await this.prisma.deviceChangeRequest.findUnique({ where: { id }, select: { user: { select: { role: true } } } });
    if (request && actor.role !== "SUPER_ADMIN" && request.user.role !== "EMPLOYEE") {
      throw new ForbiddenException("只有超级管理员可以处理管理员账号的设备更换申请。");
    }
    return this.deviceBindingService.rejectRequest(id, actor.id, note, ip);
  }
  async unbindDevice(actor: RequestUser, userId: string, ip: string | null) {
    if (actor.id === userId) throw new BadRequestException("不能直接解除当前管理员自己的设备绑定，请使用其他管理员账号操作或执行服务器紧急恢复命令。");
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target && actor.role !== "SUPER_ADMIN" && target.role !== "EMPLOYEE") {
      throw new ForbiddenException("只有超级管理员可以解除管理员账号的设备绑定。");
    }
    return this.deviceBindingService.unbindDevice(userId, actor.id, ip);
  }

  listImportBatches() {
    return this.prisma.importBatch.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: { files: { select: { id: true, originalName: true, weekStart: true, weekEnd: true, categoryName: true, rowCount: true, importedCount: true, errorCount: true, status: true } } },
    });
  }
}
