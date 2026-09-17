# Batch 18 e2e perf-harness follow-ups

## Outcome

Implemented M2-a, M2-b, M2-c, and B14 in the Electron e2e perf harness. This lane did not run a perf measurement, Jest, or Playwright.

## M2-a — per-tile DOM at each tile's own replay point

- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:424-458` now detects the first added `[data-ptah-transcript-message-id]` for each newly opened tile. That slot is product evidence that the tile's persisted history has begun rendering; mere tile-shell creation is not treated as replay progress.
- The `MutationObserver` only identifies that replay-start signal and queues a zero-delay timer. The actual transcript DOM count runs in that separate harness macrotask (`perf-page-capture.ts:442-458`), so sampler query work is not folded into the product mutation macrotask or silently counted as application long-task work.
- Tile-to-marker association uses the new tiles' stable click/DOM order relative to the pre-existing tile count (`perf-page-capture.ts:218-226`, `:431-437`). This also covers warm scenarios where a warm-up tile already exists.
- The existing whole-canvas replay sample remains at the first marker observation (`perf-page-capture.ts:461-466`); M1/M2 whole-canvas comparability is unchanged.
- Each per-tile row now records `sampleTimestampMs`, `markerTimestampMs`, and derived `sampleState: 'mid-replay' | 'post-marker'` (`perf-page-capture.ts:16-23`, `:328-362`). A sample is `mid-replay` only when its timestamp is no later than that tile's final marker timestamp. A `post-marker` sample sets `measurementError`, making AC 2 evidence unusable rather than silently passing (`:346-354`).
- Missing samples likewise set an explicit error naming the affected marker(s) (`perf-page-capture.ts:316-321`).
- Diagnostics JSON exposes the three new per-tile fields at `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:199-207,266-276`.

### Why this instant is genuinely mid-replay

The marker is fixture content in the final assistant turn (`apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:164-181`), while `[data-ptah-transcript-message-id]` is emitted for rendered transcript messages. The sampler is scheduled on the first observed message slot, not on the final marker. Chunked replay yields between 250-event chunks, so the timer runs independently after replay has visibly started and normally before the final-marker mutation. The timestamp comparison is the runtime proof: if scheduling ever lands after the marker, `sampleState` says `post-marker` and the run is rejected.

## M2-c — whole-macrotask timing

- **Finding: the Batch 14 claim was correct.** Before this follow-up, the replay-side guard began its clock at the start of the timer callback, ran both per-tile sampling and `beginSettleWindow()`, and recorded at the end of that callback. Finalization likewise began timing before settled sampling and ended after the whole finalization body. It therefore guarded the enclosing harness callback, not only the query loop.
- The contract is now explicit in JSON as `domNodes.perTileHarnessMacrotaskMaxDurationMs` (`perf-page-capture.ts:37,227-255,387`; `tile-open-longtask-budget.perf.spec.ts:198,263-264`). The former ambiguous `perTileHarnessTaskMaxDurationMs`/`perTileDomHarnessTaskMaxDurationMs` names were replaced.
- Every dedicated harness macrotask in this path feeds the same maximum: each per-tile replay sampler (`perf-page-capture.ts:442-458`), settle-window setup including `beginSettleWindow()` (`:478-495`), and finalization/settled sampling (`:298-389`). At `>= 50 ms`, the shared recorder sets `measurementError` (`:242-255`) and the run becomes unusable.

## M2-b — warm one-tile scroll sanity

- Added `assertScrollSanity(page, [real])` after paging diagnostics and marker confirmation and before measurement summarization/diagnostics writing, matching the other scenarios (`apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:565-578`).

## B14 — diagnostics before every unusable exit

- Added shared `failUnusableMeasurement(...)` at `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts:37-53`. It writes a JSON artifact containing `measurementUsable: false`, `measurementError`, and supplied evidence before throwing.
- `assertUsableMeasurement` now routes sampler-guard/missing-sample errors, `!ok`, and `!settled` through that helper (`perf-measurement-report.ts:162-184`).
- All three paging validation exits route through the same helper with `openResult` evidence (`tile-open-longtask-budget.perf.spec.ts:210-250`): resume count mismatch, disappeared matched call, and missing `historyPage`.
- The four scenarios pass their exact diagnostics scenario name and `openResult` into paging collection (`tile-open-longtask-budget.perf.spec.ts:377-382,486-491,569-574,658-663`).

## Documentation

- `apps/ptah-electron-e2e/CLAUDE.md:20` documents the per-tile timestamp/state fields and the post-marker / 50 ms unusable rules.

## Files changed

- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts`
- `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts`
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
- `apps/ptah-electron-e2e/CLAUDE.md`
- `.ptah/specs/TASK_2026_453_1eb4/b18-e2e-codex-report.md`
- `.ptah/specs/TASK_2026_453_1eb4/agent-output-root.md` (deliverable pointer required by lane convention)

The concurrent lane's modified `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts` and untracked `libs/frontend/chat/src/lib/components/organisms/transcript/testing/` directory were present at final status inspection and were not read, edited, formatted, or included in this work.

## Verification

### Typecheck

Command:

`npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1`

Result: PASS. Nx reported `Successfully ran target typecheck for project ptah-electron-e2e`; `tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` exited 0. Re-run after the final harness edits also passed.

### Lint and degradation audit

Command:

`npx nx run-many -t lint -p ptah-electron-e2e degradation-audit --parallel=1`

Result: PASS. Nx ran 2 projects and exited 0. Electron e2e lint reported 0 errors and 9 existing warnings in unrelated files. Degradation audit reported `TOTAL 303 unsuppressed site(s)`.

### Formatting and diff hygiene

Command:

`npx prettier --check apps/ptah-electron-e2e/src/support/perf-page-capture.ts apps/ptah-electron-e2e/src/support/perf-measurement-report.ts apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts apps/ptah-electron-e2e/CLAUDE.md`

Result: PASS, `All matched files use Prettier code style!`.

`git diff --check` also passed with no output.

### Tests and perf execution

Not executed, by instruction. No Jest command, Playwright command, or perf run was issued. The optional no-env skip proof was not attempted because it is a Playwright command and the parallel chat-spec lane was active; therefore no idle-process claim is made.

## Deviations

- The requested `ptah_*` repository-analysis tools were not exposed in this session. Read-only `rg`, `Get-Content`, and Git inspection were used as the fallback; edits used patch application and Prettier only.
- No threshold, budget, run flag, or test title changed.
- No `libs/**`, `project.json`, Jest configuration, or Playwright configuration file was changed.

## Blocking findings

None. Runtime values for the new timestamps, state, and macrotask maximum intentionally await a later idle-machine perf run outside this lane.
