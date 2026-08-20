# Code Logic Review - TASK_2026_165 (Discourse SSO Integration)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 2        |
| Minor / Nits        | 3        |
| Failure Modes Found | 4        |

This is a small, focused, security-sensitive change and it is well executed. I went in assuming a privilege-escalation bug existed somewhere in the admin/moderator boolean logic or the allowlist parsing — I could not find one. The `admin`/`moderator` fields are unconditionally emitted on every `buildResponse()` call (never omitted), driven from a single `isAdmin` boolean computed fresh on every SSO request from the `ADMIN_EMAILS` allowlist, with parse semantics that are a verified byte-for-byte match of `AdminGuard`. `email`/`id` used in the payload originate from the JWT-validated `ptah_auth` cookie (`safeValidate` → `AuthService.validateToken`), not from the request query/body, so there is no attacker-controlled input reaching the signed payload. The signature is computed over the full querystring, generated _after_ all params (including the new ones) are set, so `admin`/`moderator` are covered by the HMAC same as everything else.

The findings below are maintainability/defense-in-depth observations, not exploitable bugs in this diff.

## The 5 Paranoid Questions

### 1. How does this fail silently?

- `discourse.controller.ts:139-149` (`isAdminEmail`) fails **silently closed** by design when `ADMIN_EMAILS` is unset — returns `false` with no log line, no warning. This is intentional (SSO must not 403 for non-admins on a deploy where only the SSO secret is configured but the admin allowlist isn't), but it means a misconfigured production deploy (admin allowlist accidentally dropped from env) silently demotes every admin's Discourse account on their next login with zero observability. `AdminGuard` logs an `logger.error` in the equivalent unset case (line 43-45); this path logs nothing. Worth at least a `logger.debug`/`logger.warn` once so an operator can grep for "ADMIN_EMAILS not set during Discourse SSO" if someone's forum admin access silently vanishes. (Moderate — operational blind spot, not a security hole, since fail-closed is the correct security posture.)
- `license.controller.ts` — `communityUrl()` returns `null` on any falsy/whitespace `DISCOURSE_URL`, with no logging either. Combined with the frontend hiding the entry on `null`, a misconfigured `DISCOURSE_URL` (e.g., someone sets it to a single space) silently removes the Community entry for every user with zero server-side signal. Low impact (correct fail-safe direction) but same "silent" pattern.

### 2. What user action causes unexpected behavior?

- A user who was manually promoted to Discourse admin out-of-band (e.g., via `rails console`, matching the task's stated intent) gets **silently demoted** on their very next SSO login if their email isn't in `ADMIN_EMAILS`. This is explicitly the intended behavior per the design doc ("intended"), but operationally it means any support-driven manual promotion is a dead end unless `ADMIN_EMAILS` is updated first — worth making sure this is documented for whoever runs Discourse ops, since the demotion is invisible (no log, no Discourse-side notification hook here).
- Frontend: clicking "Community Forum" always opens a **new tab** (`target="_blank"`) that lands on `/session/sso?return_path=%2F`. If the user's `ptah_auth` cookie has expired between page load (when `communityUrl` was fetched) and click, Discourse will bounce them through `loginRedirect()` back to `/login?returnUrl=...` — but `returnUrl` is the _license-server's_ SSO endpoint URL, not the landing page, so after logging in again the user is correctly carried through the full DiscourseConnect handshake and lands in Discourse, not stuck back on the marketing site. This works correctly — no dead end — but it's exactly the kind of race worth a manual QA pass (login in tab A, let session expire, click Community Forum in tab A) since it isn't covered by any automated test in this diff.

### 3. What data makes this produce wrong results?

- Email-based admin matching is comparison-only (`allowlist.includes(email.trim().toLowerCase())`) with no email-format validation. Since `email` comes from the DB (already validated at signup by WorkOS), this is low risk, but note it is a straight string-equality check — Unicode confusable/normalization tricks (e.g., a homoglyph email that WorkOS/your IdP allowed to register) could theoretically produce an unexpected match/non-match. This is inherited from `AdminGuard`'s existing semantics, not new here, and is out of scope to fix, but flagging since this diff extends the blast radius of that comparison from "native admin dashboard" to "Discourse forum admin/moderator".
- `ADMIN_EMAILS` containing only separators (e.g. `,,,` or a single stray comma) parses to an empty array after `.filter(Boolean)`, so `isAdminEmail` returns `false` for everyone — correctly fails closed, not a bug, but worth noting there's no distinction between "ADMIN_EMAILS unset" and "ADMIN_EMAILS set to garbage" in terms of behavior (both silently yield no admins). Fine for security; slightly opaque for ops.

### 4. What happens when dependencies fail?

- `resolveName()` and `isBuildersMember()` both have their own error handling (try/catch or defensive Prisma checks) established prior to this change; `isAdminEmail()` has no DB/HTTP dependency (`ConfigService.get` is synchronous and can't throw for a missing key), so there's no new failure surface introduced by this diff on the backend.
- Frontend: `fetchSubscriptionState()` (`subscription-state.service.ts:163-206`) is defensive — gated by `_isFetched`/`_isLoading` (idempotent, safe against the nav's `afterNextRender` firing once per component instance and against pricing-page/members-page separately calling it on the shared root-provided singleton), checks `AuthService.isAuthenticated()` first (no `/licenses/me` call at all for anonymous users, so nothing errors for anon), and both the auth-check and the HTTP-call are wrapped in `catchError` that resolve to `of(null)` while always setting `_isFetched(true)` — so a network failure can't cause an infinite retry loop or an unhandled rejection. This is genuinely robust.
- One residual gap: if `/licenses/me` fails (`catchError` at line 183-193), `_licenseData` stays `null` and `_isFetched` becomes `true` permanently for the lifetime of the singleton service — so `communityUrl()` will return `null` (Community entry stays hidden) until the user does something that calls `refresh()`. There is no automatic retry. This is consistent with the rest of the service's existing error-handling pattern (not a new regression), but it does mean a transient network blip on first page load can hide the Community entry for the rest of the session unless the user navigates to a page that calls `.refresh()`. Low severity — matches the existing UX contract for the whole subscription-state service, not specific to this feature.

### 5. What's missing that the requirements didn't mention?

- No test exists for `discourse.controller.ts`'s `isAdminEmail` directly (the implementation doc explicitly calls this out — "out of minimal scope"). The behavior is only exercised indirectly through `discourse-sso.service.spec.ts`, which tests `buildResponse()` given an already-computed `isAdmin` boolean — it does **not** test the allowlist-parsing/email-matching logic in the controller (comma-split, trim, case-insensitivity, fail-closed-on-unset). This is the one true gap in the test suite: the actual security-sensitive parsing code (`isAdminEmail`) has zero direct unit coverage. Given this is a private method with no exported seam, a small `discourse.controller.spec.ts` (mocking `AuthService`/`Prisma` minimally) asserting: (a) mixed-case email matches, (b) whitespace in `ADMIN_EMAILS` is tolerated, (c) unset `ADMIN_EMAILS` → `false` not a throw, (d) email not in list → `false`, would close this gap. I'd flag this as the single actionable follow-up, though I would not block the PR on it given the logic is a verified line-for-line duplicate of already-tested `AdminGuard`/`AdminService` code.
- No mention of what happens to a Discourse admin's session/permissions _within_ an already-open Discourse tab if `ADMIN_EMAILS` changes mid-session — that's entirely a Discourse-side concern (DiscourseConnect only asserts on login) and out of scope for this codebase, but worth the team knowing: revocation is next-login, not real-time.
- Triplicated allowlist-parsing logic (see Moderate Issue 1 below) is an implicit "should we DRY this" question the requirements don't raise but a reviewer should.

## Failure Mode Analysis

### Failure Mode 1: Silent ADMIN_EMAILS misconfiguration drops admin access with no observability

- **Trigger**: `ADMIN_EMAILS` env var accidentally unset/emptied in production (deploy config drift) while `DISCOURSE_SSO_SECRET`/`DISCOURSE_URL` remain set.
- **Symptoms**: Every previously-admin Discourse account gets silently demoted (`admin=false`, `moderator=false`) on next login. No error, no log line, no alert.
- **Impact**: Medium — an admin loses forum moderation capability with no diagnostic trail; support has to manually re-diagnose why "admin lost their badge."
- **Current Handling**: Fails closed correctly (safe direction) but with zero logging (unlike `AdminGuard`, which logs an error in the equivalent case).
- **Recommendation**: Add a single `this.logger.warn('ADMIN_EMAILS not configured — Discourse SSO asserting admin=false for all users')` inside the unset branch of `isAdminEmail`, throttled/once, so ops has a breadcrumb.

### Failure Mode 2: Triplicated ADMIN_EMAILS parser risks silent semantic drift

- **Trigger**: A future change to the allowlist format (e.g., supporting domain wildcards, semicolon separators, or `Set` normalization) is applied to one copy (say `AdminGuard`) but the other two (`AdminService.isAdminEmail`, `DiscourseController.isAdminEmail`) are missed.
- **Symptoms**: The native admin dashboard and the Discourse SSO admin assertion silently disagree on who is an admin — e.g., someone added via a new wildcard rule gets dashboard access but not Discourse admin, or vice versa.
- **Impact**: Medium — an authorization inconsistency between two admin surfaces is exactly the kind of bug that's invisible until someone notices "I have admin on X but not Y," and by then the drift may be old.
- **Current Handling**: Three independent, byte-identical private methods (`admin.guard.ts:41-54`, `admin.service.ts:716-724`, `discourse.controller.ts:139-149`) with no shared source of truth. The new code correctly replicates existing semantics (verified line-for-line), so there's no _current_ drift, but the risk is structural.
- **Recommendation**: Non-blocking for this PR (task scope explicitly said "reuse this exact semantics," implying inline duplication was the accepted trade-off for minimal diff), but flag as tech debt: extract a shared `parseAdminAllowlist(raw: string | undefined): string[]` (or `isEmailInAdminAllowlist(email, raw)`) helper, e.g. in a small `admin-emails.util.ts`, and have all three call sites use it.

### Failure Mode 3: Discourse SSO admin assertion untested at the allowlist-parsing layer

- **Trigger**: A regression in `discourse.controller.ts`'s `isAdminEmail` (e.g., someone "simplifies" it to `raw.includes(email)` during a future refactor) ships without any test catching it, because the only tests that reference `isAdmin` (`discourse-sso.service.spec.ts`) take the boolean as a given input rather than exercising the parsing/matching code.
- **Symptoms**: Silent authorization bug — could go either direction (over-grant or under-grant admin).
- **Impact**: High if it happened, but currently Low probability since the code is a verified match of already-tested logic elsewhere; the risk is purely about _future_ regressions in this specific file being invisible to CI.
- **Current Handling**: None — acknowledged gap in `backend-implementation.md`.
- **Recommendation**: Add a lightweight `discourse.controller.spec.ts` covering just `isAdminEmail` via a partial/minimal instantiation, or extract it into the shared util from Failure Mode 2 and rely on that util's own test suite.

### Failure Mode 4: Stale `communityUrl` after transient `/licenses/me` failure hides Community entry for the session

- **Trigger**: `/api/v1/licenses/me` returns a transient error (network blip, 5xx) on the very first fetch triggered by `navigation.component.ts`'s `afterNextRender`.
- **Symptoms**: `_isFetched` latches `true`, `_licenseData` stays `null`, so `communityUrl()` stays `null` and the Community Forum entry never appears anywhere in the app for that page-load session, even after the transient failure clears, until something calls `.refresh()`.
- **Impact**: Low — cosmetic (a real Builder loses a convenience nav link for one session), not a security or data-loss issue, and it's the same latch pattern the rest of `SubscriptionStateService`'s consumers already accept (e.g. `currentPlanTier`, `hasActiveSubscription` have the identical staleness characteristic).
- **Current Handling**: Consistent with existing service-wide behavior; not a regression introduced by this diff.
- **Recommendation**: None required for this PR — pre-existing architectural characteristic, out of scope to change here.

## Critical / Serious Issues

None found.

## Moderate Issues

### Issue 1: Silent fail-closed logging gap in `isAdminEmail`

- **File**: `apps/ptah-license-server/src/discourse/discourse.controller.ts:139-149`
- **Scenario**: `ADMIN_EMAILS` unset/empty in production.
- **Impact**: No observability when admin/moderator assertions silently go to `false` for everyone (see Failure Mode 1).
- **Evidence**:
  ```ts
  private isAdminEmail(email: string): boolean {
    const raw = this.configService.get<string>('ADMIN_EMAILS');
    if (!raw || raw.trim().length === 0) {
      return false;
    }
    ...
  }
  ```
- **Fix**: Add a `this.logger.warn(...)` (or `debug`) in the unset branch, mirroring `AdminGuard`'s `logger.error` for the same condition (adjusted to non-throwing severity since this path is expected/benign on a deploy without an admin list configured).

### Issue 2: Triplicated ADMIN_EMAILS allowlist parser (drift risk)

- **File**: `apps/ptah-license-server/src/discourse/discourse.controller.ts:139-149` vs. `apps/ptah-license-server/src/admin/admin.guard.ts:41-54` vs. `apps/ptah-license-server/src/admin/admin.service.ts:716-724`
- **Scenario**: Future edit to allowlist semantics applied inconsistently across the three copies.
- **Impact**: Silent authorization inconsistency between the native admin dashboard and Discourse forum admin (see Failure Mode 2).
- **Evidence**: Three independent, currently-identical implementations of the same comma-split/trim/lowercase/filter/includes logic.
- **Fix**: Not blocking — acceptable given stated minimal-diff constraint — but recommend a follow-up ticket to extract a shared `parseAdminAllowlist`/`isAdminEmail(email, raw)` utility used by all three call sites.

## Minor / Nits

1. **No dedicated `discourse.controller.spec.ts`** for `isAdminEmail` (acknowledged gap in the implementation doc) — see Failure Mode 3. Recommend adding before this ships to prod, even though risk is currently low.
2. **No Zod schema on `subscription-state.service.ts`'s `/licenses/me` client** — `http.get<LicenseData>(...)` is an unchecked type assertion (pre-existing pattern in this file, not introduced by this diff; `members-api.service.ts` does have `communityUrl: z.string().nullable()` validated via Zod for the sibling `/members/sessions` endpoint). Given `CLAUDE.md`'s "Zod at all external boundaries" standard, this file is already an outlier; not this PR's responsibility to fix, but worth flagging since this diff adds a new field to that unchecked path.
3. **`discourse.controller.ts:139` JSDoc says "fails CLOSED silently"** — accurate and honest about the trade-off, good documentation; no change needed, just noting the self-awareness is appreciated and matches Issue 1's finding (the doc comment already tells the reader this is deliberately a silent path).

## Data Flow Analysis

```
[ptah_auth JWT cookie] --safeValidate()--> { id, email } (server-trusted, not request-derived)
        |
        v
isAdmin = isAdminEmail(email)   [ADMIN_EMAILS env, comma/trim/lowercase/filter, fail-closed->false]
isBuilders = isBuildersMember(id)  [Prisma: subscription OR active builders license]
name = resolveName(id, email)      [Prisma profile OR email local-part fallback]
        |
        v
ssoService.buildResponse({ nonce, externalId: id, email, name, isBuilders, isAdmin })
        |  -- params.set('admin', isAdmin?'true':'false')          <- ALWAYS present, both branches
        |  -- params.set('moderator', isAdmin?'true':'false')      <- ALWAYS present, both branches
        |  -- add_groups/remove_groups builders                    <- unchanged, always present
        v
base64(querystring) --HMAC-SHA256(DISCOURSE_SSO_SECRET)--> sig
        |
        v
302 -> DISCOURSE_URL/session/sso_login?sso=<b64>&sig=<hex>   [signature covers admin/moderator too]
```

```
[license.controller.ts getMyLicense()] --> communityUrl() reads DISCOURSE_URL (ConfigService, trimmed,
        trailing-slash stripped, or null) --> attached to ALL 3 return branches (not-found / no-license / has-license)
        |
        v
[frontend subscription-state.service.ts] licenseData().communityUrl ?? null --computed--> communityUrl()
        |
        v
[navigation.component.ts] forumSsoUrl = communityUrl() ? `${base}/session/sso?return_path=%2F` : null
        |  guarded by @if (isAuthenticated() && forumSsoUrl(); as forumUrl)
        v
<a [href]="forumUrl" target="_blank" rel="noopener noreferrer">   -- server-controlled URL only, no user input in href
```

### Gap Points Identified

1. No gap points found where data can be lost/corrupted — the payload is built from server-trusted DB/JWT/env data end to end.
2. No gap point where the signature could be bypassed by the new fields — `buildResponse()` computes `sig` over the _entire_ finished `params.toString()`, which includes `admin`/`moderator`, so the new fields are cryptographically bound.
3. Minor observability gap (not a data-integrity gap): the fail-closed path in `isAdminEmail` has no logging (Issue 1).

## Requirements Fulfillment

| Requirement                                                      | Status   | Concern                                                                                                                                      |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Assert `admin`/`moderator` from `ADMIN_EMAILS` on every login    | COMPLETE | None — both branches (true/false) always emitted.                                                                                            |
| `ADMIN_EMAILS` is single source of truth (auto-demote)           | COMPLETE | Confirmed by design and tests; operationally silent (Issue 1).                                                                               |
| Reuse `AdminGuard`'s exact parse semantics                       | COMPLETE | Verified line-for-line identical logic; now tripled across 3 files (Issue 2).                                                                |
| Fail closed without throwing (SSO still succeeds for non-admins) | COMPLETE | Verified — returns `false`, no exception path.                                                                                               |
| `communityUrl` on `/licenses/me`, all 3 branches, null-safe      | COMPLETE | Verified in code and in tests for all 3 branches.                                                                                            |
| Trimmed / trailing-slash-stripped                                | COMPLETE | Verified via test asserting `'  https://forum.ptah.live/  '` → `'https://forum.ptah.live'`.                                                  |
| Frontend href from server `communityUrl` only, hidden when null  | COMPLETE | Verified — `forumSsoUrl`/`communitySsoUrl` derive strictly from the injected service/signal; no hardcoded fallback URL anywhere in the diff. |
| `rel="noopener noreferrer"`, no `[innerHTML]`                    | COMPLETE | Verified in both nav (desktop + mobile) and members-page template diffs.                                                                     |
| OnPush/signals                                                   | COMPLETE | All new state is `computed()`/signal-derived; no new RxJS subjects.                                                                          |
| `fetchSubscriptionState()` safe for anon users                   | COMPLETE | Gates on `AuthService.isAuthenticated()` before hitting `/licenses/me`; catches errors; idempotent via `_isFetched`/`_isLoading`.            |
| Existing `builders` add_groups/remove_groups unaffected          | COMPLETE | Diff only appends new `params.set` calls after the existing block; unchanged logic verified.                                                 |
| Feature-off invariants preserved                                 | COMPLETE | `communityUrl()` null when `DISCOURSE_URL` unset; SSO still 403s via pre-existing `discourseBaseUrl()` guard (unchanged).                    |
| Tests assert true/false admin cases and communityUrl null/set    | COMPLETE | Verified in `discourse-sso.service.spec.ts` (2 new cases) and `license.controller.spec.ts` (2 new cases covering all 3 branches + trim).     |
| Direct unit coverage of `isAdminEmail` allowlist parsing         | MISSING  | No `discourse.controller.spec.ts`; acknowledged gap (Failure Mode 3, Nit 1).                                                                 |

### Implicit Requirements NOT Addressed

1. No logging/alerting when `ADMIN_EMAILS` is unset during an SSO login that would otherwise assert admin (Failure Mode 1) — not asked for, but a reasonable production hardening expectation for a security-relevant fail-closed path.
2. No mechanism to know, from the license-server's perspective, that a Discourse admin was actually demoted (e.g., an audit-log entry analogous to the existing "audit every admin-dashboard denial" pattern in `AdminGuard`). The task's own admin dashboard logs every denial (`admin.guard.ts:65-67`); the Discourse-facing equivalent has no such trail.

## Edge Case Analysis

| Edge Case                                                    | Handled | How                                                                                                                             | Concern                                                                                  |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ADMIN_EMAILS` unset                                         | YES     | Returns `false`, no throw                                                                                                       | Silent — no log (Issue 1)                                                                |
| `ADMIN_EMAILS` = `""` / whitespace-only                      | YES     | `.trim().length === 0` check catches it                                                                                         | None                                                                                     |
| `ADMIN_EMAILS` = `",,,"`                                     | YES     | `.filter(Boolean)` empties out; `.includes()` on `[]` → false                                                                   | None                                                                                     |
| Mixed-case email match                                       | YES     | Both sides `.trim().toLowerCase()`                                                                                              | None                                                                                     |
| Email with surrounding whitespace (DB drift)                 | YES     | `.trim()` on both list and input email                                                                                          | None                                                                                     |
| `admin`/`moderator` never both omitted                       | YES     | Unconditional `params.set(...)` outside any conditional                                                                         | None — this is the core invariant, verified correct                                      |
| `DISCOURSE_URL` unset → `communityUrl` null (`/licenses/me`) | YES     | `communityUrl()` returns `null` on falsy                                                                                        | Verified by test across all 3 branches                                                   |
| `DISCOURSE_URL` with trailing slash / whitespace             | YES     | `.trim()` + `.replace(/\/+$/, '')`                                                                                              | Verified by test                                                                         |
| Frontend: `communityUrl` absent (older cached response)      | YES     | `?? null` on the interface field (optional)                                                                                     | None — matches stated contract assumption                                                |
| Frontend: anonymous user visits nav                          | YES     | `fetchSubscriptionState()` checks `isAuthenticated()` first; `forumSsoUrl` also gated by `isAuthenticated() &&` in the template | Double-gated, safe                                                                       |
| Frontend: `/licenses/me` request fails                       | YES     | `catchError` → `of(null)`, sets `_isFetched(true)`                                                                              | Entry stays hidden for the session (Failure Mode 4) — low severity, pre-existing pattern |
| Rapid repeated nav renders re-triggering fetch               | YES     | `_isFetched`/`_isLoading` guard makes `fetchSubscriptionState()` idempotent                                                     | None                                                                                     |
| Signature integrity with new params                          | YES     | `sig` computed over full `params.toString()` after all `set()` calls                                                            | None — new fields are HMAC-covered                                                       |

## Integration Risk Assessment

| Integration                                                   | Failure Probability                | Impact                                             | Mitigation                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ConfigService.get('ADMIN_EMAILS')` misconfiguration          | LOW-MED (deploy drift)             | Medium — silent admin demotion                     | Add logging (Issue 1)                                                                                          |
| Three independent allowlist-parser copies diverging over time | LOW now, MED over project lifetime | Medium — cross-surface authorization inconsistency | Extract shared util (Issue 2)                                                                                  |
| `/licenses/me` transient failure hiding Community entry       | LOW                                | Low — cosmetic only                                | Pre-existing pattern, no action needed                                                                         |
| DiscourseConnect signature tampering via new params           | Negligible                         | N/A                                                | HMAC covers full querystring including new fields; verified                                                    |
| Frontend href injection via `communityUrl`                    | Negligible                         | N/A                                                | Value is server/env-controlled, not request-echoed; no Zod on this path but no attacker-reachable input either |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: Operational, not exploitable — the fail-closed `ADMIN_EMAILS`-unset path in `discourse.controller.ts:139-149` is silent, so a config-drift incident that strips Discourse admin from every admin account would go unnoticed until someone reports "I lost my mod badge." Recommend adding a single log line as a quick follow-up; not a blocker.

## What Robust Implementation Would Include (beyond this diff, for future hardening)

- A shared `isEmailInAdminAllowlist(email, rawEnvValue)` utility consumed by `AdminGuard`, `AdminService`, and `DiscourseController` instead of three hand-copied implementations, eliminating drift risk entirely.
- A `logger.warn`/`debug` breadcrumb when `ADMIN_EMAILS` is unset during an SSO admin-assertion, for operational visibility parity with `AdminGuard`'s existing `logger.error`.
- A dedicated `discourse.controller.spec.ts` directly unit-testing `isAdminEmail`'s parsing/matching behavior, independent of `discourse-sso.service.spec.ts` (which only tests the downstream `buildResponse` given a precomputed boolean).
- An audit-log entry (mirroring the existing admin-dashboard audit trail) recording Discourse admin grants/revocations per login, so a demotion is discoverable after the fact rather than only inferable from "the badge is gone."
- Zod validation on `subscription-state.service.ts`'s `/licenses/me` HTTP response, matching the boundary-validation standard already applied to the sibling `/members/sessions` client in `members-api.service.ts`.
