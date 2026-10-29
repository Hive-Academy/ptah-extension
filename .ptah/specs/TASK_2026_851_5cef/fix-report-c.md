# Fix report C — `TASK_2026_851_5cef`, defect 2 (Serious)

**Defect**: the credential-aware default auth method was only applied to per-workspace
snapshots. Global initialization (`SdkAgentAdapter.doInitialize` → `AuthManager`) still mapped a
missing `authMethod` to `'apiKey'`, so with no key and a connected Claude login the adapter
reported "not configured".

**Result**: fixed. There is now one rule, `ActiveProviderResolver.resolveActiveAuthWithDefault`.
Global initialization and workspace snapshots both use it.

## Files

- MODIFIED `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts`
  - New `AuthCredentialProbe` interface and `createAuthCredentialProbe(authSecrets, ambientLogin)`.
    The probe counts a stored `apiKey` credential or `ANTHROPIC_API_KEY` as a key, which is what
    `ApiKeyStrategy` can configure. It counts the login as present only when
    `ClaudeAmbientLoginStatusReader.read()` returns `connected`.
  - New `async resolveActiveAuthWithDefault(probe, workspacePath?)`. This is the single rule:
    - a known configured value wins and no credential is read;
    - otherwise a key gives `apiKey` and the login is not read;
    - otherwise a connected login gives `claudeCli`;
    - otherwise `apiKey`.
  - The answer is stored in `unconfiguredAuthMethod` (initially `'apiKey'`). The synchronous
    `resolveActiveAuth()` and `resolveActiveAuthForPath()` use that stored answer when no value
    is configured. Without it, the adapter's `lastConfiguredAuth` and later sync readers
    (`reconfigureAuthIfChanged`, `SdkModelService`, `auth-status-cache`) would report `apiKey`
    while `claudeCli` is configured, and a workspace switch would reconfigure to the wrong method.
  - Removed `isAuthMethodConfiguredForPath`, which batch C added; its only caller now uses the
    new method. The constructor is unchanged, so the more than 15 `new ActiveProviderResolver(scope)`
    sites still work.
- MODIFIED `libs/backend/auth-providers/src/lib/auth/auth-manager.ts`
  - New injected dependencies: `@inject(TOKENS.AUTH_SECRETS_SERVICE)` and
    `@inject(ClaudeAmbientLoginStatusReader)`. Both were already registered on every host by
    `registerAuthProvidersServices`, and batch C injects the reader the same way.
  - `configureAuthentication()` with no argument now uses `resolveActiveAuthWithDefault`.
    An explicit argument is still only normalized.
- MODIFIED `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`
  - `resolveAuthForPath` now delegates to `resolveActiveAuthWithDefault(probe, path)`.
    The batch C copy of the rule is gone.
  - The hint constant moved to `auth-method.utils.ts`.
- MODIFIED `libs/backend/auth-providers/src/lib/auth/auth-method.utils.ts`
  - New exported `API_KEY_RECOVERY_HINT`, the batch C text:
    "Add an API key, or choose the Claude CLI login in Settings > Providers > Main agent authentication."
- MODIFIED `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts`
  - The not-configured message on the init and health path is now
    `No Anthropic API key configured. ${API_KEY_RECOVERY_HINT}`.
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`, in `doInitialize` only
  - It now calls `configureAuthentication()` with no argument, so the manager applies the
    default, and then reads `resolveActiveAuth()` for `lastConfiguredAuth`.
  - The `IAuthEnvProvider` port is not changed: `rawAuthMethod` was already optional.
  - Two unrelated prettier hunks that the formatter produced were reverted, so my diff is
    this hunk only.
- MODIFIED specs:
  - `auth-manager.spec.ts`
    - The harness now has a stored-key fake and an ambient-login fake.
    - New `default when no authMethod is configured` cases:
      - missing method, no key, login connected → the cli strategy is used and
        `resolveActiveAuth()` returns `claudeCli`;
      - an unknown spelling behaves like a missing one;
      - a stored key → `apiKey`, and the login is not read;
      - `ANTHROPIC_API_KEY` → `apiKey`, and the login is not read;
      - an explicit `'apiKey'` with no key and a connected login → `apiKey`, and no credential
        is read;
      - signed out → `apiKey`.
  - `active-provider-resolver.spec.ts`
    - The `isAuthMethodConfiguredForPath` cases are replaced by `resolveActiveAuthWithDefault`
      cases: missing or unknown, key, no login, explicit, path-scoped, and the stored answer.
    - New `createAuthCredentialProbe` case: a blank stored key, the env key, a stored key, and
      a connected login.
  - `workspace-provider-profile-resolver.spec.ts`: the default-method describe now isolates
    `ANTHROPIC_API_KEY`. The batch C cases pass unchanged.
  - `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`: two assertions in "set-up retry
    while not initialized" changed from `toHaveBeenLastCalledWith('claudeCli')` to
    `toHaveBeenLastCalledWith()`. Their intent is unchanged: the retry pass runs and health is
    `available`. This is the colocated spec of the allowed file, edited under the brief's
    "update callers and specs".

## Verification

1. `npm run verify -- -p auth-providers,agent-sdk`: 6 tasks, 3 succeeded, 3 failed.
   - typecheck passed for both projects. agent-sdk lint passed.
   - agent-sdk test failed in 2 tests, both in `sdk-agent-adapter.spec.ts`: the
     `toHaveBeenLastCalledWith('claudeCli')` assertions described above. These are fixed.
   - auth-providers test failed in 5 tests:
     - `translation-proxy.sdk.integration.spec.ts` S1–S4, EPERM. This is a known failure that
       also fails on main.
     - `plan-usage.service.spec.ts` "resolves the stored OpenCode Go credential", a 5 s timeout
       while memory was low. It passes on the re-run below; that code was not touched.
   - auth-providers lint: 1 error, the known `@nx/dependency-checks` error ("persistence-sqlite
     not used"). None of the 12 warnings are in files I changed.
2. Re-run after the spec fix:
   `npm run verify -- -t test -p agent-sdk,auth-providers -- --testPathPatterns="(sdk-agent-adapter\.spec|plan-usage\.service\.spec|auth-manager\.spec|active-provider-resolver\.spec|workspace-provider-profile-resolver\.spec)"`
   - Result: "2 tasks: 2 succeeded", exit code 0.
- I did not run the ptah-electron typecheck. No signature used by Electron changed: the port is
  the same, and the `AuthManager` constructor is resolved only through DI. The Electron
  `container.smoke.spec.ts` already registers a fake `ClaudeAmbientLoginStatusReader`.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Put the rule in `ActiveProviderResolver` as an async method that takes a credential probe, and store its answer for the sync readers | a new DI class (needs `di/register.ts`, outside my allowed files); move the rule into `AuthManager` (the workspace resolver spec fakes `AuthManager`); inject the credentials into `ActiveProviderResolver` (breaks more than 15 constructor sites in several libs) | `ActiveProviderResolver` is the active-auth boundary and both consumers already hold it. Its constructor stays the same. | yes |
| The adapter calls `configureAuthentication()` with no argument, then reads `resolveActiveAuth()` | change the `IAuthEnvProvider` port (`auth-env.port.ts`, outside my allowed files) | the port already declares `rawAuthMethod?` | yes |
| `ANTHROPIC_API_KEY` counts as a key | stored key only (batch C) | the brief says "no stored/env API key". `ApiKeyStrategy` configures from the env key. A workspace session on the env key falls back to the shared env, which serves the same provider. | yes |

## Out-of-scope observations

- **Defect 5 (stale login cache) is unchanged.** `read()` is called without `refresh`, so for up
  to 60 s after a sign-in or sign-out the default can follow the old login state. The reader
  lives in `accounts/`, which another developer owns.
- **The stored answer is refreshed only when the async rule runs.** That happens on each init
  and on each workspace snapshot. `reconfigureAuthIfChanged` passes the explicit resolved method
  and does not re-run the rule.
- **Some callers still use `normalizeAuthMethod` and fall back to `'apiKey'`.** They are
  `settings-core/active-provider-auth-key.ts`, `rpc-handlers/workspace-scope-methods.ts`, and the
  duplicate in `libs/shared/.../auth-strategy.types.ts`.
