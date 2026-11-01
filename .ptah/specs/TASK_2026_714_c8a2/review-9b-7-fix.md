## Verdict

REVISE — 8/10

Review family: kimi-code. Implementer family: grok.

The fix closes both original findings for valid session bindings. The decided policies for lookup failure, absent metadata, absent lookup service, and fresh conversations match the main chat path. One malformed-binding path still fails open. The new spec file also retains forbidden double assertions.

## Findings

1. **Medium — A malformed bound session id still takes the new-session branch and can rebind the conversation.**
   - **Location:** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1024`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:933`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1126`
   - `readBoundSessionIdentity` treats an invalid nonempty id like a fresh conversation. It returns no `existingIdentity`. With native gateway startup enabled, the resolver can select `codex-app-server` before the bridge validates the binding again.
   - This state is representable. `ConversationStore.setPtahSessionId` accepts an arbitrary string at `libs/backend/messaging-gateway/src/lib/conversation.store.ts:100-108`. The bridge also persists `event.sessionId` without validation at `gateway-chat-bridge.ts:1087-1090` and `gateway-chat-bridge.ts:1169-1175`. A malformed adapter event or an older persisted row can therefore supply the binding.
   - **Failure scenario:** A conversation has a non-UUID binding. Preparation selects native Codex. `openStream` then throws in `SessionId.from`. `tryFallbackStart` allows `startNew` because `boundIdentity` is undefined. The replacement stream can overwrite the binding. This violates the boundary between a fresh conversation and an existing bound conversation.
   - **Suggested fix:** Return no identity only when `sessionId` is absent. Return `{ ok: false, error }` when a nonempty id fails `SessionId.validate`. Reuse the existing fail-closed reply path. Add a spec with a malformed binding and native startup enabled. Assert no profile resolution, no resume, no start, one reply, and an unchanged binding.

2. **Low — The new spec file contains forbidden `as unknown as` assertions.**
   - **Location:** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts:91`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts:409`
   - **Failure scenario:** The constructor assertion can hide an invalid harness dependency shape after a constructor change. The spec then loses the type check that should expose the stale double. These assertions also violate the stated review gate.
   - **Suggested fix:** Type the logger and constructor doubles against their consumed interfaces. Remove both double assertions instead of replacing them with another unchecked assertion.

## Checked

- **Original finding 1 is closed.** `readBoundSessionIdentity` runs before `prepareTurn` at `gateway-chat-bridge.ts:511-536`. `prepareTurn` forwards the same identity as `existingIdentity` at `gateway-chat-bridge.ts:793-805`. `openStream`, D14a handling, and fallback use that same turn identity.
- **Original finding 2 is closed.** A throwing lookup returns an error at `gateway-chat-bridge.ts:1031-1039`. The turn stops before profile resolution or session startup at `gateway-chat-bridge.ts:515-529`. It sends one generic reply and does not write the binding.
- The legacy Claude identity has the same empty-metadata shape as `storedChatRuntimeIdentity`. Its `claude-sdk` runtime prevents the resolver's new-session native branch. Absent lookup service and undefined metadata both retain the legacy fallback.
- A fresh conversation omits `existingIdentity`. This matches the resolver contract at `workspace-provider-profile-resolver.ts:190-197` and the main resume path at `chat-session.service.ts:1869-1904`.
- The legacy Claude spec and stored-native spec assert the profile identity, model, provider profile, and absence of a replacement start. The throwing-lookup spec asserts fail-closed behavior and an unchanged binding. The absent-lookup spec asserts the permitted fallback. The fresh-conversation spec asserts that the property is absent.
- The four resume-policy specs would fail on their respective defective paths. The fresh-conversation spec is a regression guard. It would also pass on the old fresh path, which was already correct.
- Cancellation guards remain before D14a handling and fallback. D14a detection remains typed. MCP fields, lifecycle notices, the watchdog, and the preparation deadline remain present.
- The specs add no fake timers or persistent real timers. The only new timer helper awaits a zero-delay timer. Production timers are cleared on their existing paths.
- Error logs receive real `Error` objects on the new failure paths. No `any`, `@ts-ignore`, or `eslint-disable` appeared in the changed bridge or new native spec. The two double assertions are reported above.
- No tests, lint, typecheck, build, Nx command, or diagnostics ran. This review was read-only as required. The new specs remain unexecuted.
