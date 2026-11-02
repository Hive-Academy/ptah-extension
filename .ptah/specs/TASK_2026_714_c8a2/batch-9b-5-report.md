## Changes

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:134` — `prepare()` passes `config.consumer ?? 'chat'` into `resolveExecutionProfile`. Absent stays chat.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.spec.ts:190` — gateway consumer is forwarded; an omitted consumer is still `chat`.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:85` — optional `promptLifecycle.publish`. Not bound here.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:135` — `UNROUTABLE_PERMISSION_TIMEOUT_MS = 60_000`.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:141` — Claude system-abort reason, with the timer's internal reason.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:147` — `withoutRuntimeConsumer` so `consumer` is not rejected as a thread option.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:353` and `:413` — `checkOptions` / `profile` classify the config without `consumer`. When `input.consumer` is set, `prepare()` still receives it.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:482` — execution profile `consumer` is `input.consumer ?? 'chat'`.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:533-653` — non-UUID `TabId.safeParse` tab: unroutable card (no `sessionId` / `tabId`), `timeoutAt = min(expiresAt, now + 60_000)` (absent expiry uses the 60s end), `requested` / `resolved` lifecycle, deny-window timer that declines through the existing D19 path. UUID tab keeps `timeoutAt: request.expiresAt ?? 0`, no timer, no lifecycle. `settle` clears the timer on answer, dismiss, cancel, replacement, and delivery failure.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:58` — harness presentation tab is a UUID so existing cards stay routable. `:1081` publish expectation follows that tab. `:1084-1348` gateway consumer, `ptah` MCP on `gw-`, and fake-timer unroutable specs.

## Claude parity

Copied from `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (read only; not edited):

- Deny window `60_000`: line 90 (`UNROUTABLE_PERMISSION_TIMEOUT_MS`). Unroutable when neither session nor tab is a UUID: lines 877-891. `timeoutAt = start + denyWindow` when the window is set: line 932.
- Card fields are `id`, tool name, tool input, `toolUseId`, timestamp, description, `timeoutAt`. `sessionId` / `tabId` are only the branded UUID values, so a `gw-*` tab sends neither: lines 961-972. `sdk-query-options-builder.ts` (cited in batches.md at 1214) is not in this worktree; the handler is the payload source.
- `requested` lifecycle (`routingHint`, `routable: false`, `timeoutMs`): lines 125-134 and 936-944.
- `resolved` outcomes `allowed` / `denied` / `timed-out` / `aborted`: lines 136-141 and 1018-1031.
- Timeout internal reason: lines 1282-1288. System-abort text wrapped around that reason, `interrupt: false`: lines 1083-1098. Codex sends that full string as the D19 `decline` `reason` (not `cancel`).

## Specs added

- `chat-runtime-profile.service.spec.ts:190` — gateway vs absent consumer.
- `codex-chat-host-ports.spec.ts:1084` — default profile consumer `chat`.
- `codex-chat-host-ports.spec.ts:1089` — gateway start, `mcpServerRunning`, `ptah` URL `/session/gw-conversation/...`, resolver consumer `gateway`.
- `codex-chat-host-ports.spec.ts:1113` — `consumer: 'gateway'` is not an unsupported thread option.
- `codex-chat-host-ports.spec.ts:1154` — UUID tab unchanged (`timeoutAt` is `expiresAt`, no timer, no lifecycle) under fake timers.
- `codex-chat-host-ports.spec.ts:1168` — absent, shorter, and longer `expiresAt`: unroutable payload, `min` deadline, `requested`, decline with the system-abort reason, `timed-out`, no second answer.
- `codex-chat-host-ports.spec.ts:1228` — `handlePermissionResponse` by wire id for allow / always_allow / deny / deny_with_message; window does not decline again.
- `codex-chat-host-ports.spec.ts:1255` — cancel first: no decline, outcome `aborted`.
- `codex-chat-host-ports.spec.ts:1274` — dismiss first: no decline, one `aborted`.
- `codex-chat-host-ports.spec.ts:1291` — delivery failure: one reason-less decline, outcome `denied`, timer does not fire.
- `codex-chat-host-ports.spec.ts:1314` — replacement: previous window `aborted`, only the new window times out.
- `codex-chat-host-ports.spec.ts:1328` — no `promptLifecycle` publisher: timeout still declines. Fake timers are restored in `afterEach`.

## Decisions

- Routable means `TabId.safeParse(tabId) !== null`. No `gw-` string check. A non-UUID main-chat tab uses the same deny window.
- `timeoutMs` on the lifecycle event and inside the system-abort reason is the capped window (`min(expiresAt, now + 60_000) - now`), not always 60_000.
- Outcomes: allow / always_allow → `allowed`; deny / deny_with_message → `denied`; timer → `timed-out`; cancel, dismiss, and replacement → `aborted`; delivery failure → `denied` (Claude's undelivered prompt is a plain deny, not `systemAbort`).
- `consumer` is removed before `classifyCodexChatOptions`. Leaving it on the object would throw `unsupported-option` and the gateway profile would never build. MCP attachment is unchanged: `mcpServerRunning` plus the raw tab id still adds the `ptah` HTTP server.
- The spec harness's presentation tab is a UUID. The old `'tab'` default would have become unroutable and left a real 60s timer in existing tests.

## Not done

- Electron does not pass `promptLifecycle` into `createCodexChatHostPorts`. That bind is batch 9b-6 (`publishPromptLifecycle` on `SdkPermissionHandler`).
- No verify, test, lint, or typecheck (lane rule). The coordinator runs `npm run verify -- -p @ptah-extension/rpc-handlers`.
- `libs/backend/agent-sdk` was not edited.
- Ptah MCP tools were not in this session's tool list (`search_tool` for `ptah_agent_report` returned no match; the connected server shown here is `tasks`). The report call is attempted once anyway.
