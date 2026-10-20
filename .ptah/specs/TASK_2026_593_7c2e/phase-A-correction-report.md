# Summary

Corrected N1-N4 in the assigned Angular sources and added or adjusted regression specs. N5 required investigation only; the shared webview root already registers the model refresh provider. No verification command was run, as directed.

## N1 — unchanged attention reconciliation

- Change: `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:81-92` captures the previous live map before clearing and compares new items against it. `libs/frontend/core/src/lib/services/notification.service.ts:95-100` compares action fields by value in the equality guard.
- Specs: `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts:115-122` asserts an unchanged reconciliation neither upserts nor replaces the model item. `libs/frontend/core/src/lib/services/notification.service.spec.ts:62-71` asserts an equal action array neither replaces the notice nor schedules another timer.

## N2 — user Stop projected as failure

- Change: `libs/frontend/chat/src/lib/services/chat-failed-turn-attention.service.ts:23-25` only projects an error pulse when its phase is failed or its terminal reason is present and is not an `aborted_*` reason.
- Spec: `libs/frontend/chat/src/lib/services/chat-failed-turn-attention.service.spec.ts:29-42` includes both aborted reasons and a real failure, then asserts one safe failure notice.

## N3 — unbounded snapshot retry

- Change: `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:44-55,137-154` uses 2s/4s/8s/16s exponential delays, stops after five consecutive failures, emits one fixed exhaustion warning, and resets on success and a visible focus or visibility event. It also prevents a queued reconcile from bypassing the cap.
- Spec: `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts:124-146` uses fake timers to assert five attempts, no further automatic attempts, a private error message absent from logs, and renewed reconciliation on focus.

## N4 — snackbar failure and pending Electron bell

- Change: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:196-198` shows a fixed `Action unavailable` status after dispatch rejects. `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:403-413,447-454` queues an open until the bell mounts and switches to chat to mount it.
- Specs: `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts:67-81` asserts visible safe status. `libs/frontend/chat/src/lib/components/templates/electron-shell.notification-center.spec.ts:25-28` checks the pending-open wiring used by this shell's existing source-composition spec.

## N5 — model refresh provider registration

- Investigation: `libs/frontend/chat/src/lib/services/chat-failed-turn-attention.service.ts:8-10` gates draining on `MODEL_REFRESH_CONTROL`. The provider is defined at `libs/frontend/chat/src/lib/services/chat-store/model-refresh-control.provider.ts:24-34` and registered in `apps/ptah-extension-webview/src/app/app.config.ts:315`; `apps/ptah-extension-webview/src/main.ts:14` bootstraps with that config. Electron copies that same Angular build into its renderer (`apps/ptah-electron/scripts/copy-renderer.js:4,25-29`; `apps/ptah-electron/project.json:319-324`). The CLI is a Node esbuild application, with `apps/ptah-cli/project.json:9-27` naming `apps/ptah-cli/src/main.ts` as its Node entry; it has no Angular webview root to register this provider. No code change or spec was needed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the failed-turn projection gated and filter aborted pulses in that service. | Change tab classification; filter at projection. | Task limits N2 to the projection service; `tab-manager.service.ts:1927-1939` classifies aborted terminal reasons as errors. | Yes |
| Cap retries at five total failed snapshots with four timed retries. | Retry indefinitely; cap attempts. | N3 calls for a small fixed cap and 2s/4s/8s/16s backoff. | Yes |
| Reuse the app shell's pending-open signal pattern in Electron. | Open only when mounted; queue until mounted. | `app-shell.component.ts:192-202,270-280` already uses this pattern. | Yes |
| Keep N5 provider wiring unchanged. | Add another provider; use the shared webview provider. | Webview `app.config.ts:315` and Electron renderer copy path above. | Yes |

## Anything not done

- Tests, typecheck, build, lint, and diagnostics were not run because this lane was instructed to read and edit only while another check runs. The orchestrator owns verification.
- No CLI Angular provider was added because the CLI has no Angular webview root.
