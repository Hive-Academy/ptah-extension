# Batch 10 executor report: Tasks 10.1 and 10.2 (gate, measured noise margin, CI workflow)

Executor: devops-engineer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`. Nothing committed. No real bench run, no `withPinnedCorpus` call.

## Work completed

### Task 10.1: gate and measured noise margin

- `gate/gate.ts`: noise margins, gate, and two commands.
  - Margin file: `tools/mcp-bench/baseline/noise-margins.json` (zod schema, written atomically). Key per suite: `<tool> / <groundTruth.id>`. Margin = 2 x sample standard deviation of the suite's deciding delta over three runs (rounded to 4 places). Runs must share host and corpus commit. A suite with no score in some run is reported unmeasured and keeps the default.
  - Runner: `main.ts` loads the file at start. Per suite: `--noise-margin`, else the measured margin, else the `NOISE_MARGIN` 0.02 constant (kept only as the fallback).
  - To let the gate and the measurement re-read the exact comparison the runner used, `suite-runner.ts` now writes `primaryMetric` and `decidingBaseline` into each retrieval suite's `details` (optional fields added to `retrieval-suite-kind.ts`).
  - Gate rule: for every non-arm, non-`na` suite with a deciding baseline, fail when `deltas[decidingBaseline][primaryMetric] < -margin`, or when it has no score (tool did not answer, e.g. "tool not exposed on this host"). `na` suites are listed with their reason and never pass or fail. Any non-zero bench exit (1, 2, 3, 4) gives `run-failure`; the scorecard is not read.
  - `gate --scorecard <p> [--bench-exit <n>] [--noise-margin <n>]`: exit 0 pass, 1 below native, 2 run failure.
  - `measure-noise (--from a,b,c | --runs 3) [--host] [--smoke] [--write]`: `--runs` spawns the bench bundle three times (each into `out/noise-<stamp>/run-N`), stops with exit 2 on any non-zero bench exit, never averages a failed run. Without `--write` it only prints.
- `main.ts`: `gate` and `measure-noise` subcommands, `write` boolean flag, usage text. `project.json`: targets `gate` (depends on `build-bench`) and `measure-noise` (depends on `build-host`, `build-bench`).
- `gate/gate.spec.ts`: 21 cases (margin precedence, sd math, deterministic and null deltas, mixed host/commit refusal, pass/fail/unscored/na/arms, exits 1-4 are run failures, command exit codes, margins read from `baseline/`, `--runs` stops on exit 2).

### Task 10.2: CI workflow

- `.github/workflows/mcp-bench.yml` (patterned on `cli-e2e.yml`: Node 24, `NX_TUI: 'false'`, node_modules cache, rollup workaround, `npm rebuild better-sqlite3`; `permissions: contents: read`; concurrency group per ref, cancel only on PRs).
  - Triggers: `pull_request` to main (paths: `tools/mcp-bench/**`, `libs/backend/**`, `libs/shared/**`, the workflow), nightly cron `30 3 * * *`, `workflow_dispatch`.
  - PR: one job, ubuntu-latest, `--host cli-headless --smoke`, `timeout-minutes: 10`.
  - Nightly/dispatch: `cli-headless` full on ubuntu and windows (45 min), plus `bench-electron` on ubuntu under `xvfb-run` (45 min, not on PRs).
  - ripgrep: `apt-get install ripgrep` on Linux (`choco` on Windows). `CI: 'true'` set, so the guard is always `hash`.
  - Each job: bench step records its exit code and never fails itself; scorecard summary and artifact upload run `if: always()`; the Gate step passes `--bench-exit`, so exit 2/3/4 fails the job as a run failure.
  - `fetch-depth: 0` because the corpus pin is a `git worktree add` and the relevance baseline reads `git log`.
- `native-baselines.spec.ts`: under `CI=true` with no usable rg, the 3 live-rg cases now fail with a clear message instead of skipping. Verified: with `CI=true RG_PATH=C:/nonexistent/rg.exe`, 3 failed, 4 passed.
- `.commitlintrc.json`: `mcp-bench` added to `scope-enum`.

## Files written (absolute, base `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`)

- CREATED `tools\mcp-bench\src\gate\gate.ts`
- CREATED `tools\mcp-bench\src\gate\gate.spec.ts`
- CREATED `.github\workflows\mcp-bench.yml`
- MODIFIED `.commitlintrc.json`
- MODIFIED `tools\mcp-bench\src\baselines\native-baselines.spec.ts`
- MODIFIED `tools\mcp-bench\project.json` (targets `gate`, `measure-noise`)
- MODIFIED `tools\mcp-bench\src\main.ts` (margins load, 2 commands)
- MODIFIED `tools\mcp-bench\src\suites\suite-runner.ts` (`decidingFields`, comment)
- MODIFIED `tools\mcp-bench\src\scorecard\retrieval-suite-kind.ts` (2 optional fields)
- `baseline\noise-margins.json` is NOT created yet: it is the output of the measurement below.

## Verification

- `npx prettier --check` on every changed file: "All matched files use Prettier code style!"
- `RG_PATH=...rg.exe npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache`: "Successfully ran targets typecheck, lint, test" (2m 3s). Jest 19 suites / 273 tests passed. Lint 0 errors; the warnings are the 2 pre-existing ones plus a `main.ts` max-lines one that I then fixed (main.ts re-linted clean).
- After the final `main.ts` edit: `tsc --noEmit -p tools/mcp-bench/tsconfig.json` clean, `jest gate` 21 passed.
- `npx nx run mcp-bench:build-bench` succeeded; `node dist/tools/mcp-bench/bench.mjs gate --scorecard x.json --bench-exit 2` printed "gate: run-failure ... not a verdict" and exited 2.
- Workflow: prettier parse only (YAML is valid). actionlint not available; not installed. The `fromJSON` matrix expression is unexercised until a real run.

## Commands for the orchestrator

Run from the worktree root in PowerShell, with nothing else using the corpus path (it calls `withPinnedCorpus` three times). Measure the same mode the PR CI gates (`--smoke`):

```powershell
$env:RG_PATH = 'D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe'
npx nx run mcp-bench:measure-noise --runs 3 --host cli-headless --smoke --write
```

- Runtime: three smoke benches in sequence, about 40-60 min each by the Batch 9 estimate (not timed), so about 2-3 h. Does not require a prior `mcp-bench:bench`; the target builds the host and bundle.
- Output: per-run scorecards in `tools\mcp-bench\out\noise-<stamp>\run-1..3\`, log lines `[noise] <tool> / <truth>: <margin>`, then `[noise] wrote ...\tools\mcp-bench\baseline\noise-margins.json` (commit that file). Exit 0 measured, 2 if any run exited non-zero (nothing written), 1 bad arguments.
- Cheaper alternative if three smoke runs already exist: `npx nx run mcp-bench:measure-noise --from <a>\scorecard.json,<b>\scorecard.json,<c>\scorecard.json --smoke --write`.
- Then to check a scorecard: `npx nx run mcp-bench:gate --scorecard <path> --bench-exit 0`.
- Scorecards written before this batch lack `primaryMetric`/`decidingBaseline`, so they cannot be used with `--from`.

## Deviations

1. File cap: 9 files (batches.md listed gate.ts, gate.spec.ts, mcp-bench.yml, `.commitlintrc.json`, native-baselines.spec.ts = 5). Extras: `project.json`, `main.ts`, `suite-runner.ts`, `retrieval-suite-kind.ts`. All needed to wire the targets, the runner's margin lookup and the gate's re-read of the deciding comparison.
2. The batches.md "recorded-failure mode" (baseline equality, per-suite mode) is not implemented. I implemented what the hand-off specified: gate on the native-baseline rule plus the measured margin. A baseline file with per-suite modes is left to Batch 11 if still wanted.
3. The gate treats a suite with a deciding baseline but no score as a failure (an unexposed tool is below any baseline). On `cli-headless` today `ptah_lsp_references` and `ptah_lsp_definitions` are not exposed, so the first PR run will fail the gate until Batch 11/Phase 2 changes that. Orchestrator should confirm this is wanted.
4. The PR smoke job has `timeout-minutes: 10` per batches.md, but the Batch 9 smoke estimate is 40-60 min locally (graph build alone about 225 s, lifecycle waits up to 120 s). The 10-minute budget is likely to be exceeded; measure on a real CI run and adjust (batches.md suggests caching the SQLite DB and graph by corpus commit).
5. Optional pyright/gopls/SCIP in nightly: not added (bench has no such switch yet).

## Clarifications Needed

None blocking. Items 3 and 4 above are decisions for the orchestrator.

## Revision 1

Orchestrator decisions applied: file cap accepted; recorded-failure mode implemented; unscored handling per mode; PR timeout 60 min.

### Work completed

- **Recorded-failure mode** (`gate/baseline.ts`, new). Committed baseline `tools/mcp-bench/baseline/gate-baseline.json` = `{ recordedAt, modes: { suites, lifecycle }, scorecard }`. Keys: suite `<tool> / <groundTruth.id>`, lifecycle `<tool> / <scenario>`. Absent mode = `recorded-failure`.
  - recorded-failure suite: deciding delta within the stored noise margin of the recorded delta = pass; below = `regression` (fails); above = `improved` (passes, listed as "baseline out of date" in the report's `outOfDate`). Suites without a numeric comparison (`na`) must keep the recorded verdict.
  - Unscored: passes only when the baseline is also unscored with the same `(verdict)` reasons; a different reason = `changed` (fails); scored-then-unscored = regression; unscored-then-scored = improved.
  - Suite recorded but missing from the run fails (`missing`); suite not in the baseline is listed as out of date (passes).
  - Lifecycle rows, same per-row mode: recorded = same pass/fail passes, fail-to-pass is out of date, pass-to-fail fails, missing row fails; claim row fails whenever the scenario fails.
  - claim mode = the previous gate plus the over-1%-error check (`over-error-rate`); an unscored claim suite fails.
  - Missing baseline file: `BaselineMissingError` with the record command in the text; `gate` logs it and exits 2 (nothing judged).
- `gate/gate-command.ts` (new): `gate`, `record-baseline`, dispatcher `runGateCommand` (keeps `main.ts` under the 700-line lint limit). `gate/gate.ts` keeps margins, claim logic and measurement. `project.json` gains target `record-baseline`.
- Specs: `gate/baseline.spec.ts` (15 cases: equal within noise pass, regression fail, improvement "baseline out of date" pass, claim on one suite while others stay recorded, unscored same/different reason, missing/new suite, na, lifecycle modes, missing baseline file error and exit 2, record-baseline round trip, gate exits 0/1/2). `gate.spec.ts` unchanged apart from moving the gate-exit cases.
- Workflow: PR job `timeout-minutes: 60` (header comment explains); comment about modes added.

### Verification

- Scoped gate with `RG_PATH` set: `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache`: all three passed, 20 suites, 288 tests, 0 lint errors. I then moved the command dispatch into `gate-command.ts` (to bring `main.ts` back under 700 lines) and re-checked: `tsc --noEmit` clean, eslint on `main.ts` and `gate/` clean, `jest gate main` 36 passed, `build-bench` succeeded, `npx prettier --check` on `tools/mcp-bench/src`, `project.json`, the workflow and `.commitlintrc.json` clean. The remaining lint warnings are the 2 pre-existing ones.
- `node dist/tools/mcp-bench/bench.mjs gate --scorecard x.json` with no baseline: clear error, exit 2. With `--bench-exit 3`: "run failure, not a verdict", exit 2.
- No real bench run.

### Deviation: PR smoke timeout

`timeout-minutes: 60` on the PR job (batches.md said under 10). The Batch 9 local smoke took 49.5 min, so 10 could never pass. Batch 11 tunes it from the first real CI run (cache the SQLite DB and graph by corpus commit if needed).

### Orchestrator command list (updated)

PowerShell, worktree root, corpus path not shared with another run:

```powershell
$env:RG_PATH = 'D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe'
# 1. Noise margins: three smoke benches (about 2.5 h), writes baseline\noise-margins.json
npx nx run mcp-bench:measure-noise --runs 3 --host cli-headless --smoke --write
# 2. Batch 11: record the baseline from one of those scorecards (or a fresh smoke run)
npx nx run mcp-bench:record-baseline --scorecard tools\mcp-bench\out\noise-<stamp>\run-3\scorecard.json
#    Default: every suite and lifecycle row is recorded-failure. To put rows in claim mode:
#    --claim "ptah_search_files / <groundTruth.id>,ptah_code_search_symbols / cold-start"
# 3. Verify: the gate against the baseline (exit 0 expected when run against the same scorecard)
npx nx run mcp-bench:gate --scorecard tools\mcp-bench\out\noise-<stamp>\run-3\scorecard.json --bench-exit 0
```

Commit `tools/mcp-bench/baseline/noise-margins.json` and `gate-baseline.json`. The baseline should come from a run made with the same mode as the PR CI (`--smoke`, `cli-headless`) and the same corpus commit. Until `gate-baseline.json` exists, the CI gate step exits 2 with the "no gate baseline" message.

### Files added or changed in Revision 1 (absolute, base `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`)

- CREATED `tools\mcp-bench\src\gate\baseline.ts`, `baseline.spec.ts`, `gate-command.ts`
- MODIFIED `tools\mcp-bench\src\gate\gate.ts`, `gate.spec.ts`, `tools\mcp-bench\src\main.ts`, `tools\mcp-bench\project.json`, `.github\workflows\mcp-bench.yml`

## Revision 2

### Work completed

- **Margin floor.** margin = max(2 x SD, 1 / questions), where questions is the smallest suite size across the three runs (one question's weight). Each suite entry in `noise-margins.json` now records `margin` (used), `sdMargin` (raw), `floor`, `questions`, `metric` and `measuredAs`. The file schema is version 2; the runner and gate read `.margin`.
- **Memory suite.** `ptah_memory_search` has no native baseline, so it is measured by the spread of its own primary metric (`hit@5`, `measuredAs: own-metric`). Going forward the runner records `primaryMetric` in every suite's details, with `decidingBaseline` only where a native baseline decides. The three existing scorecards predate that field, so measurement falls back to `hit@5` for `ptah_memory_search` alone (`LEGACY_OWN_METRIC` in `gate/gate.ts`). The recorded-failure gate now also compares such own-metric suites within their margin (claim mode still reports them `not-compared`).
- **Lifecycle rows.** Recorded as `status: pass | fail | flaky` with `passes` and `runsSeen`. A row that changed verdict across the runs, or was absent from some run, is `flaky`. In recorded-failure mode a flaky row tolerates a flip either way (reported as passing, with the note "flaky"). In the three runs, none was flaky.
- Specs added to `gate.spec.ts` and `baseline.spec.ts` (floor with identical runs, floor vs larger spread, memory own-metric, lifecycle stability and flaky, flaky tolerated in the gate): 292 tests in total.
- `measure-noise` now logs each margin with its SD value, floor and basis, and each lifecycle row.

### Re-run

The measurement was re-run with the orchestrator's `--from` command plus `--smoke` (the three scorecards are 40-question smoke runs, so the file's `smoke` field is now `true`; it was `false` before). No bench was run: `npx nx run mcp-bench:measure-noise --from <3 scorecards> --smoke --write` finished in seconds and rewrote `tools/mcp-bench/baseline/noise-margins.json`.

### Verification

`RG_PATH=...rg.exe npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache`: all three passed, 20 suites, 292 tests, 0 lint errors (the 2 pre-existing warnings only). `npx prettier --check` on `tools/mcp-bench/src`, `tools/mcp-bench/baseline` and the workflow: clean.

### Final margins (smoke, cli-headless, corpus 7910f34cf, 3 runs, 40 questions per suite)

| Suite | Metric | Measured as | 2 SD | Floor | Margin used |
| --- | --- | --- | ---: | ---: | ---: |
| ptah_ast_analyze / file-tools | recall_all | native gap | 0 | 0.025 | 0.025 |
| ptah_code_search_symbols / symbols-concept | hit@5 | native gap | 0 | 0.025 | 0.025 |
| ptah_code_search_symbols / symbols-exact | hit@5 | native gap | 0.0289 | 0.025 | 0.0289 |
| ptah_context_enrich_file / file-tools | recall_all | native gap | 0 | 0.025 | 0.025 |
| ptah_get_dependents / dependents | recall_all | native gap | 0.1 | 0.025 | 0.1 |
| ptah_get_symbol_index / symbols-exact | hit@1 | native gap | 0.0289 | 0.025 | 0.0289 |
| ptah_memory_search / memory | hit@5 | own metric | 0 | 0.025 | 0.025 |
| ptah_relevance_rank_files / relevance | recall@10 | native gap | 0 | 0.025 | 0.025 |
| ptah_search_files / file-tools | recall_all | native gap | 0 | 0.025 | 0.025 |
| ptah_lsp_definitions, ptah_lsp_references (TS, python-attrs, go-logrus) | n/a | not measurable (no score in any run) | | | default 0.02 |

Lifecycle stability (no row flaky): pass in 3/3 for `large-file-1.5mib`, `embedder-warmup`, `two-workspaces-memory-leak`, `transport-idle-gaps` and `transport-restart`. Fail in 0/3 for the other 11 rows: `add-then-query`, `cold-start`, `delete-then-query`, `edit-then-query-5s`, `edit-then-query-60s`, `index-age-24h`, `large-file-3900-lines`, `two-workspaces-symbol-scope`, `worktree-memory-scope`, `worktree-spool-path` and `worktree-task-tools`.

Note: the default margin for unmeasured suites (0.02) is below one question's weight for a 40-question suite (0.025). Those suites currently have no score anyway; revisit when the language-server tools score.

### Files changed in Revision 2 (absolute, base `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`)

- MODIFIED `tools\mcp-bench\src\gate\gate.ts`, `gate.spec.ts`, `baseline.ts`, `baseline.spec.ts`, `tools\mcp-bench\src\suites\suite-runner.ts`
- REWRITTEN (measurement output) `tools\mcp-bench\baseline\noise-margins.json`
