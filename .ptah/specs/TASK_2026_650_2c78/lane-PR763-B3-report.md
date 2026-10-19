# PR 763 round 3 — setup-wizard bound-tab ownership

## Sites found and fixed

A targeted search of `libs/frontend/setup-wizard/src/lib` for `workspacePath ===`, `workspacePath !==`, and `findTabByIdAcrossWorkspaces` found six remaining comparisons against a located tab. Each now uses `findBoundGenerationTab`:

| Site | Effect in VS Code | Fix |
| --- | --- | --- |
| `services/generation-run-event-adapter.ts:229` | `finish` skipped finalization | Shared lookup returns the null-partition tab only when it belongs to the binding's active workspace set. |
| `services/generation-run-event-adapter.ts:253` | `correctFinalizedMessage` skipped transcript correction | Shared lookup supplies the owned tab's messages. |
| `services/generation-run-event-adapter.ts:346` | `isOwnedTerminalPush` failed its owned-message fallback | Shared lookup supplies the tab for the workflow check. |
| `services/generation-handoff.store.ts:103` | Landed guidance tab yielded `manual-recovery` | Shared lookup validates the landed tab. |
| `components/agent-selection-list.component.ts:366` | Blocked owner appeared outside the workspace | Shared lookup controls the open action. |
| `components/agent-selection-list.component.ts:376` | Blocked owner label became `Another tab` | Shared lookup supplies the owner title. |

`services/bound-generation-tab.ts:5-8` now accepts the tab ID and workspace path from either a full binding or a small pair, with an explicit tab-or-null return type. Exact non-null partition ownership remains unchanged; the null-partition fallback still requires `getWorkspaceTabs(workspacePath)` to contain the tab ID. The other `workspacePath` comparisons found by the search compare bindings or workspace state, not a located tab, and were left unchanged.

## Specs and verification

- `services/generation-run-event-adapter.spec.ts:276` verifies VS Code message finalization and correction; `:303` verifies its owned terminal push; `:315` verifies an Electron mismatched path cannot finalize.
- `services/generation-handoff.store.spec.ts:108` verifies a landed VS Code null-partition tab yields the normal `started` outcome and calls the guidance RPC.
- `components/agent-selection-list.component.spec.ts:211` verifies the VS Code owner title and open action.
- Focused Jest command: `npx jest -c libs/frontend/setup-wizard/jest.config.ts libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.spec.ts --coverage=false --maxWorkers=1`. Result: 3 suites passed; 32 tests passed.
- Scoped `ptah_get_diagnostics` was attempted for the seven changed TypeScript files. The compiler service reported it was still running after 45 seconds and returned no diagnostics.

## Decisions

- **Extend the existing helper** over duplicating its null-partition rule. Evidence: all six sites need identical tab ownership semantics, but handoff and owner-label sites have only `{ tabId, workspacePath }`. Reversible: yes.
- **Keep strict Electron ownership.** The fallback is available only when the located partition path is null and the workspace's active tab set contains the ID. The Electron mismatched-path spec verifies rejection. Reversible: yes.

## Not done

- TypeScript diagnostics were unavailable due to the scoped diagnostic service timeout. No Nx, build, serve, e2e, or wider test command was run.