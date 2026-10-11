# Batch 4d executor report: TASK_2026_619_af7f

Batch: bench host shutdown classification, guard partial report, and spawn errors.
Executor: backend-developer subagent. I used no CLI lane, because the bisect needed judgement between runs.
I ran no git command that changes state. I did not edit `batches.md`.

## Verdict

- **Task 4d.1:** I found the cause of the `0xC0000409` crash. It is in product code: the sqlite-vec / better-sqlite3 native layer fails inside the engine's `SqliteConnectionService.close()` → `wal_checkpoint(TRUNCATE)`. This happens only after embeddings were written to the `vec0` tables. The bench host's shutdown order is not the cause, so there is no bench-side fix. I recorded it as a product finding below and made the stop classification robust.
- **Tasks 4d.2, 4d.3 and 4d.4:** all done.
- **Checks:** prettier, typecheck, lint, test and build-host all pass.
- **20-shutdown smoke:** `{"crash-on-shutdown":16,"clean":4}`. Every stop was classified, `stop()` never threw, and the guard passed every time.

## Tasks completed

### Task 4d.1: find the cause, fix or record it, classify every stop

**Reproducing the crash.** The crash appears only when the run makes a vector search. The bisect driver was a throwaway `%TEMP%\mcp-bench-4d\drive.mjs`, not in the repo. It does the following:

- spawns the built `dist/tools/mcp-bench/bench-host.mjs` with the launcher's isolated env;
- uses the pinned corpus `7910f34cf`, extracted read-only with `git archive`;
- calls `tools/list`;
- optionally calls `ptah_code_search_symbols` (query `resolvePtahDbPath`);
- waits `SETTLE_MS`, then ends stdin and records the exit code.

Without a search, 0 of 26 shutdowns crashed. With a search, about half to two thirds crashed. The first search downloads the embedding model into the isolated home (`Unable to determine content-length…` on stderr) and then embeds the code symbols. That explains why the Batch 4 smoke, which made a search, saw the crash and the Batch 3 and 4c smokes, which made none, did not.

**Bisect table.** All variants ran on win32 with Node v24.15.0 on the same corpus. `rate` is the share of graceful stdin-EOF shutdowns that exited 3221226505. Every non-zero exit in the table was 3221226505.

| Variant (`PTAH_BENCH_BISECT`) | Search call | Shutdowns | Crashes (0xC0000409) | Note |
|---|---|---|---|---|
| none (4c build), stop 3 s after ready | no | 10 | 0 | |
| none (4c build), stop right after ready | no | 10 | 0 | |
| none (4c build), stop 25 s after ready | no | 6 | 0 | |
| none (4c build) | yes | 10 | 5 (50%) | reproduces |
| baseline: no change to teardown (first bisect build) | yes | 10 | 7 (70%) | the baseline the other variants compare against |
| `no-embedder`, first attempt | yes | 10 | 5 | **invalid**: the factory re-registration reached no one, because the embedder client singleton is built during setup. The model download still showed. I fixed the flag (it now switches off the factory instance) and re-ran it on the next row |
| `no-embedder` (corrected) | yes | 9 | **0** | 1 more run crashed with 0xC0000409 at about 1.7 s, *before* the ready line (a boot crash, see the findings) |
| `no-sqlite-vec` | yes | 10 | **0** | no `vec0` tables, so no vector writes |
| `no-sqlite-close` (connection left open at `process.exit`) | yes | 10 | 3 (30%) | still crashes, in better-sqlite3's exit cleanup, which closes and checkpoints too |
| worker-thread join after teardown (candidate fix, since removed) | yes | 2 | 2 | refuted. No worker thread was alive at teardown: the tracker saw one worker exit, with code 1 (the embedder's own terminate), before the stop |
| `trace` | yes | 4 | 2 | last marker in each crash: `sqlite close begins` |
| `trace`, with the close's checkpoint run on its own first | yes | 6 | 4 | last marker in each crash: `sqlite wal_checkpoint(TRUNCATE) begins` (never `done`) |
| Standalone better-sqlite3 + sqlite-vec, `vec0 FLOAT[384]`, 50 or 2,000 rows, WAL, checkpoint, close | n/a | 20 | 0 | does not reproduce in isolation (`%TEMP%\mcp-bench-4d\vec-repro.cjs`) |

**Attribution against the listed suspects, in the order given:**

1. **better-sqlite3 `close()`.** This is where the crash happens: `SqliteConnectionService.close()`, `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:522-552`, inside `this.database.pragma('wal_checkpoint(TRUNCATE)')` at `:526`. It is called from `disposeThoth` (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:189-191`) in `withEngine`'s `finally` (`with-engine.ts:388-392`). It is not a race with the bench's `process.exit`: the crash happens before `withEngine` returns. Leaving the connection open just moves the crash into the exit cleanup (30%).
2. **sqlite-vec.** It is required for the crash: with `no-sqlite-vec`, 0 of 10 crashed. More precisely, what matters is that vectors were written into `vec0`: `no-embedder`, which writes no vectors while sqlite-vec stays loaded, also gave 0 of 9. The checkpoint copies the WAL pages those writes produced, so this looks like heap or page corruption from the vec writes being detected late. 0xC0000409 is the MSVC `__fastfail` / `/GS` code.
3. **Embedder worker / onnxruntime.** It is not the direct cause. No worker thread is alive at teardown, and joining workers before `process.exit` did not help (2 of 2 crashed). Its part is that it produces the vectors.
4. **tree-sitter wasm.** Not bisected separately. It indexes on the main thread and is finished before the search answers. The crash point is the SQLite checkpoint, after the MCP dispose and the embedder dispose had both completed (trace markers).
5. **Workspace-watch and integrity workers.** The workspace watcher is a separate child process (`platform-cli/.../cli-workspace-watcher.ts:91`, `fork`), so its end cannot set this process's exit code. The integrity worker is never dispatched in the CLI (`register-thoth-libraries.ts:87-96`), and the worker tracker saw no live worker at teardown.

**Product finding (for a named Phase 2 task).**

- **What happens:** in a `cli-headless` bench host (CLI DI, `thoth: 'oneshot'`), `SqliteConnectionService.close()` dies with 0xC0000409 inside `wal_checkpoint(TRUNCATE)` in about 50-80% of runs on win32, once a `ptah_code_search_symbols` call has embedded symbols into `code_symbols_vec`.
- **Evidence:** the variant rates and trace markers above.
- **Smallest reproduction so far:** boot the bench host on the corpus, make one `ptah_code_search_symbols` call, end stdin. With `PTAH_BENCH_BISECT=trace` the last line is `[bench-host] trace sqlite wal_checkpoint(TRUNCATE) begins`.
- **Not reproduced:** a standalone better-sqlite3 + sqlite-vec script did not reproduce it in 20 runs. So the trigger needs something more of the product's write path, possibly code-symbol rows with FTS5 plus vec0 in one transaction, or the migration's vec tables. Narrowing it further needs a debugger or a WinDbg crash dump of the bench host. That is out of Phase 1's scope.
- **Electron:** may carry the same risk if it closes after vec writes. It was not tested here.

**Classification.** The stop classification is in `host-launcher.ts`: `HostExit`, `classifyHostExit()` and `HostLaunchError`. It uses the exact Task 4b.1 kinds:

- `exited-early`: the host ended before `stop()`, including a spawn failure. A failed boot (fatal line, then exit 1) also lands here, because the launcher waits (bounded by 5 s) for the exit after a fatal line before tearing down.
- `killed`: the tree kill fired.
- `clean`: exit 0, or the launcher's own graceful signal.
- `crash-on-shutdown`: anything else after the stop began. The detail names the NTSTATUS (0xC0000409, 0xC0000005, 0xC0000374, 0xC00000FD), a fatal signal (SIGSEGV/SIGABRT/SIGBUS/SIGILL/SIGFPE), or exit 2 (the host's forced exit).

A crash on shutdown is reported in `HostStopReport.exit`. It never makes `stop()` reject and is never a tool error.

**Electron.** `ElectronStopReport.exit` uses the same classifier. On win32 it is always `killed`, and `detail` says that win32 has no graceful quit for Electron, `taskkill /T /F` is the normal stop, and it is not a crash. On POSIX, an end by the SIGTERM the launcher sent counts as `clean`.

**`samePath` replaced.** `host-launcher.ts` now uses `isSamePath` from `bench-data.ts`. The rule is the same: resolve both paths and fold case on win32.

**Spec fixtures** (`host-launcher.spec.ts`). Each is a fixture host that:

- exits 0 → `clean`;
- exits 3221226505 after stdin EOF (win32; SIGABRT on POSIX) → `crash-on-shutdown`, and `stop()` resolves;
- ignores EOF → `killed`;
- exits after the first `tools/list` → `exited-early`;
- prints a fatal line and exits 1 → `HostLaunchError` with `exited-early` and code 1.

There are also unit cases for `classifyHostExit`: each NTSTATUS, the fatal signals, exit 2, the graceful signal, the kill reason, and early end winning over a crash code.

### Task 4d.2: list unprobed processes and mark the guard partial

- **Probe result.** `TreeOpenPathsResult.unprobed` is now `Array<{ pid, handles }>`, one entry per process with unnamed handles.
- **win32 probe.** The C# counts per pid (`Dictionary<long,int>`) and emits `pid<TAB>handles` lines, parsed by the new exported `parseWindowsTreeReply`. Every handle of a tree process that cannot be opened for duplication now counts for that pid. Before, it was counted once per process.
- **linux probe.** `ProcFsHandleProbe` is exported and its `/proc` reads (`ProcFs`) can be injected. A link that fails to read with anything other than `ENOENT`, or an fd table that cannot be listed, counts as unprobed for that pid. A vanished link (`ENOENT`) counts as nothing.
- **`GuardReport`.** The process-watch report carries `partial: boolean` and `unprobedProcesses: Array<{ pid, name, handles }>`. It is the union across samples, keeps the max handles per pid, is sorted by pid, and uses the name `unknown` when the process table lacks the pid, because the scorecard's `name` needs at least 1 character. `partial` is true exactly when that list is non-empty.
- **Pass and fail rules.** A partial guard passes and is only reported. A held real path still fails the run (`BenchHeldRealStateError`), and so does a failed sample. Both error messages now append `; unprobed (guard partial): <name> <pid> (<n> handles), …`.
- **Specs.** They use a scripted probe, so they run on every OS: pid and name listed with the max handles across samples and the run passes; not partial when every handle was named; a held path still fails and names the unprobed processes; a failed sample still fails and names them. There are also unit cases for the win32 reply parser (including ConvertTo-Json collapsing a one-element array) and two cases for the fake-`/proc` linux probe.

### Task 4d.3: handle the child `'error'` event in the CLI launcher

- `launchBenchHost` listens for `'error'` for the child's whole life, and treats it as a spawn failure only while `pid` is undefined.
- A spawn failure resolves the exit promise, and the launch then:
  - rejects with `HostLaunchError: could not spawn the bench host (<nodePath> <hostScript>: <message>)`, carrying `exit.kind: 'exited-early'`;
  - runs the guard first, so a guard failure still outranks the spawn failure;
  - removes the temp home.
- `child.stdin` gets an error listener, so an EPIPE on the stop's EOF cannot go unhandled.
- New option `nodePath` (default `process.execPath`).
- Specs:
  - an unspawnable executable: the message names it and the script, `exited-early`, and no new `ptah-mcp-bench-home-*` dir is left;
  - a missing host script: early exit with code 1;
  - "a guard failure outranks the boot failure": a fatal fixture that writes the fake real DB rejects with `RealStateChangedError`.

### Task 4d.4: follow junctions and symlinks in `resolveBenchDataDir()`

- **Two comparisons.** Each forbidden root (the real `~/.ptah` and the repository root) is compared with the candidate lexically, as today with the same messages, and then by real path. The real candidate is compared against both the root as given and the root's real path.
- **Missing paths.** A candidate that does not exist yet resolves through its nearest existing ancestor, and the missing tail is re-appended.
- **Errors.** The message names the path, its real path, the root, the root's real path and the rule. A `realpath` failure other than `ENOENT` fails closed with a `BenchDataDirError`.
- **Return value and purity.** The function still returns the lexical resolved path. `isPathInside` and `isSamePath` stay pure.
- **Injection.** The resolver can be injected (`realpath`, default `fs.realpathSync.native`). With a simulated foreign `platform` and no resolver, only the lexical rule applies; this is documented. It keeps the existing cross-platform spec cases meaningful.
- **Specs**, run with real junctions on this machine (POSIX uses dir symlinks; a case is skipped only when the OS refuses the link, and the test names say so):
  - a link into the fake `.ptah` is rejected;
  - a link into the fake repo is rejected;
  - a not-yet-existing child of a link is rejected;
  - a real `~/.ptah` that is itself a link is rejected when reached by its target;
  - a plain directory outside both passes;
  - an injected EACCES fails closed;
  - the nearest-ancestor walk works as described.
- Result: 23 passed, 0 skipped.

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.ts: the `PTAH_BENCH_BISECT` diagnostic flags (`no-embedder`, `no-sqlite-vec`, `no-sqlite-close`, `trace`), applied through `withEngine`'s `bootstrap` seam only when a flag is set, and a header note on the known crash.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.spec.ts: 3 new cases (unknown flag refused, each flag applied to the bootstrap, parsing). **This file is outside the batch file list; see the deviations.**
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts: `HostExit`, `classifyHostExit`, `HostLaunchError`, the `exit` field on the stop report, spawn `'error'` and stdin EPIPE handling, the `nodePath` option, the wait after a fatal line, and `isSamePath`. 531 lines.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts: exit-classification, spawn-failure, partial-guard, `classifyHostExit`, win32-parser and fake-`/proc` cases.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts: `ElectronStopReport.exit` through `classifyHostExit`, the win32 taskkill detail, and a kept-on `'error'` listener.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts: `UnprobedProcess`, `describeUnprobed`, `partial` and `unprobedProcesses` on the report, and unprobed processes named in the error messages.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.ts: unprobed handles per pid (C# and linux), the exported `parseWindowsTreeReply`, and `ProcFsHandleProbe` / `ProcFs`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.ts: the real-path comparison, nearest-ancestor resolution, the injectable `realpath`, and fail-closed handling.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.spec.ts: junction and symlink cases.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4d-executor-report.md: this report.

I did not change `bench-host.entry.ts` and edited no product source. The throwaway drivers stay in `%TEMP%\mcp-bench-4d` (`drive.mjs`, `vec-repro.cjs`, `smoke-4d.ts`/`.cjs`, and the extracted `corpus\`). I removed the 6 `ptah-mcp-bench-home-*` dirs my bisect driver had left in `%TEMP%`.

## API changes

**`bench-host-boot.ts`, the API TASK_2026_620 uses.** All changes are additive:

- `assertIsolatedEnvironment`, `bootCodeExecutionHost`, `BootCodeExecutionHostOptions`, the hook types, `BenchHostHandle` and `BenchHostBootError.step` are unchanged in shape and meaning.
- New exports: `BENCH_BISECT_ENV`, `BenchBisectFlag`, `readBisectFlags()`.
- One new refusal: an unknown `PTAH_BENCH_BISECT` flag rejects with step `'options'`. With the variable unset, the `withEngine` arguments are byte-identical; the existing spec still asserts them exactly.

**Transport, breaking within `mcp-bench` only** (grep: no consumer outside `transport/` and its specs):

- `HostStopReport.exitCode` and `.killed` were replaced by `.exit: HostExit`.
- `ElectronStopReport` (launch) `.exitCode` and `.killed` were replaced by `.exit`.
- The process-watch `GuardReport.unprobed: number` was replaced by `partial` and `unprobedProcesses`.
- `TreeOpenPathsResult.unprobed` is now per pid.
- `launchBenchHost` boot failures now reject with `HostLaunchError` (same message, original error as `cause`).

**Additive:** `HostLaunchOptions.nodePath`, `classifyHostExit`, `HostExitObservation`, `HostExitKind`, `describeUnprobed`, `UnprobedProcess`, `UnprobedHandles`, `parseWindowsTreeReply`, `ProcFsHandleProbe`, `ProcFs`, and `ResolveBenchDataDirOptions.realpath`.

## Verification

- `npx prettier --check` on the 9 changed source paths: "All matched files use Prettier code style!"
- `npx nx run-many -t typecheck,lint,test -p mcp-bench --parallel=2 --skip-nx-cache`: "Successfully ran targets typecheck, lint, test for project mcp-bench".
  - `mcp-bench:test`: Test Suites 8 passed, Tests 127 passed, 127 total.
  - `mcp-bench:lint`: 0 errors and 1 warning, the existing `src/corpus/corpus.ts:36` one from Batch 2.
- `npx nx run mcp-bench:build-host --parallel=2 --skip-nx-cache`: "Successfully ran target build-host for project mcp-bench and 32 tasks it depends on".
- **20-shutdown smoke through `launchBenchHost`** on the final build. Driver: `%TEMP%\mcp-bench-4d\smoke-4d.ts`, bundled with esbuild.
  - Conditions: pinned corpus, desktop Ptah running, `CI` unset. Each run did `tools/list` (58 tools) and one `ptah_code_search_symbols` (result), then `stop()`.
  - **Count per `exit.kind`: crash-on-shutdown 16, clean 4, killed 0, exited-early 0.**
  - Every crash had `exitCode 3221226505` and detail `exit code 0xC0000409 (3221226505): fail-fast (STATUS_STACK_BUFFER_OVERRUN / __fastfail) after the graceful stop began; a run-level fact, not a tool error`.
  - `stop()` resolved every time. The guard was `process-watch`, `partial=false`, `unprobed=[]`, and passed every time. `isolatedDbCreated=true` every time.
- I did not reach "0 crashes in 20 shutdowns", because the cause is not in the bench host. The product finding is recorded above, as the batch's verification requires when a crash remains.

## Plan deviations

1. **9 changed source files instead of 8.** I also changed `bench-host-boot.spec.ts`, which is not in the batch list. The new bisect flags change the boot's `withEngine` options when set, and the unknown-flag refusal is a new boot path. Both need unit coverage in the colocated spec. The changes are additive only (3 cases plus a `CliDIContainer.setup` mock entry). The team-leader should record it.
2. **No shutdown-order fix landed.** This is a deliberate outcome of 4d.1, not an omission. I tried one candidate in `bench-host-boot.ts`: joining every live worker thread after the `withEngine` teardown, through the `process` `'worker'` event. The bisect refuted it (2 of 2 still crashed; no worker was alive at teardown), so I removed it rather than keep unproven code.
3. **The bisect flags reach into product instances.** They do so through the public `withEngine` `bootstrap` seam: they patch instance methods of the embedder factory and the SQLite connection, and only in the bench process. No product source is edited and the default boot is unchanged. `no-embedder` patches the factory instance because the embedder client singleton is already built during `CliDIContainer.setup`. The first attempt, a re-registration, had no effect; the table marks that run invalid.
4. **Electron launch failures are not wrapped in `HostLaunchError`.** The batch limits `electron-host.ts` to the stop-report classification, so a failed Electron launch still rejects with its original error.

## How each risk and edge case was handled

- **Fix vs product finding:** decided by the bisect and trace evidence. The product cause is recorded and the classification made robust. I made no product edit.
- **Crash never a tool error and never thrown from `stop()`:** this is a spec case (`crash-on-eof` resolves `stop()`), and the 16 smoke crashes all resolved.
- **win32 Electron is always `killed`:** `detail` explains taskkill, by the injected `killReason`, which is covered by a spec case.
- **A boot failure inside the engine is `exited-early`, not a crash:** the launcher waits (bounded) for the host's exit after a fatal line. Spec: the fatal fixture gives code 1 and `exited-early`.
- **The 700-line ceiling:** `host-launcher.ts` is 531 lines.
- **`samePath` replaced by `isSamePath`:** done, with the same rule.
- **Partial guard is reported, never failed; held path and failed sample still fail:** each has a spec case. Names are never empty (`unknown`), to satisfy the scorecard schema's `min(1)`.
- **The linux probe spec runs on CI:** the fake `/proc` is injected, so it runs on any OS.
- **Spawn failure:** the guard runs first and outranks it, the temp home is removed, and no error goes unhandled (`'error'` and stdin listeners). There are spec cases for the guard ordering (the fatal-plus-write fixture) and for cleanup.
- **Junctions:** real junctions are created in the spec. `realpath` errors other than ENOENT fail closed, and the lexical return value is kept.
- **Real `~/.ptah` never touched:** all specs use fake homes under `mkdtemp`. The smoke only read the real DB (guard probe).

## Out-of-scope observations

- **Boot-time crash.** The bench host crashed once with 0xC0000409 during boot, at about 1.7 s, before the ready line, in the corrected `no-embedder` series (1 of 10). The launcher classifies this as `exited-early`, or as a `HostLaunchError` when it happens before ready. It may be the same native fault: sqlite-vec loading or the vec migrations run at boot. Worth adding to the Phase 2 product task.
- **Model download on every run.** Every run downloads the embedding model again from the network, because the model cache (`~/.ptah/models`, `register-thoth-libraries.ts:66`) resolves inside the per-run temp home. That makes cold runs network-dependent and slower (each search took about 11.5 s). A shared, pre-seeded model cache passed in from the runner (for example under `resolveBenchDataDir()`) would remove this. That is a decision for a later batch.
