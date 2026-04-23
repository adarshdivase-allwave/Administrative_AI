import { test } from "node:test";
import assert from "node:assert/strict";
import { cn } from "./cn.ts";

test("cn: merges conflicting tailwind classes correctly", () => {
  assert.equal(cn("p-2", "p-4"), "p-4");
  assert.equal(cn("text-sm", "text-base"), "text-base");
});

test("cn: drops falsy conditionals", () => {
  assert.equal(cn("flex", false && "hidden", null, undefined), "flex");
});

test("cn: preserves unrelated classes", () => {
  const out = cn("rounded-md", "border", "bg-primary", "text-white");
  assert.ok(out.includes("rounded-md"));
  assert.ok(out.includes("border"));
  assert.ok(out.includes("bg-primary"));
  assert.ok(out.includes("text-white"));
});

test("cn: cva-style class merging", () => {
  assert.equal(cn("h-9 px-4 py-2", "h-10"), "px-4 py-2 h-10");
});
