# Code Logic Review - batch 10e (Removal B source), TASK_2026_714_c8a2

Score: 8/10. Verdict: APPROVED (3 minor defects, none blocking).

Scope: full `git diff` of the 10e files (21 files, no 10e.G files), plus greps over W libs/apps.

## Checks

1. Removed symbols: no remaining reference to `CodexCliAdapter`, `codex-cli.adapter`, `codex-exec-args`, `isCodexConfigRejection`, `sdkConfigRejectionStderr` or `codexStderrExcerpt` in any .ts under libs/apps. The grep hits were only package.json/project.json entries (10f scope) and string mentions of the SDK package name.
   - Native code already has replacements: `codex-app-server-lane-auth.ts:20-51` (freshness via shared `isCodexAccessTokenStale`), `codex-app-server-lane-binary.ts:32`, `codex-native-binary.ts:37` (binary resolution), and `codexRejectionNamesUserServer` / `essentialCodexConfigEntries` (retained, still spec'd).
   - Behaviour change, accepted in the lane report: legacy `ensureTokensFresh` refreshed tokens before spawn. The native probe only reports `stale` and never refreshes (`codex-app-server-lane-auth.ts:20`). `provider-auth-resolver.ts:336` still calls `codexAuth.ensureTokensFresh()` for the auth path.
2. No-factory path (`cli-detection.service.ts:106-110`): there is no throw at construction. It logs `logger.error` and installs `unavailableCodexAdapter`. `detect()` returns `installed:false` and `listModels()` returns `[]`. `runSdk` rejects with a clear message that names the missing factory. This is not a silent fallback, and the spec asserts all three behaviours (`cli-detection.service.spec.ts` new test).
3. Spec coverage: the mapping-table specs exist (`codex-app-server-lane-auth.spec.ts`, `-binary.spec.ts`, `codex-model-catalog.spec.ts`, `codex-model-rejection.spec.ts`, `codex-lane-events.spec.ts`, `codex-app-server-lane.adapter.spec.ts`, ...). Deleted `codex-config-rejection.spec.ts` blocks tested only the SDK stderr envelope and the stderr regex, which have no native caller; the user-server and essential-entry blocks remain. The `codex-native-selection.spec.ts` removals are legacy-negative asserts only. The unavailable-slot assertions were added in `codex-native-selection.spec.ts`, `cli-detection.service.spec.ts` and Electron `container.smoke.spec.ts`.
4. Negative proof: no `@openai/codex-sdk` import in `libs/backend/cli-agent-runtime/src`.
5. Rule scan of added lines: no `any`, `as unknown as`, `@ts-ignore` or `eslint-disable`. The one catch in the changed region keeps its `degradation-audit` comment. The diff has 0 CR bytes.

## Defects

1. Minor - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:106-110`. The not-registered branch logs `logger.error` but does not call `sentryService.captureException`, unlike the factory-throws branch at `:99-102`. On VS Code, CLI and TUI hosts (gate closed) this logs error-level once per construction for what is a configuration state. Fix: downgrade to `logger.warn`, or capture to Sentry with `errorSource: 'CliDetectionService.codexAdapterFactory'` if error severity is intended. Also make the log text name the host condition.
2. Minor (10f hand-off) - `libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path.ts:145`. `resolveCodexNativeBinaryPath`, used by native binary resolution (`codex-app-server-lane-binary.ts:32`, `codex-native-binary.ts:37`) and `codex-account-usage.service.ts:399`, still probes via `require.resolve('@openai/codex-sdk/package.json')` (inside a try/catch; the catch is empty and has no degradation comment). When 10f removes the package the probe silently returns nothing, and the platform-package and PATH candidates become the only routes. The packaged-layout candidate is lost silently. Fix: in 10f, confirm the platform package (`@openai/codex-<triple>`) is a direct dependency and covered by `validate-deps`. Remove or replace the SDK-relative probe, and add a `// degradation-audit:` comment on the catches.
3. Minor - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:34-47`. `unavailableCodexAdapter` reports `messagingMode:'none'` with `supportsMcp:false`. A user who has a Codex CLI installed sees "not installed" on non-Electron hosts, with no hint why. This is expected while the gate is closed (known context), but the `detect` result carries no reason. Fix: if `CliDetectionResult` allows it, add an `unavailableReason` or a log-only pointer. Otherwise accept as documented.

No blocking or serious defects.
