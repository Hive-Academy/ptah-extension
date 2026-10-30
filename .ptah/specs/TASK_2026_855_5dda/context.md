# TASK_2026_855_5dda — Per-session git view in the git dock

Branch `feat/session-git-view`, worktree `.claude-worktrees/feat-session-git-view-d7cc38a5745d`.
Started as child session "Per-session git view" (parent 678bea52). Unattended: no user questions;
decisions are recorded in `decisions.md` with evidence.

## Request (verbatim goals)

The git sidebar (git dock, `libs/frontend/git-ui`) must work PER SESSION: when the user switches
chat tabs, the git view shows the changes of THAT session's worktree, automatically and
predictably, encapsulated per worktree, so parallel sessions in different worktrees never mix.

Required outcome:
1. A session → working-root resolver with a documented precedence (session worktree from its
   organization record / agent origin / cwd → else workspace root). Deterministic, tested.
2. The git dock scope follows the active chat tab's session by default, with a visible scope
   header (session name, worktree, branch) and a "pin scope" option. Decide with evidence whether
   a session's own worktree is fully editable (stage, commit, discard) in the dock, with safety
   (confirmations for destructive actions, no cross-tree operations).
3. Per-root watcher and state isolation: each worktree has its own status cache and watcher
   subscription with bounded lifetime (release when no session uses it); no leak with many
   sessions.
4. The session stats card git cell opens the dock scoped to that session.
5. Tests for the resolver, scope switching, isolation and watcher release.

## Coordination

- `feat/session-auto-links` (TASK_2026_854_52e8) owns session↔task↔todo linking and may publish a
  session → worktree contract. Do not edit session organization, board link capture, todos
  section files. At start (2026-10-30 03:21Z) that branch had no commits beyond main.
- `feat/artifact-display-window` (TASK_2026_853_3401) moves the display panel. Do not edit
  display-panel files.
- Do not edit `.ptah/specs/**` of other tasks.

## Artifacts

- `implementation-plan.md` — architecture (software-architect).
- `decisions.md` — decisions with evidence.
- Reviews and reports are added as the task advances.
