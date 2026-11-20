import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { IpService } from "./ip.service";

function createService(setting: boolean | null | Error, rules: Array<{ cidr: string }> = [{ cidr: "192.168.1.0/24" }]) {
  let ruleLookups = 0;
  const upserts: unknown[] = [];
  const prisma = {
    ipWhitelistSetting: {
      findUnique: async () => {
        if (setting instanceof Error) throw setting;
        return setting === null ? null : { enabled: setting };
      },
      upsert: async (args: unknown) => { upserts.push(args); return { enabled: true, updatedAt: new Date(0) }; },
    },
    ipWhitelist: {
      findMany: async () => { ruleLookups += 1; return rules; },
    },
  };
  return { service: new IpService(prisma as never), getRuleLookups: () => ruleLookups, upserts };
}

test("未初始化全局设置时默认开启白名单并限制不匹配的员工 IP", async () => {
  const { service } = createService(null);
  assert.equal(await service.isWhitelistEnabled(), true);
  await assert.rejects(service.assertEmployeeIp("203.0.113.9"), ForbiddenException);
});

test("全局开关关闭时员工可从任意 IP 访问且不查询白名单规则", async () => {
  const { service, getRuleLookups } = createService(false);
  assert.equal(await service.isWhitelistEnabled(), false);
  await service.assertEmployeeIp("203.0.113.9");
  await service.assertEmployeeIp(undefined);
  assert.equal(getRuleLookups(), 0);
});

test("全局开关开启时仍按启用的 IP 网段规则校验", async () => {
  const { service } = createService(true);
  await service.assertEmployeeIp("192.168.1.25");
  await assert.rejects(service.assertEmployeeIp("203.0.113.9"), ForbiddenException);
});

test("全局设置读取异常时按开启白名单处理", async () => {
  const { service } = createService(new Error("settings unavailable"));
  assert.equal(await service.isWhitelistEnabled(), true);
  await assert.rejects(service.assertEmployeeIp("203.0.113.9"), ForbiddenException);
});

test("管理员更新开关时持久化单例配置", async () => {
  const { service, upserts } = createService(true);
  await service.setWhitelistEnabled(false);
  assert.deepEqual(upserts[0], {
    where: { id: 1 },
    create: { id: 1, enabled: false },
    update: { enabled: false },
    select: { enabled: true, updatedAt: true },
  });
});
