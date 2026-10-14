# TASK_2026_629_c0b3 — HANDOFF (twelfth handoff: R9 shipped as PR, follow-ups start after the merge)

> File name: `handoff-12.md`. NEVER write `HANDOFF.md` (row 91). The next handoff is `handoff-13.md`.

## 1. State at handoff

- Branch `feat/task-629-canvas-board` pushed; PR opened for R9 (Rail board replaces Grid board). The user merges it.
- Session 12 commits: `e838659a6` dedupe + Fix D, `73556b428` split headers + Fix H, `41dfa6056` Rail card,
  `10a660318` contrast + visible agent notice + ratchet fix, merges of origin/main `b648b6e57`, `af028f886`,
  then the docs commit with this file.
- Final checks (HEAD af028f886): canvas 23/346, chat-ui 72/1425, chat 205/3776 (2 skipped), chat-state 25/568,
  tribunal-panel 17/336 (Mode 2), webview ratchet 11/11; typecheck 0 errors; lint 0 errors.
- Automated Electron re-check PASS (`recheck-s12-fix-report.md`). Mode 3 INCOMPLETE on evidence only; the user
  waived the gaps (row 126). Decisions this session: rows 115-126 in `decisions.md`.

## 2. Follow-up tasks (after the PR merges; each in a NEW worktree from main, CLAUDE.md "start every task in its own worktree")

Create one task folder per item (new TASK IDs), in this order:

1. **Agent tiles + lane stats header** (rows 112, 114, 116; FEATURE, UI surface -> designer, prototype,
   cross-side review, Gate 1.7 first). CLI-agent and sub-agent lanes become tiles with CLI provider icons in the
   main view; tiles show permission requests and user-question notifications (closes the Electron single chat
   permission gap, `code-logic-review-agents-dedupe.md` finding 2); the lane header uses the main session stats
   strip (MODEL, CONTEXT, TOKENS, COST, TIME; same component and style) for `cli:`, `bg:`, `sub:` lanes; restored
   sub-agents (record not in the stores) can open their lane (`recheck-s12-report.md` F-E). Carry over: Fix D
   re-review M2 (ownership branches untested), Fix D3 Minors (`code-logic-review-fix-d3.md`), `$agents` display
   is not a duplicate (dedupe review Minor 7). Notice overlay covers the stats strip for 4 s (recheck-s12-fix).
2. **R9 parity tests** (row 126; test-only): specs for parity rows 8, 10 (Rail part), 37, 79, 80, 82, 85, 91,
   116, 123 (`mode3-r9-completion-report.md` "Rows without a proving test"); fix stale selectors in
   `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:57-58`; copy parity rows 117-124 from
   `implementation-plan-rail-r9-split.md` into `parity-inventory-layout.md`.
3. **R9 cleanup follow-up** (row 108; REFACTORING): ~650 lines dead Grid code (`canvas-layout-intent.ts`, store
   `commitDragIntent`/`toggleLayoutFocus`), board `max-lines`, `RAIL_MIN_CONTENT_WIDTH` location, cap 4 written
   twice, repeated 360/400/1440 literals, hand-rolled header menu; phase style F1-F12; canvas lint warnings (31).
4. **Rail state colors across all shipped themes** (rows 123, 124): focus frame < 3:1 in 13/32 DaisyUI themes,
   pill text < 4.5:1 in 23/32 (`codex-review-fix-c2.md`), split header state chip
   (`canvas-focus-header.component.ts:12-16`), `canvas-rail.component.ts:51-63`.
5. **Rail switch long tasks** (row 121): 8/10 swaps still have a long task > 50 ms (`recheck-s12-report.md`
   check 3, `switch-baseline.md`).

The full recorded-not-fixed list is in the PR body (`.ptah/tmp/pr-629-body.md`) and `mode3-r9-completion-report.md`
Check 4. Also open: TASK_2026_653_2931 (sidebar strip, Details resizer, cursor audit).

## 3. After the 629 merge

- `SendMessage` to the 628 session (text in `handoff-8.md` §3 step 11).
- Set `task.md` status to `done`. Remove this worktree only when the user says so (CLAUDE.md).

## 4. Rules (repeat in every lane and sub-agent prompt)

Checks through `node .ptah/tmp/check-run.mjs <label> -- <command>` (machine-wide lock; copy the script into the new
worktree). Writers: changed specs only, `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2
--parallel=1 --skip-nx-cache`, never --testPathPattern. Mode 2: each changed project's full suite, then typecheck
and lint, --parallel=1 --skip-nx-cache. One heavy check at a time; no workspace-wide runs; no build/serve/dev/e2e/
package except the Electron renderer rebuild; no npm install; ask before `npm rebuild better-sqlite3` or a
package.json change; no git in `D:\projects\ptah-final-run-ws` without asking. Reviewer briefs: write only the
named deliverable, never `code-logic-review.md`. At most 3 parallel CLI lanes. Commits foreground, explicit paths,
`.commitlintrc.json` scopes, subject <= 72, Co-Authored-By line; push in the background.
