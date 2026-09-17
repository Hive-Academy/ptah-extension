# Code Logic Review — `TASK_2026_453_1eb4` Batch 14

## Summary

| Metric              | Value                                 |
| -------------------- | ------------------------------------- |
| Overall score        | 6/10                                   |
| Assessment           | NEEDS_REVISION                         |
| Blocking issues      | 0                                       |
| Serious issues       | 1                                       |
| Moderate issues      | 3                                       |
| Failure modes found  | 4                                       |

Scope reviewed: `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts`, `perf-page-capture.ts`, `perf-measurement-report.ts`, `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`, the new `tile-load-older-history.spec.ts`, and `apps/ptah-electron-e2e/CLAUDE.md`, against Task 14.1/14.2 in `batches.md:1750-1825`, C14 in `implementation-plan.md:1187-1213`, `(ii).3` (page contract) and `b14-codex-report.md` including its Round 2 addendum. No test/build was run for this review; findings are from static reading of the diff plus the reports' own quoted output.

## Five logic questions

### 1. How does this fail silently?

- **Per-tile DOM sampler exclusion is not fully proven, despite the report's claim.** `perf-page-capture.ts:264-280` guards only against the sampler function's *own* measured span (`perTileDomSampleDurationMs`) exceeding 50 ms; it does not measure the *whole* macrotask that contains it. The sampler runs inside `setTimeout(() => { replayingPerTile = samplePerTileDom(); beginSettleWindow(); }, 0)` (`:355-368`) and, separately, synchronously inside `finish()` (`:267-273`). `beginSettleWindow()` itself does a `querySelectorAll` plus `observer.observe()` per tile (`:311-323`) which is not included in `perTileDomSampleDurationMs`. If the sampled portion measures, say, 47 ms (under the 50 ms guard) but the surrounding overhead pushes the *actual* macrotask past 50 ms, the browser's real `PerformanceObserver({entryTypes:['longtask']})` — which is still connected at this point ("the `longtask` observer stays connected until the window closes", implementation-plan.md Task 1.1 AC 6) — would report a genuine long-task entry for that macrotask, and nothing in this diff excludes or subtracts it from `total`/`max`. The measurement would then silently look like a real, unattributed app long task rather than harness overhead, which is exactly the failure mode Task 1.1's "harness must add no work inside the asserted window" rule was written to prevent. Given M0's own measured DOM counts (~20,000+ replaying nodes across 3 tiles, `test-report.md` Batch 2 outcome), a `querySelectorAll('*')` scoped per tile is not guaranteed cheap, so this is not a hypothetical corner case.
- **The generic `chat:history-page` mock's unknown-cursor branch returns an envelope shape the real backend never produces.** `perf-session-fixture.ts` (`mockRpc` block, "`chat:history-page`" resolver) returns `{ success: false, error: 'Session history changed', errorCode: 'HISTORY_CURSOR_STALE' }` as the RPC **result payload**, but `UiDriver`'s IPC handler always wraps whatever the resolver returns in an outer envelope with `success: true` (`ui-driver.ts:145-152`, unconditional). A consumer that expects a thrown `RpcUserError` (the real backend's actual failure shape per `implementation-plan.md:837-839`) would instead receive a *successful* RPC call whose `data` has none of `ChatHistoryPageResult`'s required fields (`events`, `olderCursor`, `resumableSubagents`). The batch's own report is aware of this and works around it — but only for the one deliberately-authored stale-cursor test, by swapping the entire `ipcMain` `'rpc'` listener for one call (`tile-load-older-history.spec.ts:158-190`). The *default* mock (used by every other older-page click, including any future test or a real M2 run that happens to hit an unlisted cursor through a bug elsewhere) still produces the malformed-but-"successful" envelope. This is silent in the sense that nothing here documents, in the file itself, that the plain `chat:history-page` mock cannot represent a real stale-cursor failure — only the codex report's prose says so.

### 2. What user action produces unexpected behaviour?

- The Round 2 fix (`activateLoadEarlierWithoutSentinelRace`, `tile-load-older-history.spec.ts:192-210`) replaces Playwright's `.click()` (which auto-scrolls the target into view first) with a raw `HTMLButtonElement.click()` via `evaluate`, specifically to avoid Playwright's own scroll arming the adjacent auto-load sentinel before the click lands. This is a legitimate, well-documented root-cause fix for a **test-harness** race (Playwright's own scrolling), not a product behaviour change, and it does not weaken the stale-cursor assertions (`:237-251` still checks the reopen-guidance alert and the button's disappearance). No concern here beyond noting it only fixes the *test's* interaction with the sentinel, not anything about the sentinel/button real-world overlap the report also ruled out via the screenshot evidence.

### 3. What input data produces a wrong answer?

- `collectPagingDiagnostics` (`tile-open-longtask-budget.perf.spec.ts:186-217`) matches each session to its `chat:resume` observed call purely by `params.sessionId === session.id` and takes the **first** match found (`calls.find(...)`). If a tile is ever reopened/re-resumed within the same test run (not currently exercised, but nothing prevents it structurally), this would silently report the *first* resume's `historyPage.maxEvents`/paging shape even if a later resume changed it, rather than the one that actually produced the measured DOM. Low likelihood given the current spec bodies (one resume per session per test), but the diagnostic has no defence against it if the harness evolves.
- `samplePerTileDom`'s per-sample `allMarkersPresent` field (`perf-page-capture.ts:236-258`) recomputes the *same* whole-canvas condition (`markers.every(...)`) for every tile in the `.map`, rather than a per-tile fact. It is not wrong (the field genuinely is a global fact, reused per row), but the name and per-row placement invite a future reader to assume it is tile-scoped; worth a one-line comment, not a logic defect.

### 4. What happens when a dependency fails?

- `startTraceCapture`'s hardened failure path (`perf-page-capture.ts:139-172`) is correctly guarded end-to-end: it detaches a partially-created CDP session, narrows the error, warns once, and returns `null`; **every** call site (`tile-open-longtask-budget.perf.spec.ts:277,421,495,573`) either hard-sets `null` (gate test) or awaits the function directly and passes the (possibly `null`) result onward; the sole consumer, `captureOptionalDiagnostics` (`perf-measurement-report.ts:173-190`), checks `if (!traceCapture) return {...}` before calling `stopTraceCapture`, whose parameter type is the non-nullable `TraceCapture` — so there is no path where a `null` capture reaches a function that assumes it is non-null. This is correctly implemented; AC 5 (B8) holds.
- A missing tile root during `samplePerTileDom` (either the "replaying" call inside the `setTimeout` or the "settled" call inside `finish`) throws, and both call sites catch it into `measurementError`, which `assertUsableMeasurement` (`perf-measurement-report.ts:140-144`) turns into a thrown, clearly-labelled error — never a silent 0. AC 4's "never a silent 0" requirement holds.

### 5. What is missing that the requirements never mentioned?

- No instrumentation distinguishes, in the written diagnostics JSON, *why* a run was rejected as "unusable" when the cause is `perTileDomSampleDurationMs >= 50` versus a missing tile root versus an unpaged resume — all three currently throw with their own message text but nothing is persisted to the JSON artifact before the throw aborts the test, so a flaky M2 run driven by sampler cost would leave no trace file to diagnose after the fact (consistent with the Batch 1 "diagnostics / `.cpuprofile` write failures" residual already tracked, but this compounds it: an *assertion* throw, not just a write failure, now also loses the artifact).
- Nothing in `apps/ptah-electron-e2e/CLAUDE.md`'s new sentence, or in `perf-session-fixture.ts` itself, documents the `chat:history-page` mock's envelope limitation identified in Q1 above, even though the codex report explains it clearly. Future maintainers reading only the source (not the batch report) would not know why the stale-cursor test needs its own listener swap.

## Failure modes

### Per-tile DOM sampler cost not fully excluded from the long-task sum

- Trigger: `samplePerTileDom()`'s own measured span stays under 50 ms, but the enclosing macrotask (sampler + `beginSettleWindow()`'s DOM query/observer setup) crosses the browser's 50 ms long-task threshold.
- Symptom: an M2 run reports a `total`/`max` that includes harness-added cost, without `measurementError` catching it (since the internal guard only inspects the sub-span it explicitly timed).
- Evidence: `perf-page-capture.ts:264-280` (guard), `:311-323` (`beginSettleWindow`, uninstrumented), `:355-368` (sampler's own macrotask).
- Current handling: guards only the explicitly-timed portion, not the whole macrotask.
- Recommendation: measure the entire `setTimeout` callback's wall time (wrap `beginSettleWindow()` in the same `performance.now()` span, or move it to its own subsequent macrotask) before deciding usability, so the 50 ms guard actually bounds what the browser's Long Tasks API can attribute to this single macrotask.

### `chat:history-page` mock cannot represent a real stale-cursor failure by default

- Trigger: any older-page click that reaches an unlisted/unknown cursor through the *default* (non-overridden) mock.
- Symptom: the renderer receives a "successful" RPC response (`success: true` at the `UiDriver` envelope level) whose `data` is `{ success: false, error, errorCode }` — a shape matching neither a real success (`ChatHistoryPageResult`) nor a real thrown `RpcUserError`.
- Evidence: `perf-session-fixture.ts` `chat:history-page` resolver string; `ui-driver.ts:145-152` (unconditional `success: true` envelope).
- Current handling: worked around, but only inside the one dedicated stale-cursor test, via a full IPC listener replacement (`tile-load-older-history.spec.ts:158-190`); undocumented in the source files themselves.
- Recommendation: either make the default mock's stale-cursor branch route through the same listener-replacement technique (so it is the general answer, not a one-off), or add a one-line comment at the resolver definition stating the limitation and pointing at the workaround, so a future test author does not assume the default mock already produces a realistic failure envelope.

### First-match session-to-resume-call pairing in paging diagnostics

- Trigger: a session id is resumed more than once within a single test (not exercised today).
- Symptom: `collectPagingDiagnostics` silently reports the first resume's paging shape even if a later resume differs.
- Evidence: `tile-open-longtask-budget.perf.spec.ts:186-217`, `calls.find(...)`.
- Current handling: none; not reachable by any current spec body, so not a live bug today.
- Recommendation: none required now; note for anyone extending the harness to multi-resume scenarios.

### Diagnostics artifact lost on a sampler-driven "measurement unusable" throw

- Trigger: `perTileDomSampleDurationMs >= 50` or a missing tile root during sampling.
- Symptom: the test throws before any diagnostics JSON is written for that run, so there is no artifact to inspect why (only the thrown message, visible in the Playwright/CI log, survives).
- Evidence: `perf-measurement-report.ts:140-144` (`assertUsableMeasurement` throws); no diagnostics write precedes it in the four call sites in `tile-open-longtask-budget.perf.spec.ts`.
- Current handling: consistent with the pre-existing Batch 1 pattern (an assertion throw generally aborts before the JSON write), so this is not a regression introduced by this batch, but it compounds the existing tracked residual now that a second, DOM-cost-dependent throw path exists.
- Recommendation: not blocking; the Batch 1 residual already tracks this class of gap.

## Blocking issues

None found.

## Serious issues

### Per-tile DOM sampler exclusion claim is not fully proven

- File: `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:264-280, 311-323, 355-368`
- Scenario: an M2 (or later) run where the sampled DOM-query span alone stays under 50 ms but the full macrotask (including `beginSettleWindow`'s uninstrumented work) exceeds it.
- Impact: the harness's own AC-11 gating decision — the entire task's success criterion — could be contaminated by a few milliseconds of unattributed harness cost, in either direction (a false "MAX ONLY" or a false pass), without the code detecting it. Given M0's measured DOM volumes (~20,000+ nodes replaying across 3 tiles), the underlying risk is not implausible.
- Fix: time the entire enclosing macrotask, not just the `querySelectorAll` loop, before deciding the run is usable; or split the sampler and `beginSettleWindow()` into two separate macrotasks and gate each independently.

## Moderate and minor issues

- **Moderate** — `chat:history-page`'s default (non-overridden) mock resolver returns a malformed-but-"successful" envelope for any unknown cursor; only the one hand-authored stale-cursor test avoids this via a listener swap (`perf-session-fixture.ts` `chat:history-page` resolver; `tile-load-older-history.spec.ts:158-190`). Undocumented in-source.
- **Moderate** — Diagnostics JSON is not written before a sampler-driven "measurement unusable" throw, losing the artifact that would explain the failure (`perf-measurement-report.ts:140-144`).
- **Moderate** — `collectPagingDiagnostics` pairs by first-matching `sessionId`, silently ignoring a hypothetical second resume of the same session within a test (`tile-open-longtask-budget.perf.spec.ts:186-217`); not reachable today, worth a guard comment if the harness grows multi-resume scenarios.
- **Minor** — `allMarkersPresent` is a whole-canvas fact duplicated per tile row without a comment explaining it is intentional (`perf-page-capture.ts:236-258`).
- **Minor** — `installStaleHistoryResponder` (`tile-load-older-history.spec.ts:158-190`) uses `target?.webContents.send(...)`; if `target` resolves to `undefined` the crafted stale response is silently never sent (the renderer's request would hang until the outer test timeout), with no explicit error surfaced explaining why. Low likelihood (mirrors existing production-mock code's own pattern) but worth a `? : throw` for a clearer failure if it ever happens.

## Data flow

1. `makeSessionFixture` builds a fixture and precomputes `paging: buildPagingFixture(events)` using the shared `selectHistoryPage`/`encodeHistoryCursor` from `@ptah-extension/shared` (`perf-session-fixture.ts:172, 258-296`) — OK, genuinely reuses the backend's own page-selection function rather than reimplementing it, which is the central correctness requirement of C14/Task 14.1 AC 1.
2. `mockSessions` serializes the precomputed tail/older-page chain into a JSON literal embedded in a stringified resolver function, dispatched per RPC call by `UiDriver`'s IPC interception (`perf-session-fixture.ts:296-352`; `ui-driver.ts:110-152`) — OK for the tail/full-history branch (byte-identical shape to what the backend contract defines); the unknown-cursor branch of `chat:history-page` diverges from the real failure envelope (see Serious/Moderate findings above).
3. `tile-open-longtask-budget.perf.spec.ts` calls `assertUsableMeasurement` then `collectPagingDiagnostics` after each `openTilesWithinPage` (`:331-332, 432-433, 507-508, 587-588`) — OK ordering; a missing-paging tile throws before any diagnostics are attached to the written JSON.
4. `openTilesWithinPage`'s in-page `evaluate` callback samples per-tile DOM twice (replaying, settled), rejecting on a missing tile root or on `perTileDomSampleDurationMs >= 50` (`perf-page-capture.ts:236-280, 355-368`) — PARTIAL: rejects on the measured portion but not the full enclosing macrotask (Serious finding above).
5. `tile-load-older-history.spec.ts` drives the real (unmocked-beyond-RPC) Angular app through native DOM events and reads back the real `TranscriptPrependAnchorDirective`-produced scroll state via `window.ng.getComponent` (`:99-131`) — OK, this is a genuine end-to-end functional check, not a mock-only assertion, and directly proves Batch 14A's product fix against the same harness that reproduced the original defect.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Task 14.1 AC 1 — paging-faithful mock | COMPLETE | Tail/full-history branches faithful; stale-cursor branch of `chat:history-page` diverges from the real failure envelope by default (Serious/Moderate) |
| Task 14.1 AC 2 — paging diagnostics + unusable guard | COMPLETE | First-match pairing is a latent (currently unreachable) gap |
| Task 14.1 AC 3 — skip proof | COMPLETE | Per report, `4 skipped` |
| Task 14.1 AC 4 — B6 per-tile DOM sampling, sampler excluded from long-task sum | PARTIAL | Guard covers only the sampler's own measured span, not the whole macrotask (Serious) |
| Task 14.1 AC 5 — B8 trace hardening | COMPLETE | Verified: `null` handled by every caller |
| Task 14.1 AC 6 — B7 conditional split | COMPLETE | Correctly not split (8 exports, no new export added) |
| Task 14.2 AC 1 — prepend anchor <= 2 px including `scrollTop===0` | COMPLETE (per Round 2 / b14a) | Product defect from Round 1 is resolved by Batch 14A; this batch's test correctly re-verifies both cases |
| Task 14.2 AC 2 — duplicate ids, null-cursor button removal, stale-cursor UX, legacy compatibility | COMPLETE | Stale-cursor test only passes via a listener-swap workaround, not the default mock (see above) |
| Task 14.2 AC 3 — pinned prepend (V5/U1) | COMPLETE | 0.00 px measured, well within 120 px |
| Task 14.2 AC 4 — no auto-load on open | COMPLETE | Verified by `getObservedCalls` count 0 before interaction |
| Task 14.2 AC 5 — headed run | COMPLETE | Per reports; not re-run by this review |

Implicit requirements not addressed: documenting the mock's stale-cursor envelope limitation in-source; measuring the sampler's full enclosing macrotask rather than a sub-span.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing tile root during DOM sampling | YES | Throws, caught into `measurementError`, never a silent 0 | None |
| Trace-start CDP failure | YES | `try/catch`, detach, warn, `null`; every caller checks it | None |
| Resume without `historyPage` (legacy backend) | YES | `collectPagingDiagnostics` throws "measurement unusable" | None |
| Unknown/stale history cursor (default mock) | PARTIAL | Only the dedicated test gets a realistic failure envelope via listener swap | Default mock's shape diverges from the real backend (Moderate) |
| Sampler macrotask duration | PARTIAL | 50 ms guard on the measured sub-span only | Whole-macrotask overhead not measured (Serious) |
| Duplicate message ids after prepend | YES | Read via Angular debug API against real `vm().messages` | None |
| Auto-load race with Playwright's own auto-scroll | YES | Native `.click()` bypasses Playwright's scroll-into-view (Round 2 fix) | None |
| Pinned/non-scrollable tile after prepend | YES | Distance-from-bottom measured, <= 120 px | None |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: the per-tile DOM sampler's exclusion-from-long-task-sum claim, which the whole task's AC-11 gate (Batch 15/M2) will rely on, is not proven for the full macrotask — only for a sub-span of it. Given M0's measured DOM volumes this is a live, not theoretical, risk to the eventual AC-11 verdict.
- What a robust implementation would add: (1) time the sampler's entire enclosing macrotask, not just the query loop, before declaring the run usable; (2) either generalize the stale-cursor listener-swap technique into the default `chat:history-page` mock or comment the limitation at its definition; (3) write partial diagnostics before an assertion throw so a sampler-cost rejection leaves a debuggable artifact.
