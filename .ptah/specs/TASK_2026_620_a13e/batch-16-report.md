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

| File                                     | Responsibility                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-path-guard.ts` + `.spec.ts`        | Parent read guard (R10). Allows only committed repo files and the bench data folder; refuses the real `~/.ptah` first. Exports `listCommittedFiles(git)` and the `GitRunner` type.                                                                                                              |
| `run-memory-skills.ts` + `.spec.ts`      | Orchestration `runMemorySkills(options, deps)`: plan → `launchBenchHost` → offline suites inside the window → poll for completion → stop → 619 writers → CI gate.                                                                                                                               |
| `run-memory-skills.entry.ts`             | CLI composition root. Parses argv with `node:util parseArgs`, resolves `resolveBenchDataDir({create:true})` in the parent, and wires `launchBenchHost`, `startNetRecorder` and git through `execFileSync` with an argument array and a 30 s timeout. Holds the empty `OFFLINE_SUITES` registry. |
| `runner-plan.ts`                         | `620.runner-plan.v1` zod schema, `parseRunnerPlan`, `MemorySkillsRunError`, and the constants `COMMITTED_FIXTURES_DIR` and `KNOWN_FAILURES_FILE`.                                                                                                                                               |
| `offline-suites.ts`                      | Offline-suite contract (`MemorySkillsOfflineSuite`, `OfflineSuiteContext`), the registry check, and the sequential runner.                                                                                                                                                                      |
| `host-completion-reader.ts`              | Polls `<runDir>/host-completion.json` and validates it with zod.                                                                                                                                                                                                                                |
| `run-scorecard.ts`                       | Suite collection, `cost.source`, the zero-cases rule, `projectionSha256`, and the per-case runtime summary. Also assembles the product, corpus, guard and artefact parts of the scorecard.                                                                                                      |
| `suite-result.ts` + `.spec.ts`           | `620.suite-result.v1` file contract (`<id>.suite.json` + `<id>.cases.jsonl`), shared by host and offline suites.                                                                                                                                                                                |
| `case-runner.ts` + `.spec.ts`            | `runCaseWithSafetyCap`: 120 s cap, one retry on `safety-cap` (R11), and the runtime of each attempt.                                                                                                                                                                                            |
| `ground-truth-freshness.ts` + `.spec.ts` | Refuses dirty or uncommitted ground truth, and ground truth committed after its first scored run.                                                                                                                                                                                               |

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

## Review fixes

Source: `code-logic-review-phase3-4.md` (APPROVED with findings), one correction round on top of
`44a3329c4`. No git state changed; nothing committed; no 619-owned file edited; no bench run.

Files (all MODIFIED, under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`):
`host\fixture-seeder.ts` + `.spec.ts`, `host\plan.schema.ts` + `.spec.ts`,
`runner\read-path-guard.ts` + `.spec.ts`, `runner\ground-truth-freshness.ts` + `.spec.ts`,
`runner\run-memory-skills.ts` + `.spec.ts`, `runner\run-scorecard.ts`.

| Finding                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pinned by                                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (moderate) seeder: isolated home equal to `~/.ptah` | The constructor now refuses a home that is, lies in, or contains the real `~/.ptah`, or contains the real home. Checked on the given paths and on resolved real paths (`resolveRealPath`), case-folded on win32 by 619's `isSamePath`/`isPathInside`.                                                                                                                                                                                                                                        | `fixture-seeder.spec.ts`: "refuses an isolated home that is the real ~/.ptah or holds it" (equal, inside, holding, and a junction to it); "compares … case-insensitively on win32"                                                |
| 2 (moderate) guard TOCTOU                             | Fail closed at read time. `readText`/`readBytes` of a repo file read the bytes first, then run `git status --porcelain=v1 -z --untracked-files=all -- :(literal)<path>` for that one path. Any output means the read is refused ("changed in the working tree since the run started"). I chose this over a blob-hash compare because git applies its own `autocrlf`/filter normalisation, so a hash compare could falsely refuse on Windows checkouts. `git` is now a required guard option. | `read-path-guard.spec.ts`: "refuses a committed file edited after the guard was built (mid-run edit)"; the read test asserts the exact literal-pathspec git call                                                                  |
| 3 (moderate) non-CI exit code                         | Every plan suite without a result is now a `problems` line in every mode, so the exit code is 1. This covers a suite error (a `ReadPathRefusedError` inside an offline suite included), an invalid result, a skipped or unrun suite, and an incomplete host. The scorecard and `run-summary.json` are still written. The known-failures ratchet stays `--ci` only.                                                                                                                           | `run-memory-skills.spec.ts`: "fails a non-CI run whose offline suite was refused a read" (`gate` null, exit 1, problem names the refusal); "reports a host suite error as missing, writes the scorecard and exits 1 outside --ci" |
| 4 (moderate) ledger last-write-wins                   | The ledger is now `<bench>/runs/first-scored-runs/<sha256(id)>.json`, one create-once file per id. Each entry is written fully to a unique temp file, published with `linkSync` (atomic; `EEXIST` means another run was first, and its entry wins), and the temp file is unlinked in `finally`. There is no existence pre-check, so a run with a stale view takes the same path. No run ever rewrites another id's file. A malformed entry, or one in the wrong file, fails closed.          | `ground-truth-freshness.spec.ts`: "never rewrites another id and keeps the first publisher on a race" (stale second run: gt-a stays `ms-a` byte-for-byte, gt-b added, no `.tmp` left)                                             |
| 5 (minor) seeder real path vs lexical roots           | The resolved source is now compared against the resolved allowed roots and against both `~/.ptah` and its real path.                                                                                                                                                                                                                                                                                                                                                                         | "accepts a source reached through a linked allowed root (5b)"; "refuses a source in the target of a linked ~/.ptah (5a)"                                                                                                          |
| 6 (minor) run-dir reads bypass the guard              | Fixed. `collectSuites` calls `guard.assertReadable` on both suite files before reading them. `runArtifact` and the scorecard hash read through `guard.readBytes`. `sha256File` was deleted from `run-scorecard.ts`.                                                                                                                                                                                                                                                                          | No dedicated test: planting a file symlink on Windows needs privilege. The guard's link refusal is covered by `read-path-guard.spec.ts`                                                                                           |
| 7 (minor) record cassette in committed fixtures       | `plan.schema.ts` now refuses, in `record` mode, a cassette path inside `committedFixturesDir` (replay may still read committed cassettes).                                                                                                                                                                                                                                                                                                                                                   | `plan.schema.spec.ts`: "refuses a record-mode cassette in the committed fixtures"; the record-mode acceptance test now uses bench cassettes                                                                                       |
| 8 (minor) `--workspace` under `~/.ptah`               | `runMemorySkills` refuses, before the run directory is created, an explicit workspace that is, lies in, or holds the real `~/.ptah`. This is checked lexically and on real paths.                                                                                                                                                                                                                                                                                                            | "refuses a --workspace that is, lies in or holds the real ~/.ptah" (no launch)                                                                                                                                                    |
| 9 (minor) unpinned behaviours                         | Tests only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | "keeps a crash-on-shutdown run at exit 0 with its suite results"; "restores a previous value after a successful launch"; "removes the variable when the launch throws"                                                            |
| 10 (minor) retry `stop()` masks the error             | The window tracks whether its own `stop()` already ran. If it did, that error (the guard trip) is rethrown as itself and stop is not retried. Otherwise the retry stop runs. If the retry rejects too, the runner throws an `AggregateError([windowError, stopError])` with `cause: stopError`, so `errors[0]` is the original error.                                                                                                                                                        | "keeps the window error and the stop error when the retry stop rejects"; "reports a guard trip in the normal stop as itself, stopping once"                                                                                       |

Deferred: none; findings 6 and 7 were each a few lines and are fixed.

Behaviour change to note: the first-scored ledger moved from `runs/first-scored-runs.json` to the
directory `runs/first-scored-runs/`. No real scored run has happened yet, so there is nothing to
migrate.

Process note: my first `prettier --write` pass in this round included untracked files, among them
the reviewer's `code-logic-review-phase3-4.md`. Because that file is untracked I cannot tell whether
prettier reformatted it. Its content is the reviewer's; please check it if the exact bytes matter.

Check results (this round):

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` →
  `Test Suites: 36 passed, 36 total` / `Tests:       419 passed, 419 total`
- `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache` →
  `NX   Successfully ran targets typecheck, lint for project mcp-bench`. `npx eslint` on
  `memory-skills/runner` and `memory-skills/host` reports 0 problems.
- `npx prettier --check --ignore-unknown <changed files>` → `All matched files use Prettier code style!`

## Phase 3.4 close (orchestrator)

Re-review `code-logic-review-phase3-4-r2.md`: APPROVED (8/10), all 10 findings closed. Revise cap
used; two new minor items are carried as known, not fixed in this phase:

- N1 `runner/read-path-guard.ts:222-238`, `run-memory-skills.ts:521`: the read-time re-check uses
  `git status`, so a label file COMMITTED mid-run passes; the run can score new-HEAD bytes under the
  run-start HEAD. The ground-truth ratchet catches it on the next run. Fix candidate: compare the
  blob hash against the run-start HEAD.
- N2 `host/fixture-seeder.ts:164`: the source re-check hardcodes `realpathSync.native` while the
  constructor honours the injected `realpath` option (spec-facing only).

## 619 export adoption

This round adopts 619 Batch 9.0 (`ea2f92fd2`), rebased under 620 at `4d3d0dd5d`. I did not edit any 619 file. There were no git state changes, no commit, and no bench or host launch.

Files (MODIFIED, all under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`):

- `runner\suite-result.ts` and `.spec.ts`
- `runner\run-memory-skills.ts` and `.spec.ts`
- `runner\run-memory-skills.entry.ts`
- `host\memory-skills-host.entry.ts`
- `suites\memory\extraction.suite.ts` (one claim fix, see below)

1. **Suite schema.** `suite-result.ts` no longer mirrors 619's suite fields.
   - **How it validates:** `suiteResultSchema` now does two things. It parses the 620-only envelope (`schemaId`, `suiteId`, `modelCalls`, `metrics`, `cassetteVersion`). It hands every other field to 619's `suiteCoreSchema`.
   - **`cost.source`:** the runner still sets this, so the schema refuses it from a suite. A placeholder value is supplied only for the core parse and then dropped.
   - **`projectionSha256`:** the runner sets this too, so a suite may not supply it. Unknown top-level keys are also refused.
   - **Types:** `SuiteResult` is the envelope plus `SuiteResultCore`, which is `SuiteView` without `projectionSha256` and with `cost` without `source`.
   - **Kept as before:** the file format, `writeSuiteResult` and `readSuiteResult`.
   - **Differences from the mirror:**
     - Nested unknown keys (for example an extra key inside `claim`) are now stripped by 619's non-strict core instead of refused.
     - 619's kind-independent rules now apply at suite-write time instead of only at scorecard-write time: duplicate baseline ids, deltas that name unknown baselines, `naReason` only on `na`, and a `prompt` claim ref must be `ptah-core-prompt.ts:<line>`.
     - New spec: "validates the core fields with 619's suiteCoreSchema and refuses runner-set or unknown keys".
   - **Latent bug the stricter check surfaced:** `mem.extraction` declared `claim.source: 'prompt'` with a ref in `extract-prompt.ts`. 619's scorecard writer would have rejected that claim at the end of every real run, so a real extraction run would have failed when writing the scorecard. I changed it to `source: 'code'`, with a comment, because that ref points at product code. The projection hash is unchanged: `claim` is not projected, and the extraction projection spec passes.
2. **Plan env var.** `launchWithPlan`, which set and restored `process.env`, is deleted, along with the `env` field of `RunMemorySkillsDeps` and its entry wiring.
   - The runner now calls `deps.launch({ ..., env: { PTAH_BENCH_MEMORY_SKILLS_PLAN: <host-plan.json> } })`. 619 merges this after the isolation and refuses isolation keys. `PTAH_BENCH_MEMORY_SKILLS_PLAN` is not an isolation key.
   - The two specs now prove that `process.env` is never mutated:
     - "leaves process.env untouched during and after a successful launch";
     - "leaves process.env untouched when the launch throws".
   - The fake launcher reads the plan path from `options.env`, and the empty-plan test asserts `options.env`.
3. **Host process helpers.** `memory-skills-host.entry.ts` now imports `FORCED_EXIT_AFTER_MS`, `readWorkspaceArg`, `shutdownRequested` and `describeFailure` from `transport/bench-host-process.ts`. Its local copies are deleted: `UsageError`, `readWorkspaceArg`, `shutdownRequested`, `describeFailure` and the `FORCED_EXIT_AFTER_MS` constant.
   - **Wire behaviour:** the ready, complete and fatal lines, exit codes 0, 1 and 2, the 20 s forced exit and the shutdown triggers are all unchanged.
   - **Visible text changes (619's shared helpers):**
     - the usage message reads `usage: bench-host --workspace …` instead of `memory-skills-host`;
     - the boot-cause stderr prefix is `[bench-host]` instead of `[memory-skills-host]`.

Not mine: an untracked `apps/ptah-electron/src/windows/.shell-security-QReE6X/` appeared in the worktree during this round. I left it alone.

Check results (this round):

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` gives `Test Suites: 51 passed, 51 total` and `Tests:       579 passed, 579 total`. These counts include the suites of later batches now on the branch.
- `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache` gives `NX   Successfully ran targets typecheck, lint for project mcp-bench`. `npx eslint` on `runner`, `host` and `extraction.suite.ts` reports 0 problems.
- `npx nx run mcp-bench:build-host-memory-skills` gives `NX   Successfully ran target build-host-memory-skills for project mcp-bench and 33 tasks it depends on`.
- `npx prettier --check --ignore-unknown <changed files>` gives `All matched files use Prettier code style!`
