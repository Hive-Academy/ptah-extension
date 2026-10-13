# CLAUDE.md

## STRICT: Verification commands (memory-safe)

Wide test runs exhaust the developer machine's RAM. These rules are mandatory for the main
agent, every subagent and every CLI lane. Repeat them in any task prompt you hand to a lane.

- Verify only the project(s) you changed:
  - `npx nx test <project>` / `npx nx typecheck <project>` / `npx nx lint <project>`, or
  - Jest on the changed spec files: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Never run workspace-wide checks, and never `nx run-many` across projects you did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets unless the user asks for it.
- Cap concurrency: `--parallel=1` for Nx, `--maxWorkers=2` for Jest.
- One heavy check at a time across all lanes. Never start a second one while one is in flight.
- Prefer one foreground run with a long timeout. Filter its output (`| tail`, `grep`) instead of
  re-running the command to read it.

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
- For one changed project, run `npx nx test <project> --parallel=1`. For several changed
  projects, run `npx nx run-many -t test -p A B --parallel=1` and confirm that the output
  header says "Running target test for N projects" with N equal to the number requested.
  Never use positional `nx test A B` because those names become Jest path filters.
