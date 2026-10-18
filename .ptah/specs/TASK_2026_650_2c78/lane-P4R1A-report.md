# Phase 4 revision round 1, Part A

## Findings fixed

| Finding | Fix and evidence | Regression spec |
| --- | --- | --- |
| S1 | `generation-run-event-adapter.ts:52-62` clears terminal markers and stale message ownership when the same run becomes active again. | `generation-run-event-adapter.spec.ts:209` checks a second message; `:318` composes the real workflow store, tab manager, and streaming services through terminal → bound resume with the same run ID → live text → finalization. |
| S2 | `wizard-rpc.service.ts:118-136` reads the tab's `overrideModel`, falling back to `ModelStateService.currentModel()`, and sends it for bound start and resume. | `wizard-rpc.service.spec.ts:349` verifies both RPC payloads. |
| S3 | `wizard-rpc.service.ts:238-251` sends the exact bound retry identity and rejects an unsuccessful result. `generation-workflow-shell.component.ts:74` supplies a binding only for a matching checkpoint run. `agent-generation.store.ts:101-125` keeps the delay/cap/duplicate guard and refreshes the checkpoint after success. | `wizard-rpc.service.spec.ts:303` checks bound params and rejection; `agent-generation.store.spec.ts:69` checks written status after success and retained attempt count after failure. |
| S4 | `generation-workflow-shell.component.ts:270-294` keeps binding values equal across unrelated tab changes. `agent-selection-list.component.ts:206-225` tracks only binding identity when loading or initializing selection. | `agent-selection-list.component.spec.ts:153,170` checks catalog and analysis selection when the binding object changes without an identity change, including no second catalog request. |
| S5 | `generation-workflow.store.ts:39,185` records each accepted start. `generation-workflow-shell.component.ts:325-349` schedules combined guidance only for a run accepted after the origin was consumed. | `generation-workflow-shell.component.spec.ts:25` verifies an old completed run does not schedule and a newly accepted completed run schedules once. |
| M6 | `agent-generation.store.ts:23,103-108` resets retry attempts when the bound run ID changes. | `agent-generation.store.spec.ts:69` checks the next run starts with its own attempt count. |

## Checks

- Focused Jest: **5 suites, 55 tests passed**.
- Nx `typecheck,lint`: **passed for 3 projects** (`@ptah-extension/setup-wizard`, `@ptah-extension/chat-ui`, `ptah-extension-webview`).
- Nx `test`: **passed for 3 projects** (same projects).
- `ptah_get_diagnostics` after initial edits reported no errors in requested files, with two existing sibling `capability-id-codec.ts` target errors. The final diagnostic request timed out while its TypeScript check continued; the Nx typecheck gate passed afterward.
- Prettier applied to all changed source and spec files.

## Final line counts

| File | Lines |
| --- | ---: |
| `generation-run-event-adapter.ts` | 325 |
| `generation-run-event-adapter.spec.ts` | 681 |
| `wizard-rpc.service.ts` | 623 |
| `wizard-rpc.service.spec.ts` | 403 |
| `agent-generation.store.ts` | 130 |
| `agent-generation.store.spec.ts` | 145 |
| `generation-workflow.store.ts` | 326 |
| `generation-workflow-shell.component.ts` | 366 |
| `generation-workflow-shell.component.spec.ts` | 391 |
| `agent-selection-list.component.ts` | 386 |
| `agent-selection-list.component.spec.ts` | 230 |

## Decisions

- Use the same tab model source as the picker (`overrideModel` then `currentModel`) for bound submit and resume. Options: host default or selected model. The picker promises the selected tab model; reversible.
- Keep tabless retry for a checkpoint whose run ID differs from the current bound run. Options: force the current binding or retain the legacy contract. The checkpoint may predate the current bound run; reversible.
- Gate combined guidance on an accepted-start revision recorded after origin consumption. Options: compare wall-clock timestamps or use accepted-start identity. The store has the exact acceptance event; reversible.

## Deviations

- No backend, shared, or chat-ui files changed. Existing large `wizard-rpc.service.ts` and adapter spec remain above the approximate 400-line target; fixes were made in place.

## Proposed Removals

None.
