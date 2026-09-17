# Batch 14 Codex Report — TASK_2026_453_1eb4

## Verdict

Batch 14 harness work is implemented and the static gates pass, but Task 14.2 is **BLOCKED by a product defect**: prepending at `scrollTop === 0` did not preserve the previously top-visible message. The measured viewport-offset delta was 7,038 px in the full headed run and 5,212 px in a targeted confirmation, against the <= 2 px criterion. Per the batch scope, no product scroll code was patched.

The pinned-prepend/U1 case passed after correcting the test's non-scrollable precondition: distance from bottom was **0.00 px**, within the <= 120 px limit. Stale-cursor UX and legacy no-`historyPage` compatibility also passed.

## Task 14.1 acceptance checklist

- [x] **AC 1 — paging-faithful mock.** `perf-session-fixture.ts:238-285` precomputes the tail with `HISTORY_TAIL_PAGE_EVENTS` and the complete cursor-keyed older chain with `HISTORY_PAGE_DEFAULT_EVENTS`, calling shared `selectHistoryPage` and `encodeHistoryCursor`. `chat:resume` selects the serialized tail only when `params.historyPage` exists and otherwise returns the full events with no `historyPage` key (`:325-344`). `chat:history-page` looks up known cursors and carries the exact unknown-cursor failure fields `error: 'Session history changed'` and `errorCode: 'HISTORY_CURSOR_STALE'` (`:344`). The marker is emitted in the final turn (`:91-98`), therefore remains in the tail.
- [x] **AC 2 — paging diagnostics and unusable guard.** `tile-open-longtask-budget.perf.spec.ts:193-218` reads observed `chat:resume` calls per session, records `requestedMaxEvents` plus the precomputed tail event count, and throws `measurement unusable` if a tile omitted `historyPage`. Every diagnostics writer includes `paging` (`:388-389`, `:461-462`, `:542-543`, `:632-633`).
- [x] **AC 3 — skip proof.** With `PTAH_PERF_SPECS` absent, Playwright printed `Running 4 tests using 1 worker` and `4 skipped`. No perf test body ran and `PTAH_PERF_SPECS` was never set.
- [x] **AC 4 — B6 per-tile DOM sampling.** `PerTileDomSample` and `OpenTilesResult` fields are at `perf-page-capture.ts:16-35`. Each marker is resolved to its owning canvas tile and the count is scoped to that tile's `ptah-chat-transcript` root (`:232-257`); a missing tile/root becomes `measurementError`, never zero. Replaying and settled samples are carried at `:263-303`. JSON fields `domReplaying`, `domSettled`, and `ratio` are built at `tile-open-longtask-budget.perf.spec.ts:221-239` and used by every scenario.
- [x] **AC 4 measurement-window option — sampler cost shown excluded from the long-task sum.** Chosen option: **inside the settle-inclusive window, in its own macrotask, with a measured threshold guard**. The replay sampler is scheduled by `setTimeout(..., 0)` (`perf-page-capture.ts:352-365`), total replay+settled sampler duration is recorded, and a duration >= 50 ms makes the measurement unusable (`:276-280`). Therefore sampler work cannot silently qualify as a PerformanceObserver long task included in a valid run. Whole-canvas fields remain unchanged for M1 comparison.
- [x] **AC 5 — B8 trace startup hardening.** `startTraceCapture` wraps CDP session creation/listener setup/`Tracing.start` in `try/catch (error: unknown)` (`perf-page-capture.ts:139-172`), detaches an already-created session, narrows the message, logs one warning, and returns `null`. **B8 error shape chosen: return `null`**, matching the existing diagnostic caller/capture helper's nullable shape. `stopTraceCapture` is unchanged; the budget-gating test still hard-sets `traceCapture = null`.
- [x] **AC 6 — B7 conditional decision.** No new export was added to `perf-measurement-report.ts`; it still has **8 function exports** (`resolvePerfOutputDirectory`, `writeDiagnostics`, `writeCpuProfile`, `summarizeMeasurement`, `logMeasurementBuckets`, `assertUsableMeasurement`, `assertScrollSanity`, `captureOptionalDiagnostics`). The conditional split did not apply, so `perf-scroll-sanity.ts` was not created.

## Task 14.2 acceptance checklist

- [ ] **AC 1 — prepend and viewport anchor. BLOCKING PRODUCT DEFECT.** The headed full run measured **7,038.00 px** at `scrollTop=0`; a targeted confirmation measured **5,212.00 px**. Both exceed <= 2 px. The test marks the pre-existing top-visible slot and reads the same element after prepend (`tile-load-older-history.spec.ts:77-143`). The history-page call count was exactly one, the null cursor removed the button before measurement, and the duplicate-ID assertion (Angular component VM ids) passed in the targeted confirmation because it executes before the offset assertion (`:142-143`). No product code was changed.
- [x] **AC 2 — remaining functional cases.** No duplicate ids passed as above. The null-cursor button removal occurs at `:108-111`. The stale outer RPC response uses the exact message/code at `:25-57`, and the headed run passed the reopen guidance + hidden button test (`:146-161`). The legacy response omits `historyPage`, renders full history, shows no button, and makes zero page calls (`:163-181`); it passed.
- [x] **AC 3 — pinned prepend / V5 / U1 evidence.** A sparse two-turn, event-heavy fixture is defined at `perf-session-fixture.ts:180-235`. The spec enlarges the visible window solely to satisfy the non-scrollable precondition (`tile-load-older-history.spec.ts:183-216`), clicks while pinned, waits for 1,000 ms mutation quiet, and asserts <= 120 px (`:218-258`). Targeted headed result: **1 passed**, `pinned-prepend distance-from-bottom=0.00px`. This does **not** trigger U1.
- [x] **AC 4 — no auto-load on open.** The headed tests assert zero `chat:history-page` calls before any scroll/click at `tile-load-older-history.spec.ts:74-75` and `:199-200`; these assertions passed.
- [x] **AC 5 — headed run.** Full spec command used `--headed` and a visible Electron window after an idle count of 0. Result: **2 passed, 2 failed** in 1.1 minutes. One failure was the AC 1 product defect; the other was a test precondition (the initial sparse fixture overflowed by 38 px). After correcting only the visible-window setup, the pinned test was run headed and passed 1/1. A targeted headed anchor confirmation remained failed with 5,212 px.

## Files changed

- `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts`
- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts`
- `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts`
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
- `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts` (created)
- `apps/ptah-electron-e2e/CLAUDE.md` — shared-pager mock note at line 20
- `.ptah/specs/TASK_2026_453_1eb4/b14-codex-report.md` (this report)

No product code, project configuration, Jest project, scroll method, transcript CSS, `content-visibility`, or `ALLOWED_METHOD_PREFIXES` file changed. `git diff --check` passed.

## Verification output

1. `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`
   - Literal summary: `NX   Successfully ran target typecheck for project ptah-electron-e2e`
   - Ptah targeted diagnostics after edits: `Errors: 0 | Warnings: 0 — No issues found.`
2. `npx nx run-many -t lint -p ptah-electron-e2e degradation-audit --parallel=1`
   - Literal summary: `NX   Successfully ran target lint for 2 projects`
   - e2e lint: `✖ 9 problems (0 errors, 9 warnings)`; all nine warnings are pre-existing and outside changed files.
   - Literal audit summary: `degradation-audit: TOTAL 303 unsuppressed site(s)`.
3. Skip proof without `PTAH_PERF_SPECS`:
   - Literal Playwright summary: `Running 4 tests using 1 worker` / `4 skipped`.
4. Functional headed run:
   - Literal Playwright summary: `2 failed`, `2 passed (1.1m)`.
   - Measured viewport-offset delta: `7038.00px (scrollTop=0)`; targeted confirmation `5212.00px`.
   - Corrected pinned-prepend targeted check: `1 passed (20.9s)`; measured distance from bottom `0.00px`.
5. `npx prettier --check` on all six changed source/doc files:
   - Literal summary: `All matched files use Prettier code style!`

## Node-runner isolation

- Before full headed functional run: `NODE_RUNNER_COUNT_BEFORE=0`.
- After full headed functional run: `NODE_RUNNER_COUNT_AFTER_FUNCTIONAL=0`.
- Before pinned targeted check: `NODE_RUNNER_COUNT_BEFORE_PINNED_CHECK=0`.
- After pinned targeted check: `NODE_RUNNER_COUNT_AFTER_PINNED_CHECK=0`.
- Before anchor targeted check: `NODE_RUNNER_COUNT_BEFORE_ANCHOR_CHECK=0`.
- Immediately after that Nx command, 7 transient `run-executor` cleanup processes were observed; the first re-check returned `NODE_RUNNER_RECHECK_0=0`. No Playwright run began with a nonzero count.

## Plan deviations

- The requested full functional spec was run once. Two targeted headed checks followed: one to validate the pinned case after fixing its test-only non-scrollable precondition, and one to ensure the duplicate-ID assertion executed before the known viewport assertion. Neither rerun changed product code or repeated a perf measurement.
- The stale-cursor test temporarily replaces the fake IPC listener for one `chat:history-page` call so the renderer receives a real outer RPC failure envelope; this is necessary because the shared `UiDriver.mockRpc` helper always wraps resolver values in `success: true`. The replacement restores the original listeners before responding.
- No perf run was performed, so per-tile DOM JSON population remains intentionally deferred to M2 as Batch 14 verification specifies.

## Blocking findings

1. **AC 14.2.1 product defect:** prepending at `scrollTop === 0` moves the previously top-visible message by thousands of pixels (7,038 px and 5,212 px observed). Required <= 2 px. This blocks Batch 14 completion. It is not the pinned/U1 case and was not patched because product code is out of scope.

## Out-of-scope observations

- Nx repeatedly printed `Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.` No action was taken.
- Nx emitted `MaxListenersExceededWarning` after Playwright commands; runs still completed and this was not the defined 0 ms worker-crash anomaly.
- The e2e lint target retains nine unrelated warnings in existing files; there are zero errors and no warning in a changed file.

## Anchor evidence (orchestrator request)

Both cases use the same 420-event `makeSessionFixture` path and the same top-visible `.chat-msg-slot` measurement helper (`tile-load-older-history.spec.ts:37-140`). The helper tags the first slot intersecting the viewport, dispatches the requested scroll position, clicks the load-earlier button, waits until DOM mutations have been quiet for 1,000 ms, and then measures that exact slot again. Both assertions retain the AC 14.2.1 limit of <= 2 px (`:193-215`).

| case                                  | scrollTop before | scrollTop after | scrollHeight before/after | prepended height | offset delta | pass/fail                   |
| ------------------------------------- | ---------------: | --------------: | ------------------------: | ---------------: | -----------: | --------------------------- |
| `scrollTop === 0` / button prepend    |          0.00 px |         0.00 px |   7,449.00 / 12,522.00 px |      5,073.00 px |  5,072.88 px | **FAIL** (required <= 2 px) |
| non-zero `scrollTop` / button prepend |        300.00 px |     5,609.00 px |   7,185.00 / 12,633.00 px |      5,448.00 px |      0.13 px | **PASS**                    |

- Runner isolation: `NODE_RUNNER_COUNT_BEFORE_ANCHOR_EVIDENCE=0`; `NODE_RUNNER_COUNT_AFTER_ANCHOR_EVIDENCE=0`.
- Command: `npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-load-older-history.spec.ts --reporter=list --headed`.
- Literal Playwright summary: `2 failed` / `3 passed (1.9m)`.
- The expected exact-top anchor assertion failed with `Expected: <= 2`, `Received: 5072.875`. The non-zero anchor case passed at 0.13 px.
- The same single run also produced an unrelated stale-cursor test timeout: the button's wrapper intercepted pointer events and the button detached while Playwright retried the click. This was not a 0 ms worker crash, and the run was not repeated per the orchestrator's one-run instruction. The legacy-history and pinned-prepend cases passed; pinned distance from bottom was 0.00 px.
- Formatting verification: `All matched files use Prettier code style!` for `tile-load-older-history.spec.ts`.
- Type verification: `NX   Successfully ran target typecheck for project ptah-electron-e2e`.

### Read-only root-cause note

The transcript stylesheet explicitly sets `overflow-anchor: auto` on `.chat-scroll-container` (`chat-transcript.component.css:23-31`). The component scroll handler records `scrollTop`, updates the pinned state, and cancels bottom-stick work when the user moves upward (`chat-transcript.component.ts:581-602`); `scheduleStickToBottom` adjusts only while `pinnedToBottom` is true (`:610-620`). There is no component-level calculation that adds the prepended height to `scrollTop`.

The observed split is therefore consistent with native browser scroll anchoring: from a non-zero offset, the browser raised `scrollTop` from 300.00 px to 5,609.00 px and preserved the selected message within 0.13 px; at the exact start boundary it left `scrollTop` at 0.00 px, so the selected message moved 5,072.88 px, effectively the full 5,073.00 px prepend. This confirms plan assumption A-ii-2 / risk R-ii-2 at the top boundary without changing product code.

## Round 2 (stale-cursor flake)

### Root cause and change

The intercept was a test artifact caused by the intended sentinel behavior, not a user-facing element overlap. The failed Playwright action log first reported the role-located button as visible, enabled, and stable, then reported `scrolling into view`, followed by the button's own `<div class="flex justify-center px-2 py-3">` wrapper intercepting pointer events and the button detaching. The transcript template places both the auto-load sentinel and the manual button on that wrapper. Playwright's automatic scroll moved the long transcript upward; that movement armed the sentinel, which issued the same history-page request and replaced the loading control before Playwright could finish its pointer action. The failure screenshot showed the transcript unobstructed, with no overlay covering its viewport.

`tile-load-older-history.spec.ts:192-210` now centralizes deterministic manual activation. It still resolves the control by accessible role within the tile and requires it to be visible, enabled, and `aria-busy="false"`; it then invokes the enabled `HTMLButtonElement.click()` before Playwright can auto-scroll and arm the sentinel. This is not `force: true`, does not click through an overlay, and preserves the stale-response assertions: the reopen guidance must appear and the button must disappear (`:237-251`).

### Batch 14 audit

- The misleading `KNOWN DEFECT` prefix was the one gap found in the round-2 review. Batch 14A is expected to make the exact-top case pass, so the test is now named normally at `tile-load-older-history.spec.ts:213`; it remains an ordinary test with no `test.fail` or skip.
- Both anchor cases remain present: requested `scrollTop` 0 and 300 px, each with the unchanged `offsetDelta <= 2` assertion (`:213-235`).
- Task 14.1 still precomputes tail and older pages through the shared pager, records paging and per-tile DOM diagnostics, rejects missing roots/unpaged resumes as measurement-unusable, and degrades trace-start failure to one warning plus `null`. The per-tile sampler remains inside the wall window but in its own macrotask; its duration is recorded and >= 50 ms rejects the measurement, so its work cannot silently contribute to the PerformanceObserver long-task sum.
- B7 remains inapplicable: `perf-measurement-report.ts` has eight function exports and no new export was added there.
- Task 14.2 still covers one-page prepend, duplicate ids, null-cursor button removal, stale-cursor reopen guidance, the legacy response without `historyPage`, no auto-load on open, and the pinned <= 120 px case.
- Scoped safeguards passed: `git diff --check` reported no issue; e2e diff matches for `content-visibility` and `ALLOWED_METHOD_PREFIXES` were both zero. No additional Batch 14 gap was found.

### Verification (no Playwright by instruction)

1. `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`
   - Literal line: `NX   Successfully ran target typecheck for project ptah-electron-e2e`
2. `npx nx run-many -t lint -p ptah-electron-e2e --parallel=1`
   - Literal summary: `9 problems (0 errors, 9 warnings)`
   - Literal Nx line: `NX   Successfully ran target lint for project ptah-electron-e2e`
   - All nine warnings are the same unrelated warnings in existing files; none is in a Batch 14 file.
3. `npx prettier --check` on all six changed e2e files plus this report
   - Literal line: `All matched files use Prettier code style!`

No Playwright command was run in round 2. The full headed functional e2e run is pending Batch 14A landing.

## Revise round 1

### Finding to resolution

1. **SERIOUS — sampler attribution covered only the query loop.** `perf-page-capture.ts:232-246,276-340,389-408` now times each entire harness macrotask: the replay sample plus `beginSettleWindow()` query/observer setup, and the settled sample plus result assembly. The maximum whole-task duration is recorded as `perTileDomHarnessTaskMaxDurationMs`; any task at or above 50 ms sets `measurementError`. Failure finalization is scheduled into a separate macrotask so it cannot be folded into the already-timed replay callback. This whole-macrotask option preserves the existing measurement lifecycle while bounding every harness task that can appear in the Long Tasks API.
2. **MODERATE — unknown mock cursor returned malformed success data.** `perf-session-fixture.ts:421-426` documents that `UiDriver` can emit only an outer `success: true` envelope. The default history-page resolver now throws a loud `HISTORY_CURSOR_STALE` error for an unknown precomputed cursor; the dedicated functional test remains the faithful failure-envelope path through its listener swap.
3. **MODERATE — sampler failure artifact was lost.** `perf-measurement-report.ts:144-161` now writes `<scenario>-measurement-unusable.json`, including `measurementError` and the full `OpenTilesResult`, before throwing. All four perf scenarios supply their output directory and scenario name at `tile-open-longtask-budget.perf.spec.ts:359-363,463-467,541-545,624-628`.
4. **MODERATE — duplicate resumes silently selected the first call.** `tile-open-longtask-budget.perf.spec.ts:212-229` now filters by session id and requires exactly one observed `chat:resume`; zero or multiple calls throw `measurement unusable` with the observed count.
5. **MINOR — per-row marker flag looked tile-local.** `perf-page-capture.ts:264-265` now states that `allMarkersPresent` is intentionally the same whole-canvas fact repeated on every per-tile sample.
6. **MINOR — missing target window silently dropped the stale response.** The minimal permitted edit in `tile-load-older-history.spec.ts:195-213` now throws clear errors when no `BrowserWindow` exists or the correlation id is missing, then sends through a definite `target.webContents`. The renderer's `RpcResponse` interface is private to `ClaudeRpcService`, and no suitable exported renderer response contract exists; the spec therefore uses the local compiler-checked `RendererRpcFailureEnvelope` at `:26-35` with shared `RpcUserErrorCode` for the error code.
7. **SERIOUS style — pager input used an unchecked double cast.** `GeneratedEvent` now declares its supported event discriminants and `parentToolUseId` (`perf-session-fixture.ts:13-35`). `toFlatStreamEvent` (`:293-359`) validates variant-required fields and returns a real `FlatStreamEventUnion`; `buildPagingFixture` maps through it at `:247-290`. No `as unknown as readonly FlatStreamEventUnion[]` remains.
8. **Style minors.** `DomDiagnostics` and `domDiagnostics` have explicit types (`tile-open-longtask-budget.perf.spec.ts:194-205,246-263`); the replay/settled zip checks both lengths and every indexed value before constructing rows (`perf-page-capture.ts:294-315`); and `PrepareCanvasOptions.supportsPaging` documents its true default while `mockSessions` destructures `supportsPaging = true` (`perf-session-fixture.ts:57-64,402`).

### Files changed in revise round 1

- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts`
- `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts`
- `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts`
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
- `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts` — only the response type and explicit target/correlation guards described above; concurrent Batch 14A probes were preserved.
- `.ptah/specs/TASK_2026_453_1eb4/b14-codex-report.md`

No `libs/**` file was touched by this lane. Existing uncommitted `libs/frontend/chat/**` changes belong to Batch 14A and were ignored.

The concurrent Batch 14A `[prepend-anchor]` console probe was preserved. Its single-line conditional was mechanically brace-formatted at `tile-load-older-history.spec.ts:53-56` only because the required whole-file Prettier check otherwise failed; probe behavior and placement were not changed.

### Verification

- `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`
  - Literal line: `NX   Successfully ran target typecheck for project ptah-electron-e2e`
  - Ptah targeted diagnostics: `Errors: 0 | Warnings: 0 — No issues found.`
- `npx nx run-many -t lint -p ptah-electron-e2e degradation-audit --parallel=1`
  - Literal lint summary: `9 problems (0 errors, 9 warnings)`; all warnings are pre-existing and outside Batch 14 files.
  - Literal audit line: `degradation-audit: TOTAL 303 unsuppressed site(s)`
  - Literal Nx line: `NX   Successfully ran target lint for 2 projects`
- `npx prettier --check` on all changed Batch 14 e2e files and this report
  - Literal line: `All matched files use Prettier code style!`
- Scoped `git diff --check` completed with no output.
- No Playwright command was run in this revision, as instructed. Skip wiring was unchanged, so skip proof was not repeated.

## Revise round 2

### Deterministic user-like scrolling

`tile-load-older-history.spec.ts:87-148` now converges with stepped programmatic scrolling because this is deterministic inside the nested tile scroller. Each step is at most 350 px, dispatches a real `scroll` event, and yields one animation frame; it never jumps from a distant position directly to the target. After reaching the target, the helper requires all of the following before it proceeds:

- `scrollTop` remains within 1 px of the target for eight consecutive animation frames;
- the transcript has had no DOM mutation for 300 ms;
- the cycle is retried if mounting or native anchoring moves the position.

Convergence is bounded to 16 attempts, with a two-second settle window per attempt. Exhaustion throws a clear error containing the target, attempt count, and last observed `scrollTop` (`:145-148`). Immediately before activation, geometry-only guards re-check the 1 px target tolerance and `scrollHeight - scrollTop - clientHeight > 120`; the button must also still be connected (`:163-179`). The captured values are logged and asserted at the test level (`:252-264,338-362`). No component internals are read.

The measured manual-click cases select the product's supported no-`IntersectionObserver` button-only fallback (`:58-68`). This keeps the user-like stepped scroll while preventing the armed auto-load sentinel from consuming the page during the required quiet wait. Both tests additionally require `prependedHeight > 0` (`:346,361`), preventing a post-auto-load no-op click from passing.

### Headed runs

Command for every run:

`npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-load-older-history.spec.ts --reporter=list --headed`

Runner preflight before run 1, between runs, before the final run, and after the final run:

```text
RUNNER_PATTERN=jest-worker|run-executor COUNT=0
```

#### Run 1

The initial convergence implementation passed all five tests. The command-result transport elided the measurement block from this run while retaining its literal summary, so no measurement values are reconstructed or claimed:

```text
5 passed (1.3m)
```

#### Run 2

The evidence-capture rerun exposed a harness false positive in the zero case: the sentinel loaded during the stability wait, so the later click prepended nothing. Its literal lines were:

```text
[load-older e2e][scrollTop-zero][precondition] targetScrollTop=0.00px scrollTop=0.00px distanceFromBottom=12499.00px
[load-older e2e][scrollTop-zero] scrollTopBefore=0.00px scrollTopAfter=0.00px scrollHeightBefore=12910.00px scrollHeightAfter=12910.00px distanceFromBottomBefore=12499.00px prependedHeight=0.00px offsetDelta=0.00px
[load-older e2e][scrollTop-nonzero][precondition] targetScrollTop=300.00px scrollTop=300.00px distanceFromBottom=7266.00px
[load-older e2e][scrollTop-nonzero] scrollTopBefore=300.00px scrollTopAfter=5609.00px scrollHeightBefore=7977.00px scrollHeightAfter=13286.00px distanceFromBottomBefore=7266.00px prependedHeight=5309.00px offsetDelta=0.13px
[load-older e2e] pinned-prepend distance-from-bottom=0.00px
5 passed (1.3m)
```

The no-`IntersectionObserver` isolation, connected-button guard, and positive-prepend assertions described above close that gap.

#### Run 3 (final)

Literal final lines:

```text
[load-older e2e][scrollTop-zero][precondition] targetScrollTop=0.00px scrollTop=0.00px distanceFromBottom=7566.00px
[load-older e2e][scrollTop-zero] scrollTopBefore=0.00px scrollTopAfter=5490.00px scrollHeightBefore=7977.00px scrollHeightAfter=13466.00px distanceFromBottomBefore=7566.00px prependedHeight=5489.00px offsetDelta=0.50px
[load-older e2e][scrollTop-nonzero][precondition] targetScrollTop=300.00px scrollTop=300.00px distanceFromBottom=6988.00px
[load-older e2e][scrollTop-nonzero] scrollTopBefore=300.00px scrollTopAfter=5789.00px scrollHeightBefore=7699.00px scrollHeightAfter=13188.00px distanceFromBottomBefore=6988.00px prependedHeight=5489.00px offsetDelta=0.50px
[load-older e2e] pinned-prepend distance-from-bottom=0.00px
5 passed (1.3m)
```

Both settled anchor cases therefore passed the unchanged 2 px limit with real positive prepends. The stale-cursor, legacy-backend, and pinned-prepend cases also passed. No `test.fail`, skip, weakened matcher, temporary probe, or product-file change was introduced.

### Files changed in revise round 2

- `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts`
- `.ptah/specs/TASK_2026_453_1eb4/b14-codex-report.md`

The existing `libs/frontend/chat/**` work belongs to Batch 14A and was not edited.

### Verification

- `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`
  - `NX   Successfully ran target typecheck for project ptah-electron-e2e`
- `npx nx run-many -t lint -p ptah-electron-e2e degradation-audit --parallel=1`
  - `9 problems (0 errors, 9 warnings)`
  - `degradation-audit: TOTAL 303 unsuppressed site(s)`
  - `NX   Successfully ran target lint for 2 projects`
- `npx prettier --check` on all changed Batch 14 e2e files and this report
  - `All matched files use Prettier code style!`
- Temporary-probe search: `[no output]`
- `git diff --check`: no output.
