import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGstin, isGstinFormatValid, extractStateCode } from "../../../../shared/gstin.ts";

/**
 * Smoke-level tests for the GSTIN validator that powers the GstinInput
 * field. These mirror the backend tests so UI + API stay in lock-step.
 */

test("validateGstin: canonical valid GSTIN returns Maharashtra", () => {
  const r = validateGstin("27AAPFU0939F1ZV");
  assert.equal(r.valid, true);
  assert.equal(r.stateCode, "27");
  assert.equal(r.stateName, "Maharashtra");
});

test("validateGstin: tampered check digit fails", () => {
  const r = validateGstin("27AAPFU0939F1ZW");
  assert.equal(r.valid, false);
  assert.match(r.error ?? "", /checksum/i);
});

test("validateGstin: lowercase input accepted after uppercase", () => {
  const r = validateGstin("27aapfu0939f1zv");
  assert.equal(r.valid, true);
});

test("isGstinFormatValid: rejects wrong length", () => {
  assert.equal(isGstinFormatValid("27AAPFU0939F1Z"), false);
  assert.equal(isGstinFormatValid("27AAPFU0939F1ZVX"), false);
});

test("extractStateCode: first 2 chars or null", () => {
  assert.equal(extractStateCode("27AAPFU0939F1ZV"), "27");
  assert.equal(extractStateCode(""), null);
});
