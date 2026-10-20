# Batch C1 chat notice migration report

Status: **partial**. The shared attention dispatcher must route the voice action before the old toast can be deleted.

| Change | File:line |
| --- | --- |
| ActionBanner errors and warnings publish transient failure/warning notices with tab and workspace context; info remains local | `libs/frontend/chat/src/lib/services/action-banner.service.ts:71`, `:80`, `:95`, `:124` |
| Chat view keeps the local info banner and removes the local error presentation | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:355`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:130` |
| Voice push publishes a failure notice with provider, sanitized message, and Switch to local action | `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:35` |
| Service owns the switch RPC, config refresh, success resolution, and failed-switch state | `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:65` |

## Preserve list

| Old toast capability | Current location and status |
| --- | --- |
| Failure message | Attention notice `context` in `voice-provider-error.service.ts:52`; old toast remains mounted. |
| Provider name | Attention notice `title` in `voice-provider-error.service.ts:51`; old toast remains mounted. |
| Switch to local via `voice:setProviderConfig`, then `voice:getProviderConfig` | `voice-provider-error.service.ts:65` implements the RPC and resolves the notice on success. The old toast at `chat-view.component.html:175` still has the usable button. The snackbar and Recent button are **not wired** to this method. |
| Dismiss | `voice-provider-error.service.ts:59` dismisses the snackbar presentation; the old toast still provides its close button. |

## Specs added or changed

- `libs/frontend/chat/src/lib/services/action-banner.service.spec.ts`: checks attention projection for error/warning and local-only info.
- `libs/frontend/chat/src/lib/services/voice-provider-error.service.spec.ts`: checks notice payload, switch RPC, success resolution, and failed-switch retention.
- No test, typecheck, Nx, or Jest command was run, per batch verification instruction.

## Decisions

- Kept the old voice toast component, spec, import, and template placement because its removal is conditional on the shared snackbar and Recent action working. `ChatAttentionActionDispatcherService` dispatches non-open actions only through live permission requests and is outside C1 ownership; the `switch-to-local` notice action currently returns stale. It needs an owned follow-up in that dispatcher or an action handler extension in the core presenter.
- ActionBanner failure and warning notices have no badge count because `NotificationService` counts request kinds only. They have no host-notification path.

## Not done

- Voice action dispatch from snackbar and Recent; therefore deletion of `voice-provider-error-toast.component.ts` and its spec, and removal of its chat view import/template usage.
- Existing toast success still dismisses its own signal rather than resolving the newly published Recent notice. The dispatcher integration should move its click to `VoiceProviderErrorService.switchToLocal` before deletion.
- Orchestrator verification remains pending.
