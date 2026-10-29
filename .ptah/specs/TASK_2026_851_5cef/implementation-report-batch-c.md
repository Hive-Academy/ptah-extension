# Backend implementation — `TASK_2026_851_5cef`, batch C

Item 4: the default auth method when none is configured, and the refusal message.

**Tasks completed**: item 4. The default auth method is now set where the credential state is
known. The refusal message names the setting. Specs are added.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/libs/backend/auth-providers/src/lib/auth/auth-method.utils.ts`.
  - New `parseAuthMethod(raw)` returns `LegacyAuthMethod | undefined`. It gives `undefined` for a missing or unknown value.
  - `normalizeAuthMethod` is now `parseAuthMethod(raw) ?? 'apiKey'`, so its behaviour is unchanged.
  - New `resolveDefaultAuthMethod({ hasApiKey, claudeCliConnected })`.
- MODIFIED `.../auth-providers/src/lib/auth/active-provider-resolver.ts`.
  - New `isAuthMethodConfiguredForPath(workspacePath)`. It is true when the `authMethod` for that path (workspace, then app, then global) is a known spelling.
  - The constructor and the existing methods are unchanged.
- MODIFIED `.../auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`.
  - New private `resolveAuthForPath()`. It applies the default, and both `resolveProviderProfileForWorkspace` and `buildProfileForPath` use it.
  - New constructor dependency `@inject(ClaudeAmbientLoginStatusReader)`, typed `Pick<…,'read'>`. It is injected by class, as in `provider-account-rpc.handlers.ts:244`.
  - The refusal for the API key path has new text.
- MODIFIED `.../auth-providers/src/lib/auth/auth-method.utils.spec.ts`: new specs for `parseAuthMethod` and `resolveDefaultAuthMethod`.
- MODIFIED `.../auth-providers/src/lib/auth/active-provider-resolver.spec.ts`: new specs for `isAuthMethodConfiguredForPath` with known, missing and unknown values.
- MODIFIED `.../auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts`.
  - The test harness has a fake ambient reader and an `apiKey` seed.
  - New specs:
    - missing value, no key, login connected → `claudeCli`;
    - an unknown string is treated like a missing value;
    - missing value with a stored key → `apiKey`, and the login is not read;
    - explicit `'apiKey'` with no key → refusal that names the setting, and the login is not read;
    - no key and the login signed out or unknown → refusal with the hint;
    - `buildProfileForPath` applies the default too.

I did not change the registration. `ClaudeAmbientLoginStatusReader` is already registered in `registerProviderAccountServices` (`auth-providers/src/lib/di/register.ts:171`). That is the same `registerAuthProvidersServices` call that registers `WorkspaceProviderProfileResolver` (`:114-117`, `:141`), and every host calls it: VS Code, Electron and `cli-engine`.

## Decided default rule

| Configured `authMethod` | API key stored (SecretStorage `apiKey`) | Claude CLI login | Result |
|---|---|---|---|
| a known value (`apiKey`, `claudeCli`/`claude-cli`, `thirdParty`/`oauth`/`openrouter`) | any | any | that value, always |
| missing or unknown | yes | not read | `apiKey` |
| missing or unknown | no | `connected` | `claudeCli` (native Claude login profile) |
| missing or unknown | no | `signed-out` or `unknown` | `apiKey`, so the session is refused with the new message |

Evidence and placement:

- **Where the failure is.** The message "the Anthropic API key is not ready" comes from `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace`. It was built from `providerDisplayName` for `apiKey`. It is thrown when `buildDirectApiKeyProfile` finds no key (`authSecrets.getCredential('apiKey')`) and the shared env serves a different provider. This resolver is async and already owns `authSecrets`, so the default is set here.
- **Why `ActiveProviderResolver` stays synchronous.** It is synchronous and has many synchronous callers: `AuthManager`, `SdkAgentAdapter`, the RPC handlers and `resolveStoredModel`. More than ten specs build it with `new ActiveProviderResolver(scope)`. It only reports whether a value is configured.
- **How the login state is read.** It reuses `ClaudeAmbientLoginStatusReader.read()` (`accounts/claude-ambient-login-status.ts`). That reader has a single flight, a 60 s cache (`AMBIENT_STATUS_FRESH_MS`), a 25 s read deadline, and never throws. `claudeCliConnected` is `state === 'connected'`.
  - The login is read only when no value is configured and no key is stored. Today that path always fails, so no working path pays for the read.
  - A stored key or an explicit value returns before the read. Both specs assert this.
- **Why the key check uses SecretStorage only.** It matches what `buildDirectApiKeyProfile` can use. An `ANTHROPIC_API_KEY` env var does not build a workspace snapshot today.
- **Callers that cannot know the credential state behave as today.** They keep `normalizeAuthMethod`, which still falls back to `'apiKey'`:
  - `settings-core/.../active-provider-auth-key.ts`
  - `rpc-handlers/.../auth/workspace-scope-methods.ts`
  - `AuthManager.configureAuthentication(raw)`
  - `ActiveProviderResolver.resolveActiveAuth*`

## Refusal message

Explicit `'apiKey'`, or the fallback with no key and no connected login, when the shared env does not serve it:

`Cannot start this session: the Anthropic API key is not ready. Add an API key, or choose the Claude CLI login in Settings > Providers > Main agent authentication.`

`recoveryHint` is the second sentence.

The setting name comes from the Electron UI:

- the settings tab label is `'Providers'` (`libs/frontend/chat/src/lib/settings/settings.component.ts:188`);
- the auth-method field label is `'Main agent authentication'` for key `authMethod` (`libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:644-651`).

The message for other providers (`… is not ready for this workspace, and the active connection uses a different provider …`) is unchanged. No existing spec asserted the old API-key text.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Set the default in `WorkspaceProviderProfileResolver`, not in the pure mapper or in `ActiveProviderResolver` | in the mapper (it does not know the state); make `ActiveProviderResolver` async or stateful (wide ripple, more than ten `new` call sites); in the async profile resolver | the refusal is thrown there; it already holds `authSecrets`; its constructor is called only by its own spec | yes |
| Login state from `ClaudeAmbientLoginStatusReader` | `ClaudeCliDetector.performHealthCheck` (install check only, not login); a new probe | the reader is the cached, bounded probe of the existing login and is registered on every host | yes |
| UI path "Settings > Providers > Main agent authentication" | the brief's example "Settings > Authentication > Auth method" | actual Electron labels quoted above | yes (one constant) |

## Stack observed

- tsyringe with `@injectable` and `@inject`. The sibling `provider-account-rpc.handlers.ts` injects by class.
- Registration is in `auth-providers/src/lib/di/register.ts`.
- `AuthRequiredError` comes from `@ptah-extension/agent-sdk`.
- Logging uses the injected `Logger`.
- No new external input boundary.

## Verification

- `npm run verify -- -p auth-providers`
  - typecheck: passed.
  - test: 89 suites passed, 1 failed, 1 skipped. 2455 tests passed, 4 failed. The only failure is the known `translation-proxy.sdk.integration.spec.ts` (S1–S4), which fails on main too. The three changed specs passed.
  - lint: 1 error, the known `@nx/dependency-checks` error ("persistence-sqlite not used", `auth-providers/package.json:9`). There are no warnings in the changed files.
- `npm run verify -- -t test -p rpc-handlers,cli-agent-runtime,ptah-electron -- --testPathPatterns="(smoke|activation)"`: 9 tasks succeeded, exit 0. This covers the Electron `container.smoke.spec.ts`, which registers a fake `ClaudeAmbientLoginStatusReader`, plus the rpc-handlers activation and cli-agent-runtime DI smoke specs.
- `ptah_get_diagnostics` on the changed files: no errors in them. It reports 3 errors in a sibling file, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1100,1104,1204` (`NamedAdmissionSettlements`, `trackNamedAdmission`). That file is not mine and is being edited by a parallel batch.
- Not run: the VS Code container smoke spec. No public API was removed and the reader is registered by the same function the VS Code `phase-2-libraries.ts:188` calls.

**Environment note.** The worktree had no `node_modules`. The first test run failed 55 suites with "Could not locate module marked", because `jest.preset.js` maps it under `<worktree>/node_modules`. I created a git-ignored directory junction from `.claude-worktrees/claude-account-followups/node_modules` to `D:/projects/ptah-extension/node_modules`. Remove it with `rmdir` if it is not wanted.

## Plan deviations

None from the brief. I did not change the shared duplicate `normalizeAuthMethod` in `libs/shared/src/lib/types/auth-strategy.types.ts`; it still falls back to `'apiKey'`.

## Out-of-scope observations

- The global path, `SdkAgentAdapter.doInitialize` → `AuthManager.configureAuthentication(active.authMethod)`, still resolves a missing value to `'apiKey'`.
  - With no key, the shared AuthEnv health still shows "No Anthropic API key configured…", even though workspace sessions now run on the Claude login.
  - Making that path use the default needs an async default in `agent-sdk`/`AuthManager`. That is a wider change, and I left it for a decision.
- `libs/shared/src/lib/types/auth-strategy.types.ts:101` duplicates `normalizeAuthMethod`.
