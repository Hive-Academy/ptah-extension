# Implementation Report — Frontend (F1, F2, F3a–F3d, F5)

**Task:** TASK_2026_169 — Admin-dashboard management of Builders member content
**Agent:** frontend-developer
**Date:** 2026-08-01
**Branch:** `ak/elevate-video-and-tasks`
**Status:** ✅ All assigned batches complete. Lint / test / prod build all green, no budget warning.
**Committed:** No — changes left in the working tree for review, as instructed.

---

## 1. Summary

All six assigned frontend batches are implemented against the §2.3 endpoint contract. The backend
was still in flight while this work was done (only `prisma/schema.prisma` was modified in the tree at
start; `src/packs/` did not yet exist), so nothing here has been exercised against a live API — that
is expected and called out in §7. No component contains stubbed or mock data: every view fetches from
the real client and renders loading / empty / error states honestly.

Three checks the task singled out, all confirmed:

| Check                                             | Result                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| New admin routes precede the `':model'` catch-all | ✅ `builders*` at lines 138–160, `':model'` at line 162                |
| Zero files touched on the member path             | ✅ `git status` over all 7 protected paths prints nothing              |
| No budget warning on the production build         | ✅ 0 budget lines in output; initial total **970.83 kB** vs. 1 mb warn |

---

## 2. Files created (14, all absolute)

**API client (F1)**

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\validate-response.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\admin-builders-api.service.ts`

**Packs UI (F3a)**

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\packs-list.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\packs-list.html`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\pack-form-modal\pack-form-modal.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\pack-form-modal\pack-form-modal.html`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\delete-pack-modal\delete-pack-modal.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\delete-pack-modal\delete-pack-modal.html`

**Sessions UI (F3b)**

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\sessions-list.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\sessions-list.html`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\components\session-form-modal\session-form-modal.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\components\session-form-modal\session-form-modal.html`

**Community UI (F3c)**

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\community\community-view.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\community\community-view.html`

## 3. Files modified (5 — exactly the plan's §10 MODIFY list)

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\admin-api.service.ts`
  — deleted the local `validate()` (10 lines), added one import. No other change.
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\admin.routes.ts`
  — 4 route entries + a docblock line.
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\admin-layout\admin-nav.config.ts`
  — `Builders Content` nav group + 3 lucide imports.
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\groups\groups-list\groups-list.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\groups\groups-list\groups-list.html`

Full working tree, frontend only:

```
 M apps/ptah-landing-page/src/app/pages/admin/admin-layout/admin-nav.config.ts
 M apps/ptah-landing-page/src/app/pages/admin/admin.routes.ts
 M apps/ptah-landing-page/src/app/pages/admin/groups/groups-list/groups-list.html
 M apps/ptah-landing-page/src/app/pages/admin/groups/groups-list/groups-list.ts
 M apps/ptah-landing-page/src/app/services/admin-api.service.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/
?? apps/ptah-landing-page/src/app/services/admin-builders-api.service.ts
?? apps/ptah-landing-page/src/app/services/validate-response.ts
```

---

## 4. Verification — actual output

### 4.1 `nx lint ptah-landing-page`

```
✖ 49 problems (0 errors, 49 warnings)

 NX   Successfully ran target lint for project ptah-landing-page
```

All 49 warnings are the pre-existing `@typescript-eslint/explicit-member-accessibility` advisories on
files this task did not touch (landing/legal/pricing/hero sections, `github-release.service.ts`,
`seo.service.ts`). Re-ran the lint filtered to my own paths — **not one of the 14 new files or 5
modified files appears in the output.** Zero errors.

### 4.2 `nx test ptah-landing-page`

```
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        2.311 s
Ran all test suites.

 NX   Successfully ran target test for project ptah-landing-page
```

That single suite is pre-existing. **I added no frontend specs** — see §6.4 for why, and treat it as a
known gap rather than an oversight.

### 4.3 `nx build ptah-landing-page --configuration=production` — budget check

```
Initial chunk files   | Names      |  Raw size | Estimated transfer size
chunk-Z652ZMGV.js     | -          | 232.67 kB |                68.18 kB
main-23N4RL7V.js      | main       | 188.15 kB |                51.82 kB
styles-RKN6YGAW.css   | styles     | 164.34 kB |                19.47 kB
chunk-M4F4D24K.js     | -          | 123.48 kB |                42.65 kB
...
                      | Initial total | 970.83 kB |              255.06 kB

Lazy chunk files      | Names        |  Raw size | Estimated transfer size
chunk-S5NCOLKD.js     | groups-list  |  23.81 kB |                 5.70 kB
chunk-7BJJIZMT.js     | packs-list   |  23.37 kB |                 5.75 kB
chunk-JXRD7TYF.js     | sessions-list|  16.72 kB |                 4.80 kB
...
Prerendered 6 static routes.
Application bundle generation complete. [10.392 seconds]

 NX   Successfully ran target build for project ptah-landing-page and 1 task it depends on
```

**No budget warning.** Grepping the whole build output for `budget|exceeded|warning` returns **0**
matches. Initial total 970.83 kB, against the 1 mb warn / 2 mb error initial budget.

Because "970.83 kB" is uncomfortably close to the 1 mb line, I did not rely on the absence of a
warning alone — I proved the new code is not in the initial bundle at all, by grepping the emitted
initial chunks for strings unique to this work:

```
=== Does any INITIAL chunk contain new-code markers? ===
(no HIT lines — searched main-*.js and all 8 initial chunk-*.js for
 "Not tied to a cohort", "admin/builders/packs", "Builders Content")

=== Which lazy chunks DO contain them? ===
chunk-7BJJIZMT.js   (packs-list)
chunk-MH3SAQ6I.js   (admin-layout — nav config)

=== community-view chunk present? ===
chunk-LKQWIL4A.js   ("Open in Discourse")
```

Every new byte lands in a lazy chunk under the already-lazy `/admin` subtree. **Initial-bundle impact
is zero**, as §6.5 predicted. The 970.83 kB figure is the pre-existing baseline, unmoved by this task.

### 4.4 Member-path invariant — mechanical proof

```
$ git status --porcelain -- \
    apps/ptah-landing-page/src/app/pages/members/members-page.component.ts \
    apps/ptah-landing-page/src/app/services/members-api.service.ts \
    apps/ptah-license-server/src/discourse/builders-membership.service.ts \
    apps/ptah-license-server/src/discourse/community.controller.ts \
    apps/ptah-license-server/src/google-sessions/members.controller.ts \
    scripts/community-gate-smoke.mjs scripts/discourse-e2e.mjs
(no output)
```

**Nothing.** Confirmed additionally:

- `artifactPlaceholders` is still present in `members-page.component.ts` (2 occurrences, untouched).
- F4 was not implemented. There is no member-facing packs surface anywhere in this diff.
- `admin-builders-api.service.ts` does **not** import from `members-api.service.ts`. The
  `AdminSession` and `AdminCommunityTopic` schemas are declared locally even though they mirror the
  member shapes — deliberately, so the admin chunk carries no member-path code and the "zero member
  files" claim needs no asterisk about transitive imports.

### 4.5 Route-ordering landmine — confirmed

```
$ grep -n "path: 'builders\|path: ':model'" admin.routes.ts
138:        path: 'builders',
143:        path: 'builders/packs',
148:        path: 'builders/sessions',
155:        path: 'builders/community',
162:        path: ':model',
```

All four `builders*` entries precede `':model'` (162) and `':model/:id'`. A comment above the block
restates _why_, in the same idiom the file already uses at lines 64–66: `builders` is not an
`AdminModelKey`, so a mis-ordered entry resolves to `AdminList` and the API answers
400 "Unknown admin model: builders".

---

## 5. What was built

### F1 — API client

`validate()` moved verbatim into `services/validate-response.ts` and imported by both
`admin-api.service.ts` and the new `admin-builders-api.service.ts`. Net change to the former: −10
lines, +1 import.

`admin-builders-api.service.ts` — 12 methods, all `Observable<T>`, all relative URLs, all Zod-validated
at the boundary with types via `z.infer`, exactly the §6.3 list:
`listPacks`, `getPack`, `createPack`, `updatePack`, `deletePack`, `listSessions`, `createSession`,
`updateSession`, `deleteSession`, `listCommunityTopics`, `getReviewQueue`, `listGroupMembers`.
**No community write method exists** — there is no endpoint to call.

Also exports `PACK_REPO_URL_REGEX` and `PACK_SLUG_REGEX` as client-side mirrors of the server DTO
constraints (see §6.1 for a caveat on the latter).

### F2 — Routes + nav

Four lazy `loadComponent` routes (`builders` → redirect, `builders/packs`, `builders/sessions`,
`builders/community`) plus a `Builders Content` nav group between Operations and People & Community,
using `Package` / `CalendarDays` / `MessagesSquare`. All three icon names verified to exist in the
installed `lucide-angular` before use.

Member Groups stays under People & Community, per §6.2.

### F3a — Packs UI (the L12 copy)

The copy is the mitigation, so it is worth quoting what actually shipped.

`PacksList` header subtitle:

> A record of which GitHub repository was shared with which cohort. Access is granted on GitHub —
> inviting collaborators, adding a team, or posting the repo link in that cohort's Discourse group.
> **Nothing on this page grants or revokes access.**

Cohort column: labelled packs render an `info` `StatusBadge` with the cohort name; unlabelled packs
render a `ghost` badge reading **"No cohort"** — never a blank cell, because blank reads as missing
data and invites an operator to "fix" it.

`PackFormModal` cohort select: first option is **"Not tied to a cohort"** (not "All Builders", not
anything suggesting a visibility scope), label reads `Cohort — label only`, helper text reads
_"Label only — sharing is done on GitHub. Changing this grants and revokes nothing."_

`DeletePackModal` uses typed-slug confirmation (mirroring `delete-user-modal`) and states plainly that
the repository and everyone's access to it are unaffected — only Ptah's record is lost. That framing
matters: without it, a delete dialog implies revocation.

### F3b — Sessions UI

`calendarWritable: false` hides every mutation control rather than disabling it (no dead buttons) and
shows an `alert alert-warning` naming the actual remedy (re-run Google OAuth consent with the calendar
scope, replace the refresh token). Reading is unaffected.

Recurring-master rows carry an `info` "series" badge, an explanatory sub-line, and **both** Edit and
Delete disabled with a `title` explaining that member provisioning depends on the series. `SessionFormModal`
additionally maps the server's typed `reason` codes (`protected_recurring_event`,
`calendar_write_unavailable`) to operator-readable copy instead of surfacing a raw body.

### F3c — Community UI

Read-only, and visibly so: a `read-only` badge in the header, a `ro` badge on the nav item (the
existing `admin-layout.html` renders `item.readOnly` for primary items too), and a subtitle stating
that moderating, replying, and acting on flags all happen in Discourse.

**There are no moderation controls of any kind** — no toggles, no confirmation modals, no status
mutations. Contents: a `StatTile` for the pending review count, an item list, a "Review in Discourse →"
link, and a topic table where every row deep-links to `{communityUrl}/t/{slug}/{id}`. Distinct
`EmptyState` copy for "Discourse is not configured" (`enabled: false`) vs. "no recent topics", so the
two degradation modes the server distinguishes are legible to the operator.

Named `CommunityView`, per §6.4.

### F3d — Groups drill-down

`DetailDrawer` members panel on the existing `GroupsList`, opened by a new per-row "Members" action:
paginated roster (25/page), email search, per-row Remove via the existing
`AdminApiService.unassignGroupMember()`. Removal refreshes both the drawer and the table behind it so
the group's `memberCount` stays truthful, and steps back a page when the last row of a non-first page
goes. The stale docblock at `groups-list.ts:25-28` (which flagged this exact gap for the server owner)
is rewritten to record that it is now closed.

---

## 6. Deviations, judgment calls, and things to check

### 6.1 ⚠️ `PACK_SLUG_REGEX` is an assumption — backend should confirm

The plan specifies the `repoUrl` regex precisely (§7.4 L4) but says nothing about the slug beyond
_"stable lowercase slug, e.g. `saas-starter`"_. `packs/dto/pack.dto.ts` did not exist while I worked,
so I mirrored the house style from `MEMBER_GROUP_KEY_REGEX` and used `/^[a-z0-9-]{2,64}$/`.

**Risk:** if the backend DTO is laxer (e.g. allows underscores, or a longer max), the form will refuse
a slug the server would have accepted. This is a client-side UX gate only — no security consequence —
but it should be reconciled against the real DTO. `PACK_REPO_URL_REGEX` is a faithful copy of the
regex written out in §7.4 and needs no reconciliation.

### 6.2 ⚠️ Contract gap: `AdminSession` carries no `description`

Genuine mismatch in the frozen table, implemented as specified and flagged rather than worked around:
`UpdateSessionDto` accepts `description` (§6.4 lists it as a form field), but the `adminSessionSchema`
response in §6.3 has no `description` — it is `{ id, title, startsAt, endsAt, meetLink, recurring }`.

So **edit mode cannot prefill the description**: the list response does not carry it. Rather than
silently wiping the calendar event's existing description on every edit, `SessionFormModal` starts the
field blank in edit mode, only sends `description` when the admin actually types something, and says so
in helper text (_"Leave blank to keep the description already on the calendar event."_).

This is correct and safe as built. If the intent was for editing to round-trip the description, the
backend needs to add `description` to the session response shape — a contract change I deliberately
did not make unilaterally.

### 6.3 Smaller judgment calls

1. **No `DeleteSessionModal`.** §6.4 lists only `SessionsList` and `SessionFormModal` for sessions, so
   rather than invent a seventh component I used an inline two-step confirm on the row (Delete →
   Confirm / Cancel). Packs keep the full typed-slug modal, which the plan does specify.
2. **Packs cohort filter is derived from loaded rows**, not a second `AdminApiService.listGroups()`
   call. A cohort with no packs is not offered, since selecting it could only ever yield an empty
   table. This keeps the plan's _"only new cross-service coupling"_ confined to `PackFormModal`, where
   §6.4 puts it. `PackFormModal` fetches the full group list lazily on first open, caches it in a
   signal, does not refetch per keystroke, and degrades to a warning (still saveable, cohort omitted)
   if `/admin/groups` fails.
3. **Search applies on submit, not per keystroke** (packs list, group members). No debounce timers,
   no per-character requests.
4. **`createMeetLink` is create-only.** Google mints the conference on insert with
   `conferenceDataVersion=1`; the patch path in §4.1 does not add one to an event that shipped without
   it, so showing the checkbox on edit would be a control that silently does nothing.
5. **Community nav item marked `readOnly: true`** — one line beyond the §6.2 snippet. It renders the
   existing muted `ro` badge, surfacing Decision 1 in the nav itself.
6. **`StatTile` `[link]` was not used for the review queue.** That input is a `routerLink` and cannot
   take an external Discourse URL, so the deep link is a plain external anchor beside the tile.
7. **`DataTable` and `SelectionToolbar` were not used**, per §6.4. All three new lists are hand-rolled
   `<table class="table">` mirroring `groups-list.html`.

### 6.4 Not done

- **No frontend unit specs were added.** §8.1/§8.2 list backend specs only; §8.6 defines frontend
  verification as lint + test + prod build, which is what I ran. Flagging it explicitly so the absence
  reads as scope, not omission: none of the six new components has a spec, and the pre-existing suite
  (8 tests) does not cover them.
- **Nothing was exercised against a live API.** The backend was mid-flight. Every request shape is
  built to the §2.3 table; none has been observed round-tripping. The V4 manual pass in §8.6 is the
  first real exercise of this code and should be treated as load-bearing, not a formality.
- **No git operations.** All changes left in the working tree.

---

## 7. Standards compliance

- Angular 21 standalone; `ChangeDetectionStrategy.OnPush` on **all six** new components (verified by
  inspection of each `@Component`); signals + `computed()` + `inject()` throughout; no constructor
  injection; no zone-dependent patterns.
- **No `[innerHTML]` anywhere** in the new templates. `repoUrl` and Discourse links render as
  `<a [href] target="_blank" rel="noopener noreferrer">`, with the server-side GitHub-URL regex as the
  real boundary (L4) and Angular's sanitizer as the second layer. `notes` is plain interpolation.
- Zod at every HTTP boundary via the shared `validate()`; every exported response type is `z.infer`.
- Relative URLs only — `apiInterceptor` supplies base + credentials. No `environment.apiBaseUrl` reads.
- Every new route is `loadComponent`-lazy; verified empirically in §4.3.
- daisyui `operator` theme + Tailwind utility classes only; no new npm dependencies.
- Shared components reused as directed: `EmptyState` (packs, sessions, community), `StatusBadge`
  (cohort chip, series chip), `DetailDrawer` (group members), `StatTile` (review queue).

---

## Follow-up: description prefill

**Date:** 2026-08-01 (post-backend-landing)
**Trigger:** Coordinator message — backend landed and resolved both contract items from §6.1/§6.2.
**Status:** ✅ Done. Lint / test / prod build re-run and green, still no budget warning.

### Contract items — both closed

**Item 1 — `PACK_SLUG_REGEX`: no action needed.** Verified in the landed backend at
`apps/ptah-license-server/src/packs/dto/pack.dto.ts:12`:

```ts
/** Lowercase slug: 2–64 chars of [a-z0-9-]. Matches the frontend PACK_SLUG_REGEX. */
const PACK_SLUG_REGEX = /^[a-z0-9-]{2,64}$/;
```

Byte-identical to the client mirror. The §6.1 assumption is now a confirmed contract on both sides,
with the backend's own comment pointing back at the frontend constant. No change made.

**Item 2 — `description` on admin session responses: implemented.** Verified in
`google-sessions.types.ts:50-52`:

```ts
export interface AdminSession extends BuildersSession {
  description: string | null;
}
```

The member `BuildersSession` is untouched — `description` exists only on the admin extension. I kept
that separation intact on the frontend (see "Guardrails re-verified" below).

### Changes made (2 files)

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\admin-builders-api.service.ts`
  — added `description: z.string().nullable()` to `adminSessionSchema`; rewrote the schema docblock to
  record _why_ the field is admin-only (the backend deliberately did not widen `BuildersSession`,
  because that is the member contract).
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\components\session-form-modal\session-form-modal.{ts,html}`
  — edit mode prefills `description` from the loaded session (`this.description.set(s?.description ?? '')`);
  removed the now-false _"Leave blank to keep the description already on the calendar event."_ helper text.

No other file touched. `sessions-list.{ts,html}` needed no change — it never rendered the field.

### ⚠️ One deliberate deviation from the instructions — please confirm

Instruction 4 said _"Keep sending `description` in the update payload as you already do."_ **I changed
it**, from a conditional spread to unconditional, and want that visible rather than buried:

```ts
// before — omitted the field entirely when the box was empty
...(description.length > 0 ? { description } : {}),

// after
description,
```

**Why.** The conditional spread existed for exactly one reason: without prefill, a blank box meant
_"the admin never saw the description"_, so sending `''` would have silently wiped a description the
UI had never shown. Prefill removes that premise. A blank box now unambiguously means _"the admin
cleared it"_ — and under the old code that edit would silently no-op, with the old text reappearing on
next open. That is a small correctness bug created by keeping a workaround past its justification.

**Verified safe before changing it**, rather than assumed:

- `UpdateSessionDto.description` is `@IsOptional() @IsString() @MaxLength(5000)` with **no
  `@MinLength`** (`dto/admin-session.dto.ts:72-75`), so `''` passes validation.
- `GoogleCalendarProvider.toGoogleEventBody` gates on `if (input.description !== undefined)`
  (`google-calendar.provider.ts:203-205`), so `''` is forwarded to Google (clears the description)
  while `undefined` omits the key. The two cases are genuinely distinguished end to end.

Net effect: editing now round-trips the description faithfully **and** clearing one works. If you
prefer the literal instruction, reverting is a one-line change — but it reintroduces the
"cannot clear a description" behaviour.

**One further small alignment, also unrequested:** the description textarea's `maxlength` was `1000`
against the DTO's `@MaxLength(5000)`. I raised the client to `5000` to match, so the form no longer
refuses input the server would accept.

### Guardrails re-verified

```
$ git status --porcelain -- <all 7 protected member-path files>
(no output)

$ grep -n "description" apps/ptah-landing-page/src/app/services/members-api.service.ts
none — clean
```

- **No member-path file is on the diff.** `members-page.component.ts` and `members-api.service.ts`
  remain untouched by this task, front and back.
- **`description` was not added to any member-facing type.** `buildersSessionSchema` in
  `members-api.service.ts` has no `description` and was not opened. The admin/member split the backend
  made is mirrored exactly on the frontend.

### Re-verification output

**`nx lint ptah-landing-page`**

```
✖ 49 problems (0 errors, 49 warnings)

 NX   Successfully ran target lint for project ptah-landing-page
```

Unchanged from the first run — same 49 pre-existing accessibility-modifier warnings on files this task
does not touch. Zero errors, none of them in new or modified files.

**`nx test ptah-landing-page`**

```
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total

 NX   Successfully ran target test for project ptah-landing-page
```

**`nx build ptah-landing-page --configuration=production`**

```
                      | Initial total | 970.83 kB |              255.07 kB

Lazy chunk files      | Names         |  Raw size | Estimated transfer size
chunk-B3FO3XWP.js     | packs-list    |  23.37 kB |                 5.74 kB
chunk-F55K2IWW.js     | sessions-list |  16.48 kB |                 4.72 kB

Application bundle generation complete. [14.382 seconds]
```

**No budget warning** — grepping the full output for `budget|exceeded|warning` returns **0** matches.

Initial total is **970.83 kB, identical to the pre-follow-up figure** (transfer size moved 255.06 →
255.07 kB, i.e. ~10 bytes of gzip noise). The `sessions-list` lazy chunk actually _shrank_
16.72 → 16.48 kB, since deleting the helper-text block outweighed the added schema field. Initial-bundle
impact remains zero.
