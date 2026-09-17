---
status: backlog
type: BUGFIX
title: Spawned agents lie about their own lifecycle
description: >-
  ptah_agent_status is unreliable enough that an orchestrator has to stop using
  it. Three distinct defects observed on 2026-09-12 across six spawns. A
  completed agent vanishes from the registry and reports "Agent not found". A
  completed agent never exits and blocks the caller. A completed run hangs
  forever on a leaked handle with no diagnostic at all.
---

Observed on 2026-09-12 while orchestrating TASK_2026_402_a5c7 and a CI fix on
pull request #494. Six spawns, six agents that finished their work correctly,
and three different ways the lifecycle reporting was wrong about it.

None of these defects lost work. Every agent wrote its files and its report to
disk. What they cost was trust in the tool that reports status, and in one case
twenty minutes of a blocked caller.

**The orchestrator's workaround is already in place and is the reason this is
worth fixing: it stopped calling `ptah_agent_status` and started reading the
worktree instead.** A status tool nobody trusts is worse than no status tool,
because it still gets called by anything that does not know better.

Evidence and acceptance criteria are in `context.md`.
