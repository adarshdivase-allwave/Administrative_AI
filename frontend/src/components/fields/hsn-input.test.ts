import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHsn, normalizeHsnForTally, isTallyCompatible } from "../../../../shared/hsn.ts";

test("HSN 8528 (4 digits) is a valid HSN", () => {
  const r = validateHsn("8528");
  assert.equal(r.valid, true);
  assert.equal(r.isSac, false);
  assert.equal(r.length, 4);
});

test("SAC 998314 is flagged as services", () => {
  const r = validateHsn("998314");
  assert.equal(r.valid, true);
  assert.equal(r.isSac, true);
});

test("whitespace-padded input normalizes cleanly", () => {
  const r = validateHsn(" 8528 72 00 ");
  assert.equal(r.valid, true);
  assert.equal(r.tallyFormat, "85287200");
  assert.equal(isTallyCompatible(" 8528 72 00 "), true);
});

test("5-digit code is invalid", () => {
  const r = validateHsn("85287");
  assert.equal(r.valid, false);
  assert.match(r.error ?? "", /4\/6\/8 digits/);
});

test("normalizeHsnForTally strips whitespace", () => {
  assert.equal(normalizeHsnForTally(" 85 28 72 "), "852872");
  assert.equal(normalizeHsnForTally("85 28 72 00"), "85287200");
});
