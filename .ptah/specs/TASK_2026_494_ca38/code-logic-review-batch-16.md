# Code Logic Review — `TASK_2026_494` — Batch 16 (Round 1)

## Summary

| Metric               | Value                                |
| --------------------- | ------------------------------------ |
| Overall score          | 9/10                                  |
| Assessment             | APPROVED                              |
| Blocking issues        | 0                                     |
| Serious issues         | 0                                     |
| Moderate issues        | 2                                     |
| Failure modes found    | 1 (accepted by design, D2)            |

Scope: `libs/shared/src/lib/types/webview-surface.types.ts` (+spec),
`apps/ptah-extension-webview/src/app/app.routes.ts`,
`apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts` (new),
`apps/ptah-extension-webview/src/app/webview-routing.spec.ts`. Read in full via `git diff`.
Excluded per instructions: `electron-layout.service.ts`, `apps-page.component.ts`,
`apps-page-splitter.spec.ts` (Batch 20, in progress, out of scope).

## Check table

| # | Check | Ruling | Evidence |
| - | ----- | ------ | -------- |
| 1 | Guard runs before component loads (`canMatch`, not `canActivate`); spec proves it; host flag read at match time | PASS | `electron-only-surface.guard.ts:19-20` — `canMatch: CanMatchFn = () => inject(VSCodeService).isElectron`, `inject()` called inside the returned closure so it re-reads on every match attempt, not once. `vscode.service.ts:171-173` — `isElectron` getter reads the `_config` signal live. Proven by `webview-routing.spec.ts:373-380` (`loadApps = jest.spyOn(routeFor('apps'), 'loadComponent')` installed before Router injection) plus `:390,404,419,435` (`expect(loadApps).not.toHaveBeenCalled()`, VS Code) and `:456,470` (`expect(loadApps).toHaveBeenCalledTimes(1)`, Electron) — both directions asserted, so "never called" is not vacuous. Direct unit coverage of the guard function itself at `:485-523` (`matchApps()` via `TestBed.runInInjectionContext`), including the real un-stubbed `VSCodeService` default (`isElectron: false`, `vscode.service.ts:82`) refusing. Confirmed by running `webview-routing.spec.ts`: 61/61 passed. |
| 2 | Refused route falls back to `/chat`, no loop, no navigation error, both `initialView` and `SWITCH_VIEW`, `currentView()==='chat'` | PASS | `app.routes.ts:171-172` — `**` and `''` both `redirectTo: DEFAULT_SURFACE_ID` ('chat'), not `'apps'`, so no redirect cycle is reachable. `surface-router.service.ts:116-142` — `navigateToSurface` never rejects; `router.navigateByUrl` resolving `true` returns `'navigated'`. `app-state.service.ts:580-582` — `currentView` is `computed(() => this.surfaceRouter.currentSurface())`, i.e. read live from the Router, not a stored flag, so it cannot report `'apps'` after a redirect. Spec: `:386-397` (initialView), `:399-411` (SWITCH_VIEW), `:414-424` (SWITCH_VIEW while already on chat), `:426-438` (refuses on every attempt from two different origins), `:440-452` (`console.error` and `ErrorHandler.handleError` both asserted not called). |
| 3 | Apps lib reached only by dynamic import — no static import of `@ptah-extension/mcp-apps-page` or `mcp-apps-contracts` in webview app / core / chat* / shared | PASS | Repo grep confirms `@ptah-extension/mcp-apps-page` appears only at `app.routes.ts:167` (`import(...)`) and `webview-routing.spec.ts:636` (`await import(...)`) outside the lib itself. `@ptah-extension/shared/mcp-apps-contracts` has zero hits in the webview app, core, or chat*. The hits inside `libs/shared/src/...` are the contracts package's own internal files (`mcp-apps-contracts/index.ts`, `surface.index.ts`, fixtures) — `shared` re-exporting its own subpath is expected, not a leak into an eager consumer. |
| 4a | History/deep-link loops still cover every surface incl. `apps`, nothing silently dropped | PASS | `webview-routing.spec.ts:213-216` and `:231-234` both iterate the full `JEST_RESOLVABLE_SURFACE_IDS` (unfiltered — `apps` was NOT added to `JEST_UNRESOLVABLE_SURFACES`, confirmed by A1 resolving). `it.each` deep-link loop (`:322-332`) still runs every id, calling `hostIsElectron(true)` for Electron-only ids before the boot (`:325`). |
| 4b | Changed assertion no weaker | PASS | Before this batch the "never calls window.history…" test ran with the default (VS Code-like, `isElectron:false`) host and pinned `currentSurface()==='tasks'` as the real last-navigated surface. The batch now runs it with `hostIsElectron(true)` and pins `currentSurface()==='apps'` — the same kind of assertion (a real, non-redirected landing) against the new last id, plus a companion test (`:227-247`) that preserves the original VS-Code-host, no-history property explicitly, with its own assertion that the walk lands on `chat`. Coverage is equal or broader, not weaker. |
| 5 | `'apps'` appears once in `ViewType`/`SURFACE_ROUTE_IDS`, after `'tasks'`; lock-step and allow-list tests pass; R7 intended and safe | PASS | `webview-surface.types.ts:51-55` (`ViewType`) and `:73-76` (`SURFACE_ROUTE_IDS`) each list `'apps'` exactly once, immediately after `'tasks'`. `ACCEPTED_INITIAL_VIEWS` (`:100-103`) is `[...SURFACE_ROUTE_IDS, ...LEGACY_SURFACE_ALIASES]`, so VS Code accepting `initialView:'apps'` is mechanical, not a separate edit — confirmed by the vscode-side `initial-view.spec.ts` (102/102 passing per the batch report) and by the fact that the routing guard, not the host-acceptance layer, is what actually keeps VS Code off the surface (see Q3 below). Ran `webview-surface.types.spec.ts`: 42/42 passed, including the lock-step assertion at `:32-36`. |
| 6 | A1 resolution | PASS | `webview-routing.spec.ts:630-639` resolves `routeFor('apps').loadComponent()` and compares identity against `await import('@ptah-extension/mcp-apps-page')`. Verified by running the suite (part of the 61 passing). `apps` correctly stays out of `JEST_UNRESOLVABLE_SURFACES`. |
| 7 | Five logic questions | See below |

## Five logic questions

### 1. How does this fail silently?

- `AppStateManager.normalizeInitialView` (`app-state.service.ts:724-734`) treats `'apps'` as a *known* route id
  (`isSurfaceRouteId('apps')` is `true` on every host, because that check does not know about Electron-only-ness) and
  returns it unchanged — no `console.warn`. The actual refusal happens one layer down, in the Router's `canMatch`.
  The net effect on VS Code: a host that sends `initialView:'apps'` (by config drift, a stale cached value, or a
  bug) is silently redirected to `chat` with **zero diagnostic output** — no `console.warn` (unlike a genuinely
  unknown id, which does warn at `:729-731`), no `console.error`, no `ErrorHandler.handleError` call. This is
  explicitly the design (`implementation-plan.md:318-319`, "a refused match redirects to chat silently"; batch-16
  coordinator ruling accepts the D2 behaviour), so it is not a defect introduced by this batch, but it is worth
  recording as the review's answer to this question: there is no log line anywhere in this path that a VS Code
  session ever received an Electron-only view id. If a future host regression starts sending `apps` on VS Code, QA
  would have no signal to find it by.
- `SurfaceUpdateInbox`-adjacent code is out of this batch's scope; not reviewed here.

### 2. What user action produces unexpected behaviour?

- None found that is not already covered. A user (or host) requesting `/apps` or `SWITCH_VIEW 'apps'` on VS Code
  always lands on `chat`, deterministically, on first and every subsequent attempt (`:426-438` proves repetition).
  No state is left half-applied: `SURFACE_ACTIVE` providers for `'apps'` are scoped to the route and are never
  constructed when `canMatch` refuses, so nothing from the Apps route's provider tree leaks into the `chat`
  fallback.

### 3. What input data produces a wrong answer?

- None found in the reviewed files. `isSurfaceRouteId`/`isAcceptedInitialView` are simple `Array.includes` checks
  against derived, deduplicated arrays (`webview-surface.types.spec.ts:33` asserts `SURFACE_ROUTE_IDS` has no
  duplicate via `new Set(...).size`), so there is no path where a malformed `initialView` string is misclassified
  as `'apps'`.

### 4. What happens when a dependency fails?

- `VSCodeService.isElectron` cannot throw: it reads a signal seeded with a default value (`isElectron: false`,
  `vscode.service.ts:82`) and is never uninitialized, so the guard has no unhandled-exception path.
- If the dynamic `import('@ptah-extension/mcp-apps-page')` itself were to reject (network/chunk failure in a
  packaged Electron build), that is downstream of `canMatch` passing and is not exercised by this batch's files —
  it is `AppsPageComponent`'s own concern (Batch 17+), not a gap in the guard or route table reviewed here.

### 5. What is missing that the requirements never mentioned?

- No spec toggles `VSCodeService.isElectron` mid-test (i.e., within one `TestBed` instance, navigate once as
  Electron then again as VS Code) to behaviourally prove the guard re-reads on each match rather than caching a
  value from first injection. The current proof is structural (the `inject()` call is inside the function body,
  executed fresh per invocation) plus two separate tests with two separate `TestBed` instances (one per host). This
  is sufficient given Angular's `CanMatchFn` contract and how `VSCodeService` is actually populated (once, from the
  preload script, never changed at runtime), so it is a coverage nicety rather than a real gap — recorded per the
  method's instruction to note it, not treated as a finding requiring a fix.
- Requirements do not say what should happen if a *route added after this batch* also needs `canMatch:
  [electronOnlySurface]` alongside another guard (array composition, ordering). Not applicable yet — `apps` is the
  only guarded route — flagged only as a forward note for whoever adds the next Electron-only surface.

## Failure modes

### Silent VS Code redirect on Electron-only `initialView`/`SWITCH_VIEW`

- Trigger: VS Code host sends `initialView:'apps'` or `SWITCH_VIEW {view:'apps'}`.
- Symptom: user silently lands on `chat`; nothing in the console or `ErrorHandler` shows a refusal occurred.
- Evidence: `electron-only-surface.guard.ts:19-20` (refusal), `app.routes.ts:170-172` (fallback), `webview-routing.spec.ts:440-452` (spec explicitly proves no error channel fires).
- Current handling: by design (`implementation-plan.md:160-172`, D2), and the coordinator's ruling on batch-16-report.md accepted this as intended.
- Recommendation: none required for this batch. If Batch 17+ or QA later wants a diagnostic trail for "host asked for an Electron-only surface it cannot show," that would be a `console.info`/`console.warn` added to the guard or to `navigateToSurface`'s redirect path — a deliberate, separately-scoped change, not a fix to this batch.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: No diagnostic output (not even `console.warn`) when a VS Code host requests the Electron-only `apps`
  surface, unlike the "genuinely unknown `initialView`" path which does warn (`app-state.service.ts:729-731`). See
  Failure modes above. Accepted by design per the coordinator's ruling; recorded for visibility, not blocking.
- Moderate: `ELECTRON_ONLY_SURFACES` (`webview-routing.spec.ts:93`) is a spec-local literal array that must be kept
  in sync by hand if a second Electron-only route is ever added — nothing in source enforces that every route with
  `canMatch: [electronOnlySurface]` is reflected there (the "guards exactly the Electron-only surfaces" test at
  `:593-601` does derive the *routes*' guarded set from `appRoutes` itself, but compares it against the hand-written
  `ELECTRON_ONLY_SURFACES`, so a forgotten update to that one constant would make the test wrong instead of red).
  Not a defect against this batch's single entry; a note for whoever adds the next guarded surface.
- Minor: test title `'resolves apps to the Apps lib"s AppsPageComponent'` (`webview-routing.spec.ts:630`) uses a
  literal `"` instead of an apostrophe — cosmetic, does not affect test execution (string is single-quoted), routed
  to code-style-reviewer rather than treated as a logic finding.

## Data flow

1. Host sends `initialView:'apps'` (or `SWITCH_VIEW{view:'apps'}`) — OK, both paths converge on
   `SurfaceRouterService.navigateToSurface('apps')`.
2. `isSurfaceRouteId('apps')` / `ACCEPTED_INITIAL_VIEWS` accept the id on every host (`webview-surface.types.ts:100-114`) — OK, matches D2/R7 design; host-level acceptance is intentionally host-agnostic.
3. `Router.navigateByUrl('/apps')` evaluates the `apps` route's `canMatch: [electronOnlySurface]` — OK, `inject(VSCodeService).isElectron` read live (`electron-only-surface.guard.ts:19-20`).
4. Electron (`isElectron===true`): guard returns `true`, `loadComponent` fires the dynamic import, `SURFACE_ACTIVE` provider resolves for `'apps'` — OK, proven by `loadApps` spy call count of 1 and `router.url === '/apps'` (`webview-routing.spec.ts:456-466,468-480`).
5. VS Code (`isElectron===false`): guard returns `false`, Router tries the next candidate, none matches `'apps'`, falls through to `**`/`''` → `redirectTo:'chat'` (`app.routes.ts:171-172`) — OK, no cycle possible since neither fallback targets `'apps'`.
6. `navigateByUrl` resolves `true` (URL changed to `/chat`) so `navigateToSurface` returns `'navigated'`, not `'failed'` — OK, `surfaceNavigationLanded(result)===true` asserted (`webview-routing.spec.ts:449-450`).
7. `AppStateManager.currentView` re-derives from the live Router state (`app-state.service.ts:580-582`) — OK, reports `'chat'`, never a stale `'apps'`.
8. No history/console/ErrorHandler side channel fires during the refusal — OK, asserted directly (`webview-routing.spec.ts:440-452`); this is also where the accepted "silent" behaviour of Failure Mode 1 lives.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | --------------- |
| `apps` in `ViewType`/`SURFACE_ROUTE_IDS`, appended once after `tasks` | COMPLETE | none |
| `apps` route, `canMatch: [electronOnlySurface]`, lazy `loadComponent`, `SURFACE_ACTIVE` provider, placed after `tasks` before fallbacks | COMPLETE | none |
| `electronOnlySurface` guard reads `VSCodeService.isElectron` at match time | COMPLETE | none |
| D-1/R1: existing loops keep covering every surface without weakening | COMPLETE | none |
| A1: dynamic import resolves under the webview jest transform | COMPLETE | none |
| R7: VS Code host accepts `initialView:'apps'` as intended, silently refused downstream | COMPLETE | none (silence is by design, see Moderate note) |
| R8: no eager/static consumer of the Apps lib or its contracts subpath | COMPLETE | none |

Implicit requirements not addressed: none found beyond the two Moderate notes above (both explicitly non-blocking).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `initialView:'apps'` on VS Code | YES | `canMatch` refusal → `**` fallback → `/chat` | none |
| `SWITCH_VIEW{view:'apps'}` on VS Code, from another surface | YES | same guard path, spec `:399-411` | none |
| `SWITCH_VIEW{view:'apps'}` while already on `chat` | YES | spec `:414-424`, no-op-looking redirect still lands on `/chat` | none |
| Repeated refusal from different origin surfaces | YES | spec `:426-438` | none |
| `initialView`/`SWITCH_VIEW 'apps'` on Electron | YES | guard passes, chunk loads once, `/apps` | none |
| Real, un-stubbed `VSCodeService` default (`isElectron:false`) | YES | spec `:517-523` | none |
| Dynamic import genuinely resolvable under Jest (A1) | YES | spec `:630-639`, ran and passed | none |
| Guard evaluated multiple times within one session with a changing host flag | NO (not applicable) | `isElectron` is set once from the preload script in real usage | acceptable, noted as a coverage nicety only |
| VS Code silently receiving an Electron-only `initialView` with no diagnostic trail | Partially (by design) | redirect happens correctly; no log emitted | Moderate, accepted by coordinator ruling |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only residual concern is observability — a VS Code host asking for the Electron-only `apps` surface leaves no diagnostic trail, which is an accepted design choice (D2) rather than an implementation defect.
- What a robust implementation would add: (1) a `console.warn`/telemetry line on Electron-only refusal, so a host regression that starts sending `apps` on VS Code is discoverable without reading test output; (2) deriving `ELECTRON_ONLY_SURFACES` in the spec from the route table's `canMatch` presence directly (partially done for the route-side assertion) rather than maintaining a parallel hand-written literal, so a second Electron-only surface can't silently fall out of the deep-link/history loop's Electron-driving logic.

One-line summary: Batch 16 wires `apps` as a `canMatch`-guarded, lazily-loaded, Electron-only route with tests that prove the guard's both-host behaviour, the D-1 loop restructuring is equally strong (not weaker), R7/R8/A1 all hold under direct verification (61/61 and 42/42 tests re-run green, 9-error tsc baseline unchanged, grep confirms no eager import of the Apps lib) — no blocking or serious defects found.
