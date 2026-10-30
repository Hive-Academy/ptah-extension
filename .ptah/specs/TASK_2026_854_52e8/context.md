# TASK_2026_854_52e8 — Auto-link sessions, tasks, worktrees and todos

Started 2026-10-30 as child session "Auto-link sessions, tasks, todos"
(parent session 678bea52-53c9-4d10-a439-3f8915db9554), branch
`feat/session-auto-links`, worktree
`.claude-worktrees/feat-session-auto-links-6e9899b8a83f`.

Strategy: FEATURE, Full workflow, Electron first. The user said: no questions,
no waits. Decisions are recorded with evidence in `decisions.md`.

## Goal

Links between chat sessions, registry tasks (`.ptah/specs`), worktrees and agent
todos must be automatic and predictable. Manual link/unlink stays only as an
override.

## Required outcome (from the user)

1. Deterministic link rules in host-neutral backend libs: a session started
   from a task (board, `ptah_session_start taskId`, /orchestrate with a TASK id,
   a worktree/branch whose name or `.ptah/specs/<id>` folder identifies a task)
   gets a `primary` link with a recorded `source`; a child session inherits its
   parent's task link as `related`; a session whose worktree belongs to a task
   links to it. Exact precedence table documented here. No fuzzy/LLM guessing.
2. Links survive reload and app restart.
3. Todos <-> task: the linked task shows the session's live todo progress
   (done/total, in-progress item); the session card shows its task. Default:
   never auto-close a task; at most backlog -> in_progress when a linked
   session starts work.
4. The session stats card shows linked task + todo progress without a manual step.
5. Tests pin every rule in the precedence table, including reload/restart.

## Coordination constraints

- `feat/session-git-view` owns `libs/frontend/git-ui` and
  `session-git-stats.store.ts`: do not edit. Expose the session -> worktree root
  mapping through a small documented contract (see `contract-for-git-view.md`).
- `feat/artifact-display-window` owns the display panel files: do not edit.
- Do not edit `.ptah/specs/**` of other tasks.

## Existing surface (main @ 6fa7c21b5)

- `libs/backend/session-organization` (TASK_2026_580): store (migration 0050:
  `session_organization`, `session_task_links`, `session_pr_links`), service
  (recorder port + RPC mutations), capture service (delete cascade, rekey, PR capture).
- Port `ISessionOrganizationRecorder` in platform-core.
- Link sources today: `board-start | agent | user`. Roles: `primary | related`.
- Webview `BoardTaskLinkCaptureService`: in-memory tab -> task pairs, lost on reload.
- `recordAgentStartedSession` (TASK_2026_584) records child lineage + optional task.
