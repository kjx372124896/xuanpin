import assert from "node:assert/strict";
import test from "node:test";
import { calculateListingDate } from "./listing-date";

test("基准商品ID对应2026年7月29日", () => {
  assert.equal(calculateListingDate("1070000000000"), "2026-07-29");
  assert.equal(calculateListingDate(1070000000000), "2026-07-29");
});

test("每增加278550000商品ID，估算上架日期增加一天", () => {
  assert.equal(calculateListingDate("1070278550000"), "2026-07-30");
  assert.equal(calculateListingDate("1070557100000"), "2026-07-31");
});

test("按Excel ROUND规则处理正数和负数的半值", () => {
  assert.equal(calculateListingDate("1070139275000"), "2026-07-30");
  assert.equal(calculateListingDate("1070139274999"), "2026-07-29");
  assert.equal(calculateListingDate("1069860725000"), "2026-07-28");
  assert.equal(calculateListingDate("1069860725001"), "2026-07-29");
});

test("支持早于基准商品ID的商品，并保持日期为UTC日历日期", () => {
  assert.equal(calculateListingDate("1065000000000"), "2026-07-11");
});

test("无效商品ID返回null，不产生伪日期", () => {
  for (const value of [null, undefined, "", "  ", "abc", "123.5", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(calculateListingDate(value), null);
  }
});
