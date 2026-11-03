## Changes

- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:273-278` — optional `SDK_TOKENS.RUNTIME_HOST_CAPABILITIES` (default `{ nativeCodex: false }`) and optional `SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP`.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:166-176` — D14a detection via `isCodexResumeProfileChangedError` (error or `cause`) or `isCodexChatAdapterError` with code `resume-profile-changed`.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:568-599` — native D14a sends `CODEX_RESUME_PROFILE_CHANGED_MESSAGE` through `sendErrorQuietly` and returns. Binding is not cleared.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:738-766` — `prepareTurn` calls `resolveExecutionProfile({ workspacePath, requestedModel, consumer: 'gateway', hostCapabilities })`. Claude result keeps that model and provider profile. Native result uses `seed.model`, `runtime: 'codex-app-server'`, and no provider profile. `TURN_PREPARATION_DEADLINE_MS` and `AuthRequiredError` are unchanged.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:874-948` — resume config sets `consumer: 'gateway'` on both resume sites. Start config sets `consumer: 'gateway'` and `runtime`. A native persisted resume rethrows instead of calling `startNew`.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:957-973` — native means `resolveSessionRuntimeIdentity(...).runtime === 'codex-app-server'`. No lookup, a non-UUID id, or a logged lookup failure stays on the Claude fallback.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1056-1060` — `tryFallbackStart` still returns before any retry when the turn is cancelled, and returns with no `startNew` when the bound session is native. Other native failures then use the existing generic error reply.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts:441-462` — harness `resolveExecutionProfile` returns a Claude profile by awaiting the existing `resolveProviderProfileForWorkspace` mock, so prior call-count and `AuthRequiredError` specs still reach that mock. Constructor argument list is unchanged.

`libs/backend/gateway-chat-bridge/src/index.ts` and `libs/backend/gateway-chat-bridge/src/lib/di/register.ts` were not modified. `package.json` still depends on `@ptah-extension/codex-runtime` and `@ptah-extension/agent-sdk`.

## Deleted

Deleted (P9-6 / D25):

- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts`

Grep evidence before deletion: `CodexGatewayAdapter` / `CodexGatewayApprovalSink` and the two filenames occurred only in those four files (class bodies and the two spec imports). No matches under `apps/`. `src/index.ts` exports `GatewayChatBridge`, `ConversationQueue`, tokens, and `registerGatewayChatBridge` only. `di/register.ts` registers `GatewayChatBridge` only.

Grep evidence after deletion: workspace search for `CodexGatewayAdapter`, `CodexGatewayApprovalSink`, `codex-gateway-adapter`, and `codex-gateway-approval-sink` in `*.ts`, `*.json`, and `*.md` returned no matches.

## Specs added

`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts`

- `:412` gateway capability off → `resolveExecutionProfile` consumer `gateway`, legacy start with provider profile, `runtime: 'claude-sdk'`, `gw-conv-42`, MCP flag true, no direct `resolveProviderProfileForWorkspace` call.
- `:444` gateway capability on → `runtime: 'codex-app-server'`, `consumer: 'gateway'`, seed model, `providerProfile: undefined`, MCP flag kept, `gw-` tab id.
- `:476` native resume failure → no `startChatSession`, one generic error reply, `setPtahSessionId` not called, stored id unchanged.
- `:497` `CodexResumeProfileChangedError` → one `CODEX_RESUME_PROFILE_CHANGED_MESSAGE` reply, no `startNew`.
- `:515` native stream with zero events → no `startChatSession`.
- `:531` published lifecycle event: non-`gw-` hint sends nothing; `gw-conv-42` requested and timed-out notices still fire through `onPromptLifecycle`.

## Decisions

- One runtime decision is `resolveExecutionProfile`. The bridge does not call `resolveProviderProfileForWorkspace` itself. Native turns pass no provider profile.
- `requestedModel` is the value already returned by `resolveStoredModel`. `requestedModelIsStored` is omitted so the Claude branch does not resolve the stored model a second time.
- Native start model is `decision.seed.model`.
- D14a user text is the exported `CODEX_RESUME_PROFILE_CHANGED_MESSAGE`, not a separate “Run /new” string.
- A session is native only when the optional lookup’s stored runtime is `codex-app-server`. Claude sessions keep the new-session fallback.
- Permission notices stay on the existing `onPromptLifecycle` subscription (`gateway-chat-bridge.ts` start/`onPermissionPrompt`). The spec publishes into that listener.
- No matching skill in the session catalog covers this bridge change. No UI skill was loaded.
- The new spec uses `as unknown as` at `:91` and `:375` to pass fakes into a constructor whose parameters are classes with private fields. That matches the existing spec harness.

## Not done

- Did not run `npm run verify -- -p @ptah-extension/gateway-chat-bridge`, Jest, lint, or typecheck. The lane forbade those commands and `ptah_get_diagnostics`.
- No separate spec for a watchdog-cancelled native turn. `tryFallbackStart` still returns at the cancellation check (`:1056`) before `startNew`.
- `ptah_agent_report` was not on the connected tool list (connected MCP server was `tasks` only).
