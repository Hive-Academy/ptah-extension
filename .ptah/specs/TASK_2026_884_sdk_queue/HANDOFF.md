# HANDOFF — TASK_2026_884 (follow-up queue) + TASK_2026_885 (Codex sandbox)

## Goal
User bug: a follow-up message sent while an agent works waits until the user reopens that
session (renderer held it in `TabState.queuedContent`; hidden tabs only get a `statusOnly`
terminal `turn_state`, so the flush never ran). User wants both tasks shipped fast for a local
release; CI may be the verification gate ("push and let CI verify"). Do not wait for user
approval to implement (user said so).

User decisions:
- Queue owner is the BACKEND, per session + `clientMessageId`. Default for every provider:
  queue as the next turn. Codex additionally gets "Send now" (`turn/steer` + `expectedTurnId`).
  Claude has no reliable steer (SDK folds mid-turn prompts into a tool result; model ignores them).
- Codex sandbox: visible setting, default `danger-full-access` on ALL OSes (Windows
  workspace-write blocks Node child spawn → lanes cannot run verify).
- Scope cuts this round (follow-ups): no edit of a queued item, no restart-recovery record.
- SDK pinned to `@anthropic-ai/claude-agent-sdk` 0.3.318 (package.json + lock in Task A).

## Done
- Task B: branch `feat/codex-sandbox-setting`, worktree
  `D:\projects\ptah-extension\.claude-worktrees\codex-sandbox-setting`, commit `a25af499d`
  `feat(codex-runtime,cli-agent-runtime,chat): visible codex sandbox setting`, pushed,
  **PR #949** https://github.com/Hive-Academy/PtahCode/pull/949 (pre-push hooks passed).
  Verified: chat verify 339/339 suites; codex-execution-profile.spec 51/51 (incl. coordinator fix:
  chat/gateway `plan` stays read-only under full access; `fullAccessStatus` follows resolved policy).
  Full scoped verify of the other Task B projects did NOT finish locally (run was killed) → CI gate.
- Task A worktree `D:\projects\ptah-extension\.claude-worktrees\sdk-native-queue`
  (branch `feat/sdk-native-queue`, NOT committed yet). Batches 1 (RPC), 2 (Claude runtime),
  3 (Codex chat) finished. Verified: agent-sdk tests = same 3 failures as main (env), +9 new pass;
  codex-runtime 170/1214 fail = identical to main baseline. Batch 1: rpc-handlers lint/typecheck
  pass, its suites 236 pass (16 other failures are Windows symlink/path env issues).
- Coordinator added: `libs/shared/src/lib/types/follow-up-queue.types.ts` (frozen contract),
  `queueIntent` in `ai-provider.types.ts`, `IAgentAdapter extends FollowUpQueueOperations`,
  push type in `messages/payload-map.ts` and `apps/ptah-electron/src/replay/scenario-sanitizer.ts`.

## In progress
- Task A batch 4 (renderer, Claude subagent) was STOPPED when the session ended, unfinished.
  Its partial work is in the Task A worktree: `libs/frontend/**` (new
  `chat-state/src/lib/queued-follow-up.store.ts`, `chat/.../queued-follow-ups/`,
  `follow-up-queue.service.ts`, `composer-restore.service.ts`, `tab-busy.ts`,
  `queued-follow-up-event.ts`, many modified services/specs). No batch-4-report.md exists.
  Approved design detail: a slash command typed while busy (and items after it) stays a local
  FIFO item for that tab+session, sent as normal `chat:continue` when idle (batch 1 refuses
  queued slash commands); idle trigger must also fire for hidden tabs; Stop restores local items
  after backend-withdrawn ones.

## Open problems
- Batch 4 completeness unknown: typecheck/test the frontend projects first.
- Reviewer note (Task A batch 3, `codex-chat-adapter.ts` ~892-913 `steerQueuedFollowUp`):
  bare `catch {}` without degradation-audit suppression comment; if steer succeeds but the receipt
  turn id differs, item stays queued → possible double delivery.
- `codex-runtime.types.ts` changed in both branches → possible small merge conflict.
- Baseline env failures on this machine (not ours): codex-runtime `CodexHomeMismatchError`
  170 tests; agent-sdk 3 tests; rpc-handlers 16 Windows symlink/path tests.
- Codex lanes cannot run nx/verify inside their sandbox (spawn EPERM) until PR #949 lands —
  run verify in the coordinator shell, or give lanes in-process tsc/jest --runInBand.

## Key files
- `.ptah/specs/TASK_2026_884_sdk_queue/contract.md` — fixed RPC/push/provider contract + ownership.
- `.ptah/specs/TASK_2026_884_sdk_queue/findings.md` — live SDK/Codex test evidence.
- `.ptah/specs/TASK_2026_884_sdk_queue/batch-{1,2,3}-report.md` — executor reports.
- `.ptah/specs/TASK_2026_885_codex_sandbox/findings.md` — Windows EPERM probe.

## Background work
- Codex lane `156bec72-132e-43c3-a473-70d459a77dff` (code-logic-reviewer) reviewing PR #949
  commit a25af499d; writes `.ptah/specs/TASK_2026_885_codex_sandbox/code-logic-review.md`
  in the Task B worktree. State: running.
- CI on PR #949: watcher was killed; re-check with `gh pr checks 949`.

## Next steps
1. Task A worktree: finish batch 4 (spawn a frontend-developer subagent with contract.md +
   the design detail above, or finish directly). Then
   `npm run verify -- -p @ptah-extension/chat,@ptah-extension/chat-state,@ptah-extension/chat-streaming,@ptah-extension/setup-wizard`
   (confirm header project count).
2. Fix the two batch-3 review notes above.
3. Commit Task A (stage explicit paths incl. `.ptah/specs/TASK_2026_884_sdk_queue`, exclude
   `spikes/codex-schema/` if too large — 321 generated files), scopes per `.commitlintrc.json`
   (e.g. `fix(agent-sdk,rpc-handlers,chat): ...`), push in background with `gh pr create`.
4. Spawn an independent Codex code-logic-reviewer on Task A's PR.
5. `gh pr checks 949` and the Task A PR; read review comments; fix confirmed findings in new commits.
6. Report PR URLs, heads, CI and review state to the user. Never merge, force-push or delete.
