# Batch 1A — shared readiness

## Files changed

- Added `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts` and `.spec.ts`.
- Reworked `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts` and `.spec.ts`.
- Changed exports in `libs/frontend/chat-ui/src/index.ts` and `libs/frontend/chat/src/lib/components/index.ts`.
- Deleted `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts` and `.spec.ts`.

## Store public API

`SetupStatusStore` is root scoped and exported from `@ptah-extension/chat-ui`. Signals: `status`, `isLoading`, `error`, `workspaceNotOpen`, `launchError`, `launching`, `skillsReady`, `agentsReady`, `readyCount`, `allReady`. `skillsReady` and `agentsReady` are `boolean | null`; `readyCount` is `number | null` (null while either signal is unknown). Methods: `refresh()`, `retry()`, `openFolder()`, `launchWizard()`, `launchGeneration(workflow)`. The status snapshot is stamped with `WorkspaceScopeService.scopeKey()` and old RPC responses are ignored on workspace switches.

## Preserve-list check

- Skills action opens Marketplace skills source through `AppStateManager`; loading/error does not claim readiness.
- Agent status uses the existing 10-second RPC, including configured status, count, no-workspace and retry. Confirmed configured status counts ready; the action reads Update.
- Configure and Project scan Run setup share the existing 5-second wizard RPC. Project scan contributes no count.
- Open Folder uses the existing command RPC. Generate agents and Project guidance use `GenerationWorkflowLauncherService.open` with active-workspace validation and `independent-start`, and show safe failure copy.
- Both ready signals collapse the card to a Ready strip with Run setup, Generate agents and Project guidance. The expanded card and strip use `surface-3`; narrow CSS stacks actions.
- Search found no widget consumer beyond the removed card, old spec, and two exports. A stale reference to the old source remains only in a comment in `skeleton-block.component.ts`, which is outside batch ownership.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the existing `WorkspaceScopeService.scopeKey()` for status invalidation | Local path comparison, workspace scope key | `PluginCatalogService` uses the same scope mechanism and the approved plan requires workspace-keyed state | Yes |
| Keep backend error details out of the card | Render RPC error, safe fixed copy | Project coding rules prohibit raw errors/secrets; old widget exposed backend text | Yes |

## Verification and remaining work

No Nx, Jest, TSC or other heavy command was run, per lane instruction. Scoped `ptah_get_diagnostics` was requested after edits but its first result was unavailable because its TypeScript check was still running after 45 seconds. Orchestrator should run chat-ui/chat checks and the template alpha-class check. Batch 1B owns Aurora and the single-chat empty-state changes.
