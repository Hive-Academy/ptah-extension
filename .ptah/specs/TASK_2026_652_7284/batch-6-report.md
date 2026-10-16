# Batch 6 report

## Changed files

- `libs/frontend/harness-builder/src/lib/services/harness-rpc.service.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts`
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts`
- `.ptah/specs/TASK_2026_652_7284/batch-6-report.md`

## Task evidence

- **6.1:** `harness-rpc.service.ts:289` returns the shared `HarnessStartNewProjectResult`; `:301` adds the typed `getProposal(sessionId)` RPC wrapper using the shared `HarnessGetProposalResult`.
- **6.2:** `harness-workflow-request.service.ts:20` handles same-mode resume, cross-mode abort/reset, request registration, and navigation; `:38` clears the pending request when navigation fails. `harness-workflow-request.service.spec.ts:54,60,69,81` covers new, same-mode, cross-mode, and navigation failure paths.
- **6.3:** `setup-hub.component.ts:1451` passes the returned seed prompt and intake to the request service, waits for navigation, and keeps the modal open with an error on failure. `setup-hub.component.spec.ts:293,318,339,350,368` verifies handoff, completion timing, navigation failure, and existing RPC errors.

## Decisions

- **Navigation failure contract:** `requestAndNavigate` returns `false` after clearing its exact pending request when the router returns a non-landed result. A rejected navigation also clears the request and propagates the error to the caller. Setup Hub displays an error and retains the modal. This matches the existing router's value-based outcomes and keeps unexpected rejections visible. Reversible: yes.
- **Relay copy:** The existing logic in `harness-workflow-message.handler.ts` remains in place for Batch 7, as assigned. Reversible: yes.

## Checks

- Prettier write: **pass**, 5 changed source/spec files formatted.
- Typecheck: **pass**, `@ptah-extension/harness-builder`.
- Lint: **pass**, `@ptah-extension/harness-builder`.
- Test: **pass**, 7 suites and 138 tests.

## Deviations

None. Nx printed a nonblocking Nx Cloud account warning after successful local checks.
