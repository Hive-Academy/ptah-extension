---
id: TASK_2026_860
status: in_progress
type: FEATURE
title: Session sidebar grouping, agent dock cap, header actions, pulse loaders
description: >-
  Finish the pulse-loader migration for the remaining rotating keyframes, cap the chat agent
  dock to running-first 5-6 chips with an overflow dropdown, group the running sessions sidebar
  by status with finished sessions at the bottom, and add 2-3 option buttons to the session
  header next to the session title. Electron first.
depends_on: []
created: 2026-11-02T00:00:00.000Z
updated: 2026-11-02T00:00:00.000Z
---

## Description

User request (2026-11-02), four parts:

1. Pulse loaders. Commit 160444fd6 replaced daisyUI `.loading-spinner` and Tailwind
   `animate-spin` with the ptah-pulse animation. Component-local `rotate(360deg)` keyframes
   still exist (agent-avatar, boot-progress, progress-ring, staged-steps, previous-sessions
   modal, provider-setup-wizard, webview styles.css:586, electron preparing-workspace.css).
   Every streaming and loading status must use the pulse.
2. Agent dock (top of the chat page): order chips with running agents first, show at most
   5-6 chips, put the rest in an overflow dropdown.
3. Running sessions sidebar ("Sessions  2 / 9 running"): group sessions by status (running
   first, then waiting/idle, finished at the bottom), show a clear status for each session.
4. Session header ("<title> / idle" with one panel-toggle icon on the right): add 2-3 option
   buttons on the right side of the header.

Product focus: Electron first. Keep VS Code and TUI hosts compiling.
