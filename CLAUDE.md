# CLAUDE.md

## STRICT: Let hooks and CI verify; do not repeat their checks

Every local check costs tokens, time and RAM, and the same checks run again later. These rules
are mandatory for the main agent, every subagent and every CLI lane. Repeat them in any task
prompt you hand to a lane. They override any skill text that says to run checks after a change.

- What already runs:
  - pre-commit: lint-staged (ESLint and Prettier on the staged files);
  - pre-push: di-lint and the Electron `validate-deps` build gate;
  - CI on every PR into `main`: typecheck, lint, unit tests (sharded) and e2e.
- Default for work that goes to a PR into `main`: commit, push, and let CI check. Do not run
  typecheck, lint or test locally before a commit or a push. Never run again a check that a
  hook already ran.
- Run a local check only when one of these is true, and then only the smallest one:
  - you reproduce a CI failure: run only the failing spec file or project;
  - the work does not go to a PR into `main`, so CI does not run;
  - the user asks for it.
- CLI lanes and subagents run no `nx`, `jest`, `tsc`, lint or build command unless their task
  prompt says so. They may use `ptah_get_diagnostics` on the files they changed.
- A lane's report is still not proof: the orchestrator reads the diff, and code review and UI
  visual review still apply. CI is not a review.
- When CI fails, fix it with one commit on top and push again. Re-run a known flaky job once
  on GitHub (`gh run rerun <id> --failed`) instead of a local run.

## STRICT: Verification commands (memory-safe)

Wide test runs exhaust the developer machine's RAM. When a local check is allowed (see the
section above), these rules are mandatory for the main agent, every subagent and every CLI lane.

- Verify only the project(s) you changed:
  - `npx nx test <project>` / `npx nx typecheck <project>` / `npx nx lint <project>`, or
  - Jest on the changed spec files: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Never run workspace-wide checks, and never `nx run-many` across projects you did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets unless the user asks for it.
- Cap concurrency: `--parallel=1` for Nx, `--maxWorkers=2` for Jest.
- One heavy check at a time across all lanes. Never start a second one while one is in flight.
- Prefer one foreground run with a long timeout. Filter its output (`| tail`, `grep`) instead of
  re-running the command to read it.

## Product focus: Electron first

The Electron desktop app (`apps/ptah-electron`) is the priority host. These rules apply to the
main agent, every subagent and every CLI lane. Repeat them in any task prompt you hand to a lane.

- Plan, build and verify features for Electron first.
- Do not start feature or polish work for the TUI (`apps/ptah-tui`) or the VS Code extension
  (`apps/ptah-extension-vscode` and VS Code-only webview surfaces) unless the user asks for it.
- Run visual reviews and screenshots in Electron only.
- Keep every host compiling. When a change touches a shared lib, CI and the pre-push hook check
  each host project that depends on it; fix what they report before merge.
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
- The worktree and its branch stay until the user says to remove them. After the PR merges,
  remove it with `git worktree remove .claude-worktrees/<short-name>`.

## Git: commit in the foreground, push in the background

- Run `git commit` in the foreground. Never run it in the background: lint-staged hides
  unstaged changes during the hook and restores them afterwards, so a file edited while the
  hook runs can be committed or lost (see the TASK_2026_224 comment in `.husky/pre-commit`).
  The pre-commit hook is lint-staged only, so it is fast.
- Run `git push` (chained with `gh pr create` when a PR is due) as one background command
  (the Bash tool's `run_in_background`) and continue with other work; act on the result when
  it completes. The pre-push hook runs di-lint and the Electron `validate-deps` build gate on
  every push. A failed gate needs a fix commit on top, then push again.

## Repo-local fleet rules

- The commitlint scope enum and other enforced commit rules live in `.commitlintrc.json`.
  Read that config before committing. Keep the subject at most 72 characters and every body
  line at most 100 characters; wrap body text at 72. `security` and `git` are not scopes.
- A multi-scope subject with commas is allowed, e.g. `fix(agent-sdk,chat): ...`.
- When a local test run is allowed, for one changed project run
  `npx nx test <project> --parallel=1`. For several changed
  projects, run `npx nx run-many -t test -p A B --parallel=1` and confirm that the output
  header says "Running target test for N projects" with N equal to the number requested.
  Never use positional `nx test A B` because those names become Jest path filters.
