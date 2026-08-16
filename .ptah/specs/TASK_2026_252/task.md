---
id: TASK_2026_252
status: in_review
type: bugfix
title: >-
  Tasks board Start button fires a dead `/ptah-core:orchestrate` command and is
  offered on every non-terminal status
description: >-
  Two defects in the Tasks board launch path. (1) `TaskStartService` builds the
  prompt as `/ptah-core:orchestrate <TASK_ID>`
  (`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:118-119`), but
  the plugin-namespaced form is not resolvable — skills are junctioned into
  `.claude/skills/` un-namespaced precisely so the SDK can resolve them
  (`libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:173-178`).
  Clicking Start therefore opens a session that answers "Unknown command:
  /ptah-core:orchestrate" and burns 0 tokens; the prompt must be
  `/orchestrate <TASK_ID>`. (2) Start is gated only on terminality — the card
  renders it for every status except `done`/`cancelled`
  (`task-card.component.ts:400`, `isTerminal()` at `:670-671`) and the row does
  the same via `group.terminal` (`task-list.component.ts:578,623,806`). It must
  render only for `backlog` and `blocked`; `in_progress` and `in_review` already
  have a run and should not offer a second launch. Reported 2026-08-16 from the
  board UI.
---

# Tasks board Start: wrong command, wrong statuses

Machine-owned metadata carrier. Prose lives in `./context.md`.
