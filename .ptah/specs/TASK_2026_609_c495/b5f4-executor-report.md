## Backend implementation — TASK_2026_609_c495, batch B-5f4

**Tasks implemented:** CLI settings registration and lazy harness model getter. Verification is incomplete because the CLI engine test target failed.

**Files modified:**
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\platform-cli\src\settings\cli-settings-registration.ts` — import AgentModelSettings and register exactly one construction with useValue inside the existing scopeResolver guard (lines 104–106). No registration without the resolver.
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\cli-engine\src\lib\container.ts` — add a type import and pass undefined, undefined, then a lazy fourth argument resolving SETTINGS_TOKENS.AGENT_MODEL_SETTINGS or null (lines 670–686). No construction here.

**Stack observed:** Node 24, TypeScript 6.0.3, tsyringe ^4.10.0 from package.json/package-lock.json; CLI composition root, not NestJS. Existing useValue registrations in cli-settings-registration.ts supply collaborators. No new external-input boundary. SETTINGS_TOKENS and AgentModelSettings exports verified in settings-core; fourth-argument contract verified in harness-sync/src/lib/sources/plugin-config-source-resolver.ts. Existing alias imports and eslint.config.mjs boundary lattice preserved.

**Verification:** Exact project names confirmed from both project.json files. PowerShell Select-Object -Last 30 used as tail equivalent. Nx concurrency capped at 2.

`npx nx run-many -t typecheck,lint -p '@ptah-extension/platform-cli,@ptah-extension/cli-engine' --parallel=2`

```text
√ nx run @ptah-extension/platform-cli:lint
√ nx run @ptah-extension/platform-cli:typecheck
√ nx run @ptah-extension/cli-engine:lint
√ nx run @ptah-extension/cli-engine:typecheck
NX Successfully ran targets typecheck, lint for 2 projects
CHECK_EXIT=0
```

Both edited files are clean under these project checks. No harness-sync or agent-generation type error was reported.

`npx nx run-many -t test -p '@ptah-extension/platform-cli,@ptah-extension/cli-engine' --maxWorkers=2 --parallel=2 --output-style=static`

```text
Test Suites: 8 failed, 13 passed, 21 total
Tests:       164 passed, 164 total
Snapshots:   0 total
Time:        149.443 s
NX Running target test for 2 projects failed
Failed tasks:
- @ptah-extension/cli-engine:test
TEST_EXIT=1
```

Failed cli-engine suites: bootstrap/thoth-runtime-edge.spec.ts, surface-composition.spec.ts, container-diagnostics-override.spec.ts, thoth/register-thoth-libraries.spec.ts, rpc/rpc-surface.spec.ts, bootstrap/thoth-runtime.smoke.spec.ts, container-governor-shutdown.spec.ts, container-git-info-singleton.spec.ts (all beneath src/lib). The retained tail does not establish their failure causes; no baseline attribution is claimed. platform-cli was not listed as a failed task; its individual counts were not retained in the tail. Specs were not changed and the suite was not rerun. Attempted local Nx terminal-output lookup was unavailable because .nx/cache/terminalOutputs does not exist.

Scoped ptah_get_diagnostics returned unavailable after its 45-second compiler timeout; it did not claim clean coverage. Nx typecheck above completed successfully. Nx Cloud reported organization disabled / free-plan limit (401) on both commands; the typecheck/lint command still exited 0.

**Plan deviations:** None in source. No additional tests or source files edited. No git commands run.

**Out-of-scope observations:** CLI engine test failures require caller follow-up. Required checks are not all passing, so this batch is not verification-complete.
