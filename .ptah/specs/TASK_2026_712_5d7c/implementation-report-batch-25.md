# Backend implementation — `TASK_2026_712_5d7c`, batch 25

Executor: backend-developer subagent, Anthropic family (Claude Opus 5.5). Not a CLI lane.
Worktree: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`. No git mutation.

**Tasks completed**: 25.1 (Shared account RPC and configuration contracts). The registry merge was
deferred to Batch 27 with coordinator approval (see Decisions).

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`
  is the zod-free contract file. It contains:
  - `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`: the 10 `provider:*Account*` names, `satisfies` the registry keys.
  - `ProviderAccountRpcMethodRegistry`: the registry slice. `ProviderAccountRpcRegistryInSync` is a type-level check that the slice matches the name list.
  - Params and results for each method.
  - `ProviderAccountsSnapshot` and `ProviderAccountsChangedNotification`.
  - The `ProviderAccountRpcResult<T>` ok/refusal union.
  - `ProviderAccountSelectionWrite` (`ambient`, or `named` + `expectedProfileRevision`).
  - `PROVIDER_ACCOUNT_ABSENT_SELECTION_REVISION` (-1).
  - It reuses `ProviderAccountProvider/Scope/Selection/Summary/ActionResult` from `provider-account.types.ts` and duplicates none of them.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc.types.ts` adds a single re-export line for the new file. `RpcMethodRegistry` and `RPC_METHOD_ENTRIES` are NOT extended (D below).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`:
  - Adds optional `claudeModel` and `claudeReasoningEffort` to `AgentOrchestrationConfig` (absent = not reported, never a guessed default) and to `AgentSetConfigParams`.
  - Adds `CLAUDE_REASONING_EFFORT_VALUES` (`''`, `inherit` + the SDK `EffortLevel` scale, `satisfies`-checked), `ClaudeReasoningEffortSetting` and `isClaudeReasoningEffortSetting`.
  - Adds `AgentResumeAccountSelectionDecision` and `classifyAgentResumeAccountSelection(supplied: ProviderAccountSelectionField, stored: ProviderAccountBindingPresence)`. It returns `inherit` / `conflict` / `invalid`. A supplied account that differs from the stored route is `conflict`. An unreadable stored binding or malformed input is `invalid`. It never falls back to another route.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc/rpc-auth.types.ts` adds `agentOrchestration.claudeModel` and `agentOrchestration.claudeReasoningEffort` to `SCOPED_SETTING_KEYS`. Both are global-only, like the other per-CLI keys.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts` checks:
  - Method names: unique, `provider:` prefix, the exact design action set, no collision with `RPC_METHOD_NAMES`, no match against the host-source pattern.
  - Authority: no forbidden authority key on any params type (type-level). Sample params for every method use only public keys at runtime. `requestId` is present on every write. A notification survives a JSON roundtrip unchanged.
  - Resume: the full inherit/conflict/invalid matrix, using the real `readProviderAccountSelectionField`.
  - Claude effort: exact allowed set; unsupported values (`minimal`, `off`, `none`, `HIGH`, `' high'`, `ultra`) are rejected.
  - Config: setConfig params roundtrip to the reported config. The scoped keys are global-only.
- NOT MODIFIED `libs/shared/src/index.ts`: `rpc.types.ts` is already `export *`'d from the barrel, so the new contracts are public with no extra line. An explicit re-export would only duplicate it.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D-25a: Do not merge the account slice into `RpcMethodRegistry` in this batch. | (a) merge now and break manifest totality; (b) add `manifest.ts` as a 7th file; (c) ship a typed slice and let Batch 27 merge it together with its manifest owner. Chose (c). The coordinator approved it. | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:529-555` (`assertManifestInvariants` throws when a method has no owner). It runs from `manifest.spec.ts:24` and at dev boot from `registerRpcSurface`. | Yes |
| D-25b: The shared contract file has no zod. Wire zod schemas go in Batch 27 `provider-account-rpc.schema.ts`. | Zod in the shared main barrel vs the existing rpc-handlers schema pattern. | `libs/shared/src/schemas.ts:1-18` (the main barrel stays zod-free). Precedent: `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.ts`. | Yes |
| D-25c: Account selection on spawn uses the existing `ProviderAccountSelection` sentinel. Provider comes from `cli` and scope is `lane`. No new spawn field in shared. | Add a field to `SpawnAgentRequest` here vs leave it to its owners. | `SpawnAgentRequest` is in `agent-process.types.ts` (Batch 26). The MCP and agent RPC schemas belong to Batch 28. | Yes |
| D-25d: Methods take `workspaceRoot` as the workspace identifier. The backend must check that it is an open workspace. | Server-implied workspace vs an explicit identifier. | The plan (lines 235 and 267) says the UI supplies workspace identifiers. The `ProviderAccountService.select/setDefault(workspaceRoot, …)` signatures already take it. | Yes |

## What Batch 27 consumes

- **Registry merge:** `ProviderAccountRpcMethodRegistry` (merge into `RpcMethodRegistry` with `extends` and add the 10 `RPC_METHOD_ENTRIES` lines in `rpc.types.ts`, in the same change as `manifest.ts`). Batch 27 needs a bounded ownership adjustment to edit `rpc.types.ts`.
- **Manifest:** `PROVIDER_ACCOUNT_RPC_METHOD_NAMES` gives the manifest entry's `methods`.
- **Handlers and schema:** all `Provider*Account*Params` / `*Result` types, `ProviderAccountSelectionWrite`, `ProviderAccountsSnapshot`, `ProviderAccountScopeSelection`, `ProviderAccountRpcResult`, `ProviderAccountCommittedWrite`, `ProviderAccountOperation` and `PROVIDER_ACCOUNT_ABSENT_SELECTION_REVISION`. Batch 29 also uses the last one.
- **Broadcast:** `ProviderAccountsChangedNotification`, also read by Batch 29.
- **Spec only:** `ProviderAccountRpcRegistryInSync`, the compile-time drift check.

Batch 28 consumes `classifyAgentResumeAccountSelection`, `CLAUDE_REASONING_EFFORT_VALUES` / `isClaudeReasoningEffortSetting`, and the new `claudeModel` / `claudeReasoningEffort` fields. It needs them for the `agent-rpc.handlers.ts` setConfig allowlist and getConfig mapping, and for spawn/resume validation.

## Stack observed

- Shared lib: TypeScript with plain types and const tuples in `*.types.ts`. Zod lives only in `*.schemas.ts`, exported through `@ptah-extension/shared/schemas` (`libs/shared/src/schemas.ts`).
- Registry: `RpcMethodRegistry` plus `RPC_METHOD_ENTRIES: Record<RpcMethodName, true>` (`rpc.types.ts:780`, `:3058+`). Its total partition is enforced by `RPC_HANDLER_MANIFEST`.
- Agent setConfig validation: `.passthrough()` zod in `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts:21-25`, plus value allowlists in `agent-rpc.handlers.ts:101-124`.

## Verification

- `ptah_get_diagnostics` (typescript-compiler) on all 5 changed or created source/spec files: 0 errors, 0 warnings, coverage clean.
- Not run, as instructed: nx, jest, tsc, lint and build. The orchestrator runs `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared') -Hosts $H`.

### Existing specs this change can affect (orchestrator must run)

- `libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts` (new)
- `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts`: names are not registered and avoid the host-source pattern, so no change is expected.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`, `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`, `libs/backend/rpc-handlers/src/lib/verify-and-report.spec.ts`: the registry is unchanged, so they should still pass. They become relevant again in Batch 27.
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`: same as above.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts`: reads `SCOPED_SETTING_KEYS`.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts` and `config-scope-rpc.handlers` specs: they use `AgentSetConfigParams` / `SCOPED_SETTING_KEYS`.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts`: the service iterates `SCOPED_SETTING_KEYS` (`providers-settings-state.service.ts:141`).
- `libs/shared/src/lib/types/provider-account-binding.spec.ts`: shares the selection and binding vocabulary.

## Acceptance

- Old callers unchanged: all additions are optional fields or new exports. No registry key was added or removed.
- Public account input carries only these keys: ID, sentinel, provider, scope, `workspaceRoot`, label, `requestId`/`operationId` and expected revisions. The spec rejects route, env, owner and binding keys at the type level and checks the keys at runtime.
- Resume with a conflicting account returns `conflict`, and a malformed or unreadable value returns `invalid`. The caller must refuse before spawn. The wiring is Batch 28's.
- Config roundtrip and unsupported values: an absent field means not reported. The allowed set is exact, and unsupported values return false.
- Caveat: until Batch 28 maps the keys in `agent-rpc.handlers.ts`, `agent:setConfig` with `claudeModel` passes through the passthrough schema and is ignored. The frontend must not send these fields before Batch 28.
- No account UI capability is implied: the contracts carry no capability flag. The methods are not registered on any host yet, and Electron-only gating is Batch 27's host profile.
- Named live launch stays fail-closed (D7). This batch adds no runtime code path.

## Plan deviations

- The registry merge moved to Batch 27 (D-25a, approved).
- `index.ts` was not modified because the barrel already reaches the new file.

## Follow-ups (out of this batch's six files)

1. Batch 27 needs a bounded ownership adjustment to edit `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc.types.ts`: `RpcMethodRegistry extends ProviderAccountRpcMethodRegistry` plus the 10 `RPC_METHOD_ENTRIES`. It must land atomically with `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`.
2. The push message type for `ProviderAccountsChangedNotification` must be registered in `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/messages/message-constants.ts`, for Batch 27/29. Check it against `host-source-registry.contract.spec.ts`, where the name must avoid the host-source pattern.
3. D22: `accountSelection` and a safe `accountRefusal` in `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`, plus `chat-rpc.schema.ts:64,82,96`. These are still deferred.
4. Writes to `agentOrchestration.claudeModel` / `agentOrchestration.claudeReasoningEffort` must be routed in `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/platform-core/src/file-settings-keys.ts` (`FILE_BASED_SETTINGS_KEYS` / defaults). Otherwise the write is dropped while the read serves the default, the same trap as the TASK_2026_597 N1 key. It is not owned by Batch 26 or 28 as listed, so it needs an ownership adjustment.

## Out-of-scope observations

- `rpc-agents.types.ts` already imports `zod` (`PtahCliReasoningEffortSchema`), which contradicts the zod-free main-barrel rule in `schemas.ts`. This batch adds no zod there. Left untouched.
- The `_AssertAllRpcMethodsListed` alias in `rpc.types.ts:3530` is never instantiated, so it does not actually enforce anything. The `Record<RpcMethodName, true>` on `RPC_METHOD_ENTRIES` is the real guard.
