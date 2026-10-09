# Batch 4c executor report — TASK_2026_619_af7f

Batch: Shared bench-host boot helper and bench data folder (shared with TASK_2026_620_a13e).
Executor: backend-developer subagent. No CLI lane was used; the batch was small enough to do directly.
No git commands that change state were run.

## Tasks completed

- Task 4c.1: `bench-host-boot.ts` with `assertIsolatedEnvironment()` and `bootCodeExecutionHost()`; the entry boots through it. Done.
- Task 4c.2: `bench-data.ts` with `resolveBenchDataDir()` for `PTAH_MCP_BENCH_DATA_DIR`. Done.

## Files

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.ts: isolation check, typed hooks, boot, handle with `stop()`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.spec.ts: 19 cases.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts: keeps only argument parsing, wire lines, signals, the forced-exit timer, the `exit` flush handler and exit codes.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.ts: `resolveBenchDataDir`, `findRepositoryRoot`, and the shared path rule `isPathInside` / `isSamePath`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.spec.ts: 16 cases.

Five files, all in `tools/mcp-bench`. No product source was edited, and `batches.md` was not edited.

## Public contract for TASK_2026_620 (from `transport/bench-host-boot.ts`)

```ts
bootCodeExecutionHost(options: {
  workspace: string;                                // absolute
  beforeEngineBoot?: BeforeEngineBootHook;          // (ctx: { workspace; isolation }) => void | Promise<void>
  afterContainerReady?: AfterContainerReadyHook;    // (container: BenchHostContainer, ctx: { workspaceRoot; isolation }) => void | Promise<void>
}): Promise<BenchHostHandle>                        // { port; workspaceRoot; isolation; container; stop(): Promise<void> }
assertIsolatedEnvironment(env = process.env, probe?: { homedir?; platform? }): IsolatedPaths  // { home; userDataPath; dbPath }
```

- `BenchHostContainer` is tsyringe's `DependencyContainer` re-exported as a type, so a caller in `memory-skills/` does not need to import cli-engine types.
- Errors: `BenchIsolationError` (refusals) and `BenchHostBootError` with `step: 'options' | 'beforeEngineBoot' | 'engine-boot' | 'afterContainerReady' | 'mcp-start'` and the original error as `cause`.
- Hooks have no timeout. A hook that hangs holds the boot, and the caller's boot timeout (the launcher's 180 s by default) covers that case.

## How each requirement was handled

- **Hook order** (recorded default): `assertIsolatedEnvironment()` → `beforeEngineBoot` → `withEngine` (`mode: 'full'`, `requireSdk: false`, `thoth: 'oneshot'`, `cwd: workspace`, `config: userDataPath`) → `CODE_EXECUTION_MCP` registration check → `afterContainerReady(container, ctx)` → `setConfiguration('ptah','mcpPort',0)` → `startCodeExecutionMcp` → `getPort()` null check. The spec case "runs the hooks in order around the engine boot and before the MCP start" asserts the exact event sequence and the `withEngine` arguments.
- **A failing hook aborts the boot and never starts the MCP server.** If `beforeEngineBoot` throws, the boot rejects and `withEngine` is never called (spec). If `afterContainerReady` throws, the error propagates out of the `withEngine` callback, so `withEngine`'s own `finally` teardown runs. `bootCodeExecutionHost` rejects only after that, through the `engine.then(…, abort)` path. The spec records the events at the moment of rejection (`['engine-boot','engine-teardown']`) and checks that `startCodeExecutionMcp` was not called. The missing-registration and null-port failures also reject after the teardown (spec). A bootstrap rejection is wrapped as step `engine-boot` (spec). The helper never calls `process.exit`.
- **`stop()`** releases a deferred that the `withEngine` callback awaits. The callback then disposes the MCP under `ENGINE_DRAIN_TIMEOUT_MS` (10 s, unchanged), and `stop()` awaits the `withEngine` promise itself, so it resolves only after the teardown. `stop()` is idempotent: it returns the same promise (spec).
- **Isolation refusals.** The messages are byte-identical to the old `readIsolation`, and the error is now a thrown `BenchIsolationError` instead of `process.exit`. The spec covers each missing variable, a homedir mismatch, config or DB outside the home, a DB path equal to the home, win32 case folding (`path.win32` semantics, so it runs on any OS), and no folding on POSIX. The win32 `isInside`/`samePath` rule is unchanged: resolve, lowercase on win32, `relative` not empty and not starting with `..` and not absolute. It now lives once, in `bench-data.ts`, and both modules import it. This guarantees the "matching rule" that Task 4c.2 requires. `bench-data.ts` imports nothing heavy, so the runner parent does not load the engine.
- **cli-headless behaviour unchanged** (recorded default). The refusal messages are the same, and so are the wire lines (`ready` with the same six fields, and `fatal`), the `withEngine` options, the port-0 write, and the exit codes (0 clean, 1 fatal, 2 forced). The entry still checks isolation before it parses arguments, so the first refusal for an unisolated launch is unchanged. One intentional difference: a failure inside the boot (missing token, null port) used to `process.exit(1)` from inside the `withEngine` callback, which skipped the engine teardown. It now tears down first and then exits 1, with the same message. For typed errors the fatal line carries the message, and the cause's stack goes to stderr. Untyped errors still carry the stack, as before. The shutdown crash is not touched; that is Task 4d.1.
- **`resolveBenchDataDir()`** reads `PTAH_MCP_BENCH_DATA_DIR`, which must be absolute and is resolved. Without it, the default is `%LOCALAPPDATA%\ptah-mcp-bench` on win32 (falling back to `<home>\AppData\Local` if `LOCALAPPDATA` is unset) and `~/.cache/ptah-mcp-bench` elsewhere. It rejects with a `BenchDataDirError` that names the path and the rule in four cases: the real `~/.ptah` itself or anything under it, the repository root itself or anything inside it, a relative override, and a missing repository root.
  - `env`, `realHome`, `repoRoot` and `platform` can be injected.
  - The default `repoRoot` is the outermost ancestor of `cwd` that holds an `nx.json`. Outermost, not nearest, so the main checkout covers its worktrees. A spec case builds `main/nx.json` plus `main/.claude-worktrees/task/nx.json` and expects `main`.
  - `create: true` does a recursive `mkdirSync`. Otherwise there is no I/O beyond the `nx.json` walk.
  - The module header documents that the function is for the runner parent, and that a child receives the resolved path from its parent instead of resolving it.

## Verification

- `npx prettier --check` on the 5 changed paths: "All matched files use Prettier code style!"
- `npx nx run-many -t typecheck,lint -p mcp-bench`: "Successfully ran targets typecheck, lint for project mcp-bench".
- `npx nx run mcp-bench:test -- --maxWorkers=2`: 93 passed, 1 failed, 94 total. Both new spec files pass. The one failure is `corpus/corpus.spec.ts` › "removes only registered stale corpus worktrees at startup", which exceeds jest's default 5000 ms timeout. That spec does not import any file from this batch. Re-run alone with `--testTimeout=60000` it passes (3/3), so the cause is slow git worktree operations on this machine (other agents were running), not this batch. The run-many test target is therefore red on that one timing-bound case. See the out-of-scope observations below.
- Grep check: `bench-host.entry.ts` contains no `readIsolation` and no `withEngine(` call. `startCodeExecutionMcp` appears only in the header comment.
- `npx nx run mcp-bench:build-host --skip-nx-cache`: "Successfully ran target build-host for project mcp-bench and 32 tasks it depends on". `dist/tools/mcp-bench/bench-host.mjs` is 8.9 MB.
- Smoke on the pinned corpus (7910f34cf) through `launchBenchHost`, with the desktop Ptah running and `CI` unset. The driver was an esbuild bundle of a throwaway `%TEMP%\mcp-bench-smoke\smoke-b4c.ts`, which is not in the repo.
  - `ready port=57757 pid=12540 coldStartMs=7483 guardMode=process-watch homedirIsTemp=true`
  - `tools/list count=58 has ptah_code_search_symbols=true`. The count is the same 58 as the Batch 4 smoke.
  - `stop exitCode=0 killed=false isolatedDbCreated=true`. The run shut down cleanly; the 3221226505 crash of Task 4d.1 did not show on this single run.
  - Real-DB guard: `stop()` did not throw, so the guard passed. Report: `{"mode":"process-watch","writerEvidence":["Ptah.exe 6872 holds …ptah.sqlite", "…-wal", "…-shm"],"samples":2,"maxTreeProcesses":2,"maxOpenPaths":4736,"unprobed":0}`. The shape is the same as in Batch 4.
- Refusal smoke on the built `bench-host.mjs`:
  - With no isolation env: `{"benchHost":"fatal","error":"refusing to boot: PTAH_BENCH_ISOLATED_HOME, PTAH_CONFIG_PATH and PTAH_DB_PATH must all be set by the launcher"}`, exit 1.
  - With isolation env but the real home: `…os.homedir() is C:\Users\abdal, not the isolated home …`, exit 1.

## Plan deviations

- The path comparison rule moved into `bench-data.ts` and is imported by `bench-host-boot.ts`, not kept in the boot helper. This keeps one rule for both tasks (the "matching" requirement of 4c.2) without loading the engine into the runner parent. The behaviour is unchanged.
- `assertIsolatedEnvironment` takes an optional second argument, `{ homedir?, platform? }`, next to the specified `env`. The spec needs it to inject the home and the win32 semantics, following the `realHome` injection pattern of `real-state-guard.ts`.
- I added a step `'options'` for a relative `workspace` passed to `bootCodeExecutionHost`. The helper is a public entry point, so it validates its input; the entry already rejects a relative path earlier.

## Out-of-scope observations

- `tools/mcp-bench/src/corpus/corpus.spec.ts` (not in this batch) uses jest's default 5 s timeout for real `git worktree` operations. It times out under load on Windows and passes with a 60 s timeout. A per-test timeout in that spec would make `mcp-bench:test` reliable. Reported to the team-leader, not touched.
- `host-launcher.ts` still has its own copy of `samePath`. It could import `isSamePath` from `bench-data.ts`; that file belongs to Batch 4d.
