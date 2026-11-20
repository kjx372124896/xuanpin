import assert from "node:assert/strict";
import test from "node:test";
import { parseDeviceInfo } from "./device-info";

test("解析 Windows Chrome 浏览器信息", () => {
  const info = parseDeviceInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36");
  assert.equal(info.browserName, "Chrome");
  assert.equal(info.browserVersion, "130.0.0.0");
  assert.equal(info.operatingSystem, "Windows");
});

test("Edge 优先于 Chrome 识别", () => {
  const info = parseDeviceInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0");
  assert.equal(info.browserName, "Microsoft Edge");
});

test("User-Agent 超过字段上限时会截断", () => {
  const info = parseDeviceInfo("x".repeat(900));
  assert.equal(info.userAgent.length, 500);
});
