# PR #642 review findings: lane wait and tools (CodeRabbit)

Verdict: all 4 findings were valid and all 4 are FIXED. Every requested check passes.

## Findings

1. **FIXED**: `handleTimeout` never emitted `agent:exited`, so a wait in `all` mode could block for up to 15 minutes.
   Confirmed in the code: `handleTimeout` stamps `status: 'timeout'` and then awaits `killProcess`. Only `handleExit` emits `agent:exited`, and it runs only after the abort settles. If the adapter never settles the abort, the event never fires. `waitForAgents` listens only to that event, so it waited until its own timer ran out.
   The fix is in `agent-process-manager.service.ts` `handleTimeout`. After `signalLaneCompletion`, and before the kill, it now sets `tracked.hasExited = true` and emits `agent:exited`. A later real exit then hits `handleExit`'s existing `if (tracked.hasExited) return`, so the event is never emitted twice. Waiters cannot count a lane twice either, because they already guard with `pending.delete`. Skipping `handleExit` would also skip its flush and buffer cleanup, so `handleTimeout` now runs `flushDelta` and `outputBuffer.discard` after the kill, the same way `stop()` does. `scheduleIdleRelease` does not apply here because `subprocessReleased` is already true.
   New spec case in `agent-process-manager.wait.spec.ts`: the abort never settles, the wait settles without timing out and reports `timeout`, and a later `handleExit` adds no second `agent:exited`.
2. **FIXED**: `run_check` `inputSchema` was missing `additionalProperties: false`.
   Confirmed: `RunCheckArgsSchema` is `.strict()`, but the published schema allowed extra keys. Added `additionalProperties: false`. The stdio `run_check` tool is built from the same definition (`rename(buildRunCheckTool())`), so it picks this up too. A fresh object literal cannot carry a property the type does not declare, so I widened the type: `MCPToolDefinition.inputSchema` in `mcp-core/types/mcp-protocol.types.ts` now has `additionalProperties?: boolean`. That is an additive change. `run-check.tool.spec.ts` now asserts the value. `agent-spawn-surface-parity.spec.ts` compares only property keys and the HTTP and stdio definitions, so it still passes.
3. **FIXED**: `waitFor` timeout normalisation in `agent-namespace.builder.ts`.
   Confirmed: a negative, NaN or fractional timeout went to the error message as given, while the manager clamped or floored the wait that actually ran. Now a missing value defaults to `MAX_AGENT_WAIT_MS`. A number above 0 is floored and capped at `MAX_AGENT_WAIT_MS`. Anything else (negative, NaN, not a number) becomes 0. Spec cases added to `agent-namespace.builder.spec.ts` for -5, NaN, `'soon'` and 1234.9: each checks that the value passed to `waitForAgents` matches the value in the error message.
4. **FIXED** (nitpick): barrel exports in `mcp-stdio/index.ts`.
   `buildMcpAgentWaitTool` and `buildMcpRunCheckTool` are exported from `tool-builders.ts` like the other per-tool builders, but the barrel left them out. Nothing shows they are meant to stay internal, so both are now exported. I also corrected the header comment, which still said "the six `agent_*` tools". The package root `src/index.ts` re-exports names one by one, so its public surface has not changed.

## Changed files

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.wait.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/index.ts`

## Checks

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools`: "Successfully ran targets test, lint, typecheck for 2 projects". Test suites: 88 passed (1765 tests passed, 1 skipped) and 84 passed (2762 tests passed). Lint: 0 errors in both projects, with 44 and 72 warnings. The warnings in `agent-process-manager.service.ts` (`max-lines`, and an empty arrow function at line 1726) were there before and are outside the edited lines. The `lane-budget-guard.*` specs passed as part of the suite.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge`: "Successfully ran target typecheck for 6 projects".
- `npx nx run di-lint:lint`: passed (cache hit).
- `npx nx run degradation-audit:lint`: passed (cache hit).
- `.png` restore: no `.png` files were rewritten.
