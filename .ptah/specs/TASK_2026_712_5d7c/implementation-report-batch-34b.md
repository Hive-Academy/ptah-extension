# Backend implementation: `TASK_2026_712`, batch 34b

**Executor**: backend-developer subagent (Claude). No git, no nx/jest/tsc/lint run (orchestrator runs scoped checks).

**Tasks completed**: 34b.1 (optional account selection on `SpawnAgentRequest`, forwarded by both MCP dispatchers), 34b.3 (Grok/Antigravity effort routing). 34b.2 (`rpc-chat.types.ts`): decided not to add it (see D22 decision below). The rest of the end-to-end forwarding is in **34c**.

File cap: 6 of 6 used (4 runtime/type files, 2 specs).

## Changed files

- MODIFIED `libs/shared/src/lib/types/agent-process.types.ts:9-12` imports `ProviderAccountSelection` as a type. `:331-338` adds `readonly accountSelection?: ProviderAccountSelection` to `SpawnAgentRequest`, documented as omitted or ambient only while named admission is release-held (D7). This reuses the existing shared selection type and adds no new type.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1270-1272`: the HTTP `ptah_agent_spawn` handler forwards `spawnArgs.accountSelection` into `ptahAPI.agent.spawn`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:503-506`: the stdio `agent_spawn` handler forwards `p.accountSelection` into `ptahAPI.agent.spawn`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts:192-259` adds three tests:
  - ambient and omitted selections on a `claude` lane reach the spawn request, and HTTP and stdio send identical requests;
  - an absent selection stays `undefined` on both transports;
  - five refused cases fail on both transports and never call `agent.spawn`: named; named on resume; another CLI; an auto-detected lane; a Ptah CLI agent.
- MODIFIED `libs/backend/platform-core/src/file-settings-keys.ts:116-118` adds `agentOrchestration.grokReasoningEffort` and `agentOrchestration.antigravityReasoningEffort` to `FILE_BASED_SETTINGS_KEYS`. `:337-338` gives each a `''` default (CLI default), the same as `piReasoningEffort`.
- MODIFIED `libs/backend/platform-core/src/file-settings-keys.spec.ts:361-372`: both keys are file-based and default to `''`.

## Forwarding trace

| Step | Location | State after 34b |
| --- | --- | --- |
| Entry, HTTP MCP | `protocol-dispatcher.ts:1192` `ptah_agent_spawn` | parsed by `AgentSpawnArgsSchema` |
| Entry, stdio MCP | `agent-tool.dispatcher.ts:432` `handleSpawn` | parsed by `AgentSpawnArgsSchema` (`parseArgs`) |
| Validation | `mcp-core/agent-spawn-args.schema.ts:41-56,110-124` `agentSpawnAccountRefusal` (strict `ProviderAccountSelectionSchema`) | Rejects a selection on anything but `cli: 'claude'`, a named selection, and a named selection on resume, before any limit lookup or spawn. Unchanged. |
| Dispatcher → `ptahAPI.agent.spawn(SpawnAgentRequest)` | `protocol-dispatcher.ts:1272`, `agent-tool.dispatcher.ts:506` | **forwarded** (new) |
| Namespace hop → `agentProcessManager.spawn(SpawnAgentRequest)` | `namespace-builders/agent-namespace.builder.ts:189-210` re-checks with the same reader and refusal; `:457-463` still **strips** it (`_checkedAccountSelection`) | **34c** |
| Entry, RPC `agent:resumeCliSession` | `rpc-handlers/.../agent-rpc.handlers.ts:1378-1389` validates (`resumeAccountRefusal`); `:1409-1417` builds the `SpawnAgentRequest` without it | **34c** |
| Adapter | `cli-agent-runtime/.../agent-process-manager.service.ts:374` `spawn(request)` | Never reads the field. Ambient or omitted is today's route, so no adapter consumer is needed until named admission is released (D7). |

No admission path is added. Every value that can reach `agent.spawn` has already passed `agentSpawnAccountRefusal`, so it is `omitted` or `ambient` on a `claude` lane. The namespace builder applies the same refusal again. Nothing reads the field after the dispatcher, so ambient and absent behave exactly as before; only the request object carries one more key.

## D22 decision: `rpc-chat.types.ts` accountSelection not added

- **Decision**: do not add it in 34b.
- **Options**:
  - (a) add the field to `rpc-chat.types.ts` only;
  - (b) add the full chat contract: `rpc-chat.types.ts`, the `chat-rpc.schema.ts:64,82,96` validation, the chat start/resume handler, and the frontend refusal display;
  - (c) defer.
- **Evidence**:
  - D22 (decisions.md:148) defers the chat accountSelection to "the Accounts UI / RPC contract batches", together with a safe `accountRefusal`, the `chat-rpc.schema.ts` lines and the frontend refusal display. It does not say the chat RPC must carry a selection in this phase.
  - D31 (decisions.md:222) moved it to Batch 34 because of the file cap. That is a scheduling change, not a requirement for this phase.
  - Option (a) would add a field that nothing validates or consumes. The repository's boundary rules forbid that (Zod parse at the boundary).
  - Option (b) needs at least 4 more files across shared, rpc-handlers and frontend. The frontend is being edited by another agent right now.
  - The 6-file cap was already used by the spawn forwarding and the effort fix.
- **Reversible**: yes, the change is purely additive when it lands.
- **Recommended owner**: a separate batch for the whole chat contract (b), not split across batches.

## Effort-key result

Both keys were **unrouted**, and both are now fixed:

- `agentOrchestration.grokReasoningEffort` and `agentOrchestration.antigravityReasoningEffort` were already written by `agent:setConfig` (`agent-rpc.handlers.ts:859-868`).
- They were already read by `agent:getConfig` (`:527-532`) and by the lane spawn environment (`cli-agent-runtime/.../agent-spawn-environment.service.ts:113-114`).
- They were missing from `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`, unlike the codex, copilot, pi and claude effort keys.
- They are now routed with `''` defaults.

**Remaining gap (34c)**:
- Problem: `SCOPED_SETTING_KEYS` has no entries for the two effort keys, although it has entries for `piReasoningEffort` (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts:453`) and for the grok and antigravity model keys (`:461,465`).
- Effect: the config-scope RPC view (`config-scope-rpc.handlers.ts:38`) does not list them.
- Fix: add two global-only entries.

## Specs

- Extended `agent-spawn-surface-parity.spec.ts`: both MCP dispatchers forward the selection, and all refusals happen before spawn.
- Extended `file-settings-keys.spec.ts`: covers the effort routing.
- Not run (the orchestrator runs the checks). Suggested scoped commands:
  - `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts --coverage=false --maxWorkers=2`
  - `npx jest -c libs/backend/platform-core/jest.config.ts libs/backend/platform-core/src/file-settings-keys.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck` for `shared`, `vscode-lm-tools` and `platform-core`, plus the host dependents (`ptah-electron` first, then `ptah-extension-vscode` and `ptah-cli`), with `--parallel=1`.

## Existing specs that mock the changed members

The `SpawnAgentRequest` change is additive and optional. The `agent.spawn` call objects gain only `accountSelection: undefined` when the caller sends no selection. Every assertion found uses `toEqual`, `toHaveBeenCalledWith` or field reads; `toStrictEqual` does not appear in these specs. No break is expected:

- `vscode-lm-tools/.../mcp-core/protocol-dispatcher.spec.ts` (3 `agent.spawn` mocks)
- `vscode-lm-tools/.../mcp-stdio/agent-tool.dispatcher.spec.ts` (1)
- `vscode-lm-tools/.../mcp-stdio/stdio-mcp-server.service.spec.ts` (1)
- `vscode-lm-tools/.../mcp-core/agent-spawn-limits.transport.spec.ts` (3)
- `vscode-lm-tools/.../mcp-core/agent-spawn-surface-parity.spec.ts`: its existing test "forwards the same SpawnAgentRequest from HTTP and stdio" still holds, because both sides carry `undefined`.
- `vscode-lm-tools/.../namespace-builders/agent-namespace.builder.spec.ts` (37 mocks). Its `:1609` asserts `not.toHaveProperty('accountSelection')` on the request the namespace forwards. That still passes in 34b because the builder still strips the field. **It must change in 34c** together with the builder.
- `cli-agent-runtime/.../agent-process-manager.guard.spec.ts:344` builds a `SpawnAgentRequest` literal. The new field is optional, so it still compiles.

## Remaining 34c files (exact)

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
   - Change `assertAccountSelection` (`:189`) so it returns the checked selection.
   - Forward the checked selection in the system-CLI branch (`:457-473`) instead of destructuring it away, and update the comment at `:449-456`, which says `SpawnAgentRequest` does not declare the field.
   - The Ptah CLI branch never receives a selection, because the refusal blocks it.
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
   - Replace the `:1609` "not forwarded" assertion with "forwarded as-is" for ambient and omitted.
   - Keep the named and invalid refusal tests.
3. `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1409-1417`
   - Pass `accountSelection: parsed.data.accountSelection` into `agentProcessManager.spawn` only when `parsed.data.cli === 'claude'`.
   - At that point `resumeAccountRefusal` has returned `inherit`, so the forwarded value matches the stored binding, and the runtime's resume gate stays authoritative and fail-closed (D7).
4. The agent-rpc resume spec (the spec covering `agent:resumeCliSession` account refusal, Batch 28a) needs one forwarding assertion.
5. `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`: add global-only `SCOPED_SETTING_KEYS` entries for the grok and antigravity effort keys (see the effort-key gap above).

## Diagnostics

`ptah_get_diagnostics` was called twice on exactly the 6 changed files. Both calls returned "Unavailable: TypeScript check still running after 45s" for all 6 files. **No diagnostics evidence**; the orchestrator's scoped typecheck must confirm the change.

By reading the code:
- The `ProviderAccountSelection` import resolves (`provider-account.types.ts:217`).
- `PtahAPI['agent']['spawn']` takes `SpawnAgentRequest` (`code-execution/types.ts:320`).
- `AgentSpawnArgsSchema`'s parsed `accountSelection` is `ProviderAccountSelection | undefined`, which matches the new field.
- In the namespace builder, the intersection `SpawnAgentRequest & { accountSelection?: unknown }` narrows to `ProviderAccountSelection`, which is still a valid argument to `readProviderAccountSelectionField(unknown)`.

## Decisions

- **Spread across 6 files.** The batch covers both dispatchers with one parity spec, plus the effort fix with its spec. The namespace builder and its spec (1-2) and the RPC resume (3-4) are deferred to 34c, because the namespace spec pins the stripping and has to change together with the builder.
  - Why: the effort fix changes real Electron behaviour (settings that were being dropped), while ambient forwarding changes no runtime behaviour.
  - Reversible: yes.
- **MCP tool descriptions unchanged.** No `mcp-contract.sweep.spec.ts` budget is affected.

## Out-of-scope observations

- `namespace-builders/agent-namespace.builder.ts:454-456`: this comment is stale now that `SpawnAgentRequest` declares the field. It is fixed in 34c item 1.
