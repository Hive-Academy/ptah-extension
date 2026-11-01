# Background Task Surface Fix Notes

## Fixes

1. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1111` admits `background_tasks_changed`; `stream-transformer.spec.ts:1546` exercises the live allowlist and yielded snapshot.
2. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:80` treats snapshots as store-only; `streaming-handler.service.spec.ts:422` checks session routing and that no streaming state is created.
3. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1240` emits an empty terminal snapshot after a query that produced task snapshots; `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:737` clears on confirmed session end, and `libs/frontend/chat-routing/src/lib/stream-router.service.ts:959` clears on non-force surface close. `CHAT_COMPLETE` still keeps tasks while the SDK process runs.
4. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:167`, `agent-dock-menu.component.ts:99`, and `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-row.component.ts:38` disable task controls; `inspector-agents-section.component.ts:336` refuses task navigation. Task rows have no steer/stop tray.
5. `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.service.ts:87` documents that `turn_state.backgroundTasks` drives phase only; the SDK snapshot supplies task rows, so the two values do not render duplicate task lists.
6. `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:199` uses the shared `isAgentTaskType` guard; `session-agent-roster.spec.ts:22` checks that a `remote_agent` snapshot does not become a task row.
7. `libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts:446` covers replacement, no tree node, and `skipStoreEffects`; `streaming-handler.service.spec.ts:422` covers session matching and no phantom state; `stream-router.service.spec.ts:1497` and `chat-message-handler.service.spec.ts:192` cover clearing while preserving tasks on ordinary turn completion; `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts:129` covers missing owner.

## Checks run

- Scoped `ptah_get_diagnostics(files: [...changed files], severity: "error")` was attempted in several small groups after edits. Each returned `Unavailable: TypeScript check still running after 45s`; no type-check result was available.
- Prettier was not run; no test, lint, typecheck, build, or verification command was run, as instructed.

## Decisions

- **Process cleanup:** Chose an empty terminal snapshot plus confirmed `CHAT_SESSION_ENDED` cleanup, and kept ordinary `CHAT_COMPLETE` intact. The SDK describes snapshots as process-scoped; a frontend session-end clear also covers a consumer that stops iterating before the generator's final yield. This is reversible.
- **Task identity:** Chose the existing shared `isAgentTaskType` guard over a second UI-specific type list. The shared guard already defines which SDK task types represent agents. This is reversible.
- **Task display:** Chose the live SDK snapshot as the sole roster source. `turn_state.backgroundTasks` remains a turn-phase signal and no UI task list reads it. This is reversible.

## Not done

- CI verification remains outstanding by request. The diagnostics service did not complete a scoped TypeScript check; no pass is claimed.
- The coordinator's `libs/backend/rpc-handlers/src/lib/handlers/subagent-history-page.ts:29` edit was left untouched.
