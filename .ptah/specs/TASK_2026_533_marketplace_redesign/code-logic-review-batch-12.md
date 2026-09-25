# Code Logic Review — `TASK_2026_533` Batch 12 (`MarketplaceShellComponent`, `MarketplaceNavComponent`, status bar — plan C6)

## Summary

| Metric                                  | Value                                                   |
| --------------------------------------- | ------------------------------------------------------- |
| Overall score                           | 8/10                                                    |
| Assessment                              | APPROVED                                                |
| Verdict                                 | **APPROVED** (no changes required)                      |
| Blocking issues                         | 0                                                       |
| Serious issues                          | 0                                                       |
| Moderate issues                         | 1                                                       |
| Minor issues                            | 2                                                       |
| Failure modes found                     | 1 (forward-looking, not currently exercised)            |
| Flaky test (1/569 in 1 of 11 full runs) | **Did not reproduce** in 12 full-suite runs (see below) |

Files reviewed in full: `marketplace-shell.component.ts`, `.html`, `.spec.ts`; `marketplace-nav.component.ts`, `.spec.ts`; `marketplace-status-bar.component.ts`, `.spec.ts` (all under `libs/frontend/marketplace/src/lib/shell/`), plus their direct dependencies read for correctness (`libs/frontend/core/src/lib/marketplace/marketplace-route.ts`, `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts`, `libs/frontend/marketplace/src/lib/data/connector-links.store.ts`, `libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts`).

## Five logic questions

### 1. How does this fail silently?

Nothing found that swallows a failure and reports success. There is no RPC call, no try/catch, and no `catch (error: unknown)` in any of the three files (confirmed by grep — N/A for this batch). The one place a failure could be silently absorbed — a navigation that never resolves — simply leaves `route()` and the breadcrumb at their last good value; no state is falsely marked "done". `ensure()`/`reload()`/`retry()` are never called from these files, so there is no load path here that could hide an error behind a default value.

### 2. What user action produces unexpected behaviour?

- None found in the click/keyboard paths tested. The `/` shortcut, back-to-chat button and breadcrumb link all behave as specced.
- One forward-looking gap (see Moderate-1 below): if a future page (Batches 13–16) hides an inactive search field with a CSS class instead of the `hidden`/`inert` attribute, pressing `/` would focus that invisible field instead of skipping it. Today's stub pages and the codebase's own tab convention (`NativeTabGroupComponent`'s doc: content is owned by `@switch`, i.e. inactive tab content is not in the DOM at all — `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:5,35`) make this unlikely in practice, but the guard (`marketplace-shell.component.ts:239-241`, `closest('[hidden], [inert]')`) does not defend against it.

### 3. What input data produces a wrong answer?

Walked the full D1 route tree against `marketplaceRouteFromSegments` (`libs/frontend/core/src/lib/marketplace/marketplace-route.ts:107-130`) and the nav's `matchOptionsOf`/`sameRoute` logic (`marketplace-nav.component.ts:142-155,384-391`) for every route shape: `overview`, `overview/:serverRef`, `connectors`, `connectors/:connectorId`, `servers`, `servers/:serverRef`, `servers/smithery|registry|custom-url`, `skills`, `skills/:skillRef`, `skills/ptah-plugins|community|marketplaces`. In every case exactly one nav item ends up active and the breadcrumb label matches it — including the two cases the review explicitly flagged:

- `/marketplace/servers/smithery` → only "Smithery" is active (the "MCP Servers" list item switches to `EXACT_MATCH` because `isSourceRoute()` is true, so its `/marketplace/servers` subset match no longer fires) — verified by `marketplace-nav.component.spec.ts:369-381`.
- `/marketplace/servers/claude-user:sentry` → only "MCP Servers" is active (the ref contains `:`, which `isServerSource` never matches, so it decodes to `{page:'servers'}` with no source, `isSourceRoute` is false, and `SUBSET_MATCH` correctly treats `/marketplace/servers` as a prefix of the current URL) — verified by `marketplace-nav.component.spec.ts:383-389` and `marketplace-shell.component.spec.ts:461-474`.
  No input decodes to two simultaneously "current" nav items, and no input decodes to zero when a real page is settled.

### 4. What happens when a dependency fails?

- `injectMarketplaceNavCounts()` (`marketplace-nav.component.ts:201-227`) reads `inventory.counts()` and `links.state()`/`links()` only. If a slice's state is `error`, its count function returns `null` (hidden), never a stale or fabricated number — confirmed by reading `MarketplaceInventoryStore.counts` (`marketplace-inventory.store.ts:352-361`, itself derived from `countOf`, which only reads `ready` slices) and by the nav spec's "hides the connectors count while the links are not ready" case (`marketplace-nav.component.spec.ts:316-322`).
- Neither store's constructor performs an eager load: both only wire `DestroyRef.onDestroy` and a `workspaceEffect` that no-ops on its first run (`connector-links.store.ts:208-213,310-322`; `marketplace-inventory.store.ts:291-295,367-377`), and reload only when the slice is already non-idle. This was previously reviewed in Batches 5/6; re-verified here because the shell is what actually constructs these stores via `providers:`.
- Router navigation failures (guard rejection, unresolved navigation) simply never produce a `NavigationEnd`, so `_route` and the remembered route stay at their last good value — no bad write, no crash.

### 5. What is missing that the requirements never mentioned?

- The plan does not say what happens to the breadcrumb/nav while an OUTER navigation is _pending_ (i.e. between click and `NavigationEnd`). The nav's `routerLinkActive` and the shell's `_route` both only update on settlement, so there is a brief window where the previous page is still marked current — normal, expected router behaviour, not a defect.
- The plan's "exactly one `aria-current="page"`" framing (from the review brief) is satisfied _within_ each landmark (the breadcrumb's `<ol>` and the nav's `<ul>` each carry exactly one), but the breadcrumb's current crumb and the nav's current link are both marked simultaneously when a page is settled. This is correct ARIA usage (each is a distinct set of "like elements": a breadcrumb trail and a primary-nav item list), not a violation, but is worth recording explicitly since the review focus asked for it by name.

## Failure modes

### Hidden-but-present search field steals focus on `/`

- Trigger: a future Marketplace page (Batches 13–16) renders an `input[type="search"]` or `[role="searchbox"]` that is present in the DOM but visually hidden via a CSS class (e.g. Tailwind `hidden`) rather than the native `hidden`/`inert` attribute — for example inside a collapsed filter panel.
- Symptom: pressing `/` calls `.focus()` on an invisible field instead of doing nothing or finding the visible one; the user sees focus apparently vanish.
- Evidence: `marketplace-shell.component.ts:234-243` (`pageSearch()`), guard at `:240` only checks `closest('[hidden], [inert]')`.
- Current handling: none beyond the attribute check.
- Recommendation: no code change needed for Batch 12 itself (no such page exists yet), but record this as a binding contract for Batches 10, 13–16, as the review brief requested: **a page's search/filter field must be structurally absent (`@if`) or use the `hidden`/`inert` attribute when inactive, never CSS-only hiding**, if it wants `/` to skip it correctly. This matches the existing `NativeTabGroupComponent` convention (`@switch`-owned content), so compliant pages need no extra work.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. **Moderate** — `pageSearch()`'s hidden-element guard is attribute-only, not CSS-aware (`marketplace-shell.component.ts:234-243`). See Failure Modes above. Not a defect today; a forward contract that should be written down for Batches 10/13–16 authors, since nothing enforces it automatically.
2. **Minor** — The tier-flip "no `NgZone.run`" claim is proven twice: directly, by the fact that `MarketplaceLayout` (`libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts:59-119`) never imports or calls `NgZone`/`ngZone.run` at all (grep-confirmed), and indirectly, by the shell spec never calling `detectChanges()` after a `ResizeObserver` report (`marketplace-shell.component.spec.ts:242-270`, `202-206`). The spec's indirect proof is real (removing `autoDetectChanges()` per the executor's note would fail it), but it is evidence that Angular's signal-driven CD scheduler alone can pick up the write — it does not itself prove the _absence_ of `NgZone.run` in the implementation (a version that wrapped the write in `ngZone.run()` would pass the same spec). The direct source-level fact is what actually settles the Batch 3 decision; worth stating explicitly in the batch report rather than relying on the spec alone as "the" proof.
3. **Minor** — A generic Jest warning ("A worker process has failed to exit gracefully… Active timers can also cause this") appears on **every** run of the full marketplace suite (569 tests / 21 suites), independent of pass/fail and independent of this batch's files (see Flaky-test investigation). It is not attributable to `shell/*` by any evidence gathered (the shell/nav/status-bar specs use only `RouterTestingHarness`/`TestBed`, whose fixtures are provably destroyed via `TestBed.resetTestingModule()` → `destroyActiveFixtures()`, confirmed by reading `node_modules/@angular/core/fesm2022/testing.mjs:1550-1567`). Flagging for awareness since it is a plausible root cause of _some_ future flake even though it isn't the one reported here.

## Data flow

1. Router navigates into `/marketplace/...` → `MarketplaceShellComponent` constructed. `providers:` creates `MarketplaceInventoryStore`, `ConnectorLinksStore`, `MarketplaceLayout` — OK, none of the three do any eager load (verified: no RPC/catalogue call in any constructor or first-run effect).
2. Constructor seeds `_route` from `marketplaceRouteOfUrl(router, router.url)`, then subscribes to `router.events` filtered to `NavigationEnd` — OK, subscription is live before the current navigation's `NavigationEnd` fires (doc comment `marketplace-shell.component.ts:192-194`, confirmed by spec `:445-451`).
3. `NavigationEnd` fires → `_route.set(route)`; if `route !== null`, `appState.rememberMarketplaceRoute(route)` — OK, guarded so leaving `/marketplace` never overwrites the remembered route with `null` (`marketplace-shell.component.ts:207-208`, spec `:476-483`).
4. `layout.observe(hostElement)` starts a `ResizeObserver` on the shell's own host — OK, seeded synchronously from `clientWidth`, falls back to `window.innerWidth` when `ResizeObserver` is absent (`marketplace-layout.ts:79-97`).
5. Resize report → `_width.set(measured)` → `tier` computed recomputes → template re-renders rail/sidebar, status bar presence, `data-tier` attribute — OK, direct signal write, no `NgZone.run`, picked up by Angular's own CD scheduler (spec proof at `marketplace-shell.component.spec.ts:242-270`).
6. `MarketplaceNavComponent` and `MarketplaceStatusBarComponent` each call `injectMarketplaceNavCounts()` independently — OK, both read the same store instances (provided once by the shell), no duplicate side effects, no `ensure()`/`reload()` calls (verified: `marketplace-nav.component.spec.ts:334-347`, `marketplace-status-bar.component.spec.ts:114-121`).
7. `/` keydown on the shell host → `isEditableTarget` guard → `pageSearch()` queries within `<main>` → focuses first visible candidate — OK for every case exercised (input/textarea/select/contenteditable, modifier keys, no-search page). Gap noted above for CSS-only-hidden fields (not exercised because no such page exists yet).
8. Shell destroyed (navigate to `/chat`) → `DestroyRef.onDestroy` on `MarketplaceLayout` disconnects the observer; `takeUntilDestroyed()` cancels the router subscription — OK, verified by `marketplace-shell.component.spec.ts:283-295`.

No step in this chain writes application state ahead of the router settling (no TASK_2026_317-style mirror), and no step fires an RPC.

## Requirements fulfilment

| Requirement                                                                                                          | Status                          | Gap                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Route memory: record on `NavigationEnd` inside `/marketplace` only; detail routes record the list                    | COMPLETE                        | None — verified analytically against the full D1 tree and by spec.                                                                |
| Zero-RPC at shell mount, any tier; `injectMarketplaceNavCounts()` never calls `ensure`/`reload`/`retry`              | COMPLETE                        | None — verified against real store constructors, not fakes, in the shell spec.                                                    |
| Nav active state: exact match while a source page is open; exactly one `aria-current="page"` per nav                 | COMPLETE                        | None — walked the full route tree; breadcrumb and nav each carry exactly one current marker (see Q5 for the two-landmark nuance). |
| `/` never fires in editable targets; contract "pages render `input[type=search]`/`[role=searchbox]` inside `<main>`" | COMPLETE (contract now binding) | CSS-only-hidden fields are not guarded against (Moderate-1) — record as binding for Batches 10, 13–16 as requested.               |
| Host header: Electron slim row / no back button; VS Code back button; no shell `<h1>`                                | COMPLETE                        | None — verified by spec in both hosts.                                                                                            |
| Tier flip proof: observer → signal → DOM without `NgZone.run`; 400px structural check                                | COMPLETE                        | Real-pixel check correctly deferred to Task 25.2 (confirmed present in `batches.md:1118-1126`).                                   |

Implicit requirements not addressed: none found beyond the items already logged as Minor/Moderate above.

## Edge cases

| Case                                                              | Handled | How                                                                                                                                       | Concern                              |
| ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Bare `/marketplace` redirect settles to a page                    | YES     | `NavigationEnd` subscription records the settled page even for a redirected navigation (`marketplace-shell.component.spec.ts:453-459`)    | None                                 |
| Detail route open (`servers/claude-user:sentry`)                  | YES     | Remembers the list page, not the detail; nav highlights the list item only                                                                | None                                 |
| Navigation leaves the Marketplace entirely                        | YES     | `route === null` guard prevents clobbering the remembered route                                                                           | None                                 |
| No `ResizeObserver` (jsdom / very old host)                       | YES     | Falls back to `window.innerWidth` (`marketplace-layout.ts:87-96`), inherited from Batch 3, not re-tested here but re-read for correctness | None                                 |
| `/` pressed with a modifier key                                   | YES     | Ignored, event not prevented (`marketplace-shell.component.spec.ts:546-552`)                                                              | None                                 |
| `/` pressed on a page with no search field                        | YES     | `pageSearch()` returns null, key left alone (`marketplace-shell.component.spec.ts:554-560`)                                               | None                                 |
| Count of exactly 0 vs unknown (`null`)                            | YES     | `0` renders, `null` hides the badge/summary entry (both nav and status-bar specs)                                                         | None                                 |
| CSS-only-hidden search field                                      | NO      | Not guarded (Failure Modes, Moderate-1)                                                                                                   | Forward risk for Batches 13–16 pages |
| Two rapid resize reports crossing both breakpoints (720→1500→600) | YES     | `marketplace-shell.component.spec.ts:272-281` keeps the routed page instance stable                                                       | None                                 |

## Flaky-test investigation

Ran the full marketplace suite (`@ptah-extension/marketplace`, 21 suites / 569 tests) **12 times** total, looking for the 1-failure-in-569 reported from one of 11 `nx run-many` runs:

- 1× `npx nx run-many -t test -p @ptah-extension/marketplace` (cache miss, full run): 569/569 passed.
- 4× `npx jest -c libs/frontend/marketplace/jest.config.ts --silent` (default order): 569/569 passed each time.
- 4× same command with `--randomize` (different seeds each run, printed and available if a re-run is wanted): 569/569 passed each time.
- 3× same command with `--randomize --maxWorkers=8` (stress higher parallelism): 569/569 passed each time.

**Result: the failure did not reproduce in any of the 12 runs.** I could not identify the failing spec.

One consistent, unrelated observation across **every** run (pass or not): Jest prints `"A worker process has failed to exit gracefully and has been force exited... Active timers can also cause this, ensure that .unref() was called on them."` This is a real open-handle/leak signal somewhere in the 21-suite run, but:

- It is present regardless of pass/fail, so it is not by itself evidence of the specific reported flake.
- I found no evidence it originates in the Batch 12 files: the shell/nav/status-bar specs use only `TestBed`/`RouterTestingHarness`, and Angular's own `TestBed.resetTestingModule()` provably destroys every fixture created via `TestBed.createComponent` (`_activeFixtures.forEach(fixture => fixture.destroy())`, confirmed by reading `node_modules/@angular/core/fesm2022/testing.mjs:1550-1567`), which tears down the shell's `DestroyRef`-driven cleanup (`ResizeObserver.disconnect()`, `takeUntilDestroyed()`) between tests as designed.
- The more likely source, based on file names in the suite, is one of the pre-existing stores/surfaces with real or fake timers (e.g. Smithery polling in `connector-links.store.spec.ts`, Batch 6) or the still-present, soon-to-be-deleted `connected-surface.component.spec.ts` / `connectors-surface.component.spec.ts`. This is a hypothesis, not a finding — I did not trace it further because it is out of this batch's file scope and did not manifest as a failure in any of the 12 runs.

Also ran `ptah_get_diagnostics` scoped to the four changed files: 0 errors attributable to them. The 6 TypeScript diagnostics returned all belong to files outside this batch's scope (`core/src/testing/mock-rpc-service.ts`, `connected-surface.component.spec.ts`, `harness/harness-health.store.spec.ts`) and pre-date Batch 12 (none of these files are touched by the shell/nav/status-bar work).

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none blocking. The one forward-looking gap (CSS-only-hidden search fields defeating the `/` shortcut) has no current instance to exploit, and is now recorded as a binding contract for the batches that will add such pages.
- What a robust implementation would add: (1) a spec asserting the `/` guard also skips a CSS-`hidden`-classed (but attribute-visible) search field, to lock in the contract before Batches 13–16 land; (2) an explicit statement in the batch report that `MarketplaceLayout` contains no `NgZone` reference at all (the strongest form of the "no `NgZone.run`" proof), rather than relying solely on the spec's absence of `detectChanges()`.
