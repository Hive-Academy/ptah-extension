# HANDOFF — TASK_2026_632_a6b1

Report budget-monitor subagent stops as Ptah stops, not "stopped by user".

- Branch: `fix/budget-monitor-stop-reason`
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-budget-monitor-stop-reason-63e500ba965b`
- PR: https://github.com/Hive-Academy/ptah-extension/pull/743 (base `main`)
- Parent session: `b0d92e1b-db38-46a4-b5ca-bbd513e25c92` (this was child session "632 budget stop reason")

## Goal

When `SubagentBudgetMonitor` stops a subagent (reason `handoff` or `safety`), the SDK
`task_notification` says `Agent "x" was stopped by user`. The UI, the transcript and child
sessions must show a Ptah stop notice instead. The notice gives the reason and the token
figures. It also says that the user did not stop the subagent, that it cannot resume, and
that a fresh agent with a handoff must start.

## What is done

Commits on `fix/budget-monitor-stop-reason` (pushed, in PR #743):

1. `32f54f26a` fix(agent-sdk): report budget-monitor subagent stops as Ptah stops
2. `03aeee47c` docs(task-specs): record TASK_2026_632 decisions, reviews and lanes
3. This HANDOFF.md commit (docs(task-specs)).

Implementation (paths under `libs/backend/agent-sdk/src/lib`):

- `helpers/compaction/subagent-stop-notices.ts` (new): `SubagentStopNotices` with
  `record(sessionId, taskId, text)`, `noticeFor(taskId)`, `forgetSession(sessionId)`.
- `helpers/compaction/subagent-handoff-message.ts`: new `stopNotice(subject, usage)` builder.
- `helpers/compaction/subagent-budget-monitor.ts`: `stop()` records the notice before
  `dispatcher.stopSubagent(...)`. `release()` forgets the session and its stale aliases.
- `message-transform/system-message.transformer.ts`: for `status === 'stopped'` the summary is
  `stopNotices.noticeFor(task_id) ?? msg.summary`.
- `message-transform/transformer-helpers.ts`, `sdk-message-transformer.ts`: wire `stopNotices`.
- `di/tokens.ts`, `di/register.ts`: new token, one singleton shared by monitor and transformer.
- `src/index.ts`: exports `SubagentStopNotices`.
- Specs: monitor, system-message transformer, sdk-message transformer, replay/artifact parity,
  `session-query-executor.service.spec.ts`, DI smoke spec, and
  `libs/backend/auth-providers/.../codex/codex-stream-parity.spec.ts`.

Review: code-logic-reviewer, one fix round, re-review APPROVED (`code-logic-review.md`).

Checks (local, worktree):

- `npx nx typecheck agent-sdk` PASS, `npx nx lint agent-sdk` PASS.
- `npx nx test agent-sdk`: 3459 passed. 4 suites / 3 tests fail only because of the `marked`
  environment problem (see below).
- auth-providers typecheck and lint PASS.

## In progress

Nothing. No subagents or CLI lanes are running. Lanes `586f9732` and `282ba261` completed.
The final report went to the parent session.

## Open problems and decisions

Decisions D1–D6 are in `decisions.md`. Open items:

- CI must confirm the DI smoke spec (`di/register.compaction-boundary-registry.smoke.spec.ts`)
  and `codex-stream-parity.spec.ts`. They cannot run locally because of the `marked` problem.
- Environment problem: Jest `moduleNameMapper` maps `marked` to
  `<worktree>/node_modules/marked/lib/marked.umd.js`, which is missing in this worktree.
  Affected: DI smoke spec, tool-output-capper, deleted-exports.contract, sdk-adapter-events
  (3 barrel tests). Not caused by this change.
- The notice is in memory only. Replay after a host restart shows the SDK text.
- Accepted trade-off: if all stop attempts fail, the notice stays. A later real user stop of
  the same task then shows the Ptah text.
- The 150k default `compaction.subagentHandoffTokens` may be too low. Scope change, not done.
  Ask the user before any change.
- The SDK injects its own notification text into the model. The host cannot rewrite it. The
  handoff message already says "The user did not stop it".

## Key files

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-stop-notices.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-message.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`, `di/register.ts`
- Task folder: `.ptah/specs/TASK_2026_632_a6b1/` (task.md, context.md, decisions.md,
  lane-report.md, lane-fix-report.md, code-logic-review.md)

## Next steps

1. Watch CI on PR #743: `gh pr checks 743`.
2. If CI fails, fix it in this worktree only. Lanes never commit. Run the checks one at a time:
   - `npx nx typecheck agent-sdk`
   - `npx nx lint agent-sdk`
   - `npx nx test agent-sdk --maxWorkers=2 --coverage=false`
   - `npx nx run-many -t typecheck,lint,test -p auth-providers --parallel=1`
   Never pass Jest flags to typecheck. Never run build, serve, e2e or package.
3. Commit in the foreground (read `.commitlintrc.json`, subject <= 72 chars, body lines
   wrapped at 72). Push in the background.
4. The user owns the merge and the worktree removal. Do not merge and do not remove the
   worktree.
