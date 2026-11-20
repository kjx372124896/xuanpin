import assert from "node:assert/strict";
import test from "node:test";
import { AuthGuard } from "./auth.guard";

function createContext(request: Record<string, unknown>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
  test(`${role} 的已登录接口访问始终跳过员工 IP 白名单校验`, async () => {
    let ipChecks = 0;
    const user = {
      id: "admin-1", username: "admin", name: "管理员", employeeNo: null, department: null,
      role, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: true,
    };
    const prisma = {
      loginSession: {
        findUnique: async () => ({ expiresAt: new Date(Date.now() + 60_000), user }),
      },
    };
    const reflector = { getAllAndOverride: () => undefined };
    const ipService = { assertEmployeeIp: async () => { ipChecks += 1; throw new Error("管理员不应校验白名单"); } };
    const request: Record<string, unknown> = {
      cookies: { sid: "session-token" }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" },
    };

    const allowed = await new AuthGuard(reflector as never, prisma as never, ipService as never).canActivate(createContext(request));
    assert.equal(allowed, true);
    assert.equal((request.user as typeof user).role, role);
    assert.equal(ipChecks, 0);
  });
}
