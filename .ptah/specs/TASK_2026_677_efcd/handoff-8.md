# TASK_2026_677_efcd — HANDOFF 8

> File name: `handoff-8.md`. NEVER write `HANDOFF.md` (user rule; decisions rows 8, 67; it overrides the
> session-budget banner). The next handoff is `handoff-9.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch `feat/clean-session-view`.
> Rebased onto `origin/main` `35c80dfa0` (PR #733 merged). 40 commits on top of origin/main, NONE pushed.
> `origin/feat/clean-session-view` is still the OLD pre-rebase tip `5ed660524` (not an ancestor of HEAD), so the
> push needs `--force-with-lease` = a force push: ASK THE USER FIRST (user-reserved, outward action).
> A git-ignored `node_modules` JUNCTION -> `D:\projects\ptah-extension\node_modules` exists in the worktree (row 53).
> Keep it for the task; remove it (`rmdir`, link only) before the worktree is removed.
> TEMPORARY user rule until 2026-10-16 (row 99, also in `C:\Users\abdal\.claude\CLAUDE.md`): Claude usage was at
> 95%, so orchestrate only and give all work to CLI lanes (`ptah_agent_spawn`), no Claude subagents. After that
> date the batches.md executors apply again.

## 1. Goal

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (work log -> "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live
line), "This session" inspector, header + composer chips, staggered session-switch animation, agent dock with provider
marks / role icons, and delta 3 (stats strip, stats panel, plan limits and the background-agent tray move into the
inspector). Frontend only. Testing postponed (no new spec files); existing suites, typecheck and lint still run.

## 2. Done (this session; all local commits on `feat/clean-session-view`)

| Step | Commit / result |
| --- | --- |
| Rebase onto origin/main `35c80dfa0` | 33 commits replayed; 2 barrel conflicts kept both sides (row 96) |
| W6 C-3 (grok lane) agent dock | `8ef9bbe26` (orchestrator: `select` -> `agentSelect`, jsdom PointerEvent spec fix; row 100) |
| W6 CV-2 (Claude) header, stagger, H1-H2 | `833914b34` (rows 98, 100) |
| CV-3 | verified no-op, no commit (row 93, 100) |
| B-5 (codex lane) Rail board inspector | `58d2084dc` (rows 101, 102) |
| W8 BUILD-1 | FAIL 3.67 MB vs 3.5 MB (row 103) |
| Phase review codex (excl. B-5) | `code-logic-review.md` REVISE 5/10 (row 104) |
| B-5 review grok | `code-logic-review-B-5.md` REVISE 5/10 (row 105) |
| FIX-1 chat logic + a11y (codex) | `ccc43b737` |
| FIX-2 lazy inspector entry, Rail focus, limit cue (codex) | `0cf3936f6` (`@ptah-extension/chat/inspector`) |
| FIX-3 D-1 a11y + e2e locators (codex) | `6e96c36c3` (row 106) |
| Re-review of fixes (grok) | `code-logic-review-fixes.md` APPROVED 7/10 (row 108) |
| Measurement build 2 | 3.62 MB; budget raised to 3.7 MB by user rule: `35f70fb34` (row 107) |
| Visual review (codex) | `visual-review.md` FAIL: 2 Serious, 1 Moderate; 69 shots in `screenshots/after/` (row 109) |
| FIX-4 visual defects (codex) | `5594828d3` (row 110); visual re-check still due |

- All 19 batches COMPLETE. Fix-round checks: typecheck + lint N=5 (chat, chat-ui, canvas, ptah-electron-e2e,
  webview-e2e-harness) exit 0; tests chat, chat-ui, canvas exit 0 (canvas 373/373).
- TASK_2026_649 D8: `chat/src/index.ts` tail is byte-identical with `feat/task-649-builders-on-chat` (row 106);
  the 649 session was told.
- Peer sessions (648/649, 678, 646) were told to use CLI lanes only until 2026-10-16.

## 3. In progress at handoff time

Nothing is running. No CLI lane, subagent, check or build is in flight.

- **FIX-4** DONE and committed `5594828d3` (row 110): 400 px compact sheet sized to the viewport with a visible close
  control and Escape; wide Rail aside renders the inspector for the shown session; dock card bounded to its pane
  (optional `boundary` on `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts`). Checks: canvas + ui
  typecheck, lint, test exit 0. Report `reports/batch-FIX-4.md`.
- NOT yet done: the visual re-check of those three screens (§5 step 4).

## 4. Open problems and decisions

1. FORCE PUSH needed (rebase): ask the user before
   `git push --force-with-lease=feat/clean-session-view:5ed660524 -u origin feat/clean-session-view`.
2. Docs (decisions rows 96-110, batches, handoff-7/8, all reports and reviews, `visual-review.md`) are committed in
   the last docs commit of this session. Commit later docs only when NO lane is running (lint-staged hides unstaged
   edits during the hook). `screenshots/` is git-ignored.
3. Named follow-up task "TASK_2026_677 follow-ups" (create it at completion; rows 104, 106, 107, 108):
   codex Moderate 3 (task cache keyed by taskId only, `session-task-reader.ts:60-69,101-105`), Moderate 4 (Answer
   cannot reach an unmounted question card, `chat-view.component.ts:1015-1027`), style item
   (`SESSION_WORKFLOW_ADDONS` `component: Type<unknown>`); D-1 Moderate 5 (null-session expansion key); B-5 Minor 4
   (branch title in sheet); re-review Moderate 1 (Rail cue `needsYou` hard-coded 0,
   `canvas-rail-board.component.ts:338`) and Moderate 2 (sheet Tab queries the first `[role="dialog"]`,
   `:736-741`); showcase `data-testid="canvas-tile"` missing (also on main); ~130 kB eager growth vs 3.49 MB
   baseline (candidate: `@defer` the turn activity panel); row 71 `--sel` never defined.
4. `SESSION_WORKFLOW_ADDONS` (B-3): CV-2 now reads it (header add-on lookup); no registrant yet. Keep.
5. Lane quotas at 19:44 UTC: codex weekly ~21% (only lane with room); grok weekly 91% (near limit); opencode
   monthly 92%; Glm AT LIMIT; antigravity unknown. Run `ptah_agent_list` before each spawn.

## 5. Exact next steps

1-3. DONE: FIX-4 verified and committed (`5594828d3`); docs committed (see `git log`).
4. Visual re-check on ONE codex lane (role `visual-reviewer`), scoped to the three FIX-4 screens, dark + light:
   rebuild renderer (`after-electron` build-dev + copy-renderer-dev as in `visual-before.md`), launch Electron with
   `--remote-debugging-port=9333`, reuse `.ptah/tmp/after-*.mjs`, stop Electron ONLY by its PID. Deliverable: append
   `## Re-check after FIX-4` to `visual-review.md` with a verdict.
5. After the re-check: commit `visual-review.md` (+ any later docs) in a docs commit; mark the FIX/visual rows in the
   batches.md "Phase review" section; create the follow-up task (§4.3).
6. Ask the user to approve the force push (§4.1). Then run push + `gh pr create` as ONE background command, base
   `main`; PR body: summary, test plan (checks above, BUILD 3.62 MB / budget 3.7 MB, visual review), the follow-up
   list, ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The pre-push hook runs di-lint
   and the Electron validate-deps gate; a failure needs a fix commit on top. Report the PR link.

## 6. Verification (one at a time, worktree root)

```
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t typecheck -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t lint -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t test -p <projects> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
```

Confirm the header "Running target X for N projects". Projects of this task: `@ptah-extension/chat`,
`@ptah-extension/chat-ui`, `@ptah-extension/canvas`, `@ptah-extension/chat-streaming`, `@ptah-extension/ui`,
`@ptah-extension/tasks-ui`, `@ptah-extension/shared`, `@ptah-extension/task-specs`, `ptah-extension-webview`,
`ptah-electron-e2e`, `@ptah-extension/webview-e2e-harness` (the last two: typecheck + lint only, no e2e runs).
Logs: `%TEMP%\629-check-<label>.log`. If check-run.mjs waits on a stale lock, confirm the holder PID is dead before
deleting the lock. No more webview builds (two were used: BUILD-1 and measurement build 2).

## 7. Key files

Task folder `.ptah\specs\TASK_2026_677_efcd\`: `decisions.md` (rows 96-109 are this session), `batches.md`
(Wave 8 result, Phase review), `reports/batch-*.md`, `code-logic-review*.md`, `visual-review.md`,
`visual-before.md`, `screenshots/{before,after}/`, `prototype/`, `parity-inventory.md`, `implementation-plan.md`.
New code entry: `libs/frontend/chat/src/inspector.ts` + `tsconfig.base.json` path `@ptah-extension/chat/inspector`.

## 8. Rules (repeat in every lane prompt)

Checks only via check-run.mjs; changed projects only, `--parallel=1 --skip-nx-cache`, Jest `--maxWorkers=2`; one heavy
check at a time; never push while a check or build runs; no workspace-wide runs; no build/serve/dev/e2e/package
except the Electron renderer rebuild for the visual re-check; no npm install; no git in `D:\projects\ptah-final-run-ws`;
never kill processes by image name; no bare git stash; codex resume refused above 60k context; never both
`class=""` and `[class]=""` on one element; write no new specs; lucide-angular icons, `ptah-provider-mark`; commits
foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100 (wrap 72), ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; at most 3 parallel CLI lanes; parallel executors run no nx
checks (row 59); ask the user only for removals, scope or irreversible actions; end each turn with a short summary.

All lanes had ended at handoff time (FIX-4 completed and committed, §3).
