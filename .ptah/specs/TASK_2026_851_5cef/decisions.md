# Decisions - TASK_2026_851_5cef

| # | Stage | Decision | Evidence |
|---|-------|----------|----------|
| 1 | pre-flight | BUGFIX, Partial depth | User request names depth and type |
| 2 | setup | Worktree from origin/main, not local main | Local main at ba0f98271 was behind origin/main 3c70e573c (PR #842 merge); user asked for "updated main" |
| 4 | batch A | Record the sign-in console child pid on operation rows (0062 `child_pid`), reclaim needs host and child gone | Run leases already use childPid; user asked for "same shape as run leases"; a live console after a host crash could otherwise race the restore |
| 5 | batch A | Pending profiles from crashes before 0062 stay out of scope (no host recorded, cannot be proved gone) | Fail-closed rule in item 3 |
| 6 | review | Reviewer: codex lane (family codex) on Claude-family implementation. Verdict NEEDS_REVISION 4/10 | code-logic-review.md |
| 7 | fix round | Fix defects 1, 2, 3 (Blocking/Serious), 4 (own new code, leak), 6 (part of item 3 requirement). Defer 5 (60 s cached login status) to a later task | Lean rule 4 |
| 8 | fix 1 | Failed console pid write: live host stops the console and ends the operation (fail closed). Spawn-to-write window stays, as for run leases | Same rule as run lease childPid |
| 9 | re-review | codex re-review REVISE 5/10: defects 2, 3, 4, 6 closed. Revise cap reached (one fix round + re-review) | code-logic-re-review.md |
| 10 | re-review | Defect 1 residual kept as a disclosed open item: crash between console spawn and the pid write (or during the kill after a failed write) leaves child_pid NULL. Same window as run lease childPid (merged in PR #842). A "child unknown" guard can leave a profile pending forever | provider-account-host.ts leaseOwnerGone; run lease design |
| 11 | re-review | New Moderate 1 (SecretStorage rejection blocks CLI default) and 2 (throwing listener after committed reclaim fails list) deferred to follow-up tasks with defect 5 | Lean rule 4: no data loss, no lane config break; Moderate 1 is not a regression |
| 3 | batching | Three file-disjoint batches: A = items 1+3 (auth-providers lease host + operations reclaim, persistence-sqlite migration), B = item 2 (Electron shutdown), C = item 4 (auth method default) | Items 1 and 3 share the lease host shape; items 2 and 4 touch other files |
