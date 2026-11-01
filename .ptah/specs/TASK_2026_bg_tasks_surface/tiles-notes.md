# Background task tiles

## Reverted (files)

- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.types.ts` and `agent-avatar.component.ts`: removed task kind, label, and glyph.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` and `agent-dock-menu.component.ts`: removed task chips and task-specific selection handling.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` and `inspector-agent-row.component.ts`: removed task rows and task navigation handling.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts` and `session-agent-roster.service.ts`: removed background task inputs, rows, and store injection.
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.spec.ts`: removed the task-row test; kept the prior streaming-status corrections needed by remaining tests.
- The eight reverted source files have an empty git diff against main.

## Added (files + one line)

- libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles.component.ts: presentational, focusable task tiles and stacked overflow tooltip.
- libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles-container.component.ts: resolves the tab's claudeSessionId and reads the live store.
- libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles.component.spec.ts: covers empty state, tooltip, overflow, and agent filtering.
- libs/frontend/chat/src/lib/components/templates/chat-view.component.ts and .html: import and mount the container directly above chat input.
- libs/frontend/chat-streaming/src/lib/background-task.store.ts and .spec.ts: retain first-seen timestamps across replacement snapshots and clear them with tasks.
- libs/shared/src/lib/types/execution/stream-background.ts: optional command on snapshot entries.
- libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts, system-message.transformer.ts, transformer-state.ts, and sdk-message-transformer.ts: correlate background Bash tool input with task_started and prune command state per session.
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts`, `system-message.transformer.spec.ts`, and `libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts`: cover command capture, snapshot emission, and cleanup.

## Design

The right-aligned composer row renders only for running non-agent tasks. Tiles use the dock's 28 px height, muted text, rounded border, a small avatar-like icon box, and a spinning LoaderCircle. Labels truncate at 140 px. A hover or keyboard-focus tooltip shows task type, full command when captured (otherwise description), and elapsed time since first sighting. Each tile's aria-label has the same text. At most four visual tiles appear: with five or more tasks, three named tiles plus a +N tile whose tooltip lists remaining labels. Snapshot replacement removes finished tiles immediately.

## Checks run

- Ran git show --stat HEAD and read implementation-notes.md and fix-notes.md before editing.
- Compared task-specific dock, inspector, avatar, and roster files with git diff main; all eight reverted source files match main.
- Ran npx prettier --write on edited TypeScript and template files. Restored the chat template's existing formatting after Prettier changed unrelated lines.
- Called ptah_get_diagnostics on scoped backend and frontend files; each attempt returned unavailable because TypeScript checking was still running after 45 seconds. The HTML file is not recognized by that diagnostic tool.
- Reviewed changed source and diff manually. rg.exe was denied during a tooltip search, so PowerShell Select-String was used for that free-text lookup.

## Decisions

- **Command source:** The assistant transformer receives Bash tool_use input, and task_started supplies its tool_use_id. Capture only background Bash commands, correlate by tool-use ID and session, then prune task commands when a task leaves that session's snapshot. Pending tool-use records are capped at 64. Reversible.
- **Surface structure:** A container owns tab/session lookup and the one-second timer; a presentational component owns tiles. The existing roster service shows how to resolve the tab's session, and the mount point is in the chat view. Reversible.
- **Overflow:** A maximum of four visual tiles means three task labels plus +N when more than four tasks run. Reversible.

## Not done

- Per request, no Jest, Nx, build, serve, or verification command was run; CI must exercise the new specs and type checks.
- No rendered Electron screenshot was available without starting the app. Visual quality was checked against existing dock chip and avatar source, not a live render.
- The host exposed no skill-loading tool, so angular-frontend-patterns could not be loaded.
