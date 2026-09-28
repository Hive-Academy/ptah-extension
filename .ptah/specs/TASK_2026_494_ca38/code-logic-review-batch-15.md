# Code Logic Review — `TASK_2026_494` Batch 15

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2                                    |

Scope examined: `apps-page.component.ts` (+spec), `apps-surface-panel.component.ts` (+spec),
`apps-transcript.component.ts`, `index.ts`, `apps-session.service.ts` (the added
`setSurfaceViewState`/`activateSurface`/`patchActiveSurfaces`), `apps-surface-reducer.ts` (the
added `setSurfaceViewState`/`activateSurface`), `dashboard-chart.component.ts` (+spec),
`surface-layout.component.ts` (+spec). Also traced into unmodified files the new code calls
into or depends on for correctness: `apps-surface-operations.service.ts`, `apps-surface-lanes.ts`,
`apps-submit-flow.ts`, `apps-focus-memory.directive.ts`, `surface-renderer.component.ts`,
`apps-workspace-slice.ts`. Ran `apps-page.component.spec.ts` and
`apps-surface-panel.component.spec.ts` (22/22 pass), `trust-boundary.spec.ts`,
`dashboard-chart.component.spec.ts`, `surface-layout.component.spec.ts` (37/37 pass), and both
`tsconfig.spec.json` `--noEmit` checks against the current worktree state.

## Five logic questions

### 1. How does this fail silently?

- No B15-introduced silent-success case was found. `AppsSessionService` and
  `AppsSurfaceOperations` methods are documented as "never throw," and every catch block sets
  `error`/logs a `console.warn` rather than reporting success — verified in
  `apps-session.service.ts:255-269, 355-362` and `apps-surface-operations.service.ts:199-201,
  225-227, 236-238`.
- One near-miss, not a defect: `appsFallbackText` (`apps-surface-panel.component.ts:100-121`)
  catches a throwing `renderSurfaceText`/`renderDashboardSpecText` and substitutes a generic
  "its text could not be produced either" line. This is a deliberate, visible degradation (Req
  3.6), not a silent one — the user still sees an error state, just a less specific one.

### 2. What user action produces unexpected behaviour?

- Switching between **two independently render-failed surfaces** re-invokes the view-model
  builder on every switch back, instead of reusing the already-known failure — see Failure
  mode 1 below.
- Typing a **new second-turn message inside the narrow window** between clicking Send and the
  liveness registry marking the session `streaming` can pass `canSend()` — see Failure mode 2
  below. This is pre-existing `AppsSessionService` logic, not part of this batch's diff, but
  `AppsPageComponent.canSend()` (`apps-page.component.ts:214-216`) is the first UI surface that
  exercises it, so it is reported here for awareness rather than scored against this batch.

### 3. What input data produces a wrong answer?

- `readLastSubmit` (`apps-surface-panel.component.ts:67-79`) and `appsSurfaceTitle`
  (`:82-92`) both fail closed on malformed host data (non-object, wrong status literal,
  non-finite/negative `submittedAt`, non-string/blank title) — confirmed by panel spec
  `:340-357` (8 malformed shapes) and `:359-382`.
- `appsFallbackText` never throws on a malformed `renderable.content` (try/catch around both
  text builders), so a wrong or missing reason string is the worst case, not a crash.
- No case was found where the merged transcript (`apps-transcript.component.ts:155-181`)
  produces a wrong *order*: `at` is `Date.now()` for both user and submitted bubbles and
  `node.startTime ?? 0` for nodes, and ties resolve to the user bubble
  (`rank()` at `:43-45`). A node whose `startTime` is `undefined` sorts to `0` (the epoch),
  which would show it before every real bubble if it ever occurs in production, but the
  synthetic `NODE.startTime = Number.MAX_SAFE_INTEGER` used in the page spec (`:149-156`)
  actively avoids this path, so it is untested. This is an edge worth a one-line pin, not
  severe enough to list as a standalone finding given `ExecutionNode.startTime` is set
  upstream by the streaming pipeline in every real path this batch depends on.

### 4. What happens when a dependency fails?

- `ExecutionTreeBuilderService.buildTree` — called only when `streamingState.events.size > 0`
  and `surfaceId !== null` (`apps-transcript.component.ts:148-153`); no guard against
  `buildTree` throwing, but it is a pure, non-DI builder in every existing caller, consistent
  with the harness precedent this batch follows.
- `AppsSurfaceOperations.interaction()` — falls back to `NO_INTERACTION`
  (`apps-surface-panel.component.ts:46-53, 325-330`) when there is no active entry, so the
  renderer never receives `undefined`.
- `SURFACE_VIEW_MODEL_BUILDER` throwing — routed through the *same* `renderFailed` output as a
  structurally-invalid build (`surface-renderer.component.ts:109-124, 264-267`), confirmed
  identical by the `it.each` pin at `apps-page.component.spec.ts:507-548` and panel spec
  `:305-318`. This directly satisfies the B6 carry-over.
- RPC failure paths (`chat:start`, `chat:continue`, `chat:abort`) all resolve to `error` being
  set and the draft being restored, never to a silently-swallowed failure — traced in
  `apps-session.service.ts:214-270, 276-323, 330-363` and pinned at page spec `:394-429`.

### 5. What is missing that the requirements never mentioned?

- No guard exists for two surfaces failing to render *at the same time* — see Failure mode 1.
  The plan and the batch-15 report describe a single "the panel does not pre-build" invariant
  that assumes at most one currently-failed renderable; nothing in the requirements anticipates
  more than one.
- No dedupe between a "Submitted: {label}" bubble (`AppsSurfaceOperations.submittedBubbles`)
  and a later user-typed turn describing the same action — this is pre-existing B13 behaviour
  the transcript merely consumes (`apps-transcript.component.ts:164-171`); the review focus
  item asking about it does not point at a real requirement gap in B15's own code, since the two
  bubble kinds are semantically different (host-initiated vs. user-initiated) and never
  represent the same event.

## Failure modes

### 1. `failedRenderable` is a single slot, not keyed by surface

- Trigger: two different surfaces both reach `renderFailed` (e.g., two `SURFACE_VIEW_MODEL_BUILDER`
  failures, or two structurally-invalid v2 documents), then the user switches from surface A to
  surface B and back to A.
- Symptom: switching back to A re-mounts `<ptah-surface-renderer>` for A
  (`@for (id of [entry.surfaceId]; track id)`, `apps-surface-panel.component.ts:227-238`) and
  re-invokes `attemptBuild` (`surface-renderer.component.ts:109, 217-219`), because `fallback()`
  only compares the *active* entry's content against the single `failedRenderable()` value
  (`apps-surface-panel.component.ts:316-322`), which by then holds B's content, not A's. This
  contradicts the batch-15 report's own Decision 3 ("switching back to a surface that failed
  shows its fallback without mounting the renderer again... the model is not built twice").
  Angular flushes the constructor `effect()` that re-reports `renderFailed`
  (`surface-renderer.component.ts:264-267`) synchronously within the same
  `detectChanges()`/`tick()` pass in tests, so no failing assertion was produced by the existing
  suite and there is no cross-task-boundary flicker risk in a zoneless app — but the rebuild is
  real, unnecessary work, and the invariant documented as guaranteed is not actually true for
  this two-failure case.
- Evidence: `apps-surface-panel.component.ts:283` (single `signal<SurfaceRenderable | null>`),
  `:316-322` (`fallback` computed), `surface-renderer.component.ts:109-124, 217-219, 264-267`.
- Current handling: none; no spec exercises two concurrently-failed surfaces (the switcher pins
  at panel spec `:166-218` and `:195-218` use only accepted content; the render-failure pins at
  page spec `:507-548` and panel spec `:305-318` use exactly one failing surface).
- Recommendation: key the failure record by `surfaceId` (a `ReadonlyMap<string,
  SurfaceRenderable>`) instead of a single signal, or gate `fallback()` on `entry.surfaceId`
  rather than content identity, and add a spec pin with two independently-failing surfaces
  switched back and forth.

### 2. `isProcessing()` ignores `turnPending` once a session id exists

- Trigger: the user sends a **second or later** turn (the conversation's session id is already
  resolved), then types new text and presses Enter/Send again before
  `SessionLivenessRegistry.statuses()` reports `'streaming'`/`'awaiting-background'` for that
  session.
- Symptom: `AppsPageComponent.canSend()` (`apps-page.component.ts:214-216`) can be `true` again
  during that window — the draft-clear on the first send blocks a bare re-click (the box is
  empty), but a freshly typed message does not, so a duplicate `chat:continue` could fire while
  the first is still in flight.
- Evidence: `apps-session.service.ts:177-184` (`isProcessing` reads `liveness.statuses()`
  exclusively once `sessionId !== null`, never falling back to `slice.turnPending`, even though
  `send()` sets `turnPending: true` synchronously at `:294-299` for exactly this case).
- Current handling: `send()` has no re-entrancy guard of its own (no `if (slice.turnPending)
  return;` at the top of `apps-session.service.ts:276`).
- Recommendation: this is pre-existing service logic outside this batch's file list (not part
  of the B15 diff), so it is reported for awareness rather than scored against B15. If the
  coordinator wants it fixed in this pass, the smallest change is having `isProcessing()` OR
  a check `slice.turnPending` regardless of whether `sessionId` is resolved.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate — Failure mode 1 (`apps-surface-panel.component.ts:283, 316-322`): single-slot
  render-failure tracking does not scale to two concurrently-failed surfaces; contradicts the
  report's own Decision 3. No spec pin covers it.
- Moderate — Failure mode 2 (`apps-session.service.ts:177-184`): pre-existing gap, first
  exercised by this batch's composer; narrow timing window, reported for awareness.
- Minor — required pre-commit fix still outstanding: the coordinator ruling
  (`batches.md:798-804`) requires the 4 "own" `tsconfig.spec.json` errors fixed before B15
  commits. Re-running `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`
  against the current worktree confirms all 4 are **still present**, unchanged from the
  batch-15 report:
  - `apps-submit-flow.spec.ts:333`, `apps-surface-lanes.spec.ts:149`,
    `apps-surface-sync.spec.ts:319` — `'INTERNAL_ERROR'` is not an `RpcUserErrorCode`.
  - `apps-surface-reducer.spec.ts:229` — `.surface` is accessed on a `SurfaceContent` value
    typed as the v1 variant (`{ contract: 'dashboard-spec/1'; spec: ... }`), which has no
    `surface` field. Read the surrounding test (`apps-surface-reducer.spec.ts:225-239`): this is
    a test-narrowing gap (`content()`'s return type is too wide at that call site), not a
    production logic defect — `content()` is only ever used there to build a v2 document.
  - The 8 baseline `mock-rpc-service.ts`/`monaco-loader.service.ts` TS2352 errors are unchanged
    and correctly out of scope per the coordinator's baseline ruling.
- Minor — `apps-transcript.component.ts:175`: a node with `startTime === undefined` sorts to
  epoch `0`, ahead of every bubble. Untested and not observed to occur on any real path this
  batch depends on (`ExecutionNode.startTime` is populated upstream); worth a one-line
  defensive pin, not a functional defect today.

## Data flow

1. User types in the composer → `onDraftInput` sets the local `draft` signal
   (`apps-page.component.ts:218-221`). OK — local, uncommitted, matches Decision 2.
2. Send → `AppsPageComponent.send()` clears the draft, awaits `AppsSessionService.send`/`start`,
   restores the draft only if an error is set and nothing new was typed
   (`:235-243`). OK — pinned at page spec `:394-429`.
3. `chat:start`/`chat:continue` result → `AppsSessionService` patches the owned slice only
   (`patchOwned`, guards against a `discard()`/removal racing the await) — OK, traced through
   `apps-session.service.ts:214-323`.
4. Agent surface push → `SurfaceUpdateInbox` → `AppsSurfaceSync` → reducer
   (`applySurfacePush`/`applySnapshot`) → `session.surfaces()` signal → `AppsSurfacePanelComponent`
   computeds (`activeEntry`, `renderable`, `tabs`) → template. OK, `origin === 'agent'` always
   takes over `activeSurfaceId` (`apps-surface-reducer.ts:210-213`), a `ui`-origin write does
   not (pinned at panel spec `:195-218`).
5. Renderer emits `viewStateChange` → `storeViewState` → `session.setSurfaceViewState` →
   `patchActiveSurfaces` → reducer's `setSurfaceViewState` stores the object verbatim, no
   age/echo check (`apps-surface-reducer.ts:455-465`) → flows back to `entry.viewState` →
   renderer's `[viewState]` input. OK — synchronous and verbatim, pinned at page spec `:550-577`
   and panel spec `:320-337`; independently confirmed no other write path touches `viewState`
   except `applySnapshot`'s intentional reset on an agent replace.
6. Every `session.surfaces()` write (including a viewState write) also changes the signal
   `AppsSurfaceOperations`'s constructor `effect()` depends on, re-running `reconcile()`
   (`apps-surface-operations.service.ts:124-130, 258-278`) on every keystroke. OK — traced into
   `pump()` (`apps-surface-lanes.ts:354-384`) and `advance()`
   (`apps-submit-flow.ts:380-392`), both no-op/return-early when nothing is queued or active, so
   the re-run sends nothing and does not disturb lanes, overlays or the echo wait, matching the
   report's own claim and the zero-RPC pin (page spec `:634-692`).
7. Render failure → `markRenderFailed` (single slot) → `fallback()` computed → mono block
   replaces the renderer subtree, transcript/composer untouched. OK for one failing surface at a
   time (Failure mode 1 is the gap for the two-surface case).
8. Destroy/re-create → state lives in root-provided `AppsSessionService`/`AppsSurfaceOperations`,
   so nothing is lost; focus is restored by `AppsFocusMemoryDirective`'s `afterNextRender` hook
   reading `session.lastFocusKey()`. OK, pinned at page spec `:579-632`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| B8 fix 1: viewState stored verbatim, synchronous, never older | COMPLETE | None found |
| Reconcile side effect on every keystroke is safe/bounded | COMPLETE | None found |
| `interaction` bound via computed | COMPLETE | None found |
| No innerHTML/bypassSecurityTrust/DomSanitizer; markdown via chat lib | COMPLETE | Confirmed `ExecutionNodeComponent` renders through `ngx-markdown`'s `<markdown>` + `@ptah-extension/markdown`'s `SurfaceMarkdownPipe`; `trust-boundary.spec.ts` passes fresh |
| `submittedBubbles` shown, ordered, deduped | PARTIAL | Shown and ordered by `at`; no dedup mechanism exists or is needed against typed bubbles (different kind of event); see Q5 |
| `AppsFocusMemoryDirective` on page host; restore pinned | COMPLETE | None found |
| `lastSubmit` validated before render | COMPLETE | None found |
| Render-failure fallback identical for throw vs. `renderFailed` | COMPLETE for one surface | Diverges for two concurrently-failed surfaces (Failure mode 1) |
| Prompt filter, tablist switcher, zero-RPC, snapshot vs. user pick, destroy/re-create, empty state, eviction notice | COMPLETE | None found; all re-verified by a fresh test run |
| Coordinator-required 4 spec-tsc fixes before commit | MISSING | Still present in the current worktree; not yet fixed |

Implicit requirements not addressed: multi-surface concurrent render failure (Failure mode 1).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Malformed `lastSubmit` shapes | YES | `readLastSubmit` fails closed | None |
| Rejected content | YES | Mono fallback, no renderer | None |
| One renderer-throw / one `renderFailed` | YES | Same output, same fallback | None |
| Two concurrently-failed surfaces | NO | Single-slot `failedRenderable` | Rebuild on every switch-back; contradicts documented invariant |
| Destroy/re-create mid-session | YES | Root-provided services, focus directive | None |
| Zero surfaces after eviction, notice still shown | YES (by design) | Notice branch takes priority over empty state | Matches report's documented intent; not independently pinned for the "zero surfaces left" sub-case |
| Rapid second-turn double-send | PARTIAL | Draft-clear blocks a bare re-click | `isProcessing()` ignores `turnPending` post-resolve; pre-existing, narrow window |
| Zero RPC/postMessage on sort/filter/page/Expand | YES | Verified with a fresh spec run | None |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the coordinator's own pre-commit gate (4 spec-tsc errors) is unmet as of this
  review; the code itself is sound but this batch cannot commit as specified until that is
  closed, and the two moderate findings (single-slot render-failure tracking, `isProcessing`
  timing gap) should at minimum be triaged before sign-off.
- What a robust implementation would add: (1) key `failedRenderable` by `surfaceId`; (2) a spec
  pin with two independently-failing surfaces switched back and forth; (3) have `isProcessing()`
  also honour `turnPending` after a session id resolves, or add a re-entrancy guard at the top of
  `AppsSessionService.send()`; (4) fix the 4 outstanding spec-tsc errors per the coordinator's
  bounded test-only fix instruction.

## Exact fix list

1. `libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.ts:283, 316-322`
   — key the render-failure record by `surfaceId` instead of a single `SurfaceRenderable` slot;
   add a panel-spec pin with two failing surfaces.
2. `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:177-184` (pre-existing,
   report only unless the coordinator wants it in this batch) — have `isProcessing()` also check
   `slice.turnPending` once a session id is resolved, or guard re-entrancy at the top of `send()`.
3. `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts:333`,
   `apps-surface-lanes.spec.ts:149`, `apps-surface-sync.spec.ts:319` — replace the literal
   `'INTERNAL_ERROR'` with a value assignable to `RpcUserErrorCode`.
4. `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts:229` — narrow
   `content()`'s return type (or cast at the call site) so `.surface` is valid on the v2 branch
   used there.

## Carry-overs for B20 / B16 / visual review

- B20 (splitter): the page's `.apps-split-handle-slot` (`apps-page.component.ts:194-198`) and
  the `--apps-conversation-width` grid variable (`:63-69`) are present and unclaimed by any
  other logic; no B15 code writes to them, so B20 has a clean seam. Nothing new to add beyond
  the batch-15 report's own B20 notes.
- B16: none observed beyond what the report already lists.
- Visual review: confirm the eviction-notice-alone layout (no surfaces left) does not leave an
  orphaned focus target, and confirm the two-failed-surfaces case (Failure mode 1) does not
  produce a visible flash in a real browser (Angular's effect flush timing was only checked
  under Jest/TestBed here, not a real browser paint cycle).

## One-line summary

B15's own logic (view-state write-back, reconcile side effect, interaction binding, markdown
boundary, focus restore, `lastSubmit` validation, render-failure fallback, switcher/eviction
pins) is correct and well-tested; the batch needs REVISION only because the coordinator's
required spec-tsc fixes are still outstanding and because a single-slot render-failure tracker
does not hold for two concurrently-failed surfaces.
