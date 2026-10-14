# Handoff: subagent budget handoff fix (worktree fix-subagent-handoff-notice)

Worktree: D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice
(branch fix/subagent-handoff-notice, node_modules is a junction; run checks from worktree cwd).
Do not push. Commit scope `agent-sdk`, subject <= 72, body wrapped at 72, end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Done
- COMMIT 1 d41cb2c01: monitor tracks main-thread tool_result for spawning Agent/Task ids
  (`SessionState.spawnReturned`); background -> `pushParentMessage` (user turn), foreground ->
  notice queue (`postMainThreadNotice`), withdrawn + pushed if its tool result arrives undrained
  (`MainThreadNoticeQueue.withdraw`). Handoff text names Ptah's budget monitor, not the user.
  Tap in session-query-executor forwards main-thread user tool_result messages.
- Verified: changed specs pass; typecheck ok; lint 0 errors.
  off-thread-process-spawner.spec timeout = environmental, unrelated.

## DONE COMMIT 2 e9eb86525 (b) — as designed below; message lives in
`compaction/subagent-handoff-message.ts`, files in `subagent-handoff-files.ts`.

## (was) COMMIT 2 (b) hard-stop message completeness
Design chosen:
- New `helpers/compaction/subagent-handoff-files.ts`: `SubagentHandoffFiles(logger, workspaceOf)`
  with `paths(sessionId, toolCallId)` -> `{ notes, task }` under
  `<workspace>/.ptah/subagent-handoffs/<sanitised toolCallId>.md` / `.task.md`; `saveTask`, `notesExist`.
  workspaceOf = `SessionLifecycleManager.getSessionWorkspace(sessionId)` resolved lazily in DI.
- Monitor stores full prompt + `name` from the spawning tool_use input; at hard stop writes the
  task file and checks the notes file; message lists type/name, task file path, notes file
  path or "missing", output file = the SDK task_notification's output_file (only known after
  the stop), and instructs: spawn a fresh subagent of same type and name with the original
  task + "read <notes> first and continue from it; do not redo finished work".
## Then: COMMIT 3 (a) soft warning at ~85% of subagentHandoffTokens
- Channel: subagent PostToolUse `additionalContext` (input.agent_id set). Mapping
  toolCallId -> agentId from SubagentRegistryService record (`agentId`, set by SubagentStart).
  Exactly once per subagent; never main thread / other subagent. Same notes path as (b).
  Tests: mapping, once-only, no-file case for (b).

## COMMIT 3 progress (developer 3)
- Source done (uncommitted): `helpers/subagent-notice-queue.ts`, monitor `warnNearBudget`,
  `nearBudgetWarning` text, PostToolUse handler `takeNotice`, DI registration.
- Monitor spec `describe('near-budget warning')` written (6 tests).
- Mapping verified: SubagentHookHandler.handleSubagentStart registers {toolCallId: toolUseId,
  agentId: input.agent_id}; the subagent's PostToolUse carries the same SDK agent_id.
- Added: post-tool-use-hook-handler.spec subagent routing test; subagent-notice-queue.spec.
  4 changed specs pass (136 tests). No-file stop case already covered by commit 2 (spec ~1111).
- Monitor went over max-lines (700): moved adviseSubagentResume + its types to
  `compaction/subagent-resume-advice.ts` (helpers/index.ts + monitor spec imports updated).
- DONE COMMIT 3 e5044ead1. nx test agent-sdk: 3344 pass, 1 fail (off-thread-process-spawner
  env timeout); typecheck ok; lint 0 errors. Not pushed.

## Session 2026-10-14 (continuation)
- Codex review R1: code-logic-review.md, NEEDS_REVISION (2 blocking, 2 serious, 1 moderate).
  Codex CLI Session ID for re-review resume: 01a137e8-ecf6-7010-9a52-169ffa69b315
- Fix round: backend-developer subagent, report fix-round-report.md, changes left uncommitted
  for the orchestrator to verify (nx test/typecheck/lint agent-sdk) and commit.
- Codex R2: code-logic-review-r2.md NEEDS_REVISION (finding 2 partial). Session ID 01a13814-c88c-7151-97d1-585bba8b1297. Fix round 2 -> fix-round-2-report.md (last revise round).
