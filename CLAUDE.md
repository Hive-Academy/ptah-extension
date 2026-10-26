# CLAUDE.md

## STRICT: Verification commands (memory-safe)

Wide test runs exhaust the developer machine's RAM. These rules are mandatory for the main
agent, every subagent and every CLI lane. Repeat them in any task prompt you hand to a lane.

- Verify with `npm run verify`. It runs `nx affected -t lint test typecheck --base=main`.
  - Only some projects or targets: `npm run verify -- -p A,B` / `npm run verify -- -t test -p A`.
  - Extra Nx or Jest flags go after a second `--`: `npm run verify -- -p A -- --testPathPatterns=foo`.
- `npm run verify` takes a slot of a machine-wide FIFO counting lock first, so at most 2 heavy
  checks run at a time across all sessions, lanes and worktrees. A second check starts only while
  at least 8 GB of memory is free and the first check has run for 30 s. A check on an empty lock
  always starts. While it waits it prints why (`waiting for a slot` / `waiting for memory`). Do
  not message other sessions about a "slot". `node scripts/verify.mjs --status` shows the slot
  holders, the queue and the free memory. A slot whose process is dead or older than 120 minutes
  is taken over automatically.
  - Tune per shell: `PTAH_VERIFY_SLOTS` (default 2; 1 restores one check at a time),
    `PTAH_VERIFY_MIN_FREE_GB` (default 8), `PTAH_VERIFY_SETTLE_SEC` (default 30).
- The caps are in config: `nx.json` runs one task at a time and `jest.preset.js` gives Jest 2
  workers per check. Do not raise them: Nx tasks, Jest workers and lock slots multiply. Run any
  other heavy command under the same lock:
  `node scripts/verify.mjs --exec --task <name> -- <command> [args...]`.
- Test, lint and typecheck results are cached in one Nx cache that the main checkout and every
  worktree share (`~/.nx/<workspace-id>/`). A check that main already passed is a cache hit.
  Do not set `cacheDirectory` or `NX_CACHE_DIRECTORY`: that turns the sharing off.
- Never run workspace-wide checks, and never `nx run-many` across projects you did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets unless the user asks for it.
- Prefer one foreground run with a long timeout. Filter its output (`| tail`, `grep`) instead of
  re-running the command to read it.

## Product focus: Electron first

The Electron desktop app (`apps/ptah-electron`) is the priority host. These rules apply to the
main agent, every subagent and every CLI lane. Repeat them in any task prompt you hand to a lane.

- Plan, build and verify features for Electron first.
- Do not start feature or polish work for the TUI (`apps/ptah-tui`) or the VS Code extension
  (`apps/ptah-extension-vscode` and VS Code-only webview surfaces) unless the user asks for it.
- Run visual reviews and screenshots in Electron only.
- Keep every host compiling. When a change touches a shared lib, still run typecheck and tests
  for each host project that depends on it; CI and the pre-push hook run them too.
- When a shared change removes something that a TUI or VS Code surface uses, make the smallest
  change that keeps that host working (for example a read-only view), and report it.

## Git: start every task in its own worktree

- Before you change any file for a new task, create a worktree on a new branch from `main`:
  `git worktree add -b <type>/<short-name> .claude-worktrees/<short-name> main`.
  `.claude-worktrees/` is git-ignored. Keep `<type>` to the commit type (`fix`, `feat`, ...).
- Make every edit, check and commit of the task inside that worktree. The main checkout stays
  on `main` with no task changes in it. Give the worktree path to each subagent and as the
  `workingDirectory` of each CLI lane for that task.
- Pure questions, read-only investigation and status commands need no worktree.
- Changes that are already in the main checkout move to a worktree before more work starts:
  create the worktree, copy the changed files, confirm they are identical (`cmp`), and only
  then revert them in the main checkout.
- The worktree and its branch stay until the user says to remove them. After the PR merges
  and the user authorizes cleanup, use `git worktree remove .claude-worktrees/<short-name>`.

## Git: complete the task through PR checks and review

- The default task workflow is worktree → implement → verify → review → commit → push →
  open a pull request → watch CI jobs and code reviews → address actionable findings.
  Do not finish a completed task with uncommitted changes or an unpublished branch.
- This is standing authorization to commit verified task changes, push the task branch,
  and open or update its pull request without a separate request for each step. It replaces
  older project preferences that require explicit follow-up approval for commits, pushes,
  or pull requests. Apply this authorization when a skill says the user handles Git or
  requires a separate commit/push request. Keep worker-lane ownership restrictions intact.
  A current user instruction to stop, keep work local, or defer delivery takes precedence.
  If a tool denies an action, stop that action and report the blocker.
- Only the coordinating agent commits, pushes, and manages the pull request. Delegate these
  actions explicitly if needed. Implementation lanes report their changes to that agent
  and must not push or open competing pull requests on their own.
- Inspect the worktree status and the complete task diff before each commit. Stage only
  task files by explicit path. Preserve unrelated changes. Follow `.commitlintrc.json` and
  the repository commit conventions. Do not bypass hooks or signing.
- Complete scoped verification and an independent review before the initial push. If a
  check cannot run or a failure blocks delivery, report the exact blocker. Do not claim
  success, suppress failures, or publish unfinished work as ready for review.
- Open the pull request against `main`. Inspect every task commit, not only the latest.
  Keep the title under 70 characters. Include `## Summary` and `## Test plan`, with actual
  verification results and any checks that did not run. Reuse an existing task PR.
- After each push, watch the PR's CI jobs and code reviews with `gh`. Use a background
  watcher for long waits. Inspect failed job logs, review comments, and unresolved threads.
  Address confirmed task-related defects, verify the fixes, create new commits, and push
  again. Explain why any disputed finding needs no change. Repeat for the new PR head.
- Do not treat a successful push as task completion. Report the PR URL, current head,
  CI results, and review state. If CI or reviews remain pending, explicitly report that
  state and keep the watch active while the session permits. Report failed, cancelled,
  timed-out, or unavailable checks and any blocker that needs the user's decision.
- This authorization does not permit merges, force pushes, history rewrites, branch
  deletion, or worktree removal. Keep the branch and worktree until the user authorizes
  cleanup. Never bypass a permission denial through another tool or agent.

## Git: commit in the foreground, push in the background

- Run `git commit` in the foreground. Never run it in the background: lint-staged hides
  unstaged changes during the hook and restores them afterwards, so a file edited while the
  hook runs can be committed or lost (see the TASK_2026_224 comment in `.husky/pre-commit`).
  The pre-commit hook is lint-staged only, so it is fast.
- Run `git push` (chained with `gh pr create` when a PR is due) as one background command
  (the Bash tool's `run_in_background`) and continue with other work; act on the result when
  it completes. The pre-push hook runs di-lint and the Electron `validate-deps` build gate on
  every push. A failed gate needs a fix commit on top, then push again. The hook takes the
  same verify lock as `npm run verify`, so a push can wait in the queue behind another check.

## Repo-local fleet rules

- The commitlint scope enum and other enforced commit rules live in `.commitlintrc.json`.
  Read that config before committing. Keep the subject at most 72 characters and every body
  line at most 100 characters; wrap body text at 72. `security` and `git` are not scopes.
- A multi-scope subject with commas is allowed, e.g. `fix(agent-sdk,chat): ...`.
- To test only the changed projects, run `npm run verify -- -t test -p A,B` and confirm that
  the output header says "Running target test for N projects" with N equal to the number
  requested. Never use positional `nx test A B` because those names become Jest path filters.
