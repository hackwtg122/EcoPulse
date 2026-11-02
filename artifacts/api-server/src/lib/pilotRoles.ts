// Pure role-management policy. Keeping the decisions here makes the security
// rules testable without a database or a live Clerk session.
export const pilotRoles = ["participant", "verifier", "admin"] as const;
export type PilotRole = (typeof pilotRoles)[number];

// Clerk user IDs look like `user_` followed by base62 characters. Reject
// anything else so a malformed value never reaches the role endpoint.
export const clerkUserIdPattern = /^user_[A-Za-z0-9]{3,64}$/;

export function isPilotRole(value: unknown): value is PilotRole {
  return typeof value === "string" && (pilotRoles as readonly string[]).includes(value);
}

export function canManageUsers(role: unknown): boolean {
  return role === "admin";
}

export type RoleChangeRequest = {
  actorId: string;
  targetId: string;
  currentRole: PilotRole;
  requestedRole: PilotRole;
  adminCount: number;
  selfRegistration?: boolean;
};

export type RoleChangeDecision =
  | { ok: true; nextRole: PilotRole; noop: boolean }
  | { ok: false; status: number; code: string };

// An administrator may change another account's role, but the system must never
// be left without an administrator and nobody may remove their own privileges.
export function decideRoleChange(input: RoleChangeRequest): RoleChangeDecision {
  const { actorId, targetId, currentRole, requestedRole, adminCount } = input;

  // Self-service registration always lands as participant; this guard defends
  // the same rule if a caller ever tries to reuse this decision for sign-up.
  if (input.selfRegistration && requestedRole !== "participant") {
    return { ok: false, status: 403, code: "self_registration_role_forbidden" };
  }
  if (!clerkUserIdPattern.test(targetId)) {
    return { ok: false, status: 400, code: "invalid_target" };
  }
  if (targetId === actorId && currentRole === "admin" && requestedRole !== "admin") {
    return { ok: false, status: 409, code: "cannot_self_demote" };
  }
  if (currentRole === requestedRole) {
    return { ok: true, nextRole: requestedRole, noop: true };
  }
  if (currentRole === "admin" && requestedRole !== "admin" && adminCount <= 1) {
    return { ok: false, status: 409, code: "last_admin_protected" };
  }
  return { ok: true, nextRole: requestedRole, noop: false };
}
