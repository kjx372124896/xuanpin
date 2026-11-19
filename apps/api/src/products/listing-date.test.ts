import assert from "node:assert/strict";
import test from "node:test";
import { calculateListingDate } from "./listing-date";

test("基准商品ID对应2026年5月24日", () => {
  assert.equal(calculateListingDate("1052407159281"), "2026-05-24");
  assert.equal(calculateListingDate(1052407159281), "2026-05-24");
});

test("每增加3亿商品ID，估算上架日期增加一天", () => {
  assert.equal(calculateListingDate("1052707159281"), "2026-05-25");
  assert.equal(calculateListingDate("1053007159281"), "2026-05-26");
});

test("按WPS ROUND规则处理正数和负数的半值", () => {
  assert.equal(calculateListingDate("1052557159281"), "2026-05-25");
  assert.equal(calculateListingDate("1052557159280"), "2026-05-24");
  assert.equal(calculateListingDate("1052257159281"), "2026-05-23");
  assert.equal(calculateListingDate("1052257159282"), "2026-05-24");
});

test("支持早于基准商品ID的商品，并保持日期为UTC日历日期", () => {
  assert.equal(calculateListingDate("1048033735031"), "2026-05-09");
});

test("无效商品ID返回null，不产生伪日期", () => {
  for (const value of [null, undefined, "", "  ", "abc", "123.5", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(calculateListingDate(value), null);
  }
});
