# Final Electron run — TASK_2026_629_c0b3

Date: 2026-10-13. Build: `dist/apps/ptah-electron` from `06c1f09cb` (HEAD `430daf64e` changed docs only).
Workspace: `D:\projects\ptah-final-run-ws` (no git commands run there). Profile: `Ptah Dev`, Claude CLI, Opus 5.5.
Driver: `.ptah/tmp/final-run/launch.mjs` + `step.mjs` (Playwright over CDP, window 1600x1000).

Evidence (git-ignored, `.ptah/tmp/final-run/`):
- Video run 2: `video/page@e947e5722591367a3827bd447ee2795b.webm` (complete, clean stop).
- Video run 1: `video/run1/page@6b6e89ded225e46f822d2e25fdf4ef1d.webm` (may be incomplete, no clean stop).
- Screenshots: `shots/01-*.png` … `08-*.png` (run 1), `shots/r2-*.png` (run 2), `shots/proto-board.png` (prototype).

Real sessions used: S1 (TodoWrite prompt, `math.js` edit, CLI lane spawn), S2 (Task sub-agent with `sleep 45`),
S3 (Write with a permission request), S4 (new, no turn). Approximate spend: $1.4.

## Verdict

**REVISE.** The board works end to end (cards, detail row, keys, queue, CLI lanes, permissions, BL, both
themes). Five defects fail the check list or block a primary action (F3-F7). F1 needs a user decision.

## Check list results

| Check | Result | Evidence |
|---|---|---|
| Card zones vs `prototypes/01-board.html` | PASS with notes (F10, F11) | `r2-03-wide.png`, `proto-board.png` |
| 3+ tiles: unfocused tiles show cards; 2 tiles both live | PASS | `r2-03-wide.png`, `r2-40-light-board.png` |
| Drafts survive a card flip | **FAIL (F5)** | `s-draft3.mjs` result: draft "" after the flip |
| User-chosen compact mode stays after a detail open/close | PASS | `r2-49-compact.png` |
| B6 detail row: top within 8 px of the row bottom | PASS (8 px: row bottom 639, panel top 647) | `r2-04-detail.png` |
| B6: rows below visible and clickable, scroll height grows | PASS (scrollHeight 1190 > 967) | same |
| Detail usable height | **FAIL (F4)** | `r2-04-detail.png`, `r2-14-s2detail.png` |
| Esc, ←/→ in the detail | PASS (S1→S2→S3→S2, Esc closes) | `r2-05-keys.png` |
| Esc from a lane tab | PASS (sub-agent tab); see F8 for the CLI lane row | `r2-16-subtab.png` |
| Lane tabs, CLI lane card, CLI lane output in the detail | PASS (`›_ Codex CLI · CLI lane · done 16s`, raw stdout "hi") | `r2-32-clicard.png`, `r2-33-lane.png` |
| Sub-agent lane on the card | **FAIL (F3)** | `r2-15-s2card.png`, `r2-19-s2card-done.png` |
| Sub-agent transcript | Recorded (F12, known N5) | `r2-16-subtab.png` |
| Stop button present in the lane tab | PASS (not pressed) | `r2-16-subtab.png` |
| Needs-you queue: count, Allow, Open session → detail | PASS (card Allow, popover Allow, Open session opens S3 detail) | `r2-24…r2-31` |
| Queue popover closes | **FAIL (F7)** | `r2-44-light-three.png` |
| Permission answer reaches the session | PASS (`perm.txt` written, git `+177`→`+178` at turn end) | `r2-28-allowed.png` |
| Text selection on a card does not open the detail | **FAIL (F6)** | `s-select2.mjs` result |
| Drag on the card body does not open the detail | PASS | same |
| Todos on the card and in the details column | **FAIL (F1)** | `r2-04-detail.png` |
| Git values on the card and in the details column | PASS with note (F2) | `r2-03-wide.png` |
| BL heap snapshot: no detached `ptah-canvas-tile` / `gridstack-item` after a tile closes | PASS (0 before, 0 after closing S3; detection checked on real node names) | `s-heap.mjs` |
| Streaming continues in a tile after the detail closes | PASS (S2 finished its turn live) | `r2-17`, `r2-18` |
| Light theme (`anubis-light`): board, cards, detail | PASS | `r2-40`, `r2-46`, `r2-47`, `r2-48` |
| Cap of 9 (New session, idle send, resume/wrap-up, hidden-workspace release) | NOT RUN live (9 running turns cost money); unit specs cover it (`canvas-running-cap.spec.ts`, B10, Phase F) | — |
| "+N more lanes" fits a 244 px tile | NOT RUN live (needs 4+ lanes); tiles in this layout are 854 px high | — |
| Deny | NOT RUN (same responder path as Allow) | — |
| B9 performance record | NOT RUN: needs a `main` build for the "before" values and 6 streaming sessions × 3 runs per build. Stays with the user (batches.md B9) | — |

## Findings

### F1 — Serious (scope, USER DECISION) — todos always read "No todos" for Claude sessions
The SDK in this build gives Claude sessions no `TodoWrite` tool. S1 was asked to use TodoWrite and replied
that the tool is not available and that `ptah_task_create` could do it (`r2-41`, detail transcript). Only the
Codex adapter still emits `TodoWrite`. So the BM todo slot (card) and the details-column Todos row always show
"—" / "No todos" for Claude sessions. A new todo source is a user decision; not changed in this round.

### F2 — Moderate (recorded) — git `+177 −0` is the whole folder, not the session
Cause (checked from the app and the file system, no git command in the workspace): the metric is
`git:info` HEAD vs. the working tree of the git root, untracked files included (BM-design S10, R3; title
"Uncommitted changes"). All tiles on one folder share it, so S1, S2, S3 and S4 all show the same value. Most of
`+177` comes from files Ptah itself writes into the workspace and does not git-ignore: `.mcp.json` (25 lines),
`.vscode/mcp.json` (23), `.ptah/harness/*.json` (52+), `.agents/mcp_config.json`, the `.bak` copies, plus
`math.js`. After the S3 Write turn the value moved to `+178` at turn end, as designed. Not a code defect.
Later task: say "this folder, all sessions" in the title, and consider git-ignoring the Ptah harness files
(`.mcp.json`, `.vscode/mcp.json`, `.ptah/harness/`) in the harness `.gitignore` block.

### F3 — Serious — Task sub-agents never show in the card LANES table
S2 ran one foreground `general-purpose` sub-agent for ~70 s. The card LANES zone read "No lanes" while it ran
and after it finished, but the card footer read "1 agents" and the detail showed a SUB-AGENTS tab
"general-purpose" (`r2-14`, `r2-15`, `r2-19`). CLI lanes do show (F-pass above). Lane rows come from
`compact-lane-rows.ts:53-71` (`subagents: readonly SubagentRecord[]`); the source passed to it does not hold
foreground Task sub-agents of this session.

### F4 — Serious — detail is too short when the tile row fills the view
`canvas-detail-geometry.ts:34-37`: `heightPx = max(320, containerHeight - tileHeight - 16)`. With tiles
854 px high in a 1000 px window the detail is 320 px; the composer and the chips use it all, and the
transcript shows 0-40 px (`r2-04`, `r2-14`, `r2-48`). The B6 gate itself passes.

### F5 — Serious (data loss) — composer draft lost across a card flip
Steps: 3 tiles, S2 live; type "draft typed" in S2; click the S1 card (S2 flips to a card); → S2 in the detail;
the S2 detail composer is empty; Esc; the S2 tile composer is empty. Repeated twice (with and without Esc
after typing). Draft code: `chat-input.component.ts:725-726` (save on destroy), `:1525-1587`.

### F6 — Serious (acceptance) — text selection on a card opens the detail
Mouse down on the card NOW text, drag 250 px, mouse up: the selection holds the text and the S1 detail opens
(`s-select2.mjs`: before 0, after 1). A plain drag on the card body does not open it.

### F7 — Serious — the queue popover can stay open and covers the dock buttons
`canvas-needs-you-queue.component.ts:31-37` uses `ptah-native-popover` with `[hasBackdrop]="true"`. The
backdrop (`fixed inset-0 z-40`) stays inside the dock stacking context: tiles are above it, so a click on a
tile does not close the popover; the dock buttons (its own toggle, New Session) are under it, so they cannot be
clicked; Esc closes it only when focus is inside the popover. Seen after answering the last item from the
popover: "No session needs you." stayed open and `New Session` clicks timed out (`r2-43`, `r2-44`).

### F8 — Minor — Esc needed two presses after a click on a card CLI lane row (focus on the card row button). Seen once.
### F9 — Minor — copy: "1 need you" (header), "1 agents" (card footer).
### F10 — Minor — cards fill the full tile height (854 px); NOW/LANES sit at the top and the metric row at the bottom with ~600 px empty between (prototype cards are ~240 px).
### F11 — Minor — numbers change when the detail loads a session: S1 card $0.38 / ctx 4% → $0.25 / 0% after the detail ("loaded"); details column "Turns 0" for S2 after a finished turn; header word "loaded".
### F12 — Minor (known, row 30 N5) — running sub-agent tab: "Transcript is not available yet".

## Fix round scope (decision ladder step 1, lean rule 4)

Fix: F3, F4, F5, F6, F7 (Serious). Record: F2 (Moderate, no lane config or data loss), F8-F12 (Minor).
F1 waits for the user.
