---
name: Clerk MFA availability
description: What is needed before enabling two-factor authentication for this app
---

The Clerk setup can carry MFA requirements through the real sign-in flow, but enabling Authenticator/backup-code methods is a Clerk dashboard setting. In this workspace, dashboard access requires a personal Replit Pro subscription.

**Why:** MFA is intentionally not recreated with local passwords, JWTs, or browser-only secrets; Clerk must own the second factor so the login remains secure.

**How to apply:** Keep the Security screen MFA-ready and, when dashboard access is available, enable MFA in the Development and Production Clerk instances as appropriate.