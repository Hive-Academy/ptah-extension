# TASK_2026_629_c0b3 — HANDOFF (seventh handoff, R9 implementation in progress)

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). HEAD `5a86ca72b`. Task folder TF: `W\.ptah\specs\TASK_2026_629_c0b3`.
This file REPLACES `handoff-6.md` §1 and §3 as the source of truth. Still valid: `handoff-6.md` §2 (item definitions),
§4 (rules), §6 (recorded-not-fixed list for the PR body); `handoff.md` §4 (final-run tools), §6, §7.
Decisions: `decisions.md` rows 75-81 are new in this session — read them.

## 1. Goal

R9 phase of the Orchestra Canvas Rail board: Grid mode removed (Rail is the only board), plus items 1 (Rail named
New-session popover), 2-3 (restore the production display dock in the focused Rail session — PROTECTED capability,
row 77), 5 (Rail hover/pointer), 6 (strict CLI-agent ownership on Rail cards), 7 (sub-agent tiles in the main
transcript + live full view), 9 (Grid removal), 10 (smooth light switching), 11 (panel Turn summary in the inline
mini-card style, row 76), 12 (Rail split focus: 2 live sessions, row 80), 13 (Rail reorder Move up/down, row 80 —
an orchestrator assumption the user did not object to; confirm if in doubt). Items 4 and 8 are dropped.
The user wants this for a product video; visual quality and switching performance matter.

## 2. Done this session (nothing committed yet — all R9 code is UNCOMMITTED in W)

| Step | Result |
|---|---|
| Item 10 baseline | `switch-baseline.md` (build `1908f240e`): 10/10 Rail swaps have a long task; median task 422 ms; longest task median 124 / max 289 ms; 5k-17k elements re-created per swap; CLS 0. Script `.ptah/tmp/final-run/s-switch.mjs` (`TAG=`, `SWAPS=`, `TRACE=`), raw JSON + 36 MB trace in `%TEMP%\629-switch-baseline*.json`. The dev profile board is now in Rail mode. |
| R9 plan | `implementation-plan-rail-r9.md` (codex). Gate 2 cross-side (Claude): `-review.md` REVISE 6 → `-rereview.md` REVISE 7.5 → `-rereview-2.md` **APPROVED 9/10** (lane-review mode). Parity rows 45-116 in `parity-inventory-layout.md`. |
| User gate | Grid removal list APPROVED except "several live chats side by side" → kept as item 12 split focus (row 80). `gridstack` stays in package.json (Tribunal imports it) — no package.json change. Executors mixed (row 78) with a per-batch cross-family review before each commit (row 79). |
| Split addendum | `implementation-plan-rail-r9-split.md` (codex; items 12-13, parity rows 117-124 as a table inside it, batches R9u-R9x). Review `-split-review.md` REVISE 6/10 (4 Serious). Revise round 1 DONE by codex `19581dc0` (Revision 1 table appended; CLI session `01a1375a-79a9-7e52-90ec-b3e7d497628c` for revise round 2) — **NOT re-reviewed yet**. Row 81: R9f/R9h run as approved; only R9u-R9x carry split deltas. |
| Batches | Team-leader Mode 1 wrote `batches-rail-r9.md` (20 batches R9a-R9t, waves W1-W6 + H1-H3, executor + reviewer per batch, exact check commands). Row 81 lifts the HELD state of R9h/R9f (they follow normal dependencies). R9u-R9x are not in `batches-rail-r9.md` yet. |
| Check lock | `W\.ptah\tmp\check-run.mjs <label> -- <command>` — machine-wide mkdir lock `%TEMP%\ptah-629-check.lock`, log `%TEMP%\629-check-<label>.log`, prints filtered summary. Every writer/reviewer/Mode 2 test, typecheck and lint MUST go through it (one heavy check at a time). Stale lock (> 45 min) is taken over. |

### Wave 1 state (files edited in W, uncommitted)

| Batch | Writer | Spec result | Review (row 79) | Next |
|---|---|---|---|---|
| R9a persistence grid→rail | codex | 26/26 after fix | `code-logic-review-R9a.md` APPROVED 8/10; fix round done (Moderates 1-2, Minor 3) | Mode 2 |
| R9d strict ownership (Rail only) | codex | after fix: card 45/45, rows 8/8, canvas lane tabs 6/6 (strict when SESSION_CARD_ACTIONS or SESSION_CONTEXT is injected; main panel tolerant) | `code-logic-review-R9d.md` 7/10 approve-with-fixes; fix round done (main panel tolerant, card spec pins both hosts, Now-line asserts) | Mode 2 |
| R9g opt-in sub-agent tile | codex `f2309cce` | 3 focused specs pass (`lane-R9g-report.md`) | NOT reviewed yet → Claude code-logic-reviewer | review → fix → Mode 2 |
| R9b Rail named popover, Grid host out of orchestra | Claude `fd-R9b` (stopped) → finished by new frontend-developer `afbd63a4499661a73` | done: rail spec 14/14, component 30/30, rail-board 26/26; FULL canvas 421/421 (34 suites); TC canvas pass; LINT canvas 0 errors / 22 warnings (none R9b). Cap checks live only in the host (R9-D1); a cap refusal is announced in the dock status line. Risks: the disabled empty-board button can still be clicked; the "board is full" text is duplicated in R9c `canvas-rail.component.ts`; Grid-only files stay until R9p. See `lane-R9b-report.md` | NOT reviewed yet → codex reviewer lane | review → fix → Mode 2 |
| R9c Rail hover/pointer | Claude `fd-R9c` | done: chat-ui 18/18, canvas 8/8; heights 176/96/70 and N1/N2 unchanged; card host stays `listitem` (not `button`) — reason in `lane-R9c-report.md`, reviewer must judge it | NOT reviewed yet → codex reviewer lane | review → fix → Mode 2 |

R9g (specs 30/30, 4/4, 18/18): **known defect for its review** — `subagent-tile.component.ts` imports the chat-ui
formatter `formatAgentElapsed` by a RELATIVE SOURCE PATH into chat-ui (not through `@ptah-extension/chat-ui`). That
breaks the "import other libs only through their barrel" rule and will likely fail `nx lint chat`
(`@nx/enforce-module-boundaries`). Fix in the R9g fix round: export the formatter from the chat-ui barrel (that file
belongs to no other R9 batch — check `batches-rail-r9.md` first) and import it via `@ptah-extension/chat-ui`. The lane
also saw "unrelated sibling errors" in scoped diagnostics — Mode 2 typecheck decides.

Codex lane CLI sessions (for resume within ~60k tokens): R9a `01a13756-10d6-7200-afdf-6f78060d69c1`,
R9d `01a13756-3178-74b1-ae6f-eb6df6686bda`, R9g `01a13756-63b9-7c43-8757-92a17958a7ad`; others in `context.md`.
A resume above 60k tokens starts a fresh lane with a brief — then give complete instructions.

## 3. Next steps (in order)

1. **Wave 1 reviews (row 79).** R9g → Claude `code-logic-reviewer` (`code-logic-review-R9g.md`). R9b and R9c →
   codex reviewer lanes (`codex-review-R9b.md`, `codex-review-R9c.md`; `cli: codex`, `role: code-logic-reviewer`,
   deliverables, `timeout: 1200000`). One fix round per batch by the same writer (Claude batches: a fresh
   `frontend-developer` subagent with the report + review paths). Moderates fixed only if they can lose data or
   break behaviour the contract names; Minors recorded.
2. **Team-leader Mode 2 for Wave 1** (fresh team-leader; give it the 5 report + review paths). It runs, SERIALLY via
   the lock runner, FULL canvas (first run after the main merge), TC/LINT canvas; FULL chat-ui, TC/LINT chat-ui;
   FULL chat, TC/LINT chat; then commits R9a, R9b, R9c, R9d, R9g one by one in plan order (foreground commits,
   `.commitlintrc.json` scopes, explicit paths). Also commit the task docs (TF) in a `docs(canvas)` commit.
3. **Split addendum re-review** (Claude subagent, scoped to findings 1-9 + Revision 1) → APPROVED or revise round 2
   (last) by codex. Then team-leader adds R9u-R9x to `batches-rail-r9.md` after the batches that own the same files.
4. **Waves 2-6, H1-H3, then R9u-R9x** per `batches-rail-r9.md` (W2: R9e codex, R9n Claude, R9o Claude, R9i opencode;
   W3: R9p, R9j, R9q opencode; W4: R9m, R9r opencode; W5: R9k codex, R9s opencode; W6: R9t codex; H1 R9h, H2 R9f,
   H3 R9l codex). Max 3 codex lanes (writers + reviewers), max 2 Claude writers, max 5 writers. Each batch: writer →
   cross-family review → one fix round → Mode 2 (serial checks via lock runner) → commit.
5. **Phase review**: one Claude `code-logic-reviewer` on the whole R9 diff (codex/opencode code) and one codex reviewer
   lane on the Claude-written batches; one fix round; one scoped re-review. Check the rule "no host that shows a
   transcript sets `HIDE_AGENT_SIDEBAR: true`" (row 77).
6. **Rebuild renderer only** (background, log `.ptah/tmp/final-run/build-renderer.log`): `npx nx build-dev
   ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev
   ptah-electron --parallel=1`.
7. **User Electron test with video**: `cd W/.ptah/tmp/final-run; rm -f ready stop`, background
   `node launch.mjs "D:\projects\ptah-final-run-ws"`. Give the user the step list = plan "## Electron re-check list
   (R9)" + the addendum's split/reorder steps (Rail only). Wait for "done" (the user may close the window). Then with
   the app open (relaunch if closed): `s-heap` (0 detached `ptah-canvas-lane-view` / `ptah-canvas-detail-transcript` /
   `chat-msg-slot`, no Grid DOM, ≤ 1 live ChatView in the board host — ≤ 2 with split on; heap MB, element count,
   retained count ≤ 4), contrast #10 both themes incl. M5, `TAG=after-r9 node step.mjs s-switch.mjs` (compare with
   `switch-baseline.md`), screenshots `after-r9-rail-{anubis,anubis-light}.png` via `s-theme`; show before/after
   (before = `shots/before-r9-rail-*.png`); write a "Re-check" section in `final-run-review.md`. `s-board.mjs` is obsolete.
8. **Ask the user** before `npm rebuild better-sqlite3` (still Electron ABI in the shared `D:\projects\ptah-extension\node_modules`).
9. **Team-leader Mode 3** (parity rows 1-124, write-path trace for persistence, screenshots shown).
10. **Push + PR in one background command**: `git push -u origin feat/task-629-canvas-board && gh pr create ...`
    (title < 70 chars, `## Summary` + `## Test plan`, list handoff-6 §6 recorded-not-fixed items + the Grid removal,
    end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Pre-push runs di-lint + Electron
    validate-deps; a failed gate needs a fix commit, then push again.
11. **When 629 merges**: `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with the new
    BL heap result (Rail board; ≤ 1 live ChatView, ≤ 2 with split on) and that Grid mode, `ptah-canvas-tile` grid
    hosting and `gridstack-item` were removed in 629 (row 73), so the 645 M-final measurement must use the Rail board.

## 4. Rules (repeat in every lane and sub-agent prompt)

- STRICT checks, always through the lock runner from W:
  `node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  (never --testPathPattern); writers run only their specs; Mode 2 runs FULL / `npx nx typecheck <p> --parallel=1
  --skip-nx-cache` / `npx nx lint <p> --parallel=1 --skip-nx-cache`. No workspace-wide runs, no
  build/serve/dev/e2e/package except the Electron re-check, no npm install.
- Writers and reviewers never run git that changes state; other writers edit W at the same time — never revert.
- Do not run git commands in `D:\projects\ptah-final-run-ws` without asking the user.
- Commits: foreground; push in the background. Subject ≤ 72, body lines ≤ 100 (wrap 72), end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Lanes: `cli: codex` (or `opencode` for small deletions), `role`, `workingDirectory` = W,
  `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables`, `timeout: 1200000`, ≤ 40 tool calls.
  Codex weekly limit was 6% used at session start.
- End each turn with a short summary of what is done and what is left.

## 5. Open problems and decisions

- Item 13 (Rail reorder) was added as an assumption from the recommended option; the user picked "Keep side-by-side too".
- Split focus changes the BL budget to "≤ 1 live ChatView, ≤ 2 while split is on" (row 80); the 628 message must say so.
- R9f/R9h will be reworked by R9u-R9x (row 81) — accepted cost.
- Interaction risk: R9d turns strict when `SESSION_CARD_ACTIONS` OR `SESSION_CONTEXT` is injected. R9n plans a
  single-view `SESSION_CARD_ACTIONS` handler in `chat-transcript`. If the main-panel compact card can see that
  provider, the main panel turns strict by accident. Tell the R9n writer and its reviewer to check this, or key R9d on
  `SESSION_CONTEXT` only.
- Recorded, not fixed (PR body): handoff-6 §6 list (M5, M2, M3, M4, M7, M8, m1-m7, style Moderates 2-5, the 3
  correction Minors, TASK_2026_653_2931 follow-ups) plus the review Minors of this phase.

## 6. Key files

TF: `implementation-plan-rail-r9.md`, `implementation-plan-rail-r9-split.md`, `batches-rail-r9.md`, `decisions.md`
(rows 73-81), `parity-inventory-layout.md`, `switch-baseline.md`, `lane-R9{a,b,c,d,g}-report.md`,
`code-logic-review-R9{a,d}.md`, `context.md`. Tools: `W\.ptah\tmp\check-run.mjs`, `W\.ptah\tmp\final-run\`
(`launch.mjs`, `step.mjs`, `s-switch.mjs`, `s-heap.mjs`, `s-theme.mjs`, `s-panels.mjs`, `s-draft3.mjs`).
