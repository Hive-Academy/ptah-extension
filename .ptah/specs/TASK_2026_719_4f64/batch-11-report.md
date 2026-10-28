# Backend implementation: `TASK_2026_719_4f64`, batch 11

**Verdict**: PARTIAL. The model-service half of Task 11.1 is done and verified. I stopped the runner half under the stop rule: removing `OneShotRunInput.accountRoute` breaks typecheck in a spec outside the batch (see Blocker). The runner file is restored to HEAD and has no diff.

**Tasks completed**: Task 11.1, model-service part (`getSupportedModels(route, signal, launch?)`). Runner field and wrapper deletion is blocked.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`: named catalog probe now runs only under a certified launch.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.accounts.spec.ts`: launch-based probe specs.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.accounts.spec.ts`: the pressure-pinning spec is rewritten for the launch path.
- NOT CHANGED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`: edited, then restored to HEAD (`git diff --stat` is empty).

## Acceptance evidence

- **`getSupportedModels(route?, signal?, launch?: ClaudeCertifiedLaunchContext)`.** `getNativeClaudeModels` has the same third parameter, because both methods share the private `getAccountModels`.
- **Named route without a launch returns `[]` before any work.** The first line of `getAccountModels` is `if (!launch || signal?.aborted) return [];`. It touches no epoch, makes no loader call and makes no query-factory call. Spec "returns unknown for a named route without a launch and starts nothing" asserts `loader.getQueryFunction` and `query` are never called, for both public methods.
- **With a launch, the probe uses the certified values:**
  - env from `certifiedNamedEnv(route, launch)`;
  - `cwd: launch.cwd`;
  - `pathToClaudeCodeExecutable: launch.executable.sdkExecutablePath`.

  Spec "probes with the certified env, cwd and executable only" checks these. The env is equal to `launch.env` but is a fresh copy, with no `ANTHROPIC_*` or Bedrock keys, and both config-dir keys are set to the route dir. `settingSources: []`, `strictMcpConfig` and the empty prompt are unchanged. They are still asserted in "isolates accounts...".
- **A launch that no longer matches the route returns `[]` with no spawn.** A config dir that differs from the route, or a tampered `envDigest`, makes `certifiedNamedEnv` throw a refusal inside the probe's existing `catch` (degradation-audit comment already there). The env is computed before the loader is awaited. Spec "refuses a launch that no longer matches the route without spawning" covers this.
- **Cache key.** It is now `[identity, routeRevision, authEpoch, executable.sdkExecutablePath, executable.version, envDigest]`, replacing the detector's `cliJsPath`/version. Spec "keys by the certified executable version" covers it.
- **Ambient path is unchanged.** `sdk-model-service.spec.ts` was not touched and passes.
- **Runner: not done.** The `accountRoute` field and the `applyClaudeAccountRouteEnv` wrapper are still present. See Blocker.

## Blocker (runner deletion), for the team-leader

Removing `accountRoute` from `OneShotRunInput` produced:

```
libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts(177,7): error TS2353:
Object literal may only specify known properties, and 'accountRoute' does not exist in type 'OneShotRunInput'.
```

How that spec depends on the runner:

- `oneShotOptions(accountRoute)` (lines 156-183) passes the route into `SdkQueryRunner.buildOneShotOptions`.
- The `describe.each` at lines 291-316 (`['one-shot', oneShotOptions]`) asserts the named route is applied to the one-shot env.
- Line 347 does the same in the A2 matrix.

The spec is outside the batch's 4 files, so I stopped and restored the runner byte-for-byte from HEAD.

To finish the runner deletion, add `claude-account-route-env.spec.ts` to batch 11, or to a follow-up. Its one-shot cases need to go:

- drop `oneShotOptions`;
- drop the `'one-shot'` row from the `describe.each`;
- drop `oneShotOptions(route)` from the line-347 loop.

The runner edit itself is ready. I verified it locally before reverting: it removes the `type ClaudeAccountRoute` import, the `applyClaudeAccountRouteEnv` import, the field with its doc comment, and the wrapper. The env literal goes back to its exact pre-wrapper form, including the trailing `} as Record<string, string | undefined>,`. I confirmed that against `git show 697b7e31a^` (the commit that introduced the wrapper); the line diff was empty after restoring that cast.

## Callers grep (`libs/`, `apps/`)

- **`getSupportedModels`.** Every caller outside my files passes no arguments:
  - `sdk-agent-adapter.ts:781`
  - `config-rpc.handlers.ts:498`
  - `provider-rpc.handlers.ts:464,481`

  They are unaffected, because the new parameter is optional.
- **`getNativeClaudeModels`.** Every caller passes no arguments:
  - `sdk-agent-adapter.ts:790`
  - `claude-cli.adapter.ts:115,391`
  - `cli-agent-runtime/src/lib/di/register.ts:185`
  - `provider-rpc.handlers.ts:509`

  They are unaffected.
- **The runner's `accountRoute`.** The only reader outside my files is `claude-account-route-env.spec.ts` (the blocker). `session-query-executor.service.ts:1145` and `cli-agent-runtime` (`claude-sdk-lane-options.ts`, `claude-sdk-lane-runner.spec.ts`) use the options builder's or lane options' own `accountRoute`, not the runner's, so they are untouched.
- **The `SdkModelService` constructor.** The 8th parameter is removed (see Decisions). It is passed only in `sdk-model-service.accounts.spec.ts` and `session-quota-probe.accounts.spec.ts`, which are both in this batch and both updated. `sdk-model-service.spec.ts` passes 7 arguments and is unchanged.

## Specs that mock or pin changed members

- `sdk-model-service.accounts.spec.ts`: drives `getSupportedModels`/`getNativeClaudeModels` named and `invalidateAccountRoute`. Updated.
- `plan-limits/session-quota-probe.accounts.spec.ts`: replaces the private `probeAccountModels` and reads the private `accountEpochs` and `activeAccountReads`.
  - Updated to `it.each([false, true])` on `advance`.
  - The old `probing=false` variant depended on the `findExecutable` await, which no longer exists. The probe now starts synchronously.
  - The spec still pins that an in-flight read survives 140 pressure invalidations, keeps the epoch map at 128 or fewer, and leaves `activeAccountReads` empty.
- `sdk-model-service.spec.ts` (ambient): unchanged and passes.
- `sdk-query-runner.service.spec.ts` (ambient): unchanged and passes.
- `claude-account-route-env.spec.ts`: pins the runner's `accountRoute`. This is the blocker above. It is unchanged and passes against the restored runner.

## Decisions

- **Remove `SdkModelService`'s optional `@inject(SDK_TOKENS.SDK_CLI_DETECTOR, { isOptional: true }) cliDetector`.**
  - Options: keep the detector lookup next to the launch, or remove it.
  - Evidence:
    - Plan line 810 says the probe uses `launch.executable`.
    - The detector's only use was the named path.
    - The executor rules say to delete unused code.
    - An optional inject needs no registration change.
  - Reversible.
- **Give `getNativeClaudeModels` the same optional `launch` parameter.**
  - Options: add the parameter, or leave the method without a probe path.
  - Evidence: it delegates to the same `getAccountModels`, and D-K says a named route without a launch gets `[]`.
  - Additive and reversible.
- **Leave `cwd` out of the account catalog cache key.**
  - Evidence: the probe reads no setting source (`settingSources: []`), so `cwd` cannot change the catalog.
  - `envDigest` is added to the key so that an env change misses the cache.
  - Reversible.

## Risks

- **Ambient env literal.** It is untouched, because the runner is unchanged.
- **The model-service ambient `NATIVE_CLAUDE_AUTH_ENV` path.** It is unchanged.
- **No `process.env` mutation.** The old spec "scrubs foreign selectors" wrote to `process.env`. It is replaced by an assertion on the certified env built from a fixture source env.
- **Other rules:**
  - No `process.cwd()`.
  - No `jest.spyOn` on a module namespace. The existing `globalThis.fetch` spy is kept.
  - Nothing is logged with account data. The probe's catch logs a fixed string.

## Verification

- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: exit 0.
- `npx eslint` on the 4 files: 0 errors, 4 warnings, all in `sdk-model-service.ts`:
  - two `no-empty-function` on the empty async generators;
  - `no-useless-assignment` on `isDefault`;
  - `max-lines` (887 > 700).
- `npx prettier --write` on the 2 files I reformatted: HEAD `sdk-model-service.ts` was prettier-clean before my edit.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts` on the following, with `--maxWorkers=2`: **5 suites passed, 148 tests passed**.
  - `sdk-model-service.accounts.spec.ts`
  - `plan-limits/session-quota-probe.accounts.spec.ts`
  - `sdk-model-service.spec.ts`
  - `sdk-query-runner.service.spec.ts`
  - `claude-account-route-env.spec.ts`
- `ptah_get_diagnostics`: not run; tsc covers the same projects.
- `npm run verify`: not run, as instructed.

## Out-of-scope observations

- `claude-account-route-env.spec.ts` needs the edit described in the Blocker before the runner deletion can land.
- `sdk-model-service.ts` is over `max-lines`. This warning was already there.
