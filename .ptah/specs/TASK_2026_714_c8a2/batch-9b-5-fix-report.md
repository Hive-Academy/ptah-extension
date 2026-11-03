# Batch 9b-5 fix report (revise round 1)

## Changes

### 1. Serious — lifecycle publication was unguarded and ran before settle

`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:280-316` adds `publishLifecycle`, which catches a publisher throw and logs it with `deps.logger.warn` (`prompt-lifecycle-listener-threw`), the same isolate-and-log shape as `SdkPermissionHandler.emitLifecycle`. `takePrompt` (`:308-316`) clears the timer and drops the pending entry before any native reply or `resolved` event.

`codex-chat-host-ports.ts:598-619` publishes `requested` through that guard, then arms the 60s timer only when the entry is still pending. The timer takes the entry, sends the native decline, then publishes `resolved`. A throwing `requested` publisher cannot skip the timer or the card (`:622-624` still broadcasts). A publisher that answers inside `publish` cannot send a second native response, because the entry is already gone and the timer is not armed.

The same take-then-native-then-publish order is used for delivery failure (`:628-631`), dismiss (`:634-644`), cancel (`:646-659`), and `handlePermissionResponse` (`:663-727`).

### 2. Moderate — system-abort text and the 60s constant were copied

`libs/backend/agent-sdk/src/lib/system-abort-permission-message.ts:7` exports `UNROUTABLE_PERMISSION_TIMEOUT_MS` (60_000). `:14-19` exports `buildSystemAbortPermissionMessage(toolName, internalReason)`.

`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:56-59` imports both. `:1091-1094` builds the deny message with `response.reason || 'Session aborted'`, so the model-facing string stays the same. `libs/backend/agent-sdk/src/index.ts:115-118` re-exports both.

`codex-chat-host-ports.ts:7-8` imports them. `:137-141` builds the timeout reason with the shared function. `codex-chat-host-ports.spec.ts:36-51` exposes the real function through the existing `@ptah-extension/agent-sdk` mock. `:1143-1147` builds the expected reason with that function. `:1226-1228` asserts the text starts with `SYSTEM ABORT — this was NOT a user decision.`

### 3. Minor — teardown left the deny window untested

`codex-chat-host-ports.spec.ts:1414-1431` presents an unroutable prompt, then calls `cancelPrompt` with reason `disposed` and `dismiss`, which is the approval-sink dispose order. Advancing fake timers past 60s adds no native response and no further lifecycle event. `afterEach` still restores real timers.

## Specs added

- `codex-chat-host-ports.spec.ts:1342-1381` — publisher throws on `requested` and on `resolved`. The card is still presented, the sequence is `requested`, native decline, `resolved`, and the native decline happens exactly once.
- `codex-chat-host-ports.spec.ts:1383-1412` — publisher calls `handlePermissionResponse` synchronously from `publish`. One native `accept`, one `resolved` (`allowed`). Advancing the deny window does not add another.
- `codex-chat-host-ports.spec.ts:1414-1431` — session teardown (`cancelPrompt` `disposed`, then `dismiss`) then advance past 60s. No native response and no extra lifecycle event.
- `codex-chat-host-ports.spec.ts:1226-1228` — shared abort text starts with `SYSTEM ABORT — this was NOT a user decision.`

## Decisions

- The builder and the timeout constant live in a sibling module so `sdk-permission-handler.ts` only changes its call site. Claude's wording is the function's return value, not a second copy.
- Publisher failures are logged, matching `emitLifecycle`. That is not a silent swallow, so there is no degradation-audit comment on this catch. The existing decline and respond catches keep theirs.
- A reentrant answer during `requested` removes the entry before the timer is created, so the later window cannot decline a prompt that already has a native response.
- The Jest mock of `@ptah-extension/agent-sdk` now re-exports the real builder and constant. Without that, the host-ports module would import `undefined` under the partial mock.
- No skill in this lane's skill list covers permission-host settlement. None was loaded.

## Not done

- No test, lint, typecheck, build, or diagnostics run. The lane rule forbids them.
- `ptah_agent_report` was not called. Tool search for the `ptah` server returned no tools (only the `tasks` server is connected). The summary is in the lane reply.
- Claude permission specs were not edited. Their expected abort strings are unchanged because the handler now calls the shared builder.
- `chat-runtime-profile.service.ts` was not modified. The review findings were only in the host ports and the copied abort text.
