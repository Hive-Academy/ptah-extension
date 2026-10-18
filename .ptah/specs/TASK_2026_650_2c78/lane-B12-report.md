# B12

## Delivered

| File | Change | Lines |
| --- | --- | --- |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts` | Continue opens the combined agent tab; safe failed feedback, cancelled silent; old resume stays | 202-210, 352-385 |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.spec.ts` | Combined origin, failure/cancellation coverage | 135-181 |
| `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.ts` | Launcher rejection shows safe retry copy; independent origin retained | 250-267 |
| `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.spec.ts` | Both independent generation starts covered | 70-105 |
| `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts` | Safe saved-analysis errors and accurate Hide action | 233-243, 318, 357-377, 425-455 |
| `libs/frontend/setup-wizard/src/lib/components/welcome.component.spec.ts` | Hide remains list-only | 166-181 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts` | Resume failure uses safe copy instead of raw exception | 132-158 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.spec.ts` | Safe resume failure expectation | 356-371 |

## Acceptance

| Item | Result | File:line | Spec file:line |
| --- | --- | --- | --- |
| Saved analysis browse/load/hide | met | `welcome.component.ts:233,425,451`; `wizard-landing.component.ts:238,270,284` | `welcome.component.spec.ts:166`; `wizard-landing.component.spec.ts:105` |
| Old run resume/cancel and four phase results | met | `wizard-analysis-runner.service.ts:132,221,244`; `analysis-results.component.ts:279,384` | `wizard-analysis-runner.service.spec.ts:238,313`; `analysis-results.component.spec.ts:160` |
| Continue marks combined flow | met | `analysis-results.component.ts:352-368` | `analysis-results.component.spec.ts:135` |
| Independent landing starts | met | `wizard-landing.component.ts:250-267` | `wizard-landing.component.spec.ts:70` |
| Safe launch failure; cancelled silent | met | `analysis-results.component.ts:206,365-368`; `wizard-landing.component.ts:264-267` | `analysis-results.component.spec.ts:154`; `wizard-landing.component.spec.ts:84` |
| Persisted route remains working | met | `wizard-view.component.ts:109-140`; `wizard-landing.component.ts:32-58` | `wizard-landing.component.spec.ts:12` |

## Removed

| File | Caller-search command | Result |
| --- | --- | --- |
| None | `rg -n 'AgentSelectionComponent\|ptah-agent-selection\|agent-selection.component\|GenerationProgressComponent\|ptah-generation-progress\|generation-progress.component\|PromptEnhancementComponent\|ptah-prompt-enhancement\|prompt-enhancement.component\|CompletionComponent\|ptah-completion\|completion.component' libs apps --glob '!*.spec.ts'` | All four old presentation components are imported and rendered by `wizard-view.component.ts:43-58,131-140`, and exported by `src/index.ts:32-35`. No candidate was proven unused. |

## Kept with reason

- Old `AgentSelectionComponent`, `GenerationProgressComponent`, `PromptEnhancementComponent`, `CompletionComponent`, their helpers and specs: persisted wizard route still renders these steps, and old resume leads to generation. Removing them here would break a reachable path. `PromptEnhancementComponent` has a non-spec caller.
- Analysis phases, landing, Close action, Settings/CLI RPC contracts, and e2e fixture: required compatibility paths.

## Parity check

| Row | New working path |
| --- | --- |
| 27 live transcript | `generation-workflow-shell.component.ts:242` chat pane; `generation-run-event-adapter.ts:17` |
| 28 cancellation | `generation-workflow-shell.component.ts:305,400`; `generation-workflow.store.ts:237-289` bound run lifecycle |
| 29 checkpoint/retry | `generation-workflow-shell.component.ts:71-94`; `agent-generation.store.ts:79-100` |
| 30 old checkpoint | `generation-workflow-shell.component.ts:71-81`; `wizard-analysis-runner.service.ts:132` |
| 31 bounded retry | `agent-generation.store.ts:20,100`; `agent-generation-progress.component.ts:30` |
| 32 committed counts | `generation-workflow-shell.component.ts:141-158`; backend finalization remains in `orchestrator.service.ts` |
| 33 combined handoff | `analysis-results.component.ts:363`; `generation-workflow-shell.component.ts:380`; `generation-handoff.store.ts:45` |
| 34 guidance start | `generation-workflow-shell.component.ts:222`; `generation-handoff.store.ts:95`; `generation-guidance-page.component.ts:33-41` |
| 35 workspace prompt input | `generation-guidance-page.component.ts:33-41`; `enhanced-prompts.service.ts:402-500` |

## Checks

- Focused setup wizard Jest: 5 suites, 46 tests passed, including `generation-run-event-adapter.spec.ts`. Jest reported a worker teardown warning.
- Chat input regression gate: 1 suite, 85 tests passed.
- `nx run-many -t typecheck,lint` for setup wizard and webview: passed.
- `nx test @ptah-extension/setup-wizard`: 35 suites, 430 tests passed.
- Degradation audit: `libs/frontend/setup-wizard: 1 ok (baseline 1)`.
- Scoped diagnostics after edits reported no errors in edited source; sibling diagnostics included existing adapter spec and shared BigInt target errors. The subsequent Nx typecheck passed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain old-generation presentation | Delete; retain | Live imports, templates, barrel exports, and old resume path in `WizardViewComponent` | Yes |
| Preserve old resume while Continue opens combined tab | Redirect resume too; preserve checkpoint recovery | Parity row 30 and the B12 requirement to preserve old run resume | Yes |
| Use generic failure copy | Show exception; generic copy | Launcher failures can include internal details; safe-copy requirement | Yes |

## Deviations

- No old presentation was deleted because none was proven unused under the user-approved condition. The route and old resume path remain live.
- No chat files or out-of-batch files were edited.

## Proposed Removals

- The four old generation presentation components can be reconsidered after a separate owner removes or migrates their live `WizardViewComponent` cases and old resume route. No removal is proposed within this batch.