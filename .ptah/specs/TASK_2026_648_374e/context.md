# Task Context - TASK_2026_648_374e

## User Request

Phase 1 UI of epic TASK_2026_647_1b0f (see `../TASK_2026_647_1b0f/context.md`). The user could
not test PR #732 because the builders still run on the parallel surface path (epic defects 1-2),
so the epic's UI phases run next: 648 (this task), then 649, then the wizard UI (D18 in
`../TASK_2026_652_7284/decisions.md`).

## Scope

Shared `ptah-session-embed`, `Tab.workflow` tag with a session index for sidebar badges,
`WorkflowTabLauncherService`, workflow badges. Proposal persistence is already done in #732.
Builders are NOT migrated here (649). See `implementation-plan.md` and `parity-inventory.md`.

## Constraints

- Keep and fix: no user-visible capability removed.
- Memory-safe checks per CLAUDE.md: changed projects only, `--parallel=1`, tests separately
  with `--maxWorkers=2`, one heavy check at a time.
- Commit in the foreground, never amend or skip hooks. Do not touch `stash@{0}`.

## Branch and PR

Worktree `.claude-worktrees/task-647-setup-hub-chat-sessions`, branch
`feat/task-648-session-embed`, created from #732's tip `dc807e6b8`. Stacked PR against
`task-647-setup-hub-chat-sessions` (user, 2026-10-15).

## Executors

Architect, implementer: codex lanes. Code-logic review: a family other than codex
(antigravity if it has room, else opencode per D11 of 652, else grok).
