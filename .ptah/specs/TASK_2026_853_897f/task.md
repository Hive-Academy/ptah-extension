---
id: TASK_2026_853_897f
status: in_progress
type: FEATURE
title: Trim the session prefix and scope installs to the workspace
description: >-
  Disable unused Claude Code built-in tools and skills by default with settings to re-enable,
  remove repeated Ptah prompt instructions, and make every Ptah install surface default to
  workspace scope with an opt-in global install; remove existing global installs.
depends_on: []
created: 2026-10-29T15:40:00.000Z
updated: 2026-10-29T15:40:00.000Z
---

## Description

Every Ptah main session starts with a ~48.9k-token prefix (subagents ~32k). About 30k of it is
under Ptah's control: unused Claude Code built-in tools, terminal-only and account-synced skills,
repeated Ptah instructions, and marketplace installs that sync into every workspace. This task
trims that prefix and makes installs workspace-scoped by default.
