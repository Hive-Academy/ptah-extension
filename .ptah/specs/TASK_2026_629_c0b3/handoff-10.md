# TASK_2026_629_c0b3 — HANDOFF (tenth handoff, R9 W6 + H2-H4 committed, R9v mid-correction)

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). Task folder TF: `W\.ptah\specs\TASK_2026_629_c0b3`.
> File name: this handoff is `handoff-10.md`. NEVER write `HANDOFF.md` (row 91: on Windows it is the same file as the
> tracked `handoff.md`). The next handoff is `handoff-11.md`.

This file REPLACES `handoff-9.md` §1-§3 as the source of truth. Still valid: `handoff-9.md` §4 (rules), §5
(recorded-not-fixed, extended in §6 below), §6 (key files); `handoff-8.md` §1 (goal), §3 step 11 (text of the 628
message), §6; `handoff-7.md` §1/§4/§6; `handoff-6.md` §2, §6; `handoff.md` §4 (final-run tools), §6, §7.
New decision rows this session: 93-103.

## 1. Goal (unchanged)

Phase R9 of the Orchestra Canvas: replace the Grid board with the Rail board (Rail + focus area), keep the display
dock (row 77), add Rail split focus (rows 80, 82, 83, 85, 86) and Rail reorder. 24 batches; after the batches: phase
review, renderer rebuild, user Electron test with video, re-checks, team-leader Mode 3, push + PR.

## 2. Working tree state at handoff (IMPORTANT)

HEAD = the docs commit that adds this file. **21/24 batches are committed**; R9v is verified by Mode 2 but NOT
committed (it becomes 22/24); R9w and R9x are pending. The tree is NOT clean on purpose: the R9v code (10 paths) is uncommitted.

| R9v uncommitted paths (under W\libs\frontend\) | State |
|---|---|
| `canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` + `.spec.ts`, `canvas-rail.component.ts` + `.spec.ts`, `canvas-rail-keyboard.ts` + `.spec.ts` | writer fd-R9v + fix round fd-R9v-fix; Mode 2 PASS |
| `ui/src/lib/native/popover/native-popover.component.ts` + `.spec.ts` | added by row 102; fix round + row-103 correction |
| `ui/src/lib/native/shared/floating-ui.service.ts` + `.spec.ts` | added by row 103 (bounded post-cap correction); **correction NOT yet reviewed** |

Do not stash, restore or reset these. `git status --short libs apps` must show exactly these 10 paths.

R9v review chain: `codex-review-R9v.md` REVISE 6/10 -> fix round (`lane-R9v-fix-report.md`) -> `codex-review-R9v-fix.md`
REVISE 6/10 (new Serious: late position installs `autoUpdate` on a stale panel) -> row 103 correction
(`lane-R9v-correction-report.md`: request token in `FloatingUIService`, service spec 20/20, popover spec 20/20).
`mode2-h5-report.md` PASS on the pre-correction tree: canvas 23 suites / 276 tests, canvas TC + LINT (0 errors / 16
warnings), ui popover 19/19, ui TC + LINT green. Its commit command covers 8 paths; add the 2 `floating-ui.service`
paths.

## 3. Done in session 10

| Step | Result |
|---|---|
| Gate 0.1 | codex confirmed room (weekly 15%); opencode monthly 89% -> 91% (near limit: prefer codex/Claude); antigravity/grok/Glm unknown (not for shipping code). Recorded in `context.md`. |
| R9t | 2 stale comments fixed by orchestrator (row 94); Mode 2 `mode2-wave6-report.md` PASS -> **`ad3234690`**. |
| R9f | Fix round codex (`lane-R9f-fix-report.md`; row 97 answered "copy" = nested Copy controls) -> re-review 7/10 -> correction N1-N3 incl. `canvas-lane-tabs` (row 98) -> APPROVED 8/10 -> lint-only fix (public barrels) -> canvas 255/255, TC, LINT 0 errors -> **`19db607e8`** (10 paths). |
| R9l | codex (8 files incl. persistence spec) -> review 6/10 (S1: e2e clicked a deleted button) -> test-only fix -> Mode 2 `mode2-h3-report.md` PASS -> **`27be43205`**. Row 96 (stale mocks owner), row 99 (no new removals). |
| R9u | codex -> review 6/10 -> fix round -> 8/10 -> correction N1 reactive host registry (row 101) -> 8/10 -> Mode 2 `mode2-h4-report.md` (chat 3719 pass / 2 skipped) + orchestrator re-check (TC, lint 0 errors / 40 warnings, retention 19/19, dock 26/26) -> **`c8fde086d`**. |
| Docs | `527568429`, `9cfaa63ed`, `ac9f34e82`, plus the docs commit of this file. |
| R9v | §2 (not committed). |

## 4. Next steps (in order)

1. **Gate 0.1**: `ptah_agent_list`; record the rows in `context.md`. Do not touch codex lanes from other tasks.
2. **R9v finish** (no new fix round; cap used):
   - Independent **codex** review lane (Claude wrote R9v) of the row-103 correction only:
     `floating-ui.service.ts` + `.spec.ts` and `native-popover.component.ts:217` -> `codex-review-R9v-correction.md`.
     Findings after it are recorded, not fixed (agent-lanes §6).
   - Orchestrator re-checks through the lock, one at a time (canvas checks from Mode 2 stay valid: canvas files did
     not change after Mode 2):
     `node .ptah/tmp/check-run.mjs r9v-ui-1 -- npx nx test @ptah-extension/ui --testFile=floating-ui.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
     `node .ptah/tmp/check-run.mjs r9v-ui-2 -- npx nx test @ptah-extension/ui --testFile=native-popover.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
     `node .ptah/tmp/check-run.mjs r9v-ui-tc -- npx nx typecheck @ptah-extension/ui --parallel=1 --skip-nx-cache`
     `node .ptah/tmp/check-run.mjs r9v-ui-lint -- npx nx lint @ptah-extension/ui --parallel=1 --skip-nx-cache`
     Logs: the wrapper writes `%TEMP%\629-check-<label>.log`; filter `Tests:|Test Suites:|problems|error`.
   - Commit in the foreground with the command in `mode2-h5-report.md` plus
     `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts` and its `.spec.ts`; add one body line about the
     request token (row 103). Mark R9v COMPLETE in `batches-rail-r9.md`, then a `docs(canvas)` commit of TF.
3. **H6 R9w** (codex lane, `timeout: 2400000`, <= 80 tool calls, resume the same session on timeout). Contract:
   `batches-rail-r9.md` "Batch R9w" (read in full). Add to the brief:
   - Provide `RailTranscriptRetentionCoordinator` (R9u, `chat`) at the Rail board boundary, one per visible board
     (R9u contract: "R9w provides it at the Rail boundary"); the R9w text does not say it directly.
   - R9u Minors routed to R9w (row 100): never register a Rail host without `SESSION_CONTEXT`; at most two hosts per
     board (the cap is soft above two); never the same tab in both panes.
   - Wire R9v outputs (`openBesideRequested`, `moveUpRequested`, `moveDownRequested`) and `splitDisabledReason`.
   Reviewer: Claude `code-logic-reviewer`. Mode 2: FULL/TC/LINT(canvas).
4. **H7 R9x** (Claude `frontend-developer`; review: codex lane). Contract: "Batch R9x". Mode 2: FULL/TC/LINT(canvas);
   SPEC + LINT chat; TC/LINT(ptah-electron-e2e).
   Per batch: writer -> cross-family review (row 79) -> one fix round -> scoped re-review -> fresh team-leader
   Mode 2 (no commit, row 95) -> orchestrator commits when no writer runs.
5. **Phase review** (`handoff-9.md` step 6; "Phase review and completion" in `batches-rail-r9.md`): one Claude
   `code-logic-reviewer` on the whole R9 diff (codex/opencode code) and one codex reviewer lane on the Claude-written
   batches (R9b, R9c, R9n, R9o, R9v, R9x); one fix round; one scoped re-review. It must judge row 77(d) for
   `conductor-tile.component.ts:221` (`HIDE_AGENT_SIDEBAR: true`, pre-existing) and decide if that host shows a
   transcript.
6. **Steps 6-11 of `handoff-8.md`, unchanged**: renderer rebuild only (background, log
   `.ptah/tmp/final-run/build-renderer.log`); user Electron test with video (1920 side docks, 1600 overlay docks,
   1280 stacked; wait for "done"); then `s-heap`, contrast #10 both themes incl. M5,
   `TAG=after-r9 node step.mjs s-switch.mjs` vs `switch-baseline.md`, `after-r9-rail-{anubis,anubis-light}.png`,
   before/after shown, "Re-check" section in `final-run-review.md`; ask before `npm rebuild better-sqlite3` and any
   package.json change; team-leader Mode 3; push + PR in one background command; when 629 merges, `SendMessage` to
   the 628 session (text in `handoff-8.md` §3 step 11). Add to the visual re-check: R9v collapsed Rail hidden
   scrollbar, R9v unpositioned popover fallback near a screen edge, `+N more` pixel fit at 176/96 px.

## 5. Rules (repeat them in every lane and sub-agent prompt)

- Every check through `node .ptah/tmp/check-run.mjs <label> -- <command>` from W (machine-wide lock). Writers: only
  their `--testFile` specs (`npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache`, never --testPathPattern). Mode 2: FULL, then TC and LINT with `--parallel=1 --skip-nx-cache`.
- One heavy check at a time. No workspace-wide runs, no build/serve/dev/e2e/package except the renderer rebuild, no
  npm install. Filter output.
- Writers/reviewers never run state-changing git and never revert another writer's change. No git in
  `D:\projects\ptah-final-run-ws` without asking the user. Ask before `npm rebuild better-sqlite3` and any
  package.json change.
- Row 95: no commit while a writer lane edits W. Commits: foreground, explicit paths, `.commitlintrc.json` scopes,
  subject <= 72, body lines <= 100 (wrap 72), end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background; the PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Lanes: `cli`, `role`, `workingDirectory` = W, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables`,
  `timeout: 1200000`, <= 40 tool calls (R9w: 2400000 / 80); max 3 CLI lanes; glm/grok/antigravity not used for
  shipping code; opencode near its monthly limit.
- Keep the display dock (row 77) and Rail split focus (rows 80, 82, 83, 85, 86).
- End each turn with a short summary of what is done and what is left.

## 6. Recorded-not-fixed (add to the PR body, with `handoff-9.md` §5, `handoff-8.md` §5, `handoff-6.md` §6)

- R9t: Minors 3-5 (`code-logic-review-R9t.md`).
- R9f: M3 no "agent not available" notice for a stale tile key; M4 lane omits `[isStreaming]`/`[ptahUi]`; M6
  workspace switch resets ChatView dock state; m1-m4; N4 Escape closes the lane on any unhandled Escape inside it;
  correction residuals: reverse `bg:`->`sub:` migration not handled, stale opener after a mixed open path, a late
  record can pull focus to Back, `sub:`->`bg:` remounts lane content. Named Rail display case feeds the dock through
  `PTAH_UI_DISPLAY_DOCK_SYNC`, not by parsing fenced markdown.
- R9l (row 99): Moderate 1 stale `canvas-tile` locators in `specs/git/change-set-card.spec.ts:138`,
  `specs/chat/tile-load-older-history.spec.ts:43`, `specs/chat/tile-open-longtask-budget.perf.spec.ts:367`,
  `specs/chat/compaction-duplicate-session.spec.ts:152,302,306`, `support/perf-session-fixture.ts:466`,
  `support/perf-page-capture.ts:230+` (R11 sweep); Moderate 2 dead `detailTabId`/`laneKey`/`selectLane`/`close` in
  `canvas-detail.service.ts`; Minors 5-6; dropped e2e guarantees (workspace DOM retention gone since R6, Gridstack
  geometry and gesture counters per row 80); hunk-revert overlap probe unproven until e2e runs.
- R9u: row 100 Minors (unregistered host without SESSION_CONTEXT, soft cap above two hosts, no dev assert for the
  same tab in both panes -> R9w brief); N3 `aria-valuemax` off when host < 400 px; N4 stored vs visible dock width
  after End; correction Minors (`releaseHost` rewrites the registry for an unregistered host; N1 test uses a stub
  pane); NG0101 console errors in `chat-view.keepalive.spec.ts` (8, pre-existing count).
- R9v: collapsed Rail scrollbar hidden (manual test); unpositioned popover fallback can clip at a viewport edge;
  NG0953 dev warning (open queued before destroy, same path at HEAD); `+N more` pixel fit only in the visual re-check.

## 7. Decisions this session (rows 93-103, `decisions.md`)

93 R9f fix stays in canvas (S2 Rail case in the canvas host) · 94 R9t comments by orchestrator · 95 no commit while a
writer edits W · 96 orchestra-canvas spec mocks -> R9l · 97 R9f "copy" = nested Copy controls · 98 R9f correction +
`canvas-lane-tabs` · 99 R9l outcome, no new removals · 100 R9u fix scope · 101 R9u correction (reactive registry) ·
102 NativePopover joins R9v · 103 FloatingUIService request token joins R9v.

## 8. Key files

TF: `batches-rail-r9.md` (statuses + contracts; R9w line 545, R9x line 606, phase section at the end),
`implementation-plan-rail-r9-split.md`, `decisions.md`, `context.md`, `parity-inventory-layout.md`,
`switch-baseline.md`, `lane-R9*-report.md`, `lane-R9*-{fix,correction,lint}-report.md`, `code-logic-review-R9*.md`,
`codex-review-R9*.md`, `mode2-wave6-report.md`, `mode2-h{2,3,4,5}-report.md`. Tools: `W\.ptah\tmp\check-run.mjs`,
`W\.ptah\tmp\final-run\`.

Lane sessions (resume only within minutes; otherwise spawn fresh): R9f fix `01a13af3-9e5c-70f2-9144-50e39fc15660`,
R9f correction `01a13b0d-ab48-70a1-9061-5ef074093b07`, R9l `01a13b24-a697-7b51-86f3-00843e961959`, R9u
`01a13b3f-706e-7ce3-9d2a-05d0315e8732`, R9u fix `01a13b4f-4a0d-7120-a5f1-8df20e6029fd`, R9v review
`01a13b72-fdf7-73f3-9579-137ea446d596`, R9v re-review `01a13b7f-3ec8-7653-b2a3-ad4df6eab026`.
