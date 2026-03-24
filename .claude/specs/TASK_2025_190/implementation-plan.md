# Implementation Plan - TASK_2025_190: Codex SDK Headless Mode & Permission Bridge

## Codebase Investigation Summary

### Critical Discovery: Codex SDK Has No Hook-Based Permission Callbacks

The most important finding from investigating the actual `@openai/codex-sdk` TypeScript definitions (`node_modules/@openai/codex-sdk/dist/index.d.ts`) is that the Codex SDK does **NOT** provide hook-based permission callbacks like the Copilot SDK does.

**Copilot SDK** provides:

- `hooks.onPreToolUse` -- async callback invoked before each tool execution, returns allow/deny
- `onPermissionRequest` -- async callback for shell/file/MCP operations, returns approved/denied

**Codex SDK** provides only:

- `approvalPolicy: 'never' | 'on-request' | 'on-failure' | 'untrusted'` -- upfront config on `ThreadOptions`
- `sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'` -- upfront config on `ThreadOptions`

There is no way to intercept individual tool calls at runtime in the Codex SDK. The `approvalPolicy` controls whether the Codex CLI's internal TUI prompts for approval (which is invisible in headless SDK mode). This means the "permission bridge" for Codex is a **configuration bridge**, not an event bridge.

### Files Investigated

| File                                                | Key Findings                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-cli.adapter.ts` (858 lines)                  | `runSdk()` at line 445: creates `CodexThreadOptions` with `approvalPolicy` and `sandboxMode` fields defined in local types but `sandboxMode` never set. Line 484: `approvalPolicy` maps from `autoApprove` boolean. `setAgentId` is no-op (line 622-624, comment: "No permission hooks that need agentId routing"). |
| `copilot-permission-bridge.ts` (310 lines)          | EventEmitter-based bridge with `PermissionPolicy` interface, `PERMISSION_PRESETS` (readOnly/safeWrite/fullAuto), pending request Map with timeout, `requestToolPermission()` and `requestFilePermission()` methods.                                                                                                 |
| `copilot-sdk.adapter.ts` (lines 400-560)            | Shows how Copilot uses `hooks.onPreToolUse` and `onPermissionRequest` callbacks that delegate to the bridge. This pattern cannot be directly ported to Codex because Codex has no such callbacks.                                                                                                                   |
| `cli-adapter.interface.ts` (137 lines)              | `CliCommandOptions` has `autoApprove?: boolean` at line 43. `SdkHandle` has `setAgentId` at line 76 (for Copilot permission routing).                                                                                                                                                                               |
| `agent-permission.types.ts` (111 lines)             | `AgentPermissionRequest` and `AgentPermissionDecision` types -- used by Copilot bridge for RPC to webview.                                                                                                                                                                                                          |
| `agent-process-manager.service.ts` (lines 160-166)  | `resolveAutoApprove()` reads `codexAutoApprove` from VS Code config, returns boolean. Passed to `runSdk()` via `CliCommandOptions.autoApprove`.                                                                                                                                                                     |
| `agent-rpc.handlers.ts` (lines 60-550)              | Permission response handler at line 519 routes to Copilot bridge only. `codexAutoApprove` config read/write exists. No Codex-specific permission routing.                                                                                                                                                           |
| `rpc-method-registration.service.ts` (line 353-390) | `setupCopilotPermissionForwarding()` wires Copilot bridge events to webview broadcast. No equivalent for Codex.                                                                                                                                                                                                     |
| `cli-detection.service.ts` (205 lines)              | Codex adapter created as plain `new CodexCliAdapter()` at line 35 (no permission bridge). Copilot gets `new CopilotSdkAdapter(permissionBridge)` at line 39.                                                                                                                                                        |
| `rpc.types.ts` (lines 1304-1370)                    | `AgentOrchestrationConfig` has `codexAutoApprove: boolean` and `copilotAutoApprove: boolean`. `AgentSetConfigParams` mirrors these.                                                                                                                                                                                 |
| `@openai/codex-sdk/dist/index.d.ts` (273 lines)     | Full SDK type definitions. `ThreadOptions` has `sandboxMode`, `approvalPolicy`, `model`, `workingDirectory`, `skipGitRepoCheck`, `modelReasoningEffort`, `webSearchMode`, `networkAccessEnabled`, `additionalDirectories`. NO callback hooks. NO event types for approval requests.                                 |

### Libraries & Patterns

- **EventEmitter pattern**: `eventemitter3` used by CopilotPermissionBridge and AgentProcessManager for event forwarding
- **Permission presets**: `PERMISSION_PRESETS` object in copilot-permission-bridge.ts with `readOnly`, `safeWrite`, `fullAuto` presets
- **RPC forwarding**: Bridge emits `permission-request` events, `setupCopilotPermissionForwarding()` in rpc-method-registration.service.ts broadcasts to webview
- **Config resolution**: `resolveAutoApprove()` and `resolveReasoningEffort()` in AgentProcessManager read per-CLI VS Code settings

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Configuration Bridge (not Event Bridge)

Since the Codex SDK lacks runtime permission hooks, the "permission bridge" for Codex is fundamentally different from Copilot's. Instead of intercepting individual tool calls, we:

1. Map user-facing permission tiers to Codex SDK's `sandboxMode` + `approvalPolicy` upfront config
2. Reuse the `PermissionPolicy` and `PERMISSION_PRESETS` types from the Copilot bridge for consistency
3. Create a lightweight `CodexPermissionBridge` that translates permission tiers to SDK thread options (no EventEmitter needed since there are no runtime events to forward)

**Rationale**: The Codex SDK operates as a sandboxed subprocess. Permission control happens at the sandbox boundary level (`sandboxMode`) and at the approval checkpoint level (`approvalPolicy`). There is no mechanism to intercept individual tool calls like Copilot's `onPreToolUse`. Trying to force an event-bridge pattern would be over-engineering with no functional benefit.

### Component Specifications

#### Component 1: CodexPermissionBridge

**Purpose**: Translate user-facing permission tier settings into Codex SDK `ThreadOptions` configuration. Provides a unified API consistent with `CopilotPermissionBridge` for future extensibility.

**Pattern**: Stateless configuration mapper (simpler than Copilot's EventEmitter bridge because Codex has no runtime callbacks)

**Evidence**:

- `PERMISSION_PRESETS` pattern from copilot-permission-bridge.ts:76-100
- `CodexThreadOptions` type from codex-cli.adapter.ts:55-62
- Codex SDK `ApprovalMode` and `SandboxMode` types from index.d.ts:232-233

**Responsibilities**:

- Store the active permission tier (Safe / Standard / Full Auto)
- Map permission tier to `sandboxMode` value
- Map permission tier to `approvalPolicy` value
- Provide backward-compatible `autoApprove` getter/setter (matches CopilotPermissionBridge API)
- Export `CODEX_PERMISSION_TIERS` mapping constant

**Permission Tier Mapping**:

```typescript
// Safe mode: Maximum restrictions
{ sandboxMode: 'read-only', approvalPolicy: 'on-request' }

// Standard mode: Normal development workflow
{ sandboxMode: 'workspace-write', approvalPolicy: 'on-failure' }

// Full Auto mode: No restrictions (current default behavior)
{ sandboxMode: 'danger-full-access', approvalPolicy: 'never' }
```

**Key Design Decision**: The `approvalPolicy` values `'on-request'` and `'on-failure'` in headless SDK mode mean the Codex CLI subprocess itself will handle approval logic internally. Since there's no TUI in headless mode, `'on-request'` effectively makes Codex ask for approval on every tool use (which it resolves internally based on the sandbox boundary), while `'on-failure'` only requires approval after a failed attempt. This is different from Copilot where approval routes to Ptah UI.

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-permission-bridge.ts` (CREATE)

#### Component 2: Codex Adapter sandboxMode + approvalPolicy Integration

**Purpose**: Pass `sandboxMode` and `approvalPolicy` from CodexPermissionBridge to the SDK thread options. Currently `sandboxMode` is defined in the type but never set (codex-cli.adapter.ts:60), and `approvalPolicy` uses a simple boolean mapping (line 484).

**Pattern**: Same pattern as existing `approvalPolicy` mapping at codex-cli.adapter.ts:484, extended with sandboxMode.

**Evidence**:

- `CodexThreadOptions` already defines `sandboxMode` at line 60 but it's unused
- `approvalPolicy` mapping at line 484: `options.autoApprove === false ? 'on-failure' : 'never'`
- Codex SDK `ThreadOptions` at index.d.ts:236-247 confirms both fields are supported

**Responsibilities**:

- Accept `CodexPermissionBridge` as constructor parameter (like CopilotSdkAdapter accepts CopilotPermissionBridge)
- In `runSdk()`, read `sandboxMode` and `approvalPolicy` from the bridge instead of the boolean `autoApprove` flag
- Fall back to current behavior when bridge is not configured (backward compatible)

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)

#### Component 3: CliDetectionService Codex Bridge Wiring

**Purpose**: Wire CodexPermissionBridge into CodexCliAdapter the same way CopilotPermissionBridge is wired into CopilotSdkAdapter.

**Pattern**: Exact same pattern as cli-detection.service.ts:37-39 where CopilotPermissionBridge is created and passed to CopilotSdkAdapter.

**Evidence**:

- cli-detection.service.ts:37-39: `const permissionBridge = new CopilotPermissionBridge(); this.adapters.set('copilot', new CopilotSdkAdapter(permissionBridge));`

**Responsibilities**:

- Create `CodexPermissionBridge` instance in CliDetectionService constructor
- Pass bridge to `CodexCliAdapter` constructor
- Expose bridge for RPC handler access (same pattern as Copilot: `adapter.permissionBridge`)

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (MODIFY)

#### Component 4: RPC Handler Updates for Codex Permission Tier

**Purpose**: Enable the frontend settings UI to read/write the Codex permission tier, and route the bridge sync when config changes (same pattern as Copilot's `setAutoApprove` sync).

**Pattern**: Same pattern as agent-rpc.handlers.ts:309-315 (codexAutoApprove config update) and lines 74-84 (Copilot bridge initialization).

**Evidence**:

- agent-rpc.handlers.ts:309-315: `codexAutoApprove` config write pattern
- agent-rpc.handlers.ts:74-84: Copilot bridge init from saved config
- agent-rpc.handlers.ts:324-331: Copilot bridge sync on config change

**Responsibilities**:

- Replace `codexAutoApprove: boolean` with `codexPermissionTier: 'safe' | 'standard' | 'full-auto'` in config types
- On `agent:setConfig`, sync the tier to CodexPermissionBridge (same as Copilot bridge sync)
- On startup, initialize CodexPermissionBridge from saved config
- Backward compatibility: if `codexAutoApprove` exists in old config, map `true` -> `'full-auto'`, `false` -> `'standard'`

**Files Affected**:

- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` (MODIFY)

#### Component 5: MCP Config Always Forwarded

**Purpose**: Ensure `mcp_servers` config is always passed to Codex SDK, not gated behind `options.mcpPort` being truthy.

**Pattern**: Existing pattern at codex-cli.adapter.ts:460-466 already passes MCP config when `options.mcpPort` is set. The concern from the task description is that MCP should always be available.

**Evidence**:

- codex-cli.adapter.ts:460-466: MCP config is only set when `options.mcpPort` is truthy
- agent-process-manager.service.ts:284-285: `mcpPort` resolution is gated by `adapter.supportsMcp !== false` AND premium status AND MCP server running

**Analysis**: The MCP port is already correctly forwarded when available. The gating is in AgentProcessManager (`resolveMcpPort()`) which checks if the MCP server is actually running. We should ensure the Codex adapter does not additionally filter this -- currently it doesn't; it passes whatever `options.mcpPort` it receives. No code change needed here unless the task means "always start MCP server for Codex" which is a process manager concern, not adapter concern.

**Decision**: Verify existing behavior is correct. If MCP port is provided, it's forwarded. The real fix if needed is in `resolveMcpPort()` to always provide the port (not gated behind premium). Mark as verification-only.

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (VERIFY - likely no change needed)

#### Component 6: Timeout Wrapper for thread.runStreamed()

**Purpose**: Wrap `thread.runStreamed()` with a `Promise.race` timeout to prevent indefinite hangs if the Codex SDK subprocess becomes unresponsive.

**Pattern**: Standard `Promise.race([operation, timeoutPromise])` pattern. The AbortController is already wired (codex-cli.adapter.ts:509) but there's no timeout on the initial `runStreamed()` call itself.

**Evidence**:

- codex-cli.adapter.ts:572: `const streamedTurn = await thread.runStreamed(taskPrompt, { signal: abortController.signal })` -- no timeout
- agent-process-manager.service.ts:534-540: Timeout is handled at the AgentProcessManager level via `setTimeout` and `handleTimeout(agentId)`, which calls `sdkHandle.abort.abort()`. This means a timeout already exists externally.

**Analysis**: The AgentProcessManager already applies a timeout (default 1 hour, configurable) that aborts the SDK handle. However, the `thread.runStreamed()` initial call (connecting to the Codex subprocess) could hang before streaming begins. A startup timeout (30 seconds) on the `runStreamed()` Promise would catch this case.

**Responsibilities**:

- Add a startup timeout (configurable, default 30s) on `thread.runStreamed()`
- If timeout fires, abort the thread and emit an error segment
- The streaming loop itself is covered by AgentProcessManager's timeout

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)

#### Component 7: PowerShell / Environment Variable Fix

**Purpose**: Add `FORCE_COLOR=0` and `NO_COLOR=1` to the Codex SDK subprocess environment to prevent ANSI escape codes in output.

**Pattern**: Same pattern as other CLI adapters. The Codex SDK's `CodexOptions.env` field (index.d.ts:229) accepts `Record<string, string>`.

**Evidence**:

- codex-cli.adapter.ts:449-452: `codexOptions` is built without `env` field currently
- Codex SDK index.d.ts:228-229: `env?: Record<string, string>` -- "When provided, the SDK will not inherit variables from process.env"
- CLAUDE.md project memory: "FORCE_COLOR=0, NO_COLOR=1 env vars" needed for CLI agents

**CRITICAL WARNING**: The SDK docs say "When provided, the SDK will not inherit variables from process.env". This means we CANNOT just set `env: { FORCE_COLOR: '0', NO_COLOR: '1' }` because it would eliminate all other env vars (PATH, HOME, OPENAI_API_KEY, etc.). We must spread `process.env` into the env object.

**Responsibilities**:

- Set `codexOptions.env` to `{ ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }`
- Ensure existing env vars (especially PATH, OPENAI_API_KEY) are preserved

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)

#### Component 8: Frontend Settings UI Update

**Purpose**: Replace the binary "Auto Approve" toggle for Codex with a three-tier permission dropdown (Safe / Standard / Full Auto).

**Pattern**: Existing settings component at `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` (lines 201, 538)

**Evidence**:

- agent-orchestration-config.component.ts:201: `[checked]="agentConfig()!.codexAutoApprove"` -- current boolean toggle
- agent-orchestration-config.component.ts:538: maps `codexAutoApprove` key

**Responsibilities**:

- Replace boolean toggle with three-option selector (radio group or dropdown)
- Labels: "Safe Mode (Read-Only)", "Standard (Write + Auto-Retry)", "Full Auto (No Restrictions)"
- Map selection to `codexPermissionTier` config key
- Backward-compatible: display correct tier for existing `codexAutoApprove` values

**Files Affected**:

- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` (MODIFY)

#### Component 9: Barrel Export Updates

**Purpose**: Export `CodexPermissionBridge` and related types from the llm-abstraction library barrel.

**Evidence**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts:17`: `export { CopilotPermissionBridge } from './copilot-permission-bridge';`
- `libs/backend/llm-abstraction/src/index.ts:84`: `export { CopilotPermissionBridge } from './lib/services/cli-adapters';`

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts` (MODIFY)
- `libs/backend/llm-abstraction/src/index.ts` (MODIFY)

---

## Critical Design Decisions

### Decision 1: Configuration Bridge vs. Event Bridge

**Decision**: Use a stateless configuration bridge for Codex (not the EventEmitter pattern from Copilot).

**Rationale**: The Codex SDK has zero runtime permission callbacks. The `approvalPolicy` and `sandboxMode` are set once at thread creation. Creating an EventEmitter-based bridge with pending request Maps would be dead code. The Copilot bridge pattern (EventEmitter + pending Map + timeout) is specifically designed for Copilot's hook-based SDK. Codex needs a different, simpler pattern.

**Evidence**: `@openai/codex-sdk/dist/index.d.ts` -- no callback types in `ThreadOptions`, `CodexOptions`, `Thread`, or `Codex` classes. Only `TurnOptions.signal` for abort.

### Decision 2: Permission Tier Naming

**Decision**: Use "Safe / Standard / Full Auto" tiers instead of mapping directly to SDK enum names.

**Rationale**: SDK names like `'on-failure'` and `'workspace-write'` are implementation details. User-facing tiers should describe the security posture. This also allows future changes to the underlying SDK mapping without changing the user-facing API.

### Decision 3: Environment Variable Spreading

**Decision**: Spread `process.env` into Codex SDK's `env` option.

**Rationale**: The SDK explicitly states env vars are NOT inherited when `env` is provided. Without spreading, the Codex subprocess would lose PATH, HOME, API keys, and other critical environment variables. This is a correctness requirement, not an optimization.

### Decision 4: Startup Timeout vs. Full Timeout

**Decision**: Add a 30-second startup timeout on `thread.runStreamed()` only. Do NOT add a separate streaming timeout.

**Rationale**: The AgentProcessManager already applies a configurable timeout (default 1 hour) to the entire SDK handle lifecycle. Adding another full timeout would create confusing double-timeout behavior. The startup timeout catches only the case where the Codex subprocess fails to start or connect.

### Decision 5: Backward Compatibility for codexAutoApprove

**Decision**: Replace `codexAutoApprove: boolean` with `codexPermissionTier: string` in config types, with migration logic.

**Rationale**: The boolean `autoApprove` cannot express three tiers. Migration: `true` -> `'full-auto'`, `false` -> `'standard'`. Old config values are handled gracefully.

---

## Risk Assessment

| Risk                                                           | Severity | Mitigation                                                                                                                                                                    |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex SDK `env` override breaks subprocess                     | HIGH     | Spread `process.env` first, add `FORCE_COLOR`/`NO_COLOR` on top. Test on Windows.                                                                                             |
| `approvalPolicy: 'on-request'` in headless mode causes hang    | MEDIUM   | The Codex subprocess handles approval internally; in headless mode with `--full-auto` equivalent config, it should auto-resolve. Test with `'on-request'` to verify behavior. |
| Breaking change in `AgentOrchestrationConfig.codexAutoApprove` | LOW      | Add migration in RPC handler: read old boolean, convert to tier string.                                                                                                       |
| Startup timeout fires during slow Codex initialization         | LOW      | 30 seconds is generous. Make it configurable via private constant.                                                                                                            |

---

## Integration Architecture

### Data Flow: Permission Tier -> Codex SDK

```
User selects "Standard" in Settings UI
  -> RPC: agent:setConfig({ codexPermissionTier: 'standard' })
  -> agent-rpc.handlers.ts writes VS Code config
  -> agent-rpc.handlers.ts syncs to CodexPermissionBridge
  -> CodexPermissionBridge stores tier

User spawns Codex agent
  -> AgentProcessManager.doSpawnSdk()
  -> CodexCliAdapter.runSdk(options)
  -> CodexCliAdapter reads bridge.getThreadOptions()
  -> Returns { sandboxMode: 'workspace-write', approvalPolicy: 'on-failure' }
  -> Codex SDK new Thread(threadOptions) with correct sandbox/approval config
```

### Data Flow: Environment Fix

```
CodexCliAdapter.runSdk()
  -> codexOptions.env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  -> new sdk.Codex(codexOptions)  // env passed to subprocess
```

---

## Quality Requirements

### Functional Requirements

- Permission tiers correctly map to Codex SDK `sandboxMode` and `approvalPolicy` values
- Settings UI displays three tiers with clear descriptions
- Existing `codexAutoApprove: true` users default to Full Auto tier (no behavior change)
- Environment variables include `FORCE_COLOR=0` and `NO_COLOR=1`
- Startup timeout prevents indefinite hangs on `runStreamed()`

### Non-Functional Requirements

- **Performance**: CodexPermissionBridge is stateless lookup -- zero overhead
- **Maintainability**: Bridge follows same public API shape as CopilotPermissionBridge for consistency
- **Testability**: Bridge is pure config mapping -- easily unit testable

### Pattern Compliance

- Must follow adapter constructor injection pattern (cli-detection.service.ts:37-39)
- Must follow config sync pattern (agent-rpc.handlers.ts:324-331)
- Must follow barrel export pattern (index.ts re-exports)

---

## Files Affected Summary

**CREATE**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-permission-bridge.ts`

**MODIFY**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` -- sandboxMode, env vars, startup timeout, bridge integration
- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` -- wire CodexPermissionBridge
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts` -- barrel export
- `libs/backend/llm-abstraction/src/index.ts` -- barrel export
- `libs/shared/src/lib/types/rpc.types.ts` -- replace `codexAutoApprove` with `codexPermissionTier`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` -- bridge init, config sync, migration
- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` -- three-tier UI

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary), frontend-developer (Component 8 only)

**Rationale**:

- 7 of 9 components are backend TypeScript changes (adapter, bridge, RPC handlers, types)
- Only Component 8 (settings UI) requires Angular/frontend work
- The Angular change is minimal (replace toggle with radio group)
- A single backend developer can handle all backend components; frontend change can be done by same developer if comfortable with Angular, or delegated

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- CodexPermissionBridge (Component 1): 30 min -- small stateless class
- Adapter integration (Component 2): 45 min -- modify existing runSdk()
- CliDetection wiring (Component 3): 15 min -- add 2 lines
- RPC handler updates (Component 4): 60 min -- config migration, sync logic
- MCP verification (Component 5): 15 min -- verify existing behavior
- Timeout wrapper (Component 6): 30 min -- Promise.race pattern
- Env var fix (Component 7): 15 min -- add env spread
- Frontend UI (Component 8): 45 min -- replace toggle with radio group
- Barrel exports (Component 9): 10 min -- add export lines

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Codex SDK env behavior**:

   - Confirm that `{ ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }` preserves PATH and API keys
   - Test on Windows specifically (PATH resolution differs)

2. **approvalPolicy in headless mode**:

   - Test `'on-request'` with Codex SDK -- does the subprocess hang waiting for TUI input, or does it auto-resolve?
   - If `'on-request'` causes hangs, Safe mode should use `'on-failure'` instead (and rely solely on `sandboxMode: 'read-only'` for restriction)

3. **Backward compatibility**:

   - Existing `codexAutoApprove: true` in VS Code settings must map to `'full-auto'` tier
   - Existing `codexAutoApprove: false` must map to `'standard'` tier
   - No existing user should see changed behavior after upgrade

4. **All imports verified**:

   - `EventEmitter` from `eventemitter3` (copilot-permission-bridge.ts:17) -- NOT needed for Codex bridge
   - `AgentPermissionRequest`/`AgentPermissionDecision` from `@ptah-extension/shared` -- NOT needed for Codex bridge (no runtime events)
   - `PermissionPolicy`/`PERMISSION_PRESETS` from copilot-permission-bridge.ts -- can be referenced for consistency but Codex bridge defines its own tier mapping

5. **VS Code configuration key**:
   - New config key: `ptah.agentOrchestration.codexPermissionTier`
   - Must be declared in `package.json` contributes.configuration if not already dynamic
   - Check if existing config keys are declared or purely dynamic

### Architecture Delivery Checklist

- [x] All components specified with evidence (file:line citations)
- [x] All patterns verified from codebase (copilot bridge, adapter injection, RPC sync)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented (data flow diagrams)
- [x] Files affected list complete (1 create, 7 modify)
- [x] Developer type recommended (backend primary)
- [x] Complexity assessed (MEDIUM, 4-6 hours)
- [x] Critical discovery documented (Codex SDK has no permission hooks)
- [x] Risk assessment with mitigations provided
