# PR 763 Lane C report

## Part 1 — CodeRabbit 4308395721

**Valid.** `TabWorkspacePartitionService` says the VS Code panel never activates a workspace partition (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:23-27`) and returns partition map tabs for a non-null requested path (`:240-244`). The launcher previously required equality with `activeWorkspacePath` before creation and after navigation; the handler required the same equality, the widget used the null path as failure, and `createWorkflowTabForWorkspace` required a background anchor when the active path was null.

The shared predicate in `libs/frontend/chat-state/src/lib/active-workspace-tab-set.ts:2` accepts a null partition only for a VS Code host with a nonempty matching configured root. It normalizes Windows slashes, trailing slashes and drive path case using the existing workspace-root convention. The public export is `libs/frontend/chat-state/src/index.ts:21`.

| Caller | Fix |
| --- | --- |
| Launcher | `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts:53,89,98` applies the predicate before creation and after navigation. |
| Host push handler | `libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.ts:26` accepts the matching VS Code root. |
| Status widget | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts:263-270` uses the configured root when the partition is null and applies the predicate. |
| Tab manager | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:889,1033-1045` reads the active tabs for the matching root and uses normal tab creation with activation for the null partition. Non-null partition behavior keeps its previous focus setting. |

Focused specs: `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts:78` covers VS Code creation, activation, duplicate prevention and the Electron null-state rejection; the existing non-null active and background tests cover Electron behavior. `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.spec.ts:103,115` covers matching and mismatched roots. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.spec.ts:127` covers the widget. `libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.spec.ts:81` covers the push handler.

Focused Jest results: chat-state 64/64 passed; chat-ui 15/15 passed; setup-wizard 3/3 passed. All ran with `--coverage=false --maxWorkers=1`.

## Part 2 — Electron e2e spec

`apps/ptah-electron-e2e/src/specs/setup-wizard/wizard-dom.spec.ts:16-18,32-34` now checks that `ptah-wizard-landing` is visible and opens the “Analysis and recovery options” summary before asserting `ptah-welcome`. The second test retains the next-button click and scan assertion. The markup is present in `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts:116-122`; the spec uses the existing `ui` fixture from `apps/ptah-electron-e2e/src/support/fixtures.ts`. E2e was not run, as instructed.

## Decisions

- **Helper location:** chat-state, exported from its public index. Options were chat-state or chat-ui; the tab manager is in chat-state and cannot depend on the feature-level chat-ui library under Nx's data-access boundary (`libs/frontend/chat-state/src/index.ts:1-9`). Reversible.
- **Host guard:** require `isVSCode` as well as a matching configured root for null partitions. This prevents Electron startup with a null partition from being treated as the VS Code tab set. Reversible.
- **Existing partition behavior:** preserve exact non-null path comparison and background tab creation, because Electron workspace switching uses partitioned paths. Reversible.

## Not done

- No e2e run or Nx target, per the strict verification constraint.
- `ptah_get_diagnostics` was called after edits but timed out with TypeScript coverage unavailable; the orchestrator's serial typecheck remains the type gate.
