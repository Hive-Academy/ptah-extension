# Batch 6 — governing-root validation and cwd isolation

## Changed paths

- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/session-folder.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-session-folder.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`

- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.ptah-ui-flag.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-provider-profile.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-slash-before-resume.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-persona-resume.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` (existing fixture only)
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts` (existing fixture only)

## Behavior for each requirement

1. `validateSessionPolicyRoot` checks an absolute supplied path and its realpath against registered folders and unsafe-path rules. It requires an existing readable, searchable physical directory. Node filesystem errors fail closed. Capture and restore validate execution and ancestor roots; launch revalidates child/handoff roots before context reads and SDK calls. Lineage deduplicates by physical identity, retaining nearest-first order. Internal aliases resolve to their physical path; aliases escaping registered folders are refused.
2. A saved execution cwd is authoritative. If it is distinct and unavailable, `resolveSessionFolder` refuses with `SESSION_FOLDER_UNAVAILABLE`; it never tries `workspaceId`. Missing or identical saved cwd uses the project folder. Unit and chat integration tests assert refusal and zero SDK resume calls for removed children.
3. Child/handoff capture, activation, inactive continuation and rewind share root validation through capture/restore and the common resume path. Malformed lineage is refused before SDK resume. Existing RPC error shaping remains in place.

## Decisions

The first scoped verify exposed seven other suites with virtual folder fixtures; only their fixtures were changed, as directed for suites broken by the new physical-path rule. Two handler suites also mocked filesystem operations; their fixtures now use real directories and genuinely missing paths.

| Decision                                                                      | Options                                               | Evidence                                                                                                                                                                                                                 | Reversible |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Accept internal symlink aliases but canonicalize to realpath and deduplicate. | Reject all aliases; accept and canonicalize.          | Both supplied and real paths pass authorization/safety, while physical identity prevents duplicate layers.                                                                                                               | Yes.       |
| Use Node realpath, stat and access at the backend boundary.                   | Extend the filesystem provider; Node filesystem APIs. | The existing provider has no realpath API; backend RPC handler runs in Node. Importing `fs.promises` through `node:fs` keeps root checks independent of handler suites that mock `fs/promises` for unrelated operations. | Yes.       |
| Preserve the caller's saved cwd spelling after validation.                    | Return realpath; return supplied cwd.                 | Metadata and execution identity already use saved cwd; only policy lineage needs physical canonicalization.                                                                                                              | Yes.       |

## Verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk` — first run exit 1; `NX 6 tasks: 5 succeeded, 2 cached, 1 failed` (`rpc-handlers:test`, 40 fixture-related failures).
- Same command — second run exit 1; `NX 6 tasks: 5 succeeded, 2 cached, 1 failed` (`rpc-handlers:test`, 11 failures in two handler suites whose filesystem mocks intercepted the new validator).
- Same command — third run exit 1; `NX 6 tasks: 5 succeeded, 2 cached, 1 failed` (`rpc-handlers:test`, two stale missing-folder fixtures).
- Same command — fourth run exit 1; `NX 6 tasks: 5 succeeded, 2 cached, 1 failed` (`rpc-handlers:test`, one missing-folder fixture still had an unauthorized parent).
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=session-rpc.handlers.spec.ts` — exit 0; `NX 1 task: 1 succeeded`.
- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk` — final run exit 0; `NX 6 tasks: 6 succeeded, 2 cached`.
- `npx prettier --write` with all 14 changed TypeScript paths listed above — exit 0; every path reported `unchanged` on the final run after verify.
- `ptah_get_diagnostics` scoped to changed source files — unavailable; TypeScript worker exceeded its timeout. The scoped verify typecheck target succeeded in each completed run.

## Blockers

- None. The final scoped verify passed.
