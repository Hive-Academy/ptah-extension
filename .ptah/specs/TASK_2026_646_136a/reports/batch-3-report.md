# Batch 3 report

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\subagent-budget-stop-callback-registry.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\subagent-budget-stop-callback-registry.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\subagent-run-tag.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\subagent-run-tag.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-cli\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-3-report.md`

## Task evidence

- **3.1:** Added a singleton callback registry and `Symbol.for` token (`agent-sdk/src/lib/di/register.ts:268-273`, `tokens.ts:145`). The monitor publishes the stopped `agentId`, parent session ID and timestamp only after a successful recorded stop (`subagent-budget-monitor.ts:997-1007`). The monitor spec checks one signal and no signal for a failed stop or a withdrawn record. The callback spec checks that a throwing listener does not prevent delivery to the next listener.
- **3.2:** Added the pure tag builder (`subagent-run-tag.ts:17`) and appended its output after any existing notice (`post-tool-use-hook-handler.ts:182-194`). The hook spec covers synchronous Agent, asynchronous Task, registry miss and lookup failure. The helper spec checks grammar, registry precedence, response fallback and invalid ID rejection.
- **DI guards:** Updated Electron and CLI `container.smoke.spec.ts` to resolve the new registration token after `registerSdkServices`. VS Code's listed smoke spec builds an RPC-only minimal container and does not call `registerSdkServices` (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:189-197`), so it has no matching registration assertion.

## Assumptions and decisions

- **PB-2 — true.** `SubagentBudgetMonitor.stop` obtains `registryRecord` by `toolCallId` (`subagent-budget-monitor.ts:895`); `SubagentRegistryService.get` returns that record (`vscode-core/src/services/subagent-registry.service.ts:379`), and the registration stores `agentId` (`:132`). Chosen: publish that ID after success. Reversible.
- **PB-6 — true.** `CallbackRegistryBase.register` catches each synchronous throw and asynchronous rejection per subscriber (`callback-registry.base.ts:23-39`); `notifyAll` emits through wrapped listeners (`:51-52`). Chosen: extend the base. Reversible.
- **IA-5 — partly verified, runtime capture pending.** The hook type carries `tool_use_id` (`agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:218`); the registry keys records by `toolCallId` (`vscode-core/src/services/subagent-registry.service.ts:57,127`) and the existing monitor already sends notices through the PostToolUse path (`agent-sdk/src/lib/di/register.ts:491-496`). Specs cover the sync, async and miss shapes. A live SDK capture comparing the tag with `SubagentStop received` (`subagent-hook-handler.ts:420`) was unavailable in this lane. Chosen fallback: `tool_response.agentId` on a registry miss, as specified. If the SDK does not fire PostToolUse for Agent/Task, a user-turn delivery change remains necessary. Reversible.

## Risks and verification

- A failed stop or withdrawn record cannot publish the signal because publication follows the successful stop and requires `prepared.record`. `stopFired` prevents a second notification. Listener failures are isolated by the callback base.
- Registry/response disagreement logs one warning and uses the registry ID. Invalid or absent IDs add no tag. Lookup exceptions are caught and leave the tool result unchanged. The tag carries only the validated ID.
- Per decision #53, no Nx, Jest, build, lint or typecheck command ran. Scoped `ptah_get_diagnostics` initially found two new spec logger typing errors; both were corrected. Two later scoped diagnostics calls returned unavailable after 45 seconds while the TypeScript service was still running, so a clean diagnostics result is **not** claimed. Team-leader verification remains necessary.
