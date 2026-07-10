# TASK_2026_155 — Gateway Turn Hang Fix (Discord/Telegram/Slack bridge)

## Metadata

- **Type**: BUGFIX
- **Workflow**: Partial (research already complete — root cause diagnosed by orchestrator; Team-Leader → developers → QA)
- **Branch/Worktree**: `fix/gateway-turn-hang` (worktree at `D:\projects\ptah-extension\.claude-worktrees\fix\gateway-turn-hang`, branched from origin/main)
- **cli_delegation**: disabled (autonomous session)
- **Created**: 2026-07-10

## User-Reported Symptom

A Discord message linked to an attached session reached the agent (`hasInitialPrompt: true`), the SDK query started (`Query started for session gw-37b634d4`), the real session UUID bound (`gw-37b634d4 -> 6e7cd4ab`), then **nothing** — no assistant output, no outbound Discord message. Every subsequent Discord message in that conversation did nothing. Log also showed `Permission routing id is not a UUID — falling back to broadcast` and gateway session started with `isPremium: false`.

## Root Cause (diagnosed — do NOT re-investigate)

1. **Gateway sessions start at global `'ask'` permission level.** `SessionQueryExecutor.executeQuery` seeds `rec.permissionLevel` from the GLOBAL `permissionHandler.getPermissionLevel()` (libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:141-146). The bridge has no way to pass an initial level; callers cannot override per session.
2. **The bridge's bypass flip is post-hoc and racy.** `GatewayChatBridge.bindSession` calls `setSessionPermissionLevel(uuid, 'bypassPermissions')` only after the FIRST stream event with a real sessionId arrives (libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:305-333). Any tool call the agent makes before/around that flip hits `'ask'` mode.
3. **Permission prompts for gateway sessions are unroutable but "delivered".** The bridge's tabId `gw-<conversationId>` is not a UUID → `SdkQueryOptionsBuilder` logs the broadcast-fallback warning (sdk-query-options-builder.ts:575-580). `SdkPermissionHandler.sendPermissionRequest` sends to the `ptah.main` webview; the Electron window exists so `delivered=true` and the deny-on-undelivered safety net never fires (sdk-permission-handler.ts:137-166). No chat tab renders the prompt.
4. **`awaitResponse` has no timeout.** `timeoutAt = 0` and the promise only resolves on user response or AbortSignal (sdk-permission-handler.ts:500, 714-744). The canUseTool promise hangs forever → the SDK stream never completes.
5. **`ConversationQueue` has no watchdog.** A never-settling turn wedges the per-conversation serial chain permanently (libs/backend/gateway-chat-bridge/src/lib/conversation-queue.ts:12-28). All later inbound messages queue behind it — the exact reported symptom.
6. **Amplifier**: outbound text is only flushed at end-of-turn (`sealTurn()` → `completeOutboundTurn`), so even streamed text never reaches Discord while the turn hangs.
7. **Separate parity gap (not the hang)**: the bridge never resolves license/premium context; gateway sessions run `isPremium: false` with no enhanced prompts, no plugins, no code-exec MCP. Compare the working webview path: libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:335-395.

## Fix Scope (4 items)

### F1 — Gateway sessions auto-approved from turn one
Add an optional initial permission level to the interactive session-start path (e.g. `permissionLevel?: 'ask' | 'auto-edit' | 'yolo' | 'plan'` on the `startChatSession`/`resumeSession` config, threaded through `SessionLifecycleManager`/`SessionQueryExecutor.executeQuery` to seed `rec.permissionLevel` instead of the global default). Keep the SDK mode mapping via `PERMISSION_MODE_MAP` (yolo → SDK `'default'` so `canUseTool` still runs and auto-approves — see the load-bearing comment in permission-mode-map.ts, do NOT pass SDK `bypassPermissions`). `GatewayChatBridge` passes `permissionLevel: 'yolo'` on both `startChatSession` and `resumeSession`. The racy `setSessionPermissionLevel` call in `bindSession` becomes redundant — remove it (keep the sessionId persistence in `bindSession`).

### F2 — Unroutable permission requests must not hang forever
In `SdkPermissionHandler`: when a permission request has no routable UI surface (no valid session/tab UUID — the broadcast-fallback case), enforce a deny timeout in `awaitResponse` (populate and honor `timeoutAt`; suggest 60s default for unroutable requests). Do NOT change behavior for normally-routed webview requests (users may legitimately take minutes to answer) unless a generous cap is added deliberately. Timed-out requests resolve as deny with a clear reason, cleanup of `pendingRequests`/`pendingRequestContext`, and a log line.

### F3 — Turn watchdog in gateway-chat-bridge
Wrap the turn's stream pump in `runTurn` with a timeout (suggest 10 min default; constant is fine, settings-backed optional). On timeout: abort/end the SDK session (`endSession`), send a short error reply to the platform, seal the turn. Guarantees the `ConversationQueue` chain always settles.

### F4 — Premium parity for gateway sessions
Bridge resolves `isPremium` (license verification + `isPremiumTier`), `enhancedPromptsContent`, and `pluginPaths` the way `chat-session.service.ts` does, and passes them plus `mcpServerRunning` into `startChatSession`/`resumeSession`. NOTE layering: `gateway-chat-bridge` must NOT import `rpc-handlers` (rpc-handlers is app-layer-consumed only). License/FeatureGate live in `vscode-core`; the premium-context resolution used by chat lives in rpc-handlers' chat sub-services — the developer must either use vscode-core services directly or extract a small shared resolver; team-leader to decide placement with an eye on the hexagonal rules in CLAUDE.md.

## Out of Scope

- Session/workspace switching from Discord (separate feature discussion)
- skill-synthesis JSONL read-by-tabId ENOENT noise (`gw-*` sessions invisible to trajectory extraction)
- StreamCoalescer streaming-mode changes

## Verification Expectations

- Unit tests per fix: executor seeds caller-supplied level; permission timeout denies and cleans up; watchdog settles the queue and sends the error reply; bridge passes premium flags.
- Existing suites for agent-sdk, gateway-chat-bridge stay green.
- `npx nx run-many -t test --projects=agent-sdk,gateway-chat-bridge,messaging-gateway` + typecheck + lint on affected projects.
