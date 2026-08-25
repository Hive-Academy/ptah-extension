# Code Logic Review - TASK_2026_167

## Review Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall Score       | 4/10             |
| Assessment          | CHANGES_REQUIRED |
| Critical Issues     | 1                |
| Serious Issues      | 1                |
| Moderate Issues     | 3                |
| Minor/Nit Issues    | 3                |
| Failure Modes Found | 5                |

The tolerant-fold-to-`[]` engineering (feature-off, transport errors, non-2xx,
schema drift) is genuinely solid and well tested. But the one thing the task
explicitly asked me to hunt for — a Discourse category privacy leak — is
real: **`GET /api/v1/community/summary` has no Builders-membership gate**,
unlike every sibling authenticated route in this codebase. That's a
production-blocking authorization bug, not a nitpick.

## The 5 Paranoid Questions

### 1. How does this fail silently?

`loadCommunitySummary()`'s error handler in `members-page.component.ts`
swallows every failure with zero logging — a malformed response, a 401, a
CORS failure, all collapse to `topics=[]` with no trace. That's the
_documented_ contract ("never an error state"), so it's not wrong, but it
means a real backend regression (e.g. the Zod schema silently drifting) will
never surface anywhere except "the widget quietly stopped showing topics."

### 2. What user action causes unexpected behavior?

Any authenticated Ptah user — including a free/non-Builders account that
merely logged in via GitHub/Google OAuth and never subscribed — can open
devtools/curl with their `ptah_auth` cookie and call
`GET /api/v1/community/summary` directly. They get real forum data back.
The frontend never surfaces a route for this (it's gated behind the
Builders-only `/members/sessions` 200), but the backend route itself does
not care who's asking, only that _someone_ is authenticated.

### 3. What data makes this produce wrong results?

A Discourse topic in a restricted/staff category with a category name that
collides with an existing cached id (extremely unlikely) would mis-attribute
a category label — low risk. More realistically: any topic whose `category_id`
lives in a _private_ Discourse category (e.g. "Builders Lounge", "Staff") is
mapped and returned exactly like a public one — there is no category-visibility
filtering at all in `mapTopic`/`getLatestTopics`.

### 4. What happens when dependencies fail?

Covered well: transport reject → `[]`, non-2xx → `[]`, malformed top-level
JSON → `[]`, feature-off → `[]` with no network call. `categoriesNameCache`
failure degrades to `categoryName: null` rather than failing the whole
response — good tolerant design, mirrors the existing `groupIdCache` pattern.

### 5. What's missing that the requirements didn't mention?

The context/backend docs never explicitly wrote "Builders-only" into the B1
contract text, but the architecture around it (Community card is inside the
Builders-gated `members/sessions` flow, `MembersController.getSessions` does
a DB-backed `isBuildersMember` check specifically because the JWT alone is
not a trust boundary for paid content) makes clear that "authenticated" was
never meant to mean "any logged-in account, paying or not." That gate is the
implicit requirement this implementation missed.

## Failure Mode Analysis

### Failure Mode 1: Non-Builders authenticated user reads gated forum data

- **Trigger**: Any account with a valid `ptah_auth` cookie (free tier,
  lapsed subscription, admin-created test account, etc.) calls
  `GET /api/v1/community/summary` directly.
- **Symptoms**: 200 response containing real topic titles/slugs/category
  names sourced from Discourse `/latest.json`, fetched using the admin
  `Api-Key`/`Api-Username` (a privileged, system-level Discourse identity
  that — unlike a normal forum member — can typically see every category,
  including ones restricted to the `builders` group or staff).
- **Impact**: Privacy/authorization leak. A non-paying user learns what
  paying Builders are discussing (topic titles, category names, activity)
  without ever being granted Discourse-side access. If Discourse categories
  ever carry more sensitive titles (security disclosures, contract details,
  paid-course content discussion), this leaks them outright.
- **Current Handling**: None at the backend. `CommunityController.getSummary`
  calls `this.discourse.getLatestTopics()` unconditionally for any
  `JwtAuthGuard`-passing request.
- **Recommendation**: Add the same DB-backed Builders check
  `MembersController.isBuildersMember` performs, and either 403 or (more in
  keeping with this endpoint's "never fail, just degrade" philosophy) return
  `{ communityUrl: null, topics: [] }` for non-Builders callers. As defense
  in depth, also consider whether `/latest.json` should be scoped to a
  public-categories-only view (Discourse supports category-scoped latest
  endpoints), so that even a Builders member's fetched topic list can't
  incidentally include an internal/staff-only category the admin key can see
  but no member should.

### Failure Mode 2: Stale category names after a Discourse rename

- **Trigger**: A Discourse admin renames or deletes a category after the
  license-server process has already cached `categoryNameCache`.
- **Symptoms**: The Community card keeps showing the old category name (or
  `null` after a delete, since the id vanishes from `/categories.json` but
  the cache is never invalidated) indefinitely, until the process restarts.
- **Impact**: Low — cosmetic staleness, matches the existing `groupIdCache`
  precedent (this codebase already accepts process-lifetime caching for
  Discourse metadata), but worth naming since it's a _new_ cache introduced
  by this change and category names are edited far more often than group
  names in practice.
- **Current Handling**: `categoryNameCache` is set once on first successful
  fetch and never refreshed (`discourse-admin.provider.ts:242-268`).
- **Recommendation**: Either accept as-is (consistent with existing pattern)
  or add a coarse TTL (e.g. re-resolve every N minutes) if category churn
  turns out to matter in practice.

### Failure Mode 3: Ordering relies on an unenforced upstream assumption

- **Trigger**: Discourse's `/latest.json` default ordering ever changes (a
  different install default, a future Discourse upgrade, or an admin
  changing the "top" vs "latest" default view for the `/latest.json` route).
- **Symptoms**: `getLatestTopics` slices `rawTopics.slice(0, limit)` with no
  local sort — "newest first" is entirely an assumption about Discourse's
  response order, not something this code guarantees.
- **Impact**: Low today (Discourse's `/latest.json` genuinely is
  activity-ordered by default), but the code offers zero protection if that
  assumption breaks, and the "newest first" claim is baked into both the
  shared contract doc and the frontend's `rows()` computed (which also just
  slices without sorting).
- **Current Handling**: None — no explicit sort by `last_posted_at`.
- **Recommendation**: Add a defensive `.sort()` by `last_posted_at` (nulls
  last) before capping to `limit`, in both places, or at minimum in the
  provider so the contract is actually enforced server-side.

### Failure Mode 4: No test proves the auth gate (or its absence)

- **Trigger**: A future refactor of `CommunityController` accidentally
  removes `@UseGuards(JwtAuthGuard)`, or the missing Builders check (Failure
  Mode 1) is never noticed because nothing exercises the controller.
- **Symptoms**: Regression ships silently — there is no
  `community.controller.spec.ts` at all.
- **Impact**: Medium — the review priorities explicitly asked to "confirm an
  anonymous request is rejected"; that can currently only be confirmed by
  reading the decorator, not by running a test.
- **Current Handling**: None — zero controller-level test coverage.
- **Recommendation**: Add a controller spec asserting (a) the guard rejects
  a request with no `ptah_auth` cookie, and (b) once Failure Mode 1 is fixed,
  that a non-Builders authenticated user gets the degraded response.

### Failure Mode 5: Malformed-but-parseable `/latest.json` shape drift is exercised by code but not by tests

- **Trigger**: Discourse returns 200 with valid JSON, but `topic_list.topics`
  contains an item missing `id`/`slug`, or `topic_list` itself is absent
  (schema drift on Discourse's side, e.g. a plugin changing the shape).
- **Symptoms**: `mapTopic` returns `null` for the bad item (dropped
  silently) or `communityTopicsSchema.safeParse` fails and the whole call
  degrades to `[]` — both are correct behavior, per the code — but no test
  in `discourse-admin.provider.spec.ts` exercises either path.
- **Impact**: Low (behavior is correct), but this is exactly the scenario
  the review priorities called out ("malformed `/latest.json` ... must not
  throw") and it's the one shape-drift case the existing suite doesn't
  touch (it covers feature-off, happy path, transport-reject, non-2xx — not
  "200 + garbage shape").
- **Recommendation**: Add one more spec case: `/latest.json` returns 200
  with `topic_list.topics: [{ foo: 'bar' }]` (or `topic_list` missing
  entirely) → asserts `[]`.

## Critical Issues

### Issue 1: `GET /api/v1/community/summary` leaks gated Discourse topics to any authenticated non-Builders account

- **File**: `apps/ptah-license-server/src/discourse/community.controller.ts:32-38`
- **Scenario**: A caller with a valid `ptah_auth` cookie but no active
  Builders subscription/license (e.g. free-tier GitHub/Google OAuth user,
  lapsed subscriber) hits the endpoint directly.
- **Impact**: The response returns real forum topic titles/slugs/category
  names sourced from Discourse `/latest.json`, fetched via the admin
  `Api-Key`/`Api-Username` — a privileged identity whose view of Discourse
  is not scoped to any particular requesting user's membership. This is a
  data-exposure bug: content gated to paying Builders (or to a private
  Discourse category) becomes visible to any Ptah account holder.
- **Evidence**:
  ```ts
  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSummary(): Promise<CommunitySummary> {
    const topics = await this.discourse.getLatestTopics();
    return { communityUrl: this.communityUrl(), topics };
  }
  ```
  Compare with the sibling `MembersController.getSessions` (same module
  family, same "Community" feature), which additionally does:
  ```ts
  const isBuilders = await this.isBuildersMember(user.id);
  if (!isBuilders) {
    throw new ForbiddenException({ reason: 'membership_required' });
  }
  ```
  `CommunityController` has no equivalent check. The frontend only _calls_
  this endpoint after a successful (Builders-only) `/members/sessions` 200,
  but that is a UI convenience, not an authorization boundary — the route is
  directly reachable by anyone with a session cookie.
- **Fix**: Add the same DB-backed Builders-membership check before calling
  `getLatestTopics()` (ideally factored into a small shared helper/guard so
  `MembersController` and `CommunityController` don't duplicate the
  subscription/license query logic). For non-Builders callers, degrade to
  `{ communityUrl: null, topics: [] }` (consistent with this endpoint's
  "never fail loudly" philosophy) rather than a 403, unless product wants
  parity with `/members/sessions`'s explicit `membership_required` signal.
  As defense-in-depth, also consider scoping the underlying `/latest.json`
  fetch away from any Discourse categories that are more restricted than
  "all Builders" (e.g. staff-only), since even a correctly-gated Ptah-side
  check doesn't guarantee the admin key's view is safe to broadcast whole.

## Serious Issues

### Issue 2: Zero test coverage for `CommunityController`

- **File**: `apps/ptah-license-server/src/discourse/` (no
  `community.controller.spec.ts` exists)
- **Scenario**: The review priorities explicitly ask to "confirm an
  anonymous request is rejected" — there is no automated test proving the
  `JwtAuthGuard` is wired, and (directly caused by this gap) nothing caught
  the missing Builders check in Issue 1.
- **Impact**: A future refactor could silently drop the guard or "fix" the
  missing Builders check incorrectly, with no regression signal.
- **Fix**: Add a controller spec: 401 with no cookie, 200 with a valid
  cookie, and (once Issue 1 is fixed) a case asserting non-Builders callers
  get the degraded response.

## Moderate Issues

### Issue 3: `categoryNameCache` never invalidates (process-lifetime staleness)

- **File**: `apps/ptah-license-server/src/discourse/discourse-admin.provider.ts:41-42, 242-268`
- Consistent with the existing `groupIdCache`/`namedGroupIdCache` pattern,
  but new for category data, which churns more often (renames/deletes) than
  group names. A renamed/deleted category will show stale info until the
  process restarts. Acceptable as a conscious tradeoff; flagging for
  awareness, not blocking.

### Issue 4: No enforced sort order for "newest first"

- **File**: `discourse-admin.provider.ts:163-196` (provider) and
  `community-topic-list.component.ts:115-127` (frontend `rows()`)
- Both sides slice to a cap without sorting by `last_posted_at`, trusting
  Discourse's default `/latest.json` ordering. Cheap, worthwhile defensive
  addition given the contract explicitly promises "newest first."

### Issue 5: Malformed-shape (200 + garbage body) path untested

- **File**: `discourse-admin.provider.spec.ts`
- Existing suite covers feature-off, happy path, transport-reject, and
  non-2xx, but not "200 + `topic_list.topics` present with invalid item
  shapes" or "`topic_list` missing entirely" — exactly the scenario the
  review priorities called out for parse-safety. Code handles it correctly;
  test coverage should catch up.

## Data Flow Analysis

```
Discourse /latest.json (admin Api-Key/Api-Username — SYSTEM-level visibility)
        │
        ▼
DiscourseAdminProvider.getLatestTopics()
  - isEnabled() check                              [OK: feature-off -> []]
  - request('GET', '/latest.json')                 [OK: transport/non-2xx -> []]
  - resolveCategoryNames() (cached id->name)        [OK: failure -> null names, not fatal]
  - mapTopic() per raw topic                        [OK: malformed item -> dropped]
  - communityTopicsSchema.safeParse(mapped)         [OK: drift -> []]
        │
        ▼
CommunityController.getSummary()
  - @UseGuards(JwtAuthGuard)                        [GAP: any authenticated user, not
                                                      just Builders — see Critical #1]
  - communityUrl() from DISCOURSE_URL               [same gap: leaked to non-Builders too]
        │
        ▼  HTTP 200 { communityUrl, topics }
MembersApiService.getCommunitySummary()
  - Zod-validated against communitySummaryResponseSchema  [OK: matches backend contract]
        │
        ▼
MembersPageComponent.loadCommunitySummary()
  - only invoked after Builders-gated /members/sessions 200  [UI-only mitigation,
                                                                not a real boundary]
  - error -> topics=[] silently, no logging          [minor: observability gap]
        │
        ▼
CommunityTopicListComponent
  - rows() slices to 5, builds SSO deep-link          [OK: matches spec formula exactly]
  - {{ row.title }} interpolation, no [innerHTML]     [OK: no XSS vector]
  - rel="noopener noreferrer", target="_blank"        [OK]
```

### Gap Points Identified:

1. **Authorization gap between "authenticated" and "Builders"** at
   `CommunityController` — the single most consequential gap in this diff.
2. Category-name staleness (no cache invalidation).
3. No test proving the auth boundary (or its absence).

## Requirements Fulfillment

| Requirement                                                               | Status   | Concern                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1: `suppress_welcome_message=true` in SSO payload                        | COMPLETE | Test asserts it decodes correctly; `avatar_url` correctly omitted with a comment explaining why.                                                                                                                                              |
| B1: `GET /api/v1/community/summary`, authenticated, proxied, non-throwing | PARTIAL  | Authenticated — yes. Non-throwing/tolerant — yes, thoroughly. But "authenticated" was implemented as "any logged-in user" rather than "Builders member," which is the implicit access boundary this feature actually needs (see Critical #1). |
| B1: feature-off → `{ communityUrl: null, topics: [] }`                    | COMPLETE | Verified in provider + spec.                                                                                                                                                                                                                  |
| B1: browser never sees a Discourse key                                    | COMPLETE | Server-side fetch only, via `DiscourseAdminProvider`.                                                                                                                                                                                         |
| Contract match B1↔B2                                                      | COMPLETE | Backend `CommunitySummary`/`communityTopicSchema` and frontend `communitySummaryResponseSchema` are field-for-field identical.                                                                                                                |
| B2: widget on Community card, SSO deep-link per topic                     | COMPLETE | Exact URL formula matches spec: `${communityUrl}/session/sso?return_path=${encodeURIComponent('/t/'+slug+'/'+id)}`.                                                                                                                           |
| B2: hidden when `communityUrl` null; loading/empty/error states           | COMPLETE | Gated correctly off `communitySsoUrl()`; skeleton for loading; empty falls back to existing CTA; error silently collapses to empty (by design, though unlogged).                                                                              |
| B2: OnPush/signals, no `[innerHTML]`, `rel="noopener noreferrer"`         | COMPLETE | Verified in `community-topic-list.component.ts`.                                                                                                                                                                                              |

### Implicit Requirements NOT Addressed:

1. **Builders-only gating on the summary endpoint itself** (not just the
   frontend fetch trigger) — the single biggest miss in this diff.
2. A controller-level test proving the auth/authorization boundary.
3. Any defensive ordering guarantee ("newest first") enforced in code rather
   than assumed from Discourse's default behavior.

## Edge Case Analysis

| Edge Case                                 | Handled                | How                                                                               | Concern                                       |
| ----------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Feature-off (DISCOURSE\_\* unset)         | YES                    | `isEnabled()` short-circuits to `[]`, no network call                             | None                                          |
| `/latest.json` transport reject           | YES                    | `request()` catch → `{ok:false}` → `[]`                                           | None                                          |
| `/latest.json` non-2xx                    | YES                    | `!res.ok` → `[]`                                                                  | None                                          |
| `/latest.json` 200 + garbage shape        | YES (code) / NO (test) | `mapTopic` drops bad items; `safeParse` folds shape drift to `[]`                 | Untested (Issue 5)                            |
| `/categories.json` failure                | YES                    | Falls back to empty map, uncached, so retried next call                           | Category names simply `null` meanwhile — fine |
| Anonymous request to `/community/summary` | YES (by guard)         | `JwtAuthGuard` → 401                                                              | Not test-proven (Issue 2)                     |
| Non-Builders authenticated request        | **NO**                 | No membership check at all                                                        | **Critical #1**                               |
| Topic with `category_id` not in cache     | YES                    | `categories.get(id) ?? null`                                                      | None                                          |
| `lastPostedAt: null`                      | YES                    | `formatRelativeTime(null) → ''`, segment dropped in `buildMeta`                   | None                                          |
| >5 topics from Discourse                  | YES                    | `.slice(0, limit)` server-side + `.slice(0,5)` client-side (defensive double-cap) | None                                          |
| Frontend fetch failure                    | YES                    | `topics=[]`, no error UI                                                          | Silent — no logging (Nit)                     |

## Integration Risk Assessment

| Integration                                                               | Failure Probability                           | Impact                                    | Mitigation                                   |
| ------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| License-server → Discourse admin API (`/latest.json`, `/categories.json`) | LOW-MED (network/outage)                      | LOW (folds to `[]`, never 500)            | Already tolerant — good                      |
| Ptah auth (`ptah_auth` JWT) → Community summary authorization             | **HIGH** (already broken, not a hypothetical) | **HIGH** (private/gated content exposure) | **MISSING** — no Builders check              |
| Frontend `MembersApiService` ↔ backend contract                           | LOW                                           | LOW                                       | Zod on both sides, verified identical shapes |
| Frontend gating (`communitySsoUrl()` truthy ⇒ `communityUrl()!` safe)     | LOW                                           | LOW                                       | Correctly tied to the same signal, verified  |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: `GET /api/v1/community/summary` returns real Discourse topic
data (sourced via a privileged admin API key) to any authenticated Ptah
account, not just paying Builders — the one authorization boundary every
sibling endpoint in this module enforces. This must be fixed before this
ships; everything else in the diff (tolerant error folding, contract
matching, frontend rendering/XSS hygiene, SSO polish) is solid.

## What Robust Implementation Would Include

- A DB-backed Builders-membership check on `CommunityController.getSummary`
  identical in spirit to `MembersController.isBuildersMember`, ideally
  extracted into a shared helper/guard to avoid drift between the two.
- A controller-level spec asserting both the 401 (no cookie) and the
  non-Builders-degrades-to-empty behavior.
- Explicit sort-by-`last_posted_at` before capping to `limit`, so "newest
  first" is a guarantee, not an assumption about Discourse's default view.
- A time-bounded (or invalidatable) `categoryNameCache`, since category
  renames are more common in practice than group renames.
- At minimum a `console.warn`/telemetry breadcrumb in the frontend's
  `loadCommunitySummary` error handler, so a real regression (vs. a benign
  feature-off) is distinguishable in production logs.
