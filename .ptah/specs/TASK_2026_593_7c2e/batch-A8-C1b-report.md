# Batch A8-C1b report

| File:line | Change |
| --- | --- |
| `libs/frontend/setup-wizard/src/lib/services/wizard-internal-state.provider.ts:18` | Removed cross-library focus router imports and registrations. |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.provider.ts:5`; `libs/frontend/setup-wizard/src/index.ts:10` | Exported the setup wizard's own multi provider. |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.provider.ts:5`; `libs/frontend/harness-builder/src/services.ts:31` | Exported the harness builder's own multi provider. |
| `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-router.provider.ts:5`; `libs/frontend/mcp-apps-page/src/index.ts:4` | Exported the MCP apps page's own multi provider. |
| `apps/ptah-extension-webview/src/app/app.config.ts:226,322` | Registered the voice notice handler, three surface routers, and Git status attention in the composition root. |
| `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts:16,23,37,76` | Routed non-Open actions without a live chat item to the first matching notice handler, with the existing key in-flight guard and outcome preservation. |
| `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:20,64,68,88` | Implemented the voice notice action handler; switch succeeds only after provider config refresh succeeds. |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:53,214`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:175` | Removed the old voice toast import, component registration, and template element. |
| `libs/frontend/chat/src/lib/components/molecules/notifications/voice-provider-error-toast.component.ts`; `.spec.ts` | Deleted the obsolete toast and its component spec. |

## Preserve list

| Capability | Current path |
| --- | --- |
| Failure message | Voice notice `context` from `VoiceProviderErrorService.handleMessage` (`voice-provider-error.service.ts:51`). |
| Provider name | Voice notice `title` from `VoiceProviderErrorService.handleMessage` (`voice-provider-error.service.ts:50`). |
| Switch to local | Notice action `switch-to-local` reaches `VoiceProviderErrorService.run` via the attention dispatcher. `switchToLocal` calls `voice:setProviderConfig`, then `voice:getProviderConfig`, resolves on successful refresh, and retains the notice if either call fails. |
| Dismiss | The shared notification presentation provides dismissal; `VoiceProviderErrorService.dismiss` still delegates to `NotificationService.dismissPresentation`. |

## Specs

- `chat-attention-action-dispatcher.service.spec.ts`: handler routing, outcome and stale behavior, and in-flight guard.
- `voice-provider-error.service.spec.ts`: handler ownership, generation rejection, successful switch, failed switch, and failed refresh retention.
- Earlier A8 surface router and tab-less mapping specs remain in place.
- Per batch instruction, no Nx, Jest, or TypeScript command was run. Source references and `git diff --check` were reviewed.

## Decisions

- Each surface owns its own `SURFACE_FOCUS_ROUTER` provider function; the webview composition root collects them.
- `provideGitStatusAttention()` returns `EnvironmentProviders`, so it is added directly to the provider list.
- The voice handler claims only its current notice key and `switch-to-local` action; a mismatched generation is stale. Failed RPCs yield unavailable and keep the notice.

## Not done

- Automated verification is reserved for the orchestrator's parallel lane.
