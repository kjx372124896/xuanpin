import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";

for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
  test(`${role} 登录始终跳过员工 IP 白名单校验`, async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    let ipChecks = 0;
    const user = {
      id: "admin-1", username: "admin", passwordHash, name: "管理员", employeeNo: null,
      department: null, role, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: true,
    };
    const prisma = {
      user: { findUnique: async () => user },
      loginSession: { create: async () => ({}) },
    };
    const ipService = { assertEmployeeIp: async () => { ipChecks += 1; throw new Error("管理员不应校验白名单"); } };
    const result = await new AuthService(prisma as never, ipService as never).login("admin", "password123", "203.0.113.9");
    assert.equal(result.user.role, role);
    assert.equal(ipChecks, 0);
  });
}
