# Decisions - TASK_2026_886_032a

| # | Decision | Evidence | Source |
|---|----------|----------|--------|
| 1 | Classify as RESEARCH, depth Partial | Request is an audit plus local cleanup; no code change | Orchestrator rules |
| 2 | Use Agent-tool subagents only, no CLI lanes | User said "with our subagents only" in the current request | User (current) |
| 3 | Worktree cleanup scope is `.claude-worktrees/*` only | App review worktrees under `%APPDATA%/Ptah Dev/review/attempts` are app-managed, some locked | Evidence |
| 4 | Keep branches when worktrees are removed | Project CLAUDE.md: authorization does not permit branch deletion | Project rules |
| 5 | Skip a worktree that has uncommitted or unpushed changes, and report it | Removal would lose work | Evidence |
| 7 | Removed 10 SAFE_REMOVE worktrees (junctions unlinked first, no --force); main node_modules intact | worktree-audit.md, remove-worktrees.sh | User authorized "clear up merged worktrees" |
| 8 | 19 REVIEW and 24 KEEP worktrees left in place | Local-only spec notes or uncommitted source work | Evidence |
| 9 | 14 non-backlog carriers set to `done` (merged PRs), `in-progress` spelling fixed | status-audit.md | Evidence |
| 10 | 14 high-confidence backlog carriers set to `done` | backlog-audit-part1/2.md, merged PRs citing task IDs | Evidence |
| 11 | 16 obsolete backlog carriers set to `cancelled` (CLI/VS Code/TUI hosts removed 1cee6fafe, license server 0dde8a197, Tribunal page dea55817c, harness builder #877) | backlog-audit-part1/2.md | User (AskUserQuestion) |
| 12 | 530, 582, 875_8be2, 877, 714, 591 set to `done`; follow-ups TASK_2026_887_65e5 (714 leftovers) and TASK_2026_888_36b0 (591 Phase 2) filed; frontmatter added to 853_cli_lanes | status-audit.md, backlog audits | User (AskUserQuestion) |
| 13 | 155 and 479 moved from `blocked` to `backlog` | status-audit.md | User (AskUserQuestion) |
| 14 | 14 REVIEW worktrees: 114 local-only files copied to main checkout `.ptah/specs/_worktree-archive/<worktree>/` (cmp identical), then removed with --force after junction unlink | worktree-audit.md | User (AskUserQuestion) |
| 15 | Frontmatter added to TASK_2026_glass_scenes (had none, so it was invisible to the board; PR #884 merged) | Carrier parse check | Evidence (same class as #12) |
| 16 | Leftover folder `.claude-worktrees/landing-revamp-p2` not deleted: PID 50564 `nx serve ptah-landing-page --port 4200` holds its `.nx` db; worktree is already deregistered | Process check | Evidence (killing a user dev server is outward) |
| 17 | Phase 2 (backlog polish of 123 carriers) runs in this task, worktree and PR #966 | Same files, same sweep; follow-up user request | User (follow-up) + Evidence |
| 18 | Polish scope: rewrite only `task.md` (title, description, body, `updated:`); keep `status:`; history files get a one-line out-of-date note only | Carriers are the source of truth; rewriting history docs is high cost and loses the record | Orchestrator |
| 19 | Phase 2 also uses subagents only (4 parallel, file-disjoint lists) | User's subagents-only instruction for this sweep | User (earlier, same task) |
| 20 | Accept polish of 123 backlog carriers: 0 status lines changed, 123/123 parse with `Current state` section, 46 history files got only the note line, 0 absolute paths | polish-report-part00..03.md, diff checks | Orchestrator verification |
| 21 | No separate review subagent for the polish: docs/metadata only (lean rule 3); mechanical checks above stand in | Orchestration skill | Orchestrator |
| 22 | Missing `id:`/`created:` fields in about 18 older carriers left as is (folder name is canonical ID) | task-tracking.md § Task ID | Evidence |
| 23 | 241 and 459 set to `done`; 450 stays `backlog` (CI-history proof not checked) | polish-report-part00/01.md | User (AskUserQuestion) |
| 24 | 362 set to `cancelled` (pi-ai branch 6051 commits behind main); 647 epic set to `done`, `parent:` removed from 651 so it stands alone | polish-report-part00/03.md | User (AskUserQuestion) |
| 25 | 407, 667, 704 stay in backlog; their task.md names the check to run first | polish reports | User (AskUserQuestion) |
| 6 | Status changes to `cancelled` for stale backlog items go to the user | Removals/cancellations are user-reserved | Orchestration skill |
