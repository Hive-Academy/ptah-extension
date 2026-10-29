---
title: Race
description: Run independent coding attempts against a fixed rubric and verify the winner.
---

# Race

Race gives several lanes the same coding task in separate worktrees. The conductor fixes an objective rubric before the attempts, scores the results, and verifies the highest ranked candidate with the named checks. If it fails, the next candidate is considered.

Ask in the main chat: `/tribunal race: implement the parser change; require these tests to pass...` State acceptance criteria and runnable verification. You may pin installed lanes in plain text, including repeated attempts from one family if that is what you want, or let the skill select from `ptah_agent_list`. The conductor announces attempts and paid call count, then waits for your confirmation before spawning.

Scores, verification failures, and the recommended diff arrive in chat. The `.ptah/specs/TASK_*` folder holds attempt and review artifacts. Review the result before approving an integration or commit. Ask the conductor to stop the run to stop active lanes with `ptah_agent_stop`.

Race works best when tests, lint, or another check can distinguish a winner. For cross-vendor code review without a runnable bar, use [Forge](/tribunal/forge/).
