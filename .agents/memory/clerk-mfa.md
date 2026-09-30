---
name: Clerk MFA availability
description: What is needed before enabling two-factor authentication for this app
---

The Clerk setup can carry MFA requirements through the real sign-in flow, but enabling Authenticator/backup-code methods is a Clerk dashboard setting. In this workspace, dashboard access requires a personal Replit Pro subscription.

**Why:** MFA is intentionally not recreated with local passwords, JWTs, or browser-only secrets; Clerk must own the second factor so the login remains secure.

**How to apply:** Read `user.twoFactorEnabled`, `user.totpEnabled`, and `user.backupCodeEnabled` for status; use Clerk's TOTP methods for enrollment. The dashboard must still enable the Authenticator strategy before enrollment can succeed.