# TASK_2026_629_c0b3 — HANDOFF (eighth handoff, R9 Waves 1-3 committed)

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). HEAD `4650b78b0` + the commit of this file.
Working tree clean. Task folder TF: `W\.ptah\specs\TASK_2026_629_c0b3`.
> File name: this handoff is `handoff-8.md`. NEVER write `HANDOFF.md`: on Windows it is the SAME file as the
> tracked `handoff.md` (the first handoff, with the final-run tools in §4) and overwrites it (row 91). The next
> handoff is `handoff-9.md`.
This file REPLACES `handoff-7.md` (the previous HANDOFF) §2-§3 as the source of truth. Still valid: `handoff-7.md` §1
(goal, items), §4 (rules), §6 (key files); `handoff-6.md` §2 (item definitions), §6 (recorded-not-fixed list);
`handoff.md` §4 (final-run tools), §6, §7. Decisions: rows 82-90 are new in this session — read them.

## 1. Goal (unchanged)

R9 phase of the Orchestra Canvas Rail board: Grid mode removed (Rail is the only board) plus items 1, 2-3 (display
dock restored in the focused Rail session — PROTECTED, row 77), 5, 6, 7, 9, 10, 11, 12 (Rail split focus, row 80),
13 (Rail reorder). For a product video: visual quality and switching performance matter.

## 2. Done in session 8

| Step | Result |
|---|---|
| Wave 1 reviews + fixes | R9b codex review REVISE 6 -> fix (stale popover, aria-disabled). R9c codex APPROVED 8 (1 Minor). R9g Claude 6 -> fix (barrel import via `@ptah-extension/chat-ui`, terminal status, `laneKey`). Row 84. |
| Wave 1 Mode 2 | canvas 422/422, chat-ui 1411/1411, chat 3665 pass; TC pass; lint 0 errors. Commits R9a `e24a8c93e`, R9b `c8d8bc95f`, R9c `713ec57ae`, R9d `b9736bd4e`, R9g `8f9d63757`, docs `c57d04e2b` (`mode2-wave1-report.md`). |
| Split addendum | Re-review REVISE 7 (`-split-rereview.md`); user rows 82 (width-based dock per pane) + 83 (Details overlay in split); revise round 2 (codex); final check APPROVED 8 (`-split-final-check.md`); user rows 85 (STACK panes below 1440 px, not unavailable) + 86 (split not persisted); Revision 3 (codex); `-split-rev3-check.md` REVISE 7 with one one-line fix applied by the orchestrator (plan line 44) -> Gate 2 passed (row 88). |
| Wave 2 | R9e codex (Claude review 6 -> fix; finding 2 dock badge -> R9h, row 89), R9n Claude (codex review REVISE 6 -> fix: Escape guard, auto-close on agent loss/session switch; harness line row 87), R9o Claude (codex REVISE 6 -> fix: per-turn disclosure via `turnKeyOf` + `linkedSignal`), R9i opencode (Claude APPROVED 9). Commits R9o `b78468290`, R9i `df3b88e8d`, R9e `df4e9977b`, R9n `7ef8d53d3` (+ keepalive stub line), docs `ca4021597` (`mode2-wave2a/2b-report.md`). |
| Decomposition | Team-leader added R9u-R9x (H4-H7, serial) to `batches-rail-r9.md` with notes N1-N6 + B1-B7; R9h has the row 89 contract line; R9f's `HIDE_AGENT_SIDEBAR` removal is gated on R9h's two dock specs; R9h/R9f/R9l are PENDING (not held). |
| Wave 3 | R9p, R9j, R9q opencode; one Claude reviewer, 8/10 each, no fix round (row 90). Canvas 275/275 (4 spec files deleted), TC pass, lint 0 errors. Commits R9p `1fd6e99cb`, R9j `77b41f02c`, R9q `9a17fd085`, docs `4650b78b0` (`mode2-wave3-report.md`). R9l gained `hunk-revert-top-layer.spec.ts` (row 90a) and the `CanvasDetailService.toggle/next/prev` cleanup (row 90c). |

Status: **12/24 batches COMPLETE.** Remaining: R9m, R9r (W4), R9k, R9s (W5), R9t (W6), R9h (H1), R9f (H2), R9l (H3),
R9u (H4), R9v (H5), R9w (H6), R9x (H7).

## 3. Next steps (in order)

1. **Gate 0.1**: `ptah_agent_list` (session 8 end: codex weekly 12%, opencode monthly ~85%; opencode limit lookup
   sometimes times out — re-read the row). Record the rows in `context.md`.
2. **Start in parallel** (file-disjoint): Wave 4 R9m + R9r (opencode lanes) AND H1 R9h (codex lane; chat files,
   depends only on R9e/R9n which are committed). Max 3 CLI lanes, max 2 Claude writers.
   - R9h carries row 89: `ChatView.sessionAgents` uses `agentsOwnedBySession` when `SESSION_CONTEXT` is present
     (never on `SESSION_CARD_ACTIONS`); specs in `chat-view.dock.spec.ts` for a strict Rail host and a tolerant
     single chat view that provides `SESSION_CARD_ACTIONS`.
3. **Per batch**: writer -> cross-family review (codex/opencode code -> Claude `code-logic-reviewer` writing
   `code-logic-review-R9x.md`; Claude code -> codex reviewer lane writing `codex-review-R9x.md`) -> one fix round
   (Blocking/Serious; Moderate only if it can lose data or break a named contract behaviour; Minors recorded) ->
   team-leader Mode 2 (fresh team-leader per call; give it report + review paths; serial checks via the lock
   runner; foreground commits; then a `docs(canvas)` commit of TF). Small deletion batches of one wave may share one
   reviewer writing one file per batch (done for Wave 3).
4. Then W5 (R9k codex, R9s opencode), W6 (R9t codex), H2 (R9f codex; only after R9h's two dock specs pass), H3 (R9l
   codex), then H4-H7 serially: R9u codex, R9v Claude FD, R9w codex (timeout 2,400,000 ms, up to 80 tool calls),
   R9x Claude FD. Two team-leaders must never commit in W at the same time.
5. **Phase review** (`handoff-7.md` §3 step 5): one Claude `code-logic-reviewer` on the whole R9 diff (codex/opencode
   code) and one codex reviewer lane on the Claude-written batches (R9b, R9c, R9n, R9o, R9v, R9x); one fix round; one
   scoped re-review. Check "no host that shows a transcript sets `HIDE_AGENT_SIDEBAR: true`" (row 77).
6. **Rebuild renderer only** (background, log `.ptah/tmp/final-run/build-renderer.log`): `npx nx build-dev
   ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev
   ptah-electron --parallel=1`.
7. **User Electron test with video** (`handoff-7.md` §3 step 7): `cd W/.ptah/tmp/final-run; rm -f ready stop`, then in
   the background `node launch.mjs "D:\projects\ptah-final-run-ws"`. Step list = plan "## Electron re-check list (R9)" +
   the addendum's split/reorder/stacked steps (1920 side docks, 1600 overlay docks, 1280 stacked). Wait for "done".
   Then `s-heap` (0 detached `ptah-canvas-lane-view` / `ptah-canvas-detail-transcript` / `chat-msg-slot`, no Grid DOM,
   <= 1 live ChatView in the board host, <= 2 with split on), contrast #10 both themes incl. M5,
   `TAG=after-r9 node step.mjs s-switch.mjs` vs `switch-baseline.md`, screenshots `after-r9-rail-{anubis,anubis-light}.png`
   via `s-theme`; show before/after; add a "Re-check" section to `final-run-review.md`.
8. **Ask the user** before `npm rebuild better-sqlite3` and before any package.json change (gridstack stays).
9. **Team-leader Mode 3** (parity rows 1-124, write-path trace for persistence, screenshots shown).
10. **Push + PR in one background command**: `git push -u origin feat/task-629-canvas-board && gh pr create ...`
    (title < 70 chars, `## Summary` + `## Test plan`, recorded-not-fixed list (§5), Grid removal, end with
    `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). A failed pre-push gate needs a fix commit.
11. **When 629 merges**: `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with the
    BL heap result (Rail board; <= 1 live ChatView, <= 2 with split on) and that Grid mode, `ptah-canvas-tile` grid
    hosting and `gridstack-item` were removed in 629 (row 73), so the 645 M-final measurement must use the Rail board.

## 4. Rules (repeat in every lane and sub-agent prompt)

- STRICT checks, always through the lock runner from W: `node .ptah/tmp/check-run.mjs <label> -- <command>`.
  Writers: only their specs, `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache` (never --testPathPattern), one at a time. Mode 2: FULL / `npx nx typecheck <p> --parallel=1
  --skip-nx-cache` / `npx nx lint <p> --parallel=1 --skip-nx-cache`. Nx names: `@ptah-extension/canvas`,
  `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `@ptah-extension/chat-state`, `@ptah-extension/chat-types`,
  `@ptah-extension/tribunal-panel`, `ptah-electron-e2e`. No workspace-wide runs; no build/serve/dev/e2e/package except
  step 6; no npm install. Filter output.
- Writers and reviewers never run git that changes state; never revert another writer's change. Deletions by `rm`.
- Do not run git in `D:\projects\ptah-final-run-ws` without asking the user.
- Commits: foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100 (wrap 72), end
  with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push in the background.
- Lanes: `cli`, `role`, `workingDirectory` = W, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables`,
  `timeout: 1200000`, <= 40 tool calls; give complete instructions (resumes above 60k tokens or 10 min idle start a
  fresh lane with a brief).
- Keep the display dock (row 77) and split focus (rows 80, 82, 83, 85, 86).
- End each turn with a short summary of what is done and what is left.

## 5. Open problems and recorded-not-fixed (PR body)

- `handoff-6.md` §6 list (M5, M2, M3, M4, M7, M8, m1-m7, style Moderates 2-5, the 3 correction Minors,
  TASK_2026_653_2931 follow-ups).
- This session's Minors: R9c keyboard activation of `.rc-select` not tested directly; R9b duplicated "board is full"
  text (`canvas-rail.component.ts` vs `orchestra-canvas.component.ts`); `subagent-tile.component.ts:80` two non-null
  assertions (lint warning); R9o two consecutive no-file turns with identical test commands share a disclosure key;
  R9e duplicated owner rule; R9n review Minors (`codex-review-R9n.md`); row 90b showcase locators
  (`ptah-tile-agent-indicator`, `canvas-tile`) broken since Grid tile removal — follow-up for video-director/R11;
  row 90c: 10 of 13 render metrics without a production writer; parity row 42 vs 113 wording.
- Risk: R9f must not remove `HIDE_AGENT_SIDEBAR: true` before R9h's two dock specs pass (row 89).
- Risk: R9w is the largest batch (8 files); give it the longer timeout from `batches-rail-r9.md`.

## 6. Key files

TF: `batches-rail-r9.md` (24 batches, statuses, waves, dependencies, exact contracts), `implementation-plan-rail-r9.md`,
`implementation-plan-rail-r9-split.md` (Revisions 1-3), `decisions.md` (rows 73-90), `parity-inventory-layout.md`,
`switch-baseline.md`, `lane-R9*-report.md`, `code-logic-review-R9*.md`, `codex-review-R9*.md`,
`mode2-wave{1,2a,2b,3}-report.md`, `context.md`. Tools: `W\.ptah\tmp\check-run.mjs`, `W\.ptah\tmp\final-run\`.
