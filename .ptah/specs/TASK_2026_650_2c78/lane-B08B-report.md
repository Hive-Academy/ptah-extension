# B08 part B

## Delivered

| File | Purpose | Lines |
| --- | --- | --- |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts` | Route guidance tabs, bind saved state and shared push lifecycle | 23, 201, 329-360 |
| `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts` | Source, accepted snapshot, run card, result panel, escaped content | 1-90 |
| `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.spec.ts` | Push state, Stop, safe text rendering | 1-60 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.ts` / `.spec.ts` | Hide Skip for independent guidance; preserve optional Skip contract | 72-85 / 7 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` | Bound guidance regeneration through shared lifecycle; audit comment | 115-148, 278 |
| `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts` | Explain intentional background lookup swallow | 108 |
| `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts` / `.spec.ts` | Treat committed unchanged as completed | 190-195 / 93 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` / `.spec.ts` | Send tab model for bound regeneration, keep tabless payload | 165-182 / 68-102 |
| `libs/shared/src/lib/types/rpc/rpc-setup.types.ts` | Optional regenerate model | 562-565 |
| `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.schema.ts` / `.spec.ts` | Validate optional regenerate model | 58-64 / 20-31 |
| `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts` | Verify bound regenerate passes model to route | 1013-1038 |

## Acceptance

1. **Met:** Shell routes guidance to the page; source is a derived label and content is interpolated text (`generation-workflow-shell.component.ts:201`, `generation-guidance-page.component.ts:11-72`; `generation-guidance-page.component.spec.ts:8-59`). Agent branch remains in place.
2. **Met:** Shared workflow store owns push, watchdog and Stop; shell refreshes guidance's saved snapshot/result after a push (`generation-workflow-shell.component.ts:329-360`, `generation-workflow.store.ts:115-148`; `generation-guidance-page.component.spec.ts:8-59`). Shared transcript adapter handles activity.
3. **Met:** Page Stop and chat Stop use `GenerationWorkflowStore.stop()` and exact run lookup; unknown state rechecks (`generation-guidance-page.component.ts:32`, `generation-workflow-shell.component.ts:303-312`; `generation-workflow.store.spec.ts:344-369`, `generation-guidance-page.component.spec.ts:8-59`).
4. **Met:** Committed `unchanged` stays completed with an explicit note (`guidance-generation.store.ts:190-195`, `generation-guidance-page.component.ts:45-50`; `guidance-generation.store.spec.ts:93`).
5. **Partial:** Existing `GenerationHandoffStore` opens or creates and submits once to the same-workspace tab, then shell binds it (`generation-handoff.store.ts:38-118`, `generation-workflow-shell.component.ts:329-360`; `generation-handoff.store.spec.ts:11-154`). Failed background create retains manual recovery. Shell destruction still calls `handoff.skip()` at `generation-workflow-shell.component.ts:373-379`; Phase 4 Part C owns the page-switch countdown follow-up. Independent guidance has no agent scheduling path.
6. **Met:** Guidance bind restores saved result and neutral non-cancelled run state (`guidance-generation.store.ts:62-79,181-197`; `guidance-generation.store.spec.ts:101-120`).
7. **Met:** Optional model is validated and sent from the bound tab override or current model; tabless payload remains unchanged. Existing bound handler route already forwards `params.model` (`rpc-setup.types.ts:564`, `enhanced-prompts-rpc.schema.ts:62`, `wizard-rpc.service.ts:165-182`, `enhanced-prompts-rpc.handlers.ts:659-660`; `wizard-rpc.service.spec.ts:68-102`, `enhanced-prompts-rpc.handlers.spec.ts:1013-1038`).
8. **Met:** `prompt-enhancement.component.ts` was left unchanged; its legacy wizard-step path is outside this routed guidance page.
9. **Met:** New page and stores are internal; no consumer needs an index export.
10. **Partial:** setup-wizard audit is 1, baseline 1. rpc-handlers audit is 4, baseline 1; all four sites are pre-existing and outside B08B-owned files. No baseline changed.

## Checks

- Focused setup-wizard Jest: 5 suites, 42 tests passed. Jest reported a worker force-exit warning after completion.
- Focused rpc-handlers Jest: 2 suites, 38 tests passed. Jest reported a worker force-exit warning after completion.
- `npx nx run-many -t typecheck,lint -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`: passed for 4 projects.
- `npx nx run-many -t test -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/setup-wizard" --parallel=1 -- --maxWorkers=2`: passed for 3 projects.
- Degradation audit: setup-wizard **1 / 1**; rpc-handlers **4 / 1**; total 297 unsuppressed. Audit command exits 1 due unrelated repository sites.
- `ptah_get_diagnostics` remained unavailable after 45 seconds on scoped calls; Nx typecheck passed.
- `npx prettier --write` ran on changed source and specs.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use generic workflow state for guidance lifecycle; keep guidance store for accepted and saved details | Generic shared store or second push subscription | Shared store and adapter already handle bound push, watchdog, exact Stop and transcript; guidance store has no push listener | Yes |
| Extract guidance page | Grow shell or child component | Shell exceeded 450 lines with inline guidance; extracted shell is 390 lines | Yes |
| Keep independent page Skip hidden | Always show Skip or only show for combined fallback | Independent guidance has no pending handoff; existing agent next-steps owns combined fallback | Yes |
| Pass model through the existing bound handler branch | New handler path or extend schema | `startBoundGuidance` already reads `params.model` after schema validation | Yes |

## Deviations

- Phase 4 Part C owns the existing shell-destruction countdown issue, so switch/close/reload fallback is not fully closed in this lane.
- rpc-handlers audit exceeds baseline in four files outside this batch's ownership; none was edited.
- No change to `prompt-enhancement.component.ts`, setup-wizard public index, or the bound handler implementation was needed.

## Proposed Removals

None.