# CI fix report: PR #647 (TASK_2026_597 S4 Wave D)

## Root cause

Wave D added a DI construction cycle in `libs/backend/agent-sdk`:

`SessionLifecycleManager` (ctor #16, `SDK_SUBAGENT_BUDGET_MONITOR`, `isOptional`)
-> `SubagentBudgetMonitor` (`dispatcher`) -> `SubagentMessageDispatcher` (`sessionLifecycle`)
-> `SessionLifecycleManager` -> ... (the monitor also injected `SDK_SESSION_LIFECYCLE_MANAGER` directly).

tsyringe's `isOptional` only covers an unregistered token, so it does not break a cycle. Resolving the
manager recursed until it failed. That one failure accounts for all three red jobs:

- The Electron `container.smoke.spec.ts` failed with `Cannot inject the dependency at position #16 of "SessionLifecycleManager"` (repeated recursively).
- The CLI E2E log has 63 occurrences of `Cannot inject the dependency at position #16 of "Wp" constructor`. `Wp` is the minified `SessionLifecycleManager`. Every command that boots the engine exits 5.
- electron-e2e: the same boot path (not re-run locally).

The `MigrationRunner`, `Logger`/Thoth and `setPermissionLevel` lines in the CLI log are marked
non-fatal. They were not investigated further. After the fix, `init` exits 0.

A second, separate failure: `wire-runtime.spec.ts` builds its container by hand, and
`PostToolUseHookHandler` now injects `SDK_TOOL_OUTPUT_CAPPER`. tsyringe has no `?`-optional, so the
hand-built container needs that token too. This was only a gap in the test fixture. Production
registers the capper in `registerSdkServices`.

## Fix (smallest change)

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`: now a plain class
  without tsyringe decorators, following the `CompactionCoordinator` precedent. The two collaborators
  on the cycle are narrowed to `Pick<SubagentMessageDispatcher, 'stopSubagent'>` and
  `Pick<SessionLifecycleManager, 'find'>`, which are the only members the monitor uses. Behaviour is
  unchanged, and the existing spec compiles as is.
- `libs/backend/agent-sdk/src/lib/di/register.ts`: `SDK_SUBAGENT_BUDGET_MONITOR` is now an
  `instanceCachingFactory` (still a singleton). The factory passes ports that resolve the dispatcher
  and the lifecycle manager on first use (at stop or stream time). By then the manager already
  exists, so constructing it no longer recurses.
- `apps/ptah-electron/src/activation/wire-runtime.spec.ts`: registers a stub `SDK_TOOL_OUTPUT_CAPPER`
  in the hand-built test container.

## Verification

- `jest -c apps/ptah-electron/jest.config.ts wire-runtime.spec.ts container.smoke.spec.ts`: 2 suites, 36 tests passed. Both had failed before the change.
- `jest -c libs/backend/agent-sdk/jest.config.ts --maxWorkers=2 helpers/compaction lib/di`: 9 suites, 175 tests passed.
- `nx test ptah-cli --testFile=container.smoke.spec.ts`: 10 tests passed.
- `nx build ptah-cli` succeeded. Then `node dist/apps/ptah-cli/main.mjs init` in an isolated HOME and an empty workspace: exit 0, `init.plan` emitted, no `Cannot inject` on stderr. The CI run had exit 5 for this command.
- The CLI e2e jest harness could not run locally. `jest --config apps/ptah-cli/jest.e2e.config.cjs` reports "No tests found" in this worktree, even with `--runTestsByPath`. This looks like a discovery problem from the worktree path, not from the code. CI is the authority for the full harness.
- `nx run-many -t typecheck,lint -p agent-sdk ptah-electron`: success.
- `nx run di-lint:lint`: success.
- `nx run degradation-audit:lint`: exit 0, every project within baseline.

## Out-of-scope observations

- While this work ran, the worktree also had uncommitted edits that are not mine, in
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` and
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts`. They come from a
  concurrent session. One transient ts-jest run reported `Cannot find name 'ContextUsageReading'`
  in that file; later typechecks passed. The orchestrator should decide whether those edits belong
  in the commit.
