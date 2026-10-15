# TASK_2026_629_c0b3 — fourth handoff (Rail board: plan approved, batches ready)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed). This file is the source of truth for the
next session. `handoff.md` (third handoff) still holds the tools (§4), open items (§5), coordination (§6)
and lane/check rules (§7). Read them; they are not repeated in full here.

## 1. Where we are

- Gate 1.7 PASSED (decisions rows 48-54, commit `b512157c0`). The user approved the Rail design
  (`layout-design-spec.md` + `prototypes/02-focus-rail.html`), with:
  - Q2: add a 96 px dense card mode as a user toggle, never automatic (rows 52-54, section "Dense mode").
  - Q4: overflow menu. Q5: defer.
- Gate 2 PASSED (rows 55-58, commit `767fe3d9a`). `implementation-plan-rail.md` revision 1, codex re-review
  `implementation-plan-rail-rereview.md` APPROVED 8/10. Spec departures, reversible: D4 (hidden Rail
  workspace mounts no cards), D10 (no Retry; error id from the new `TabState.terminalFailureSeq`), D11 (keep
  `RUNNING_CAP_MESSAGE`), D14 (dark error ink `#ef4444`).
- Team-leader Mode 1 DONE (row 59): `batches-rail.md`, 10 batches, all PENDING. No production code written.
- The worktree has two unrelated modified files (`.claude/commands/orchestrate*.md`). Do NOT stage them.

## 2. Batches (`batches-rail.md`, strictly sequential, in this order)

| Batch | Project | Depends on |
|---|---|---|
| R0 | chat-state (+ chat-types typecheck/lint only, no test target) | — |
| R1 | chat-ui (`compact-rail-card` component) | — |
| R2 | chat (lane rows, compact session card) | R0, R1 |
| R3 | canvas (board mode, v3 layout persistence, store) | — |
| R4a | canvas (detail service, lane tabs, needs-you queue) | R3 |
| R4b | canvas (detail transcript, tile, overrides, card click) | R3 |
| R5 | canvas (`canvas-rail/` keyboard, rail, rail card, focus header) | R2, R3 |
| R6 | canvas (focus area, rail board, rail geometry, render metrics) — largest | R4a, R4b, R5 |
| R7 | canvas (board toggle, `orchestra-canvas.rail.spec.ts`, orchestra component) | R6 |
| R8 | ptah-extension-webview (`tailwind.config.js`, contrast spec; typecheck skipped, row 35) | — (runs last) |

Executor: codex CLI lane, role `frontend-developer` (fallback: Claude `frontend-developer` sub-agent).
Commit each batch after its scoped checks pass (team-leader Mode 2). The one code-logic review is due
after R8.

HIGH risks to put in the lane prompts (full list K1-K10 and A1-A5 in `batches-rail.md`):
- K1 (R4a): the detail service spec mocks have no tab manager and no board → test-setup-only fix.
- K2 (R4a): subscribe to tab-closed lazily (on the first lane-map write), never in the constructor, or
  `orchestra-canvas.component.spec.ts:423,473` break.
- K3 (R7): the orchestra spec needs a Grid board seed + missing stub fields → test-setup-only edit.
- K4 (R7): the detail-keydown spec calls the handler with a minimal fake. The Grid path must need nothing
  new; the Rail branch does nothing without a Rail board. If the spec cannot stay unedited, stop and report.
- R5/R6 styles must use the state-ink variables WITH fallback colours (R8 adds the tokens later).
- R6 may hit the 60-call lane limit: resume the same lane (or start fresh with full instructions if the
  host refuses a resume above 60k tokens).

## 3. Next steps (in order)

1. Run R0 → R8 one lane at a time. After each lane: team-leader Mode 2 (verify + commit, foreground).
2. Claude `code-logic-reviewer` on the combined Rail diff (cross-side of codex code), then one fix round.
3. Electron re-check (rebuild command in `handoff.md` §4). Rail + Grid, dark + light. `s-draft3` (F5) MUST
   pass. Also F6 `s-select2`, F7 `s-backdrop` (queue Escape vs detail Escape), F3 sub-agent lanes, no-shift
   (focus change, new session, state change, density toggle), cap-of-9 text, BL heap `s-heap`, contrast #10
   on the real anubis/anubis-light tokens. Close side panels first (`s-panels`). Real turns cost money: keep
   prompts short. Add a "Re-check" section to `final-run-review.md`.
4. ASK THE USER before `npm rebuild better-sqlite3` (main checkout).
5. Team-leader Mode 3, then push + PR in the background:
   `git push -u origin feat/task-629-canvas-board && gh pr create ...` (title < 70 chars, `## Summary` +
   `## Test plan`, end with the Claude Code line). Pre-push hook: di-lint + Electron validate-deps.
6. When 629 merges: `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x`
   with the BL heap result (0 detached `ptah-canvas-tile` / `gridstack-item`).

## 4. Rules (repeat in every lane and sub-agent prompt)

- STRICT checks: `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache` (never `--testPathPattern`), then the project once, then `npx nx typecheck|lint <project>
  --parallel=1 --skip-nx-cache`. One heavy check at a time. No workspace-wide runs, no
  build/serve/dev/e2e/package except the Electron re-check, no npm install. Filter output.
- Do not run git commands in `D:\projects\ptah-final-run-ws` without asking the user.
- Commits: `.commitlintrc.json` scopes, subject ≤ 72 chars, end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit in the foreground.
- End each turn with a short summary of what is done and what is left.
