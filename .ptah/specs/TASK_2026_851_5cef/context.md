# Task Context - TASK_2026_851_5cef

## User Request
Follow-up to PR #842 (fix/claude-account-leases). Four items:
1. Linux PID namespace (/proc/self/ns/pid) in the CURRENT_LEASE_HOST machine digest; unreadable ->
   per-process random value (fail closed). win32/darwin unchanged. Specs.
2. Electron quit disposes active named-account SDK sessions (lease release) before SQLite closes,
   with a short deadline. Update DI guard specs if a service is added.
3. provider_account_operations rows and 'pending' profiles left after a crash: record the host
   (same shape as run leases, migration after 0061), reclaim only when the host is proved gone,
   restore the prior profile state.
4. normalizeAuthMethod default: safe default ('claudeCli' when no API key stored and Claude login
   connected), refusal message points to the auth method setting. Specs.

## Task Type
BUGFIX

## Complexity
Medium

## Strategy
BUGFIX, Partial depth (user choice). Developers in parallel on file-disjoint items -> scoped
verify -> independent code-logic review -> commit/push/PR -> CI and review watch.

## CLI Lanes
Implementation on subagents (backend-developer). Reviewer: different-family CLI lane when
spawnable, otherwise code-logic-reviewer subagent with weaker-evidence label.

## Conversation Summary
Worktree: .claude-worktrees/claude-account-followups, branch fix/claude-account-followups from
origin/main 3c70e573c (local main was behind; origin/main is the updated main).
