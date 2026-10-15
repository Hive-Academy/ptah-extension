# Batch 7 report

## Changed files

- `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts`
- `.ptah/specs/TASK_2026_652_7284/batch-7-report.md`

## Task evidence

- **7.2:** The handler delegates legacy open requests to `HarnessWorkflowRequestService.requestAndNavigate` and logs false or rejected results at `harness-workflow-message.handler.ts:44-83`. Its session effect starts hydration when the real session becomes available or changes at `:30,85-93`. The handler filters live proposals by the active session at `:133-145`.
- **Hydration:** `harness-workflow-message.handler.ts:96-131` fetches the persisted proposal, checks both the active session and returned proposal identity, applies the snapshot, then replays buffered live events in arrival order. A session change discards the old buffer and clears the previous session state at `:85-93`. A stale response is dropped. A failed fetch logs a real `Error` and still replays live events; it does not stop the workflow.
- **7.3:** `harness-workflow-message.handler.spec.ts:73-228` covers legacy delegation, false/rejected relay results, matching and nonmatching events, reload hydration without a new tool call, snapshot-before-live ordering, nonfatal failure, stale-response drop, and session unbinding.
- **Reserve files:** `harness-workflow.service.ts` and its spec were not edited. Hydration fits in the handler.

## Decisions

- **Session transition:** Clear the builder state when an already observed session changes or disappears. The state service's existing `reset()` is the available session-state reset API, and this prevents prior-session proposal fields from leaking into a new session. Reversible: yes.
- **Relay errors:** A false navigation result and a rejected request both produce a log and user-facing workflow error. The request service owns navigation and pending-request cleanup. Reversible: yes.

## Checks

- Prettier write on the two changed source/spec files: pass.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-builder --parallel=1`: both targets pass.
- `npx nx test @ptah-extension/harness-builder --parallel=1 --maxWorkers=2`: 7 suites, 133 tests pass.
- Scoped Ptah diagnostics: no errors in either changed file. It reported 14 errors in untouched sibling files; the project typecheck target passed.

## Deviations

None. Nx Cloud reported a disabled organization after successful local targets.

## Fix round 1

Changed files: `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts`, `harness-workflow-request.service.spec.ts`, `harness-workflow-message.handler.ts`, `harness-workflow-message.handler.spec.ts`, `harness-workflow.service.ts`, `harness-workflow.service.spec.ts`, `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`, `setup-hub.component.spec.ts`, and this report.

- **F1:** `harness-workflow-request.service.ts:12,22-24,52-58` exports the typed `landed | cancelled | failed` outcome. Both `navigated` and `already-there` land; cancellation and failure clear the pending request. The handler ignores landed and cancelled outcomes at `harness-workflow-message.handler.ts:64-76`. Setup Hub closes its modal only on landed, keeps it open without error on cancelled, and shows its existing error on failed at `setup-hub.component.ts:1449-1460`. Cases are in `harness-workflow-request.service.spec.ts:88-98`, `harness-workflow-message.handler.spec.ts:92-120`, and `setup-hub.component.spec.ts:339-364`.
- **F2:** `harness-workflow-request.service.ts:29-37` rethrows the exact abort failure text with the original cause and does not reset or request a replacement. `harness-workflow-message.handler.ts:77-83` logs and displays that message. Covered at `harness-workflow-request.service.spec.ts:100-111` and `harness-workflow-message.handler.spec.ts:123-142`.
- **F3:** `harness-workflow.service.ts:183-190` exposes the bound conversation's session IDs oldest first. The handler uses the public `surfaceId` signal as workflow identity at `harness-workflow-message.handler.ts:33-35,88-111`; only a surface change or unbind resets builder state. It hydrates queued session snapshots sequentially, buffers live events through the whole hydration, logs failures, and drops stale responses at `:113-139`. Events from any bound session are accepted at `:141-151`. Tests at `harness-workflow.service.spec.ts:187-201` and `harness-workflow-message.handler.spec.ts:157-329` cover ordered reload hydration, appended head without reset, earlier-session events, foreign-session rejection, failures, and stale responses.
- **F4:** `harness-workflow-message.handler.spec.ts:84-155` restores malformed and missing payload checks and legacy relay coverage for landed, cancelled, failed, and rejected outcomes.

**Checks:** Prettier write passed for all eight source/spec files. Project typecheck and lint passed. Project Jest passed: 7 suites, 145 tests, 0 failures (above the required 138 baseline). Scoped Ptah diagnostics reported a stale test annotation introduced by this fix; it was corrected before the final project checks. The diagnostic tool also listed unrelated existing errors in sibling files, while the scoped Nx typecheck passed.

**Deviations:** None. The existing report above describes the pre-fix Batch 7 behavior and test count; this section supersedes it for the fix round. Nx Cloud reported a disabled organization after successful local checks.
