# Code Logic Review — `TASK_2026_540_0940` Batch 4

Scope reviewed: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (full file, 391
lines), `electron-shell.activity-placement.spec.ts` (full file, 160 lines), `electron-shell.config-gate.spec.ts`
(full file, new, 310 lines) — against `git diff -- <these paths>` on the current worktree HEAD. Cross-referenced
`libs/frontend/core/src/lib/routing/surface-router.service.ts` (`remountActiveSurface`, `pendingSurface`),
`libs/frontend/core/src/lib/services/app-state.service.ts:760-860` (`switchWorkspace` stay-branch, tick bump),
`apps/ptah-extension-webview/src/app/app.html:53-58` and `app.ts:55-64` (mount site, `isElectron`/`isReady`
stability), and `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts:126`
(external selector contract). batches.md, implementation-plan.md (Revision 3 overrides, lines 1-36), and
task-description.md criteria 4, 5, 8-13, 19-21 read in full. batch-4-report.md read in full.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | ACCEPT WITH FIXES                    |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2                                    |

## Five logic questions

### 1. How does this fail silently?

- The remount effect's focus-recovery is a silent no-op whenever `configurationSurfaceHost()` resolves to
  `undefined` at the moment the effect body runs (`electron-shell.component.ts:332-340`). `host?.focus()` under
  optional chaining swallows the "no host" case with no log, no assertion, nothing observable. See Failure mode 1.
- `remountActiveSurface()` intentionally does not catch construction/lifecycle errors from the re-created routed
  component (per binding rule 3, correctly not fixed here) — an exception there propagates up through the effect
  and becomes an unhandled error in Angular's effect scheduler. That is deliberate per the batch-2 reviewer's
  instruction, not a Batch 4 defect, but it is a place where "remount failed" would show as a console error rather
  than a caught, user-facing state. Recorded here because the review checklist asks for dependency-failure
  behaviour; the code correctly declines to hide it (see `surface-router.service.ts:157-158` JSDoc).

### 2. What user action produces unexpected behaviour?

- None found that is not already named and accepted in batches.md (RB churn on the 2→3 flip, RJ on a
  cancelled/failed in-flight navigation). Clicking "Back to welcome," the menu items, and the four tabs each map to
  a single, traceable `AppStateManager` call with no duplicated logic (`electron-shell.component.ts:189`, `:375-390`).

### 3. What input data produces a wrong answer?

- No externally-supplied input is parsed or validated in this batch — it is pure state-to-template wiring. The
  only "input" is the tick counter and `pendingSurface()`, both internal signals from Batch 1/2, already reviewed
  there.

### 4. What happens when a dependency fails?

- `SurfaceRouterService.remountActiveSurface()` throwing: unhandled, by design (binding rule 3, `batch-2-internal-review.md` instruction 3). Correctly not swallowed here.
- `layout.hasWorkspaceFolders()` and `appState.configurationSurfaceRemountTick()` disagreeing about which pass they
  land in: see Failure mode 1 below — this is the one path where a "dependency" (the workspace-folder signal from
  `ElectronLayoutService`) arriving in a different change-detection pass than the tick would leave focus-recovery
  silently inert.

### 5. What is missing that the requirements never mentioned?

- No requirement anywhere says the config-gate spec must exercise `remountActiveSurface()` against a *real*,
  route-configured Router (with an actual component behind `/settings`). The spec's `expectBareOutlet()`
  (`electron-shell.config-gate.spec.ts:107-114`) only proves a `<router-outlet>` DOM node and `RouterOutlet`
  directive exist — with `provideRouter([])` there are no routes to activate, so this batch's own tests cannot
  answer the review question "does the new `RouterOutlet` re-activate the stored route on init?" That proof lives
  entirely in Batch 2's spec (real routes, real activation) plus deferred manual QA (batches.md Batch 4
  verification, RD). Not a defect — a scope boundary worth naming since the review brief asked the question
  directly. See Failure mode 2.

## Failure modes

### 1. Focus-recovery closure targets a host that exists only in the workspace-open template branch

- Trigger: a `configurationSurfaceRemountTick` bump is processed by the effect while `layout.hasWorkspaceFolders()`
  is still `false` in the template that the effect's synchronous body sees (i.e. before the branch-2→3 template
  flip has been rendered and the `viewChild` query re-resolved).
- Symptom: `this.configurationSurfaceHost()` (`electron-shell.component.ts:303-305`) returns `undefined` because
  `#configurationSurfaceHost` only exists inside the `@else` (workspace-open, 3-panel) branch
  (`electron-shell.component.ts:239-245`); branch 2's bare-outlet markup (`:210-211`) has no equivalent element.
  `host` is captured into the `queueMicrotask` closure *before* the remount call and is never re-read
  (`:332`, `:336-340`), so even if the branch flips to 3 by the time the microtask fires, focus is never restored —
  `host?.focus()` is a permanent no-op for that invocation.
- Evidence: `electron-shell.component.ts:327-341` (effect body and closure capture), `:239-241` (`#configurationSurfaceHost` only in the `@else` branch), `:210-211` (branch 2 has no host element).
- Current handling: none — the closure silently no-ops via optional chaining.
- Recommendation: either (a) add an explicit code comment plus a regression test pinning the invariant this relies
  on — that `AppStateManager.switchWorkspace`'s stay-branch tick bump and `ElectronLayoutService`'s
  `workspaceInfo` update are guaranteed synchronous and land in the same Angular change-detection pass, so
  `configurationSurfaceHost()` is always resolved by the time the effect runs for the one transition
  (RB, "first folder while a surface is open") where this could matter — or (b) make the no-op observable (a dev
  console warning when `host` is `undefined` but a focus-restore condition was true), so a future change that
  breaks the synchronous-ordering assumption fails loudly instead of just leaving focus on `body`.
- Note on reachability: I could not find a path where `AppStateManager.switchWorkspace`'s stay-branch fires while
  `hasWorkspaceFolders()` remains `false` *after* the call (every reachable stay-branch trigger is either a
  switch between two already-open workspaces, which keeps `hasWorkspaceFolders()` `true` throughout, or the
  RB "opening the first folder" transition, where `batches.md` records that `ElectronLayoutService` sets
  `workspaceInfo` synchronously right after `appState.switchWorkspace` returns). Given that, this is very likely
  unreachable today, which is why I score it Moderate rather than Serious/Blocking — but the invariant that makes
  it unreachable is enforced by *timing coincidence between two separately-owned services*, not by any type,
  assertion, or comment in `electron-shell.component.ts` itself, and `electron-shell.config-gate.spec.ts` case 6
  (the one test that exercises exactly this 2→3 flip, `:233-242`) asserts "no throw" and DOM shape but makes no
  focus assertion at all.

### 2. Bare-outlet branch is asserted structurally, not behaviourally, in this batch's own tests

- Trigger: none — this is a coverage gap, not a runtime trigger.
- Symptom: a regression that broke `RouterOutlet` activation (for example, a future route-config change that
  orphans the bare-outlet's route) would not be caught by `electron-shell.config-gate.spec.ts`, because
  `provideRouter([])` never gives the outlet a route to activate in the first place.
- Evidence: `electron-shell.config-gate.spec.ts:129`, `:107-114` (`expectBareOutlet` checks element count and
  directive presence only).
- Current handling: the real activation proof is Batch 2's `surface-router.service.spec.ts` (already reviewed,
  ACCEPT WITH FIXES 8/10) plus the Batch 4 manual-QA checklist item ("open the first folder while on a
  configuration surface") carried to the orchestrator/QA in batches.md.
- Recommendation: none required for this batch — flagging so the manual-QA carry-forward is not lost, and so a
  later reviewer does not assume the gate spec already proves end-to-end route activation.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- MODERATE — Failure mode 1 above (`electron-shell.component.ts:327-341`).
- MODERATE — Failure mode 2 above (`electron-shell.config-gate.spec.ts:107-114`), informational/coverage-boundary.
- MINOR — `batch-4-report.md:160` ("Open issues") already discloses that the harness e2e PASS ran against a stale
  prebuilt `main.js` (older than this edit), so that PASS is a regression baseline, not proof this batch's shell
  renders correctly in the harness. This is the implementer's own transparent disclosure, and the task brief says
  the orchestrator is re-running against a fresh worktree build — noting it here only so the internal review
  record does not imply that gap was independently re-verified by this review (it was not; I did not run the
  harness myself per instructions).

## Data flow

1. `AppStateManager.switchWorkspace` (Batch 1, `app-state.service.ts:789-850`) detects the stay-branch
   (`isConfigurationSurface(currentView())`), bumps `_configurationSurfaceRemountTick`, returns — OK, unchanged by
   this batch, already reviewed.
2. `ElectronShellComponent`'s constructor effect (`:327-342`) reads the tick as its only tracked dependency — OK,
   confirmed by code read (all other reads are inside `untracked`).
3. Tick `0` short-circuits — OK (`:329`).
4. Inside `untracked`: `pendingSurface()` gate (`:331`) — OK, matches binding rule 1 and is pinned by config-gate
   spec case 11 (`:298-309`).
5. Focus state captured (`host`, `active`, `wasInside`) before the remount call (`:332-334`) — OK, capture-before-
   mutate ordering is correct.
6. `surfaceRouter.remountActiveSurface()` called (`:335`) — OK, delegates to Batch 2's reviewed implementation;
   deactivate/activateWith ordering is Batch 2's concern, not re-litigated here.
7. `queueMicrotask` focus restore (`:336-340`) — gap: see Failure mode 1; the `host` reference is fixed at step 5
   and never re-queried, so a branch flip that lands between steps 5 and the microtask's execution is invisible to
   this logic.
8. Template gate (`:121, :205-212`) renders exactly one of welcome / bare outlet / 3-panel — OK, `@if`/`@else if`/
   `@else` is structurally exclusive; confirmed no other branch can coexist.
9. Menu and back-button placement in the always-rendered navbar row (`:179-201`), independent of the content gate
   — OK, satisfies task-description criterion 4 (menu sits above the `@if (!hasWorkspaceFolders())` gate).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Tab row: Chat, [Apps slot], Tasks, Tribunal, Analytics, in order (criteria 9, 10) | COMPLETE | None — confirmed on disk and by `electron-tabs`/`tablist` external selector still matching `activity-ticker.e2e.spec.ts:126`. |
| Chat tab behaviour unchanged (criterion 11) | COMPLETE | `onCanvasTab()` unchanged (`:375-378`). |
| Tab row roles/gate unchanged (criterion 13) | COMPLETE | `role="tablist"`, `role="tab"`, `aria-selected`, `:122` gate all present. |
| Menu mounted left of theme toggle in no-drag cluster (criterion 8, binding rule 6) | COMPLETE | `:198-199`. |
| Menu renders above the content gate (criterion 4) | COMPLETE | Navbar row (`:98-202`) is unconditional; content gate is a separate `@if` block starting `:205`. |
| Back-to-welcome button contract (criterion 5) | COMPLETE | `:184-197`, pinned by config-gate case 5. |
| Three-branch gate, mutually exclusive, one outlet at a time | COMPLETE | `@if`/`@else if`/`@else` structure, pinned by cases 1-3, 6-8. |
| Remount effect: tick-only dependency, skip 0, skip pending, capture-before-remount, conditional focus (Task 4.1) | PARTIAL | Focus-recovery closure has a latent gap under one specific (very likely unreachable, but untested) interleaving — Failure mode 1. |
| No removed-handler leftovers, no unused icon imports | COMPLETE | Grep across `libs/frontend/chat/src` found `openThoth`/`openSetupHub`/`openMarketplace`/`openSettings` only in the unrelated, untouched `app-shell.component.ts`. |
| Guards: no `[class.hidden]`/`retain:true` added, no edits to `app-shell.*`/`app.routes.ts`/`webview-surface.types.ts`, no `as any`/`@ts-ignore` | COMPLETE | Confirmed by targeted `git diff` and grep. |
| Activity-placement spec re-pin (override 4) | COMPLETE | No tab-count assertion added; three pre-existing cases unchanged; new stubs match override 4's wording exactly. |
| Config-gate spec, cases 1-11 (Task 4.3) | COMPLETE | All eleven cases present and each asserts a falsifiable outcome (call counts, DOM absence/presence, `focus()` target) rather than a trivial truthy check. |
| VS Code path unaffected (criterion 19) | COMPLETE | `ElectronShellComponent` only reachable via `app.html:55` inside `@if (isElectron())`; `isElectron` is a signal set once from `vscodeService.isElectron` and never reassigned; VS Code renders `ptah-app-shell` directly. |

Implicit requirements not addressed: none beyond the two Moderate findings above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Tick 0 on first effect run | YES | Early return `:329`; also structurally unreachable to be nonzero at creation since the shell is mounted once, before any workspace switch (`isElectron`/`isReady` are set-once signals). | None. |
| Pending navigation during a tick bump | YES | `pendingSurface()` check inside `untracked`, pinned by case 11. | None. |
| 2→3 flip (first folder opened while on a surface) | PARTIAL | Case 6 proves no throw and correct DOM shape. | Does not assert focus behaviour for this exact transition — see Failure mode 1. |
| 3→2 flip (last workspace closed while on a surface) | YES | Case 7. | None. |
| Focus on `document.body` vs. a live control vs. inside the host | YES | Cases 10 (two sub-tests) using `fakeAsync`/`flushMicrotasks`. | Only exercised in the branch-3 (workspace-open) context, not branch-2 — consistent with Failure mode 1's scope. |
| Menu/back-button DOM placement and ordering | YES | Dedicated case 4, resolves the menu host from the public `data-test` trigger only (binding rule 8). | None. |
| Setup hub non-configuration settle with no workspace | YES | Case 8. | None. |
| Bare-outlet real route activation | NO (by design, deferred) | N/A | See Failure mode 2 — proof lives in Batch 2's spec plus carried-forward manual QA, not this batch. |

## Verdict

- Recommendation: APPROVE (findings are Moderate/informational, not blocking; both concern robustness/coverage at
  a boundary the code's own reasoning and the batch's risk register already treat as low-severity or
  out-of-scope, not a wrong answer on the happy or common failure paths).
- Confidence: HIGH on the wiring, guard compliance, and test-assertion quality; MEDIUM on Failure mode 1's
  practical reachability (I could not construct a concrete trigger given the synchronous-ordering guarantee
  batches.md documents between `AppStateManager.switchWorkspace` and `ElectronLayoutService.workspaceInfo`, but
  that guarantee is enforced by inter-service timing coincidence, not by anything in this batch's own code).
- Top risk: if a future change to `ElectronLayoutService` or `WorkspaceCoordinatorService` ever makes the
  `workspaceInfo` update asynchronous relative to the tick bump, focus-recovery after a remount would silently and
  permanently stop working for the branch-2→3 transition, with no test or log to surface it.
- What a robust implementation would add: (1) a regression test in `electron-shell.config-gate.spec.ts` case 6
  that also asserts focus behaviour across the 2→3 flip, not just DOM shape; (2) either a code comment on the
  effect documenting the synchronous-ordering dependency it relies on, or a dev-mode warning when the focus-restore
  conditions are true but `host` is `undefined`, so the assumption fails loudly instead of silently if it is ever
  broken by an unrelated change elsewhere in the stack.
