# PR 763 round 2 — setup-wizard

## Validity

Valid. In the VS Code panel, `findTabByIdAcrossWorkspaces` reports a matching active tab with `workspacePath: null` (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:325-339`). The generation binding carries `/ws`, so the former strict comparison in `canStartInChat` (`libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:220-221`) rejected an idle bound tab. The three RPC start methods used the same comparison and lost its `overrideModel` (`libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:126,154,173`). `TabManagerService.getWorkspaceTabs` resolves the configured VS Code root to the active tab set (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:887-900`).

## Fix

- `libs/frontend/setup-wizard/src/lib/services/bound-generation-tab.ts:5-18`: shared lookup accepts exact workspace ownership, or null-partition ownership confirmed by `getWorkspaceTabs(binding.workspacePath)` and tab ID.
- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:221`: `canStartInChat` uses the shared lookup.
- `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:126,154,173`: agent start, guidance start, and guidance regeneration use the shared lookup to preserve the tab override model.

## Specs and verification

- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:451`: VS Code null-partition tab can start; `:487` rejects a mismatched Electron workspace even if the bound workspace lookup could return the ID.
- `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts:105`: all three bound starts pass the VS Code tab's `overrideModel`.
- Focused Jest: `npx jest -c libs/frontend/setup-wizard/jest.config.ts libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts --coverage=false --maxWorkers=1` — 2 suites passed, 52 tests passed.
- Scoped `ptah_get_diagnostics` was attempted after edits; the TypeScript compiler stayed unavailable after its 45-second timeout. No TypeScript diagnostic result was produced.

## Decisions

- **Shared setup-wizard helper** over four inline conditions or changing `TabManagerService`. Evidence: the same ownership rule is needed by four call sites, and `getWorkspaceTabs` already handles the VS Code active root. Reversible: yes.
- **Require null partition for fallback** over accepting any tab ID found in the binding workspace. Evidence: Electron partition ownership is non-null and must remain strict. Reversible: yes.

## Not done

- TypeScript diagnostics could not complete because the scoped diagnostic service timed out. No Nx, build, or wider test command was run.