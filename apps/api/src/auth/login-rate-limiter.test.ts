import assert from "node:assert/strict";
import test from "node:test";
import { LoginRateLimiter } from "./login-rate-limiter";
import { AuthService } from "./auth.service";
import { parseDeviceInfo } from "./device-info";

test("同账号跨IP连续失败10次后在查库和密码校验之前限流，10分钟后恢复", async () => {
  let now = 1000;
  let queries = 0;
  const limiter = new LoginRateLimiter(() => now);
  const auth = new AuthService({ user: { findUnique: async () => { queries += 1; return null; } } } as never, {} as never, limiter);
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(auth.login(" user ", "wrong", undefined, parseDeviceInfo(""), `ip-${index}`), (error: any) => error.getStatus() === 401);
  }
  await assert.rejects(auth.login("user", "wrong", undefined, parseDeviceInfo(""), "another-ip"), (error: any) => error.getStatus() === 429);
  assert.equal(queries, 10);
  now += 600_001;
  await assert.rejects(auth.login("user", "wrong", undefined, parseDeviceInfo(""), "another-ip"), (error: any) => error.getStatus() === 401);
  assert.equal(queries, 11);
});

test("限制同IP换账号尝试和全局密码校验并发，成功登录清除账号失败累计", () => {
  const limiter = new LoginRateLimiter();
  for (let index = 0; index < 60; index += 1) limiter.start(`user-${index}`, "same-ip")(false);
  assert.throws(() => limiter.start("new-user", "same-ip"), (error: any) => error.getStatus() === 429);
  const releases = Array.from({ length: 4 }, (_, index) => limiter.start(`parallel-${index}`, `parallel-ip-${index}`));
  assert.throws(() => limiter.start("fifth", "fifth-ip"), (error: any) => error.getStatus() === 429);
  releases.forEach((release) => release(false));
  for (let index = 0; index < 20; index += 1) limiter.start("success-user", "success-ip")(true);
});
