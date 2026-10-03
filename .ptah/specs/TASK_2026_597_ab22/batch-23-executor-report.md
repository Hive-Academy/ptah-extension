# Backend implementation — `TASK_2026_597_ab22`, batch 23

**Tasks completed**: 23.1, 23.2, 23.3, 23.4 (A1 auto-compact machinery, defaults `null`)

## Files

All under `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-sdk\src\lib\helpers\`:

- MODIFIED `auto-compact-control.ts` — `resolveAutoCompactControl` now takes `{enabled, windowTokens, modelClass?, envWindow?}` and returns the flag keys plus `{effectiveWindow, source}`. Precedence is env → setting → class default → runtime. Also adds `A1_DEFAULT_WINDOW = { claude: null, proxied: null }`, `parseAutoCompactWindowEnv` (mirrors the runtime's env read), `autoCompactModelClass` and `isFirstPartyAnthropicBaseUrl`. The stale 0.3.150 header is rewritten against 0.3.278 / CLI 2.1.278.
- MODIFIED `auto-compact-control.spec.ts` — every precedence branch, the bounds, the env parse table and the model-class table.
- MODIFIED `compaction-config-provider.ts` — reads `CLAUDE_CODE_AUTO_COMPACT_WINDOW` into a new `CompactionConfig.envWindow` field. This is for the log only and is never forwarded. It warns when the runtime would ignore the value and when it would clamp it. The keys are still read through `this.config.get('compaction.enabled' | 'compaction.threshold')`.
- MODIFIED `compaction-config-provider.spec.ts` — saves and restores the env var; covers valid, blank, ignored and clamped values.
- MODIFIED `sdk-query-options-builder.ts` — adds one INFO line per `build()`: `'[SdkQueryOptionsBuilder] Auto-compact window' {enabled, window, source, modelClass}`. The model class comes from the first-party test. Both existing regex sites (`validateModelAvailability`, `buildBetas`) now call `isFirstPartyAnthropicBaseUrl`, so the regex exists in one place only.
- MODIFIED `sdk-query-options-builder.auto-compact-argv.spec.ts` — new `env-window` case: the argv on the real pinned SDK is unchanged and the log reports `source: 'env'`. Also asserts that exactly one INFO line with the right window and source is logged for every case.
- MODIFIED `session-lifecycle-manager.ts` — the `Query.applyFlagSettings` type now accepts `{effortLevel?, autoCompactWindow?: number | null}`. The manager takes two new optional injected dependencies (`TOKENS.CONFIG_MANAGER`, `SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER`). It watches `compaction.threshold`, re-applies the window to live sessions off the caller's stack, and releases the watch in `dispose()`.
- MODIFIED `session-lifecycle-manager.spec.ts` — the harness accepts these optional sources. Tests: a changed threshold reaches the live query as `{autoCompactWindow: 300000}`, `dispose()` releases the watch, and without the sources nothing is watched.
- MODIFIED `session-lifecycle/session-control.service.ts` — new `applyAutoCompactConfig(config)`. For each live query it re-resolves the window using that session's own model class (taken from the frozen `accountingAuthEnv`). It skips records with no query, sends nothing while compaction is disabled, gives each session a 5 s timeout (timer always cleared), and logs a per-session failure as WARN without stopping the others. It never throws.
- MODIFIED `session-lifecycle/session-control.service.spec.ts` — covers applying to several sessions, an unset threshold sending `null`, disabled sending nothing, a pending record being skipped, one session's failure being isolated, and the timeout.

## Edge cases handled

- With null defaults, the keys sent to the runtime do not change. The argv spec on the real SDK still matches every earlier case.
- The env window changes only the effective window and the source in the log. The keys stay the same, because the runtime ignores the flag window while the env var is set.
- The env value is parsed the way the pinned CLI does it (`ME`/`JCe`, verified in `claude.exe`):
  - blank → unset;
  - NaN or `<= 0` → ignored, with a WARN;
  - below 1e5 or above 1e6 → clamped, with a WARN that gives the clamped value.
  - The raw env text is never logged; only its length is.
- A class default that is out of range is never sent. When there is no model class, no class default applies.
- A threshold change while auto compaction is disabled sends nothing.
- A live change for a session whose class default is `null` and whose setting is unset sends `autoCompactWindow: null`. That clears the flag-layer key, so the runtime decides again.
- `ConfigManager.watch` also fires once on registration. That call is a no-op when no session is live, so the provider is not read and nothing is logged.

## Stack observed

- tsyringe DI with `@inject(TOKEN, { isOptional: true })` defaults. Pattern taken from `session-lifecycle-manager.ts:331-339`; the provider token is at `di/register.ts:398`.
- `ConfigManager.watch(key, cb)` returns a disposable. Taken from `vscode-core/src/config/config-manager.ts:263` and the `config-watcher.ts` precedent.
- Jest via Nx (`libs/backend/agent-sdk/jest.config.ts`).
- SDK `applyFlagSettings` accepts `Settings[K] | null` (`sdk.d.ts:2769-2771`).

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk` → typecheck passed, lint passed.
- `npx nx run-many -t test -p @ptah-extension/agent-sdk --maxWorkers=2 --skip-nx-cache --output-style=static` → 129 suites passed (2 skipped), **2530 tests passed** (3 skipped), 0 failed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts --maxWorkers=2 auto-compact compaction-config-provider session-control.service session-lifecycle-manager.spec` → 5 suites, **125 passed**. This confirms the batch's specs actually ran.
- Downstream check (not part of the batch's command), because `cli-agent-runtime` calls `resolveAutoCompactControl` and uses the real provider:
  - `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime` → passed.
  - `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts --maxWorkers=2 ptah-cli-registry-auto-compact-argv ptah-cli-spawn-options` → 4 suites, 32 passed.
- Nx Cloud printed 401 warnings; they do not affect the results.

## Plan deviations

1. **Where the first-party helper lives.** `isFirstPartyAnthropicBaseUrl` and `autoCompactModelClass` are in `auto-compact-control.ts`, not module-private in the builder. Task 23.4's live change has to classify each session in `session-control.service.ts`, so a builder-private helper would have meant a third copy of the regex. The two old builder sites use the helper; the regex now exists exactly once. Task 12.2 can replace it in that one place.
2. **`modelClass` and `envWindow` are optional inputs.** `cli-agent-runtime/.../ptah-cli-spawn-options.service.ts:281` (outside this batch) passes only `{enabled, windowTokens}`. Without a class, no class default applies, which matches today's behaviour. When S5 sets a default, that caller should pass `modelClass`.
3. **`resolveAutoCompactControl` has a second parameter, `classDefaults`.** It defaults to `A1_DEFAULT_WINDOW`. It exists only so the `default` branch can be specced while the shipped table is all `null`; every production caller omits it.
4. **The "visible rejection" for the env var is a WARN only.** The UI validation in component 7 belongs to deferred Batches 20 and 21.

## Out-of-scope observations

- `ConfigManager.watch` keeps one watcher per key (it uses a `Map`). Any later `watch('compaction.threshold', …)` would silently replace this one, and the reverse is also true. Nothing else watches that key today.
- `ptah-cli-spawn-options.service.ts:280` does not pass `modelClass` or `envWindow` yet; see deviation 2. That file is not part of this batch and was not touched.
- The `'[SdkQueryOptionsBuilder] Building SDK query options'` INFO line still logs `autoCompact`, which now also carries `effectiveWindow` and `source`. I left that line alone so existing log assertions keep passing.
