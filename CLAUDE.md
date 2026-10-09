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
