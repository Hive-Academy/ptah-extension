# Backend implementation — `TASK_2026_597`, batch 33 (blocking waits: manager and tools)

**Tasks completed**: 33.1, 33.2, 33.3

## Files

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: adds `waitForAgents(ids, mode, timeoutMs)` and the exported types `AgentWaitMode`, `AgentWaitEntry`, `AgentWaitResult`, plus the constant `MAX_AGENT_WAIT_MS = 900_000`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts`: exports `MAX_AGENT_WAIT_MS` and the three wait types from the barrel. The batch does not list this file (see deviations).
- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.wait.spec.ts`: 7 tests.
- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/wait-tools-args.schema.ts`: `AgentWaitArgsSchema`, `RunCheckArgsSchema`, `WAIT_SUMMARY_MAX_CHARS = 4_000`, `MAX_WAIT_TIMEOUT_SEC = 900`, the defaults, `RUN_CHECK_TARGETS` and `RUN_CHECK_PROJECT_PATTERN`.
- CREATED `.../mcp-core/wait-tools-args.schema.spec.ts`: 27 tests.
- CREATED `.../mcp-core/agent-wait.tool.ts`: `AGENT_WAIT_TOOL_NAME`, `buildAgentWaitTool()`, `runAgentWait(args, deps)`, `formatAgentWaitSummary(...)`.
- CREATED `.../mcp-core/agent-wait.tool.spec.ts`: 7 tests.
- CREATED `.../mcp-core/run-check.tool.ts`: `RUN_CHECK_TOOL_NAME`, `NX_ENTRY_CANDIDATES`, `buildRunCheckTool()`, `runCheck(args, deps)`, `formatRunCheckSummary(...)`.
- CREATED `.../mcp-core/run-check.tool.spec.ts`: 10 tests, one of which runs a real `node` process.

All paths are under `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/`.

## What each task did

### 33.1 `waitForAgents`

- **How it waits.** It listens for `agent:exited` on the existing `events` emitter and settles inside the listener. There is no polling, so the caller resumes within one tick of the event. The spec checks this: the promise settles after two microtasks and `setInterval` is never called.
- **Lanes that already ended.** A lane that is already in a terminal status when the call starts counts as ended at once.
- **Modes.** `any` returns when one known lane has ended. `all` returns when every known lane has ended.
- **Ids it cannot see.** Each requested id is reported separately as `not_found` or `other_workspace`. The scope rule is the same as `getStatus`, through `spawnEnvironment.scopedWorkspaceRoot()` and `isWithinScope`. These ids are never waited on, so a call with no known lane returns immediately. Duplicate ids are collapsed and request order is kept.
- **Timeout.** The timeout is clamped to `0..900_000` ms. When it fires, the call returns a partial result rather than an error: `timedOut: true`, and each lane in its current state. If a lane's status became terminal without an `agent:exited` event (the `handleTimeout` case where the adapter never settles its abort), it is reported as `exited`.
- **Cleanup.** The listener and the timer are removed on every exit path; the spec asserts `listenerCount === 0`. The timer is unref'd through the existing `unrefTimer`.

### 33.2 Schema and `ptah_agent_wait`

- **Arguments.** `{agentIds: 1..10 non-blank strings ≤128, mode: 'any'|'all' (default 'all'), timeoutSec: int 0..900 (default 600)}`. The schema is strict.
- **What it reports per lane:** CLI or display name, status, exit code, duration, a stop reason in words, the declared deliverables checked on disk now (`MISSING`, `EMPTY`, `N bytes`, or `(NOT written by this run)`), and the last output lines. Paths are resolved the same way as `lane-completion-notifier.service.ts`. Output is stdout, or stderr when stdout is empty. A lane that is still running is not read.
- **Size bound.** The whole reply is at most `WAIT_SUMMARY_MAX_CHARS`. Each lane gets an equal share. Within a lane, the headline and deliverables come first, then the newest output lines that still fit. A final clamp guards the total. The spec checks the worst case: 10 ids, 20 deep deliverables each, 5,000-char lines, a 500-char display name.
- **Dependencies are injected** (`waitForAgents`, `readOutput`, `statFile`, `now`), so Batch 34 can wire them to `ptahAPI.agent` or to the manager.

### 33.3 `ptah_run_check`

- **Validation.** `project` must match `^[A-Za-z0-9@/_.-]{1,120}$` and must also not start with `-`, so it cannot reach Nx as an option. `targets` must be a subset of test, lint, typecheck and build; duplicates are removed. `timeoutSec` is 1..900 (default 600). The schema is strict.
- **How it runs.** It spawns `node <nxEntry> run-many -t <targets> -p <project> --outputStyle=static` from an argument array, with `shell: false`, `windowsHide`, and cwd set to the `workspaceRoot` dependency. On POSIX the process is `detached`, so the tree kill can reach the whole process group. `child_process` is loaded lazily, following the platform-core reaper precedent.
- **The Nx path** comes only from the workspace root, never from the arguments. If Nx is missing, the result is an error that names every path tried, and nothing is spawned.
- **Full log** goes to `<root>/.ptah/tmp/checks/<iso-ts>-<project with @ and / replaced by _>.log`, opened with `wx`. If the log cannot be written, the check still runs and the reply says why there is no log.
- **Summary (≤4,000 chars):** the verdict (`PASSED`, `FAILED (exit N)` or `TIMED OUT ... process tree was killed`), the duration, and a result per target: passed, failed, not run, incomplete or unknown. Results are parsed from Nx's `> nx run p:t` lines and its `Failed tasks:` list. The summary also gives the log path and, for a run that did not pass, the last output lines above Nx's closing summary, newest kept, with ANSI codes removed.
- **Timeout.** It calls platform-core `killProcessTree(pid)`, then settles on `close`, or 10 s after the kill as a backstop. A launch failure (for example `node` not on PATH) returns an error result.

## Stack observed

- **Wiring:** tsyringe, unchanged. No new token and no new registration (`agent-process-manager.service.ts` constructor).
- **Events:** `eventemitter3` `events` (`:152`).
- **Validation:** zod 4.6.5, strict objects, following `agent-spawn-args.schema.ts`.
- **Tool definitions:** follow `dashboard-propose-spec.tool.ts`, using `MCPToolDefinition` from `../types`.
- **Error-site annotations:** follow `degradation-audit` (`tools/degradation-audit/check-degradation.ts`).

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools`: passed. Lint reports 0 errors. Running eslint on only the changed files gives 2 warnings, and both were there before: `max-lines` and an empty arrow at `acquireSpawnLock`.
- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools --maxWorkers=2`: passed.
  - cli-agent-runtime: 87 suites, 1749 passed, 1 skipped.
  - vscode-lm-tools: 84 suites, 2721 passed.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge`: 6 projects passed.
- `npx nx run di-lint:lint`: OK (1719 `@inject` sites, 754 tokens).
- `npx nx run degradation-audit:lint` (also re-run with `--skip-nx-cache`): passed. `libs/backend/vscode-lm-tools` is at 2, against a baseline of 2. The new catch sites carry `optional-capability` annotations.

## Plan deviations

- **Nx entry path.** The plan names `node_modules/nx/bin/nx.js`, but the installed Nx is 23.2.1 and its `bin` is `./dist/bin/nx.js`; `node_modules/nx/bin` does not exist. `run-check` tries `node_modules/nx/dist/bin/nx.js` first, then `node_modules/nx/bin/nx.js`. Both are fixed paths derived from the workspace root.
- **Barrel export.** `cli-agent-runtime/src/lib/cli-agents/index.ts` now exports the wait types and `MAX_AGENT_WAIT_MS`. The tool imports them as types only, so tsyringe is not pulled in at runtime.
- **Leading dash.** `project` is additionally refused when it starts with `-`. The pattern alone allows `--help` and similar values, which would reach Nx as an option.
- **Defaults** the plan does not set: `mode` defaults to `all`, both timeouts default to 600 s, and `agentIds` is capped at 10.
- **Scope of this batch.** Neither tool is wired to the HTTP or stdio dispatchers, and `ptah.agent.waitFor` is not rewritten; both are Batch 34. The handlers take injected dependencies, so Batch 34 has to:
  - pass `workspaceRoot`, resolved the way `resolveSpoolRoot` resolves it, never from the arguments;
  - parse the arguments with the schemas, using `describeZodIssues` for errors;
  - map `RunCheckOutcome.isError` to `toolErrorResponse`.

## Out-of-scope observations

- **Batch 34 must not spool these replies.** `getToolResultBudget` has no entry for either tool. That is fine, because the replies stay under the 8,000-char default, so Batch 34 should not add an override.
- **Deliverable logic is duplicated.** `lane-completion-notifier.service.ts` keeps its deliverable check private, so `agent-wait.tool.ts` repeats about 10 lines of path resolution. A public helper there would remove the duplicate, but that file is outside this batch.
