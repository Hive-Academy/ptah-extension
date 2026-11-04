# P1-16a-3 — Electron review host integration

## Files changed

- `apps/ptah-electron/src/services/review/`: added Electron environment, command runner, lane gateway, context/artifact files, lane files, and secret-presence adapters; each has a focused `.spec.ts`.
- `apps/ptah-electron/src/activation/review-worker.activation.ts` and `.spec.ts`: registered `handler:review:discover`, persisted discovery poll time, ran startup reconciliation, drained the queue on a timer, and disposed the timer/handler on shutdown.
- `apps/ptah-electron/src/activation/boot-heavy-services.ts`, `boot-coordinator.ts`, `shutdown.ts`: start the worker before cron and wait for lease release before SQLite closes.
- `apps/ptah-electron/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`: register review libraries and ports, and cover ten RPC methods and DI.
- `apps/ptah-electron/src/rpc-host-profile.ts`: enable `review` for Electron only.
- `apps/ptah-electron/package.json`, `libs/backend/review-github/project.json`, `libs/backend/cli-agent-runtime/src/index.ts`: buildable dependency declarations, GitHub build target, and public agent runtime export.
- `libs/backend/review-core/src/lib/context/review-context.ports.ts`, `review-worktree.service.ts`, `review-context.service.ts`, `review-dependencies.service.ts`, `review-checks.service.ts`, `context/review-context.spec.ts`, `src/lib/stages/context-stage.runner.ts`, `triage-stage.runner.ts`, `lens-stage.runner.ts`, `verification-stage.runner.ts`, `review-orchestrator.service.ts`, `persistence/review-artifact.reader.ts`, `lanes/review-lane.runner.ts`, `lanes/review-lane.runner.spec.ts`, `src/index.ts`: resolve roots and command cwd per claimed repository, reject unavailable repos before worktree access, carry source SHA into lane checks, support abort and lease heartbeat/release.
- `libs/backend/review-core/src/lib/stages/context-stage.runner.spec.ts`, `review-orchestrator.service.spec.ts`, `stages/discovery-stage.runner.spec.ts`, `stages/publication-stage.runner.spec.ts`, `testing/dry-run-fixture.spec.ts`, `persistence/review-artifact.reader.spec.ts`: adapt environment fixtures and cover rejection before worktree access.
- This report.

## Adapter/token table

| Token/port | Electron binding | Boundary |
| --- | --- | --- |
| `REVIEW_CORE_TOKENS.GITHUB` | `REVIEW_GITHUB_TOKENS.REVIEW_PORT` | GitHub adapter reads `ptah.review.githubToken` through secret storage. |
| `REVIEW_CORE_TOKENS.SECRET_PRESENCE` | `ReviewSecretPresence` | Returns boolean only; never returns or logs token. |
| `REVIEW_CORE_TOKENS.ENVIRONMENT` | `ElectronReviewEnvironment` | Requires configured P1 repo and matching active workspace `origin`; typed failure otherwise. |
| `REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER` | `ReviewCommandRunner` | Direct argv spawn, timeout, output cap, per-claim roots, realpath cwd confinement, typed scope error. |
| `REVIEW_CONTEXT_TOKENS.FILES` | `ReviewFiles` | Attempt-tree path and symlink checks. |
| `REVIEW_CORE_TOKENS.ARTIFACT_FILES` | `ReviewFiles` | Create-only writes inside attempt tree. |
| `REVIEW_LANE_TOKENS.GATEWAY` | `ReviewLaneGateway` | Existing CLI detection, limit lookup, agent manager, abort/deadline handling. |
| `REVIEW_LANE_TOKENS.FILES` | `ReviewLaneFiles` | Exact detached worktree SHA and checksum checks. |

## Guard changes

- Electron host profile advertises `review`; VS Code and CLI profiles were not changed.
- `expected-resolvable.ts` lists review handler and core/adapter ports. Container smoke stubs review RPC ports. RPC surface asserts ten `review:*` methods. Surface composition asserts phase-2 registration and worker startup order.
- CLI smoke expectations were not changed because CLI still advertises no review capability.

## AC → spec

| Acceptance criterion | Spec/evidence | State |
| --- | --- | --- |
| Token presence never exposes value | `review-secret-presence.spec.ts`; GitHub adapter already owns token read | Written, not run |
| Matching SSH/HTTPS origin resolves; mismatch, missing origin/workspace, or unconfigured repo fails before worktree; unconfigured repo never probes Git | `context-stage.runner.spec.ts`, `electron-review-environment.spec.ts` | Written, not run |
| Command runner permits claim checkout and attempt source, rejects another repo, parent, and symlink escape | `review-command-runner.spec.ts` | Written, not run |
| Gateway respects admission limit | `review-lane-gateway.spec.ts` | Written, not run |
| Files stay inside attempt tree; source matches SHA | `review-files.spec.ts`, `review-lane-files.spec.ts` | Written, not run |
| Cron worker starts/stops cleanly | `review-worker.activation.spec.ts` | Written, not run |
| Ten RPC methods and DI bind | Electron smoke/RPC/surface guards | Updated, not run |

## Decisions

- **D39/D40 — resolve roots per claim within P1's single-repo contract.** Options were a per-repo environment resolver or a fixed root. D39 chose the resolver; D40 clarified that the existing `RepoIdentitySchema` literal and `repositories.max(1)` constrain P1 to `Hive-Academy/PtahCode`. The Electron resolver checks settings plus active checkout Git `origin`, and throws `ReviewRepositoryUnavailableError` for an unknown/unconfigured repo. The unconfigured-repo spec asserts the origin command probe is never invoked. No fallback root exists. Reversible when P2 widens the contract. The requested two-valid-repository test is incompatible with D40 and was not added.
- **Origin proof before mapping workspace.** The Electron resolver uses `ReviewCommandRunner.inspectCheckout` to run `git rev-parse --show-toplevel` and `git remote get-url origin` with direct argv, no shell, a ten-second timeout and a bounded output buffer. It requires the top-level checkout to equal the active workspace root and parses HTTPS or SSH GitHub origin case-insensitively before creating attempts storage. Missing workspace, missing origin, and mismatches throw `ReviewRepositoryUnavailableError`; no claim work runs. The command runner owns this restricted bootstrap probe because claim roots are not yet trusted. Reversible in the Electron adapter.
- **D39 cwd addendum — pass repository identity through the command port.** Options were a fixed root callback or per-invocation claim identity. The addendum requires the latter. Context, worktree and lane checksum paths now pass `RepoIdentity` to command calls; Electron resolves roots for that identity, realpaths roots and cwd, and throws `ReviewCommandScopeError` on any scope failure. `ReviewWorktreeService` runs `git worktree add/remove` from the claimed checkout; the runner permits only those commands at that root. All other commands require an attempt `src` cwd within that claim's attempts root. The spec supplies repo A roots and rejects repo B's root, a parent, and a symlink escape. Reversible at the port and callers.
- **Existing agent process manager and limit lookup.** This preserves runtime admission and agent lifecycle behavior. No new process manager or scheduler path was introduced. Reversible in DI.
- **Cron handler plus detached queue drain.** The scheduler's `handler:` mechanism owns discovery; the worker owns a bounded, abortable queue drain and releases leases before persistence shutdown. This follows scheduler and Electron activation interfaces. Reversible in activation.
- **D38 buildable dependencies.** Electron lists review-core and review-github in package metadata; review-github received a build target. Reversible if those imports are removed.

## Verification and remaining work

- D26 forbids Nx/npm verify, build, serve and Electron here; none was run. Focused specs and the four guards are written but unexecuted. The orchestrator must run scoped `npm run verify -- -p ptah-electron` and relevant review-core/review-github checks.
- `ptah_get_diagnostics` initially timed out. A later scoped compiler result found an undefined `logger` at the worker boot call; that was fixed. Its other direct errors were unresolved new review-lib aliases (the aliases exist in `tsconfig.base.json`) and follow-on implicit types; explicit callback types and null handling were added. The same pass reported 2,166 project/sibling errors. Scoped diagnostic requests after those fixes, after the D39 cwd addendum, and after the final resolver spec timed out with the requested files unchecked, so there is no clean compiler result. Tree-sitter parsed the final resolver spec and changed command/core files without syntax errors. Recheck after project setup resolves aliases.
- The package lock was not regenerated because D26 forbids npm. The orchestrator should validate dependency metadata and lockfile handling.
- D40 defers two-repository mapping and its two-distinct-roots test to P2. Current code rejects identities outside the P1 literal before worktree access.
- The lane adapter checks SHA/checksum but does not enforce operating-system read-only isolation; the sealed runtime is deferred by D31.
- No skill-loading tool was exposed in this lane; no assigned skill could be loaded.

## Fix round 1

- `boot-heavy-services.ts`: start the review worker only when its orchestrator token is registered. The boot-order test container has no review registration, so boot no longer resolves its absent logger; registered Electron composition still starts the worker in the same place before cron.
- `review-lane-gateway.ts`: pass only the serializable lane ID, cwd, and prompt to the strict Zod schema; retain the AbortSignal for admission and wait cancellation.
- `review-files.ts`: identify `ENOENT` by its error code when walking missing ancestors, then continue toward the existing root. Existing ancestors still go through `realpath` and the symlink escape check.
- Timer audit: `review-worker.activation.spec.ts` uses fake timers, aborts the controller, and disposes the handle; the activation interval is unref'd and cleared on abort/dispose. No timer was found in the new adapter specs. The Jest worker-exit warning has no confirmed cause from these files.
- Verification: Nx/npm was not run per D26. Two scoped `ptah_get_diagnostics` calls timed out with the three changed TypeScript files unchecked; the orchestrator must rerun `npm run verify -- -p ptah-electron`.
