import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeClientIp } from "./client-ip";

test("保留 IPv4 地址", () => {
  assert.equal(normalizeClientIp("203.0.113.18"), "203.0.113.18");
});

test("将 IPv4-mapped IPv6 地址归一化为 IPv4", () => {
  assert.equal(normalizeClientIp("::ffff:203.0.113.18"), "203.0.113.18");
});

test("规范化 IPv6 地址", () => {
  assert.equal(normalizeClientIp("2001:0db8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
});

test("缺失或无效地址返回 undefined", () => {
  assert.equal(normalizeClientIp(undefined), undefined);
  assert.equal(normalizeClientIp("not-an-ip"), undefined);
});
