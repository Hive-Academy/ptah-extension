## Verdict

REVISE — 8/10. The lifecycle isolation, timeout decline, and shared abort text are corrected. Reentrant settlement can still leave an orphaned card, and the teardown spec does not exercise disposal.

## Findings

1. **Moderate — `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:598-624`.** A `requested` publisher can call `handlePermissionResponse` or `dismiss` synchronously. That removes the entry and resolves the native request, but `present` still broadcasts `PERMISSION_REQUEST` unconditionally at line 623. The renderer receives a card for an already settled wire ID; a later answer returns `false`, and no accepted-answer path sends an auto-resolve message to remove that card. The reentrant spec at `codex-chat-host-ports.spec.ts:1383-1412` checks native response count and lifecycle events but not the late card. Skip the broadcast when publication has already settled this ID, and assert that behavior.

2. **Minor — `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:1414-1431`.** The new teardown case calls `cancelPrompt` and `dismiss` directly. It proves those two port calls clear the timer, but it cannot catch a broken adapter/sink disposal hook that fails to make them. The prior request was for a teardown integration case: actual `CodexChatAdapter.close` calls `sink.dispose` (`codex-chat-adapter.ts:628-639`), which in turn settles pending requests through `cancelPrompt` and `dismiss` (`codex-chat-approval-sink.ts:195-225,337-342`). Exercise that disposal path, then advance fake timers and assert no late native reply or lifecycle event.

## Checked

- Read the prior review, fix report, scoped diff, host ports, relevant specs, Claude permission handler, and extracted helper. `publishLifecycle` catches publisher throws and emits a coded warning. `takePrompt` clears the timer and removes both maps before native reply or `resolved`; timeout declines natively once before publishing `resolved`. A throwing `requested` publisher still reaches timer creation and card broadcast. The reentrant spec demonstrates one native accept and one `resolved` event.
- The extracted `UNROUTABLE_PERMISSION_TIMEOUT_MS` remains `60_000`. The builder's return template matches the removed Claude template, including punctuation and interpolation; Claude still supplies `response.reason || 'Session aborted'` and returns `interrupt: false`. The host and spec use the shared builder for timeout text.
- The UUID path still builds its prior payload with `sessionId`, conditional `tabId`, and original `timeoutAt`; it creates no timer or lifecycle event. The UUID spec covers this. The teardown spec advances timers after its direct calls, but does not run actual disposal.
- Read-only review only. No tests, lint, typecheck, build, Nx, diagnostics, or other verification commands were run. The Ptah symbol index had no usable result, and `rg` was denied, so targeted PowerShell reads were used. No invocable skill loader was exposed for this review lane.
