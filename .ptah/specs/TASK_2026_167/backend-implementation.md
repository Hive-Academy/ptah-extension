# TASK_2026_167 — Backend Implementation (A1 + B1)

Scope: DiscourseConnect SSO polish + read-only, server-proxied in-app community
summary endpoint. License server (NestJS 11) only. No git commit.

## A1 — SSO polish (suppress welcome PM)

**File**: `apps/ptah-license-server/src/discourse/discourse-sso.service.ts`

- In `buildResponse`, after the `admin`/`moderator` params, added
  `params.set('suppress_welcome_message', 'true');` so first-login Builders skip
  Discourse's onboarding welcome PM (Ptah onboards in-app).
- Deliberately did NOT add `avatar_url` — the Prisma user model has no
  avatar/profile-picture field. Noted in the code comment.

**Test**: `discourse-sso.service.spec.ts` — new case asserts the decoded payload
contains `suppress_welcome_message=true` and that `avatar_url` is absent
(`toBeNull()`).

## B1 — GET /api/v1/community/summary (authenticated)

Read path added to the existing tolerant `DiscourseAdminProvider` (reuses its
private, non-throwing `request()` helper + auth-header/timeout pattern). A thin
controller assembles the outbound contract. The browser never sees a Discourse
key — the fetch runs server-side with the admin `Api-Key`/`Api-Username`.

**Contract** (`apps/ptah-license-server/src/discourse/discourse.types.ts`):

- Added `communityTopicSchema` (Zod), `CommunityTopic = z.infer<...>`,
  `communityTopicsSchema` (array), and the `CommunitySummary` response
  interface `{ communityUrl: string | null; topics: CommunityTopic[] }`.
- Zod validates the OUTBOUND mapping at the boundary — a Discourse shape drift
  degrades to `[]` rather than leaking an untyped payload. (zod 4.3.6 is a root
  dep; bundled by esbuild — not in the `external` list, no build config change.)

**Provider** (`discourse-admin.provider.ts`):

- New `async getLatestTopics(limit = 5): Promise<CommunityTopic[]>`:
  - Feature-off (`!isEnabled()`) → `[]`, no network call.
  - `GET /latest.json` via the existing `request()` helper.
  - Maps the newest ≤5 topics to the contract shape (`id`, `title`, `slug`,
    `postsCount` ← `posts_count`, `lastPostedAt` ← `last_posted_at`,
    `categoryName` resolved from a cached id→name map).
  - `categoryName` resolved via new `resolveCategoryNames()` reading
    `GET /categories.json`, cached in `categoryNameCache` (mirrors
    `groupIdCache`: caches on success only, so a transient failure retries and
    categories just resolve to `null` meanwhile).
  - Validates the mapping with `communityTopicsSchema.safeParse`; ANY
    failure / transport error / non-2xx → `[]`. Never throws (inherits the
    provider's tolerant, warn-logged contract).
- New private helpers: `mapTopic()`, `resolveCategoryNames()`; new field
  `categoryNameCache?: Map<number, string>`.

**Controller** (new `discourse/community.controller.ts`):

- `@Controller('v1/community')` → `GET summary` (full path `/api/v1/community/summary`).
- Guarded by `JwtAuthGuard` (same `ptah_auth` cookie gate as
  `MembersController`/authenticated routes).
- `@Throttle({ default: { limit: 30, ttl: 60000 } })`.
- Returns `{ communityUrl, topics }`; `communityUrl` derived from `DISCOURSE_URL`
  (trimmed, no trailing slash, `null` when unset) using the same helper pattern
  as `members.controller.ts:93`.

**Module** (`discourse.module.ts`): registered `CommunityController` in
`controllers`. `DiscourseAdminProvider` is already a provider; `AuthModule`
(for `JwtAuthGuard`/`AuthService`) is already imported.

## Standards adherence

- TS strict; all catches are `catch (error: unknown)` + `instanceof Error`
  (existing provider `request()` helper). New code adds no new catch sites.
- Config via `ConfigService` only — no `process.env`.
- No raw error messages leaked to clients: failures fold into `[]` (200), never
  a 500; provider logs a sanitized `warn`.
- No new vscode RPC namespace — this is a license-server HTTP route, so the
  vscode-core RPC dual-registration rule does not apply (confirmed in spec).
- Minimal/focused: no unrelated refactors; reused the provider's request helper
  rather than adding a second HTTP client.

## Tests

New/updated specs:

- `discourse-sso.service.spec.ts` — `suppress_welcome_message=true` + no `avatar_url`.
- `discourse-admin.provider.spec.ts` (new) — feature-off → `[]`; mocked
  `/latest.json` maps to contract shape (capped at 5, category names resolved);
  unmatched category → `categoryName: null`; transport reject → `[]`; non-2xx → `[]`.

## Verification

- `npx tsc -p apps/ptah-license-server/tsconfig.app.json --noEmit` → exit 0
  (no `nx typecheck` target exists for this project; ran tsc directly).
- `npx nx test ptah-license-server` → PASS: 37 suites passed / 1 skipped,
  475 tests passed / 5 skipped, exit 0.
- Not committed (per instructions).

## Files changed

- `apps/ptah-license-server/src/discourse/discourse-sso.service.ts` (A1)
- `apps/ptah-license-server/src/discourse/discourse-sso.service.spec.ts` (A1 test)
- `apps/ptah-license-server/src/discourse/discourse.types.ts` (contract + Zod)
- `apps/ptah-license-server/src/discourse/discourse-admin.provider.ts` (read method)
- `apps/ptah-license-server/src/discourse/discourse-admin.provider.spec.ts` (new spec)
- `apps/ptah-license-server/src/discourse/community.controller.ts` (new controller)
- `apps/ptah-license-server/src/discourse/discourse.module.ts` (register controller)

---

## Review fixes (code-logic review round 2)

### CRITICAL — authorization gate on /api/v1/community/summary

The endpoint previously fetched topics for ANY authenticated user. Because the
fetch uses the admin `Api-Key` (system-level Discourse visibility), a
non-Builders account could have read gated Builders-category topic titles.
Fixed:

- **New `BuildersMembershipService`** (`discourse/builders-membership.service.ts`)
  — single source of truth for the DB-backed check (active/trialing subscription
  OR active, non-expired `builders` license). Provided + exported by the
  `@Global()` DiscourseModule so it is injectable app-wide.
- **`CommunityController.getSummary`** now takes `@Req() req`, resolves the
  caller (`req.user`), and calls `membership.isBuildersMember(user.id)`. A
  non-member **degrades to `{ communityUrl: null, topics: [] }`** (never a 403,
  consistent with the endpoint's never-fail philosophy) and the Discourse
  provider is not hit at all.
- DRY scope: extracted the shared helper and wired the NEW controller to it.
  `MembersController` and `DiscourseController` still carry their own inline
  copies — migrating them touches existing passing specs, so left as-is to keep
  the fix low-risk (the audit note stands; can DRY in a follow-up).

### SERIOUS — community.controller.spec.ts (new)

- (a) No `ptah_auth` cookie → `JwtAuthGuard.canActivate` throws
  `UnauthorizedException`.
- (b) Authenticated non-Builders → `{ communityUrl: null, topics: [] }` and
  `provider.getLatestTopics` is NOT called.
- (c) Authenticated Builders → topics + resolved `communityUrl` returned
  (provider + membership mocked). Plus a feature-off `communityUrl: null` case.

### MODERATE — guaranteed "newest first"

`getLatestTopics` now maps ALL topics, then `.sort()`s by `lastPostedAt`
descending (nulls last) BEFORE slicing to the limit — ordering is enforced
server-side, not assumed from Discourse's default. (ISO-8601 strings compare
chronologically, so a lexical compare is correct.)

### MODERATE — malformed-shape tests (provider spec)

Added cases: `/latest.json` 200 with `topic_list.topics: [{ foo: 'bar' }]` → `[]`
(no throw); `topic_list` missing entirely → `[]`; plus an explicit newest-first
ordering assertion (`[3, 1, 2]` for new/old/null timestamps).

### Skipped (accepted as-is)

categoryNameCache TTL; frontend error logging.

### Re-verification

- `npx tsc -p apps/ptah-license-server/tsconfig.app.json --noEmit` → exit 0.
- `npx nx test ptah-license-server` → PASS: 38 suites passed / 1 skipped,
  482 tests passed / 5 skipped, exit 0.
- Not committed.

### Additional files changed (review round 2)

- `apps/ptah-license-server/src/discourse/builders-membership.service.ts` (new)
- `apps/ptah-license-server/src/discourse/community.controller.ts` (auth gate + `@Req`)
- `apps/ptah-license-server/src/discourse/community.controller.spec.ts` (new)
- `apps/ptah-license-server/src/discourse/discourse-admin.provider.ts` (newest-first sort)
- `apps/ptah-license-server/src/discourse/discourse-admin.provider.spec.ts` (malformed + ordering cases)
- `apps/ptah-license-server/src/discourse/discourse.module.ts` (register BuildersMembershipService)
