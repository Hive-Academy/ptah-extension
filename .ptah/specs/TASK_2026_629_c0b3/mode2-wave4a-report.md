# Mode 2 report, Wave 4a (batch R9m), TASK_2026_629_c0b3

Verdict: R9m ACCEPTED and committed as `b3626c50d`.

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`, branch
`feat/task-629-canvas-board`, local only, not pushed.

## Inputs

- Writer report: `lane-R9m-report.md` (opencode). It lists 6/6 deletions, with rg results before and after.
- Review: `code-logic-review-R9m.md`. APPROVED 9/10, 0 Blocking, 0 Serious, 0 Moderate, 3 Minor. No fix round.

## On-disk verification

- None of the six paths under `libs/frontend/canvas/src/lib` exists any more. `test -e` was false for each:
  `canvas-grid-release.ts`, `canvas-grid-release.engine.spec.ts`, `tile-agent-mini-panel.component.ts`,
  `tile-agent-mini-panel.component.spec.ts`, `canvas-detail/canvas-detail-keyboard.ts`,
  `canvas-detail/canvas-detail-keyboard.spec.ts`.
- `git status --short -- libs/frontend/canvas` showed exactly those six ` D` entries and nothing else.

## Zero-importer check

The search was `rg -n` over `libs apps`, which excludes `.ptah`. It covered:
- basenames: `canvas-grid-release`, `tile-agent-mini-panel`, `canvas-detail-keyboard`;
- symbols: `retainLiveViewConstraints`, `nodesNeedingLayout`, `geometryDriftCount`, `pinLiveNodes`,
  `restorePinnedNodes`, `releaseStaleNodes`, `staleGridNodes`, `TileAgentMiniPanelComponent`,
  `handleCanvasDetailKeydown`.

Result: no output, rg exit 1, so 0 hits.

## Checks

The checks ran one after another, each through `node .ptah/tmp/check-run.mjs` from W.

| Label | Command | Exit | Result |
| --- | --- | --- | --- |
| w4-canvas-full | FULL(@ptah-extension/canvas) | 0 | `Test Suites: 24 passed, 24 total`; `Tests: 269 passed, 269 total` |
| w4-canvas-tc | TC(@ptah-extension/canvas) | 0 | Successfully ran target typecheck; 0 `TS` error lines in log |
| w4-canvas-lint | LINT(@ptah-extension/canvas) | 0 | `16 problems (0 errors, 16 warnings)` |

- The suite and test counts fell from Wave 3's 27 suites / 275 tests by exactly the three deleted spec files
  and the six tests they held.
- Lint warnings held at 16, the same count as Wave 3.
- Typecheck reported no errors, either in the R9m files or in the chat or chat-state sources that are
  mid-change in R9h and R9r.
- Logs: `%TEMP%\629-check-w4-canvas-{full,tc,lint}.log`.

## Commit

- `b3626c50d refactor(canvas): batch R9m - delete grid release, mini panel, keyboard`: 6 files, 549 deletions.
- Staging used explicit paths only: `git add --` with the six deleted paths. `git diff --cached` showed
  exactly those six `D` entries.
- The commit ran in the foreground and the pre-commit hook passed. No `--no-verify` was used.
- These were not staged or touched: the uncommitted R9h files (`libs/frontend/chat/**`), the R9r files
  (`libs/frontend/chat-state/**`), and the `.ptah/specs/**` docs. That includes this report and the
  `batches-rail-r9.md` update, which are left for the orchestrator's docs commit.

## Minors recorded (not fixed, per the fix-round rule)

1. Stale mcp-bench fixture paths.
   - Where: `tools/mcp-bench/baseline/gate-baseline.json:1052,1816` and
     `tools/mcp-bench/questions/7910f34cf/{references,relevance,file-tools}.json`.
   - They point at the deleted `tile-agent-mini-panel.component.ts`.
   - Owner: mcp-bench. Re-record the baseline or retire question 7910f34cf on the next gate run.
2. The row-60 leak-guarantee evidence is deferred.
   - The Gridstack engine spec is gone.
   - The Rail replacement is the `s-heap` criterion in the perf batch (`batches-rail-r9.md:615-617`).
   - That batch must stay on the plan.
3. Escape-in-tablist coverage.
   - The deleted `canvas-detail-keyboard.spec.ts` was the only test for "Escape from a lane tab closes detail".
   - Rail Escape semantics differ by design: Escape returns focus instead of closing.
   - Optional follow-up: add a lane-tab Escape case under parity row 24.

## State

- In `batches-rail-r9.md`, the R9m heading and Task R9m.1 are COMPLETE with `b3626c50d`. The Mode 2 result
  is recorded there.
- Wave 4 still has R9r (chat-state) pending its Mode 2. R9h (H1) is also uncommitted in W.
