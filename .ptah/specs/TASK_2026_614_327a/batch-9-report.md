# Batch 9 report — `run_check` cancel/dispose kill, description, one wait ceiling (E.2 core, E.5, E.6)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e`. All three tasks are done. No git was run.

## Changed files

All paths are under `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.

| File | Change |
| --- | --- |
| `run-check.tool.ts` | Task 9.1: adds an optional `signal?: AbortSignal` to `RunCheckDependencies`. A single `stop(reason)` path inside `execute` now handles timeout, cancel and dispose. It kills the tree once with the existing `killTree` (`killProcessTree` from platform-core: `taskkill /pid <pid> /T /F` on Windows, process group on POSIX), then waits up to `KILL_SETTLE_MS` for `close`. If a cancel arrives while a timeout kill is running, it joins that kill and the reason stays "timeout". A module-level `liveChecks: Map<pid, stop>` registers each run after it spawns and removes it when the run settles. New exports: `killRunningChecks(): Promise<void>`, which stops every live run through its own stop path (each reply says cancelled; it never throws), and `runningCheckPids()`. The abort listener is removed when the run settles. A signal that is already aborted before launch spawns nothing. The verdict union gains `'cancelled'`. The summary reads "CANCELLED; the process tree was killed" or "CANCELLED before Nx started". Targets show `incomplete`/`not run`, as they do on a timeout. The log trailer records the cancel. Task 9.2: the description now says "(worktrees inside an open workspace folder too)". To stay within the 540-char per-tool budget from `mcp-contract.sweep.spec.ts`, it was also shortened: "block until done" and "(path in the reply)". The Nx-missing error adds "a worktree needs its own install or a node_modules link". Task 9.3: annotations are now `{ destructiveHint: false }`, with no `openWorldHint`. |
| `run-check.tool.spec.ts` | Adds `reflect-metadata`. New tests: (1) on abort, `killTree` is called once with the cancelled run's pid only, the verdict is `cancelled`, that pid leaves `runningCheckPids()`, and a second concurrent run is untouched and later passes; (2) a signal aborted before launch means no spawn, no kill, and "CANCELLED before Nx started"; (3) `killRunningChecks()` kills both live pids, both verdicts are `cancelled`, the set ends empty, and a second call is a no-op; (4) a cancel during a timeout kill keeps `timed_out` and makes a single kill call; (5) the description contains "worktrees inside an open workspace folder", and the annotations equal `{ destructiveHint: false }`; (6) the Nx-missing text contains the worktree hint. |
| `wait-tools-args.schema.ts` | Task 9.3: `MAX_WAIT_TIMEOUT_SEC = MAX_AGENT_WAIT_MS / 1000`, imported from `@ptah-extension/cli-agent-runtime`. That barrel already exports it (`cli-agents/index.ts:17`), and `agent-namespace.builder.ts` already imports it the same way. |
| `wait-tools-args.schema.spec.ts` | Adds `reflect-metadata`. New test pins `MAX_WAIT_TIMEOUT_SEC * 1000 === MAX_AGENT_WAIT_MS` and that the value is an integer. |
| `agent-wait.tool.spec.ts` | Adds `import 'reflect-metadata'` only. The schema now loads the cli-agent-runtime barrel, which needs tsyringe's reflect polyfill (the same note as `agent-tool.dispatcher.spec.ts:10`). |

## Entry point for Batch 10

- Request cancel: pass `signal` in the `RunCheckDependencies` given to `runCheck(args, deps)`, from `protocol-dispatcher.ts` and `agent-tool.dispatcher.ts`.
- Host dispose: `await killRunningChecks()` from `./run-check.tool` (relative import inside the lib). It resolves once every tree kill has finished, and it does not reject.

## Checks

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p vscode-lm-tools --parallel=2` | 0 ("Successfully ran targets typecheck, lint, test") |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

The first full run failed (exit 1) for three reasons:
- the new description was 549 chars against the 540 budget. Fixed.
- `agent-wait.tool.spec.ts` needed `reflect-metadata`. Fixed.
- `agent-sdk` had transient compile errors (`StreamTransformConfig.onMessage`, `ExecuteQueryResult.onMessage/onStreamEnd`) from another executor's edits in progress. They were not in my files, and they cleared on the rerun.

## Deviations and notes

- The batch said "set of live check PIDs". I used a `Map<pid, stop>` instead, so dispose goes through each run's own stop path and verdict, and uses the `killTree` that run was given.
- I also exported `runningCheckPids()` so the specs can show that a pid leaves the registry.
- Coupling: the schema now loads the `cli-agent-runtime` barrel, and through it `agent-sdk`, in every spec that imports it. As a result, transient `agent-sdk` type errors now surface in these specs too.
- `ptah-api-builder.service.spec.ts` mocks `@ptah-extension/cli-agent-runtime` without `MAX_AGENT_WAIT_MS`. It passes today. If it ever reaches the schema, the ceiling would become `NaN` there.
