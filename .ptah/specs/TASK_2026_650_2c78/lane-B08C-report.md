# B08 part C

## Items

| Item | Status fixed/already-fixed/deferred | Fix file:line | Spec file:line |
| --- | --- | --- | --- |
| M1 watchdog budget | fixed | `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:77` | `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:148` |
| M2 countdown initial value | fixed | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:345` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:101` |
| M3 countdown re-arm | fixed | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:371` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:101` |
| M4 route destruction and preview | fixed | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:199`; `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts:21` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:101`; `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts:5` |
| M5 stale tabless Resume | fixed | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:289,399` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:101` |
| M6 retry counters | already-fixed | `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.ts:23` (B08A) | existing store specs |
| M7 resume facts and consent | already-fixed | B08A/B08B changes recorded in `lane-P4R1B-report.md` | existing backend specs |
| M8 finalization disagreement | already-fixed | B08A/B08B changes recorded in `lane-P4R1B-report.md` | existing backend and workflow specs |
| M9 restore without active workspace | fixed | `apps/ptah-extension-webview/src/app/app.config.ts:55` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:226` |
| m1 manual Skip | fixed | `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:55`; `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts:41` | `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts:34` |
| m2 pending event purge and overflow | fixed | `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts:70,79,130` | `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts:271` |
| m3 guidance launch intent | fixed | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:361` | `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts:15` |
| m4 cancelled landing open | fixed | `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.ts:267` | `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.spec.ts:15` |
| m5 preview warning path | fixed | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1088` | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:2938` |
| m6 future propagation target IDs | deferred | `libs/backend/agent-generation` is outside B08C ownership | — |
| N1 corrected finalization | fixed | `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts:251` | `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts:243` |
| N2 retry cap across null ID | fixed | `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.ts:105` | `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.spec.ts:146` |
| N3 successful retry, failed discovery | fixed | `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.ts:122` | `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.spec.ts:173` |
| N4 unavailable model rejection | fixed | `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:145`; `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:120` | `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts:344` |
| N5 stale listener comment | deferred | Review labels this a documentation follow-up; no code change assigned in B08C | — |
| Audit: binding workspace catch | fixed | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts:102` | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:208` |
| Audit: binding authorization catch | fixed | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts:216` | existing authorization specs in `wizard-generation-rpc.handlers.spec.ts` |
| Audit: consent catch | fixed | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1785` | existing preview/consent specs in `wizard-generation-rpc.handlers.spec.ts` |

## Checks

- Focused Jest: setup-wizard 7 suites/74 tests passed; webview routing 1 suite/77 tests passed; RPC handlers 1 suite/96 tests passed. After the final two shell specs, focused shell/next-steps Jest passed 2 suites/8 tests.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/setup-wizard ptah-extension-webview --parallel=1`: 3 projects passed.
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/setup-wizard ptah-extension-webview --parallel=1 -- --maxWorkers=2`: 3 projects passed.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: passed; `rpc-handlers` 1 (baseline 1, pre-existing agent-rpc site), `setup-wizard` 1 (baseline 1), `chat-ui` 12 (baseline 14).
- `npx prettier --write` ran on changed files; final shell spec formatting was unchanged.
- Scoped `ptah_get_diagnostics` after edits returned unavailable after 45 seconds with six files unchecked. Earlier scoped diagnostics had no errors in edited source, and subsequent Nx typecheck passed.

## Final line counts

| File | Lines |
| --- | ---: |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` | 340 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts` | 399 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts` | 423 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts` | 483 |
| `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts` | 364 |
| `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts` | 724 |
| `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.ts` | 126 |
| `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.spec.ts` | 185 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` | 612 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts` | 388 |
| `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts` | 112 |
| `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts` | 195 |
| `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts` | 103 |
| `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts` | 45 |
| `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.ts` | 281 |
| `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.spec.ts` | 114 |
| `apps/ptah-extension-webview/src/app/app.config.ts` | 402 |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | 887 |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts` | 375 |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` | 1827 |
| `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts` | 2673 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Fall back to landing when restoring a workflow without an active matching workspace. | Defer validation until workspace activation; fail closed at restore. | The validator runs at restore time and has no activation callback; the shell otherwise remains on an unusable route. | Yes |
| Consume guidance intent when its shell binds. | Change launcher keying; consume in shell. | The shell already consumes agent workflow intents, and binding proves the destination mounted. | Yes |
| Make manual Skip visibly set `skipped`. | Remove Skip; record a skipped outcome. | The plan requires Continue/Skip manual recovery. | Yes |
| Keep the countdown in the root handoff store after route destruction. | Cancel on destruction; retain deadline. | Implementation plan line 97 explicitly requires retention. | Yes |
| Defer m6. | Edit checkpoint schema outside scope; report. | The owning file is outside the B08C allowed paths. | Yes |

## Deviations

- m6 remains for the owner of `libs/backend/agent-generation`; this lane did not edit outside its scope.
- No chat-ui launcher edit was needed for m3 because the existing shell binding can consume the guidance intent.
- Several existing service and spec files exceed the suggested 450 lines; the changed shell source remains below it.
- The final scoped diagnostics service timed out; Nx typecheck and Jest passed.

## Proposed Removals

None.
