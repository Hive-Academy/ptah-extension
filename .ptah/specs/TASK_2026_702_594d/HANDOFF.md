# HANDOFF - TASK_2026_702_594d Elevate the Chat start screen

Written 2026-10-20 by orchestrator session `notification-final` (continued the earlier
`task-593-702` handoff). Sibling task: TASK_2026_593_7c2e (attention-first notifications), handoff at
`D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.

> **Superseded 2026-10-20 (session `notification-fixes`):** read the combined handoff
> `D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.
> PR #785 is all green at `35c9a8c59` (session-create helper fix `8a0ce5c60`; lane Open parity
> `35c9a8c59`, user decision "fix in #785 now", review APPROVED 8/10). Ready for the user to merge.

## Goal

Empty Chat board: one primary "New session" action, CSS-only Aurora hero, one "Get ready" card,
three recent sessions, and the whole canvas dock bar removed (ticker, needs-you chip,
"+ New Session"). Phase 3 removes the needs-you chip now that the attention bell (#780) covers it.

## Where

- **PR #781 MERGED** 2026-10-20 01:49 UTC (squash; branch `feat/chat-start-screen` deleted on the
  remote). Old worktree `.claude-worktrees/chat-start-screen` still exists; remove only when the
  user says (`cmd //c rmdir .claude-worktrees\chat-start-screen\node_modules`, then
  `git worktree remove .claude-worktrees/chat-start-screen`).
- **Phase 3: PR #785 OPEN** https://github.com/Hive-Academy/ptah-extension/pull/785, base `main`,
  branch `feat/chat-needs-you-removal`, worktree
  `D:/projects/ptah-extension/.claude-worktrees/chat-needs-you-removal` (node_modules junction).
  After the squash merge of #781 the branch was merged with `origin/main` again; the PR now shows
  only the 9 phase 3 files and is MERGEABLE.

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| CI #781 | all green (17 pass), user merged | `gh pr checks 781` |
| Phase 3 implementation | codex lane: chip mount, `@defer` block, placeholder and wrapper row removed from `orchestra-canvas.component.ts`; four `canvas-needs-you-queue*.ts` files deleted; stubs removed from both shell specs; one absence assertion | `phase-3-report.md`, commit `de5756f04` |
| Phase 3 review | Anthropic code-logic review APPROVED 8/10, minors only | `code-logic-review-phase-3.md` |
| Phase 3 checks | `@ptah-extension/canvas` typecheck+lint+test pass; `ptah-extension-webview` typecheck pass; webview `no-alpha-base-content` 11/11; degradation audit 291 | this session |
| PR #785 | opened against main; merge of origin/main after the squash | `gh pr view 785` |

## Open / next steps

1. **Watch CI on #785** (10 pass, 6 pending at handoff). Fix real failures with one bounded codex
   lane + an independent Anthropic review; reply to CodeRabbit comments (CodeRabbit hit its free
   OSS review limit on #783, so it may not review #785).
2. **Parity gap (user decision, report it):** the chip's Open selected the exact canvas lane detail
   pane (`CanvasDetailService.open`); the bell's Open focuses the owning session only. The review
   judged it Minor and covered by `parity-inventory.md:33` ("opens the relevant session"). Ask the
   user whether an optional follow-up should route lane-permission Open to the lane pane.
3. Minor later polish: stale comment `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:265-269`
   still says the ticker "lives in the canvas dock row" (not edited: a comment-only change would add
   the 4,441-test chat suite to the scoped checks). Earlier accepted minors from the previous
   handoff stay (neutral eyebrow/badge, row dividers, Aurora edge, stale relative dates).
4. Optional: an Electron visual check of the canvas without the chip (dark + light), before/after.
5. No local-only branch at the end: `feat/chat-needs-you-removal` is pushed with PR #785.

Scoped re-check commands (run from the worktree, one heavy job at a time on the machine):

```bash
npx nx run-many -t typecheck,lint,test -p @ptah-extension/canvas --parallel=1
npx nx typecheck ptah-extension-webview
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -2   # must stay <= 291
```

## Standing user rules

Orchestration + agent-lanes skills; the user said "fix with our cli tools": codex CLI lanes
implement (`ptah_agent_list` before every spawn, never AT LIMIT, max 3, parallel lanes run no
nx/jest); Anthropic subagents do code-logic reviews; memory-safe scoped checks only (`--parallel=1`,
Jest `--maxWorkers=2`, one heavy job at a time, coordinate with ListAgents/SendMessage
"checks: free"); never `text-base-content/NN`; audit must not rise; commit foreground with hooks,
push + `gh pr create` in the background; announce Electron launches ("Electron: <session>
launching, port N, private APPDATA") and send "Electron: free" after; do not edit
notification-center code. Codex weekly 65% at handoff (resets 2026-10-24 20:40 UTC).
