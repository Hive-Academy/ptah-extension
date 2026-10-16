# F1-B chat entry and Hub fixes

## Findings

- **S2:** `message-sender.service.ts:375,420-424,466-501` restores a consumed first-message preamble when `chat:start` rejects or throws. `harness-workflow-request.service.ts:57-62,148-153,412` retains the seed in the pending first send and reapplies it before retry if the tab lacks one. `tab-persistence.ts:112-120,235-247` explicitly persists and restores the optional preamble for workflow tabs while sanitizing other tabs. Regression specs: `message-sender.service.spec.ts:867`, `harness-workflow-request.service.spec.ts:254`, `tab-restore-sanitize.spec.ts:41`.
- **S3:** `harness-workflow-request.service.ts:217-226` discards a pending intent if its source tab is gone or the displayed surface is no longer the builder; it preserves a live pending intent. `setup-hub.component.ts:1339-1369,1478-1502` reports a cancelled switch in the existing Hub alert line. Regression specs: `harness-workflow-request.service.spec.ts:171-198`, `setup-hub.component.spec.ts:86`. The router exposes the current surface but no source tab route signal to this service, so a different builder tab on the same surface is not distinguished here; the builder-view lane's `cancelPendingIntent()` teardown handles that case.
- **S5:** `unit5-message-routing.spec.ts:38-65,127-141,236-262,279-297` supplies production's `SURFACE_ACTIVE` factory and verifies the routed handler calls `HarnessWorkflowRequestService.requestAndNavigate` for a valid payload or reports a malformed relay to the Hub. The stale app-state signal assertions were removed.
- **M11:** `harness-workflow-request.service.ts:24,231-244` prefills the existing New Project tab's composer with the new validated intake and returns `resumed`, identifying reuse to callers. The Hub treats `resumed` as a successful handoff (`setup-hub.component.ts:1478,1502`). Regression spec: `harness-workflow-request.service.spec.ts:191`.
- **m3:** A search of `libs/` and `apps/` found no production caller of the old AppState harness workflow signal. Removed its type, signal and three methods from `app-state.service.ts` and their ownership tests from `app-state.service.spec.ts`.
- **M8:** `setup-hub.component.ts:1339-1369` now reports failed card navigation through the existing Hub alert. Regression spec: `setup-hub.component.spec.ts:94`. The intake flow retains its existing intake error and also reports cancellation in the Hub alert.

## Decisions

- **Stale intent:** Options were tab existence alone or tab existence plus displayed surface. `SurfaceRouterService.currentSurface()` is already the service's routing source, so I used both checks. The change is reversible.
- **Same-mode intake:** Options were silent reuse, Hub message alone, or composer prefill with an explicit outcome. Decision D6 names `requestComposerPrefill(text, tabId)` and the source exposes it, so I used prefill plus `resumed`. The change is reversible.
- **Hub feedback:** Options were a new UI element or the existing `hubError` line. D10/D12 require the Hub's visual design to stay intact; I used the existing line. The change is reversible.

## Verification

Added or updated the focused specs above. Tests, Nx, Jest, TypeScript CLI, build and e2e were not run, per the lane instructions. `ptah_get_diagnostics` was called after edits, but its TypeScript compiler did not finish within the tool's 45-second window and returned `unchecked`, so diagnostics provide no pass result.

## Clarifications Needed

None.
