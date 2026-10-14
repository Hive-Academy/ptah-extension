# TASK_2026_629_c0b3 — HANDOFF (ninth handoff, R9 Waves 4-5 + H1 committed, R9f/R9t reviewed)

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). Task folder TF: `W\.ptah\specs\TASK_2026_629_c0b3`.
> File name: this handoff is `handoff-9.md`. NEVER write `HANDOFF.md` (row 91: on Windows it is the same file as the
> tracked `handoff.md`). The next handoff is `handoff-10.md`.
This file REPLACES `handoff-8.md` §2-§3 as the source of truth. Still valid: `handoff-8.md` §1 (goal), §4 (rules), §6
(key files) and its steps 5-11 (repeated in §3 below); `handoff-7.md` §1/§4/§6; `handoff-6.md` §2, §6; `handoff.md`
§4 (final-run tools), §6, §7. New decision row this session: 92.

## 1. Working tree state at handoff (IMPORTANT)

HEAD = the docs commit of this file (on top of `70a63ea4c`). The tree is NOT clean on purpose:

| Batch | Uncommitted files (W\libs\frontend\canvas\src\lib\) | Writer | Review |
|---|---|---|---|
| R9f | `canvas-detail/canvas-detail-transcript.component.ts` + `.spec.ts`, `canvas-lane-view.component.ts` + `.spec.ts`, `canvas-rail/canvas-focus-area.component.ts` + `.spec.ts`, `canvas-session-overrides.ts`, `canvas-session-overrides.spec.ts` (new) | codex `0a40562d`, session `01a13830-d65c-71d3-9009-0c7e5f84350e` (idle > 10 min: use a fresh lane) | `code-logic-review-R9f.md` **REVISE 5/10** |
| R9t | `canvas.store.ts` + `.spec.ts`, `canvas-layout-intent.ts` + `.spec.ts` | codex `2a663fe8`, session `01a13841-cb77-7b63-9128-b6fc8a5e159f` | `code-logic-review-R9t.md` APPROVE-WITH-FIXES 8/10 |

Do not stash, restore or reset these. `git status --short libs` must show exactly these 12 paths before you start.

## 2. Done in session 9

| Step | Result |
|---|---|
| Gate 0.1 | codex weekly 12-13%, opencode 5-hour 25% / weekly 30% / monthly 88% (limit lookup sometimes times out — re-read the row). |
| Wave 4 | R9m opencode (review APPROVED 9/10, 3 Minors) -> `b3626c50d`, canvas 269/269. R9r opencode (APPROVED 9/10, 2 Minors) -> `cea73f11f`, chat-state 566/566. Docs `bd7414b93`. |
| H1 | R9h codex (review APPROVE-WITH-FIXES 7/10: S1 real ChatView Rail path untested, M1 main-panel destroy cleared memos, M2 no positive strict case, M4 closed context tab stayed rendered) -> fix round codex `a46b287a` -> `43d48bf89`, chat 3705 pass / 2 skipped, TC/lint clean. **Both decision-89 dock specs pass by name** (Jest JSON) -> R9f gate met. |
| Wave 5 | R9k codex (7/10; finding 1 spec self-import fixed by codex `addc14ff`) -> `e8e190455`, canvas 247/247. R9s opencode (APPROVED 8/10) + orchestrator one-line TS2367 fix (row 92) -> `2365151a8`, chat-state 554/554, chat-types TC/lint clean. Docs `70a63ea4c`. |
| W6 / H2 | R9t and R9f written and reviewed (§1); NOT committed. |

Status: **17/24 batches COMPLETE.** Remaining: R9t (W6, fix + Mode 2), R9f (H2, fix + re-review + Mode 2), R9l (H3),
R9u (H4), R9v (H5), R9w (H6), R9x (H7).

## 3. Next steps (in order)

1. **Gate 0.1**: `ptah_agent_list`; record the rows in `context.md`.
2. **In parallel** (file-disjoint inside canvas):
   - **R9f fix round** — fresh codex lane with a brief (writer idle > 10 min). Fix ALL Serious (S1-S5 incl. S5 a-g) and
     M1, M2, M5 (they break named contract cases: permission answer, background, stop). Record M3, M4, M6, m1-m3.
     - S1: opening a lane unregisters the parent tab from `visibleTabIds` -> live lane may stall (stream v2).
       Registration must follow SESSION_VISIBLE, not lane selection.
     - S2: decision-77 named spec "fenced display updates in place in Rail host" is missing (open + same-id update in
       the real Rail dock).
     - S3: no spec for persistent ChatView instance, draft across Open/Back, `visible` gating (lane spec stubs the
       transcript, transcript spec has an empty template).
     - S4: after a mouse open, focus falls to `body`, Escape never reaches the lane; Back destroys the focused button.
     - S5: stop case calls the method (no Stop button), steer/copy absent, "does not mount SingleChatSubagentView"
       cannot fail, full ExecutionNode and depth-2 recursion not exercised.
     - M1: duplicate Stop and permission prompts (lane header vs `inline-agent-bubble`); keep the bubble (row 104).
     - M2: backgrounding a `sub:` agent inside the lane collapses it (`canvas-lane-view.component.ts:247-274`).
     - M5: `stop()` (`:392-399`) has no catch.
     Then (lean rule 4) ONE scoped re-review by a Claude `code-logic-reviewer` on the fixes only, then Mode 2.
   - **R9t**: the 2 Moderates are stale doc comments in `canvas-layout-intent.ts:61-65` (`TileViewConstraint` "already
     clamped") and `:77-79` (`viewConstraintsFingerprint` "locked grid"). Fix them with a small codex lane (or a
     bounded orchestrator edit logged as a decision row), then **team-leader Mode 2 for R9t**: FULL(canvas),
     TC(canvas), LINT(canvas). R9f files are mid-edit in canvas: tell the team-leader that a failure inside R9f's
     files is not R9t's, and commit only the four R9t paths.
3. **R9f Mode 2** after the re-review: FULL(canvas), TC(canvas), LINT(canvas); rg confirms no `HIDE_AGENT_SIDEBAR:
   true` in canvas; commit the 8 R9f paths. Then a `docs(canvas)` commit of TF. Never two team-leaders committing at once.
4. **H3 R9l** (codex): contract in `batches-rail-r9.md`, incl. decision 90a (`hunk-revert-top-layer.spec.ts:193-196`),
   90c (`CanvasDetailService.toggle/next/prev`), and the R9k review finding 3 e2e selectors
   (`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:145,553,569,883,898`: "Layout options", "Layout presets",
   "Lock tiles"). Open owner question: R9k finding 2 (stale `CanvasLayoutService` mocks with `containerHeight`,
   `columnsFor`, `computeLayout` in `orchestra-canvas.component.spec.ts:241-248,735-740`) has no owner. Recommended:
   add that spec as R9l's 7th file (within the 8-file cap) and log a decision row.
5. **H4-H7 serially**: R9u codex, R9v Claude FD (review: codex lane), R9w codex (timeout 2,400,000 ms, up to 80 tool
   calls), R9x Claude FD (review: codex lane). Same per-batch flow: writer -> cross-family review -> one fix round ->
   fresh team-leader Mode 2 -> commit.
6. **Phase review** (`handoff-8.md` step 5): one Claude `code-logic-reviewer` on the whole R9 diff (codex/opencode code)
   and one codex reviewer lane on the Claude-written batches (R9b, R9c, R9n, R9o, R9v, R9x); one fix round; one scoped
   re-review. It must judge row 77(d) for the tribunal conductor tile: `conductor-tile.component.ts:221` still sets
   `HIDE_AGENT_SIDEBAR: true` (existing, not set by an R9 batch) — decide whether that host shows a transcript.
7. **Steps 6-11 of `handoff-8.md`, unchanged**: renderer rebuild only (background, log
   `.ptah/tmp/final-run/build-renderer.log`); user Electron test with video (1920 side docks, 1600 overlay docks, 1280
   stacked; wait for "done"); then `s-heap`, contrast #10 both themes incl. M5, `TAG=after-r9 node step.mjs s-switch.mjs`
   vs `switch-baseline.md`, `after-r9-rail-{anubis,anubis-light}.png`, before/after shown, "Re-check" section in
   `final-run-review.md`; ask before `npm rebuild better-sqlite3` and any package.json change; team-leader Mode 3;
   push + PR in one background command; when 629 merges, `SendMessage` to the 628 session (text in `handoff-8.md` §3
   step 11).

## 4. Rules (unchanged from `handoff-8.md` §4 — repeat them in every lane and sub-agent prompt)

- Every check through `node .ptah/tmp/check-run.mjs <label> -- <command>` from W (machine-wide lock). Writers: only
  their `--testFile` specs (`npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache`, never --testPathPattern). Mode 2: FULL, then TC and LINT with `--parallel=1 --skip-nx-cache`.
- One heavy check at a time. No workspace-wide runs, no build/serve/dev/e2e/package except the renderer rebuild, no
  npm install. Filter output.
- Writers/reviewers never run state-changing git and never revert another writer's change. No git in
  `D:\projects\ptah-final-run-ws` without asking the user.
- Commits: foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100 (wrap 72), end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push in the background.
- Lanes: `cli`, `role`, `workingDirectory` = W, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables`,
  `timeout: 1200000`, <= 40 tool calls (R9f fix: 50); max 3 CLI lanes; glm/grok/antigravity not used for shipping code.
- Keep the display dock (row 77) and Rail split focus (rows 80, 82, 83, 85, 86).
- End each turn with a short summary of what is done and what is left.

## 5. Recorded-not-fixed (add to the PR body, with `handoff-8.md` §5 and `handoff-6.md` §6)

- R9m: mcp-bench fixtures mention deleted files; row 60 leak guarantee moved to `s-heap`; Escape-from-lane-tab case
  has no exact Rail twin.
- R9r: rewritten viewMode reload case passes without a real restore.
- R9h: M3 non-retaining tiles are not tree-cache owners (Rail eviction can rebuild a tile memo, CPU only); m1
  SESSION_CONTEXT strictness also reaches the tribunal conductor tile and canvas detail transcript (decision 89 wins);
  m2 `dispose` of a never-retained id no longer clears the memo; m3 per-instance panel state survives a context switch.
- R9k: finding 4 vacuous selector-absence guards (`orchestra-canvas.rail.spec.ts:297-298`,
  `orchestra-canvas.component.spec.ts:891`); 5 observer gates on width only; 7 re-observe/disconnect not pinned by a test.
- R9s: 3 Minors (`code-logic-review-R9s.md`): save-path assertion checks the projection, no defensive omit in
  `projectTabForPersist`, unknown `viewMode` passes through as at HEAD.
- R9t: 3 Minors (`code-logic-review-R9t.md`).
- R9f (after its fix round): M3 no "agent not available" notice for a stale tile key, M4 lane omits `[isStreaming]` /
  `[ptahUi]`, M6 workspace switch resets ChatView dock state (`@if (visible())` board), m1-m3.
- Editor diagnostics (not nx typecheck): `orchestra-canvas.rail.spec.ts:274`, `core/src/testing/mock-rpc-service.ts`,
  `shared/.../capability-id-codec.ts` BigInt target — pre-existing, out of scope.

## 6. Key files

TF: `batches-rail-r9.md` (statuses + contracts), `implementation-plan-rail-r9.md`, `implementation-plan-rail-r9-split.md`
(Revisions 1-3), `decisions.md` (rows 73-92), `parity-inventory-layout.md`, `switch-baseline.md`, `context.md`,
`lane-R9*-report.md`, `code-logic-review-R9*.md`, `codex-review-R9*.md`, `mode2-wave{1,2a,2b,3,4a,4b,5a,5b}-report.md`,
`mode2-h1-report.md`. Tools: `W\.ptah\tmp\check-run.mjs`, `W\.ptah\tmp\final-run\`.
