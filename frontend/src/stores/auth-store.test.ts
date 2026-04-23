import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests the role-priority helper independent of Cognito.
 * Replicates the private `highestRole` logic in auth-store.ts so we can
 * verify it without mounting a React tree. If you change the priority
 * in auth-store, update this table too.
 */

const ROLE_PRIORITY = {
  Admin: 4,
  Logistics: 3,
  Purchase: 2,
  Sales: 1,
} as const;
type UserRole = keyof typeof ROLE_PRIORITY;

function highestRole(groups: UserRole[]): UserRole | null {
  if (!groups.length) return null;
  return groups.slice().sort((a, b) => ROLE_PRIORITY[b] - ROLE_PRIORITY[a])[0]!;
}

test("empty groups → null", () => {
  assert.equal(highestRole([]), null);
});

test("single group returns itself", () => {
  assert.equal(highestRole(["Sales"]), "Sales");
});

test("Admin wins every tie", () => {
  assert.equal(highestRole(["Sales", "Admin", "Logistics"]), "Admin");
});

test("Logistics > Purchase > Sales without Admin", () => {
  assert.equal(highestRole(["Sales", "Purchase", "Logistics"]), "Logistics");
  assert.equal(highestRole(["Sales", "Purchase"]), "Purchase");
  assert.equal(highestRole(["Sales"]), "Sales");
});
