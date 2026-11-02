# B3a L1 handoff

## Files changed

- `libs/frontend/setup-wizard/src/lib/services/generation-preview.store.ts` and new `generation-preview.store.spec.ts`
- `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` and existing `wizard-rpc.service.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts`
- `libs/frontend/setup-wizard/src/index.ts`
- New `libs/frontend/onboarding/src/lib/analyze/analysis-step.store.ts`, `analysis-step.store.spec.ts`, `analyze-workspace.page.ts`, `analyze-workspace.page.spec.ts`, `phase-list.component.ts`, and `phase-list.component.spec.ts`

## Acceptance evidence

- Bound preview is captured by `open` and reused on every comparison (`generation-preview.store.ts:69,94,145`). Failed bound comparisons retry and stay open for review (`:96`). Unbound calls retain their two-argument behavior (`:146`). The RPC sends `tabBinding` only when present (`wizard-rpc.service.ts:253-263`). The dialog has retry-specific copy and label under its new `retryOnError` input (`agent-preview-dialog.component.ts:180,281,291`). The new preview spec covers bound open/confirm, failed retry, unbound behavior, and superseded replies.
- Setup-wizard barrel retains prior exports and adds `BoundAgentDecisions`, `GenerationPreviewStore`, `PreviewConfirmation`, `WizardAnalysisRunner`, and `findBoundGenerationTab` (`index.ts:3-7`).
- A1 renders phase rows from returned IDs and maps all five statuses to visible text (`analysis-step.store.ts:38-48`, `phase-list.component.ts:5-25`); the header reads current/total from payload signals (`analysis-step.store.ts:50-55`, `analyze-workspace.page.ts:24`). No phase percent is rendered. Session-local elapsed is created on start and cleared on page destroy (`analyze-workspace.page.ts:101-102,108,136-139`). Stream counters require an attached running stream (`analysis-step.store.ts:56-66`).
- Saved analyses can be listed, used, or hidden transiently (`analysis-step.store.ts:70-85`, `analyze-workspace.page.ts:65-80,113-121`). An unfinished run remains separate from the selected completed analysis (`analysis-step.store.ts:36,68-69`); the page offers Continue previous run and Start fresh (`analyze-workspace.page.ts:35-43,128-134`).
- Running Stop opens `ConfirmationModalComponent` (`analyze-workspace.page.ts:23,81,135-136`); completed Manual adjust opens a coming-soon alert (`:55,82`). Failed runs offer Retry and Start over and the page says a lost connection may leave analysis running (`:31-34`). Every `RunPanel` instance passes `[viewState]` (`:23,30,32,44`). Failure text is mapped through `safeFailureCopy` (`:111`); saved and selection errors use fixed copy (`:67,120`).
- The C6 delta is followed: `AnalysisStepStore` owns recommendations, selection and confirmed-decision submit (`analysis-step.store.ts:94-120`); preview ownership stays in `GenerationPreviewStore`. The store spec checks valid/missing selection, unfinished-run isolation, catalog versus analysis source, and detached counters. The page spec checks saved selection and forward navigation with `explicitBack: false` (`analyze-workspace.page.spec.ts`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep preview state in the component-provided `GenerationPreviewStore` and omit preview state from `AnalysisStepStore` | Page-scoped preview or root store preview | Addendum C-A2 and C6 delta require the page-scoped owner; `generation-preview.store.ts` already owns decisions | Yes |
| Preserve legacy unbound `previewGeneration` call arity | Always send an undefined third argument or call with two arguments | Existing `agent-selection.component.spec.ts` asserts the unbound two-argument contract; the addendum says unbound behavior stays unchanged | Yes |
| Render phase content as text in a disclosure | Plain text or introduce a new markdown renderer dependency | A1 needs phase content visible; this code path has no verified markdown renderer contract, and interpolation does not inject backend markup | Yes |

## Verification

Command (run after the legacy-arity and lint fix):

`npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard 2>&1 | tail -30`

Tail: `NX 6 tasks: 6 succeeded`; lock released with exit code 0. The first run had three legacy call-arity test failures and one unused-import lint error; both were fixed before the successful rerun. Scoped `ptah_get_diagnostics` was unavailable because its TypeScript check exceeded 45 seconds; Nx typecheck passed. No browser or visual review was run, per lane instructions.

## Integration notes and unmet work

- The A2 page lane must pass `[retryOnError]="true"` to `AgentPreviewDialogComponent` to enable the bound Retry copy. That page is outside this lane's allowed files.
- `AnalysisStepStore.submit` reads `GenerationWorkflowStore.acceptedRun()` after starting; a pre-existing accepted run in the root store could be mistaken for the new run if a later start fails. The A2 page lane should reconcile the accepted run identity when wiring submit.
- `onboarding.routes.ts`, `shell/onboarding-step-link.ts`, the A2 files, and visual capture remain with other lanes/the coordinator as assigned.
