import assert from "node:assert/strict";
import test from "node:test";
import { AuthGuard } from "./auth.guard";
import { hashDeviceToken } from "./device-binding.service";

function createContext(request: Record<string, unknown>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

for (const role of ["EMPLOYEE", "ADMIN", "SUPER_ADMIN"] as const) {
  test(`${role} 的已登录接口使用设备令牌校验，不再校验 IP 白名单`, async () => {
    const deviceToken = "a".repeat(64);
    const deviceTokenHash = hashDeviceToken(deviceToken);
    const user = {
      id: "user-1", username: "tester", name: "测试用户", employeeNo: null, department: null,
      role, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: true,
    };
    const prisma = {
      loginSession: {
        findUnique: async () => ({ expiresAt: new Date(Date.now() + 60_000), deviceTokenHash, user }),
      },
      userDeviceBinding: { findUnique: async () => ({ tokenHash: deviceTokenHash }) },
    };
    const reflector = { getAllAndOverride: () => undefined };
    const request: Record<string, unknown> = {
      cookies: { sid: "session-token", device_token: deviceToken }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" },
    };

    const allowed = await new AuthGuard(reflector as never, prisma as never).canActivate(createContext(request));
    assert.equal(allowed, true);
    assert.equal((request.user as typeof user).role, role);
  });
}

test("设备绑定已更换时，旧登录会话必须失效", async () => {
  const oldToken = "b".repeat(64);
  const oldHash = hashDeviceToken(oldToken);
  const user = {
    id: "employee-1", username: "employee", name: "员工", employeeNo: null, department: null,
    role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: false,
  };
  const prisma = {
    loginSession: { findUnique: async () => ({ expiresAt: new Date(Date.now() + 60_000), deviceTokenHash: oldHash, user }) },
    userDeviceBinding: { findUnique: async () => ({ tokenHash: "c".repeat(64) }) },
  };
  const request: Record<string, unknown> = { cookies: { sid: "session-token", device_token: oldToken }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } };
  const guard = new AuthGuard({ getAllAndOverride: () => undefined } as never, prisma as never);
  await assert.rejects(() => guard.canActivate(createContext(request)), /当前设备已解除绑定或被其他设备替换/);
});
