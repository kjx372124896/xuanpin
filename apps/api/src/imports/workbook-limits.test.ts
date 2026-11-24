import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { readBoundedArchive, WORKBOOK_LIMITS } from "./workbook-limits";

test("在解压之前拒绝过大条目、超额总量及过多ZIP条目", () => {
  const archive = zipSync({ "xl/large.xml": new Uint8Array(1024 * 1024) });
  assert.ok(archive.length < 2048);
  assert.throws(() => readBoundedArchive(archive, { ...WORKBOOK_LIMITS, entryBytes: 1024 }), /单个压缩条目/);
  assert.throws(() => readBoundedArchive(archive, { ...WORKBOOK_LIMITS, expandedBytes: 1024 }), /解压总量/);
  const entries = zipSync({ a: strToU8("1"), b: strToU8("2"), c: strToU8("3") });
  assert.throws(() => readBoundedArchive(entries, { ...WORKBOOK_LIMITS, entries: 2 }), /条目过多/);
  assert.throws(() => readBoundedArchive(archive, { ...WORKBOOK_LIMITS, compressedBytes: 10 }), /50 MB/);
});

test("正常工作簿压缩内容保持不变", () => {
  const archive = zipSync({ "xl/worksheets/sheet1.xml": strToU8('<worksheet><row r="1"/></worksheet>') });
  assert.equal(strFromU8(readBoundedArchive(archive)["xl/worksheets/sheet1.xml"]), '<worksheet><row r="1"/></worksheet>');
});
