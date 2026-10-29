---
title: Crucible
description: Refine one implementation through an independent executor and judge loop.
---

# Crucible

Crucible assigns a coding task to an executor lane and a stronger judge from a different vendor family. The conductor freezes a written rubric before the first call. The judge returns evidence-backed defects; the executor revises until the judge passes the work, progress regresses, or the round cap is reached.

Ask in the main chat: `/tribunal crucible: implement this migration; pass these checks...` Give a specific task and an acceptance bar. You can pin an installed executor and judge by name in plain text, or ask the skill to choose role-appropriate lanes from `ptah_agent_list`. An independent judge requires a second family. The conductor announces roles, round cap, and estimated paid calls, then waits for confirmation before spawning.

The rubric, judge notes, revisions, and final verdict appear in chat and in a `.ptah/specs/TASK_*` folder. Inspect the diff and checks before approving any commit. Ask the conductor to stop the run to stop its live lane with `ptah_agent_stop`.

Crucible needs `tribunal`, `agent-lanes`, and `orchestration` for its task-folder rules. If the bar cannot yet be stated, start with [Council](/tribunal/council/). For independent competing implementations, use [Forge](/tribunal/forge/) or [Race](/tribunal/race/).
