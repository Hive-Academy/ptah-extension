# Task Context - TASK_2026_863_cfae

## User Request
our automatic session handoff never fires , for some reason i think its because we need the session to be active or something is blocking it to work , we worked before on that task but after i tried a couple of times i didn't see it work with multiple cases , also i would need to allow for closing the old session once the new one is generated automatically as well

another related something happens with autocompactions that should be fired before the cache expiry hits , this i found it working sometimes but only when i have that session active or something, i think we can tweak the serve dev instance to test out those both examples live , we can set the cache expires for a couple of seconds to test, and same for the automatic handoff we can set it to a very low threshold and check if its will be triggered

## Task Type
BUGFIX (plus one small feature: close old session after auto hand-off)

## Complexity
Medium

## Strategy
BUGFIX, Partial: research (root cause + fix plan) on a CLI lane -> implementation on a CLI lane
-> independent code-logic review on a different-family lane -> live dev test by user.

## CLI Lanes
Gate 0.1: no stored lane preference found; user global CLAUDE.md asks to delegate heavily to
non-Claude lanes. Mode: enabled. Approval: lane-review.
Rows: codex (installed, confirmed room, weekly 34%), Glm ptah-cli (room, weekly 70%),
grok (installed, unknown), antigravity (unknown), kimi code (unknown), opencode AT LIMIT,
claude/copilot disabled.

## Conversation Summary
- Worktree: D:\projects\ptah-extension\.claude-worktrees\auto-handoff-idle-compact
  (branch fix/auto-handoff-idle-compact from origin/main).
- Memory note `session-budget-auto-handoff-policy` (older) said hand-offs must not start
  automatically. Superseded: commit 5e7b108d4 added opt-in auto hand-off and the user now
  explicitly wants it to work. Keep it opt-in.
