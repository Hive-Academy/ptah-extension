# HANDOFF - TASK_2026_702_594d Elevate the Chat start screen

Written 2026-10-19 by the orchestrator session that continued `c6b9728a`.
Sibling task in parallel: TASK_2026_593_7c2e (attention-first notifications), handoff at
`D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.

## Goal

Empty Chat board: one primary "New session" action, CSS-only Aurora hero, one "Get ready" card,
three recent sessions, and the whole canvas dock bar removed (ticker, needs-you chip,
"+ New Session"). The VS Code single-chat screen gets the checklist and a faint Aurora (#15).

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/chat-start-screen`, branch
  `feat/chat-start-screen` from origin/main `eed1fac30`. `node_modules` is a junction.
- Task folder `.ptah/specs/TASK_2026_702_594d/` (decisions #1-#22).
- **Commits (local only, no remote, no PR yet):**
  - `089bd629a docs(task-specs): add TASK_2026_702 chat start screen specs`
  - `07af8067a feat(chat-ui,chat,ui): shared Get ready store and CSS-only Aurora` (Phase 1)
  - `7debb3b23 docs(task-specs): record TASK_2026_702 phase 2 reviews and checks`
  - `759339e44 feat(canvas,chat,chat-ui,e2e,docs): calm Chat start board without dock` (Phase 2)

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| Phase 2 scoped checks | typecheck 4/4, lint 5/5, e2e typecheck pass, tests ui 695 / chat-ui 1452 / chat 4441 / canvas 422, no-alpha 11/11, audit 294. Two spec-only defects fixed before commit (rail mock `writeFailureCount`; popover "no anchor" test) | #21 |
| Phase 2 commit | `759339e44` (+ `7debb3b23` task specs) | git log |
| Electron visual check | `visual-review.md` REVISE 7/10; screenshots in `visual-review/`; Aurora CPU 1.29-1.44% idle, 0.08% reduced motion; AA contrast passes | #22 |
| Visual fix (codex) + revise round 1 | F1-F6 fixed; orchestrator reverted the lane's document-level Escape in the shared `native-popover`; code review REVISE 7/10 -> round 1 -> re-review **APPROVED** (3 Minor) | `visual-fix-report.md`, `code-logic-review-visual-fix.md` |

## In progress / open (visual fix is UNCOMMITTED)

- No lane or subagent is running for this task.
- Last check run on the uncommitted visual fix (after round 1):
  - **lint error** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:196:99`
    `@angular-eslint/template/eqeqeq`: `session.lastActivityAt == null` -> use
    `session.lastActivityAt === null || session.lastActivityAt === undefined` (or a component
    helper). Typecheck passed.
  - **1 failing spec** `canvas-rail-board.component.spec.ts` "rendering > 0 tiles: the empty-board
    trigger asks for the named popover" (canvas 425/426). Probably the hero copy/markup changed by F3
    (`canvas-rail-board.component.ts:162-176`); read the assertion and fix the spec or the markup.
  - ui 696 pass, chat 4441 pass, no-alpha 11/11, audit 294.
- **Report to the user before merge:** the fix removes "Open Library" from the Ready strip to match
  the approved prototype. Marketplace stays reachable from the app-shell button
  (`app-shell.component.html:205-213`); the skills deep link is lost after setup.
- Re-review Minor items (accepted, not fixed): relative date can go stale until change detection;
  "2h ago" spec tolerates "Yesterday" near midnight; clock-skewed timestamps in the last minute show
  an absolute date.
- Not captured in the visual check: the running cap (needs 9 live sessions) and VS Code single-chat
  280px (not reachable in Electron).
- Phase 3 (unmount needs-you chip, delete `canvas-needs-you-queue*.ts` + spec, update
  `orchestra-canvas.rail.spec.ts`) is **gated on TASK_2026_593's PR (A2-A5) merging**; first update
  this branch from `main`.

## Exact next steps

1. Read this file, `decisions.md` (#19-#22), `visual-review.md`, `visual-fix-report.md`,
   `code-logic-review-visual-fix.md`.
2. Fix the lint error and the failing spec above (small; orchestrator edit or one codex lane).
3. Re-run the scoped checks (one heavy job at a time on the machine; announce to peers if a peer is
   building; tests take > 10 min, run in background):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/chat-start-screen
   P="@ptah-extension/ui @ptah-extension/chat @ptah-extension/canvas"
   npx nx run-many -t typecheck,lint -p $P --parallel=1 --output-style=static 2>&1 | grep -E "error TS|  error |Successfully ran|failed"
   for p in $P; do npx nx test $p --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL |●.*›"; done
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
4. Commit in the foreground with hooks: `fix(canvas,chat): ...` for the visual fix (read
   `.commitlintrc.json`; subject <= 72) plus `docs(task-specs): ...` for the new task files
   (`visual-review.md`, `visual-fix-report.md`, `code-logic-review-visual-fix.md`, decisions, this file).
5. Electron re-check of the fixed states only (empty board 1440px both themes, Get ready card states,
   recent cards, popover with Escape on the anchor): announce "Electron: <session> launching, port
   <free port>, private APPDATA" to every peer (ListAgents) first, "Electron: free" after; kill only
   your own PID tree. Delegate to a visual-reviewer subagent (the build target does not produce the
   renderer folder; the previous reviewer ran `copy-renderer.js` and faked the backend in the main
   process like the e2e `UiDriver`). Show the screenshots to the user before merge.
6. Phases 1-2 ship as their own PR (plan M5): push + `gh pr create` in one background command
   (pre-push runs di-lint and Electron validate-deps). Report the PR link and the Open Library removal.
7. After TASK_2026_593's PR (A2-A5) merges: update this branch from `main`, run phase 3, review, fix,
   commit, second PR. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement (max 3, `ptah_agent_list` before every
spawn, never AT LIMIT, parallel lanes run no nx/jest); Anthropic subagents review; memory-safe scoped
checks only; never `text-base-content/NN`; audit must not rise; commit foreground with hooks, push
background; no `--no-verify`; do not edit notification-center code. Codex weekly 59% at handoff.
