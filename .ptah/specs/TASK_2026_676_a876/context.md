# Context — stale latestTodoWrite in the resync owner live state

Source: merge-impact check of PR #727 (TASK_2026_655_5c1e) against TASK_2026_629_c0b3
(`feat/task-629-canvas-board`). The two branches share no files and `git merge-tree` is clean.
This is a runtime interaction that only exists after both land on main.

## Problem

TASK_2026_629 adds `StreamingState.latestTodoWrite` (`chat-types.ts`), set in
`setStreamingEventCapped` for a top-level `TodoWrite` `tool_start`. The compact tile reads it in
`summarizeTodos` (`compact-session-metrics.ts`, about line 110). When the marker is present it
does not fall back to the finalized messages.

PR #727's resync repair in `session-history-replayer.service.ts` (about lines 374-388) builds the
owner live state with `{ ...historyState, events: <filtered>, ... }`. The spread copies
`latestTodoWrite` from the full history state, even when that TodoWrite was in a message the
filter removed. `summarizeTodos` then finds no matching `tool_start` and returns
`{ kind: 'unknown' }`.

## Effect

While a resynced subagent streams, the compact tile's todo badge shows "unknown" and not the
real todo list. It is display only and temporary: after the turn finalizes, `streamingState` is
null and the tile reads the messages again.

## Suggested fix

In the rebuilt live state, recompute `latestTodoWrite` from the filtered `events` (latest
top-level `TodoWrite` `tool_start` by timestamp), or set it to `undefined` when the marker's
`toolCallId` is not in the filtered events.

## Dependencies

Do this after both PR #727 and the TASK_2026_629 branch are on main. Before that, the field does
not exist on the PR #727 side.

## Acceptance

- A spec: history with a TodoWrite in an earlier root message and a resynced Task owner later.
  During streaming, `summarizeTodos(tab.messages, tab.streamingState)` returns the known list.
- Checks: `npx nx test @ptah-extension/chat --parallel=1` and `@ptah-extension/chat-ui` if the
  spec lives there; typecheck, lint (scoped, serial).
