# Batch 11 executor report: first recorded scorecard, gate baseline, mandate-manifest link

Worktree `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark` (branch `fix/task-619-tool-benchmark`). Nothing committed. **Phase A is done. Status: ready for runs.** No real bench, no Electron launch, no `record-baseline` on a new run, and nothing that calls `withPinnedCorpus` has been run. Nothing was written outside the worktree.

## Work completed (Phase A)

### Electron host (launch mode, isolated userData; attach never touches user state)

- `transport/electron-host.ts`: `ElectronHost.dbPath`. Launch mode returns the isolated `PTAH_DB_PATH` inside the temp home, so scenario 6 (`index-age-24h`) can backdate rows. Attach mode returns `null`: the bench never reaches a user DB.
- `main.ts` and `bench-hosts.ts`:
  - **Launch mode** now runs the whole lifecycle set on Electron:
    - the copy scenarios (cold start, edit/add/delete then query, large files, index age, restart), each with its own Electron host on a disposable corpus copy;
    - the session scenarios `two-workspaces-symbol-scope`, `transport-idle-gaps` and `worktree-task-tools`.
  - Memory roots are now created for every launched host. Only cli-headless seeds them. They stay in use because workspace B is the symbol-scope probe.
  - **Memory scenarios on Electron** are `na` with the reason "no seeding hook". The scenarios are `two-workspaces-memory-leak`, `worktree-memory-scope` and `worktree-spool-path`. The memory suite itself is already `na` on Electron.
  - **Attach mode** never launches a lifecycle scenario: every copy and session scenario is an `na` row with `ATTACH_MODE_NA_REASON`.
- Schema (`scorecard.types.ts`): the lifecycle row has an optional `na: string`. It means "this host cannot run it", not "failed". It is rendered as `na` in the markdown. It is skipped by `applyLifecycleVerdicts` (no suite fails because of it), by `buildBaseline` and the gate (never judged, never "missing"), and by the noise measurement.
- Electron on win32 is stopped with `taskkill /T /F`, which the stop classifier reports as `killed` with an explanatory detail. It is not a crash.

### `index-age-24h`

- The scenario already waits for `reindexInFlight: false` before backdating (Batch 9 follow-up). It is re-measured by every run with lifecycle.
- Its detail now also quotes what the report needs:
  - the settle time;
  - DB size in MiB;
  - the `symbolCount` and the raw `coverage` block (census, indexed, `omittedByCap`);
  - the first answer's `indexAgeMs` and whether a refresh started.
- The `cold-start` detail records when `reindexInFlight: false` was first seen (the index time).
- To stay under the 700-line lint ceiling, `lifecycle-scenarios.ts` was split into `lifecycle-probe.ts` (`searchSymbol`, `pollUntil`, `indexAgeScenario`) and `lifecycle-na.ts` (`naScenarios`, `coverageOf`).

### Eligible-file count (batches.md carry from Batch 2)

- I chose the "label the raw number" option. Reusing the indexer's discovery predicate would mean importing and re-running product internals, and the indexer census is already in the host's coverage block.
- `corpus.ts` documents `eligibleFiles` as a RAW source-file count (extension match outside `.git` and `node_modules`, no gitignore or indexer rules, not the product's 3,860).
- `scorecard.md` now has a `Corpus:` line that says so. The indexer census is quoted from the index-age and cold-start coverage blocks. The scorecard field keeps its name, so the schema stays stable.

### Margins per mode, and which one the PR gate reads

- `gate/gate.ts`:
  - `noiseMarginsFile(host, smoke)` maps a mode to a file.
  - `noise-margins.json` is **cli-headless smoke**, the file the PR CI gate reads. It is the Batch 10 measurement, unchanged.
  - Every other mode has its own file: `noise-margins.cli-headless.full.json`, `noise-margins.electron.smoke.json`, `noise-margins.electron.full.json`.
  - `loadNoiseMargins(dir, host, smoke)` and `writeNoiseMargins` pick the file from the margins' own `host` and `smoke`.
- Scorecards now record `run.smoke` (optional field). `bench` loads the margins of its own mode, and `gate` loads the margins of the scorecard it judges. A scorecard from before this batch has no `run.smoke` and is read as full.
- `measure-noise ... --write` writes the file of its mode. Full-mode margins no longer overwrite the PR margins.
- A mode with no margins file keeps the 0.02 default. That default is below one question's weight (0.025 at 40 questions) and still applies to the LSP suites. Revisit it once those suites have a score, which should happen on the Electron record.

### Task 11.2: `CLAIM_SUITE`

- `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-mandate-manifest.spec.ts`:
  - A `CLAIM_SUITE` map: each mandated tool names its `<tool> / <groundTruth.id>` suites, or carries a reasoned `noSuite`.
  - The `noSuite` tools are `ptah_workspace_analyze`, `ptah_project_detect_monorepo`, `ptah_get_diagnostics`, `ptah_get_dirty_files`, `ptah_count_tokens` and `ptah_web_search`.
  - The baseline is read with `fs` from `tools/mcp-bench/baseline/gate-baseline.json`. The lib does not import `mcp-bench`.
  - Cases:
    - the baseline exists;
    - every mandated tool has an entry (no silent gap);
    - an `it.each` over every tool: it must name suites that exist in the baseline, or carry a reason;
    - a self-test of the checker, including that breakdown arms do not count.
- I checked every claimed suite key against the latest existing smoke scorecard offline. All 10 mapped keys exist, so the spec should pass once the baseline is committed.
- **This spec fails until Phase B step 3 commits `gate-baseline.json`.** That is by design. When run now with a manual `moduleNameMapper`, 8 cases passed and 11 failed. All 11 failures are "baseline missing" ones.

## Run plan (Phase B)

All commands are PowerShell from the worktree root. Set once per shell:

```powershell
$env:RG_PATH = 'D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe'
```

Every real bench calls `withPinnedCorpus`, so each needs the TASK_2026_620 clearance and the shared corpus path to itself. `--out` makes the output path deterministic. Durations are estimates from Batch 9 and 10: a smoke run was 37-52 min. A full run (200 relevance questions, 350 symbol questions, full lifecycle waits) is not measured; I estimate 2.5-3.5 h.

| Step | Command | Host | Estimated time | Writes | Depends on |
| --- | --- | --- | --- | --- | --- |
| 0a | `npx nx build-dev ptah-electron` (no corpus, no launch) | n/a | 5-10 min | `dist\apps\ptah-electron\main.mjs` | none; no clearance needed |
| 1 | `npx nx run mcp-bench:bench --host cli-headless --smoke --out tools\mcp-bench\out\b11-cli-smoke --skip-nx-cache` | cli-headless | 40-55 min | `out\b11-cli-smoke\scorecard.json` and `.md` | none |
| 2 | `npx nx run mcp-bench:record-baseline --scorecard tools\mcp-bench\out\b11-cli-smoke\scorecard.json` | n/a | seconds | `baseline\gate-baseline.json` (all rows `recorded-failure`) | step 1 exit 0 or 2 |
| 3 | `npx nx run mcp-bench:gate --scorecard tools\mcp-bench\out\b11-cli-smoke\scorecard.json --bench-exit 0` (expect exit 0, reads `noise-margins.json`) | n/a | seconds | none | step 2 |
| 4 | `npx nx run-many -t typecheck,lint,test -p mcp-bench,@ptah-extension/vscode-lm-tools --skip-nx-cache` with `RG_PATH` (the `vscode-lm-tools` jest run needs the temporary `moduleNameMapper` workaround, see Verification; the 11 baseline-missing cases must now pass) | n/a | 3-5 min | none | step 2 |
| 5 | `npx nx run mcp-bench:bench --host electron --electron-mode launch --smoke --out tools\mcp-bench\out\b11-electron-smoke --skip-nx-cache` | electron (launch, isolated userData) | 45-60 min | `out\b11-electron-smoke\*` | step 0a; clearance; steps 1-4 do not block it but must not overlap (shared corpus) |
| 6 | `npx nx run mcp-bench:bench --host cli-headless --out tools\mcp-bench\out\b11-cli-full-1 --skip-nx-cache` | cli-headless, full | 2.5-3.5 h (estimate) | `out\b11-cli-full-1\*` | step 1 |
| 7 | the same as step 6 for `b11-electron-full-1`, with `--host electron --electron-mode launch` | electron, full | 2.5-3.5 h (estimate) | `out\b11-electron-full-1\*` | steps 0a and 5 |
| 8 (optional) | `npx nx run mcp-bench:measure-noise --from <3 full cli-headless scorecards> --write` (the `--smoke` flag is omitted, so full), and the same for electron | per host | seconds, after runs | `baseline\noise-margins.cli-headless.full.json` and `.electron.full.json` | 3 full runs per host, about 6 h more each |

- **Guard note for Electron:** a desktop Ptah (`Ptah.exe`) is running on this machine, so the Electron guard runs in `process-watch` mode. The launch uses a fresh temp userData, an OS-assigned MCP port and a temp home. It never binds 51820-51822 (it refuses the run if it does). **Attach mode is not part of this plan** and nothing sets `PTAH_BENCH_ELECTRON_URL`.
- **Expected results to verify in each run:**
  - `index-age-24h`:
    - in the Batch 10 noise run 3 the refresh did not start at `indexAgeMs 90005464`; re-check this;
    - quote the DB size, the coverage block and the census.
  - Scenario 8 reset count: in the `transport-idle-gaps` detail.
  - `omittedByCap` and the indexer census for the report: from the `index-age-24h` and `cold-start` details.
  - The expected failures of context.md's evidence table (symbol search, references precision, dependents `building`, edit then query, spool path). An expected loss that passes is reported explicitly: for example `ptah_relevance_rank_files / relevance` passed in the latest smoke (recall@10 0.2125 vs native 0.225, inside the margin).
  - TASK_2026_622 data points: any `host-launch:*` lifecycle row (time to death in its detail), and any `crash-on-shutdown` in `run.hostExit.detail`.
  - `two-workspaces-symbol-scope`: failed in the earlier smoke with `unknown-coverage` from workspace B.
- **Reduced plan if the full-run budget is too large.** Do steps 0a-5 (everything the gate and the Phase 1 review need, about 2.5 h) and one full run per host (steps 6 and 7, about 6 h total). Take the full-mode margins (step 8) only from the three runs if the orchestrator wants them. Until then full mode gets the 0.02 default. The PR gate never reads full-mode margins. The full scorecards are committed as `baseline\scorecard.cli-headless.json` and `baseline\scorecard.electron.json` (with `.md`) as evidence; the gate baseline is the smoke scorecard. The PR timeout stays at 60 min until the first real CI run: the local smoke time cannot stand in for a CI runner.
- **Reducing the Electron cost:** step 5 alone gives the per-host verdicts and the lifecycle rows. Steps 7 and 8 for Electron can be dropped first.

## Files written (absolute, base `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`)

Created:

- `tools\mcp-bench\src\lifecycle\lifecycle-na.ts`
- `tools\mcp-bench\src\lifecycle\lifecycle-probe.ts`

Modified:

- `tools\mcp-bench\src\main.ts`
- `tools\mcp-bench\src\bench-hosts.ts`
- `tools\mcp-bench\src\corpus\corpus.ts`
- `tools\mcp-bench\src\gate\gate.ts`
- `tools\mcp-bench\src\gate\gate-command.ts`
- `tools\mcp-bench\src\gate\baseline.ts`
- `tools\mcp-bench\src\gate\gate.spec.ts`
- `tools\mcp-bench\src\gate\baseline.spec.ts`
- `tools\mcp-bench\src\lifecycle\lifecycle-scenarios.ts`
- `tools\mcp-bench\src\lifecycle\lifecycle-scenarios.spec.ts`
- `tools\mcp-bench\src\scorecard\scorecard.types.ts`
- `tools\mcp-bench\src\scorecard\scorecard-writers.ts`
- `tools\mcp-bench\src\suites\suite-runner.ts`
- `tools\mcp-bench\src\transport\electron-host.ts`
- `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-mandate-manifest.spec.ts`
- `.ptah\specs\TASK_2026_619_af7f\batches.md` was already modified before this batch and is untouched by me.

Phase B will add `tools\mcp-bench\baseline\gate-baseline.json`, the per-host `scorecard.*.json` and `.md`, and optionally the full-mode margins files. No product file under `libs\` or `apps\` was edited. The only `libs` file is the Task 11.2 spec, which batches.md names.

## Verification

- `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache --parallel=2` with `RG_PATH`: all three passed (1m 27s). Jest: 20 suites, 297 tests (292 before). Lint: 0 errors. The 2 warnings are pre-existing: `scip-cross-check.ts` `max-lines` 703, and an unused eslint-disable in `bench-host-process.spec.ts`. The `max-lines` warning that my first edit caused in `lifecycle-scenarios.ts` was removed by the split.
- `npx prettier --check` on every changed file: clean.
- `@ptah-extension/vscode-lm-tools`: typecheck and lint pass (0 errors; 77 pre-existing warnings, none in my change). Jest cannot run through Nx in this worktree: it has no `node_modules`, and the preset's `marked` mapper points inside the worktree. This is not caused by the batch. I ran the new describe by passing the mappers on the command line. If Phase B needs the full `vscode-lm-tools` jest, the orchestrator must run it from a checkout that has `node_modules`, or I use the same CLI override:
  ```powershell
  npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <spec> --coverage=false --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","(^|/)wasm-bundle-dir(.js)?$":"<rootDir>/__mocks__/wasm-bundle-dir.ts"}'
  ```
- Not run (as instructed): any `mcp-bench:bench`, an Electron launch, `record-baseline` on a new run, anything that calls `withPinnedCorpus`.

## Deviations

1. **File count** is larger than the 5 plus 2 that batches.md listed: 15 files in `tools\mcp-bench`, plus the `libs` spec. The additions come from the Electron lifecycle (host, main, hosts, schema, writers, suite verdicts) and per-mode margins (gate and its command). Two new files exist only to keep `lifecycle-scenarios.ts` under the lint ceiling.
2. **Committed scorecard names** are per host (`baseline\scorecard.cli-headless.json`, `baseline\scorecard.electron.json`) instead of the single `scorecard.json` that batches.md names, because two hosts are recorded.
3. **Eligible-file count** is labelled as a raw source count with the indexer census quoted next to it, not recomputed with the indexer's own rules (see above).
4. **Three full runs per host** (about 18 h in total) are proposed as optional. The reduced plan above is the default recommendation.
5. **The lifecycle `na` field** is a new schema addition. The `smoke` field on `run` is another. Both are optional, so every existing scorecard still validates.

## Clarifications Needed

None blocking Phase A. Decisions for the orchestrator before Phase B:

1. Run the reduced plan (steps 0a-7) or add the optional margin runs (step 8, about 12 h more)? Recommended: the reduced plan.
2. Is a full Electron run (step 7) wanted, or only the Electron smoke (step 5)? Recommended: smoke first, then decide from its duration.
3. Clear each real bench with TASK_2026_620 before it starts (they share the corpus path). Step 0a, step 2, step 3 and step 4 do not use the corpus.

## Phase B round 1

Defect: after the Electron `taskkill /T /F` stop, the app's file handles close a moment later, so `rm` of the temp home failed with EBUSY. The failure escaped `runBench` and voided the run (exit 1, no scorecard). `removeDir` and `removeTempHome` only retried 10 x 200 ms (2 s) and then threw.

### Fix

- New `tools\mcp-bench\src\transport\temp-cleanup.ts`, `removeTempDir(path)`:
  - retries any error 20 times, 500 ms apart (about 10 s);
  - never throws; it returns `null`, or `temp folder left: <path>: <last error>`.
- Callers:
  - `electron-host.ts` and `host-launcher.ts` use it for the temp home. Their stop reports gain `tempLeft`. A failed boot logs the leftover and still throws the boot error, and the guard still runs, so a guard error still voids the run.
  - `bench-hosts.ts`: the host record keeps `tempLeft`. `runMetadata` puts `<label>: temp folder left: ...` into `run.hostExit.detail`, and the host logs it. I used the host exit detail, not a lifecycle row, because a row would later show up as "missing" or "new" for the gate.
  - `main.ts`: the scratch folder removal uses the helper and logs the leftover.
  - `corpus.ts`:
    - the lifecycle copy (`withLifecycleCorpus`) uses the helper and warns on stderr;
    - `cleanupCorpusPath` retries its removals;
    - a corpus cleanup failure after a successful run no longer throws away the scorecard: it is warned on stderr and the next run's stale-worktree sweep removes the folder. A failure after a run error still appends to that error as before.
- Other places an `rm` error could escape `runBench`, and what I found:
  - the polyglot worktree removal already had `.catch(log)`;
  - the stale sweep already swallowed errors;
  - the restart scenario only stops hosts, whose stop now never throws on cleanup;
  - `bench-hosts.ts` removing the cached polyglot clone (`rm(cache...)`) runs before a re-clone and fails loudly by design (no temp folder).
- Guard errors are untouched: they still propagate and void the run.

### Specs

- `transport\temp-cleanup.spec.ts`:
  - EBUSY twice and then success removes the folder (3 calls, two 500 ms waits, nothing reported);
  - EBUSY forever is reported as `temp folder left: ...` after every attempt, without throwing.
- `bench-hosts.spec.ts`: a left folder is recorded in `run.hostExit.detail` and the exit kind is unchanged, so the run continues.
- The stop-report fixture in `bench-hosts.spec.ts` gained `tempLeft: null`.

### Verification

No bench or Electron was run.

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src` with `RG_PATH`: 21 suites, 318 tests passed.
- `npx nx run mcp-bench:typecheck`: passed.
- `npx nx run mcp-bench:lint`: 0 errors, 3 warnings (the earlier 2, plus one more that I did not look into).
- `npx prettier --check tools/mcp-bench/src`: clean.

### Files

Created in `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src`:

- `transport\temp-cleanup.ts`
- `transport\temp-cleanup.spec.ts`

Modified in the same base folder:

- `transport\electron-host.ts`
- `transport\host-launcher.ts`
- `bench-hosts.ts`
- `bench-hosts.spec.ts`
- `main.ts`
- `corpus\corpus.ts`

Not committed.
