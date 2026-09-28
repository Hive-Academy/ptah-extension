# Batch 37b1d executor report: host profiles and DI wiring (Electron + cli-engine), Lane K

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base 3eb907fa5
(37a..37b1c). No git command changed state; the tree is left dirty for the team leader.

## Files (6, 2 projects: `ptah-electron`, `@ptah-extension/cli-engine`)

| Status   | File | Change |
| -------- | ---- | ------ |
| MODIFIED | `apps/ptah-electron/src/rpc-host-profile.ts` | `goVetDiagnostics: true` |
| MODIFIED | `apps/ptah-electron/src/di/phase-2-libraries.ts` | `registerTypeScriptDiagnosticsProvider(container, logger, { getProcessSpawner: () => container.resolve<IProcessSpawner>(SDK_TOKENS.SDK_PROCESS_SPAWNER) })` |
| MODIFIED | `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts` | Rewritten as the Electron wiring spec (5 tests) |
| MODIFIED | `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts` | `goVetDiagnostics: true` (CLI and TUI) |
| MODIFIED | `libs/backend/cli-engine/src/lib/container.ts` | Same getter as Electron |
| MODIFIED | `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts` | Rewritten as the CLI wiring spec (6 tests) |

VS Code is unchanged. It has no getter, and its capability stays `false` through `ALL_DISABLED`.

## Behaviour

- **Getter is lazy (O2 §2).** `SDK_PROCESS_SPAWNER` is registered by `registerSdkServices`, which runs a few lines after
  the diagnostics registration in both hosts. Only the closure is passed, and the checker reads it at its first run.
- **Consent RPC registration.** The consent RPC handler has no registration of its own. `DiagnosticsConsentRpcHandlers` is
  the lib-owned manifest entry `diagnosticsConsent` (`requires: ['goVetDiagnostics']`). `registerRpcSurface` resolves and
  registers it once the profile flag is `true`. All six of its dependency tokens are already registered in both hosts
  (37b1c report).
- **Consent stays OFF by default.** Neither change writes consent. The GET tests show `state: 'off'` for a freshly opened
  workspace, and nothing spawns until a user runs SET.

## Wiring specs (replacing the stale TASK_2026_299 mirrors)

Neither host's full DI chain loads under Jest. Electron's `phase-2-libraries` throws at module evaluation, and the CLI's
`CliDIContainer.setup()` is the whole bootstrap. Each spec therefore does two things:

1. It pins the call site by reading the source. There must be exactly one `registerTypeScriptDiagnosticsProvider(` and
   it must pass the `SDK_PROCESS_SPAWNER` getter. Precedent for this: `main.metadata-flush.spec.ts` and
   `permission-policy.spec.ts`.
2. It runs the rest for real on a host-shaped container:
   - Electron: the real `registerPhase0Platform` + `registerPhase1Infra`, with `initialFolders: [root]`.
   - CLI: the real `registerPlatformCliServices` + `registerVsCodeCorePlatformAgnostic`, plus the `container.ts` Phase 1
     store (`WorkspaceAwareStateStorage` over `CliStateStorage`).

   The tests on that container check four things:
   - The Phase 0 stub is in place first.
   - A real registration with a getter gives `LanguageAwareDiagnosticsProvider`, logs "opt-in go vet", and does not call
     the getter.
   - The profile has `goVetDiagnostics === true`, both consent methods are in the served surface, and the plan step
     `diagnosticsConsent` is lib-owned. The CLI spec checks both `cli` and `tui`.
   - A GET through the host's real `RpcHandler.handleMessage` returns `supported: true`, `workspace.root` = the opened
     root, and `state: 'off'`. `supported: false` fails this test.

## FB evidence

The wiring was removed in all four production files: both profile flags set back to `false` and both getters taken out.
This is equivalent to the base 3eb907fa5. Each edit was then restored.

| Spec | Result with the wiring removed |
| ---- | ------------------------------ |
| Electron `phase-2-diagnostics-override.spec.ts` | 3 failed: source guard, capability/surface, GET `supported:true` |
| Electron `rpc-surface.spec.ts` | 2 failed ("excludes nothing", "serves every method") |
| CLI `container-diagnostics-override.spec.ts` | 4 failed: source guard, cli + tui capability/surface, GET |
| CLI `rpc-surface.spec.ts` | 1 failed ("excludes exactly the webview-only surface methods") |

- The source guard fails independently of the flag, so removing only the getter is also caught.
- After restoring: Electron spec 5/5 and CLI spec 6/6 pass, and both surface specs pass.

## Verification (tail only)

- `nx run-many -t=test,lint,typecheck -p ptah-electron ptah-cli @ptah-extension/cli-engine @ptah-extension/rpc-handlers --skip-nx-cache --parallel=2`
  - Scope: 4 projects plus 39 dependency tasks.
  - The only failure is `@ptah-extension/rpc-handlers:test`, with 112/113 suites and 3294 passed, 1 failed, 4 skipped.
    The failing test is the known `harness-skill-selection` "never writes state.json" flake (`%TEMP%/.ptah`, see the
    37b1c report).
  - All 49 other tasks succeeded, including lint and typecheck for all 4 projects.
- Header counts, re-run: `nx run-many -t=test -p ptah-electron ptah-cli @ptah-extension/cli-engine --excludeTaskDependencies`
  - cli-engine: 20/20 suites, 205 passed.
  - ptah-cli: 68 of 69 suites, 1102 passed, 3 skipped.
  - ptah-electron: 54 of 55 suites, 930 passed, 3 skipped. The skipped suite is the known stress bundle.
- `nx run ptah-electron:validate-deps`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint`: TOTAL 300 (cli-engine 12 ok, baseline 12).
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` were not touched. The batch adds no `as any` or `@ts-ignore`, and
  imports use package aliases. The specs use `as unknown as Logger` for the logger fake, as the sibling specs do.

## Deviations / notes

1. **Wiring specs moved.** They are in the `*-diagnostics-override.spec.ts` files, the alternative the batch names; the
   `rpc-surface.spec.ts` files are not edited. Both surface specs now pass unchanged, since the flag moves no method into
   `CLI_EXPECTED_ABSENT_METHODS`. The old override specs only mirrored a `TypeScriptDiagnosticsProvider` override that no
   longer exists (since Batch 25a the host registers `LanguageAwareDiagnosticsProvider`), so they are replaced.
2. **No temp-dir cleanup.** Phase 0's output channel keeps a log stream open under `user-data/logs`. Removing that
   directory in `afterEach` crashed Jest with an unhandled ENOENT. The comment next to `beforeEach` explains this.
3. **Console noise in the CLI spec.** `PtahFileSettingsManager` warns about a missing `settings.json` in the temp
   user-data dir. The warning is harmless.
4. **Manifest parity.** The spec says that if `apps/ptah-cli/src/test-utils/manifest-parity.spec.ts` enumerates
   methods, it is updated in 37b3. It passes today (ptah-cli 1102 passed).
