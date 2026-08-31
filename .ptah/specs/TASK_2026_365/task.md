---
id: TASK_2026_365
status: done
type: bugfix
title: Scope the agent user layer by workspace
description: >-
  `~/.ptah/user/agents` is one directory per machine, but its source is the
  per-workspace `{ws}/.claude/agents`. Two workspaces whose generated agents
  share a slug overwrite each other's clone on every activation, and the
  reconciler then rewrites every rival CLI's agent copy. Key the agent clone by
  workspace, and stop mirroring agents into a workspace that has not consented.
---

Scope the agent half of the user layer by workspace key, and gate the agent
mirror on the same consent that already gates propagation.

See `context.md` for the measured evidence and the design decisions.
