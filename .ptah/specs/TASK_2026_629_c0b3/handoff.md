# Handoff: TASK_2026_629_c0b3 — Orchestra Canvas mission board

Date: 2026-10-13 (second handoff). Branch: `feat/task-629-canvas-board` (local only, NOT pushed).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Base: rebased onto `origin/main` `736b0ad84` (TASK_2026_628 merged). HEAD: `06c1f09cb`. Tree clean
except the git-ignored `.ptah/tmp/final-run/`.

## 1. Approvals and user decisions

- `task-description.md` and `implementation-plan.md` are approved. One commit per batch after its
  scoped checks pass. Do not stop at gates. Push + PR at the end (global CLAUDE.md rule).
- Implementation runs on CLI lanes (codex, role `frontend-developer`). Review is cross-side:
  lane code → Claude sub-agents; orchestrator (in-process) code → a codex lane, read-only.
- Todos and git +/- metrics are in scope (row 27). The orchestrator records video of the real
  Electron app at the end, finds defects, fixes them in one round (row 28).
- 2026-10-13: the user REJECTED a `git status` / `git diff` command run inside the scratch
  workspace `D:\projects\ptah-final-run-ws`, then interrupted the session and asked for this
  handoff. Do not run git commands in that workspace without asking the user first.

## 2. Documents (all in `.ptah/specs/TASK_2026_629_c0b3/`)

1. `decisions.md` — rows 1-39 (row 8 is at the end of the table). Source of truth for every
   decision, deferral and open item.
2. `implementation-plan.md`, `batches.md` (its PENDING states are not updated — use §3 below),
   `BM-design.md` (+ §6 amendments A1, A2), `task-description.md`, `prototypes/01-board.html`.
3. Reviews: `code-logic-review*.md`, `code-style-review*.md`, `*-rereview-*.md`,
   `code-logic-check-3a2a6f28e.md`, `BM-design-review.md`, `BM-design-rereview.md`. Lane reports `lane-*.md`.

## 3. Progress

| Step | State | Commit (after rebase) |
|---|---|---|
| docs, B0-B8b, BL, Phase A-E reviews and fixes | done | see `git log origin/main..HEAD` |
| Fix-D2 (skyline row, frozen geometry, release while locked) | done | `6d62b80e7` |
| Re-review D/E → bounded correction N1 loop, N2, N4 → check PASS | done | `01ecf09ee` |
| Rebase onto `origin/main` (2 conflicts in chat-view, main side kept) | done | `a1114b8df` |
| B10 cap guard in the composer send (`SESSION_START_GUARD`) | done | `21ac21552` |
| BM design + cross-side review + amendments | done | in `41a51010e` |
| BM1 todo marker, selector, fixed card slots | done | `41a51010e` |
| BM2 `SessionGitStatsStore` + card wiring | done | `360ac92d2` |
| BM3 detail column todos/changes | done | `4208fc840` |
| Phase F review (logic PASS 7, style REVISE 7, in-process PASS 8) → fix round → re-review PASS | done | `94484635a`, `06c1f09cb` |
| **Final Electron run with video** | **IN PROGRESS (interrupted)** | — |
| `final-run-review.md` + one defect fix round + re-check | pending | — |
| B9 perf record | pending (during the final run, else user) | — |
| Push + PR, tell the 628 session | pending | — |

Last check results (before the Electron build): canvas 26 suites / 322 tests, chat 200 / 3626
(+2 skip), chat-ui 70 / 1115, chat-streaming 26 / 630 (+1 skip); typecheck pass and lint 0
errors on all four; chat-types typecheck + lint pass. The Electron dev build (which includes the
webview build) passed, so the `app.config.ts` handler line compiles.

## 4. Final run — state and how to resume

Tools (git-ignored, in `.ptah/tmp/final-run/`):
- `launch.mjs <workspace>`: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs`
  with `recordVideo` (1600x1000) and `--remote-debugging-port=9333`. Writes `ready`, then waits;
  creating the file `stop` closes the app and finalizes the video into `video/`.
- `step.mjs <step.mjs> [shot]`: connects over CDP to port 9333, runs one step file
  (`export default async (page) => result`), saves `shots/<shot>.png`, prints JSON.
- Step files: `s-theme.mjs` (`THEME=anubis|anubis-light`, clicks `button[data-theme=…]` in the
  DOM), `s-new.mjs` (`NAME=…`, New Session popover → Create), `s-send.mjs` (`TILE=i TEXT=… WAIT=ms`),
  `s-look.mjs` (text of every tile), `s-probe.mjs`.
- The dist build in the worktree is current (built from `06c1f09cb`). Rebuild only if code changes:
  `node apps/ptah-electron/scripts/rebuild-native.js && npx nx build-dev ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev ptah-electron --parallel=1`.
- The previous app instance and its launcher were stopped when the session ended. The video
  `video/page@6b6e89ded225e46f822d2e25fdf4ef1d.webm` may be incomplete (no clean `stop`).
  Start a new run: delete `ready`, run `node launch.mjs "D:\projects\ptah-final-run-ws"` in the
  background, wait for `ready`, drive with `step.mjs`, and create `stop` at the end.
- Dev profile is `%APPDATA%/Ptah Dev`; the provider works there (Claude CLI, Opus 5.5). Real
  sessions cost money: keep prompts very short.
- IMPORTANT: `rebuild-native` switched the shared `node_modules` `better-sqlite3` to the Electron
  ABI (node_modules is a junction to the main checkout). Frontend Jest is not affected; backend
  Jest that loads better-sqlite3 fails until it is rebuilt for Node. Restore it after the run
  (ask the user before running `npm rebuild better-sqlite3`; the task rules forbid npm install).
  The 628 session was told about this.

Done so far in the run (dark theme, Anubis): start screen, theme switch, S1 created and sent two
prompts plus one file edit (`math.js` +5), S2 and S3 created, 3 tiles → S2/S3 render as cards.
Screenshots `shots/01-start.png` … `08-cards.png`.

Findings so far (put them in `final-run-review.md`):
- **F1 (Serious, scope):** the SDK in this build exposes no `TodoWrite` tool to Claude sessions
  (the session lists only `mcp__ptah__ptah_task_create` / `ptah_task_update`; Ptah does not remove
  TodoWrite — only the Codex adapter still emits `TodoWrite`). So the BM todos metric always shows
  "No todos" for Claude sessions. A fix needs a new source decision (e.g. SDK task tools, or
  `ptah_task_*` calls) — a user decision; record, do not silently redesign.
- **F2 (to verify):** S2 and S3 cards show git `+177 −0` while S1's change was `math.js +5`.
  Cause not checked (the user rejected the git command in the scratch workspace). Check from the
  app side instead (e.g. the S1 "1 file changed" block, the Git panel, or ask the user), and check
  whether untracked files (the 200-file / 1 MiB numstat caps) or session files are counted.

Remaining check list (handoff §4 step 7 of the first handoff, unchanged):
- card zones vs `prototypes/01-board.html`; "+N more lanes" fits a 244 px tile;
- 3+ tiles → unfocused tiles show cards (seen); drafts survive a card flip; dock keeps a user-chosen compact mode;
- cap of 9 (New session disabled with the reason; idle-tile send refused with the same text;
  resume/wrap-up refused; frees after a hidden-workspace turn ends);
- needs-you queue: Allow/Deny, Open session → detail;
- detail row (B6 manual gate): panel top within 8 px of the row bottom, rows below visible and
  clickable, scroll height grows — FAIL means NO-GO → option (c) bottom panel;
- Esc / ←/→ in the detail (Esc also from a lane tab), lane tabs, CLI lane card, sub-agent
  transcript, Stop, permissions; drag release / text selection in card mode must not open the detail;
- todos and git values on the card and in the detail details column (see F1, F2);
- BL heap snapshot: no detached `ptah-canvas-tile` / `gridstack-item` after a tile closes
  (TASK_2026_645 item 5 also records this; send the result to the 628 session);
- streaming continues in a tile after the detail closes;
- repeat the key screens in the light theme (`THEME=anubis-light`).
Then write `final-run-review.md`, fix defects in one round (lane), re-check, B9 if possible.

## 5. Open items carried (do not lose)

See decisions.md. Main ones: rows 10, 11, 14, 18, 19/21 (hidden-workspace partition not a
signal), 24 (M5, M7, Minors), 25, 26 (standalone background Stop), 30 (N3, N5, N6), 31 (detail
visible-tab ownership), 33 (`StreamPresentationStore` export, probe-only buildTree test),
37-39 (M1 flicker, M5 re-read, agent feedback sender not guarded, details `todos` unthrottled).
Large files: compact-session-activity 1279, chat-view 1897, canvas-tile 877, grid 874 lines.

## 6. TASK_2026_628 / 645 coordination

- 628 is merged and done. The combined M-final measurement is TASK_2026_645_6aaa (blocked on 629).
- Notify session `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with
  `SendMessage` (`ptah_agent_report` is unattributed) when 629 merges. It already has phase
  reports up to "Phase F closed".

## 7. How to run lanes and checks

- Load the `orchestration` and `agent-lanes` skills first.
- `ptah_agent_spawn`: `cli: codex`, `role: frontend-developer`, `workingDirectory` = the worktree,
  `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables: ["lane-<batch>-report.md"]`,
  `timeout: 1200000`, at most 40 tool calls. Resumes above 60k tokens start fresh: give full instructions.
- One lane with checks at a time. Read the diff yourself, run the scoped checks, commit in the
  foreground (`type(scope): subject`, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Checks (STRICT, repeat in every prompt): `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  (never `--testPathPattern`), then the project once, then `npx nx typecheck|lint <project> --parallel=1 --skip-nx-cache`.
  One heavy check at a time; no workspace-wide runs, no build/serve/dev/e2e/package except the
  final Electron run, no npm install, no `--max-old-space-size`, no `content-visibility`. Filter output.
- Push in the background (`git push -u origin feat/task-629-canvas-board && gh pr create …`);
  the pre-push hook runs di-lint and the Electron validate-deps gate.
