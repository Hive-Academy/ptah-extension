# HANDOFF - TASK_2026_702_594d Elevate the Chat start screen

Written 2026-10-19 by orchestrator session `c6b9728a` (continuation of `d343b065`).
Sibling task in parallel: TASK_2026_593_7c2e (attention-first notifications), handoff at
`D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.

## Goal

Empty Chat board: one primary "New session" action, CSS-only Aurora hero (ngxui port), one
"Get ready" card, three recent sessions, and the whole canvas dock bar removed (ticker, needs-you
chip, "+ New Session"). The VS Code single-chat screen gets the checklist and a faint Aurora (#15).

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/chat-start-screen`, branch
  `feat/chat-start-screen` from origin/main `eed1fac30`. `node_modules` is a junction.
- Task folder `.ptah/specs/TASK_2026_702_594d/` (decisions #1-#20).
- **Commits (local only, no remote, no PR):**
  - `089bd629a docs(task-specs): add TASK_2026_702 chat start screen specs`
  - `07af8067a feat(chat-ui,chat,ui): shared Get ready store and CSS-only Aurora` (Phase 1)

## Done this session

| Step | Result | Files |
| --- | --- | --- |
| Gate 1.7 | user APPROVED; keep single-chat Aurora (#15); `task-description.md:33` amended | #15 |
| Plan + Gate 2 | codex plan; Anthropic review REVISE -> revision 1 -> **APPROVED**; carry-forward N1/N2/n1/n2 in plan | `implementation-plan*.md`, #16 |
| Phase 1 (1A store, 1B Aurora/popover/single-chat, 1C notices) | review REVISE 5.5 -> fix round -> re-review **APPROVED**; user approved removing last-updated time (#17); **committed** `07af8067a` | `code-logic-review-phase-1.md`, `phase-1-fix-report.md` |
| Phase 2 (2A recent sessions, 2B board/rail, 2C shell/ticker, 2D+2E selectors + docs) | review REVISE 6 -> fix round -> re-review **APPROVED** -> bounded correction (`writeFailureCount`, `isEmptyBoard`), reviewed by orchestrator (#19) | `code-logic-review-phase-2.md`, `phase-2-fix-report.md`, `phase-2-correction-report.md`, `batch-2*-report.md` |
| Last full checks (before Phase 2 fix + correction) | typecheck/lint 4/4 (ui, chat-ui, chat, canvas); tests ui 694, chat-ui 1452, chat 4438, canvas 417; no-alpha 11/11; audit 294 | - |

## In progress / open

- No lane or subagent is running.
- **Phase 2 is uncommitted.** Its fix round and correction are not yet covered by a full scoped check
  run (the correction lane ran 159/159 focused canvas tests).
- Known pre-existing failure: `ptah-extension-webview` lint (circular dependency webview <->
  command-center, `app.routes.ts:224`) exists on base (#20). Not this task's change.
- Unmeasured: Aurora CPU/GPU cost and live contrast (needs the Electron visual check).
- Phase 3 (unmount needs-you chip, delete `canvas-needs-you-queue*.ts` + spec, update
  `orchestra-canvas.rail.spec.ts`) is **gated on TASK_2026_593 merging** (the PR with A2-A5); first
  update this branch from `main`.

## Exact next steps

1. Read this file, `decisions.md` (#1-#20), `code-logic-review-phase-2.md` (incl. re-review),
   `phase-2-fix-report.md`, `phase-2-correction-report.md`.
2. Run the Phase 2 scoped checks (one heavy check at a time; tests take > 10 min - run in background):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/chat-start-screen
   P="@ptah-extension/ui @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas"
   npx nx run-many -t typecheck -p $P --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed|Running target"
   npx nx run-many -t lint -p $P @ptah-extension/webview-e2e-harness --parallel=1 --output-style=static 2>&1 | grep -E " error |Successfully ran|failed"
   for p in $P; do npx nx test $p --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL "; done
   npx nx typecheck ptah-electron-e2e --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed"   # confirm the project name
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   grep -rn "canvas-new-session-anchor\|Add new session tile\|Open Marketplace Skills" apps libs --include=*.ts --include=*.md   # only the absence assertion in orchestra-canvas.component.spec.ts may remain
   ```
3. Commit Phase 2 in the foreground with hooks (read `.commitlintrc.json`; e.g.
   `feat(canvas,chat,chat-ui,e2e): ...`, subject <= 72) plus a `docs(task-specs)` commit for the
   new task-folder files.
4. Electron visual check (dark + light, empty / partly / ready+recent / cap / popover / layout warning
   / reduced motion / 800px / single-chat 280px) vs `prototype/screenshots/`; measure Aurora CPU.
   Announce "Electron: <session> launching, port <free port>, private APPDATA" to every peer
   (ListAgents) first, "Electron: free" after; kill only your own PID tree. Show the screenshots to the
   user before merge.
5. Phases 1-2 ship as their own PR (plan M5): push + `gh pr create` in one background command
   (pre-push runs di-lint and Electron validate-deps). Report the PR link.
6. After TASK_2026_593's PR (A2-A5) merges: update this branch from `main`, run phase 3, review, fix,
   commit, second PR. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement (max 3, `ptah_agent_list` before every
spawn, never AT LIMIT, parallel lanes run no nx/jest); Anthropic subagents review; memory-safe scoped
checks only; never `text-base-content/NN`; audit must not rise; commit foreground with hooks, push
background; no `--no-verify`; do not edit notification-center code. Codex weekly 55% at handoff.
