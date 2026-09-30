---
id: TASK_2026_581_2af1
status: backlog
type: BUGFIX
title: >-
  Apps page chat - live transcript updates and the main chat composer
description: >-
  The Apps page transcript does not update while the agent runs. The user
  must leave the page and come back to see tool calls and text. Fix the live
  update. Then replace the plain textarea composer with the main chat input
  (ptah-chat-input) so the Apps page gets @ mentions, / commands,
  attachments and the model and effort pickers.
depends_on: []
created: 2026-09-30T00:00:00.000Z
updated: 2026-09-30T00:00:00.000Z
---

## Description

Two defects in `libs/frontend/mcp-apps-page`, one task.

1. **Live updates (bug).** The transcript does not render agent execution while it streams. The content is correct after the user switches to another page and back. Tool call messages and text content render correctly at that point.
2. **Composer (feature gap).** The composer is a plain `<textarea>` with Send and Stop. It has no `@` mentions, no `/` commands, no attachments and no model or effort picker. Use the main chat input instead.

Read `context.md` for the evidence, the scope and the acceptance criteria.
