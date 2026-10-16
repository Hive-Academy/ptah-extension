---
id: TASK_2026_677_efcd
status: in_progress
type: FEATURE
title: Clean session view with agent tiles and session inspector
description: >-
  Replace the compact turn view with a clean turn (collapsed "Worked for" work log, final answer, status agent chips) and add the "This session" right inspector with agent tiles, CLI provider icons, todos and git.
depends_on: []
created: 2026-10-15T08:54:43.000Z
updated: 2026-10-15T08:54:43.000Z
---

## Description

Follow-up task T1 of TASK_2026_629 (PR #730), widened by the user on 2026-10-15.

1. Clean turn view (replaces the compact view): while the agent works, show the streaming text, tool calls and
   agent activity; when the final message completes, collapse the work into a "Worked for Xm Ys >" disclosure and
   show the precise final answer, then a row of agent chips (icon, name, status colour) and copy / activity actions.
   A live "Orchestrating · 2m 07s" line shows while work runs.
2. "This session" right inspector: orchestrator card (model, state, context bar, tokens, cost, turns), AGENTS list
   (sub-agents, CLI lanes with provider icons, background commands; status, duration, current activity, permission
   requests), TODOS, GIT.
3. Header chips (branch, "N needs you"), composer chips (workspace, branch, approval mode, model and effort).
4. Smooth staggered animation on session switch.
5. Carry-over items T1-01 .. T1-40 from `reference/pr730-followup-map.md`.

Reference design: `reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png`.
Icons: lucide-angular and the CLI provider marks (`ptah-provider-mark`).
