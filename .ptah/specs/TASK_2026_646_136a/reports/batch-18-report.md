# Batch 18 (A11) — Decision-model config RPC

Task 18.1 is implemented. `agent:getConfig` and `agent:setConfig` carry the decision-model fields. No new RPC method was added. The handler delegates to `DecisionModelConfig` through `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG`.

Nx and Jest were not run (decision #53). The team-leader runs `J(libs/backend/rpc-handlers, agent-rpc.handlers.decision-model.spec.ts)`, then `npx nx typecheck @ptah-extension/shared`, then `npx nx typecheck @ptah-extension/rpc-handlers`.

## Files

W = `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`

- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.decision-model.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.spec.ts` (constructor argument only, so the extra dependency still constructs)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.set-config.spec.ts` (same)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.list-rows.spec.ts` (same)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.migration.spec.ts` (same)
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.resume-parent-session.spec.ts` (same)

Not modified: `package.json` (decision #79), `batches.md`, `task.md`, host guard specs, `register-shared-rpc-handlers.ts`, lane-routing sources.

## Task 18.1 evidence

DTO (plain mirrors of the lane-routing schema; the frontend cannot import that lib):

- `DecisionModelSelectionDto` and `DecisionModelSelectionInputDto`: `rpc-agents.types.ts:110-132`. Jev `model` is required on the get row (the service applies `jev-1.13.0`) and optional on the set input.
- `DecisionModelStateDto` is `unset | ready | no-credential | unreachable | unsupported-endpoint`: `rpc-agents.types.ts:141-142`. No `model-unavailable` (decision #46).
- `DecisionModelStatusDto` (`selection`, `locality`, `reportsConfidence`, `state`, `detail`): `rpc-agents.types.ts:145-153`.
- `AgentOrchestrationConfig.decisionModel`: `rpc-agents.types.ts:227`. The Jev key is not a field of this object.
- `AgentSetConfigParams.decisionModel` and write-only `decisionModelJevApiKey`: `rpc-agents.types.ts:348-354`.

RPC map is unchanged. `agent:getConfig` / `agent:setConfig` stay the existing methods: `libs/shared/src/lib/types/rpc.types.ts:1281-1288`. Handler method list is unchanged: `agent-rpc.handlers.ts:283-285`.

Delegation:

- Inject: `agent-rpc.handlers.ts:323-328`, token `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG`, imported from `@ptah-extension/lane-routing` (`agent-rpc.handlers.ts:50-53`).
- Get: `agent-rpc.handlers.ts:462` assigns `await this.decisionModelConfig.getStatus()`. No probe or state mapping in the handler.
- Set: after the existing validation block, `setSelection` then `setJevApiKey` (`agent-rpc.handlers.ts:564-573`), before the other writes, so a thrown invalid selection does not persist sibling fields. A non-string Jev key is refused first (`agent-rpc.handlers.ts:519-527`), the same credential-boundary check `cursorApiKey` uses, so a non-string never reaches secret storage. The handler does not trim, log, or echo the key. `setConfig` still logs field names only (`agent-rpc.handlers.ts:508-511`).

Registration that di-lint sees (Batch 21, not edited here): `libs/backend/lane-routing/src/lib/di/register.ts:83-96` `container.register(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG, { useFactory })`.

Spec (`agent-rpc.handlers.decision-model.spec.ts`):

- No new method, and the state union is exactly the five names above: `:198-210` (`STATE_SET_IS_UNCHANGED` at `:65`).
- `ready` with detail `last call failed: http 404`: `:212-219`.
- `unsupported-endpoint` with detail `Ollama 0.34.2 < 0.35.0`: `:221-227`.
- Each existing state, including its detail, is returned unchanged: `:229-246`.
- Selection is passed to `setSelection` and the handler does not call `workspace.setConfiguration` for it: `:249-260`.
- Jev key is passed through to `setJevApiKey` (whitespace preserved; the service trims) and is absent from `getConfig`, including the debug log: `:262-279`. Empty string is passed through so the service deletes: `:281-287`.
- Non-string key refuses before any delegation or other write: `:289-303`.
- Invalid selection (`setSelection` rejects) returns the generic save error, writes no sibling field, and does not log the selection message: `:305-323`. `SettingsPersistError` text is returned: `:325-335`.
- Omitting both fields does not call the service: `:337-348`.

## Assumptions

Batch 18 owns no row in the plan assumptions table (PA-1..PA-5, PB-1..PB-8, IA-1..IA-5). Nothing in that table was resolved here.

D5 (part-a `:951`, batches.md plan-validation note that A11 adds no new RPC method) holds. Evidence: `rpc.types.ts:1281-1288` and `agent-rpc.handlers.ts:283-285`. The new spec asserts the registered names equal `AgentRpcHandlers.METHODS` and that none contain `decision`.

## Setting keys and scope (Mode 3 write path)

The handler does not choose the keys. It calls the Batch 12 service, which writes them.

| RPC field | Call | Storage | Key | Scope |
| --- | --- | --- | --- | --- |
| `decisionModel` | `DecisionModelConfig.setSelection` (`decision-model.config.ts:155-168`) | `IWorkspaceProvider.setConfiguration` | section `ptah`, key `agentOrchestration.decisionModel` (`DECISION_MODEL_CONFIG_SECTION` / `DECISION_MODEL_CONFIG_KEY`, `decision-model.types.ts:98-99`) | Global. The key is not in `FILE_BASED_SETTINGS_KEYS` (no match in `file-settings-keys.ts`), so it does not go to `~/.ptah/settings.json`. VS Code writes `ConfigurationTarget.Global` (`vscode-workspace-provider.ts:113`). Electron and the CLI write `{globalStoragePath}/config.json` (`electron-workspace-provider.ts:69` and `:228-232`; `cli-workspace-provider.ts:63` and `:120-124`). |
| `decisionModelJevApiKey` | `DecisionModelConfig.setJevApiKey` (`decision-model.config.ts:189-196`) | `ISecretStorage` | `ptah.laneRouting.jevApiKey` (`DECISION_MODEL_JEV_SECRET_KEY`, `decision-model.types.ts:102`) | Secret storage (VS Code `SecretStorage` / the host secret store). Not a setting. Blank deletes (`:191-193`). Never returned by `agent:getConfig`. |

Part A `:743` says section `agentOrchestration`, key `decisionModel`. The service that shipped in Batch 12 uses section `ptah` and key `agentOrchestration.decisionModel`, and its spec asserts that call (`decision-model.config.spec.ts:572-575`). This batch follows the service.

A get is not a pure read. `getConfig` calls `getStatus` (`agent-rpc.handlers.ts:462`). For an Ollama selection that probe can persist the unsupported mark in global `IStateStorage` under `ptah.decisionModel.unsupported.v1` (`DECISION_MODEL_UNSUPPORTED_STORAGE_KEY`, `decision-model.types.ts:90-91`; `decision-model.config.ts:303`). Decision #46: an `unsupported-endpoint` re-check persists the mark; a `ready` re-check does not, and the row stays `ready` with the live error as `detail`. The handler does not write that mark itself.

## Risks

- Decision #73. The token is registered by Batch 21's factory (`register.ts:83`). `@inject` uses that same expression. `di-lint` accepts it (tail below). The rejected alternative (lazy `container.resolve` outside a composition root) was not used.
- Host boot, not papered over (rule 8). No host calls `registerLaneRoutingServices` (the only references are the definition, its spec, and `lane-routing/src/index.ts:139`). `registerRpcSurface` resolves `AgentRpcHandlers` and throws when a library-owned handler fails (`register-rpc-surface.ts:184-185`). That runs from `apps/ptah-extension-vscode/src/activation/bootstrap.ts:177`, `apps/ptah-electron/src/activation/wire-runtime.ts:328`, and the non-minimal CLI path `libs/backend/cli-engine/src/lib/container.ts:949` (singleton at `:942`). Full host boot fails until Batch 30 calls `registerLaneRoutingServices` before that resolve. Guard specs were not edited and the token was not registered a second time. `container.smoke` registers the handler lazily and does not resolve it, so those specs can stay green while boot does not.
- Decision #79. `@ptah-extension/lane-routing` was not added to `libs/backend/rpc-handlers/package.json`. The import uses the `tsconfig.base.json` path alias, the same way `register-shared-rpc-handlers.ts:24` already does. If `@nx/dependency-checks` complains, do not add the entry.
- Decision #46. The state set on the DTO is the existing five names. The spec fails to compile if that union changes. Detail text is passed through, including `ready` + `last call failed: …` and `unsupported-endpoint` + the version sentence.
- `max-lines`. `agent-rpc.handlers.ts` is already over the 700-line ceiling (eslint warning: 1201 code lines). This batch was required to modify that file. The addition is the inject plus the two delegations. Splitting the handler was not done.
- The new spec casts the pre-existing class constructor arguments with `as unknown as`, matching `agent-rpc.handlers.set-config.spec.ts`. The decision-model collaborator is a structural object, not a cast. Production code has no `any`, no `@ts-ignore`, and no `as unknown as`.

## Checks (executor)

Nx and Jest were not run.

`npx eslint` on the eight files above. Exit 0.

```
libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts
  847:1  warning  File has too many lines (1201). Maximum allowed is 700  max-lines

✖ 1 problem (0 errors, 1 warning)
```

`npx prettier --check` on the same eight files. Exit 0.

```
Checking formatting...
All matched files use Prettier code style!
```

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1` filtered to FAIL and TOTAL (PowerShell `Select-String`; `grep` is not on this shell). Exit 0. No FAIL line.

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

`npx ts-node --transpile-only tools/di-lint/check-injects.ts` (last line). Exit 0.

```
di-lint OK: 1843 @inject sites all resolve to a registered token (813 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
```

## Could not do

- `ptah_agent_report` is not on the connected MCP servers (only the `tasks` automation tools). The spawn summary is in the executor's final message.
- Jest on the new spec, and `nx typecheck` of `@ptah-extension/shared` and `@ptah-extension/rpc-handlers`, stay with the team-leader.
