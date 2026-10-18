# Phase 5 revision round 1

## Findings fixed

| Finding | Fix file:line | Regression spec file:line |
| --- | --- | --- |
| S1, m2: current workflow run drives guidance snapshot, status, committed gate, and rebind | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:89`; `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:398` | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.spec.ts:93` |
| S2: safe rejection, busy-chat and unavailable-model feedback | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:46`; `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:139` | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.spec.ts:9`; `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:33` |
| M-a: Check again refreshes workflow and guidance | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:110` | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.spec.ts:9` |
| M-b: action errors clear; failed toggle rereads saved state | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:197` | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.spec.ts:146` |
| M-c: changed commit clears content; null content reports failure | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:176,212` | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.spec.ts:146` |
| M-d: timer clearing is separate from Skip; started outcome has acknowledgement | `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:50`; `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts:35` | `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts:67`; `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts:48` |
| M-e: guidance refresh is untracked and does not repeat at bind | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:397` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:15` |
| M-f: restore survives inactive workspace; shell validates on workspace activation | `apps/ptah-extension-webview/src/app/app.config.ts:40,55`; `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:313` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:226` |
| M-g: duplicate guidance run engine removed; lost-response and exact Stop covered on workflow path | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:89` | `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:33,353` |
| m1: Generate hidden while bound; Regenerate disabled | `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:39`; `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.ts:65` | `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.spec.ts:25` |
| m3: live region uses committed-gated guidance status | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:56` | `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.spec.ts:81` |
| m4: saved timestamp uses Angular DatePipe | `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.ts:24` | `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.spec.ts:20` |

## Checks

- Focused setup-wizard Jest: 7 suites, 41 tests passed. After the final committed-read adjustment, the guidance-store spec passed again: 1 suite, 6 tests.
- Focused webview routing Jest: 1 suite, 77 tests passed.
- `npx prettier --write` ran on all 16 changed source/spec files.
- Scoped `ptah_get_diagnostics` was requested twice after edits; both calls timed out with eight files unchecked. The orchestrator must run its serial typecheck gate.
- Routing evidence: `apps/ptah-extension-webview/src/app/initial-navigation.ts:86-103` restores the saved route during `App.ngOnInit`; `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:54-62,82-89` documents that Electron workspace activation can follow route settlement; the generation shell's `binding` computed reads `activeWorkspacePath$()` at `generation-workflow-shell.component.ts:313` and validates the tab in that workspace at `:331-340`.

## Final line counts

| File | Lines |
| --- | ---: |
| `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts` | 251 |
| `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.spec.ts` | 174 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` | 370 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts` | 451 |
| `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts` | 129 |
| `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts` | 242 |
| `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts` | 114 |
| `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.spec.ts` | 238 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts` | 438 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts` | 516 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.ts` | 102 |
| `libs/frontend/setup-wizard/src/lib/components/guidance-result-panel.component.spec.ts` | 44 |
| `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts` | 107 |
| `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts` | 59 |
| `apps/ptah-extension-webview/src/app/app.config.ts` | 405 |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | 1042 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Workflow store owns run start, push, watchdog and Stop; guidance store adopts its run and owns saved actions. | Keep two run engines; adopt workflow run. | Page starts through workflow store; review S1 and M-g identify stale snapshot and dead engine. | Yes |
| Allow a validated saved workflow route while active workspace is null; shell revalidates when workspace activates. | Fail to landing during boot; retain route until activation. | Electron boot ordering and shell binding signal cited under Checks. | Yes |
| Show fixed guidance errors and omit owner tab ID and raw host text. | Render host payload; fixed text by reason. | Review S2 privacy requirement and closed rejection union. | Yes |
| Keep handoff countdown in root store and distinguish starting from explicit Skip. | Mark skipped during open; clear timer without changing outcome. | Review M-d and plan countdown lifetime. | Yes |

## Deviations

- Scoped diagnostics timed out; focused Jest passed, but typecheck remains for the orchestrator.
- The integration spec uses real workflow and guidance stores with a fake RPC and explicitly invokes `adopt` to model the shell effect; the shell spec verifies that effect invokes `adopt` once for a terminal run.

## Proposed Removals

- Deleted `GuidanceGenerationStore.start`, `retry`, `regenerate`, `stop`, and private `submit`, plus the old accepted-response path. Caller search: `rg -n 'guidance\.(start|retry|regenerate|stop|submit)\(' libs/frontend/setup-wizard/src --glob '!*.spec.ts'` returned no non-spec call sites. Their duties now use `GenerationWorkflowStore.startGuidance`, `regenerateGuidance`, `stop`, and `refresh`.
