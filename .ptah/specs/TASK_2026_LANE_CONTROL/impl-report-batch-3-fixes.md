# Batch 3 follow-up fixes

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/testing/manifest.fixture.ts`: complete, configurable `CliAdapterManifest` test fixture.
- `codex-native-selection.spec.ts`, `codex-lane-activation.spec.ts`, `agent-process-manager.account-binding.spec.ts`: replace three-boolean adapter mocks with that fixture; account-binding harness supplies the policy-validation seam.
- `codex-lane-parity.spec.ts`, `cli-detection.service.spec.ts`, `register.ptah-cli-registry.smoke.spec.ts`: assert manifest messaging fields and detection rows under the expanded contract.
- `cli-adapters/grok-cli.adapter.ts`, `antigravity-cli.adapter.ts`, `opencode-cli.adapter.ts`: advertise registered limit readers as available, with sources `grok`, `antigravity`, `opencode-go`.
- `cli-adapters/limit-reader-manifest.spec.ts`: guard those source IDs and the three CLIs with no reliable source (Copilot, Cursor, Pi).
- `cli-detection.service.ts`: use a fixed reason in unavailable Codex capability fields; the existing injected-logger error path records the real failure. Its spec checks the reason and absence of the raw error in manifest output.

## Failure classification

The completed filtered run has **four failing suites**. None of the capability-manifest or review-fix suites failed.

| Suite | First failing assertion | Environment evidence |
| --- | --- | --- |
| `capabilities/claude-approval.reader.spec.ts` | `trusts an untracked, ignored file` at line 345 exceeded Jest's 5,000 ms timeout. | This case starts a real Git process in a temporary fixture. Its other two real-Git cases also timed out at 5,000 ms; no value assertion failed. This machine's real-Git fixture exceeded the test deadline under the full run. |
| `mcp-directory/mcp-install.service.spec.ts` | `force on a key Ptah DOES own still goes through the reconciler`: `intents.has('owned')` expected `false`, received `true` at line 477. | The suite creates a directory directly under `%TEMP%` and assumes its own `.ptah` is the closest workspace marker. On this machine `%TEMP%\.ptah` **and** `%TEMP%\.claude` already exist. `resolveHarnessWorkspaceRoot` searches upward for `.ptah`/`.git`, so the store can record against the parent marker before the fixture creates its own; later lookups use a different root. Subsequent scoped-intent failures show `scopeOf('k', tmp)` received `undefined`. |
| `ptah-cli/ptah-cli-registry-auto-compact-argv.spec.ts` | `runs against the pinned SDK version`: expected `0.3.318`, received `0.3.278` at line 452. | Root `package.json` pins `@anthropic-ai/claude-agent-sdk` to `0.3.318`, while the linked `node_modules` resolves `0.3.278` on this machine. The version assertion fails before the compaction behavior assertion. |
| `session-children/child-worktree.provisioner.integration.spec.ts` | `creates the worktree on a new branch at HEAD, then rolls both back` at line 51 exceeded 120,000 ms. | This is a real-Git integration fixture. The test timed out under the full Windows run; the log contains no failed value assertion. |

`acp-process-transport.spec.ts`, which had timed out in the earlier Batch 3 run, passed this time. The log also warned that a Jest worker was force exited after the suites; it did not add another failing suite.

## Verification

- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json --noEmit --pretty false` — exit 0, no diagnostics.
- `node scripts/verify.mjs --exec --task batch3-fixes-focused-jest -- npx jest -c libs/backend/cli-agent-runtime/jest.config.ts --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-activation.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-parity.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/limit-reader-manifest.spec.ts libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts --coverage=false --maxWorkers=2` — `Test Suites: 7 passed, 7 total`; `Tests: 118 passed, 118 total`; exit 0.
- `npm run verify -- -t test -p @ptah-extension/cli-agent-runtime` — final completed filtered run, exit 1: `NX 1 task: 0 succeeded, 1 failed`; `Test Suites: 4 failed, 132 passed, 136 total`; `Tests: 11 failed, 1 skipped, 2883 passed, 2895 total`. Full log: `C:\Users\abdal\.nx\d60e02896ae18ad9\cache\terminalOutputs\3760311611199970083`.
- A preliminary invocation of the same filtered command was interrupted during Nx project-graph creation before test execution so a newly identified detection assertion could be corrected; only the invocation above completed.
- Scoped `ptah_get_diagnostics` after edits twice returned `TypeScript check still running after 45s`; the direct source typecheck and focused Jest completed.

## Decisions

- Use a test-only manifest builder beside the affected specs. Alternatives were repeated full literals or a production compatibility shim. The new manifest contract is complete, and the focused tests cover all affected mocks; reversible by inlining fixtures.
- Map OpenCode's advertised plan reader to `opencode-go`. `PlanUsageService` registers `opencode`, `opencode-go`, and `opencode-zen`, and the review explicitly identifies the OpenCode Go reader. Reversible if the adapter's billing owner changes.
- Keep the unavailable Codex adapter's real `Error` in the injected logger and use one fixed capability reason. The factory-failure branch already calls `logger.error` with the real error; the reason is UI-facing. Reversible if a safe structured reason is introduced.

## Not done

- The four environment-sensitive suites above remain red. No Git commands or destructive fixture cleanup were run.
- No skill-loading tool was listed by this host, so no skill was loaded.
