# Phase 4 revision round 1, Part B

## Findings fixed

| Finding | Fix and evidence file:line | Regression spec file:line |
| --- | --- | --- |
| M7 stale resume facts | `wizard-generation-checkpoint.service.ts:356` omits old verified result and propagation; `wizard-generation-rpc.handlers.ts:935` restores earlier completed propagation only when the resume writes nothing. | `wizard-generation-checkpoint.service.spec.ts:175`; `wizard-generation-rpc.handlers.spec.ts:286` |
| M7 misleading consent | `generation-workflow-shell.component.ts:153,225` says “not attempted” for that status. | `generation-workflow-shell.component.spec.ts:14` |
| M8 propagation persistence after finalize | `wizard-generation-rpc.handlers.ts:919` catches and logs persistence failures, and omits unrecorded propagation facts. | `wizard-generation-rpc.handlers.spec.ts:320` |
| M8 committed reload after finalize | `wizard-generation-rpc.handlers.ts:957` catches and logs reload failure; completed push omits facts it could not reload. | `wizard-generation-rpc.handlers.spec.ts:352` |
| M8 terminal correction | `wizard-generation-run.supervisor.ts:302` marks a finalization failure; `generation-workflow.store.ts:285` accepts a later completed lookup with verified facts only for that failure. `rpc-setup.types.ts:66` adds the optional marker. | `generation-workflow.store.spec.ts:33` |
| Manifest optional fields | Schema parses both absent and present `verifiedResult` and `propagation`. | `wizard-generation-checkpoint.service.spec.ts:133` |

## Checks

| Command | Result |
| --- | --- |
| `npx prettier --write <10 changed TypeScript files>` | Passed. |
| `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.spec.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=2` | Passed: 2 suites, 100 tests. Initial runs caught a missing result-details type key and a test mock that failed before finalize; both were fixed. |
| `npx jest -c libs/frontend/setup-wizard/jest.config.ts libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts --coverage=false --maxWorkers=2` | Passed: 2 suites, 17 tests. |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/setup-wizard @ptah-extension/shared --parallel=1` | Passed for 3 projects. |
| `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/setup-wizard @ptah-extension/shared --parallel=1 -- --maxWorkers=2` | Passed; header confirmed 3 projects. |
| `ptah_get_diagnostics` scoped to changed files | Unavailable: compiler check still running after the tool's 45-second limit. Nx typecheck passed. |

## Final line counts

| File | Lines |
| --- | ---: |
| `wizard-generation-checkpoint.service.ts` | 463 |
| `wizard-generation-checkpoint.service.spec.ts` | 222 |
| `wizard-generation-rpc.handlers.ts` | 1825 |
| `wizard-generation-rpc.handlers.spec.ts` | 2667 |
| `wizard-generation-run.supervisor.ts` | 351 |
| `generation-workflow.store.ts` | 317 |
| `generation-workflow.store.spec.ts` | 362 |
| `generation-workflow-shell.component.ts` | 372 |
| `generation-workflow-shell.component.spec.ts` | 393 |
| `rpc-setup.types.ts` | 584 |

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Restore earlier completed propagation after a zero-write resume. | Restore completed record or leave propagation absent. `prepareResume` must clear prior facts, while a zero-write run has no new propagation event; `wizard-generation-rpc.handlers.ts:935` restores the completed record at settlement. | Yes |
| Report completed without reloaded facts after a committed reload error. | Retry once or omit facts. The manifest is already finalized, and no reliable facts were read; `wizard-generation-rpc.handlers.ts:957` logs the error and leaves the push completed. | Yes |
| Add an optional finalization failure marker to the shared result type. | Infer from generic failed status or mark the specific cause. Generic failed results are indistinguishable without a marker; `rpc-setup.types.ts:66` and `generation-workflow.store.ts:285` keep all other terminal results monotonic. | Yes |

## Deviations

The optional shared type field was required to identify the precise failed push. The diagnostics service timed out; scoped Nx typecheck and lint passed. No other scope deviation.

## Proposed Removals

None.
