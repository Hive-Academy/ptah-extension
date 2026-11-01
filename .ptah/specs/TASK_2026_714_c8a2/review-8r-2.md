Verdict: REVISE
Score: 7/10
Review family: kimi-code (reviewer) / grok (implementer)

## Defects

1. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1450` — **High** — the activated-resume path does not display the refusal.

   The service puts the fixed text in `activationError` and returns `success: true` at `chat-session.service.ts:1474-1500`. `SessionLoaderService` only handles `activated === true` at `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1015-1021`. It never reads `activationError`. The success path replays history and resolves at `session-loader.service.ts:1066-1150`. The rewind caller displays an error only when `switchSession` rejects at `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1801-1809`. The user therefore receives no refusal text on this path.

   **Concrete fix:** For only this refusal on `activate: true`, propagate an uncoded thrown RPC error with `CODEX_RESUME_PROFILE_CHANGED_MESSAGE` through `ChatRpcHandlers`. This makes the existing `switchSession` rejection carry the fixed text to `showActionError`. Keep other activation failures and Claude behavior unchanged. Update the assertion at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:698-705`, which currently pins the silent `success: true` result.

## Notes

- Start and continue display the uncoded text. `sendFailureMessage` returns `result.data.error` at `libs/frontend/chat/src/lib/services/message-sender.service.ts:155-167`. The start and continue call sites are at `message-sender.service.ts:567` and `:847`. `MessageDispatchService` appends that text to the transcript at `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:250-252` and `:418-428`.
- Continue auto-resume uses the same helper at `chat-session.service.ts:1958-1959` and returns its result at `:1294-1295`. Rewind auto-resume preserves the text at `:1695-1699`. Its handler throws it at `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1522-1524`, and the rewind UI displays RPC errors at `chat-view.component.ts:1653-1655` and `:1733-1737`.
- Real adapter failures keep `CODEX_RUNTIME_FAILED` at `chat-session.service.ts:657-665`. Existing cases at `chat-session.native.spec.ts:764-790` still assert the code for start, activated resume, and continue.
- Refusal logging is not lost. The runtime logs at `libs/backend/codex-runtime/src/lib/codex-runtime.ts:51-54`, and the adapter logs at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:798-802`. Activated resume also retains its warning at `chat-session.service.ts:1453-1461`.
- The changed spec has `import 'reflect-metadata';` first. The added code contains no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, pending real timers, or invalid typed result literals. The asserted union result shapes are valid in this reading.
- No tests, typecheck, lint, build, or diagnostics ran, as required by the review restrictions.
