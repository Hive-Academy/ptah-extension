# HANDOFF - TASK_2026_702_594d Elevate the Chat start screen

Written 2026-10-19 by orchestrator session `d343b065` (the continuation of
`ptah-ptah-extension-task-612-follow-up-s-e16b410000xs42qjcizfr0i`).
Sibling task in parallel: TASK_2026_593_7c2e (attention-first notifications), handoff at
`D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.

## Goal

User (2026-10-19, screenshot of the empty Chat board in Electron): three duplicate "New session"
buttons and two mismatched centre cards. Make it one primary action, an animated hero background
(CSS-only ngxui Aurora port, decision #12), one "Get ready" card in the surface-3 style, recent
sessions, and **remove the whole canvas dock bar** (ticker, needs-you chip, "+ New Session").

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/chat-start-screen`, branch
  `feat/chat-start-screen` from origin/main `eed1fac30`. `node_modules` is a junction to the main
  checkout (remove with `cmd //c rmdir node_modules` before `git worktree remove`).
- Task folder `.ptah/specs/TASK_2026_702_594d/`. `task.md` status is now `in_progress` (edited in
  the worktree; `ptah_task_update` cannot see this carrier because it exists only in the worktree).
- **Nothing is committed. The branch is local only (no remote, no PR).**

## Done

| Step | Result | Files |
| --- | --- | --- |
| Context, decisions, requirements, Gate 1 | see previous handoff rows; decisions #1-#12 | `context.md`, `decisions.md`, `task-description*.md`, `parity-inventory.md` |
| Design + revision 1 | Aurora (CSS-only) in spec + prototype; HTML 47 KB | `design-spec.md`, `design-revision-1.md`, `prototype/*` |
| Orchestrator screenshot check | Aurora present, no dock bar, HTML 47,654 bytes | - |
| Design round 1 re-review | Anthropic `ui-ux-designer` subagent: **APPROVED** (0 Blocking, 0 Serious, 2 Moderate N1/N2, 3 Minor N3-N5). Teal light primary = real `anubis-light` token (`tailwind.config.js:154-160`) | `design-spec-review.md` "## Round 1 re-review" |
| Tuning revision 2 (codex lane `c08c2df0`, CLI session `01a15215-8992-77f2-8571-e4d10d61a3ca`) | N1 light Aurora visible (orchestrator viewed `light-empty.png`, `light-single-chat.png`), N3 contrast worst of 3 phases min 4.92:1 both themes, N4 CPU note, N5 token-derived stops note; all 16 screenshots re-captured | `design-revision-2.md`, `design-spec.md`, `prototype/start-screen.html`, `prototype/check-contrast.js`, `prototype/screenshots/*.png` |
| Decisions logged | #13 (review result + tuning), #14 (N2 scope -> user) | `decisions.md` |
| **Gate 1.7 presented to the user** | dark + light screenshot list, decisions #8/#9/#10/#12, the N2 question | (chat message) |

## In progress / open

- **Gate 1.7 waits for the user.** No `APPROVED` was received. Do NOT start the architect or code.
- **Open user decision N2 (#14):** the design puts a low-opacity Aurora behind the logo on the VS Code
  single-chat start screen, but `task-description.md:32-33` puts single-chat Aurora out of scope.
  Option 1: keep it (amend `task-description.md:32-33` and decision #12). Option 2: remove it from
  the design, prototype and screenshots (`dark-single-chat*.png`, `light-single-chat.png`).
- No lane or subagent is running.

## Exact next steps

1. Read this file, `decisions.md` (#1-#14), `design-spec-review.md` (Round 1 re-review),
   `design-revision-2.md`.
2. If the user has not answered Gate 1.7, present it again (screenshots in
   `prototype/screenshots/`: dark-empty, dark-partly, dark-ready-recent, dark-cap, dark-popover,
   dark-layout-warning, dark-layout-warning-tiles, dark-reduced, dark-800, dark-single-chat,
   dark-single-chat-280, dark-single-chat-ready-280, light-empty, light-partly, light-ready-recent,
   light-single-chat; decisions #8, #9, #10, #12; N2 options) and wait for `APPROVED`.
3. On APPROVED: log decision #15 (Gate 1.7 user approval + the N2 choice). For option 1, edit
   `task-description.md:32-33` and add a note to #12. For option 2, a codex `ui-ux-designer` lane
   removes the single-chat Aurora (full brief; no resume) and re-captures the single-chat shots.
4. Architect: codex `software-architect` lane (`ptah_agent_list` first, never AT LIMIT, codex first)
   -> `implementation-plan.md` with file-disjoint phases (<= ~8 files per batch). The chip unmount
   and deletion of `canvas-needs-you-queue*.ts` + spec are the LAST phase, gated on TASK_2026_593
   merging. Include #11 (test id `canvas-new-session-anchor` users: 4 Electron e2e specs,
   `ui-driver.ts:453`, new startup-TTI marker; delete `ActivityTickerComponent`, keep
   `BackOfficeActivityService`), the `aurora-notices.txt` shipping path, and color-mix token stops (N5).
5. Gate 2: fresh Anthropic subagent cross-side review -> `implementation-plan-review.md`
   (lane-review mode: APPROVED passes with a notice; max 2 revise rounds).
6. Implement per phase with codex lanes (max 3 lanes; parallel lanes run no nx/jest). After each
   phase: one Anthropic `code-logic-reviewer` -> one codex fix round -> commit.
7. Verify each phase (one heavy check at a time, never workspace-wide):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/chat-start-screen
   npx nx run-many -t typecheck -p canvas chat --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed|Running target"
   npx nx run-many -t lint -p canvas chat --parallel=1 --output-style=static 2>&1 | grep -E "✖|Successfully ran|failed"
   npx nx run-many -t test -p canvas chat --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|FAIL|Running target"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must not rise
   ```
   Use the real Nx project names; confirm "Running target X for N projects".
8. Electron visual check (dark + light) vs the prototype. Announce "Electron: <session> launching,
   port <free port>, private APPDATA" to every peer (ListAgents) first, "Electron: free" after; kill
   only your own PID tree. At handoff time peer session TASK_2026_699 had sent "Electron: free"
   (port 9391 free); re-check peers before any launch.
9. Commit in the foreground with hooks (read `.commitlintrc.json`; `task-specs` for docs first).
   Push + `gh pr create` in the background. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement; Anthropic subagents do cross-side
document reviews and code-logic reviews; memory-safe scoped checks only (CLAUDE.md); never
`text-base-content/NN`; commit foreground, push background; no `--no-verify`. Lane limits at
handoff: codex 43% weekly (room), grok AT LIMIT until 2026-10-20 17:40 UTC.
