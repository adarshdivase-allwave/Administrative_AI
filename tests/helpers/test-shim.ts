/**
 * Minimal vitest-compatible shim built on Node's built-in test runner.
 *
 * Why this exists: on locked-down Windows machines (WDAC / AppLocker),
 * Rollup 4's unsigned native `.node` binary is blocked, which stops Vitest
 * from loading. Node's built-in runner (`node --test`) has no native deps,
 * so we use it as the default runner and expose a tiny API compatible with
 * the vitest tests we've already written.
 *
 * Supported matchers (enough for this project):
 *   toBe, toEqual, toBeNull, toBeTruthy, toBeFalsy,
 *   toContain, toMatch, toBeCloseTo,
 *   toBeLessThan(OrEqual), toBeGreaterThan(OrEqual),
 *   toThrow (optionally with RegExp/string),
 *   .not.(toBe | toContain | toMatch | toEqual)
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

export { describe, it, before, after, beforeEach, afterEach };

type Fn = (...args: unknown[]) => unknown;

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(expected: unknown): void;
  toMatch(regex: RegExp | string): void;
  toBeCloseTo(expected: number, precision?: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toThrow(expected?: RegExp | string): void;
  not: Omit<Matchers, "not" | "toBeCloseTo" | "toThrow" | "toBeLessThan" | "toBeLessThanOrEqual" | "toBeGreaterThan" | "toBeGreaterThanOrEqual" | "toBeNull" | "toBeTruthy" | "toBeFalsy">;
}

export function expect(value: unknown): Matchers {
  const build = (negated: boolean): Matchers => ({
    toBe(expected) {
      if (negated) assert.notStrictEqual(value, expected);
      else assert.strictEqual(value, expected);
    },
    toEqual(expected) {
      if (negated) assert.notDeepStrictEqual(value, expected);
      else assert.deepStrictEqual(value, expected);
    },
    toBeNull() {
      if (negated) assert.notStrictEqual(value, null);
      else assert.strictEqual(value, null);
    },
    toBeTruthy() {
      assert.ok(negated ? !value : value, `Expected ${String(value)} to be ${negated ? "falsy" : "truthy"}`);
    },
    toBeFalsy() {
      assert.ok(negated ? value : !value, `Expected ${String(value)} to be ${negated ? "truthy" : "falsy"}`);
    },
    toContain(expected) {
      const contains = (() => {
        if (typeof value === "string") return value.includes(String(expected));
        if (Array.isArray(value)) return value.includes(expected);
        return false;
      })();
      if (negated) {
        if (contains) assert.fail(`Expected not to contain ${String(expected)}, but did`);
      } else {
        if (!contains) assert.fail(`Expected ${String(value)} to contain ${String(expected)}`);
      }
    },
    toMatch(regex) {
      const r = typeof regex === "string" ? new RegExp(regex) : regex;
      const matched = r.test(String(value));
      if (negated) {
        if (matched) assert.fail(`Expected not to match ${r}`);
      } else {
        if (!matched) assert.fail(`Expected ${String(value)} to match ${r}`);
      }
    },
    toBeCloseTo(expected, precision = 2) {
      const delta = Math.abs((value as number) - expected);
      const tolerance = Math.pow(10, -precision) / 2;
      assert.ok(
        delta <= tolerance,
        `Expected ${value} to be close to ${expected} (precision ${precision}); delta=${delta} > tolerance=${tolerance}`,
      );
    },
    toBeLessThan(n) {
      assert.ok((value as number) < n, `Expected ${value} < ${n}`);
    },
    toBeLessThanOrEqual(n) {
      assert.ok((value as number) <= n, `Expected ${value} ≤ ${n}`);
    },
    toBeGreaterThan(n) {
      assert.ok((value as number) > n, `Expected ${value} > ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      assert.ok((value as number) >= n, `Expected ${value} ≥ ${n}`);
    },
    toThrow(expected) {
      if (typeof value !== "function") throw new Error("toThrow requires a function");
      try {
        (value as Fn)();
      } catch (e) {
        const msg = (e as Error).message;
        if (expected instanceof RegExp) {
          assert.match(msg, expected);
        } else if (typeof expected === "string") {
          assert.ok(msg.includes(expected), `Expected error message to contain "${expected}", got "${msg}"`);
        }
        return;
      }
      assert.fail("Expected function to throw, but it did not");
    },
    get not(): Matchers["not"] {
      return build(true) as Matchers["not"];
    },
  });
  return build(false);
}
