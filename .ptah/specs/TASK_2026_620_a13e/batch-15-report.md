# Batch 15 report — memory-skills bench host

Executor: backend-developer sub-agent. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`, branch `feat/task-620-memory-skills-bench` (on 619 4c `d716e0e8f`). No git commands run; working tree left dirty.

## Task 15.1 — Host entry and plan schema

Files (all under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\host\`):

- CREATED `plan.schema.ts` — zod plan `620.host-plan.v1` and `loadMemorySkillsPlan()`, read from `PTAH_BENCH_MEMORY_SKILLS_PLAN`.
- CREATED `plan.schema.spec.ts` (20 tests).
- CREATED `fixture-seeder.ts` — copies `database` / `file` / `directory` fixtures into the isolated home.
- CREATED `fixture-seeder.spec.ts` (11 tests, real temp filesystem, junctions).
- CREATED `doubles-override.ts` — registers `RecordedCuratorLlm` / `RecordedLaneRunner` for `CURATOR_LLM` / `LANE_RUNNER_SERVICE`, then verifies both resolve to the doubles.
- CREATED `doubles-override.spec.ts` (6 tests, real tsyringe child container).
- CREATED `memory-skills-host.ts` — `runMemorySkillsHost(deps)`. Every process collaborator is injected (isolation check, boot helper, shutdown signal, net recorder, wire writer).
- CREATED `memory-skills-host.spec.ts` (11 tests, injected fake boot that follows the `bootCodeExecutionHost` hook order; no engine is spawned).
- CREATED `memory-skills-host.entry.ts` — the composition root. It wires 619's `assertIsolatedEnvironment` and `bootCodeExecutionHost`, the Batch 14 `startNetRecorder`, and an empty `HOST_SUITES` registry that Batches 17-23 fill.

### Evidence: 4c API check (validation note)

`transport/bench-host-boot.ts` at `d716e0e8f` matches context.md:
- `assertIsolatedEnvironment(env?, probe?) → IsolatedPaths {home, userDataPath, dbPath}`.
- `bootCodeExecutionHost({workspace, beforeEngineBoot?, afterContainerReady?}) → BenchHostHandle {port, workspaceRoot, isolation, container, stop()}`.
- Hook order: isolation → beforeEngineBoot → engine → afterContainerReady → MCP (lines 244-302).

Assumption verified.

### Behaviour and risks handled

- **Order.** The host runs `assertIsolated()` first, then reads the workspace argument, then the plan. A plan that names a suite with no host registration, or a host registry with a duplicate id, is refused before boot.
- **Plan paths.** These are resolved by the parent: `benchDataDir`, `runDir`, `realHome`, and optionally `committedFixturesDir`. The child cannot resolve them itself because its `HOME` and `LOCALAPPDATA` point at the temp home (`bench-data.ts` header). The schema refuses:
  - a bench dir or fixtures dir in the real `~/.ptah`;
  - a `runDir` that is not strictly inside `benchDataDir`;
  - any fixture or cassette source outside the allowed roots or in the real `~/.ptah`;
  - targets that are absolute or contain `..`;
  - duplicate targets or nested targets (case-folded on win32);
  - more than one database fixture, or duplicate suite ids;
  - CI with a mode other than `replay`;
  - curator faults in record mode;
  - one file shared by both cassettes;
  - a plan file outside `benchDataDir`.
- **Seeder.** Runs only in `beforeEngineBoot`. It copies and never opens a fixture in place. It refuses:
  - a source in the real `~/.ptah`. This is checked lexically and again on `realpathSync.native`, so a junctioned ancestor is caught. That matters because 619 4c does not follow junctions.
  - a symlink or junction as the source or anywhere inside a copied tree;
  - a database with a non-empty `-wal` or any `-journal` sidecar;
  - an existing target (it never overwrites);
  - a target that escapes the home;
  - a real home that overlaps the isolated home.
  It hashes the source before and after the copy, and hashes the copy. Directory hash = sha256 over the sorted lines `relPath\0sha\n`.
- **Doubles.** In replay the real adapters are never resolved, so they are never constructed. The spec registers throwing factories and asserts they were never called. An unrecorded call raises `CassetteMissError`. Record mode resolves the real adapter and wraps it, and refuses if the adapter is missing. Only these two tokens are registered.
- **Completion before shutdown (622 crash constraint).**
  - Suites run one at a time in plan order. A throwing suite is recorded as `error` and the next suite still runs.
  - Once shutdown is requested, the remaining suites are recorded as `skipped: shutdown-requested`.
  - `<runDir>/host-completion.json` is written atomically (tmp file, then rename) and announced as `{"benchHost":"complete",...}`. Both happen before the host waits for stdin EOF and calls `host.stop()`, so a crash while SQLite closes loses no result.
  - A run dir that already holds a completion is refused.
- **CI.** The net recorder wraps suite execution, with its log at `<runDir>/net-recorder.log`. Recorded attempts give `status: 'net-violation'`. The recorder's patches are restored in `finally`.
- **Fake-scheduler assumption (Batches 18/22).** Suites run strictly sequentially in one process, so a suite can install process-wide timers for its own duration and must restore them in its own `finally`. However, no fake-timer library is a declared dependency: `@sinonjs/fake-timers` is only transitive via jest. Batches 18/22 should either use the product's injected clocks, or ask for a dependency decision.

## Task 15.2 — Host build target

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\project.json`. I added only `build-host-memory-skills`; `git diff --stat` shows `72 insertions(+)` and no deletions.
- The target is modelled on `build-host-bundle` (same alias, banner and externals). Two differences:
  - `deleteOutputPath: false`;
  - `dependsOn: ["build-host"]`, so `bench-host.mjs`, the workers and the wasm sit next to `memory-skills-host.mjs`, and the bundle step's output wipe runs first.
- `bench-memory-skills` was NOT added; it belongs to Batch 16.
- The team-leader should tell 619 the commit SHA.

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host --runInBand` → 4 suites, 48 tests passed.
- `npx eslint tools/mcp-bench/src/memory-skills/host` → 0 problems. eslint on `project.json`: "File ignored" warning only.
- `npx nx run mcp-bench:typecheck --skip-nx-cache` → Successfully ran.
- `npx nx run mcp-bench:lint` → 0 errors, 2 warnings, both pre-existing and outside this batch (`corpus.ts:36`, `select-rubric-sample.ts` max-lines).
- `npx prettier --check --ignore-unknown <host/*.ts> tools/mcp-bench/project.json` → clean. `--write` was run on the listed files only, never on a directory.
- `npx nx run mcp-bench:build-host-memory-skills` → success; `dist/tools/mcp-bench/memory-skills-host.mjs` was produced.
- **Smoke** (throwaway driver bundled outside the repo; it does not use `withPinnedCorpus`). It called `launchBenchHost({hostScript: memory-skills-host.mjs})` with an empty CI replay plan and the real `resolveBenchDataDir()`. Results:
  - guard `process-watch` (Ptah.exe was running), cold start 1.4 s;
  - completion `{status: complete, suites: [], net.attempts: []}`;
  - stop `{exitCode: 0, killed: false, isolatedDbCreated: true}`, with the guard passing;
  - `hostExit.kind = clean`.
  The driver and smoke run dirs were deleted afterwards.
- **Bug found by the smoke and fixed.** The first smoke run died right after the ready line. The host passed `dir: <runDir>/net-recorder` to `startNetRecorder`, which writes its guard module into `dir` without creating it, so the write failed with ENOENT. The host now creates the directory. A new spec uses the real recorder and covers this; the fake recorder in the other spec had hidden it.

## Incident: `withPinnedCorpus` ran despite the instruction

I ran the full `npx nx run mcp-bench:test --maxWorkers=2` (twice: once cached, once with `--skip-nx-cache`). That executed 619's `src/corpus/corpus.spec.ts`, which calls `withPinnedCorpus` three times. Its startup sweep force-removes `ptah-mcp-bench-corpus-*` worktrees in `%TEMP%`. The run had 1 failure, "preserves a git add error…": a foreign corpus dir appeared mid-test (expected `…-xn39nY`, received `…-kWTD1a`). That means a concurrent bench was probably active, and its corpus worktree may have been removed. I reported this to the coordinator at once, and the coordinator informed the 619 session. After that I ran only scoped host specs. Result of the full run: 35/36 suites, 447/448 tests passed; the only failure was this interference.

## Plan deviations

- Two files beyond the batch list: `memory-skills-host.ts` (testable orchestration, so the entry stays a thin composition root and specs inject the boot helper) and `doubles-override.ts` (+ specs).
- Plan env var: I used `PTAH_BENCH_MEMORY_SKILLS_PLAN` (batches.md), not design's `PTAH_BENCH_620_PLAN`.
- The "completion line" is on stdout as required. It is also written as `host-completion.json`, because `launchBenchHost` stops reading the child's stdout after the ready line and does not expose it. **Batch 16 must poll the completion file** before calling `stop()`.
- The host starts the net recorder itself in CI, because suites execute in the child, where a recorder in the parent would see nothing. Batch 16 still owns `--ci` in the runner.

## Not done / for later batches

- `HOST_SUITES` is empty; Batches 17-23 register suites there.
- Residual risk: a consumer singleton constructed before `afterContainerReady` would keep the real adapter. Thoth `oneshot` returns before the curator and skill services are resolved (`thoth-runtime.ts:129`), and the CI net recorder is the backstop. No runtime check of tsyringe internals was added.
- The product embedder worker is not wrapped by `guardedWorkerEntry` (that would need a product change), so worker-thread network activity in the host is not recorded. In-process suites that call the host's own MCP over loopback would be recorded as `tcp-connect` and fail CI. Suites should use the container directly.
- The bench host entry's arg/shutdown helpers (~30 lines) are duplicated from 619's `bench-host.entry.ts`, because 619 does not export them and 620 may not edit `transport/`. Candidate for a 619 export.
- `seeded[].source` in the completion record holds bench-dir paths (private folder, never committed).
