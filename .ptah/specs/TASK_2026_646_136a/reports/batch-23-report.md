# Batch 23 (B5) report

Workspace: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`.

## Assumptions resolved before implementation

- **PB-4 pass.** The spawn path stamps `roleDefinition.name` into `roleStamp` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:621`), and `AgentProcessInfo.role` is that workspace role name (`libs/shared/src/lib/types/agent-process.types.ts:155`). The outcome mapping reads `info.role` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:36`).
- **PB-5 pass.** The deliverable check depended on `IFileSystemProvider`, paths and spawn time (`lane-completion-notifier.service.ts:113-134`). It is now a named export (`:113`), re-exported by the cli-agents barrel (`cli-agents/index.ts:55`); the notifier uses it (`lane-completion-notifier.service.ts:619`). `sessionChildVerdictOf` remains exported (`lane-completion-notifier.service.ts:177`).
- **IA-2 initially false for an undiscovered owner; resolved by a spawn provider field.** Ptah CLI registry constructs the lane from `agentConfig.providerId` (`ptah-cli/ptah-cli-registry.ts:894`) but `LaneOwnerResolver.ownerForLane` documents `ptah-cli` as ownerless until a run (`cli-agents/limits/lane-owner.resolver.ts:99-107`), so `quotaOwner?.providerId` alone cannot guarantee the routing row's provider. The registry now places the configured ID on the SDK handle (`ptah-cli/ptah-cli-registry.ts:963`); APM copies it at spawn (`agent-process-manager.service.ts:800`) into `AgentProcessInfo.providerId` (`libs/shared/src/lib/types/agent-process.types.ts:150`). The outcome uses it for both `provider` and `laneFamilyOf` (`lane-completion-outcome.ts:31-37`), falling back to a discovered quota owner for other lanes. The notifier spec covers a Ptah CLI without an owner (`lane-completion-notifier.service.spec.ts:166`).

## Implementation and success criteria

- **SC-4:** Fixed failure precedence is in `lib/limits/lane-failure-class.ts:15-29`; conservative auth wording is in `lib/limits/lane-auth-classifier.ts:2-15`. APM feeds auth classification the same bounded texts as quota classification on failed exits (`cli-agents/agent-process-manager.service.ts:2347-2350,2407-2437`), then passes it to the notifier (`:2551`). Precedence and wording table specs are in the corresponding `.spec.ts` files.
- **SC-5:** `laneFamilyOf` groups the recorded lane using the configured Ptah provider or quota owner (`cli-agents/lane-completion-outcome.ts:31-37`). The outcome also retains `laneId = ptahCliId ?? cli` (`:30`).
- **SC-6:** APM copies `taskKind` and `routingSource` from `SpawnAgentRequest` (`agent-process-manager.service.ts:641-642`) and from the SDK-handle spawn metadata (`:801-802`). The outcome maps their absent values to `null` and `not-routed` (`lane-completion-outcome.ts:38,52`).
- **SC-10:** The notifier calls the synchronous recorder enqueue after its deduplicated signal is built and before parent checks (`lane-completion-notifier.service.ts:329-355`); the mapping calls `recordLaneCompletion` without awaiting persistence (`lane-completion-outcome.ts:12-29`). Lazy optional DI resolution checks `isRegistered` so later host wiring can provide the recorder (`di/register.ts:98-111`). Errors are logged and do not block signal delivery (`lane-completion-outcome.ts:61-66`). Signal specs cover a five-second write, an asynchronous throwing store, a synchronous throwing enqueue, and duplicate suppression (`lane-completion-notifier.service.spec.ts:145-230`).
- Existing notifier envelope rendering moved to `cli-agents/lane-completion-envelope.ts` so `lane-completion-notifier.service.ts` remains 687 lines after formatting. The old APM file already exceeded 700 lines before this batch.

## Files created or modified

All paths below are absolute under the workspace above.

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-failure-class.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-failure-class.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-auth-classifier.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-auth-classifier.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-outcome.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-envelope.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\tracked-agent.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\agent-process.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-23-report.md`

## Verification and risks

- `npx eslint <changed files>`: exit 0; tail: `agent-process-manager.service.ts:964:1 max-lines` and `:2078:37 no-empty-function`, 2 warnings, 0 errors. Both warnings were in the pre-existing large APM file. This ran before the final IA-2 field additions.
- `npx prettier --check <changed files>`: exit 0; tail: `All matched files use Prettier code style!`. Final IA-2 edits were formatted with Prettier's write mode but the check was not repeated (one-check limit).
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`: exit 0; tail: `degradation-audit: TOTAL 296 unsuppressed site(s)`; no FAIL. This ran before final IA-2 edits.
- `npx ts-node --transpile-only tools/di-lint/check-injects.ts`: exit 0; tail: `di-lint OK: 1842 @inject sites all resolve to a registered token (813 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`. This ran before final IA-2 edits.
- Nx, Jest and typecheck were not run, per decision #53. No new service token was registered; the existing notifier class registration changed to a factory with lazy optional recorder lookup, so no new DI guard surface was added. Host wiring remains in AB14. No package.json was changed. The optional recorder path and store failures are isolated from parent delivery. The team leader should run the changed-project checks on the final edits.
