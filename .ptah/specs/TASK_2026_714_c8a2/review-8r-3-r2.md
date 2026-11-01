# Batch 8r-3 Revise 2 Read-Only Re-Review

Verdict: REVISE
Score: 6/10
Review family: kimi-code (reviewer) / grok (implementer)

## Defects

1. **Major — the explicit native Claude CLI defect from revise 1 remains.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:755-758`
   now delegates to the real profile resolver. That resolver special-cases the
   `claudeCli` auth method, but not a provider with `nativeAuth: true`:
   `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:463-492`.
   An explicit `thirdParty` + `claude-cli` scope therefore reaches
   `buildDirectThirdPartyProfile`. Its `authType === 'none'` branch writes
   `OLLAMA_AUTH_TOKEN_PLACEHOLDER` and calls `applyProviderTiers`:
   `workspace-provider-profile-resolver.ts:571-597`. The Claude CLI registry
   supplies `claude-haiku-5-5` and the other default tiers:
   `libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts:23-41`.
   `ModelResolver.resolve` applies that haiku override to a saved Claude ID:
   `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:39-46`.
   A saved `claude-haiku-4-5` therefore still resolves to 5.5. The handler can
   select 5.5 instead of appending the saved 4.5 option. The new spec at
   `config-rpc.handlers.spec.ts:1454-1509` mocks the native empty profile. It
   does not exercise the real resolver branch and cannot detect this mismatch.
   **Fix:** in `WorkspaceProviderProfileResolver.buildProfile`, return
   `buildNativeAnthropicProfile(requestedModel)` when
   `provider.nativeAuth === true`, before the direct third-party branch. Do not
   apply provider tiers to that profile. Add a real resolver spec for
   `thirdParty` + `claude-cli`. Keep the handler regression case, but derive its
   expected env from the real resolver contract rather than only a mock.

2. **Major — models-list now materializes session resources on a read path.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:755-758`
   calls the session profile builder for every explicit-workspace list request.
   For OpenRouter, LM Studio, Requesty, Codex, Copilot, and other proxy
   providers, the builder calls `ProviderProxyPool.acquire`:
   `workspace-provider-profile-resolver.ts:479-485,640-650`. If no live entry
   exists, `acquire` creates and starts a local translation proxy:
   `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:279-293,353-417`.
   It also binds the workspace to that proxy at `provider-proxy-pool.ts:313`.
   A Codex start runs `startWatchingAuthFile` and `ensureTokensFresh` at
   `provider-proxy-pool.ts:677-680`. A Kimi Code start runs `startWatching` and
   `ensureFresh` at `:693-697`. Copilot can restore auth at `:659-663`.
   These are process-local server, watcher, and credential side effects on
   `config:models-list`. The frontend sends an explicit path whenever a
   workspace is open, so this cost occurs on workspace switches before a chat
   session needs the proxy. Reuse avoids later starts, but the first list
   request still starts and retains the resource. Later requests still perform
   asynchronous auth resolution and pool binding.
   **Fix:** expose a resolution-only workspace env method that shares the
   native, direct, tier, and provider-identity logic but never calls
   `ProviderProxyPool.acquire`, starts a watcher, or refreshes credentials. Use
   that method in `captureModelsListScope`. Preserve the canonical proxy
   identity and live-derived tiers without starting a server. Add a regression
   spec that proves a models-list request does not acquire a proxy or invoke
   credential readiness operations.

## Verification Notes

- The null-scope path copies the same `SDK_AUTH_ENV` object that
  `ModelResolver` reads by default. It passes that copy to `resolve` and
  `isSubscriptionCovered`. This preserves pre-8r-3 provider behavior while it
  prevents later writes from changing the answer.
- A shallow copy is sufficient. `AuthEnv` contains only optional string fields:
  `libs/shared/src/lib/types/auth-env.types.ts:6-37`. `ModelResolver` reads
  those flat fields and does not retain a nested env object.
- Direct Anthropic API-key and `claudeCli` auth-method profiles use the correct
  direct or native env. OpenRouter, LM Studio, and Requesty profiles use the
  persisted, registry, then live-derived tier chain at
  `workspace-provider-profile-resolver.ts:768-796`. Codex and Copilot receive
  their canonical proxy identities, subject to defect 2.
- The catalog race fix remains structurally intact. The handler captures the
  provider, saved model, cached IDs, tier object, resolution env, resolved saved
  model, and subscription flag before `getSupportedModels` and `getApiModels`:
  `config-rpc.handlers.ts:531-552,691-729`. `getModelTiers` returns a new flat
  object. The handler copies cached IDs and every auth env. It echoes the pinned
  path at `:664`.
- `ModelStateService` captures the request path before the RPC. It checks the
  generation, current scope, and echoed path before it publishes models:
  `libs/frontend/core/src/lib/services/model-state.service.ts:289-369`.
- Both tokens are registered in `registerAuthProvidersServices`:
  `libs/backend/auth-providers/src/lib/di/register.ts:56-59,114-118`. VS Code,
  Electron, and CLI call that function at
  `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:188`,
  `apps/ptah-electron/src/di/phase-2-libraries.ts:206`, and
  `libs/backend/cli-engine/src/lib/container.ts:694`.
- The two optional constructor parameters follow all pre-existing positional
  parameters. Existing positional construction remains valid. The profile
  resolver type is exported through the auth-providers public index.
- The profile path inspected here does not mutate the shared auth env or write
  provider settings. Its resolver and pool logs include provider IDs and local
  base URLs, not auth-env secrets. Credential readiness can still refresh
  provider credential state, as defect 2 describes.
- `import 'reflect-metadata';` remains the first import in the handler spec.
  The revised specs add no real timers. I found no new `any`,
  `as unknown as`, `@ts-ignore`, or `eslint-disable` in the revise-2 code.
  Cross-library imports use public `@ptah-extension/*` indexes. I saw no
  visible type error by static inspection.

## Verification Limits

Read-only review only. I did not run tests, lint, typecheck, build, verify, or
diagnostics, as instructed.
