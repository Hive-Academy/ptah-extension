# B4a revise round 1

## Findings and evidence

| Finding | Fix and source | Regression spec |
| --- | --- | --- |
| B1 saved drafts counted as active | `harness-session.controller.ts:130-138` excludes the mode's draft pointer from `activeSessionIn`, matching `findRunningTab`. | `does not count a saved team draft as an active cross-mode session` |
| S1 stale record on pre-tab failure and restore | `harness-session.controller.ts:173-181` resets record, phase and error before start; `:336-358` clears the record for missing and wrong-mode restore outcomes. The request service only routes a failed start to the tab in the current record. | `clears a stale record before a pre-tab start failure and on missing or wrong-mode restore`; `reports a pre-tab start failure on the hub without navigating to a stale tab` |
| S2 concurrent starts | `harness-session.controller.ts:155-171` serializes starts per workspace, then rechecks the active session after the first finishes. | `serializes concurrent starts before tab creation`; `serializes concurrent cross-mode starts in the same workspace` |
| S3 thrown send leaves a false accepted bubble | `harness-session.controller.ts:241-275` captures a newly added user bubble on both rejected and thrown sends; reconcile excludes that bubble and Retry removes it. | `marks an optimistic bubble failed when send throws, then Retry sends again` |
| M2 failed navigation after start | `harness-workflow-request.service.ts:297-303` calls controller `leave('discard')` after a newly started session fails to navigate; an uncertain stop is reported on the hub and preserves the session. | `discards a newly started session when navigation fails`; `reports an uncertain stop when failed navigation cannot discard the session`; `discards a stopped session with its tab and record` |
| M3 abort of idle or finished session | `harness-session.controller.ts:399-408` returns stopped for a loaded, completed, or unsent idle tab before calling `chat:abort`. | `does not abort a loaded finished session` |
| M4 silent apply receipt write failure and timestamp | `harness-session.controller.ts:97-111` sets a UI-safe error and logs a failed write; `harness-builder-records.service.ts:130` accepts ISO timestamps with offsets. | `surfaces an apply receipt write failure and persists offset timestamps` |
| M5 failed bubble lifecycle | `harness-session.controller.ts:114-121,145-152,287-301,337-358,443-446` clears failed bubble entries when a tab closes, is discarded, or reconciles successfully. | `clears failed bubble tracking when its tab is closed`; `marks an optimistic bubble failed when send throws, then Retry sends again` |

## Files changed

- `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts`
- This report

## Decisions

- Serialize starts by canonical workspace root, including cross-mode starts. This prevents two simultaneous modes from creating tabs before either mode is visible. Reversible; the existing cross-mode conflict rule and concurrent start tests support it.
- Treat a loaded tab as finished for stop. The tab status is the existing host signal for completed work. Reversible; the stop regression spec covers it.
- On navigation failure, attempt the controller's existing discard path and surface uncertainty if stopping cannot be confirmed. Reversible; it preserves the established no-discard-on-uncertain rule.

## Verification

- `npm run verify -- -p @ptah-extension/harness-builder,@ptah-extension/onboarding,ptah-extension-webview` — first run: `NX   9 tasks: 5 succeeded, 4 failed`. Three typechecks reported one nullable closure reference in the controller; fixed at `harness-session.controller.ts:261-264`. The fourth failure was the accepted `ptah-extension-webview:lint` cycle. Final rerun: **pending**.
- `npm run verify -- -t lint,typecheck -p ptah-electron` — **pending**.
- `ptah_get_diagnostics` was attempted after edits but returned unavailable after its 45-second compiler timeout. The edited files parsed cleanly with `ptah_ast_analyze`.

## Not done / limits

- The old view's leave handler and unconsumed `stopUncertain` remain B5b work, as directed. No old view files were edited.
- No rendered visual review: application targets are prohibited for this batch, and the user limits visual reviews to Electron.
- `angular-frontend-patterns` could not be loaded because no skill-loading tool was available in this lane; repository patterns and task instructions were used.
