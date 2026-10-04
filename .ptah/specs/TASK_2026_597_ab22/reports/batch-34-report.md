# Backend implementation — `TASK_2026_597`, batch 34 (blocking waits: surfaces and `waitFor` rewrite)

**Tasks completed**: 34.1, 34.2. Task 34.2 also covers F6-M1, PR1-M1 and the Batch 7 `effort` bound carried into it.

All paths below are under `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/`. Unless noted, the directory is `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

## Files

Source:

- MODIFIED `types.ts`.
  - `AgentNamespace.waitFor` now takes `options?: { timeout?: number }`. `pollInterval` is removed and the doc comment no longer says "polling".
  - New method `AgentNamespace.waitForAgents(agentIds, mode, timeoutMs): Promise<AgentWaitResult>`. It imports types only from `cli-agent-runtime`.
- MODIFIED `namespace-builders/agent-namespace.builder.ts`.
  - Rewrote `waitFor` and added `waitForAgents`.
  - Added `effort` validation, the `systemPrompt` drop with a WARN, and the Ptah CLI `effort` WARN.
  - New required dependency: `logger: { warn }`.
- MODIFIED `namespace-builders/system-namespace.builders.ts`: rewrote the `ptah.agent` help text under WAITING (at `:508`).
- MODIFIED `ptah-api-builder.service.ts`: passes `logger: this.logger` to `buildAgentNamespace`. This is the only production call site.
- MODIFIED `mcp-core/protocol-dispatcher.ts`.
  - Lists `ptah_agent_wait` and `ptah_run_check` in the `agent` group, after the session tools.
  - Adds handlers for both tools.
- MODIFIED `mcp-core/tool-description.builder.ts`: the `ptah_agent_spawn` description now points callers at one `ptah_agent_wait` call instead of a status loop.
- MODIFIED `mcp-stdio/tool-builders.ts`: adds `agent_wait` and `run_check` to `MCP_MVP_TOOL_NAMES`, adds `buildMcpAgentWaitTool` and `buildMcpRunCheckTool`, and the catalog now has 10 tools.
- MODIFIED `mcp-stdio/agent-tool.dispatcher.ts`: adds `agent_wait` and `run_check` to `TOOL_NAMES`, with `handleWait` and `handleRunCheck`.
- MODIFIED, comment only: `mcp-core/agent-wait.tool.ts` and `mcp-core/run-check.tool.ts` (the stale "wired by Batch 34" line), `mcp-stdio/index.ts` and `mcp-stdio/stdio-mcp-server.service.ts` (tool counts). Prettier also reflowed one existing union type in `stdio-mcp-server.service.ts`.

Specs:

- MODIFIED `namespace-builders/agent-namespace.builder.spec.ts`.
  - Replaced the two polling tests with 5 `waitFor` tests and 1 `waitForAgents` test.
  - Added 8 spawn-boundary tests.
  - The barrel mock gains `MAX_AGENT_WAIT_MS`.
- MODIFIED `mcp-core/agent-spawn-surface-parity.spec.ts`: new `blocking wait surface parity` block with 17 tests.
- MODIFIED `mcp-core/mcp-contract.sweep.spec.ts`.
  - Updated the pinned counts: HTTP 59→61 and 56→58, apps 62/59→64/61, stdio 8→10, `AgentToolDispatcher.TOOL_NAMES` 7→9.
  - Added a `ptah_agent_wait` driver and listed the tool in `OWN_WINDOWING_TOOLS`.
  - Added `ptah_run_check` to `CONTROL_TOOL_EXCEPTIONS`, with a reason.
  - Added two description budgets: 498→548 and 491→540.
- MODIFIED `mcp-core/protocol-dispatcher.spec.ts`: coding catalog 59/56→61/58.
- MODIFIED `mcp-stdio/stdio-mcp-server.service.spec.ts`: catalog 8→10 and two new `_meta` ceilings.
- MODIFIED `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts` (the `session.describe` catalog, 8→10) and `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts` (`MVP_TOOL_NAMES`, plus length checks that now read the list length).

## What each task did

### 34.1 Advertised schemas and both dispatchers

**HTTP**

- `buildAgentWaitTool()` and `buildRunCheckTool()` (from Batch 33) are listed inside the `agent` namespace toggle. Turning `agent` off removes both; a spec covers this.
- They are placed after the five `ptah_session_*` tools, so the existing "session tools right after `ptah_agent_list`" test still holds.

**`ptah_agent_wait` handler**

- Parses the arguments with `AgentWaitArgsSchema`. A bad argument returns `toolErrorResponse` with `describeZodIssues`.
- Calls `runAgentWait` with `waitForAgents` → `ptahAPI.agent.waitForAgents` and `readOutput` → `ptahAPI.agent.read(id, tail)`.
- The reply is at most 4,000 characters. `createToolSuccessResponse` returns it unchanged and never spools it, and no budget override was added (as the Batch 33 report advised).

**`ptah_run_check` handler**

- Parses the arguments with `RunCheckArgsSchema`.
- `workspaceRoot` comes from `resolveSpoolRoot(deps)`: the host's own record of the folder the caller declared, never an argument.
- `outcome.isError` maps to `toolErrorResponse`; otherwise the result goes through the success path.

**stdio**

- The tools are served as `agent_wait` and `run_check`. Each definition is the HTTP one under the MCP-wire name, with the same `_meta` result ceiling (`ptah_agent_wait` and `ptah_run_check` budget entries, 8,000).
- Validation failures use the stdio convention: `mcp_invalid_tool_args` with the flattened issues.
- The `run_check` workspace root is the dispatcher's `spoolRoot()`, the host process's working directory, which is the same trust level as the stdio spool. It is never an argument.
- `agent_wait` adds `structuredContent` `{timedOut, lanes:[{agentId, state, status?, exitCode?}]}`. `run_check` adds `{project, targets, logPath?}`.

**Parity spec**

The new block checks:

- the HTTP and stdio definitions are equal apart from the name;
- the advertised keys equal the schema keys for both tools;
- both tools are listed on both surfaces and dropped when `agent` is off;
- `agent_wait` makes the same `waitForAgents` call and returns byte-identical text on both surfaces, within 4,000 characters, reporting an unknown id per id;
- five bad `agent_wait` argument sets and five bad `run_check` argument sets (shell metacharacter, leading `--`, unknown target, empty targets, unknown key `cwd`) are rejected on both surfaces without waiting;
- in a temporary workspace with no Nx, both surfaces return the same "Nx was not found ... `<root>/node_modules/nx/...`" error, and nothing is spawned.

### 34.2 `ptah.agent.waitFor` uses `waitForAgents`; help text; F6-M1; PR1-M1

**`waitFor`**

- The `setTimeout` polling loop is gone. `waitFor` now makes one call: `agentProcessManager.waitForAgents([id], 'all', min(timeout ?? MAX_AGENT_WAIT_MS, MAX_AGENT_WAIT_MS))`.
- `exited` returns the terminal record.
- `running` (timed out) rejects with `waitFor timed out after <n>ms for agent <id>: it is still running...`, so the old rejection contract is kept.
- `not_found` and `other_workspace` re-raise the established `getStatus` messages. This keeps the load-bearing `Agent not found: <id>` prefix.
- A spec asserts that `setTimeout` is never called and `getStatus` is not consulted on the success path.

**`waitForAgents`**: a thin delegate to the manager, so the HTTP and stdio wait tools reach the event-driven wait through `PtahAPI`.

**Help text**: now documents `waitFor(agentId, { timeout? })` (default and maximum 900,000 ms) and `waitForAgents(ids, 'any'|'all', timeoutMs)` with its result shape. It notes that a wait cannot outlast `execute_code`'s own timeout, and points callers to `ptah_agent_wait`.

**F6-M1**

- A caller-supplied `systemPrompt` is destructured out of the request, so it no longer reaches `agentProcessManager.spawn`, and logs one WARN: `"systemPrompt" is not a spawn field and was dropped`.
- A non-string `effort` is rejected before anything is resolved or spawned, and so is one outside 1..`MAX_EFFORT_LENGTH` (32, imported from `mcp-core/agent-spawn-args.schema.ts`, so `execute_code` uses the same rule as the MCP surfaces). The error states the type or length and never echoes the value.

**PR1-M1**

- `PtahCliRegistry.spawnAgent` options have no `effort` field (`cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:581-602`), so the WARN path applies.
- When a Ptah CLI spawn carries `effort`, one WARN is logged: `Ptah CLI lanes do not take "effort"; it is ignored for this lane.`, with `{ptahCliId, effort}` attached. A spec checks that the registry options do not carry `effort`.

## Stack observed

- **Wiring:** tsyringe, unchanged. There is no new token or registration. The namespace builders take plain dependency objects; `buildAgentNamespace` has one production call, in `ptah-api-builder.service.ts:657`.
- **Validation:** zod 4 strict schemas at both MCP boundaries, following the existing `AgentSpawnArgsSchema` handling in both dispatchers. A hand-written guard at the `execute_code` boundary, matching how the namespace builders validate today.
- **Logger shape:** `{ warn(message, metadata?) }`, the same as `memory-namespace.builder.ts:28-30`.
- **Errors:** HTTP uses `toolErrorResponse` (`protocol-dispatcher.ts`). stdio uses `toolError` with `mcp_invalid_tool_args` or `mcp_tool_failed` (`agent-tool.dispatcher.ts`).

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-lm-tools`: passed.
- `npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --maxWorkers=2`: 84 suites, 2,750 tests passed. Batch 33 had 2,721; the difference is the new tests.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge`: 6 projects passed.
- `npx nx run di-lint:lint`: OK (1719 `@inject` sites, 754 tokens).
- `npx nx run degradation-audit:lint --skip-nx-cache`: passed. `libs/backend/vscode-lm-tools` is at 2 against a baseline of 2. No new catch sites; the new handlers rethrow or map to error results.
- Extra check, outside the Verify line: `npx jest -c apps/ptah-cli/jest.config.cjs` on `mcp-serve.spec.ts` and `session-describe.builder.spec.ts`: 2 suites, 28 tests passed.
- Not run: the e2e suite `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts`. It needs a built CLI binary. Only its expected tool list was updated.

## Plan deviations

- **Files outside the batch list,** each needed for the batch to work:
  - `types.ts` holds the `AgentNamespace` contract. The HTTP dispatcher reaches the manager only through `PtahAPI`, so `waitForAgents` had to be added there.
  - `ptah-api-builder.service.ts` wires the new required `logger`.
  - `mcp-stdio/tool-builders.ts` is where the stdio catalog is declared.
  - The pinned-count specs: the sweep, `stdio-mcp-server.service.spec.ts`, `protocol-dispatcher.spec.ts` and the two ptah-cli specs.
  - Comment-only count fixes in `mcp-stdio/index.ts` and `stdio-mcp-server.service.ts`.
- **`waitFor` maximum timeout** drops from 1 hour to 15 minutes (`MAX_AGENT_WAIT_MS`). `waitForAgents` clamps to that value, and `execute_code` itself stops at 30 s, so a longer cap could never be reached.
- **`pollInterval`** is removed from the `waitFor` type rather than kept and ignored. No TypeScript caller in `libs/` or `apps/` passed it apart from the old spec. An untyped `execute_code` caller that still passes it is unaffected, because the key is simply not read.
- **`logger` is a required dependency,** not optional. An optional logger would let a host drop `systemPrompt` and `effort` silently, which is the failure F6-M1 and PR1-M1 describe.
- **Tool order on HTTP:** the two wait tools come after the session tools, not directly after `ptah_agent_list`. This keeps the existing session-order contract.
- **Sweep coverage for `ptah_run_check`:** it is a `CONTROL_TOOL_EXCEPTIONS` entry with a stated reason. It launches the workspace Nx in a child process, which the PtahAPI-stub sweep cannot fake. Its 4,000-character bound is asserted in `run-check.tool.spec.ts`, and both surfaces are pinned in the parity spec.
- **`ptah_agent_wait` in the sweep** is an `OWN_WINDOWING_TOOLS` entry. Its reply is self-bounded, so the generic spool and trailer assertions do not apply; the driver floods the output tail and the sweep checks that the newest line survives with no trailer.

## Out-of-scope observations

- **`projectGuidance` and `pluginPaths`.** On the system-CLI path, `ptah.agent.spawn` still forwards a caller-supplied `projectGuidance` or `pluginPaths` through `...requestFields` when the host injects none. `SpawnAgentRequest` documents both as "Injected by MCP server, NOT set by callers", the same class of issue as F6-M1. Not changed here.
- **`resolveSpoolRoot` falls back to `os.tmpdir()`** when the host has no open workspace folder. `ptah_run_check` then reports "Nx was not found in this workspace" and names the temp path. That is correct but indirect; a dedicated "no workspace open" message would be clearer.
- **The e2e suite** (`mcp-serve.e2e.spec.ts`) was updated but not run, because it needs a built CLI binary.
