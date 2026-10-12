# Handoff - TASK_2026_623_3492 (2026-10-12, session 9 to 10)

## Goal

Close TASK_2026_623 (agent-controlled display panel): green CI on PR #704, the populated-surface visual check, then
Gate 3 with the user. Never merge into main.

## Where the work is

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel` (never the main checkout).
- Branch `feat/task-623-display-panel`, pushed. PR https://github.com/Hive-Academy/ptah-extension/pull/704 (open).
- HEAD `b57766c74` fix(chat,chat-ui,shared): clear PR #704 CI failures. Before it: `edd0c4093` merge of origin/main,
  `6e5e6ab30` TASK_2026_630 follow-up task, `621407e63` Mode 3, `080284a1b` Batch 33 accepted.
- Local-only backup branch `backup/task-623-pre-merge`: keep, do not push.

## CI fix round (session 9, Codex lanes, `ci-fix-report.md`)

| Failing job | Cause | Fix |
| --- | --- | --- |
| test shard 3 | main's specs render the new tool-call header without `FILE_LINK_OPENER` | provider added in 6 chat specs |
| checks / degradation-audit | rpc-handlers 2 vs baseline 1: `lane-plan-limits-rpc.handlers.ts` `errorName` catch | documented `degradation-audit: optional-capability` suppression with reason (baseline unchanged) |
| SonarCloud (reliability D) | 14 issues | localeCompare sort, linear scanning in `ptah-ui-parser.ts`, dock separator is a `<button role="separator">`, replaceAll, codePointAt |
| electron-e2e shard 1 | main's `change-set-card.spec.ts` expects the card; on Electron the chip replaces it (#5, #10, #106) | e2e `change-set-card.spec.ts` and `visual-review.spec.ts` now assert the turn summary chip |

Local checks: typecheck chat, chat-ui, shared, declarative-dashboard, rpc-handlers PASS; lint chat 35 warnings
(35th is pre-existing `session-budget-banner.ts`), e2e project 15 warnings, 0 errors; chat agent-card + transcript
specs 207/207. E2E was NOT run locally: the CI run on `b57766c74` is the first real check.

Note: `avatarTone` now hashes code points, so names with astral characters (emoji) may change colour. ASCII unchanged.

## Populated-surface visual check: NOT done

`visual-review-populated.md`: INCONCLUSIVE. Nothing on CDP 9333; one relaunch of `dist\apps\ptah-electron` with
`--remote-debugging-port=9333` exited within ~35 s. The #155 rebuild approval is used up; ask the user before
rebuilding. Gate 3 still needs this check (#162: switch provider to Claude or Codex in Settings, never record keys).

## Open todos

1. Watch CI on PR #704 for `b57766c74`; fix any remaining failure (especially electron-e2e and SonarCloud).
2. Make the app launchable with CDP 9333 (read Electron's exit output), then run the populated-surface check.
3. NFR Tests gap: `npx nx test <p> --parallel=1`, one at a time: ptah-electron, ptah-extension-vscode,
   @ptah-extension/{agent-sdk, cli-agent-runtime, cli-engine, rpc-handlers, vscode-lm-tools, chat, chat-ui,
   declarative-dashboard, shared}.
4. Update the PR #704 Test plan with results. Update TASK_2026_630 item 1 from the visual check.
5. Gate 3 to the user.

## Pitfalls

- CLAUDE.md memory-safe rules: changed projects only, `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a
  time, no build/serve/dev/e2e/package without the user's approval, filter output with `tail`.
- Jest via bash without a `--moduleNameMapper` override (`node_modules\marked` junction exists).
- Never stage `.gitignore` (local `.opencode/agent/` line) or the untracked `.ptah/specs/TASK_2026_623_3492` reports.
- No bare `git stash`, no force push, no merge into main. Commit trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Codex lanes: `cli: codex`, `model: gpt-5.6-terra`, `workingDirectory` = worktree, declare `deliverables`.
- On Electron the turn summary chip replaces the change-set card by user decision #5: do not restore the card.
