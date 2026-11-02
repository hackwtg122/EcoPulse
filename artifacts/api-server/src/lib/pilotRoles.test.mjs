import assert from "node:assert/strict";
import test from "node:test";
import { canManageUsers, clerkUserIdPattern, decideRoleChange, isPilotRole } from "./pilotRoles.ts";

const admin = "user_Admin1234567890";
const target = "user_Target1234567890";

test("only the three pilot roles are assignable", () => {
  for (const role of ["participant", "verifier", "admin"]) assert.equal(isPilotRole(role), true);
  for (const role of ["owner", "ADMIN", "", null, 7, undefined]) assert.equal(isPilotRole(role), false);
  assert.equal(canManageUsers("admin"), true);
  assert.equal(canManageUsers("verifier"), false);
});

test("Clerk ids are validated before use", () => {
  assert.equal(clerkUserIdPattern.test("user_3KUsHCqCaJlD7fTErwmWLX0R1Ai"), true);
  assert.equal(clerkUserIdPattern.test("org_3KUsHCqCaJlD7fTErwmWLX0R1Ai"), false);
  assert.equal(clerkUserIdPattern.test("user_"), false);
  assert.equal(clerkUserIdPattern.test("user_abc;drop"), false);
  assert.equal(clerkUserIdPattern.test("user_" + "a".repeat(65)), false);
});

test("promotion and demotion between non-admin roles are allowed", () => {
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: target, currentRole: "participant", requestedRole: "verifier", adminCount: 1 }),
    { ok: true, nextRole: "verifier", noop: false },
  );
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: target, currentRole: "verifier", requestedRole: "participant", adminCount: 1 }),
    { ok: true, nextRole: "participant", noop: false },
  );
});

test("an administrator can promote another account to admin", () => {
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: target, currentRole: "participant", requestedRole: "admin", adminCount: 1 }),
    { ok: true, nextRole: "admin", noop: false },
  );
});

test("the last administrator cannot be demoted", () => {
  assert.deepEqual(
    decideRoleChange({ actorId: "user_OtherAdmin123456", targetId: admin, currentRole: "admin", requestedRole: "participant", adminCount: 1 }),
    { ok: false, status: 409, code: "last_admin_protected" },
  );
  assert.deepEqual(
    decideRoleChange({ actorId: "user_OtherAdmin123456", targetId: admin, currentRole: "admin", requestedRole: "verifier", adminCount: 2 }),
    { ok: true, nextRole: "verifier", noop: false },
  );
});

test("nobody can remove their own administrator role", () => {
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: admin, currentRole: "admin", requestedRole: "participant", adminCount: 5 }),
    { ok: false, status: 409, code: "cannot_self_demote" },
  );
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: admin, currentRole: "admin", requestedRole: "admin", adminCount: 5 }),
    { ok: true, nextRole: "admin", noop: true },
  );
});

test("invalid targets and self-registration escalation are rejected", () => {
  assert.deepEqual(
    decideRoleChange({ actorId: admin, targetId: "org_123", currentRole: "participant", requestedRole: "admin", adminCount: 1 }),
    { ok: false, status: 400, code: "invalid_target" },
  );
  assert.deepEqual(
    decideRoleChange({ actorId: "user_New1234567890", targetId: "user_New1234567890", currentRole: "participant", requestedRole: "admin", adminCount: 1, selfRegistration: true }),
    { ok: false, status: 403, code: "self_registration_role_forbidden" },
  );
  assert.deepEqual(
    decideRoleChange({ actorId: "user_New1234567890", targetId: "user_New1234567890", currentRole: "participant", requestedRole: "participant", adminCount: 1, selfRegistration: true }),
    { ok: true, nextRole: "participant", noop: true },
  );
});
