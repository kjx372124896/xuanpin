import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { hashDeviceToken } from "./device-binding.service";
import { parseDeviceInfo } from "./device-info";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

for (const role of ["EMPLOYEE", "ADMIN", "SUPER_ADMIN"] as const) {
  test(`${role} 登录成功时会绑定当前浏览器并把设备哈希写入登录会话`, async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const user = {
      id: "user-1", username: "tester", passwordHash, name: "测试用户", employeeNo: null,
      department: null, role, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: true,
    };
    let createdSession: Record<string, unknown> | undefined;
    const prisma = {
      user: { findUnique: async () => user },
      loginSession: { create: async ({ data }: { data: Record<string, unknown> }) => { createdSession = data; return {}; } },
    };
    const deviceBindingService = { authorizeLogin: async () => ({ allowed: true as const }) };
    const result = await new AuthService(prisma as never, deviceBindingService as never)
      .login("tester", "password123", undefined, parseDeviceInfo(userAgent), "203.0.113.9");

    assert.equal(result.status, "AUTHENTICATED");
    assert.ok("deviceToken" in result);
    assert.equal(createdSession?.deviceTokenHash, hashDeviceToken(result.deviceToken));
    assert.equal(createdSession?.userId, user.id);
  });
}

test("未绑定浏览器需要管理员审批，不创建登录会话", async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const user = {
    id: "employee-1", username: "employee", passwordHash, name: "员工", employeeNo: null,
    department: null, role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: false,
  };
  let sessionCreates = 0;
  const prisma = {
    user: { findUnique: async () => user },
    loginSession: { create: async () => { sessionCreates += 1; return {}; } },
  };
  const deviceBindingService = { authorizeLogin: async () => ({ allowed: false as const, requestId: "request-1" }) };
  const result = await new AuthService(prisma as never, deviceBindingService as never)
    .login("employee", "password123", undefined, parseDeviceInfo(userAgent), "203.0.113.9");

  assert.equal(result.status, "PENDING_APPROVAL");
  if (result.status === "PENDING_APPROVAL") assert.equal(result.requestId, "request-1");
  assert.equal(sessionCreates, 0);
});
