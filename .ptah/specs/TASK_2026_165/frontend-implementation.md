# TASK_2026_165 — Frontend Implementation (Discourse one-click Community entry)

## Goal delivered

Every authenticated landing-page user now gets a visible, one-click **Community Forum** entry that logs them straight into Discourse. The link points at the DiscourseConnect SSO-initiation endpoint (not the forum root), so the present `ptah_auth` cookie completes the handshake and the user lands already logged in:

```
href = `${communityUrl}/session/sso?return_path=%2F`
```

`communityUrl` is always derived from the API (`/licenses/me` for the nav, `/members/sessions` for the members page) — never hardcoded. When it is `null` (integration off / older response), every entry is hidden entirely (no dead links).

## Files changed

### 1. `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`

- Added `communityUrl?: string | null` to the `LicenseData` interface. Optional so older/cached `/licenses/me` responses without the field still type-check; callers default a missing value to `null`.

### 2. `apps/ptah-landing-page/src/app/services/subscription-state.service.ts`

- Added a `communityUrl` computed signal: `computed(() => this._licenseData()?.communityUrl ?? null)`. (`computed` was already imported.) This service is the `/api/v1/licenses/me` client; it casts `http.get<LicenseData>` directly — there is no Zod schema object here (the Zod boundary lives in `members-api.service.ts`), so the field flows through the interface typing, matching the file's existing pattern.

### 3. `apps/ptah-landing-page/src/app/components/navigation.component.ts`

- Imports: added `computed` (from `@angular/core`), `MessagesSquare` (lucide-angular), and `SubscriptionStateService`.
- Class: added `MessagesSquareIcon` reference; injected `SubscriptionStateService`; added `forumSsoUrl` computed that builds `${base}/session/sso?return_path=%2F` or `null` from `subscriptionState.communityUrl()`.
- Constructor: `afterNextRender` now also triggers `fetchSubscriptionState()` (idempotent/cached, self-gates on auth) via `takeUntilDestroyed(destroyRef)` so the nav has `communityUrl` available.
- Template — **desktop** Community overflow dropdown: added a "Community Forum" `<a>` guarded by `@if (isAuthenticated() && forumSsoUrl(); as forumUrl)`, placed above Reddit/LinkedIn, styled to match the existing dropdown items.
- Template — **mobile** menu: added the same "Community Forum" entry (mobile styling) above the Reddit link, same guard.

### 4. `apps/ptah-landing-page/src/app/pages/members/members-page.component.ts`

- Imports: added `computed`.
- Added `communitySsoUrl` computed: `${base}/session/sso?return_path=%2F` or `null` from the existing `communityUrl` signal.
- Template: changed the "Open Community" button guard from `@if (communityUrl(); as url)` to `@if (communitySsoUrl(); as url)`, so its `[href]` is now the SSO deep-link. Since `communitySsoUrl` is `null` exactly when `communityUrl` is `null`, the existing `@else` "being set up" fallback is preserved.

## UX behavior

- **Authenticated + `communityUrl` present:** "Community Forum" appears in the nav overflow dropdown (desktop) and mobile menu, and the members-page "Open Community" button deep-links to SSO. Clicking any of them opens the forum in a new tab already logged in.
- **Unauthenticated or `communityUrl` null:** all entries are hidden (nav) / the members page shows the "being set up" copy. No dead links.

## Standards / constraints honored

- `ChangeDetectionStrategy.OnPush`, signals + `computed()` + `inject()` only; no new RxJS subjects (reused `takeUntilDestroyed`).
- All forum links use `target="_blank" rel="noopener noreferrer"`, consistent with the existing members button and other external links.
- No hardcoded Discourse URL; no `[innerHTML]`. Tailwind 3 + daisyui 4 + lucide-angular, matching existing nav/dropdown visual style.
- Changes are minimal and focused; no unrelated refactors.

## Verification

- `ptah-landing-page` has no `typecheck` target, so verified via the Angular compiler: `npx nx build ptah-landing-page --configuration=development` → **succeeded** (types + templates compiled clean, 6 routes prerendered). This confirms the `MessagesSquare` lucide export exists and the new `@if` control-flow blocks are valid.

## Contract assumption (parallel backend)

`GET /api/v1/licenses/me` returns `{ ...existing, communityUrl: string | null }`. Frontend treats an absent field as `null` (entry hidden) — no runtime crash on older responses.
