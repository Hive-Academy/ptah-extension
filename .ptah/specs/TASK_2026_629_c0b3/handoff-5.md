# TASK_2026_629_c0b3 — fifth handoff (Rail board: code done, review fixed, Electron re-check next)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). This file is the source of truth for the next
session. `handoff.md` (third handoff) still holds the tools (§4), open items (§5), coordination (§6) and lane/check
rules (§7). `handoff-4.md` §4 holds the rules. Read both; they are not repeated in full here.

## 1. Where we are

- Batches R0-R8 are all COMPLETE and committed (`batches-rail.md`, 10/10). Each was a codex `frontend-developer`
  lane, verified and committed by a fresh team-leader Mode 2 (decisions row 60):

  | Batch | Commit | Batch | Commit |
  |---|---|---|---|
  | R0 | `6bf6073bb` | R4b | `5267965b6` |
  | R1 | `e877d0c91` | R5 | `f43b0356c` |
  | R2 | `f0462a870` | R6 | `b6ffa30c1` |
  | R3 | `deab106e1` | R7 | `4353047f4` |
  | R4a | `02fe637d8` | R8 | `a7a753eff` |

  K1-K4 held (fixture-only spec edits, `orchestra-canvas.detail.spec.ts` unedited). A2 and A4 proved by spec.
  Phase range for reviews: `fe9ab1c91..HEAD`.
- Phase reviews (row 61), both Claude reviewing codex:
  - `code-logic-review-rail.md`: APPROVED WITH FIXES 6/10, 3 Serious (S1 collapsed rail stale state, S2 focus header
    branch/model unbound, S3 "+N more" clipped).
  - `code-style-review-rail.md` (R0-R2 public API): APPROVED WITH FIXES 7/10, 0 Serious.
- Fix round (scope = decisions row 62) done by one codex lane (`lane-rail-fix-report.md`), committed `039dfc5a7`
  `fix(canvas,chat-ui,chat): rail review fix round`. Checks after it: canvas 407/407, chat-ui 1131/1131, webview
  475/475 (the `no-alpha-base-content.spec.ts` failure from 10 `text-base-content/60|70` uses is fixed), typecheck and
  lint pass for canvas, chat-ui, chat.
- IN FLIGHT when this session stopped (see §5 for the results if they arrived):
  - Scoped re-review of `039dfc5a7` by a Claude `code-logic-reviewer` → `code-logic-rereview-rail.md`.
  - Electron rebuild (handoff.md §4 command) → `.ptah/tmp/final-run/build.log`. NOTE: `rebuild-native.js` compiled
    `better-sqlite3` for the Electron ABI in the SHARED `node_modules` of the main checkout (the worktree
    `node_modules` is a link to `D:\projects\ptah-extension\node_modules`). Backend Jest that loads better-sqlite3
    fails until `npm rebuild better-sqlite3` runs. ASK THE USER before running it.
- Uncommitted on purpose: `.claude/commands/orchestrate*.md` (unrelated, never stage them).

## 2. Recorded, not fixed (decisions row 62) — carry to the PR body / later task

- M5: the state inks pass 3:1 (D13, approved at Gate 2) but are used as 10-12 px text; dark idle `#6b7280` is
  3.17-3.83:1 and dark run/err on `base-300` are about 4.1:1, below 4.5:1 for text. Reopening D13 is the user's call.
  Measure it in the Electron re-check (#11) and report it to the user.
- M2 (scroll restore once per instance), M3 (hold latch on a collapsed caret — verify in Electron), M4 (overflow menu
  Escape only inside the menu, no outside-click close), M7 (one transcript in the DOM and draft restore are proved
  only on stubs — the Electron re-check must prove them), M8 (lane strip reveal re-fires on `groups()` recompute),
  m1-m7, style Moderates 2-5 (missing doc comments, `ngDoCheck` focus rescue casts, hard-coded `sameLaneSummary`
  fields, `railState`/`railStateValue` naming).
- Team-leader note for the re-review: `canvas-rail-board.component.ts:233-236` after-render effect does not read
  `focusedId()`, so the measured live-view count could lag one render after a focus swap.

## 3. Next steps (in order)

1. If `code-logic-rereview-rail.md` is missing, re-run the scoped re-review of `039dfc5a7` (Claude
   `code-logic-reviewer`, read-only, no checks). If it finds new Blocking/Serious items: per the revise cap, make ONE
   bounded correction (codex lane) and get that change reviewed; otherwise report and stop. Then re-invoke
   team-leader Mode 2 with the re-review path and verdict.
2. If the Electron build did not finish with exit 0 (`.ptah/tmp/final-run/build.log`), run it again (handoff.md §4,
   one heavy job, background, long timeout).
3. Electron re-check — delegate to a `visual-reviewer` sub-agent with the plan's `## Electron re-check list`
   (`implementation-plan-rail.md`) items 1-12 and the tools in handoff.md §4. Minimum the user requires: Rail + Grid,
   dark (`anubis`) + light (`anubis-light`); `s-draft3` (F5) MUST pass (data loss blocks the PR); F6 `s-select2`;
   F7 `s-backdrop` (queue Escape vs detail Escape); F3 sub-agent lanes; no-shift incl. the density toggle (one height
   per density 176/96); cap-of-9 text; BL heap `s-heap` (0 detached `ptah-canvas-tile` / `gridstack-item` /
   `ptah-canvas-lane-view`, at most one live ChatView); contrast #10 on the real tokens (include M5). Also check
   S3 "+N more" is visible and M3. Close side panels first (`s-panels`). Real turns cost money: very short prompts.
   Screenshots vs `prototypes/02-focus-rail.html`. Add a "Re-check" section to `final-run-review.md`.
   Launch: delete `ready`, run `node .ptah/tmp/final-run/launch.mjs "D:\projects\ptah-final-run-ws"` in the
   background; create `stop` to close. Do NOT run git commands in `D:\projects\ptah-final-run-ws` without asking.
4. ASK THE USER before `npm rebuild better-sqlite3` (main checkout, shared node_modules).
5. Team-leader Mode 3 (parity vs `parity-inventory-layout.md` rows 1-44, v3 write-path trace, screenshots shown to
   the user), then push + PR in ONE background command:
   `git push -u origin feat/task-629-canvas-board && gh pr create ...` (title < 70 chars, `## Summary` +
   `## Test plan`, end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Pre-push hook runs
   di-lint + Electron validate-deps; a failed gate needs a fix commit on top, then push again.
6. When 629 merges: `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with the BL
   heap result (0 detached `ptah-canvas-tile` / `gridstack-item`).

## 4. Rules (repeat in every lane and sub-agent prompt)

- STRICT checks: `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache` (never `--testPathPattern`), then the project once, then `npx nx typecheck|lint <project>
  --parallel=1 --skip-nx-cache`. One heavy check at a time. No workspace-wide runs, no build/serve/dev/e2e/package
  except the Electron re-check, no npm install. Filter output (strip `\x1b\[[0-9;]*m`, grep
  `Tests:|Test Suites:|FAIL `). Lanes write logs outside the task folder or delete them (the fix lane left 15
  ignored `.log` files there; they were removed).
- Commits: foreground, `.commitlintrc.json` scopes, subject ≤ 72 chars, body ≤ 100 (wrap 72), end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path. Push in the background.
- Lanes: `cli: codex`, `role: frontend-developer`, `workingDirectory` = the worktree, `taskFolder:
  .ptah/specs/TASK_2026_629_c0b3`, `deliverables`, `timeout: 1200000`, ≤ 60 tool calls.
- End each turn with a short summary of what is done and what is left.

## 5. Results that arrived after this file was first written

### Re-review of `039dfc5a7` (`code-logic-rereview-rail.md`, Claude reviewing codex): APPROVED WITH FIXES

- CLOSED: S1, S2, S3, M1, M6, the ten alpha-class replacements. The team-leader's M6 lag note does NOT hold (the
  lane view mounts only when `orderedTiles()` is non-empty, which the effect reads with `visible()`).
- NEW Serious N1 (caused by the S1 fix, found by reading): in collapsed mode, keyboard traversal and Escape focus
  return stick. `canvas-rail.component.ts:265` and `orchestra-canvas.component.ts:422` use
  `querySelector('.rc-select, button')`; the first match in document order is now inside the hidden
  (`display:none`) smart card, so `.focus()` is a no-op.
- NEW Minor N2: the `+N more` button is 18 px tall inside the 16 px `overflow:hidden` header line → ~1 px clipped,
  focus ring mostly cut off.
- NEXT (replaces §3 step 1): the revise cap allows ONE bounded correction now. Run one codex `frontend-developer`
  lane for N1 (target the visible select button — e.g. scope the query to the visible card / exclude the hidden
  card, plus a collapsed-mode keyboard spec for ArrowUp/ArrowDown and Escape focus return) and N2 (fit the button
  in 16 px or give the line room without breaking 16 + 54 = 70; keep the focus ring visible). Team-leader Mode 2
  verifies and commits. Then ONE independent Claude `code-logic-reviewer` review of that correction only. If it
  finds defects: report them to the user and stop (do not reset the cap). Verify N1 again in the Electron re-check.

### Electron build: exit 0

- Full handoff.md §4 command ran clean from `039dfc5a7` (`dist/apps/ptah-electron/main.mjs` 2026-10-13 22:14,
  log `.ptah/tmp/final-run/build.log`). `better-sqlite3` in the shared node_modules is now Electron-ABI (ask the
  user before `npm rebuild better-sqlite3`).
- This dist does NOT include the N1/N2 correction. After that correction commits, rebuild only the renderer:
  `npx nx build-dev ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx
  copy-renderer-dev ptah-electron --parallel=1` (the native rebuild is not needed again while the ABI is unchanged).
  Then run the Electron re-check (§3 step 3).
