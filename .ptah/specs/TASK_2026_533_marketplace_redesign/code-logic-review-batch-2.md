# Code Logic Review — Batch 2, `TASK_2026_533`

Scope: implementation-plan.md **D2** (Navigation API in core, with deep-link mapping)
and **C1** (Core marketplace navigation), as decomposed in batches.md Batch 2
(Task 2.1 `MarketplaceRoute` model, Task 2.2 `navigateToSurface(id, subPath)` +
`AppStateManager` route memory, Task 2.3 A2/A3 router probes).

Files read in full:

- `libs/frontend/core/src/lib/marketplace/marketplace-route.ts` (new)
- `libs/frontend/core/src/lib/marketplace/marketplace-route.spec.ts` (new)
- `libs/frontend/core/src/lib/routing/surface-router.service.ts`
- `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`
- `libs/frontend/core/src/lib/services/app-state.service.ts`
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts` (lines 1–120,
  960–1180 read closely; rest scanned)
- `libs/frontend/core/src/index.ts` (diff only, additive)
- `libs/frontend/core/src/lib/routing/surface-routes.ts` (context)

Not in this batch's scope and not reviewed here: `marketplace-section.ts` (untouched,
still exported), `mcp-status-chip.component.ts` / `chat-empty-state.component.ts`
(confirmed unmodified — caller migration is Batch 18), Batch 1 files
(`mcp-directory.types.ts`, `ptah-connectors.catalog.ts`, `mcp-install.service.ts`,
`installed-mcp-groups.ts`).

## Summary

| Metric              | Value                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Overall score       | 8/10                                                                                    |
| Assessment          | CHANGES REQUESTED (non-blocking; one test-title fix required, one contract gap flagged) |
| Blocking issues     | 0                                                                                       |
| Serious issues      | 0                                                                                       |
| Moderate issues     | 2                                                                                       |
| Failure modes found | 1 (narrow, low-likelihood)                                                              |

## Five logic questions

### 1. How does this fail silently?

- `navigateToSurface` never silently swallows a real navigation failure: the
  `try/catch` at `surface-router.service.ts:148-160` converts a thrown/rejected
  `navigateByUrl` into `'failed'` with a `console.error`, and the four-result union
  keeps `already-there` distinguishable from `cancelled` (tested at
  `surface-router.service.spec.ts:389-457`). No silent success-looking result found
  in the reviewed code for the navigation path itself.
- One narrow gap: `router.createUrlTree(...)` (`surface-router.service.ts:134-138`)
  and `router.serializeUrl(targetTree)` (`:142`) run **before** the `try` block
  starts (`:148`). The method's own contract states "Never rejects: every outcome is
  a `SurfaceNavigationResult`" (docstring, `:116-119`), but a synchronous throw from
  either call would propagate as a rejected promise, not a `'failed'` result — the
  one path in this file that could violate the stated contract. In practice
  `subPath` entries are always caller-supplied `string[]` (route segments already
  known to the type system), so this is unlikely to fire; it is a contract-vs-implementation
  gap, not an observed failure. See Moderate-2 below.
- `AppStateManager.rememberMarketplaceRoute` / `openMarketplace` do not hide
  failures either: `openMarketplace` delegates entirely to `requestSurface` →
  `navigateToSurface`, whose settlement outcome is filtered through
  `recordSettledSurface` (`app-state.service.ts:479-495`), which only stamps state
  when the navigation actually landed. A failed or cancelled `openMarketplace` call
  leaves the slice untouched — correct, not silent (nothing claims success it didn't
  reach).

### 2. What user action produces unexpected behaviour?

- A bare `/marketplace` navigation (Electron menu, or any `setCurrentView('marketplace')`
  caller) issued while a detail route is open (`/marketplace/servers/claude-user:sentry`)
  closes the open detail and lands on the list — confirmed by
  `surface-router.service.spec.ts:683-697` and documented as intentional in
  batches.md's "Open item for the architect" (line 71: decision explicitly deferred to
  before Batch 17). This is consistent with D2's "detail ids dropped" rule, not a
  Batch 2 defect, but see Moderate-1: the test that pins this behaviour is titled as
  if the opposite happened.
- Nothing else in this batch's scope produces behaviour a user could observe as wrong:
  `openMarketplace` is correctly guarded by `canSwitchViews()` (no-op while loading or
  disconnected, tested at `app-state.service.spec.ts:1141-1163`), and per-workspace
  isolation of `marketplaceRoute` is exercised for A→B, A→B→A, remove-then-return, and
  the bootstrap-sentinel migration case (`app-state.service.spec.ts:975-1085`).

### 3. What input data produces a wrong answer?

- `marketplaceRouteFromSegments` is genuinely total and was walked against every row
  of the D2 table, every retired id, every detail-ref shape (including one carrying
  `/` and `:` in its tail), and a battery of malformed inputs (empty array, empty
  segment, 3+ segments, mixed case, colon soup) — `marketplace-route.spec.ts:131-206`.
  All paths return `null` or a valid `MarketplaceRoute`; none throw. I did not find an
  input that maps to a wrong (as opposed to `null`) route.
- `sameMarketplaceRoute` (`app-state.service.ts:248-258`) compares two routes by their
  router commands array; `{page:'servers'}` and `{page:'servers',source:undefined}`
  compare equal, matching the Router's own treatment — verified functionally by the
  round-trip test in `marketplace-route.spec.ts:88-98`.

### 4. What happens when a dependency fails?

- A rejected lazy-chunk fetch (the concrete failure mode named in the class doc,
  `surface-router.service.ts:34`) is exercised for both the no-subPath and
  sub-path cases (`:412-428`, `:582-596`) and correctly reports `'failed'` while
  leaving `currentSurface()` on the previous surface (`:444-457`).
- A guard/resolver that resolves `false` out from under a caller (supersession) is
  distinguished from "already there" for both no-subPath and sub-path navigations
  (`:430-442`, `:598-608`) — this is exactly the F3 defect class the class doc
  describes, and it is closed for the new sub-path surface too.
- `RedirectFunction` (`restoreMarketplaceRoute`, spec `:169-175`) runs inside an
  injection context and reads `AppStateManager.marketplaceRoute()` — A2 verified
  (`:625-638`), including the "nothing remembered → overview" fallback (`:640-647`).

### 5. What is missing that the requirements never mentioned?

- The plan doesn't say what happens if `createUrlTree`/`serializeUrl` throw
  synchronously (Moderate-2). Not exercised by any test, and the "never rejects"
  contract doesn't fully cover it.
- No test in this batch exercises `navigateToSurface` being called re-entrantly with
  two different sub-paths **before** the first settles (a double-click on two
  different Marketplace nav items). `_navigationGeneration` in `AppStateManager`
  guards `recordSettledSurface` against exactly this at the `AppStateManager` layer
  (`app-state.service.ts:414`, `:486`), so the risk is contained there, not in
  `SurfaceRouterService` itself — this is an existing pattern, not new in Batch 2,
  and outside this batch's file list to test further.

## Failure modes

### Synchronous throw from `createUrlTree`/`serializeUrl` escapes the try/catch

- Trigger: `Router.createUrlTree` or `Router.serializeUrl` throws synchronously
  (e.g., a malformed command array reaching the Router API in a way TypeScript's
  `string[]` typing wouldn't catch, or a future Angular version tightening
  validation).
- Symptom: `navigateToSurface` returns a rejected promise instead of resolving to
  `'failed'`, breaking the method's own "never rejects" contract
  (`surface-router.service.ts:116-119`) and the batch's stated focus requirement
  ("navigateToSurface... must... never reject").
- Evidence: `surface-router.service.ts:134-142` (both calls sit before the `try` at
  `:148`).
- Current handling: none — an exception here is unhandled by this method.
- Recommendation: move `createUrlTree`/`serializeUrl` inside the `try` block, or wrap
  them in their own try/catch that also returns `'failed'`. Low priority given the
  call sites are all internal, typed `string[]` route segments, but worth closing
  since the class doc makes an explicit, testable promise.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### 1. Misleading test title, `surface-router.service.spec.ts:683`

- File: `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts:683-697`
- The test is titled `'A3: an open detail survives the bare /marketplace navigation too'`
  but its own comment (`:684-686`) and its assertions prove the opposite: the detail
  component is **not** re-asserted to exist after the second navigation (only
  `constructed.shell === 1` and `constructed.installedServers === 1` are checked,
  and `probe.router.url` ends on `/marketplace/servers`, not on the detail URL). What
  survives is the **list** instance; the **detail closes**. This is exactly what the
  batches.md "Open item for the architect" (line 71) describes as the current,
  provisionally-accepted behaviour.
- Impact: a reader (or a future diff reviewer) skimming test names sees "survives"
  and reasonably concludes the detail is preserved across the navigation, which is
  false. Given the task's explicit instruction to "require a correct title," this
  must be renamed before the batch is accepted.
- Fix: rename to something like `'A3: a bare /marketplace navigation while a detail is open closes the detail and keeps the list instance'`, matching the comment already in the test body.

### 2. `createUrlTree`/`serializeUrl` outside the try/catch

- File: `libs/frontend/core/src/lib/routing/surface-router.service.ts:134-148`
- See Failure Modes above. Recommend widening the try/catch boundary.

### Minor: worker-exit warning — investigated, not attributable to Batch 2

- The task asked me to determine whether the new/changed specs leak a handle,
  given "A worker process has failed to exit gracefully" printed on a full core run.
- Evidence gathered:
  - `npx jest -c libs/frontend/core/jest.config.ts <3 changed spec files> --detectOpenHandles`,
    run 3× (parallel workers, not `--runInBand`): clean every time, no warning, no
    leak reported by `--detectOpenHandles`.
  - `npx nx test @ptah-extension/core --skip-nx-cache --detectOpenHandles --runInBand`:
    clean (941/941, no warning).
  - `npx nx test @ptah-extension/core --skip-nx-cache` (full 34-suite project, default
    workers), run 2×: the warning appeared in 1 of 2 runs, with **no** file or handle
    identified (Jest's message is generic when it can't pinpoint the source).
  - `npx jest -c libs/frontend/core/jest.config.ts --detectOpenHandles` (full project,
    default parallel workers, direct jest invocation bypassing `nx`), run 3×: clean
    every time.
- Conclusion: the warning is intermittent, reproduces only through the `nx`-wrapped
  full-project run (never through direct `jest --detectOpenHandles`, and never when
  scoped to just the new/changed specs), which points to `nx`'s own process/worker
  orchestration rather than a handle leaked by `marketplace-route.spec.ts`,
  `surface-router.service.spec.ts`, or `app-state.service.spec.ts`. I found no
  evidence implicating this batch's specs. If it recurs, bisecting by running the
  other 31 suites in the core project (unrelated to Batch 2) with `--detectOpenHandles`
  would be the next step, but that is outside this batch's file list.

## Data flow

1. Caller (e.g. `openMarketplace`, `setCurrentView`, a router `RedirectFunction`) picks a
   `MarketplaceRoute` or a `ViewType` + optional sub-path. OK.
2. `marketplaceRouteCommands(route)` turns the route into router commands, exhaustive
   over the union via `assertNever`. OK — compile-time guarantee, spec confirms fresh
   array per call so a caller mutating the result is safe (`marketplace-route.spec.ts:92-98`).
3. `AppStateManager.requestSurface(surface, subPath)` captures the current
   `_navigationGeneration` and `_activeWorkspacePath` synchronously, before the async
   navigation starts. OK — this is what makes the later ownership check meaningful
   even under a fast workspace switch.
4. `SurfaceRouterService.navigateToSurface(id, subPath)` resolves `id` against the
   route table (falling back to the default surface and dropping `subPath` if `id`
   has no route — documented and tested), builds a `UrlTree` via `createUrlTree`,
   serializes it, records whether the Router was already there, then awaits
   `navigateByUrl`. OK, except the two Router calls before the `try` (Moderate-2).
5. The Router settles (or the promise resolves `false`/rejects) and
   `navigateToSurface` returns one of the four `SurfaceNavigationResult` values. OK,
   verified for the no-subPath and sub-path paths symmetrically.
6. `AppStateManager.recordSettledSurface` gates the write on: landed, current
   generation, active workspace, and only then stamps `_settlementOwner` and calls
   `openViewInActiveSlice(surface)` — which records the **surface**, not the page
   inside it. OK — matches the plan's explicit division of labour ("the page inside
   it is recorded by the surface itself", comment at `app-state.service.ts:450-451`).
7. The Marketplace shell (Batch 12, out of scope) is expected to call
   `rememberMarketplaceRoute(route)` on its own `NavigationEnd`, never ahead of one.
   `openMarketplace` was verified NOT to write the route ahead of settlement
   (`app-state.service.spec.ts:1129-1139`) — directly closes the TASK_2026_317 lesson
   named in the task's focus list.
8. `marketplaceRoute()` (computed, per-workspace) is read by the default-child
   `RedirectFunction` to restore the remembered page, or `null` → overview. OK,
   verified for both the "something remembered" and "nothing remembered" cases (A2),
   and for a workspace switch reading the INCOMING workspace's memory, not the
   outgoing one's (`surface-router.service.spec.ts:709-731`).

## Requirements fulfilment

| Requirement                                                                                       | Status   | Gap                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `navigateToSurface(id, subPath)` result semantics hold for sub-paths, never rejects               | PARTIAL  | Holds for every exercised path; `createUrlTree`/`serializeUrl` sit outside the try/catch (Moderate-2)                                                                                |
| `already-there` via serialized trees                                                              | COMPLETE | Verified including an encoded segment (`external:owner/repo/plugin`)                                                                                                                 |
| `requestSurface` subPath + settlement ownership (`app-state.service.ts` ~:419-428)                | COMPLETE | subPath threaded through; settlement still records surface only, matching the plan's division of responsibility                                                                      |
| `openMarketplace` keeps `canSwitchViews` guard, does not store the route up front                 | COMPLETE | Verified by dedicated tests; matches TASK_2026_317 lesson                                                                                                                            |
| Per-workspace isolation of `marketplaceRoute`                                                     | COMPLETE | A→B (no bleed), A→B→A (restore), removeWorkspaceState, bootstrap-sentinel migration, same-workspace switch no-op, all tested                                                         |
| `marketplaceRouteFromSegments` totality (unknown → null, detail ids dropped)                      | COMPLETE | D2 table walked row-by-row both directions; malformed/adversarial inputs never throw                                                                                                 |
| Additive-only: old encode/parse API and `marketplaceActiveProvider` still work, no caller changed | COMPLETE | `marketplace-section.ts` untouched; `core/src/index.ts` diff is purely additive; `mcp-status-chip.component.ts` / `chat-empty-state.component.ts` confirmed unmodified in git status |
| Test-title correctness (surface-router.service.spec.ts:683)                                       | MISSING  | Title contradicts its own assertions and comment; must be renamed                                                                                                                    |
| Worker-exit leak diagnosis                                                                        | COMPLETE | Investigated with scoped and full runs, both with and without `--detectOpenHandles`; no evidence implicates the new/changed specs                                                    |

Implicit requirements not addressed: none found beyond the two Moderate items above.

## Edge cases

| Case                                                                | Handled | How                                      | Concern                                            |
| ------------------------------------------------------------------- | ------- | ---------------------------------------- | -------------------------------------------------- |
| Sub-path repeat → already-there                                     | YES     | `surface-router.service.spec.ts:536-544` | none                                               |
| Sub-path with `/`-carrying encoded segment → already-there          | YES     | `:546-559`                               | none                                               |
| Sub-path navigation between two children of the same surface        | YES     | `:561-570`                               | none                                               |
| Bare surface root while on a child ≠ already-there                  | YES     | `:572-580`                               | none                                               |
| Sub-path navigation throws → failed                                 | YES     | `:582-596`                               | none                                               |
| Sub-path navigation superseded → cancelled                          | YES     | `:598-608`                               | none                                               |
| Sub-path dropped when surface falls back to default                 | YES     | `:610-621`                               | none                                               |
| Bare `/marketplace` while a detail is open                          | YES     | `:683-697`                               | test title is wrong (Moderate-1)                   |
| Workspace switch reads INCOMING workspace's remembered route        | YES     | `:709-731`                               | none                                               |
| `openMarketplace` no-op while loading / disconnected                | YES     | `app-state.service.spec.ts:1141-1163`    | none                                               |
| `openMarketplace` does not pre-write the route                      | YES     | `:1129-1139`                             | none                                               |
| Never-visited workspace does not inherit previous workspace's route | YES     | `:981-995`                               | none                                               |
| Route memory survives unrelated navigations in the same slice       | YES     | `:1015-1034`                             | none                                               |
| Re-remembering the same route is a no-op (no re-notify)             | YES     | `:1067-1075`                             | none                                               |
| `createUrlTree`/`serializeUrl` synchronous throw                    | NO      | —                                        | narrow, low-likelihood (Failure Modes, Moderate-2) |

## Verdict

- Recommendation: REVISE (small, well-scoped fix — the test title — required; the
  try/catch boundary is a should-fix, not a blocker)
- Confidence: HIGH
- Top risk: none rises to blocking; the highest-value fix is the misleading test
  title, because it is the kind of thing a future engineer trusts without re-reading
  the assertions and would then design the wrong UX expectation around.
- What a robust implementation would add: widen the `navigateToSurface` try/catch to
  cover `createUrlTree`/`serializeUrl`; rename the `:683` test; optionally add one
  test exercising a `createUrlTree` throw to lock in the "never rejects" contract
  end-to-end (not just for `navigateByUrl` rejections).
