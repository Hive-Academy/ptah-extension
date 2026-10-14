# TASK_2026_660 — child sessions ignore the parent's autopilot level

status: in-progress
type: BUGFIX
branch: fix/child-session-permission (worktree .claude-worktrees/fix-child-session-permission)

User report (2026-10-14): "I have it in full autopilot and when a session opens a child one it
asked me for permissions and completely ignored the permission I chose already."
Requirement: a child session started with ptah_session_start must use the parent session's
autopilot / permission level. Known lead: parent permission level is passed in but dropped;
every child starts in auto-edit (chat-session.service.ts ~128-140, ~667).
Related: the handoff session (TASK_2026_655 B2) must also inherit the caller's level.
