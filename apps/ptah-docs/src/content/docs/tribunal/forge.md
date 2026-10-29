---
title: Forge
description: Compare independent implementations with cross-vendor review.
---

# Forge

Forge gives each panelist the same well-specified coding task in an isolated git worktree. Panelists implement independently, review another panelist's diff, and the conductor ranks the results against your acceptance criteria.

Ask in the main chat: `/tribunal forge: implement the caching change with these acceptance criteria...` Include the files, expected behavior, and checks. Name installed CLI lanes in plain text if you want to pin them, or let the skill choose from `ptah_agent_list`. The conductor announces the panel, review rounds, and estimated paid call count and waits for confirmation before spawning.

The conductor reports each implementation, review, ranking, and recommended diff in chat. The task folder under `.ptah/specs/TASK_*` holds artifacts and review notes. Inspect the winner and verification before approving integration; no winner should be silently merged. To stop, ask the conductor to stop the run, which stops live lanes with `ptah_agent_stop`.

Forge needs a clear brief. For a decision without code, use [Council](/tribunal/council/). For attempts judged by runnable checks, use [Race](/tribunal/race/).
