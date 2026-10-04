# Context

Follow-up to TASK_2026_584_5e7a (agent-started child sessions, `ptah_session_*`).

## Observed (2026-10-04)

The parent session started a child with `ptah_session_start` (label "TASK 531 canvas
gating", branch `fix/task-2026-531-canvas-surface-active`, worktree
`.claude-worktrees/fix-task-2026-531-canvas-surface-active-b04f848d7305`). The child ran
for 57 minutes, made commits, and reported back correctly. In the UI:

1. **Sidebar:** the entry shows "1h ago · transcript expired", greyed out (opacity-50),
   with the `Agent` and `TASK_2026_531_c4a8` badges. The transcript is not expired;
   the session is under an hour old.
2. **Orchestra Canvas:** no tile appeared when the session started, although the tool
   result said it "opened as a tab in the user's window".

## Leading hypothesis for (1), unconfirmed

`hasTranscript` comes from `listTranscriptIds(workspacePath)` in
`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:428,459`, which
resolves `~/.claude/projects/<escaped workspace path>` (`resolveSessionsDir`, around
`:1534`). The child session runs with its cwd in the worktree, so the SDK writes its
`.jsonl` under the escaped WORKTREE path, not under the parent workspace's directory.
The lookup misses it and reports `hasTranscript: false`. The same miss probably breaks
resuming the session from the sidebar (`validateSessionFile`, around `:921`).

Check: compare `~/.claude/projects/` for the escaped main-workspace dir and the escaped
worktree dir; the child's session id should be in the worktree one only.

Fix direction: record the child's cwd in session metadata (it is already worktree-bound)
and resolve the transcript dir from that cwd, for both `hasTranscript` and resume.
Do not loosen the check for normal sessions.

## (2) Canvas tile — not investigated yet

Unknown whether the child's tab is created in the tab partition of the parent
workspace, only in the non-canvas layout, or not at all in canvas mode. Related prior
defects: workspace-switch tile drops (memory `workspace-switch-canvas-bug`) and the
rewind "no canvas tile opened" fix. Start from how the session spawner asks the
webview to open the tab, and whether canvas mode registers a tile for a tab it did not
create itself.

## Acceptance

- A running or finished child session shows as a normal (not expired) sidebar entry
  and can be opened/resumed.
- Starting a child session in canvas layout opens a tile for it.
- Regression tests for both paths.
