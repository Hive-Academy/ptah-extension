# Code Style Review, TASK_2026_597 phase S4-a (new public API)

Verdict: APPROVED (0 Blocking, 0 Serious, 2 Moderate, 3 Minor)

Scope examined: `agent-wait.tool.ts`, `run-check.tool.ts` (header, types, tool definition, exports), `wait-tools-args.schema.ts`, the `ptah_agent_wait` and `ptah_run_check` cases in `protocol-dispatcher.ts`, `handleWait` and `handleRunCheck` in `agent-tool.dispatcher.ts`, `tool-builders.ts`, the cli-agent-runtime barrel and DI token/registration diffs, the tool-output-reducers barrel. I did not read the bodies of `execute`, `spawnWithoutShell` or `openLog`, nor `apply-output-budget.ts` and `spool.ts`. Runtime logic is out of scope here and belongs to code-logic-reviewer.

## Findings

### Moderate

1. Two sources of truth for the 900 s wait ceiling.
   - `wait-tools-args.schema.ts:19` defines `MAX_WAIT_TIMEOUT_SEC = 900`.
   - `agent-process-manager.service.ts:137` defines `MAX_AGENT_WAIT_MS = 900_000`, which is newly exported from the barrel at `cli-agents/index.ts`.
   - The agent namespace builder already imports the ms constant. The new tool layer re-declares the same number in seconds, with a comment that only says "Codex's tool timeout is 960 s".
   - If one changes, `args.timeoutSec * 1000` silently exceeds or undershoots the manager's clamp.
   - Fix: derive it, `MAX_WAIT_TIMEOUT_SEC = MAX_AGENT_WAIT_MS / 1000`, importing from `@ptah-extension/cli-agent-runtime`. `run_check` has no manager clamp, so it can share the same derived value.

2. `readOnlyHint` and annotation parity.
   - `ptah_agent_wait` (`agent-wait.tool.ts:97-101`) sets `readOnlyHint: true`, `destructiveHint: false` and `idempotentHint: true`. Siblings set only the hint they need (`tool-description.builder.ts:256`, `:1091`, `:1517`). That is acceptable, but the three-flag set is new.
   - `ptah_run_check` (`run-check.tool.ts:150`) sets `destructiveHint: false, openWorldHint: false`. It spawns Nx and writes a log under `.ptah/tmp`, so omitting `readOnlyHint` is correct. However, no existing sibling uses `openWorldHint`, and Nx executes arbitrary project targets (`test`, `build`), which can have side effects.
   - Fix: drop `openWorldHint`, or add a one-line comment saying why it is false.

### Minor

1. `agent-tool.dispatcher.ts:4` still says "Routes the seven 1:1 wrapper MCP tools". The method list is now nine, and the next sentence adds the two waits, so the opening count is stale. `mcp-stdio/index.ts` was updated to "10-tool" but still says "MVP" for a catalog that is no longer minimal. This is cosmetic.
2. `agent-wait.tool.ts:25` and `run-check.tool.ts:26` import `MCPToolDefinition` from `'../types'`. That matches `session-tools.ts:16` and `surface-tools.ts:37`. `tool-builders.ts` uses `'../mcp-core/types/mcp-protocol.types'` instead. It is consistent within mcp-core, so no action is needed. I note it only because the two paths differ across the sibling directories.
3. `run-check.tool.ts:128-131` repeats the project pattern as a JSON-schema string (`'^[A-Za-z0-9@/_.][A-Za-z0-9@/_.-]{0,119}$'`), while the zod side uses `RUN_CHECK_PROJECT_PATTERN` plus a `.refine` (`wait-tools-args.schema.ts:65-76`). The two encode the same rule differently, and nothing keeps them in step. A one-line comment next to the schema pointing at the zod pattern would help. `agent-wait` has the same shape of outline-versus-enforcement split, but there the schema header documents it.

## Checks passed

- Naming: HTTP names are `ptah_agent_wait` and `ptah_run_check`. The stdio names `agent_wait` and `run_check` come from `rename()` over the same builder (`tool-builders.ts:120-126`), the same mechanism as the other seven tools. The names appear in `MCP_MVP_TOOL_NAMES` and the dispatcher's name list (`agent-tool.dispatcher.ts:235-236`).
- Descriptions follow the sibling style: they say what the tool does, give the bounds, and point to `ptah_agent_read` and `ptah_agent_status`. The `ptah_agent_spawn` description gains a pointer to the wait tool (`tool-description.builder.ts`).
- Schema shape: the same zod `.strict()` schemas are shared by both transports. Each dispatcher validates at the boundary (`protocol-dispatcher.ts:1326-1340`, `agent-tool.dispatcher.ts` `handleWait`). The error codes match the existing `mcp_invalid_tool_args` and `mcp_tool_failed`. The `agent` namespace toggle gates both tools, with the doc comment updated at `protocol-dispatcher.ts:381`.
- Import boundaries: cross-library imports go through `@ptah-extension/cli-agent-runtime`, `@ptah-extension/shared` and `@ptah-extension/platform-core`. No deep imports were found. Type-only imports use `import type` (`agent-wait.tool.ts:19-25`).
- Explicit return types: all exported functions have them (`buildAgentWaitTool`, `runAgentWait`, `formatAgentWaitSummary`, `runCheck`, `buildRunCheckTool`).
- DI: `LANE_RESUME_GATE` is added to `CLI_AGENT_RUNTIME_TOKENS` using the `Symbol.for('LaneResumeGate')` convention (`tokens.ts`). `register.ts` uses a cached factory with a comment explaining why a class registration does not work. `OUTPUT_CHANNEL` is registered in the smoke spec. The tools themselves take injected dependency interfaces (`AgentWaitDependencies`, `RunCheckDependencies`) with defaults, which matches the repo's testable-seam style.
- Barrels: `MAX_AGENT_WAIT_MS` and the `AgentWait*` types are exported through `cli-agents/index.ts`. The reducer barrel exports `applyOutputBudget`, `relativeSpoolLocator`, `spoolToolText` and their types, grouped in the existing pattern. `LaneResumeGate` itself is correctly kept internal and reached through its token.
- Dependency direction: `tool-result-budget.ts` shrinks by about 770 lines because the engine moved into `tool-output-reducers`. This is an in-place replacement with no shim, which is what the repo rules ask for.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Barrel-only cross-lib imports | PASS | `agent-wait.tool.ts:19-24`, `run-check.tool.ts:22` |
| `import type` for types | PASS | `agent-wait.tool.ts:19,24,25` |
| Token via `Symbol.for` in the tokens map | PASS | `tokens.ts` `LANE_RESUME_GATE` |
| Explicit return types on exports | PASS | exported functions listed above |
| One source for shared constants | FAIL (Moderate 1) | `wait-tools-args.schema.ts:19` vs `agent-process-manager.service.ts:137` |
| Same schema enforced on both transports | PASS | both dispatchers use `AgentWaitArgsSchema` and `RunCheckArgsSchema` |

Score: 8/10. A 9 would remove the duplicated timeout constant and the stale doc counts.
