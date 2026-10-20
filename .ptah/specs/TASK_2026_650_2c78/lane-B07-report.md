# B07 Agent selection, source and target preview

## Status

Implemented B07 components and preserved the existing wizard generation route. The new selection list is exported for B07B shell integration. Focused Jest, package Jest, typecheck, and lint passed.

## Files changed

Paths below are relative to `libs/frontend/setup-wizard/src/`; counts include blank lines.

| File | Lines |
| --- | ---: |
| `lib/components/wizard-landing.component.ts` | 290 |
| `lib/components/wizard-landing.component.spec.ts` | 108 |
| `lib/components/workflow-card.component.ts` | 48 |
| `lib/components/workflow-card.component.spec.ts` | 22 |
| `lib/components/generation-source-status.component.ts` | 61 |
| `lib/components/generation-source-status.component.spec.ts` | 29 |
| `lib/components/generation-model-picker.component.ts` | 64 |
| `lib/components/generation-model-picker.component.spec.ts` | 45 |
| `lib/components/agent-selection-list.component.ts` | 378 |
| `lib/components/agent-selection-list.component.spec.ts` | 201 |
| `lib/components/community-packs-panel.component.ts` | 162 |
| `lib/components/community-packs-panel.component.spec.ts` | 61 |
| `lib/components/agent-preview-dialog.component.ts` | 146 |
| `lib/components/agent-preview-dialog.component.spec.ts` | 36 |
| `lib/components/wizard-view.component.ts` | 199 |
| `lib/components/agent-selection.component.ts` | 1144 |
| `lib/components/agent-selection.component.spec.ts` | 708 |
| `index.ts` | 45 |

## Acceptance evidence

References use `lib/components/` unless stated otherwise.

| Acceptance point | File:line evidence | Spec |
| --- | --- | --- |
| Host verified analysis and workspace discovery have distinct labels; raw `analysisDir` is never rendered by the new status card. | `generation-source-status.component.ts:20-29,48` uses source kind/reason only. | `generation-source-status.component.spec.ts:5,19` |
| Static catalog works without analysis, preserving host IDs/categories and avoiding invented scores. | `agent-selection-list.component.ts:50-52,83-86,224-240` requests `workspace-catalog`. | `agent-selection-list.component.spec.ts:138` |
| Agent toggles, bulk selection, lazy packs, and individual/bulk install survive. | `agent-selection-list.component.ts:72-94,123,254-267`; `community-packs-panel.component.ts:43-80,107-152`. | `agent-selection-list.component.spec.ts:138`; `community-packs-panel.component.spec.ts:8`; legacy `agent-selection.component.spec.ts:263,285,292,630,646` |
| Preview distinguishes definite/conditional and overwrite targets; changed definite targets require renewed confirmation; bound preview runs immediately before submit. | `agent-preview-dialog.component.ts:41,62-67`; `agent-selection-list.component.ts:291-329,339-348`; legacy `agent-selection.component.ts:1038-1053`. | `agent-preview-dialog.component.spec.ts:5`; `agent-selection-list.component.spec.ts:152`; `agent-selection.component.spec.ts:506,536` |
| `preview-required` reopens preview; blocked rejection identifies owner and offers a same-workspace switch. | `agent-selection-list.component.ts:129-145,321-323,351-377`. | `agent-selection-list.component.spec.ts:165` |
| Chat busy reason is shown and submit is suppressed. | `agent-selection-list.component.ts:124-127,321-328`. | `agent-selection-list.component.spec.ts:181` |
| Workspace provider activation warns other tabs; global fallback is read-only on landing; tab picker is the model selector; unknown values are hidden. | `wizard-landing.component.ts:63-83,187-191,207-231`; `generation-model-picker.component.ts:36-40,50-62`. | `wizard-landing.component.spec.ts:15`; `generation-model-picker.component.spec.ts:8` |
| Saved analysis entry and old wizard path stay usable. | `wizard-landing.component.ts:129-159,251-282`; `wizard-view.component.ts:116-121`. | `wizard-landing.component.spec.ts:15`; existing wizard/selection specs in package run |
| Cancel copy makes no unwritten-files claim. | `agent-preview-dialog.component.ts:30-45`; `agent-selection.component.ts:1011-1021`. | `agent-preview-dialog.component.spec.ts:5`; `agent-selection.component.spec.ts:485` |

## Parity rows 4, 5, 9, 10, 13-16

| Row | Surviving location |
| --- | --- |
| 4 — wizard progress/navigation | `wizard-view.component.ts:116-121` retains prior route; `wizard-landing.component.ts:35-56` adds choices. |
| 5 — provider/model | `wizard-landing.component.ts:63-83,207-231` handles workspace provider; `generation-model-picker.component.ts:36-62` handles tab model. |
| 9 — use saved analysis | `wizard-landing.component.ts:132-151,266-280` loads it. |
| 10 — hide saved analysis | `wizard-landing.component.ts:152-159,282-289` hides a row without deleting files. |
| 13 — recommendations/catalog | `agent-selection-list.component.ts:208-245` reads recommendations or host catalog. |
| 14 — toggles | `agent-selection-list.component.ts:70-100,254-267` has individual/bulk choices. |
| 15 — community packs | `community-packs-panel.component.ts:43-80,107-152` loads lazily and installs. |
| 16 — preview certainty | `agent-preview-dialog.component.ts:41-80`; `agent-selection-list.component.ts:291-348`. |

## Checks

- Focused B07 Jest: 8 suites, 53 tests passed (`--coverage=false --maxWorkers=2`).
- Legacy selection regression after final copy change: 1 suite, 42 tests passed.
- `nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`: passed for both projects after final edits.
- `nx test "@ptah-extension/setup-wizard" --parallel=1 -- --maxWorkers=2`: 25 suites, 373 tests passed. Jest printed a worker force-exit warning after success.
- `ptah_get_diagnostics` after edits: no changed-file errors. Existing diagnostics remain in unowned `generation-run-event-adapter.spec.ts:110` and `capability-id-codec.ts:262-263`.

## Notes for B07B

- Import and place `AgentSelectionListComponent` in `generation-workflow-shell.component.ts`; pass the shell's `GenerationTabBinding` to required `[binding]`. B07 did not edit the B07B-owned shell. The list uses `GenerationWorkflowStore` for bound submit/rejections and host RPC for bound catalog/preview.
- `GenerationSourceStatusComponent` takes `[source]` (`GenerationContextSource`) and displays a derived label. Place it where the shell has the run source; it does not claim pre-run client data is verified.
- `GenerationModelPickerComponent` takes `[effectiveProvider]` and `[effectiveModel]`, and writes only the tab model override through `TabManagerService`.
- The old `AgentSelectionComponent` and wizard steps still own legacy analysis-based generation, preview, and packs. `WizardViewComponent` keeps prior Welcome controls in expandable “Analysis and recovery options”.
- B07B should keep shell terminal/cancel copy neutral when cancel races completion.

## Decisions

- **Selection surface:** A separate component for the generation shell follows the B07 file list/handoff; the legacy wizard remains accessible. Reversible by shell placement.
- **Catalog:** Request host `workspace-catalog` and use returned IDs/categories; backend contract supplies score 100. Reversible.
- **Provider scope:** Landing activates only workspace provider when workspace write scope exists; fallback is explanatory/read-only. D11 and provider API support this. Reversible.
- **Owner navigation:** Offer switch only when `ownerTabId` resolves in the current workspace, using workflow launcher. Reversible.

## Deviations

- Selection is exported but cannot appear in the workflow shell until B07B places it; shell is outside B07 ownership.
- Retained legacy Welcome has existing provider controls. Its scope behavior was untouched because `welcome.component.ts` is outside B07 ownership; D11 scope is enforced on the new landing.

## Proposed Removals

None.
