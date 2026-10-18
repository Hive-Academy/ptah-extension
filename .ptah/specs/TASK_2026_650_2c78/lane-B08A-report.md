# B08 part A

## Delivered

| File | Purpose | Lines |
| --- | --- | ---: |
| `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts` | Bound guidance state and committed actions | 285 |
| `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.spec.ts` | Run, recovery, and action coverage | 155 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` | Bound start model and bound regeneration RPC | 648 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts` | Bound payload and tabless compatibility coverage | 439 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-run-card.component.ts` | Presentational run state and Stop/Retry controls | 107 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-run-card.component.spec.ts` | Stop, retry, and unknown-state coverage | 39 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.ts` | Committed metadata and actions | 90 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.spec.ts` | Result action coverage | 35 |

## Acceptance

| Requirement | Status and evidence |
| --- | --- |
| Standalone start without analysis | Met: store `start()` at `guidance-generation.store.ts:93`, spec `guidance-generation.store.spec.ts:63`; RPC bound payload at `wizard-rpc.service.ts:143` contains no analysis data. |
| Latest-only source label; no analysis directory exposed | Met: source conversion at `guidance-generation.store.ts:36`, snapshot at `:125`; spec `guidance-generation.store.spec.ts:63`. |
| Accepted provider/model snapshot; hide unknown | Met: `guidance-generation.store.ts:125`, `guidance-run-card.component.ts:21`; spec `guidance-run-card.component.spec.ts:24`. |
| Guidance tab model at start | Met for initial start: `wizard-rpc.service.ts:143`, spec `wizard-rpc.service.spec.ts:63`. Partial for regeneration: host regeneration schema has no model field; see Deviations. |
| Trace-write failure is not success | Met: committed-state gate `guidance-generation.store.ts:187`, spec `guidance-generation.store.spec.ts:85`. |
| Exact Stop before commit, lost response reread | Met: `guidance-generation.store.ts:139,150,196`, spec `guidance-generation.store.spec.ts:110`; run card disables Stop while cancelling at `guidance-run-card.component.ts:70`. |
| Lost start response and own-tab lookup | Met: `guidance-generation.store.ts:103,150,163`, spec `guidance-generation.store.spec.ts:124`. |
| Reload committed result with neutral status unless cancellation verified | Met: `guidance-generation.store.ts:63,187,217`, spec `guidance-generation.store.spec.ts:93`. |
| Retry, regenerate, enabled, cache, content, download | Met: store `guidance-generation.store.ts:96,99,217,240,251,264`; panel outputs `guidance-result-panel.component.ts:81`; store action spec `guidance-generation.store.spec.ts:136`, panel spec `guidance-result-panel.component.spec.ts:5`. |
| Skip preserves agent outcome | Met at part A boundary: output only, `guidance-result-panel.component.ts:75`; spec `guidance-result-panel.component.spec.ts:5`. B08B owns shell binding. |
| Tabless legacy calls unchanged | Met: new bound method at `wizard-rpc.service.ts:164`; tabless payload assertion `wizard-rpc.service.spec.ts:63`. |

## Checks

- `npx jest -c libs/frontend/setup-wizard/jest.config.ts guidance-generation.store.spec.ts guidance-run-card.component.spec.ts guidance-result-panel.component.spec.ts wizard-rpc.service.spec.ts --coverage=false --maxWorkers=2`: 4 suites, 37 tests passed.
- `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`: passed after removing unsupported regeneration model field.
- `npx nx test "@ptah-extension/setup-wizard" --parallel=1 -- --maxWorkers=2`: 34 suites, 411 tests passed.
- `ptah_get_diagnostics` after final component edit: no diagnostics in requested file; sibling diagnostics were reported in unrelated files.
- `npx prettier --write` ran on all eight changed source/spec files.

## Notes for B08B

`GuidanceGenerationStore` is root injectable. Call `bind({ tabId, workspacePath, workflow: 'setup-project-prompt' })` when the guidance tab is active, and `unbind()` on exit. Read signals `binding`, `run`, `status`, `snapshot`, `result`, `content`, `source`, `actionFailed`. Invoke `start()`, `stop()`, `refresh()`, `retry()`, `regenerate()`, `setEnabled(boolean)`, `refreshCommitted()`, `loadContent()`, `download()`.

`GuidanceRunCardComponent` selector `ptah-guidance-run-card`: inputs `[status]` required and `[snapshot]` optional; outputs `(stopRequested)`, `(retryRequested)`, `(refreshRequested)`. `GuidanceResultPanelComponent` selector `ptah-guidance-result-panel`: input `[result]`; outputs `(enabledChanged)`, `(cacheRequested)`, `(contentRequested)`, `(downloadRequested)`, `(regenerateRequested)`, `(skipRequested)`. Bind cacheRequested to store.refreshCommitted(). The panel emits Skip only; shell must preserve agent outcome. The store does not display loaded content; B08B should provide a safe text view if desired.

The host currently strips a model supplied to `enhancedPrompts:regenerate`. To honor tab model on regeneration, shared `EnhancedPromptsRegenerateParams`, its Zod schema, and the bound handler must accept and pass the model. These files are outside part A ownership.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use host run state plus saved status as separate sources | Stream closure or host reads | `SetupGenerationRunState` has committedState; `getStatus` has saved metadata | Yes |
| Render a derived source label | Raw source or derived label | Source type includes private `analysisDir`; design prohibits rendering it | Yes |
| Keep tabless RPC methods intact | Reuse legacy regeneration or add bound call | Settings and CLI depend on tabless payload; bound handler accepts tabBinding | Yes |
| Restore neutral status for non-cancelled terminal runs | Show previous terminal or neutral | B08 acceptance requires neutral after reload unless cancellation verified | Yes |

## Deviations

- Regeneration cannot carry the guidance tab model through the current shared/host RPC contract. The bound regeneration call uses the existing contract. This needs work outside this lane's ownership.
- The scoped diagnostics tool reported existing sibling-file errors, while the requested component had none and the required Nx typecheck passed.

## Proposed Removals

None.
