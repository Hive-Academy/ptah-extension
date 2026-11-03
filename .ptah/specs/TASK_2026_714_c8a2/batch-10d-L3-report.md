# Batch 10d.L3 report

## Decisions

- `ChatSessionService` starts Codex chat through `sdkAdapter.startChatSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1495-1506`). The native `CodexChatAdapter` gets the real thread ID and invokes the session ID callback during open (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:277-290`). The `RoutingAgentAdapter` forwards callback registration to both runtimes (`libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:177-182`), and `wireSdkCallbacks` forwards the resolution to `AgentProcessManager.resolveParentSessionId` (`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:190-285`). Thus Codex does emit and wire the remap. The gap is timing: resolution precedes a later lane spawn, while the manager originally remapped only lanes already tracked (`agent-process-manager.service.ts:1950-1965`).
- `TOKENS.AGENT_ADAPTER` is already bound to the shared `RoutingAgentAdapter` when native Codex is composed (`libs/backend/agent-sdk/src/lib/di/register.ts:1114-1126`). Its `isSessionActive` and `sendMessageToSession` choose the native adapter for an owned Codex session (`routing-agent-adapter.ts:127-135,218-230`). The notifier and report router already call these methods (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:378-435`; `agent-report-router.service.ts:301-351`). No DI registration or guard change is needed.
- Native Codex rejected the `origin: peer` option supplied by both paths (`codex-chat-adapter.ts:554-579`), so fixing the parent alone would still refuse delivery. The native stream now emits the same user `message_start` with `inboundPeer`, `text_delta`, and `message_complete` sequence used by Claude's user message transformer (`libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts:131-170`).
- The manager retains the tab-to-session mapping for future spawns and clears it on disposal. This preserves the existing Claude remap and blank-ID guard.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:309,820,1030,1950-1965,2456`: remember resolved parent IDs, apply them at both lane spawn entry points, and clear the map on disposal. Existing tracked lanes are still remapped.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:484,554-589`: parse peer origin with Zod, accept it for native follow-up sends, and pass its label into the turn stream.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:110-115,256-287`: publish the delivered lane/report text as a named peer message in the native chat stream before the Codex response.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:2,38-74`: validate and pass the resolved parent session ID into outcome recording, or null when absent/invalid.
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:157`: persist the supplied parent ID in `lane_outcome_records`.

## Specs

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts:3749-3779`: resolved Codex tab ID before a late CLI lane spawn and before an SDK-handle spawn; assert the real parent ID and emitted spawn event.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:288-321`: send a lane completion message with peer origin to a native Codex chat; assert named peer message events and forwarded turn text.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts:146,270-278`: assert null outcome parent with no recorded parent and the real parent with a delivered completion. Existing specs cover active-parent delivery, Claude-compatible peer origin, and `no-parent-recorded` refusal.
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts:131-140`: assert the parent ID survives persistence.

## Evidence and unmet requirements

- Reviewed the changed source, existing routing/notifier contracts, and file encoding. All edited TypeScript files retain their original LF or CRLF style and UTF-8 without BOM. `rg.exe` was access denied, so read-only search used PowerShell `Select-String`.
- No checks, tests, typecheck, lint, Nx, build, real Codex server, or network/model call were run, per the task's hard rules. Runtime end-to-end behavior therefore remains for the coordinator to verify. Specs cover the chain in layers rather than one integrated process test.
- Skill discovery returned no invocable matching skill in this lane; Ptah workspace analysis was available and used.

## Files touched

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts`
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts`
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-10d-L3-report.md`
