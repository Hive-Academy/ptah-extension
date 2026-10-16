# TASK_2026_677_efcd — HANDOFF 5

> File name: `handoff-5.md`. NEVER write `HANDOFF.md` (user rule; it overrides the session-budget banner, decisions
> rows 8, 67). The next handoff is `handoff-6.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch `feat/clean-session-view`
> (from main `c57a9a1e7`). Origin has commits up to `5ed660524`. Everything after it is LOCAL ONLY (not pushed), no PR.
> A git-ignored `node_modules` JUNCTION → `D:\projects\ptah-extension\node_modules` exists in the worktree (row 53).
> Keep it for the task; remove it before the worktree is removed.

## 1. Goal

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (work log → "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live line),
"This session" inspector, header + composer chips, staggered session-switch animation, T1 carry-over, delta 2 agent dock
with provider marks / role icons, and delta 3: session stats strip, expanded stats panel, plan limits and the
background-agent tray leave the chat main column and move into the inspector. Frontend only.

User rules: Claude (orchestrator + Claude sub-agents) builds the frontend. NEW in session 5 (row 60): CLI lanes may
also BUILD self-contained batches that mostly add new files (D-1 done on codex; C-3 lane-suitable). A lane-built batch
gets its code review from a different family. Approval mode lane-review (codex APPROVED passes Gates 1, 1.7, 2). Ask
the user only for removals, scope or irreversible actions. Testing postponed (no new spec files); existing suites,
typecheck and lint of every changed project still run. lucide-angular icons; `ptah-provider-mark` CLI marks.

## 2. Done (session 5)

- Delta 3 Gate 1.7 PASSED: revise round 1 (designer + PM) → codex `design-spec-review-delta3-r1.md` APPROVED 9/10 (row 61).
- Wave 2 COMPLETE (row 62): A1-4 `49c153d69`, A1-1 `b9d47a8df`, C-2 `3db987a97`, batches `b2d0dd063`.
  Typecheck/lint/test exit 0 for chat, chat-ui, chat-streaming.
- Delta 3 plan: architect `plan-part-d-stats.md` merged into `implementation-plan.md` (row 63). Gate 2 delta: codex
  REVISE 5/10 (row 65) → architect revise round 1 → codex `implementation-plan-review-delta3-r1.md` APPROVED 9/10 (row 66).
- USER decisions: row 60 (lanes build self-contained batches), row 64 (removal R2 approved: CV-1 deletes
  `BackgroundAgentTrayComponent` and moves its two specs onto the `session-agent-tray` service, same cases).
- Team-leader MODE 1 update (commit `9c008bfc8`): 18 batches + BUILD-1 = 19; new batch D-1 in W3; B-4, A1-3, CV-1,
  CV-2, B-5, A2-2 amended; R2 in parity-inventory; C-3 HOLD for PR #733.
- Wave 3 executors finished (row 67), NOT verified, NOT committed:
  - B-3 (Claude): `libs/frontend/chat/src/lib/services/session-inspector/`, `libs/frontend/chat/src/lib/tokens/session-workflow-addons.token.ts`,
    `session-git-stats.store.ts` (+ `.spec.ts` edited), `libs/frontend/chat/src/lib/services/index.ts`, `libs/frontend/chat/src/index.ts`,
    `apps/ptah-extension-webview/src/app/app.config.ts`. Report `reports/batch-B-3.md`.
  - A2-1 (Claude): `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`. Report `reports/batch-A2-1.md`.
  - D-1 (codex lane, CLI Session `01a14023-4f9f-7f80-b643-2fd97919e91b`): 6 new chat-ui files (`session-stats-view.ts`,
    `plan-limits/session-limit-summary.ts`, `atoms/context-ring.component.ts`, `session/inspector-stats/*`,
    `background-agent-population.ts`) + 6 modified chat-ui files incl. `chat-ui/src/index.ts`. Report `reports/batch-D-1.md`.
- Follow-up task filed earlier: TASK_2026_679_45ff (backlog; session list sidebar → "Previous sessions" modal).

## 3. Open at handoff (no agent or lane is running)

1. **Wave 3 MODE 2 not run.** First step of session 6. Notes for it (row 67): B-3 edited an existing spec
   (`session-git-stats.store.spec.ts`) — confirm it is an allowed update; B-3 uses a chat-local `SessionGitState`
   instead of widening chat-ui `CompactGitState`; B-3 moved the `TasksChangedFeed` handler provider into `app.config.ts`;
   B-3 notes stale plan line numbers in batches.md; A2-1 dot uses `var(--sel, var(--ptah-gold, …))` (no new token).
   Executors saw pre-existing type errors in other spec files via `ptah_get_diagnostics`; the real typecheck decides.
   Changed projects: `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `ptah-extension-webview` (confirm with `git status`).
2. **C-3 HOLD**: PR #733 (TASK_2026_648) still OPEN at 2026-10-15 end of session 5. C-3 joins the first wave after the
   rebase and must finish before W6 (B-5 depends on it). Lane-suitable (one codex or grok lane, whole batch, review by
   another family).
3. Minor open (recorded, not fixed): `prototype/DELTA-3-NOTES.md:27,35` keep superseded text (row 61).
4. Risks to carry: showcase e2e scenes `canvas-orchestra.scene.ts:154`, `chat-code-edit.scene.ts:121` look for the stats
   strip in chat-view (not run; R-D6); Rail closed-state limit cue open check D-O6 (B-5 reports back).

## 4. Decisions to know (decisions.md rows 1-67)

Rows 43-58 (session 4) plus: 59 parallel executors run no nx checks; 60 USER lanes build self-contained batches;
61 Gate 1.7 delta 3 pass; 62 W2 complete; 63 plan part D; 64 USER removal R2; 65/66 Gate 2 delta; 67 W3 executors done.

## 5. Exact next steps

1. Read this file, then `decisions.md` rows 59-67, then `batches.md` lines 142-162 (Wave rule, STRICT rules) and the
   Wave 3 section (446-778). Read the plan files only with offset/limit.
2. Fresh team-leader MODE 2 for Wave 3 with the three report paths (`reports/batch-B-3.md`, `batch-A2-1.md`,
   `batch-D-1.md`) and the row-67 notes. It runs typecheck/lint/test once on the combined tree and commits each batch.
3. `gh pr view 733 --json state,mergedAt`. If merged: rebase onto main between waves (rows 55, plan §7.4 H1-H3), re-check
   the node_modules junction target matches the worktree package.json/lock, then run C-3 on a lane.
4. W4 (A2-2, A1-2, B-4) → W5 (A1-3, CV-1) → W6 (CV-2, B-5) → W7 CV-3 (team-leader may close it as a verified no-op inside
   W6 MODE 2 if A1-3 names no chat-view binding) → W8 BUILD-1:
   `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`
   (compare to the 3.5 MB error budget). Fresh team-leader MODE 2 per wave; at most 3-4 executors per wave; parallel
   executors run no nx checks (row 59).
5. Phase review: codex code-logic review of the phase diff (`code-logic-review.md`, plus a style check of new public
   exports). D-1 (and C-3 if lane-built by codex) need a NON-codex reviewer (Claude code-logic-reviewer or grok) →
   one fix round → `visual-reviewer` dark + light vs `prototype/` and `screenshots/before/` (Electron renderer rebuild
   only; the junction must exist) → final commit.
6. Before push: rebase after #733 merges. Then push + `gh pr create` as ONE background command; PR body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
7. Verification (per changed project, one at a time, from the worktree root):
   ```
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t typecheck -p <projects> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t lint -p <projects> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t test -p <projects> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs proto-checks -- node .ptah/specs/TASK_2026_677_efcd/prototype/assets/capture.mjs checks
   ```
   Confirm the header "Running target X for N projects" equals N. Projects: `@ptah-extension/chat`,
   `@ptah-extension/chat-ui`, `@ptah-extension/chat-streaming`, `@ptah-extension/ui`, `@ptah-extension/tasks-ui`,
   `@ptah-extension/shared`, `@ptah-extension/task-specs`, `ptah-extension-webview` (verify canvas project name before C-3/B-5).
   If check-run.mjs waits on a stale lock, confirm the holder PID is dead before deleting the lock (row 62 MODE 2 note).

## 6. Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\`
  - `task-description.md` (req 21 = delta 3), `parity-inventory.md` (R1, R2), `design-spec.md` (Delta 3 + revise r1 log),
    `decisions.md`, `implementation-plan.md` + `plan-part-{a1-turn,a2-header,b-inspector,c-agents,d-stats}.md`,
    `batches.md` (D-1 lane brief at ~689-777), `reports/batch-*.md`
  - reviews: `implementation-plan-review{,-r1,-delta3,-delta3-r1}.md`, `design-spec-review-delta3{,-r1}.md`
  - `prototype/`, `visual-before.md`, `screenshots/before/` (git-ignored)

## 7. Rules (repeat in every lane and sub-agent prompt)

Never kill processes by image name (stop only own PIDs); give designers/architects a context budget (~120k, write the
deliverable early and extend it per section, offset/limit reads, <= 2-3 PNG views); codex resume is refused above 60k
context → give fresh lanes complete briefs. Checks only via `node .ptah/tmp/check-run.mjs <label> -- <command>`;
changed projects only, `--parallel=1 --skip-nx-cache`, Jest `--maxWorkers=2`; one heavy check at a time (never push
while a check or build runs); no workspace-wide runs; no build/serve/dev/e2e/package except the Electron renderer
rebuild and BUILD-1; no npm install; no git in `D:\projects\ptah-final-run-ws`; UI changes need before/after screenshots
dark + light; commits foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`; at most 3 parallel CLI lanes; handoff files are
`handoff-N.md`, never `HANDOFF.md`. End each turn with a short summary of what is done and what is left.
