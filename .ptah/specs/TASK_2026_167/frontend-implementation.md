# TASK_2026_167 B2 — Community activity widget (frontend)

## Result

`npx nx build ptah-landing-page --configuration=development` — **SUCCESS** (19.3s). members-page chunk 54.63 kB (lean, no new deps; reuses existing `ExternalLink` lucide icon). No typecheck target exists; build is the gate. Not committed.

## Changes

### 1. `apps/ptah-landing-page/src/app/services/members-api.service.ts`

- Added `communityTopicSchema` + `communitySummaryResponseSchema` Zod schemas and exported `CommunityTopic` / `CommunitySummaryResponse` types — mirrors the existing `/members/sessions` boundary-validation pattern (same `validate()` helper).
- Added `getCommunitySummary(): Observable<CommunitySummaryResponse>` calling `GET /api/v1/community/summary` (full path — this endpoint is a sibling of `/members`, not under `this.base`). Validated against the schema exactly like `getSessions()`.

### 2. `apps/ptah-landing-page/src/app/pages/members/components/community-topic-list.component.ts` (new, presentational)

- OnPush, signals-only dumb component (mirrors `SessionCardComponent`). Inputs: `communityUrl: string` (required) + `topics: readonly CommunityTopic[]` (required).
- `rows` computed caps at 5, builds each SSO deep-link `${communityUrl}/session/sso?return_path=${encodeURIComponent('/t/'+slug+'/'+id)}` (origin derived from `communityUrl`, never hardcoded), and a muted meta line `category · relative-time · N posts` (empty segments dropped, correct post/posts pluralization).
- Each row is `<a target="_blank" rel="noopener noreferrer">` with truncated title + aria-label. Uses `ExternalLink` lucide icon. No `[innerHTML]`.
- Exports a **pure** `formatRelativeTime(iso: string | null): string` helper (Intl.RelativeTimeFormat, viewer locale) — returns `''` for null/unparseable so callers drop the segment.

### 3. `apps/ptah-landing-page/src/app/pages/members/members-page.component.ts`

- Imports the new component + `CommunityTopic`.
- New signals `topics` / `topicsLoading`.
- Community card body (inside the existing `communitySsoUrl()` gate — so hidden entirely when `communityUrl` is null): shows a 3-row pulse skeleton while `topicsLoading()`, then `<ptah-community-topic-list>` when `topics().length > 0`, otherwise nothing extra (the existing "Open Community" CTA stays). `communityUrl()!` is safe there because `communitySsoUrl` is truthy iff `communityUrl` is non-null.
- `loadCommunitySummary()` is fired from the `/members/sessions` success handler (only members reach a 200), running alongside the existing data flow via `takeUntilDestroyed(this.destroyRef)`. Best-effort: any error collapses to `topics = []` (never an error state), matching the contract's "`[]` on off/error".

## States (per spec)

- **Hidden**: `communityUrl` null → whole community-activity block gated out (same gate as the CTA).
- **Loading**: pulse skeleton consistent with page.
- **Empty** (`topics.length === 0`): keeps the "Open Community" CTA, no list, no error.
- **Populated**: up to 5 topic rows, newest first (API-ordered), each a one-click SSO deep-link.

## Notes / follow-ups

- No pre-existing members-api/members-page spec files exist in the repo, so none were broken; did not author new specs (build is the only verify gate for this app). The pure `formatRelativeTime` and `getCommunitySummary` schema are trivially unit-testable if the team later adds a spec.
- Fetch is gated behind sessions-success so non-Builders (403) never make a wasted community call.
