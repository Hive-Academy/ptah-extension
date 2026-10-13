# Decisions - TASK_2026_441_7825

| # | Decision | Step | Evidence |
| --- | --- | --- | --- |
| 1 | Gate 0.1 mode `enabled` (lanes-first), approval `lane-review` | Evidence | Memory: user prefers CLI lanes over subagents (TASK_2026_375, TASK_2026_360); this task's scope item 2 |
| 2 | Architecture phase on the codex lane; document review by a Claude subagent (cross-side) | Evidence | `lane-assignment.md` § Assigning phases (plan → strong-reasoning lane); agent-lanes §6 cross-side review |
| 3 | grok excluded | Evidence | `ptah_agent_list`: AT LIMIT until 2026-10-13 17:40 UTC |
| 5 | Edit the plugin (`apps/ptah-extension-vscode/assets/plugins/ptah-core`) and agent templates, not `.claude/` | User | User correction 2026-10-13; memory `ptah-skill-packaging` |
| 6 | First architect lane (codex 5e38fcf2) stopped and re-spawned with corrected source paths | Evidence | Its prompt pointed at `.claude/skills` |
| 7 | Plan revision 1 → REVISE (2 Serious, 5 Moderate, 5 Minor); no unapproved removal flagged | Peer | `implementation-plan-review.md` round 1 |
| 8 | Revision 2 on a codex lane (resume refused over 60k tokens, so a fresh lane with a handoff brief plus a queued context message) | Evidence | spawn result for agent 03b5aa15 |
| 9 | Round-2 reviewer told to re-read the plan: the queued context message ran as a second lane turn after the first `delivered` signal, and that turn edited the plan once more | Evidence | Lane 03b5aa15 second report; status completed, exit 0. Lesson for the skill: a queued message can run after a completion signal, so wait for the queue to drain before review |
| 10 | Gate 2 passed: round-2 review APPROVED revision 2 (lane-review mode); Moderate R2-1 and the per-turn signal rule (#9) handed to team-leader as batch notes | Peer | `implementation-plan-review.md` Round 2 |
| 11 | Team-leader runs as a subagent (it owns `batches.md` state and commits; lanes cannot commit) | Evidence | `lane-assignment.md` § Never on a lane (git commits) |
| 12 | Batch 3 cut plugin `git-standards.md` ~300 → 35 lines, beyond the planned move; generic sections (branch/PR ops, pre-commit checks, bypass documentation, scenarios, default types) restored generically in a fix lane, repo-specific scope list and examples stay out | User | AskUserQuestion 2026-10-13: "Restore generic parts" |
| 13 | `orchestrate-help.md` old phase walkthrough removal accepted without asking: it referenced `progress.md` and `/validate-*` commands that do not exist (stale, not a capability) | Evidence | team-leader B3 Mode 2 note |
| 4 | Two skills (`orchestration` + internal `agent-lanes`); fleet becomes a mode | User | Approved in session 2026-10-13 ("lets do that in a new worktree") |
