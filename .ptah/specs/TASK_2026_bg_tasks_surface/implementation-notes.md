# Implementation Notes — TASK_2026_bg_tasks_surface

## Files changed

- `libs/shared/src/lib/types/execution/stream.ts` — Adds the snapshot event discriminator.
- `libs/shared/src/lib/types/execution/stream-background.ts` — Defines the task entry and flat snapshot event in the shared union.
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` — Exports the installed SDK snapshot type and adds its guard.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts` — Converts each SDK snapshot into one flat event and filters ambient tasks.
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` — Dispatches snapshots before the unknown-message fallback.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts` — Covers emitted, filtered, and empty snapshots.
- `libs/frontend/chat-streaming/src/lib/background-task.store.ts` — Stores replacement snapshots by session.
- `libs/frontend/chat-streaming/src/lib/background-task.store.spec.ts` — Covers replacement, empty-list, and session-clear behavior.
- `libs/frontend/chat-streaming/src/index.ts` — Exports the task store.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts` — Routes snapshots to the store without execution nodes.
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts` — Clears task state when a session is closed or reset.
- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.types.ts` — Adds the separate task kind and label.
- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts` — Provides a task glyph.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts` — Builds running task rows, excluding SDK agent task kinds.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.service.ts` — Reads the owning session's task snapshot.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.spec.ts` — Covers the task row and valid tab statuses.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` — Includes task rows in the inspector list.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` — Includes task chips in the dock groups.

## Design

`background_tasks_snapshot` carries `sessionId`, a non-rendered `messageId`, and replacement `tasks` with `taskId`, `taskType`, `description`, and `status: 'running'`. The installed SDK snapshot has no tool-use ID, start time, or per-task status. Ambient entries are excluded before emission. The signal store replaces only the named session; an empty list removes it. Roster rows use kind `task`, keys `task:<taskId>`, and names `<taskType>: <description>`. SDK `local_agent` and `local_workflow` entries retain their existing agent surfaces.

## Verification

Command: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/chat-streaming,@ptah-extension/chat-routing,@ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas`

First run: 21 tasks selected; 20 succeeded, 1 failed. A follow-up diagnostics check found an invalid tab status in the new roster test; that test and two preexisting cases in the same spec now use `streaming`.

Second run: 21 tasks selected; 20 succeeded (16 cached), 1 failed. The sole failure was `@ptah-extension/agent-sdk:test`: two existing plugin-loader specs hit Windows `EPERM: operation not permitted, symlink` (`plugin-loader.service.session-notice.spec.ts:220` and `plugin-loader.service.capabilities.spec.ts:324`). Jest reported 212 suites passed, 2 failed, 2 skipped; 5,151 tests passed, 2 failed, 5 skipped. No selected lint or typecheck task failed. Scoped Ptah diagnostics found no errors in the edited roster spec; it reported unrelated sibling diagnostics.

## Decisions

- **Snapshot status:** Use `running` for every included task. Alternatives were inferring state from lifecycle edges or adding another event. The installed SDK declares the snapshot as the full live set with ID/type/description/ambient only; reversible.
- **Agent exclusion:** Filter `local_agent` and `local_workflow` only at roster projection. The existing `isAgentTaskType` denylist treats `mcp_task` as an agent, while the SDK describes it as MCP work; reversible.
- **Transport:** Reuse flat `CHAT_CHUNK` delivery. No new RPC or DI registration is needed; reversible.
- **Lifecycle:** Retain snapshots across turn completion because background work can outlive a turn; clear on empty SDK snapshot and session close/reset; reversible.

## Not done

- No visual runtime inspection: the task prohibits serve and e2e targets.
- Host app targets were not run; the task limits verification to changed projects.
- An all-green verification run remains blocked by Windows symlink permissions in two existing plugin-loader tests. Those tests were not changed.
- The host exposed no skill-loading tool, so the assigned Angular skill could not be loaded.

