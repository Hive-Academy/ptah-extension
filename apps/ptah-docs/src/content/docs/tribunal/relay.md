---
title: Relay
description: Assign orchestration phases to CLI lanes and keep their artifacts in a task folder.
---

# Relay

Relay runs the `orchestration` skill's plan, architect, implement, and review pipeline on CLI lanes. The `tribunal` skill routes a Relay request from the main chat to that workflow. Each phase receives the previous phase's artifact; the conductor manages approval checkpoints and checks the output.

Ask in the main chat: `/tribunal relay: build this feature with plan, architecture, implementation, and review`. Give the task and acceptance criteria. Name installed lanes for particular phases in plain text if you want to pin them, or let the conductor resolve role-appropriate lanes through `ptah_agent_list`. Use a separate review lane, preferably from another family. The conductor announces phase assignments and paid call count and waits for your confirmation before spawning.

Phase artifacts and the final review live in `.ptah/specs/TASK_*`; the conductor reports progress and links the results in chat. Checkpoint approvals still apply before the next phase. To stop, tell the conductor to stop the run; it stops live lanes with `ptah_agent_stop` and reports the last completed phase.

Enable `tribunal`, `orchestration`, and `agent-lanes`. For competing answers to one prompt, use [Council](/tribunal/council/), [Forge](/tribunal/forge/), or [Race](/tribunal/race/).
