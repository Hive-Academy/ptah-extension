# Handoff — TASK_2026_576_e16a (git review UI + git reliability)

Written 2026-10-03, end of session (replaces the 2026-10-02 handoff). P1-P5 are merged into `main`. The cutover
(Batches 58-69) is implemented; its phase-end review is in progress (logic round 1 fixed, visual review REVISE).

## 1. Where things stand

| Item | State |
|---|---|
| P1 (1-8) | MERGED (#611). |
| P2 (9-19) | MERGED (#619, `8b3575e66`, admin override at the user's request 2026-10-03). |
| P3 (20-32) | MERGED (#625, `c92550f83`). |
| P4 (33-44) | MERGED (#627, `161c2d18c`). |
| P5 (45-57) | MERGED (#629, `4ad10d856`). Phase review closed (`6a6902a61`). |
| Cutover (58-69) | ALL BATCHES COMPLETE. Branch `feat/task-2026-576-cutover`, worktree `.claude-worktrees/task-576-cutover` (node_modules junction), **draft PR #630 → `main`**. Last commit `32d7d84f3`. |
| Progress | 69/69 batches. Remaining: cutover phase-end review rounds, then `gh pr ready 630`. |

Merged phase branches and worktrees (`task-576-p2` … `task-576-p5`) are kept; delete only if the user asks.

## 2. Next steps, in order

1. **Logic review round 2.** `reviews/cutover-phase-review.md`: round 0 REVISE 7/10 (SER-1, MOD-1..4, MIN-1..3) →
   fix round 1 committed `825a12ab0` (all fixed, MIN-3 rejected with evidence; section "Fix round 1" in the file).
   Ask an independent reviewer to re-review `git show 825a12ab0` and write `cutover-phase-review-round1.md`. One more
   revise round is allowed after that (cap 2).
2. **Visual review fixes.** `reviews/cutover-visual-review.md`: REVISE 6/10. Fix V-1 (dock at ~319 px clips header
   and tabs; layout minimum is 300 px), V-2 (long branch name overlaps header controls,
   `git-dock-header.component.ts:54,88`), V-3 (Open-in caret transparent focus outline, `open-in-button.component.ts:72`),
   V-4 (Filter files input and commit textarea 20%-alpha focus ring), then V-5..V-9 (narrow split-diff toolbar, header
   wrapping, loud stale bar + no dirty marker in the spot editor, inverted truncation priority, PR panel "could not be
   read" for a repo with no GitHub remote). Rebuild (`NX_DAEMON=false npx nx run-many -t build-dev,copy-renderer-dev -p
   ptah-electron --parallel=1`) and re-capture with `apps/ptah-electron-e2e/src/specs/git/visual-review.spec.ts`
   (run with `-g <group>`), dark and light; write `cutover-visual-review-round1.md`.
3. Re-run axe (`git-dock`, `spot-editor-save`, `task-worktree-view`, `conflict-and-history-axe`, `commit-composer`
   specs singly) after the visual fixes; all surfaces must stay 0 critical/serious.
4. Tick the "Cutover phase-end review" checkbox in `batches.md` with an Outcome, update the progress header,
   `gh pr ready 630`, then watch #630's full CI (it targets `main`, so ci.yml, electron-e2e, webview-e2e, CLI E2E and
   git-real-git run) and CodeRabbit (auto-reviews PRs to `main`). Fix failures; reply to every CodeRabbit thread.
5. Give the user a short status (commits, PR link, verdict, open items). Do not merge #630 unless the user says so.

## 3. Mode of work

- Auto mode, no user questions except decisions only the user can make. Gates are decided by an independent reviewer
  of a different family/model, verified by the orchestrator, recorded under `reviews/`.
- **Lanes (2026-10-02/03): none usable.** antigravity hit its individual quota (reset ~127 h after 2026-10-02 11:53 UTC),
  Glm (`pc-355b645d-…`) is at its weekly Ollama limit, opencode/Kimi fails with "Unknown error" on both model ids. Never
  codex or copilot. Fallback in use (agent-lanes §6): independent `code-logic-reviewer` subagents on **Sonnet** (authors
  are Opus subagents), labelled weaker evidence. Re-test lanes with a one-line probe before relying on them.
- Subagents hit the Opus weekly/session limit twice; resume them with SendMessage after the reset.
- Merging: the user authorised `gh pr merge --merge --admin` for the P2-P5 stack only (code-owner review rule on
  `main`). Do not merge #630 without a new explicit instruction.

## 4. Open items carried forward

- Live checks only (Batch 69, `reviews/batch-69-verification.md`): R3 Windows watcher e2e, R7 card-to-turn reopen,
  R12 Skills diff drawer in a live VS Code (unit + VSIX packaging evidence only), A5 which worktree-removal path fires,
  A10 a real `gh` ≥ 2.20.
- Security: `toolAccess: 'none'` (commit-message query deny-all) not yet checked against the real SDK; secret-file
  filtering of the staged diff is a product decision for the user.
- `pierre-dark` comment tokens measure 2.9-3.3 (no comment in the axe fixture); Pierre expand buttons are
  `div role="button"` without a tab stop (needs Pierre).
- P5 accepted minors: a commit hook that rewrites the subject, or a multi-paragraph first line, leaves a timed-out
  commit "unconfirmed"; the first commit in an empty repo cannot be confirmed after a timeout; no push remote → `no-pr`.
- Pre-existing missing static import `chunk-5JJ6SBZ6.js` in the webview build (not caused by this task).
- Out-of-scope e2e failure: "C# AST reaches the packaged app" (`hunk-apply-real-rpc.spec.ts`, `never-indexed`).
- Follow-up task filed: **TASK_2026_593_7c2e** — one global notification system (toasts + center) replacing sticky
  notice strips; starts after the cutover merges.
- Stale log/comment handler lists: `cli-engine/src/lib/container.ts:832-834`, `phase-4-handlers.ts:154-159`.

## 5. Rules and practical notes

- Never touch or stage: `.ptah/specs/TASK_2026_555/**`, `.claude/skills/ptah-cli-usage/references/internal-mcp.md`,
  `apps/ptah-video-studio/**`, untracked `apps/ptah-electron/src/windows/.shell-security-*`. Stage explicit paths
  (`git status --short | awk '{print $2}'` → review → `xargs git add --`). No `.gitignore` image rule.
- No `--no-verify`, no amend, no force push, no rebase of pushed branches; merge `origin/main` in instead.
- Shared stash stack: never bare `git stash`; prefer WIP commits.
- Worktree `node_modules` is a junction to the main checkout's. Never `Remove-Item -Recurse` it; never plain
  `npm install`. Dependencies: `npm install <pkg>@<ver> --save-exact --package-lock-only --ignore-scripts`.
- Never stop processes named Ptah. Never run the full Electron e2e suite locally: single specs with
  `cd apps/ptah-electron-e2e && npx playwright test --config=playwright.config.ts --reporter=list src/specs/git/<name>.spec.ts`.
  Rebuild before e2e when source changed (see step 2). Real-RPC specs take ~2.5 min per test.
- **CI Jest cannot `require` ESM; local Node 24.15 can.** Run unit tests with
  `NODE_OPTIONS=--no-experimental-require-module` to match CI (but NOT for `verify-eager-bundle`, which it breaks).
  Specs that load the git-ui barrel need `jest.mock('@pierre/diffs', () => ({}))` and `'@pierre/diffs/worker'`.
- Run `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` before pushing; `main` lowers its
  baselines. Deliberate fallback catches need `// degradation-audit: optional-capability - …` or `reported - …` as the
  first line inside the catch.
- Under load: `NX_DAEMON=false`, one project at a time, `npx nx run <proj>:test --maxWorkers=2 --testPathPatterns=…`
  (plural). Known local-only failure: rpc-handlers `harness-skill-selection` "never writes state.json".
- Changing a PR's base does not trigger CI; close and reopen the PR (`reopened` event) to start the full workflows.
- CodeRabbit skips non-default-base PRs and is rate-limited (≈1 review/hour); request with `@coderabbitai review`.
- SonarCloud issues: `https://sonarcloud.io/api/issues/search?componentKeys=Hive-Academy_ptah-extension&pullRequest=<n>`;
  a `// NOSONAR` must sit on the flagged line itself.
- AA rule: never alpha base-content classes; `text-base-content-muted` (`--bcm`) is now derived to pass on base-100,
  base-200 and base-300 in every theme (`base-content-muted.spec.ts`).
- Commits: header ≤ 100 chars, scopes such as `git-ui`, `vscode-core`, `electron`, `e2e`, `webview`, `chat`, `ci`;
  end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with the Claude Code line.
- Read first in a new session: this file, `context.md` (gate decisions), `batches.md` (Cutover section, waves table,
  Outcomes), `reviews/cutover-phase-review.md`, `reviews/cutover-visual-review.md`.
