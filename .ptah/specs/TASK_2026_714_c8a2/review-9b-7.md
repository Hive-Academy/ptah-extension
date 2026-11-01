## Verdict

REVISE — 6/10

Review family: kimi-code. Implementer family: grok.

The normal native start path and the resolved-identity failure paths match the batch contract. Two serious resume defects remain. The bridge prepares a bound session without its runtime identity. It also treats identity lookup failures as Claude sessions, which permits the forbidden new-session fallback.

## Findings

1. **Serious — Bound sessions get a start-time runtime decision instead of a resume decision.**
   - **Location:** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:487`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:738`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:742`
   - `prepareTurn` receives only the workspace root. Its `resolveExecutionProfile` call omits `existingIdentity`, even when `conversation.ptahSessionId` is set. The resolver therefore takes the new-session branch at `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:190-197`.
   - **Failure scenario A:** A conversation is bound to a Claude session. The workspace now selects Codex and the gateway capability is on. The bridge selects `codex-app-server`, a Codex model, and no provider profile at `gateway-chat-bridge.ts:748-755`. `RoutingAgentAdapter.resumeSession` still routes the stored Claude identity to the legacy adapter at `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:119-123` and `:218-226`. The Claude adapter then uses the ambient auth environment because `providerProfile` is undefined at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1337-1340`. This can resume with the wrong provider credentials or proxy. It also passes the Codex-selected model to a Claude resume.
   - **Failure scenario B:** A conversation is bound to a native session. The workspace provider changed away from Codex. The bridge builds a Claude provider profile and can start its proxy before the native adapter routes by stored identity. The native host port validates the resume again at `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:408-431`, but that later check cannot undo the wrong bridge decision, proxy side effects, or an early auth refusal.
   - **Suggested fix:** Resolve the bound session identity before `prepareTurn`, and pass it as `existingIdentity`. Reuse that identity for the fallback decision so the turn has one consistent runtime view. Preserve the established legacy-Claude behavior for sessions without native metadata. Add specs for both scenarios above.

2. **Serious — Identity lookup failure fails open to the new-session fallback.**
   - **Location:** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:893-906`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:957-972`, `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1056-1075`
   - `boundSessionIsNative` returns `false` when the lookup is absent or throws. A failed native identity read is therefore treated as proof of a Claude session. This contradicts the requirement that a native bound session never falls back to a new session.
   - **Failure scenario:** A native session has missing or inconsistent runtime metadata. `resolveSessionRuntimeIdentity` can throw for that state at `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts:35-58`. The resume fails. The bridge catches the error, repeats the failed lookup, gets `false`, and calls `startNew`. The first event from the replacement session can rebind the conversation at `gateway-chat-bridge.ts:1020-1024` and `:1101-1108`. The user loses the native thread binding instead of getting one error reply with the binding kept. A D14a refusal can take the same fallback when the identity lookup fails.
   - **Suggested fix:** Make identity lookup errors fail closed for fallback. Allow the legacy fallback only for a session established as Claude under the legacy-metadata contract. Do not convert an unknown or failed native identity read into `false`. Add specs for a throwing lookup and for the chosen absent-lookup policy. Assert no start, one reply, and an unchanged binding.

## Checked

- Gateway-off start keeps the Claude provider profile. The native start carries `consumer`, `runtime`, no provider profile, the MCP flag, and the `gw-` tab id. See `gateway-chat-bridge.native.spec.ts:412-474`.
- Claude start and resume fields are otherwise unchanged. Start adds `consumer` and `runtime`; resume adds only `consumer`. See `gateway-chat-bridge.ts:909-949`.
- With a working native identity lookup, generic resume failure and zero-event streams do not call `startNew`. The specs assert one reply and a kept binding at `gateway-chat-bridge.native.spec.ts:476-529`.
- D14a detection uses the typed error, its `cause`, or the typed adapter code. It uses no message matching. See `gateway-chat-bridge.ts:165-173` and `:578-596`.
- Cancellation is checked before D14a handling and before fallback. See `gateway-chat-bridge.ts:579-580` and `:1054-1056`. The existing watchdog regression spec covers the no-retry behavior at `gateway-chat-bridge.spec.ts:1572-1661`.
- Permission notices use the published lifecycle channel and the `gw-` routing hint. See `gateway-chat-bridge.native.spec.ts:531-589`.
- The four deleted adapter and sink files have no remaining references under `apps/` or `libs/`.
- No tests, lint, typecheck, build, Nx command, or diagnostics ran. The review was read-only as required.
