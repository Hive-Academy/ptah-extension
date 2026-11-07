---
id: TASK_2026_581_2af1
status: backlog
type: BUGFIX
title: >-
  Apps page chat - live transcript updates and the main chat composer
description: >-
  The Apps page transcript does not update while the agent runs. Fix the live update, then replace
  the plain textarea composer with the main chat input (ptah-chat-input).
depends_on: []
created: 2026-09-30T00:00:00.000Z
updated: '2026-11-07T00:00:00.000Z'
---

## Description

Two defects in `libs/frontend/mcp-apps-page` (Electron renderer), one task.

1. **Live updates (bug).** The transcript does not render agent execution while it streams. The
   content is correct after the user switches to another page and back. Write a failing test first
   that pushes stream events through the claim and asserts that the transcript tree changes with no
   new component instance. Then fix the cause (see the hypotheses in `context.md`).
2. **Composer (feature gap).** The composer is a plain `<textarea>` with Send and Stop. It has no
   `@` mentions, no `/` commands, no attachments and no model or effort picker. Use the main chat
   input instead, without a fork. `chat-ui` must not import `chat`; `mcp-apps-page` may import
   `chat`.

Keep Send, Stop and "New conversation", and keep the Apps session separate from the coding chat
tabs. The acceptance criteria in `context.md` are still current.

## Current state (2026-11-07)

- Neither defect is fixed. No commit since 2026-09-30 targets them (the later
  `libs/frontend/mcp-apps-page` commits are focus routers, bundle and Tribunal-removal changes).
- Composer: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:214` is still a
  `<textarea>`, with Enter handling at `:223` and `:449`.
- Live update anchors: `streamingState` computed at
  `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:133-134`, the claim writer
  at `:547-553`, the transcript read at
  `libs/frontend/mcp-apps-page/src/lib/components/apps-transcript.component.ts:135`.
- Target composer: `ptah-chat-input` at
  `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:146`, with
  the model and effort selectors at `:424-426`.
- The AI Team Builder note in `context.md` is obsolete: the harness builder view was removed in
  PR #877.
