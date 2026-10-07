# Batch 16 report — runner CLI and parent read-path guard

Executor: backend-developer sub-agent, working in the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench` on branch
`feat/task-620-memory-skills-bench`. I ran no git write command, committed nothing, and left the
working tree dirty. I edited no 619-owned file (`scorecard/`, `transport/`, `corpus/`,
`bench-data.ts`). I did not touch `ground-truth/` or `fixtures/`, and I did not call `withPinnedCorpus`.

## Files

All paths are under
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\`.

### Task 16.1 (all files CREATED, under `src\memory-skills\runner\`)

| File | Responsibility |
|---|---|
| `read-path-guard.ts` + `.spec.ts` | Parent read guard (R10). Allows only committed repo files and the bench data folder; refuses the real `~/.ptah` first. Exports `listCommittedFiles(git)` and the `GitRunner` type. |
| `run-memory-skills.ts` + `.spec.ts` | Orchestration `runMemorySkills(options, deps)`: plan → `launchBenchHost` → offline suites inside the window → poll for completion → stop → 619 writers → CI gate. |
| `run-memory-skills.entry.ts` | CLI composition root. Parses argv with `node:util parseArgs`, resolves `resolveBenchDataDir({create:true})` in the parent, and wires `launchBenchHost`, `startNetRecorder` and git through `execFileSync` with an argument array and a 30 s timeout. Holds the empty `OFFLINE_SUITES` registry. |
| `runner-plan.ts` | `620.runner-plan.v1` zod schema, `parseRunnerPlan`, `MemorySkillsRunError`, and the constants `COMMITTED_FIXTURES_DIR` and `KNOWN_FAILURES_FILE`. |
| `offline-suites.ts` | Offline-suite contract (`MemorySkillsOfflineSuite`, `OfflineSuiteContext`), the registry check, and the sequential runner. |
| `host-completion-reader.ts` | Polls `<runDir>/host-completion.json` and validates it with zod. |
| `run-scorecard.ts` | Suite collection, `cost.source`, the zero-cases rule, `projectionSha256`, and the per-case runtime summary. Also assembles the product, corpus, guard and artefact parts of the scorecard. |
| `suite-result.ts` + `.spec.ts` | `620.suite-result.v1` file contract (`<id>.suite.json` + `<id>.cases.jsonl`), shared by host and offline suites. |
| `case-runner.ts` + `.spec.ts` | `runCaseWithSafetyCap`: 120 s cap, one retry on `safety-cap` (R11), and the runtime of each attempt. |
| `ground-truth-freshness.ts` + `.spec.ts` | Refuses dirty or uncommitted ground truth, and ground truth committed after its first scored run. |

### Task 16.2

- MODIFIED `project.json`: one target added, `bench-memory-skills`, and no other line changed.
- MODIFIED `src\memory-skills\data\verify-candidate-manifest.ts`. `BenchDataRules` now includes `env`, and `resolveEntryBenchDataDir(benchDataDir?, rules?)` was added. It is a thin adapter over 619's `resolveBenchDataDir()` with no rules of its own. `benchDataDir` is now optional.
- MODIFIED four more entry points to the same `benchDataDir?` default, removing the inline `{ PTAH_MCP_BENCH_DATA_DIR: explicit }` env override:
  - `src\memory-skills\data\candidate-row-diff.ts`
  - `src\memory-skills\data\sample-sessions.ts`
  - `src\memory-skills\labelling\select-rubric-sample.ts` (net line count unchanged, so the file is still at 706)
  - `src\memory-skills\labelling\build-labelling-packet.ts`
- MODIFIED `src\memory-skills\data\verify-candidate-manifest.spec.ts`. Two tests added: the default comes from `PTAH_MCP_BENCH_DATA_DIR` and an explicit dir wins; the default path still refuses the real `~/.ptah`.

## Design notes

**Flow (`run-memory-skills.ts` header, steps 1–7)**

1. **Read and check the plan.**
   - The plan file is read through the read-path guard, so it must be a committed repo file or a file in the bench data folder.
   - Unknown offline suite ids are refused before launch. Host suite ids are refused by the host itself before boot (Batch 15).
   - Every plan suite must name `groundTruth: {id, paths[]}`.
2. **Create the run directory and the plans.**
   - The run directory is `<bench>/runs/<runId>`, created with a non-recursive `mkdir`, so an existing directory is refused.
   - `runner-plan.json` is written, then `host-plan.json`. The host plan is built with the parent-resolved `benchDataDir`, `runDir`, `realHome` and `committedFixturesDir`, and validated with the host's own `createMemorySkillsPlanSchema` before it is written.
   - Default cassettes are empty files under `<runDir>/cassettes/`. The default workspace is an empty `<runDir>/workspace`.
3. **Launch the host.**
   - `PTAH_BENCH_MEMORY_SKILLS_PLAN` is set in `process.env` only around `launchBenchHost`, which spreads the parent env into the child at spawn, then restored.
   - The launch passes `guard: { ci }`.
4. **Inside the launcher window.**
   - Offline suites run in plan order, with `context.read` set to the guard.
   - In `--ci`, the parent net recorder (Batch 14) is started before the offline suites and stopped right after them. It is not active while the launcher's loopback `tools/list` probe runs.
   - `context.guardWorkerEntry()` maps to `recorder.guardedWorkerEntry(entry, 'offline-worker')` (Batch 14 note).
   - An offline suite that reports `modelCalls > 0` is recorded as an error, because offline suites are model-free.
5. **Collect the host result.**
   - The runner polls `host-completion.json` (Batch 15 note), with a 500 ms interval and a 4 h default timeout (`--host-timeout-ms`).
   - It stops polling as soon as `exitedEarly()` is set.
   - `host.stop()` always runs: an error in the window stops the host, then rethrows. A spec covers this.
6. **Build the scorecard.** Every suite's files are read back with zod (`suite-result.ts`). Then:
   - **`cost.source`** is `none` when `modelCalls` is 0. Otherwise it is `cassette` in replay mode and `live` in record mode.
   - **Zero executed cases** turn a non-`na` verdict into `na: zero-cases` (R-L5a).
   - **`projectionSha256`** comes from Batch 12's `computeSuiteProjectionSha256` and covers the final verdict.
   - **Missing suites** (host error or skip, host incomplete, invalid files) are listed in `run-summary.json` and in the gate. They are not in the scorecard, because the core schema needs `kind`, `claim` and `groundTruth`, which a missing suite does not have.
   - **The scorecard** is written with 619's `writeScorecardJson` and `writeScorecardMarkdown` into the run directory. The 620 kinds are registered by importing `memory-skills-suite-kinds`.
7. **CI gate (`--ci`).**
   - `evaluateKnownFailures` (Batch 13) runs over every plan suite.
   - Entries come from the committed `tools/mcp-bench/fixtures/memory-skills/known-failures.v1.json`. If the file is missing, the entry list is empty. If it exists but is uncommitted, the guard refuses it.
   - Signals: cassette-miss cases, and network hits from both the host completion and the parent recorder.
   - The result is written to `gate.json`.
   - Last, `recorder.failIfAny(...)` throws on any parent outbound attempt, after every artefact is on disk (Batch 14 note).

**Other behaviour**

- **Exit code.** It is 1 when:
  - the CI gate failed;
  - there is no host completion; or
  - `hostExit` is `exited-early` or `killed`.

  `crash-on-shutdown` stays a run fact (TASK_2026_622) and does not fail the run.
- **Per-case runtime.** `latencyMs` is required on every case line, and the optional `attempts` is 1 or 2. `run-summary.json` records per suite `maxCaseLatencyMs`, `safetyCapCases` and `retriedCases`, which Batch 24 needs.
- **Safety cap.** `runCaseWithSafetyCap` aborts the attempt's `AbortSignal` with reason `safety-cap` and retries once. A second cap returns `outcome: 'safety-cap'`. Other errors propagate without a retry. An abandoned attempt's settlement is swallowed rather than left unhandled.
- **Read-path guard.** Rules are checked lexically (619's `isPathInside`/`isSamePath`, case-folded on win32) and again on `realpath`, using the nearest existing ancestor. Specs show that a junction in the bench folder into `~/.ptah`, or out of the bench folder, is refused. A committed file means it is in the `HEAD` tree and not in `git status --porcelain=v1 -z --untracked-files=no`; renames drop both names.
- **Host-only imports.** The runner never value-imports `host/memory-skills-host.ts`, `ground-truth/seeded-session-generator.ts` or `baselines/retention-policy-defaults.ts`.
  - The completion file and schema names are literals typed as `typeof Host.HOST_COMPLETION_FILE`, so the compiler keeps them in sync.
  - The bundle `dist/tools/mcp-bench/run-memory-skills.mjs` contains no `@ptah-extension/*` import and no memory-curator code. platform-core is bundled, and `picomatch` and `zod` stay external.
  - `host-only-imports.spec.ts` passes.
- **Bench target.** The target is `nx:run-commands` with `dependsOn: build-host-memory-skills`. It runs two commands in sequence: an esbuild CLI bundle of the entry, and `node dist/tools/mcp-bench/run-memory-skills.mjs`, which receives the forwarded args.
  - The banner is the same `createRequire` banner as the host bundles. Without it, the net recorder's `__require("node:dns")` would throw in ESM.
  - `tsx` is not installed, so the 619/host esbuild pattern was used.

## Checks

- **Scoped jest:** `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` → `Test Suites: 36 passed, 36 total` / `Tests: 405 passed, 405 total`.
- **Typecheck and lint:** `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache` → `NX   Successfully ran targets typecheck, lint for project mcp-bench`. Lint reports 0 errors and 2 warnings, both pre-existing and outside this batch: `corpus.ts:36 no-useless-assignment` and `select-rubric-sample.ts` max-lines 706, which was already 706.
- **Host build:** `npx nx run mcp-bench:build-host-memory-skills` → `NX   Successfully ran target build-host-memory-skills for project mcp-bench and 33 tasks it depends on`.
- **Prettier:** `npx prettier --check --ignore-unknown <all changed and new files>` → `All matched files use Prettier code style!`
- **project.json diff:** `git diff tools/mcp-bench/project.json` shows one hunk `@@ -239,6 +239,20 @@`, with 14 added lines (the `bench-memory-skills` target only) and no removed lines.
- **Empty-plan bench run.** This was the allowed verification:
  - Setup: a fresh temp dir `C:\Users\abdal\AppData\Local\Temp\ptah-620-b16-bench-97e9c9fa` (not a junction), with `PTAH_MCP_BENCH_DATA_DIR` pointing at it and plan `{"schemaId":"620.runner-plan.v1"}` inside it. No corpus worktree was involved.
  - Command: `npx nx run mcp-bench:bench-memory-skills --skip-nx-cache -- --plan <that plan>`.
  - stdout: `{"benchMemorySkills":"ok","runId":"ms-20261007T000835Z-6b2f00",...,"hostExit":"clean","suites":[],"gate":null,"problems":[]}`, then `NX   Successfully ran target bench-memory-skills for project mcp-bench and 34 tasks it depends on`, exit 0.
  - Run directory: `host-completion.json`, `host-plan.json`, `run-summary.json`, `runner-plan.json`, `scorecard.json`, `scorecard.md`, `workspace/`.
  - Scorecard `run`: `guardMode: process-watch` (Ptah.exe was running), `guard.partial: false`, `hostExit: clean`, `os: win32`.
  - Scorecard `product`: `{version: 0.1.70, commit: 4e7feb97…-dirty}`.
  - Scorecard `corpus`: `eligibleFiles: 45`.
- **Empty plan with `--ci` (built runner, second fresh temp dir).** This was refused before spawn by 619's guard: `ConcurrentWriterError: … CI=true forces the hash guard, which cannot pass with a concurrent writer … Ptah.exe 6872 holds C:\Users\abdal\.ptah\state\ptah.sqlite`. That is the intended behaviour, because `--ci` passes `guard.ci`. So `--ci` cannot run locally while the desktop app is open, and the parent recorder path was not exercised end to end. The banner that the path needs is present on bundle line 1.
- **Cleanup.** All three temp bench dirs were deleted afterwards. `ptah_get_diagnostics` was not run; `tsc --noEmit` on the project reported 0 errors.

## Deviations

1. **Extra files beyond the four listed.** These are `run-memory-skills.entry.ts`, `runner-plan.ts`, `offline-suites.ts`, `host-completion-reader.ts`, `run-scorecard.ts`, `suite-result.ts` (+spec), `case-runner.ts` (+spec) and `ground-truth-freshness.ts` (+spec).
   - The first single-file version was 932 lines, against the 700-line max-lines rule.
   - Host suites (Batches 17–23) must import `suite-result.ts` and `case-runner.ts` without pulling in the launcher.
   - The entry follows the Batch 15 split between composition root and testable logic.
2. **Ground-truth "version" interpretation.**
   - "First scored run of that version" is keyed by the versioned ground-truth id from the plan (for example `gt-memory@v1`). The ledger is `<bench>/runs/first-scored-runs.json`, which is private and kept per machine.
   - In CI the bench folder is fresh, so the newer-than check has nothing to compare against there. The uncommitted-labels refusal still applies.
   - The ground-truth commit is recorded in `run-summary.json`, which is hashed into the run directory, because the scorecard core has no field for it.
3. **Every plan suite must declare `groundTruth`**, so the freshness check cannot be bypassed by leaving it out.
4. **The scorecard goes to the private run directory only.** The committed per-release copy under `tools/mcp-bench/reports/memory-skills/<version>/` (design 6.5) is not written; that belongs to a later batch, such as Batch 24 or 25.
5. **Choices made by me, not by the plan:**
   - product version from `apps/ptah-electron/package.json`;
   - `corpus.eligibleFiles` = the count of committed files under `fixtures/memory-skills/`;
   - `corpus.tsVersion` = the TypeScript range in the root `package.json`.
6. **Known-failures path.** `tools/mcp-bench/fixtures/memory-skills/known-failures.v1.json`: 619 answer 3 overrides the design's `fixtures/task-620/`. The file does not exist yet.
7. **16.2: nothing left to delete.** The Batch 8/9 local guard (`assertSafeBenchDataDir` etc.) was already deleted in the Phase-1 revise round. What remained, the mandatory explicit `benchDataDir` re-fed as an env override, is now an optional argument that defaults to `resolveBenchDataDir()`.

## Requests to 619

1. **Export the suite schema.** Export the per-suite zod schema from `scorecard.types.ts`, either `createSuiteSchema` or a core-fields schema without `kind`-dependent checks. `suite-result.ts` mirrors those fields today (minus `cost.source` and `projectionSha256`), and the writers re-validate. An export would remove the mirror.
2. **An `env` option on `launchBenchHost`.** The runner currently sets `PTAH_BENCH_MEMORY_SKILLS_PLAN` in `process.env` around the call and restores it afterwards, because `isolatedEnv` reads `process.env`. An explicit option would remove that mutation.
3. **Confirm the `guard.ci` semantics.** The runner's `--ci` passes `guard: { ci: true }`. Confirm this is intended for the memory-skills CI job (Linux runner, no desktop app).
4. **Already raised by Batch 15:** export the bench-host argument and shutdown helpers.
5. **Team-leader: report the commit SHA to 619.** The `bench-memory-skills` target was added to `tools/mcp-bench/project.json`, and 619 must receive that commit's SHA once it exists.

## Out of scope / not done

- `OFFLINE_SUITES` and `HOST_SUITES` are empty; Batches 17–23 register suites there.
- `.github/workflows/memory-skills-bench.yml` (design 7) is not part of this batch.
