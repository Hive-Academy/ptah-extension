# B05 implementation report

## Status

Implemented the routed generation shell, bound workflow and handoff stores, typed open handler, safe generation event adapter, RPC facade, routes, and app providers. Focused tests and typecheck/lint pass. The two-project webview test gate has one existing route-inventory assertion that needs updating outside B05 ownership. The generator-to-normal-chat integration scenario is not covered by an end-to-end regression test.

## Files changed

| File | Lines |
| --- | ---: |
| libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts | 100 |
| libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts | 53 |
| libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts | 239 |
| libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts | 76 |
| libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts | 104 |
| libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts | 86 |
| libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts | 142 |
| libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts | 76 |
| libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.ts | 36 |
| libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.spec.ts | 42 |
| libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts | 604 |
| libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts | 344 |
| libs/frontend/setup-wizard/src/index.ts | 38 |
| apps/ptah-extension-webview/src/app/app.routes.ts | 218 |
| apps/ptah-extension-webview/src/app/app.routes.spec.ts | 130 |
| apps/ptah-extension-webview/src/app/app.config.ts | 391 |
| apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts | 301 |

## Acceptance evidence

| Requirement | Source evidence | Verification |
| --- | --- | --- |
| Routed shell embeds bare session and validates tab, workspace and workflow on open, restore and workspace change | generation-workflow-shell.component.ts:24-99; app.routes.ts:100 | generation-workflow-shell.component.spec.ts; app.routes.spec.ts |
| Typed host open push validates workspace and invokes B04 launcher | setup-generation-open.handler.ts:12-35; app.config.ts:191-210 | setup-generation-open.handler.spec.ts; surface-message-routing.spec.ts |
| Current-workspace exact-workflow route restoration validator provided before router restoration | app.config.ts:191-210 | app.routes.spec.ts; surface-message-routing.spec.ts |
| Bound store handles starting, quiet, cancellation, unknown stop, terminal authority, unknown provider/model, interrupted and preview-required | generation-workflow.store.ts:19-43,83-207 | generation-workflow.store.spec.ts |
| Stop awaits accepted or looked-up exact run ID and does not fall through to chat abort; Send is guarded | generation-workflow-shell.component.ts:24-99; generation-workflow.store.ts:83-207 | generation-workflow-shell.component.spec.ts; generation-workflow.store.spec.ts |
| Handoff uses absolute five-second deadline with switch, close, reload and manual recovery | generation-handoff.store.ts:16-103 | generation-handoff.store.spec.ts |
| Forwarded generator events contain safe text/tool labels without SDK session or run IDs; terminal push refreshes committed state | generation-run-event-adapter.ts:30-141 | generation-run-event-adapter.spec.ts |
| Bound RPC operations preserve tabless wizard callers | wizard-rpc.service.ts:84-146 | wizard-rpc.service.spec.ts |

## Checks

- Focused setup-wizard Jest: 6 suites, 32 tests passed.
- Focused webview route and message-routing Jest: 2 suites, 18 tests passed.
- Nx typecheck and lint for setup-wizard, webview, chat and core: passed for all 4 projects.
- Requested two-project Nx test run: 18 suites and 519 tests passed; 1 suite and 1 test failed at untouched apps/ptah-extension-webview/src/app/webview-routing.spec.ts:818. It asserts that the only parameter route is harness-builder/:mode/:tabId; the B05 generation route adds another.
- Focused chat input and session embed Jest: 2 suites, 92 tests passed.
- Post-edit ptah diagnostics: no diagnostics in B05 files; two BigInt target diagnostics in unrelated libs/shared/src/lib/types/capability-id-codec.ts:262-263. Nx typecheck passed.
- Prettier run on changed files.

## Notes for B06/B07

- Shell is GenerationWorkflowShellComponent, routed at /setup-wizard/generation/:workflow/:tabId. It binds bare ptah-session-embed startGuard and stopHandler and uses GenerationWorkflowStore.
- GenerationWorkflowStore exposes binding, run, state, rejection, isBound, provider and model signals. It binds/refreshes exact committed runs, queues Stop until a run ID is known, and treats terminal RPC state as authority. Provider/model values of unknown are hidden. The run signal retains committedState and interrupted; rejection retains preview-required.
- GenerationHandoffStore exposes pending and outcome signals and schedule, skip, tabClosed, startNow and manualContinue methods. The five-second deadline is absolute. A failed automatic start remains recoverable manually.
- SetupGenerationOpenHandler accepts only typed SETUP_GENERATION_OPEN for the active workspace and calls GenerationWorkflowLauncherService.open. B06 should send the shared SETUP_GENERATION_OPEN payload with the source workspace, workflow and tab binding specified by the shared message type. It must never include or display source.analysisDir.
- GenerationRunEventAdapter displays a bounded, sanitized activity log in the shell. It does not mutate chat session turn revision state. A normal-chat-turn-after-generator integration regression remains needed in B07/B08.
- Update the route inventory assertion in webview-routing.spec.ts:818 in its owning batch.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use a direct generation route alongside the legacy wizard route | Direct route; nested child route | Legacy WizardViewComponent has no router outlet; direct route preserves existing wizard flow | Yes |
| Use committed RPC records as terminal authority | Trust terminal push; refresh committed record | Shared run-state contract includes committedState, interrupted and timed-out; a closed stream is not success | Yes |
| Keep generator event display local to the routed shell | Forward into normal chat state; local activity log | D11 requires isolating SDK session IDs and chat turn revision; shell can show safe progress without advancing normal chat state | Yes |

## Deviations

- The generation route is a direct route instead of a nested child because the current wizard component has no router outlet.
- The full two-project test gate fails on the unassigned route inventory test described above; ownership rules prohibit editing it here.
- Generator events are shown in the shell activity log, rather than forwarded into the normal chat transcript. The requested normal-turn-after-generator regression is not fully verified.

## Proposed Removals

None.
