---
name: Clerk custom signup
description: Project-specific Clerk constraints for custom registration and profile display.
---

The managed Clerk instance may expose only email and password in its prebuilt registration UI even when the product needs a name. The current React SDK uses the Future custom-flow API for `useSignUp`; the supported path is password signup, email-code verification, and finalization. When first/last-name fields are not enabled in the instance settings, persist the collected name in Clerk unsafe metadata and use it as a display fallback.

**Why:** The project does not have dashboard access for changing Clerk instance settings, and relying on the prebuilt optional-field switch did not render name inputs.

**How to apply:** Keep identity display sourced from Clerk. Prefer `fullName`, first/last name, username, then the project’s Clerk metadata name, and finally the primary email local-part. Never reintroduce hardcoded demo names.