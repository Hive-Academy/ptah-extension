# Handoff — TASK_2026_576_e16a (git review UI + git reliability)

Written 2026-10-02, end of session (replaces the 2026-10-01 handoff). P1 merged; P2–P4 complete and ready for
review; P5 in progress (Batches 45–46 done); Cutover not started.

## 1. Where things stand

| Item | State |
|---|---|
| P1 (Batches 1–8) | MERGED into `main` (PR #611). The `task-576-p1` worktree is stale and can be removed. |
| P2 (9–19) | COMPLETE. `feat/task-2026-576-p2`, worktree `.claude-worktrees/task-576-p2`, **PR #619 → `main`, ready, CI green**. All 9 CodeRabbit comments fixed and answered (`082aa68f5`, `8cd3a6fc3`, `01bcde088`, `50a34ee99`). |
| P3 (20–32) | COMPLETE. `feat/task-2026-576-p3`, worktree `.claude-worktrees/task-576-p3`, **PR #625 → P2, ready**. Review closed (`87ff2f507`). |
| P4 (33–44) | COMPLETE. `feat/task-2026-576-p4`, worktree `.claude-worktrees/task-576-p4`, **PR #627 → P3, ready** (marked ready 2026-10-02; CodeRabbit only reviews non-draft PRs, so its comments may now be arriving). Review closed (`6a05fa18b`). |
| P5 (45–57) | IN PROGRESS. `feat/task-2026-576-p5`, worktree `.claude-worktrees/task-576-p5`, **draft PR #629 → P4**. Done: 45 `13c76d8df`, 46 `85c5ea1e6`. P4 merged forward (`734aea6a8`). Next: Batch 47. |
| Cutover (58–69) | NOT STARTED. Branch from P5 when P5 closes. |
| Progress | 46/69 (`batches.md` header on the P5 branch). |

Stack: `main` ← #619 (P2) ← #625 (P3) ← #627 (P4) ← #629 (P5). **Full CI (`ci.yml`, e2e workflows) only runs on PRs
targeting `main`**; stacked PRs get only SonarCloud, GitGuardian and CodeRabbit. When #619 merges, merge `origin/main`
into P3, retarget #625 to `main`, and repeat up the stack (merge forward, never rebase).

Read first: `context.md` (gate decisions, Auto mode), `batches.md` (per-batch specs, Outcome notes, phase-end
checkboxes, P4/P5 waves tables), `reviews/` (phase reviews and gate decisions).

## 2. Mode of work (user, 2026-10-01/02)

- **Auto mode**: finish all phases without asking the user. Gates are decided by an independent lane of a different
  family, recorded under `reviews/`, and verified by the orchestrator before acceptance.
- After each phase: cross-side logic review (subagent-authored code → CLI lane; lane-authored → subagent), fix
  findings (max 2 revise rounds), e2e, visual review where surfaces are mounted, tick the checkbox, `gh pr ready`,
  then give the user a short status (commits, PR link, verdict, open items).
- User (2026-10-02): open PRs, watch CI, fix failing jobs, address CodeRabbit comments, make them ready for review.
- Limits: never commit to or merge into `main`, never merge a PR, no `--no-verify`, no amend, no force push, no rebase
  of pushed branches, never approve a removal outside the approved parity list, never touch protected paths.
- Executors: subagents (backend-developer, frontend-developer, senior-tester, visual-reviewer, code-logic-reviewer)
  plus CLI lanes. Not codex, not copilot. Max 3 lanes in flight. Wait for completion signals; do not poll.
  - **antigravity**: the working CLI lane. Often exits 1 *after* writing its deliverable — check the file. It stalls
    on long background shell searches (tell it to use short view/search steps) and hits a short quota (resets in
    minutes) — resume with `resume_session_id`.
  - **Glm** (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`): hit its **weekly** Ollama limit 2026-10-02.
  - **opencode/Kimi**: failed with "Unknown error" — treat as unavailable unless re-tested.

## 3. Next steps, in order

1. **PR #627**: check for CodeRabbit comments now that it is ready; fix valid ones on P4, reply to each, merge P4
   forward into P5. Same for #625 if new comments arrived.
2. **P5** per the waves table in `batches.md` (P5 section): W3 47 → W4 48 ∥ 49 → W5 50 ∥ 51 → W6 52 → W7 53 ∥ 57 →
   W8 54 ∥ 55 → W9 56. Read each preceding Outcome's "Notes for Batch N" (45 and 46 left notes for 47).
3. **Before cutover (security)**: add a tool allow-list / deny-all to `InternalQueryConfig` + `SdkQueryRunner` and use
   it in `CommitMessageGenerator` (Batch 46 Outcome — a prompt-injected diff could make the single turn run a
   built-in tool). Can be a P5 follow-up or folded into Batch 47.
4. P5 phase-end review (cross-side logic; surfaces unmounted, visual review moves to cutover), `gh pr ready 629`.
5. **Cutover** (58–69): new branch/worktree/PR from P5. Follow the Batch 43 Outcome checklist (mount
   `ReviewShellComponent` in `electron-shell.component.ts` ~372; register `FileContentChangesService` under
   `MESSAGE_HANDLERS`; point `FileLinkRouterService.openInDock` at `ReviewNavigationService.openFile`; retarget the
   git-dock specs/e2e; move `statusUnavailableLabel` out of source-control-panel; keep the Changes body mounted
   across tabs), Task 58.2 (ChangeSetActionsService Electron path → ReviewNavigationService), Batch 60 re-measures
   the A9 scroll budget, visual review of all mounted surfaces (dark + light).

## 4. Open items carried forward

- Security: `InternalQueryConfig` tool allow-list (above).
- Canvas Edit button not wired (`ReviewNavigationService.openFile(path, line?, { editable: true })` exists).
- Webview initial bundle budget warning: 3.36 MB vs 2.5 MB (pre-existing; not investigated).
- Manual check: zero CSP violations in a live VS Code webview after the `style-src 'unsafe-inline'` and
  `worker-src blob:` changes (gates `reviews/gate-p4-pierre-csp.md`, `reviews/gate-p4-a9-pierre-perf.md`).
- Electron change-set card review/SCM actions only reveal the dock until Task 58.2.
- Repo-subfolder workspace assumption remains for apply/stage/blob reads; rename+commit within one turn reports the
  old path as `M`; real-git spec for the 2 MiB review-reader limit; diff-tabs spec gaps.
- Stale log/comment handler lists: `cli-engine/src/lib/container.ts:832-834`, `phase-4-handlers.ts:154-159`.
- `git-info.service.ts` is far over max-lines (warning); new logic goes into `services/git/` collaborators.
- Known flakes under machine load (pass alone): rpc-handlers `harness-skill-selection` "never writes state.json"
  (also on `main`), `mcp-directory-rpc`, `SurfaceRpcHandlers`, `HarnessWorkspaceContextService`; ptah-electron
  `git-watcher.stress`, shell-csp; git-ui axe specs; agent-sdk `off-thread-process-spawner`; real-git `remote-stash`
  and `hooks`. Jest worker-exit warnings in several specs.

## 5. Rules and practical notes

- Never touch or stage: `.ptah/specs/TASK_2026_555/**`, `.claude/skills/ptah-cli-usage/references/internal-mcp.md`,
  `apps/ptah-video-studio/**`, the untracked `apps/ptah-electron/src/windows/.shell-security-*` test folders. Stage
  explicit paths only. No `.gitignore` image rule.
- Shared stash stack: never bare `git stash`/`pop`; tagged push, apply by SHA, drop by tag. Prefer WIP commits.
- Worktrees use a `node_modules` junction to `D:\projects\ptah-extension\node_modules`. Never `Remove-Item -Recurse`
  it. **Never run `npm install` in a worktree** — it replaces the junction. To add a dependency:
  `npm install <pkg>@<ver> --save-exact --package-lock-only --ignore-scripts` in the worktree, then install in a
  scratch folder (e.g. `D:\tmp\x`) and copy only packages missing from the main `node_modules` (done this way for
  `@pierre/diffs` and the CodeMirror packages).
- Never stop processes named Ptah (the user's desktop app). Do not run the full Electron e2e suite locally (it
  conflicts with that app); run single specs with their own user-data folder. The VS Code e2e runner
  (`apps/ptah-extension-vscode-e2e`, `node src/runner.mjs`) is quick and safe.
- Under machine load Nx crashes (plugin workers, EPIPE): use `NX_DAEMON=false`, run projects one at a time, and pass
  `--maxWorkers=2` to `nx run <proj>:test` (not through `run-many`, which forwards it to tsc).
- Eager-bundle guard: `npx nx run ptah-extension-webview:verify-eager-bundle`; forbidden markers live in
  `apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs` (`ptah-git-`, `ptah-diff-view`,
  `No longer changes HEAD`, `cm-editor`). Lazy entries: `@ptah-extension/git-ui/services`,
  `@ptah-extension/git-ui/diff-renderer`, `@ptah-extension/chat-ui/change-set-card`.
- AA rule: never alpha base-content classes (`text-base-content/70`); use `text-base-content-muted`
  (`no-alpha-base-content.spec.ts` enforces it).
- Commits: header ≤ 100 chars, scopes `vscode-core`, `electron`, `git-ui`, `e2e`, `webview`, `ci`, `shared`; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with the Claude Code line. Pre-commit hook:
  format, `nx affected -t lint` (incl. `degradation-audit`; a marker must sit on a flagged catch site),
  `ptah-electron:validate-deps`, commitlint.
- `@nx/jest` needs `--testPathPatterns` (plural). Real-git specs: `*.real-git.spec.ts`, run by
  `vscode-core:test-real-git`; use `fs.realpathSync.native` for Windows temp paths.
- SonarCloud: query `https://sonarcloud.io/api/issues/search?componentKeys=Hive-Academy_ptah-extension&pullRequest=<n>`
  (the MCP issue search returned nothing); fix reliability/security issues on new code (regex backtracking,
  `replaceAll`, explicit sort compare, absolute executable paths).
