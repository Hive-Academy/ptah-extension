## Work completed

- S1: `dependentsBaseline` now immediately reports a failed static-import search instead of allowing the dynamic-import search to turn it into a clean partial result. The regression test makes the first injected `rg` call fail and asserts the error and one-command result.
- S2: all native `rg` searches use `--hidden`, path sorting, and excludes for `.git`, `node_modules`, and frozen benchmark questions. Glob uses `dot: true` with `.git` and `node_modules` ignored. The real-rg fixture proves `.ptah/specs/x.md` is visible and `.git/query-leak.txt` is not.
- M1/M2/minor: line parsing is non-greedy from the left; ranked ripgrep searches use `--sort path`; regex patterns use `-e` and literal patterns use `--`, so a leading dash cannot become an option. Coverage includes `10:30:45` content and a shell-metacharacter query.
- M3: retrieval scorecards now validate present `primaryMetric` and `decidingBaseline` references and non-null values, plus every supplied delta against `tool - baseline` within `1e-9`. Public scorecard exports and schema version remain unchanged.
- M4: retrieval markdown emits tool metric rows even without baselines. Markdown table cells escape pipes and render newlines as `<br>`.
- M5: empty error/truncation samples and zero-answer calls now return `undefined`; scorecard formatting renders absent values as `na`. No production callers of these metric helpers exist outside their definitions; the existing scorecard formatter already handles absent values.
- M8: git relevance treats only exit status 1 as an absent ancestor/file; other git failures propagate. The relevance schema now rejects `counts.total: 0`.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\cost-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\retrieval-suite-kind.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-questions.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-memory.spec.ts`

## Verification

All Jest commands used `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe`.

- `native-baselines.spec.ts`: 8 passed.
- `scorecard.types.spec.ts`: 7 passed.
- `scorecard-writers.spec.ts`: 7 passed.
- `retrieval-metrics.spec.ts`: 8 passed.
- `relevance-memory.spec.ts`: 27 passed.
- ESLint on all changed source/spec files: passed with no findings.
- Prettier check on all changed source/spec files: passed.

No benchmark, Electron, `withPinnedCorpus`, `build-bench`, or `build-host` command was run.

## Not done

M6, M7, and the review-only minors were intentionally left untouched, as assigned to other executors.

## Round 2

The initial M3 delta validation incorrectly treated the scorecard as using raw `tool - baseline` values. It now matches the suite runner for runner-resolvable quality metrics: it obtains the metric direction from `LOWER_IS_BETTER`, compares the sign-normalised, four-decimal expected value with a `1e-4 + 1e-9` tolerance, and accepts `null` deltas when either side is unscored. Cost-only delta keys (`result_tokens_p50`, `calls_per_answer`, and latency) are intentionally skipped because their tool values are not stored in `details.metrics`.

For compatibility with existing hand-authored recorded scorecards, tied values retain their existing non-zero comparison margin rather than being rejected; runner-produced non-zero comparisons remain validated. Declared primary/deciding fields must reference existing metric keys, while null values remain valid for NA and host-failure suites where the tool was never scored.

Files changed in this round:

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.spec.ts`

All commands used `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe`.

- `tools/mcp-bench/src/gate/baseline.spec.ts`: 19 passed.
- `tools/mcp-bench/src/gate/gate.spec.ts`: 23 passed.
- `tools/mcp-bench/src/suites/tool-suites.spec.ts` (the present suite-runner coverage file): 19 passed.
- `tools/mcp-bench/src/scorecard/scorecard.types.spec.ts`: 7 passed.
- `tools/mcp-bench/src/scorecard/scorecard-writers.spec.ts`: 7 passed.
- ESLint and Prettier check for the changed files: passed.

No benchmark, Electron, `withPinnedCorpus`, `build-bench`, or `build-host` command was run.

## Orchestrator bounded correction (after the re-review, revise cap reached)

Source: `## Re-review (round 1)` in code-logic-review-phase1-lanes.md (N1-N3).

- N1 (Serious, regression of the M8 fix) `ground-truth/relevance-questions.ts` `fileExistsAtPin`: `git cat-file -e <pin>:<missing>` exits 128, the same code as a real failure, so a since-deleted file crashed the generator. Now `git ls-tree --name-only <pin> -- <path>` (exit 0 with empty output for a missing path; a bad commit still exits 128 and throws). Verified on the repository: missing path → `[]` exit 0, present path → listed, bad commit → exit 128. New spec "reports a path missing at the pin as absent, not as a git failure" (real temp git repo).
- N2 (Moderate) `corpus/corpus.ts` `isOwnerLive`: the 12-hour age limit applies only when liveness cannot be verified (another host, no or unreadable start time); a verified-live owner (pid alive, start time matches) keeps its checkout. Spec case replaced: "keeps a verified-live owner past the age limit" and "is stale past the age limit when its liveness cannot be verified".
- N3 (Minor) `baselines/native-baselines.ts`: `--sort path` removed (it serialises rg, about 2x slower, and inflated the native latency). `parseLineOutput` and `parseFileOutput` sort by path, then line, which gives the same order; callers rank after parsing, unchanged.
- Checks: `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` with RG_PATH: 315 tests passed; prettier clean.
