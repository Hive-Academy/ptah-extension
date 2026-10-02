---
id: TASK_2026_592_a44d
status: in_review
type: BUGFIX
title: Closing a chat tab ends its Claude session process
description: >-
  Closing a chat tab after its turn finished leaves the tab's claude.exe (Agent SDK streaming-input
  query) running forever, because the frontend sends chat:abort only while a turn streams and the
  backend has no idle reaper. Fix tab close so it ends the tab's session; never end sessions on
  workspace switch, pop-out transfer, or when another tab still shows the same session.
depends_on: []
created: 2026-10-02T01:10:00.000Z
updated: 2026-10-02T01:10:00.000Z
---

## Description

Observed 2026-10-02 in the Ptah desktop app: 14 `claude.exe` processes under one Ptah.exe, only 5 sessions
in active use; 8 idle ones (1-11 h, about 1 GB) belonged to tabs the user had closed or left.

Root cause (confirmed in code on `main` 95cb1de78):

- `TabManagerService.closeTab` calls `abortStreamingForTab`
  (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:939`).
- `markTabIdle` drops the tab's AbortController when a turn ends (`:2613`), so `abortStreamingForTab` is a
  no-op on an idle tab (`:2694-2697`).
- The only `chat:abort` dispatch on tab close is the listener on that controller
  (`libs/frontend/chat/src/lib/services/message-sender.service.ts:216-237`).
- The backend has no idle timeout and no live-session cap; `evictStale` skips records with a live query
  (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:578`).

## Scope

- Closing a tab (every close path: tab bar, keyboard shortcut, close-to-right / close-others, canvas tile,
  chat-view close, app-shell close, tribunal conductor close) ends the backend session bound to that tab,
  also when the tab is idle.
- `/clear` / new chat in the same tab and rewind rebind: the replaced session's process is ended (research
  confirms whether this is safe).

## Must NOT change (user requirement, 2026-10-02)

- Workspace switching never ends sessions. The user keeps sessions running in several projects and switches
  between them on purpose.
- Pop-out / tab transfer (`forceCloseTab` for transfer) never ends the session.
- A session that is still shown in another tab, window or canvas tile is not ended.
- Background work the user expects to keep running is not killed silently (research to identify any).

## Out of scope

- App-quit disposal of chat sessions and crash orphans (record as follow-up).
- Backend idle reaper / live-session cap (record as follow-up unless research shows it is needed).
