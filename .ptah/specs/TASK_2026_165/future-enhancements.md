# TASK_2026_165 — Future Enhancements (deferred, non-blocking)

From the code-logic review (APPROVED, 0 critical/serious). These were consciously
deferred to keep this diff minimal; none block the feature.

## 1. Extract a shared `ADMIN_EMAILS` allowlist parser (Moderate)

`isAdminEmail`/allowlist parsing now exists in THREE byte-identical copies:

- `apps/ptah-license-server/src/admin/admin.guard.ts:41-54`
- `apps/ptah-license-server/src/admin/admin.service.ts:716-724`
- `apps/ptah-license-server/src/discourse/discourse.controller.ts` (new)

Risk: a future change to allowlist semantics applied to one copy but not the others
→ silent authorization drift between the native admin dashboard and Discourse admin.
Fix: extract `isEmailInAdminAllowlist(email, rawEnvValue): boolean` (e.g.
`admin/admin-emails.util.ts`), have all three call it, cover it once with tests.

## 2. Zod-validate the `/licenses/me` client response (Nit)

`apps/ptah-landing-page/src/app/services/subscription-state.service.ts` uses an
unchecked `http.get<LicenseData>(...)` assertion — an outlier vs CLAUDE.md's
"Zod at all external boundaries" (the sibling `members-api.service.ts` validates
`/members/sessions` with Zod). This diff adds `communityUrl` to that unchecked path.
Fix: add a Zod schema for the `/licenses/me` response mirroring `members-api.service.ts`.

## 3. Discourse admin grant/revoke audit trail (Nit)

The native admin dashboard audits every denial (`admin.guard.ts:65-67`); the
Discourse-facing admin assertion has no equivalent trail, so a demotion is only
inferable from "the badge is gone." Optional: emit an audit-log entry per SSO
admin grant/revoke for post-hoc discoverability.

## Applied in this task (from the same review)

- Moderate #1 (silent fail-closed logging) — FIXED: `logger.warn` added to the
  `ADMIN_EMAILS`-unset branch of `discourse.controller.ts` `isAdminEmail`.
- Nit #1 (no direct test for `isAdminEmail`) — FIXED: `discourse.controller.spec.ts`
  added (6 cases: match, case-insensitive, whitespace, not-in-list, unset→false, separators-only→false).
