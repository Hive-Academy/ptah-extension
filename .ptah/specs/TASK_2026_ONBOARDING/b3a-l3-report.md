# B3a L3 handoff

## Files changed

- `libs/frontend/onboarding/src/lib/analyze/analysis-step.store.ts` and `.spec.ts`: compare the accepted run identity before and after `startAgents` so a failed start cannot forward a previous run (`analysis-step.store.ts:110-118`, spec `:63-71`).
- `libs/frontend/onboarding/src/lib/analyze/choose-agents.page.ts` and `.spec.ts`: A2 page and focused behavior cases (`choose-agents.page.ts:23-255`, spec `:63-113`).
- `libs/frontend/onboarding/src/lib/onboarding.routes.ts` and `.spec.ts`: A1 and A2 routes before `**`, with crumbs and route resolution cases (`onboarding.routes.ts:40-42`, spec `:78-85`).

## Acceptance mapping

- A2 list, selection toolbar, grouping, match percentage and criteria: `choose-agents.page.ts:74-84` uses the lane L2 `AgentRecommendationListComponent`. Catalog source line and Analyze first banner: `:53-65`. Catalog load and retry: `:66-72`, `:197-204`.
- A2 stepper and source display: `choose-agents.page.ts:48-64,136-145`. The recorded `GenerationContextSource` is rendered by `GenerationSourceStatusComponent`; before acceptance the page labels the selected input without claiming host verification.
- Tab resolution, launcher fallback, URL writeback with `replaceUrl`, bind, active-run forwarding, and `explicitBack`: `choose-agents.page.ts:147-174`; submit navigation uses `onboardingStepLink` with `tab` and `run` at `:250-255`.
- Per-tab model picker and community packs: `choose-agents.page.ts:85-91`. Owner conflict banner and Open it/Retry wiring: `:92-95,238-245`.
- Preview is page-scoped (`choose-agents.page.ts:40`). Opening uses the bound fresh comparison (`:206-210`); dialog inputs, Retry-on-error, per-file decisions, bulk actions, and target change are wired at `:106-114`. `GenerationPreviewStore` refreshes before confirm, resets changed targets to Keep, and returns token/Replace entries/target (`generation-preview.store.ts:69-76,94-106,108-131,135-170,196-207`). The dialog derives its label from `confirmLabel('sidebar-dialog', n)` (`agent-preview-dialog.component.ts:363-367`). Confirm submits the decisions; `preview-required` reopens with `keepTarget=true` and an inline review message (`choose-agents.page.ts:215-236`).
- Raw transport failure text is mapped through `safeFailureCopy` (`choose-agents.page.ts:197-204,231-235`). No `RunPanel` is used on A2.
- Tests cover stale accepted runs (`analysis-step.store.spec.ts:63-71`), bound decisions, review-required, owner banner state, explicit back, and tab recreation (`choose-agents.page.spec.ts:63-113`). The preview store and dialog cases from L1 remain in their existing specs.

Stable page test IDs: `choose-agents` (`choose-agents.page.ts:44`), `choose-agents-list` (`:74`), `choose-agents-toolbar` (`:75`), `choose-agents-preview-trigger` (`:100`), `choose-agents-owner-banner` (`:93`), `agent-only-banner` (`:54`). The list component also exposes `agent-recommendation-list` and `agent-recommendation-toolbar`.

## Decisions

- **Accepted run identity:** compare both `runId` and the store's acceptance `revision` (instead of trusting any non-null accepted run). Evidence: `GenerationWorkflowStore.acceptedRun` is retained after start failure and increments revision on every acceptance. Reversible: yes.
- **Missing or invalid A2 tab:** use the plan's `focus:false` launcher fallback and replace the URL's `tab`, rather than treating the stale query as a terminal error. Evidence: implementation plan A5 A2 row and `findBoundGenerationTab` contract. Reversible: yes.
- **Source before generation:** label the selected analysis or catalog as pending host verification; display the run's recorded `GenerationContextSource` when it exists. Evidence: `GenerationSourceStatusComponent` contract and design spec A2 source line. Reversible: yes.
- **Preview owner:** keep `GenerationPreviewStore` in the page providers and use the shared dialog, including its Retry mode. Evidence: addendum C-A2. Reversible: yes.

## Verification

Command: `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard 2>&1 | tail -30`

Final rerun exit 0 after waiting for the shared verify lock. Relevant tail:

```text
[verify 2026-10-30T11:12:44.921Z] lock slot 0 acquired after 557s: verify lint,test,typecheck (@ptah-extension/onboarding,@ptah-extension/setup-wizard)
 NX   6 tasks: 6 succeeded, 5 cached
  Run duration:      14.2s
  Cache:             5/6 hit (83%)
[verify 2026-10-30T11:13:15.227Z] lock released after 30.3s, exit code 0
```

The earlier scoped run before the source/stepper refinement also passed all 6 tasks (3 cached), exit 0.

## Unmet or delegated

- Electron visual capture and screenshot review are delegated to the coordinator per lane instruction not to run a browser. Source and type checks are not visual evidence.
- A3 route is owned by B3b. A2 navigates to its planned URL; full A3 navigation is testable after that route is merged.

## Revision 1

1. **Saved analysis precedence:** A1 now renders a loaded completed analysis before the interrupted panel (`analyze-workspace.page.ts:36-54`). The chosen analysis keeps its Continue action even when an unfinished run exists. Rendered regression: `analyze-workspace.render.spec.ts:39`.
2. **Late async navigation:** A2 registers a `DestroyRef` guard and checks it after launcher, URL writeback, refresh, saved-list, analysis load, preview confirmation, submit, and preview reopen, plus before `goToRun` (`choose-agents.page.ts:127-149,164-195,230-265`). Tests destroy the page before launcher and submit replies (`choose-agents.page.spec.ts:114,123`).
3. **Stale submit rejection:** A2 verifies the resulting generation binding and compares rejection/error identity across `startAgents`; an early no-op returns fixed failure copy instead of an earlier blocked or preview-required result (`analysis-step.store.ts:121-135`). Tests cover both stale rejections and an unaccepted binding (`analysis-step.store.spec.ts:75,82`).
4. **Elapsed timer:** A1 clears the interval after stop, destroy, or the first terminal-state tick (`analyze-workspace.page.ts:117,142-148`). Regression: `analyze-workspace.render.spec.ts:122`.
5. **Catalog shape:** A2 rejects non-array catalog payloads, drops malformed rows, and normalizes absent or invalid `matchedCriteria` to a string array (`analysis-step.store.ts:104-119`). Regression: `analysis-step.store.spec.ts:94`.
6. **Saved-list failure:** Onboarding opts into a throwing `listAnalyses` call, so A1's Retry appears and A2 reports a retryable load error instead of missing analysis; the default RPC call still resolves to `[]` for legacy users (`analysis-step.store.ts:70`, `wizard-rpc.service.ts:631-644`, `choose-agents.page.ts:183-196`). Tests: `analyze-workspace.render.spec.ts:76`, `choose-agents.page.spec.ts:135`, `wizard-rpc.service.spec.ts:66`.
7. **Coverage gaps:** Added rendered A1 tests for interrupted Continue/Start fresh, saved-list Hide/Retry, Stop confirmation, Manual adjust, phase header, and recovery actions (`analyze-workspace.render.spec.ts:39-122`). Added preview-store tests for changed targets at confirm, changed revision resetting Replace, target change resetting Keep, and preview-required reopening with the chosen root (`generation-preview.store.spec.ts:51-74`). All five phase-status labels remain covered by `phase-list.component.spec.ts:5-13`.
8. **RunPanel state:** A1 now derives `GenerationViewState` from runner status and a local stop-unconfirmed flag and passes it to all four panel states (`analyze-workspace.page.ts:22-38,100-104`). A failed Stop renders the panel's Retry/Start over controls; Retry clears the flag (`analyze-workspace.page.ts:136`, `analyze-workspace.render.spec.ts:102`).

### Decisions

- **Loaded analysis wins over interruption.** Options: show interrupted panel first or selected completed analysis first. The explicit saved choice and Choose-agents action take precedence; the existing resumable run remains available when no analysis is selected. Evidence: review finding 1 and the A1 saved-analysis flow. Reversible: yes.
- **Check binding state and rejection identity.** The current `GenerationWorkflowStore.bind()` returns `void`, despite review wording about a result. Comparing its resulting binding detects an unaccepted tab; comparing rejection identity avoids stale results without changing the shared generation API. Evidence: `generation-workflow.store.ts:70-87,103-120`. Reversible: yes.
- **Use opt-in saved-list failure reporting.** Options: change all RPC callers or add an onboarding option. `throwOnError` preserves existing `[]` behavior for legacy callers while letting A1/A2 distinguish failure from empty. Evidence: `wizard-rpc.service.ts:631-644` and review finding 6. Reversible: yes.
- **Map analysis to panel state locally.** Analysis has no generation workflow state. Runner running/cancelling/error/completed map to matching panel states; failed cancel maps to `stop-unconfirmed` until Retry or Start over. Evidence: `WizardAnalysisRunner` signals and `RunPanelComponent.needsStopRecovery`. Reversible: yes.

### Verification

`npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard 2>&1 | tail -30` — final rerun exit 0. Tail:

```text
[verify 2026-10-30T11:52:33.853Z] lock slot 0 acquired after 71s: verify lint,test,typecheck (@ptah-extension/onboarding,@ptah-extension/setup-wizard)
 NX   6 tasks: 6 succeeded, 3 cached
  Run duration:      3m 58s
  Cache:             3/6 hit (50%)
[verify 2026-10-30T11:56:40.798Z] lock released after 246.9s, exit code 0
```

Scoped `ptah_get_diagnostics` timed out with coverage reported as unchecked; the Nx lint, Jest, and Angular typecheck gate above passed. No browser or visual review was run, per task instruction.

## Revision 2

1. **N1 — saved-list Retry:** `choose-agents.page.ts:69,184-224` routes Retry through the pending analysis load when list or selection failed. That path re-lists, re-selects, and then loads recommendations; after selection succeeds, Retry only reloads recommendations. Destroy guards remain after both list and selection awaits. Tests in `choose-agents.page.spec.ts:132-143,166-175` cover both retry paths.
2. **N2 — selection failure copy:** `choose-agents.page.ts:209-215` distinguishes `failed` (retryable load copy) from `not-found` (no-longer-available copy). Tests in `choose-agents.page.spec.ts:145-164` verify both outcomes and a working Retry after `failed`.
3. **N3 — pending slug and destroy:** `analyze-workspace.page.ts:95-97,113-146` keeps the requested `?analysis=` slug through a saved-list failure, applies it after a successful Retry, and guards state writes/navigation after awaits when the page is destroyed. Tests in `analyze-workspace.render.spec.ts:85-110` cover Retry applying the slug and no navigation after destroy.

Verification: `npm run verify -- -p @ptah-extension/onboarding 2>&1 | tail -40` — exit 0; `NX   3 tasks: 3 succeeded` (0 cached). Scoped `ptah_get_diagnostics` timed out with four files unchecked; the Nx gate passed. No browser or visual review was run, per task instruction.

## Decisions

- **Keep the requested analysis pending until saved-list success.** Options were clearing it on initial failure or retaining it for Retry. Retaining it follows the URL's explicit selection and lets the existing Retry recover. Evidence: N1/N3 review scenarios and the page's saved-analysis flow. Reversible: yes.
