# Test Report — TASK_2026_169

**Follow-up to `code-logic-review.md` MINOR-2**: none of the six Angular components shipped in this
task had unit specs. This report closes that gap.

## Scope

Six new components under `apps/ptah-landing-page/src/app/pages/admin/builders/`, none of which had
any coverage before this pass. The pre-existing suite (`marketing-metrics.spec.ts`, 8 tests, a pure
function spec with no `TestBed`) established no component-testing convention for this app, so the
convention used here — `TestBed` + standalone component imports + signal inputs set via
`fixture.componentRef.setInput()` + plain-object service mocks returning `of(...)`/`throwError(...)`
— was taken from the closest precedent in the monorepo:
`libs/frontend/marketplace/src/lib/oauth-surface.component.spec.ts` (same pattern: `jest.fn()` mocks,
DOM assertions via `fixture.nativeElement`, output assertions via `.subscribe()`).

## Spec files created (6, all absolute)

1. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\packs-list.spec.ts` (5 tests)
2. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\pack-form-modal\pack-form-modal.spec.ts` (9 tests)
3. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\packs\components\delete-pack-modal\delete-pack-modal.spec.ts` (6 tests)
4. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\sessions-list.spec.ts` (7 tests)
5. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\sessions\components\session-form-modal\session-form-modal.spec.ts` (10 tests)
6. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\admin\builders\community\community-view.spec.ts` (7 tests)

Total: 44 new tests, plus the 8 pre-existing = 52 tests / 7 suites, all green.

No component source was modified. No file under `pages/members/` or `services/members-api.service.ts`
was touched or read for this task.

## What each spec covers, and why each test can fail for a real reason

### 1. `packs-list.spec.ts`

- **Cohort filter derivation**: seeds three packs (two sharing a cohort, one unlabelled) and asserts
  the `<select>` offers exactly `["All cohorts", "Founders"]` — proves the dedup-by-key and
  offer-only-cohorts-with-a-pack logic in `cohortOptions()`. Fails if dedup breaks or an unlabelled
  pack leaks a ghost option.
- **Search-on-submit, not per-keystroke**: types into the search box, asserts `listPacks()` is _not_
  called; submits the form, asserts it _is_, with the trimmed term. Fails if someone wires `(input)`
  straight to `fetch()`.
- **L12 — the cohort column is a label, not a permission** (three tests): an unlabelled pack renders
  the literal text "No cohort" (never a blank cell); a labelled pack renders its cohort name and _not_
  "No cohort"; the header subtitle contains the exact sentence "Nothing on this page grants or revokes
  access." All three fail if that copy — the entire mitigation for review risk L12 — is edited away or
  the blank-cell fallback regresses.

### 2. `pack-form-modal.spec.ts` — highest value, per the review

- **`slugValid`/`canSubmit` branching** (4 tests): create mode blocks submit on an invalid slug and
  unblocks on a valid one (via real keystrokes through the rendered `<input>`, not by touching
  `component['slugValid']`); edit mode proves `slugValid()` short-circuits true via `isEdit()` — the
  prefilled, disabled slug field never needs to be re-validated — by asserting the submit button is
  already enabled immediately after opening in edit mode; an invalid GitHub repo URL blocks submit in
  both modes; a blank description blocks submit. These are exactly the "genuine branching logic" the
  review named as the reason to write specs at all.
- **Cohort-select fetch/cache/degrade** (2 tests): `AdminApiService.listGroups()` is called exactly
  once across a close→reopen cycle (proves the `groupsRequested` cache signal actually caches); on a
  `listGroups()` failure the modal shows "Could not load cohorts…", stays fully submittable without a
  cohort, and resets the cache so the _next_ open retries (`listGroups` called a second time) — proves
  the "degrades to a warning" behaviour named in the task brief is real, not aspirational.
- **L12 wording + payload** (2 tests): the cohort select's first `<option>` has `value=""` and text
  exactly `"Not tied to a cohort"` — never "All Builders" or anything implying a visibility scope, which
  is the literal wording the review and the task brief both call out as load-bearing; and submitting
  with that option selected sends `cohortKey: null` to `createPack()`, while selecting a real cohort
  sends its key. This locks both the copy _and_ the payload it produces.
- **Submit routing**: `pack = null` calls `createPack()` and never `updatePack()`; a set `pack` input
  calls `updatePack(id, …)` and never `createPack()`.

### 3. `delete-pack-modal.spec.ts`

- Typed-slug confirmation: submit stays disabled on a partial match, enables on an exact match, and
  tolerates surrounding whitespace (the component trims before comparing).
- Reopening for a **different** pack resets the typed text and re-disables submit — this is the one
  place a stale confirmation could accidentally authorize deleting the wrong row if the reset ever
  broke.
- Success path calls `deletePack(id)` and emits `deleted`; failure path shows the server's message and
  does **not** emit `deleted`.
- L12: asserts the exact "GitHub repository and everyone's access to it are unaffected" sentence
  renders, so a delete action can never be read as a revocation.

### 4. `sessions-list.spec.ts`

- **`calendarWritable` degradation is hidden, not disabled** (2 tests): with the flag false, there is
  no "New Session" button node anywhere in the DOM and no `<button>` at all in a row's action cell
  (just the text "read-only") — proves the review's "hidden, not disabled — no dead buttons" claim by
  asserting absence, which a `[disabled]`-only regression would not fail. With the flag true, both the
  trigger and the per-row Edit/Delete buttons exist.
- **Recurring-row disabling** (2 tests): a recurring row's Edit and Delete are `disabled` even when
  `calendarWritable` is true (the two conditions are independent in the template — this test would
  catch someone collapsing them into one flag); a non-recurring row's Edit stays enabled, so the
  disabling isn't accidentally blanket-applied to every row.
- Window-select change refetches with the new `daysAhead`.
- Delete requires the inline "Confirm" click (clicking "Delete" alone never calls the API); "Cancel"
  aborts without calling it; a successful confirm calls `deleteSession(id)` and triggers exactly one
  refetch (asserted via call count, not existence).

### 5. `session-form-modal.spec.ts` — highest value, per the review

- **`rangeValid`/`canSubmit` branching** (3 tests): submit is blocked with no range, blocked with
  end-before-start, unblocked once end is strictly after start; end **equal to** start is explicitly
  rejected (the code uses `end > start`, not `>=`, and this test would catch a flip to `>=`); the
  "end time must be after start" error text is suppressed while the fields are still empty and appears
  only once both are touched and invalid — locks `rangeTouched()`'s reason for existing.
- **The unconditional-description-send decision** (3 tests) — this is the specific behaviour flagged
  as worth locking: prefill from the loaded session is asserted directly (`textarea.value`); then, the
  load-bearing test — blanking a prefilled description and submitting sends `description: ''` to
  `updateSession`, not an omitted key. A conditional `...(description.length > 0 ? { description } :
{})` (the pattern this code deliberately moved away from) would make this test fail, because the
  field would be missing from the call entirely rather than present with the empty string. A third test
  confirms a non-empty edited description is sent the same unconditional way, so the fix isn't "always
  omit" in disguise.
- **Server `reason`-code mapping** (3 tests): `protected_recurring_event` and
  `calendar_write_unavailable` each render their specific operator-readable sentence instead of a raw
  body; an unmapped reason falls back to the server's own `message` — proves the mapping degrades
  safely instead of swallowing unrecognized reasons.
- **Create-only meet-link control**: the "Create a Meet link" toggle exists in create mode and is
  absent in edit mode, per the deliberate design note in the component's docblock.

### 6. `community-view.spec.ts`

- **The two distinct empty states**: `enabled: false` renders "Discourse is not configured on this
  server." and never "No recent topics."; `enabled: true` with zero topics renders "No recent topics."
  and never the disabled message. These are two different `computed()` signals
  (`showDisabled`/`showEmptyTopics`) gated on the same `topicsLoaded()` flag — a broken guard could
  easily show both or neither, and each test only passes if exactly the right one fires.
- **Discourse deep links**: a topic with a `communityUrl` gets an anchor with
  `href="{base}/t/{slug}/{id}"` (trailing-slash-stripped base, verified with a URL that has one); with
  no `communityUrl`, the same topic renders as plain text with no anchor at all — never a dead link.
- **Review queue tone**: a non-empty queue shows the "needs a human" tone, the item list, and the
  "Review in Discourse" link; an empty queue shows the calm "nothing waiting" copy — no false alarms.
- **No moderation controls anywhere**: with a topic loaded and no errors, the rendered view contains
  zero `<button>` elements — this is a direct, mechanical check of the review's "there are no
  moderation controls of any kind" claim (the only `<button>`s this template can ever produce are
  per-panel retry buttons on a load error, which don't fire on the happy path exercised here).

## Real verification output

### `npx nx test ptah-landing-page --skip-nx-cache`

```
Test Suites: 7 passed, 7 total
Tests:       52 passed, 52 total
Snapshots:   0 total
Time:        4.589 s
Ran all test suites.

 NX   Successfully ran target test for project ptah-landing-page
```

Re-ran a second time (uncached) to rule out order-dependent flakiness: identical result, 52/52.

### `npx nx lint ptah-landing-page --skip-nx-cache`

```
✖ 49 problems (0 errors, 49 warnings)

 NX   Successfully ran target lint for project ptah-landing-page
```

Identical to the pre-existing baseline recorded in `implementation-report-frontend.md` §4.1 (49
warnings, 0 errors, all on files this task didn't touch). None of the 6 new spec files appear in the
warning list.

## A bug the specs surfaced during authoring — already fixed, not weakened

While writing `delete-pack-modal.spec.ts`'s error-path test, the first version of the test asserted
`fixture.nativeElement.textContent` immediately after `dispatchEvent(new Event('submit'))`, without a
follow-up `fixture.detectChanges()`. That is a test-authoring bug, not a component bug: the assertion
failed because Angular hadn't re-rendered the DOM with the newly-set `errorMessage()` signal yet, not
because `DeletePackModal` failed to set it. I confirmed this by inspecting the failure output — the
modal's static chrome rendered correctly, only the conditional error banner was stale — then added the
missing `fixture.detectChanges()` call, at which point the assertion passed. No component code was
touched to make this go green; the fix was entirely in the test. Recording it because it's exactly the
kind of test-vs-implementation ambiguity the task asked me to be transparent about, even though it
resolved in the test's favor.

No other failures occurred at any point — every other spec passed on first run. No bug in the six
shipped components was found.

## What I chose not to cover, and why

- **`admin_nav.config.ts`, `admin.routes.ts` route wiring** — already mechanically verified in
  `implementation-report-frontend.md` §4.5 (route-ordering grep) and not part of the six components
  this task named.
- **`AdminBuildersApiService` itself** (the HTTP client / Zod schemas) — not one of the six named
  components; it's a thin, declarative Zod-validated wrapper with no branching logic of its own, and
  every method is already exercised indirectly by all six component specs above via its mocked
  interface. A dedicated spec would mostly restate the Zod schema definitions.
- **`PacksList`/`SessionsList` loading-skeleton and generic-error-banner rendering** — real behaviour,
  but framework-level conditional rendering with no business logic; the review's five-questions
  analysis didn't flag either surface, and the task explicitly warned against specs that "only restate
  the implementation."
- **`parsedTags()` comma-splitting/dedup in `PackFormModal`** — genuine small logic, but low-risk
  (cosmetic — a duplicate or empty tag has no correctness consequence, unlike the cohort/slug/repoUrl
  fields which gate whether the form can submit at all) and not named by the review. Left uncovered to
  keep the suite focused on the branches that can actually break something if they regress.
- **`GroupsList`/`DetailDrawer` cohort-members drill-down (F3d)** — not one of the six components named
  in scope for this task; it shipped earlier and isn't part of what MINOR-2 flagged.
- **Full E2E through a real `HttpClient`** — out of scope per the task's explicit instruction to mock
  `AdminBuildersApiService`/`AdminApiService` and never hit a real HTTP client.

## Standards followed

- `TestBed` + standalone component `imports: [Component]` (no `NO_ERRORS_SCHEMA`) — `test-setup.ts`
  runs with `errorOnUnknownElements: true` / `errorOnUnknownProperties: true`, so every nested
  component (`EmptyState`, `StatusBadge`, `StatTile`, `PackFormModal`, `DeletePackModal`,
  `SessionFormModal`) had to resolve for real, which is itself a passive check that the six components'
  own standalone `imports` arrays are correct.
- Signal inputs set via `fixture.componentRef.setInput(...)`, never by reaching into private fields.
- Services mocked as plain `{ methodName: jest.fn() }` objects returning `of(...)` / `throwError(...)`
  — never a real `HttpClient`/`HttpClientTestingModule`.
- Assertions go through the rendered template (`fixture.nativeElement`, button `.disabled`, dispatched
  `input`/`change`/`submit`/`click` events) rather than calling `protected`/private component methods
  or reading `protected` computed signals directly — the one exception is asserting mock call
  arguments (`toHaveBeenCalledWith(...)`), which is observing the service boundary, not internals.
- Effects (`effect(() => {...})` in the two form modals' constructors) were empirically confirmed to
  flush synchronously within a single `fixture.detectChanges()` call in this Angular 21 / zone.js
  TestBed setup — verified with a throwaway smoke test before writing the real specs, so no test relies
  on `fixture.whenStable()` needlessly or risks a flaky async gap.
