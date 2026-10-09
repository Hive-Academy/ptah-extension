# Backend implementation — `TASK_2026_619_af7f`, batch 4

**Tasks completed**: 4.0 (`type:tool` depConstraint, `scope:cli` dropped); 4.1 (Electron launch/attach adapter); 4.2 (orchestrator-added: real-DB guard modes `hash` / `process-watch`, plus the coordinator's addition that hash mode also guards `-shm`).

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\eslint.config.mjs — adds `{ sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['*'] }` with a comment, placed after the `scope:e2e` entry. The comment says tools are applications, may depend on any lib, and cannot be imported by a lib because the rule rejects application imports. No other constraint changed.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json — tags are now exactly `["type:tool"]`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts — the guard, moved out of `host-launcher.ts` because the CLI and Electron launchers now share it. It keeps the snapshot, hash and `RealStateChangedError` code and adds `armRealStateGuard()`. That function detects a concurrent writer and picks the mode. It also adds the `RealStateGuard` class (`watch(pid)`, `sampleBeforeStop()`, `finish()`), `BenchHeldRealStateError` (process-watch failure), `ConcurrentWriterError` (environment failure), the `GuardReport` union and `isUnder()`. `guardedStatePaths()` now returns `ptah.sqlite`, `-wal` and `-shm`. A file absent both before and after counts as unchanged.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.ts — the per-platform open-handle probe. `holders(paths)` lists which processes hold the real DB files. `treeOpenPaths(rootPid)` lists which paths a process tree holds open. The file also has `processTree()`, `stripWin32DevicePrefix()` and `platformHandleProbe()` (returns `null` outside win32 and linux).
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts — the guard code is removed and the launcher uses `real-state-guard.ts`. New option: `guard?: { ci, preSampleMs, sampleIntervalMs, probe }`. `LaunchedHost.guardMode` is new. `HostStopReport` now has `guard: GuardReport` in place of `guardBefore` / `guardAfter` (nothing else read those fields). The final process-watch sample runs before the teardown, and a guard failure still outranks a boot error. The isolation layers (env, explicit paths, the host's self-check, the launcher's home check) are unchanged.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts — imports now come from the new module. The fixture host gains the `hold-real` mode and a `hold-real-briefly` mode that releases on a signal. 9 new cases (23 → 32).
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts — `launchElectronHost()`, `attachElectronHost()`, `suiteNaReason()`, `parseAttachUrl()`, `ATTACH_MODE_NA_REASON`, `ELECTRON_URL_ENV`, `DESKTOP_MCP_PORTS`. It returns the same `{baseUrl, stop()}` shape plus `host: 'electron'`, `mode`, `portSource`, `guardMode`, `suiteNaReason()`, `coldStartMs` and `pid`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.spec.ts — 14 cases: the attach-mode `na` rule, URL validation, attach over a fixture server, and launch through a fixture "Electron main" run under node.

## Stack observed

- Nx 22, `@nx/eslint` `enforce-module-boundaries` (eslint.config.mjs:300-400), jest via ts-jest (`tools/mcp-bench/jest.config.ts`), Node 24.15. All four `type:tool` projects are `projectType: application` (their `project.json:5-6`).
- Electron facts, read from source:
  - The single-instance lock is at `apps/ptah-electron/src/main.ts:58`.
  - In development, userData is re-pointed at `<appData>/Ptah Dev` (`main.ts:53-57`), so the launcher forces `NODE_ENV=production`.
  - The workspace comes from the first non-flag argv (`activation/bootstrap.ts:202-213`).
  - `ptah.mcpPort` is read from `<userData>/config.json` (`platform-electron/.../electron-workspace-provider.ts:56-102`). It is not a file-based key. `getConfiguredPort` defaults to 51820 with +2 fallbacks, and port 0 is honoured (`http-server.handler.ts:42-48,124-138`).
  - The start line `CodeExecutionMCP server started on http://localhost:N` is at `http-server.handler.ts:94`.
  - The production logger does not echo to the console (`PtahProdDefaults.LOG_TO_CONSOLE=false`, `libs/shared/.../environment.constants.ts:30`). The log file is written by `ElectronOutputChannel` under `app.getPath('logs')`.
- Validation: the attach URL is checked at the boundary (loopback `http:` with a port). The probe's PowerShell JSON reply is shape-checked, and a one-element array that collapsed is accepted.

## How each part works

**Task 4.0.** The constraint was added and the stopgap removed, as above. `mcp-bench` lints clean with its `cli-engine`, `vscode-core` and `platform-core` imports, now under `type:tool` only. Task 4.1 imports no `scope:electron` lib: the adapter drives the built app as a process and needs no Electron lib, so that case is not exercised.

**Task 4.1, launch mode.** The launcher spawns the Electron binary (resolved from the `electron` package) with `main.mjs --user-data-dir=<temp>/electron-user-data <workspace>`. The env is `isolatedEnv(tempHome)` with `NODE_ENV=production`, minus `ELECTRON_RUN_AS_NODE`. It pre-writes `config.json` with `{"ptah":{"mcpPort":0}}`.

- **Port discovery: log file, documented.** The launcher reads the start line from any `*.log` under the temp home, or from the child's stdout/stderr, whichever shows it first. `portSource` records which one. In the real-app smoke it was `log-file`.
- **Refusals.** A port in 51820-51822 is refused, because it means the isolated config was not read. An exit before the MCP is up is refused with the single-instance diagnosis. A missing entry names `npx nx build-dev ptah-electron`.
- **Stop.** `killProcessTree` (SIGTERM, then SIGKILL; on win32 always `taskkill /T /F`, so `killed` is true there), then the temp home is removed and the guard runs.

**Task 4.1, attach mode.** Attach mode reads `PTAH_BENCH_ELECTRON_URL` (loopback only) and probes `tools/list`. It reports `guardMode: 'not-applied'` and `coldStartMs: null`, and `stop()` only closes the client. `suiteNaReason('memory' | 'lifecycle')` returns `"attach mode never writes to a user DB"` in attach mode, and `null` for `retrieval` and for every suite in launch mode.

**Task 4.2.** `armRealStateGuard()` runs before the spawn:

1. The probe asks which processes hold the real `ptah.sqlite`, `-wal` and `-shm`. The bench's own pid is ignored.
2. If nothing holds them, a pre-sample (default 2 s) stat-hashes the files twice.
3. With no evidence of a writer, the mode is `hash`, which is unchanged apart from the added `-shm`.
4. With evidence and `CI=true` (or `ci: true`), the run fails with `ConcurrentWriterError` ("Environment error: … in CI").
5. With evidence where no probe exists (any platform but win32 and linux), the run also fails with `ConcurrentWriterError` ("process-watch cannot run"). Detection there is the pre-sample alone, as the task allowed.
6. Otherwise the mode is `process-watch`. Periodic samples (default every 10 s, non-overlapping, timer `unref`'d and cleared at stop) plus one final sample before the teardown list the open file paths of the bench host's process tree. Any path under the real `~/.ptah` (case-folded on win32, junction-resolved) fails the run at `finish()` with `BenchHeldRealStateError {pid, name, path}`. A sample that cannot run also fails the run (fail closed).

- **Holder detection (win32).** Batch 3 used `RmGetList` only in a throwaway script, so it was not in the code. I implemented the probe in C#, compiled by Windows PowerShell `Add-Type` and fed through stdin as JSON (no paths on a command line). It opens each path with `FILE_READ_ATTRIBUTES` only and full sharing, then calls `NtQueryInformationFile(FileProcessIdsUsingFileInformation)`, the source the Restart Manager reads.
- **Tree sampling (win32).** The probe walks the `NtQuerySystemInformation(SystemExtendedHandleInformation)` handle table for the tree's pids, duplicates each handle (`PROCESS_DUP_HANDLE` on this user's own processes), and names disk files with `GetFinalPathNameByHandleW`. Each handle is named on a worker with a 250 ms timeout, because a query on a synchronous pipe can block. Such a handle counts as `unprobed`.
- **Linux.** `/proc/<pid>/fd` and `/proc/<pid>/cwd`.
- **Design change during the batch.** My first process-watch checked every path under the real `~/.ptah` (about 11,000) for holders. That took about 28 ms per path, and the first smoke failed closed on the 60 s probe timeout. I replaced it with the tree-handle walk, which takes about 1.7 s per sample and is the exact semantics: "a bench process holds a path".
- **Scorecard.** `launchBenchHost().guardMode` and `ElectronHost.guardMode` expose the mode, and the full `GuardReport` is on each stop report. The scorecard schema is not changed. **Recording `guardMode` in the scorecard run metadata belongs to Batch 10 or 11, whichever first assembles the run metadata from a live host (the bench runner and first-scorecard batch).** Today `run` in `scorecard.types.ts:71-77` has no field for it. That batch adds `run.guardMode: 'hash' | 'process-watch' | 'not-applied'`. The team-leader should pin the batch.

## Verification

- `npx prettier --check eslint.config.mjs tools/mcp-bench/project.json tools/mcp-bench/src/transport/{electron-host,electron-host.spec,open-handle-probe,real-state-guard,host-launcher,host-launcher.spec}.ts` → "All matched files use Prettier code style!"
- `npx nx run-many -t typecheck,lint,test -p mcp-bench,di-lint,migration,degradation-audit --parallel=2 --skip-nx-cache` → "Successfully ran targets typecheck, lint, test for 4 projects" (exit 0).
  - `nx run mcp-bench:test` → Test Suites 5 passed, Tests 51 passed. Run 3 times in a row: green each time.
  - `nx run mcp-bench:lint` → 0 errors, 1 warning. The warning is the existing one at `src/corpus/corpus.ts:36` (Batch 2).
  - `di-lint`, `migration` and `degradation-audit` lint clean.
- `npx nx run mcp-bench:build-host --parallel=2` → "Successfully ran target build-host for project mcp-bench and 32 tasks it depends on".
- **Flake fixed before the final run.** One run-many showed the "released before stop" case failing under parallel load. It was timing-based (a 4 s hold). It is now event-driven: the spec counts completed tree samples through an injected probe wrapper, then signals the fixture to release and waits for its confirmation.
- **Smoke, `cli-headless` on the pinned corpus (7910f34cf), desktop Ptah running (pid 6872, 8 Ptah.exe processes), `CI` unset.** The driver was a throwaway in `%TEMP%\mcp-bench-smoke\smoke-b4.ts`, not in the repo.
  - `ready port=59704 pid=46344 guardMode=process-watch`; `tools/list count=58`.
  - Writer evidence: `Ptah.exe 6872 holds …\.ptah\state\ptah.sqlite`, plus `-wal` and `-shm`.
  - A direct tree sample: `processes=node.exe:46344,conhost.exe:12568 openPaths=4737 underRealPtah=0 unprobed=0`.
  - The final guard was `{"mode":"process-watch",…,"samples":3,"maxTreeProcesses":2,"maxOpenPaths":4737,"unprobed":0}` with no violation: the run completes in process-watch mode and reports no bench handle on the real DB.
  - In one earlier run the bench tree included `cmd.exe`, `node.exe` and `codex.exe`, so the host spawns CLI probes. They were covered by the tree walk, with no real path held.
- **Smoke, Electron (built `D:\projects\ptah-extension\dist\apps\ptah-electron\main.mjs`, desktop running).**
  - Launch: `port=64691 portSource=log-file guardMode=process-watch desktopPort=false`; `tools/list count=59`, including `ptah_lsp_references`. The stop report was `isolatedDbCreated:true`, guard `process-watch`, `samples:2`, `maxTreeProcesses:14`, `maxOpenPaths:132`, `unprobed:1`, with no violation.
  - Attach to `http://localhost:51820` (read-only `tools/list` only): `tools=59 guardMode=not-applied memory=attach mode never writes to a user DB lifecycle=… retrieval=null`.
  - No `ptah-mcp-bench-*` temp dir or corpus worktree was left behind.

## How each listed risk and edge case was handled

- **Launch mode must not take port 51820.** `ptah.mcpPort = 0` goes in the isolated `config.json`, and a run that lands on 51820-51822 is refused (spec case "refuses a launch that landed on the desktop MCP port"; smoke port 64691).
- **Launch mode must not take the single-instance lock.** The isolated `--user-data-dir` (the lock is keyed on it) plus `NODE_ENV=production`, so `main.ts` cannot re-point userData. An early exit is refused with the lock diagnosis (spec case). The smoke launched alongside the running desktop app.
- **Attach mode refuses every state-writing suite.** `suiteNaReason` and `ElectronHost.suiteNaReason`, tested. No guard is applied in attach mode, because the real DB changes there by definition.
- **The guard in Electron launch mode** is the shared guard: the hash mode the batch asked for, and process-watch per the newer user decision. Electron has no bench ready line, so layers 3-4 (the host's self-check and the launcher's reported-home check) do not exist for it. The isolation is the temp home and env, explicit `PTAH_DB_PATH`, the isolated userData and port 0, and `isolatedDbCreated` is reported.
- **CI.** It always uses hash, and a writer in CI is a `ConcurrentWriterError` (spec cases for both). The process-watch spec cases pass `ci: false` explicitly, so they run on the linux CI runner through `/proc`. They are skipped only where no probe exists.
- **Never touch the user's real `~/.ptah` in tests.** Every spec uses a fake real home under `mkdtemp`. The smokes only read it: stat/hash, `FILE_READ_ATTRIBUTES` opens, and handle naming of bench processes.
- **Release paths.** The sampler timer is `unref`'d and cleared at `sampleBeforeStop()` / `finish()`. Probe child processes have a 60 s timeout and are killed. Workers abandoned on a blocked pipe live only inside the short-lived probe process.

## Plan deviations

1. **8 files instead of 6.** `real-state-guard.ts` and `open-handle-probe.ts` are new. The guard is now shared by two launchers, and `host-launcher.ts` would otherwise pass the 700-line `max-lines` ceiling. The OS probe is a separate responsibility from the guard policy.
2. **`HostStopReport` shape.** `guardBefore` / `guardAfter` became `guard: GuardReport` (a union carrying the mode). No consumer read the old fields.
3. **Electron launch uses the mode-selecting guard,** not the hash-only "unchanged" guard the original Task 4.1 text named. Task 4.2's user decision supersedes that text. Hash-only would fail every local Electron launch while the desktop app runs.
4. **`portSource`** on `ElectronHost` records which discovery path worked, as the validation note asked ("document which").

## Out-of-scope observations (not touched)

- **The bench host sometimes exits with 0xC0000409.** The `cli-headless` host intermittently exits with `exitCode=3221226505` (0xC0000409, fail-fast) on its graceful stdin-EOF shutdown, in about 2 of 3 runs. A control run with tree sampling stubbed out showed the same rate (2 of 3), so the guard is not the cause; it is likely a native-addon teardown in the engine. Batch 3's single smoke saw 0. Worth a look by whichever batch owns `bench-host.entry.ts` shutdown, because the scorecard should not record a crash as a clean stop.
- **Spawn errors in the CLI launcher.** `host-launcher.ts` does not handle the child `'error'` event, so an unspawnable `process.execPath` path would surface as an unhandled error. Pre-existing; I left it, because the coordinator limited changes in my scope. `electron-host.ts` handles it.
- The worktree shows `batches.md` and `context.md` as modified. This batch did not touch them.
