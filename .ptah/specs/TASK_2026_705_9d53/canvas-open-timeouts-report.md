# Canvas open timeouts — CodeRabbit follow-ups on PR #777

Branch `fix/canvas-open-timeouts`, worktree `.claude-worktrees/remove-single-layout`. No git run.

## FIX A (Major) — task-prompt bridge reported success on a 5 s timeout

### Files

- `libs/frontend/core/src/lib/services/app-state.service.ts:1300-1360` — `requestCanvasTab`
  takes a new trailing `options?: { timeoutMs?: number }` (line 1327). When `timeoutMs` is set
  (line 1345), a timer removes that exact request object from `_canvasTabRequests` if it is
  still queued and settles `false`. If the canvas has already drained it, the timer finds nothing
  and does nothing, and `settle` clears the timer on the first settle. Without `timeoutMs` there
  is no timer, so the request waits until the canvas mounts, as today. JSDoc updated.
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts` —
  `awaitCanvasTile` (the race) and the `'timeout'` success path are deleted. Line 97 now
  awaits `requestCanvasTab(tabId, workspacePath, name, undefined, { timeoutMs: 5000 })`.
  `true` links the task, prefills and reports success, as before. `false` with a changed
  workspace keeps the tab and reports `WORKSPACE_CHANGED_ERROR`, as before. `false` in the same
  workspace closes the tab and reports `CANVAS_NOT_OPENED_ERROR` (lines 17, 116). The `finally`
  block that runs a request arriving during the wait is unchanged.
- The other callers (workflow-tab-launcher, agent-session-adoption, harness-builder) are not
  changed and keep the unbounded wait.

### Tests

- `app-state.service.spec.ts:1827` — with `timeoutMs`, an undrained request is still pending at
  4999 ms. At 5000 ms it settles `false` and only that request is removed (a sibling request
  stays queued).
- `app-state.service.spec.ts:1858` — with `timeoutMs`, a drained request settled `true` stays
  `true` after 10 s, and the queue stays empty.
- `app-state.service.spec.ts:1880` — without `timeoutMs`, the request is still pending after
  60 s and still settles when it is drained late. The existing test "has no removal timeout"
  is kept.
- `task-prompt-bridge.service.spec.ts:248` — the timeout-success case is replaced by a
  timeout-failure case. The fake settles `false` at `options.timeoutMs`. The test checks: no
  prefill, no link, `closeTab('tab-undrained')`, a failure with the new message, and the request
  cleared. The three `toHaveBeenCalledWith` expectations now include `undefined,
  { timeoutMs: 5000 }`, and the cap test uses the new message.

## FIX B (Minor) — branch reported "Branch created." on the 10 s timeout

### Files

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1471-1512` —
  the `requestCanvasSession` promise is kept as `opening` (line 1471) and raced against the
  10 s timer as before. On `'timeout'` (line 1485) the component shows the info notice
  `'Branch created. It is still opening.'` and attaches a late handler to `opening`:
  - a late `false` or a rejection shows the existing error,
  - a late `true` shows nothing,
  - a trailing `.catch(() => undefined)` means a throwing handler cannot become an unhandled
    rejection.

  `opened === true` shows `'Branch created.'` and `false` shows the error. `_actionInFlight` is
  still cleared in `finally`, as before. The error text moved into a new
  `showBranchNotOpenedError()` helper (line 1515), which is used in three places.

### Tests (`chat-view.component.spec.ts`)

- `:1379` — the hung-load test now expects the still-opening notice and no `'Branch created.'`.
  The in-flight guard still clears.
- `:1411` — timeout, then a late `false`: the still-opening notice is shown, then the
  did-not-open error.
- `:1444` — timeout, then a late `true`: only the still-opening notice is shown, and
  `showInfo` is called once with no error.

## Verification

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2`
  → `Test Suites: 1 passed, 1 total` / `Tests: 143 passed, 143 total`.
- `npx jest -c libs/frontend/chat/jest.config.ts .../task-prompt-bridge.service.spec.ts .../chat-view.component.spec.ts --coverage=false --maxWorkers=2`
  → `Test Suites: 2 passed, 2 total` / `Tests: 100 passed, 100 total`. Jest also printed
  "A worker process has failed to exit gracefully". It was not investigated and may already
  exist in the chat-view suite.
- `ptah_get_diagnostics` reports no errors in the three changed source files. Errors in sibling
  spec files in other files already existed and were not touched.
- Project typecheck and lint were not run; they are left to the orchestrator.

## Decisions

- **Shape of the timeout option**: a trailing `options?: { timeoutMs?: number }` after `focus?`.
  The alternative was moving `focus` into an options object. Keeping `focus` positional leaves
  the other callers (agent-session-adoption passes `focus` positionally) and their specs
  unchanged. The cost is that the bridge passes `undefined` for `focus`. This is reversible.
- **The drain settles synchronously (confirmed)**: `orchestra-canvas.component.ts:456-477`
  calls `takeCanvasTabRequests()` (which empties the queue), and then, in the same loop, calls
  `adoptTab` (it returns a tile or `null`) and `req.resolve(...)`. Nothing is awaited, so a
  drained request is never in the queue when the timer fires.
- **Message for the not-drained case**: the outcome is one boolean, and telling a timeout
  from a cap refusal would mean changing the contract to a richer result, which is not cheap.
  One neutral message is used that is true for both: "The session did not open on the canvas.
  If the canvas is full, close a session and try again." This is reversible.
- **Late rejection on the branch path**: treated as "did not open" and shows the same error,
  since the fork exists on disk either way. A rejection before the timeout still propagates,
  as before.

## Fix round 1

This round answers `canvas-open-timeouts-review.md` (REVISE 6/10).

### 1. Canvas drain settles every request (Serious)

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:466-487`: each drained request
  now runs `adoptTab`/`focusTile` inside its own `try/catch`.
  - On a throw it logs `console.error('[OrchestraCanvas] Failed to adopt queued tab tile', message)`
    (line 477). This is the logging this component already uses at lines 365, 396 and 577.
  - It then settles from whether the tile exists: `true` if `adoptTab` returned an id (so a
    `focusTile` throw after a successful adopt still reports `true`), otherwise a
    `tiles().some(...)` check, otherwise `false`.
  - The loop always continues with the remaining requests.
  - The catch calls `.error(...)`, so the degradation audit does not flag it, and no suppression
    comment is needed.
- Spec `orchestra-canvas.component.spec.ts:510`: the first request's `adoptTab` throws and
  settles `false`. The second request is still adopted and focused, and settles `true`. The
  logged error is asserted, with `console.error` spied and restored.

### 2. Late branch failure is scoped and cannot replace a newer banner (Serious)

All changes are in `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`.

- `:1458`: `originTabId = this.resolvedTabId()` is captured when the branch starts. This is the
  same tab id the per-tile banner computeds filter on (`actionError`/`actionInfo`, lines
  319-339).
- `:349`: a new `_actionBannerGeneration` counter goes up in `showActionError`,
  `showActionInfo` and `showActionWarning`.
- `:1506`: on timeout, after the still-opening notice, the component records
  `{ generation, banner: actionBanner.banner() }`.
- `:1552` `showLateBranchError`: a late `false` or rejection shows the did-not-open error scoped
  to `originTabId`, but only when both of these hold:
  - no newer banner was shown by this view (the generation is unchanged), and
  - the shared single-slot banner is still empty or still holds the pending notice. This
    covers a banner from another tile, which the generation counter cannot see.

  Otherwise the error is suppressed.
- `:1519`: the trailing `.catch(() => undefined)` is replaced by
  `console.warn('[ChatView] Failed to report a late branch outcome:', error)`, the same pattern as
  this file's line 1192. A banner-service error is no longer dropped silently, and the audit
  line for this file is gone.
- `:1540`: `showBranchNotOpenedError(tabId = null)`. The immediate (before-timeout) `false`
  path stays global, as before.

### 3. Specs (Moderate)

All in `chat-view.component.spec.ts`.

- `:1411`: the existing timeout-then-late-`false` test now asserts the error is scoped to
  `'tab-abc'`, the originating tab.
- `:1445` (new, real `ActionBannerService`): timeout, then a late rejection. The banner moves
  from the global still-opening notice to
  `{ kind: 'error', message: 'Branch created, but it did not open…', tabId: 'tab-abc' }`.
- `:1480` (new, real banner): timeout, then a newer branch succeeds and shows
  `{ kind: 'info', 'Branch created.', tabId: null }`, then a late `false`. The banner is still
  the identical newer object and `actionError()` is `null`.
- A second mounted tile was not added. In tile mode `resolvedSessionId` needs a matching tab in
  `tabs()`, and the harness stub does not provide one. The other-tile case is covered by the
  shared-slot identity check in `showLateBranchError`.

### Verification (round 1)

- `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2`
  → `Test Suites: 1 passed, 1 total` / `Tests: 33 passed, 33 total`.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2`
  → `Test Suites: 1 passed, 1 total` / `Tests: 89 passed, 89 total`.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | grep -E "frontend/(canvas|chat|core):|TOTAL"`
  - Before this round: `libs/frontend/chat: 10 ok (baseline 11)`, with the old `.catch` listed as
    `chat-view.component.ts:1490 [promise-catch-sentinel]`, and `TOTAL 292`.
  - After: `libs/frontend/chat: 9 ok (baseline 11)` and `degradation-audit: TOTAL 291
    unsuppressed site(s)`.
  - The audit printed no `frontend/canvas` or `frontend/core` line in either run, so it reported
    no sites in those projects.
  - No project is over its baseline.
- `ptah_get_diagnostics` on the two changed source files did not finish its TypeScript check
  (still running after 45 s, twice), so it was not available for this round. Project typecheck
  is left to the orchestrator.

### Decisions (round 1)

- **Where the late-banner guard lives**: a component-level generation counter plus an identity
  check on the shared banner. The alternative was a generation counter on `ActionBannerService`.
  The chosen form leaves the shared service and its jest stub (used by about 89 tests)
  unchanged, while still covering newer banners from this view (the counter) and from other
  tiles (the shared-slot identity check). This is reversible.
- **Logging instead of a suppression comment**: both catches log through the console pattern
  their file already uses, rather than an intentional swallow with a `// degradation-audit:`
  marker, because the failure is worth seeing in the log.
