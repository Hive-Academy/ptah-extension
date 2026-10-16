# TASK_2026_677_efcd — HANDOFF 7

> File name: `handoff-7.md`. NEVER write `HANDOFF.md` (user rule; decisions rows 8, 67; it overrides the
> session-budget banner). The next handoff is `handoff-8.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch `feat/clean-session-view`.
> Origin has commits up to `5ed660524`. Everything after it is LOCAL ONLY (not pushed), no PR. Working tree clean.
> A git-ignored `node_modules` JUNCTION → `D:\projects\ptah-extension\node_modules` exists in the worktree (row 53).
> Keep it for the task; remove it before the worktree is removed.

## 1. Goal

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (work log → "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live
line), "This session" inspector, header + composer chips, staggered session-switch animation, agent dock with provider
marks / role icons, and delta 3 (stats strip, stats panel, plan limits and the background-agent tray move into the
inspector). Frontend only. Claude builds the frontend; CLI lanes may build self-contained batches (row 60) and review.
Testing postponed (no new spec files); existing suites, typecheck and lint of every changed project still run.

## 2. Done (local commits on `feat/clean-session-view`, none pushed)

| Wave | Commits |
| --- | --- |
| W3 | B-3 `cd37b5a44`, A2-1 `567a62a3f`, D-1 `9e36b8753`, docs `415d33556`, `7fa0856c0` |
| W4 | A2-2 `d389caab0`, A1-2 `b5d707631`, B-4 `d5951a2f7`, docs `65add1d60` |
| W5 | A1-3 `3582cf696`, CV-1 `db7b896df`, docs `608f73878` (decisions rows 85-95, `handoff-6.md`, reports) |

- 14/19 batches complete. W5 checks for `@ptah-extension/chat`: typecheck, lint, test exit 0 (after one fix round, row 86).
- Row 85: cross-task contract with TASK_2026_649 (option B; 649's D1/D8 confirmed unchanged by the 649 session).
  CV-1 created `libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts` + barrel line; bare mode hides the
  inspector / default-open / shell controller. CV-2 must hide the session header when bare.
- Row 91: `@ptah-extension/tasks-ui/presentation` resolves in chat Jest (closes row 84).
- Row 93: CV-3 is a verified no-op input (A1-3 needs no chat-view binding). W6 MODE 2 records it as
  `Commit: none (verified no-op)` after CV-2 commits.
- PR #733 (TASK_2026_648) MERGED into main as `35c80dfa0` (2026-10-15 17:09 UTC). C-3 is unblocked after the rebase.
  The local `main` ref is stale (`69965051d`); fetch first and rebase onto `origin/main`.

## 3. Open problems and decisions

1. D-1 grok review `code-logic-review-D-1.md` = REVISE 5/10. Fixes held for the ONE phase fix round (row 77):
   Serious 1-3, Moderate 4, 6, 7; Moderate 5 only if trivial. Grok re-reviews the D-1 fixes.
2. Row 81: A2-2 `aria-haspopup="menu"` on a non-menu popover → likely `dialog` (phase fix round).
3. Row 94: A1-3 copy button kept at 24 px → phase / visual review.
4. Row 95: four e2e/showcase locators still look for `ptah-session-stats-summary` (no owner yet):
   `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:154`, `.../chat-code-edit.scene.ts:121`,
   `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:282`,
   `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:117`.
   Fix in the phase fix round (locator update only) or file a follow-up task.
5. CV-2 must use exactly `aria-controls="inspector"` (row 90; CV-1 put `id="inspector"` on the inspector element).
6. USER question (ask once if relevant): `SESSION_WORKFLOW_ADDONS` (B-3) has no consumer; removal is the user's call.
7. Row 71 (record only): A2-1 uses `--sel`, never defined.
8. Lane quotas at last check: codex weekly 14%, grok weekly 43%; opencode near its monthly limit; glm AT LIMIT.
   Run `ptah_agent_list` for the live roster.

## 4. Exact next steps

1. Read this file, then `decisions.md` rows 77-95, then `batches.md` Wave rule + STRICT rules (~142-162), C-3
   (~565-625), Wave 6-8 (~1204-1400). Use offset/limit reads.
2. Rebase: `git fetch origin`, then `git rebase origin/main` (plan §7.4 H1-H3; resolve conflicts in canvas files
   with 648's changes). Re-check that the `node_modules` junction target still matches the worktree package.json /
   lock (if main changed dependencies, stop and tell the user; no npm install). Re-verify the C-3 file list
   against the rebased tree.
3. C-3 on ONE lane (codex or grok, whichever has room): give the batch section verbatim plus absolute paths and the
   cited `plan-part-c-agents.md` ranges; workingDirectory = worktree root. In parallel, CV-2 on one Claude
   frontend-developer (disjoint files: chat vs canvas). Review C-3 by a different family.
4. W6 MODE 2 (team-leader): verify + commit CV-2, C-3; record the CV-3 no-op. Then B-5 (Claude, canvas; needs C-3)
   → MODE 2.
5. W8 BUILD-1:
   `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`
   (compare with the 3.5 MB error budget).
6. Phase review: codex code-logic review of the phase diff (`code-logic-review.md` + style check of new public
   exports); C-3 if codex-built gets a non-codex reviewer. One fix round (codex findings + §3 items 1-4). Grok
   re-reviews the D-1 fixes.
7. `visual-reviewer` dark + light vs `prototype/` and `screenshots/before/` (Electron renderer rebuild only).
8. Final commit, then push + `gh pr create` as ONE background command (PR body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Report the PR link.

## 5. Verification (one at a time, worktree root)

```
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t typecheck -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t lint -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t test -p <projects> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs proto-checks -- node .ptah/specs/TASK_2026_677_efcd/prototype/assets/capture.mjs checks
```

Confirm the header "Running target X for N projects". Projects: `@ptah-extension/chat`, `@ptah-extension/chat-ui`,
`@ptah-extension/chat-streaming`, `@ptah-extension/ui`, `@ptah-extension/tasks-ui`, `@ptah-extension/canvas`,
`@ptah-extension/shared`, `@ptah-extension/task-specs`, `ptah-extension-webview`. If check-run.mjs waits on a stale
lock, confirm the holder PID is dead before deleting the lock.

## 6. Key files

Task folder `.ptah\specs\TASK_2026_677_efcd\`: `task-description.md`, `parity-inventory.md`, `design-spec.md`,
`decisions.md`, `implementation-plan.md` + `plan-part-{a1-turn,a2-header,b-inspector,c-agents,d-stats}.md`,
`batches.md`, `reports/batch-*.md`, `code-logic-review-D-1.md`, `prototype/`, `screenshots/before/` (git-ignored).

## 7. Rules (repeat in every lane and sub-agent prompt)

As handoff-5.md §7: checks only via check-run.mjs; changed projects only, `--parallel=1 --skip-nx-cache`, Jest
`--maxWorkers=2`; one heavy check at a time; never push while a check or build runs; no workspace-wide runs; no
build/serve/dev/e2e/package except the Electron renderer rebuild and BUILD-1; no npm install; no git in
`D:\projects\ptah-final-run-ws`; never kill processes by image name; no bare git stash; architects/designers ~120k
context, write early; codex resume refused above 60k context; UI changes need before/after screenshots dark + light;
never both `class=""` and `[class]=""` on one element; write no new specs; lucide-angular icons, `ptah-provider-mark`;
commits foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100 (wrap 72), ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; at most 3 parallel CLI lanes; parallel executors run no nx
checks (row 59); ask the user only for removals, scope or irreversible actions; end each turn with a short summary.
