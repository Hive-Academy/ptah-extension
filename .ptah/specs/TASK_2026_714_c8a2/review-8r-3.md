# Batch 8r-3 Review

Verdict: REVISE
Score: 7/10
Review family: kimi-code (reviewer) / grok (implementer)

## Defects

1. **Major — model matching still reads the ambient provider after the catalog awaits.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:541` calls
   `this.modelResolver.resolve(value)` inside `matchesSaved`. This runs after the
   awaits at lines 508-509. `ModelResolver.resolve` defaults to the shared mutable
   `authEnv` (`libs/backend/auth-providers/src/lib/auth/model-resolver.ts:37-39`).
   A workspace or provider switch during either await can therefore change the
   candidate mapping. A saved tier alias or Claude ID can then select the wrong
   entry, or no entry, even though `resolvedSavedModel` was captured earlier.
   **Fix:** capture an immutable auth environment or a pure scoped resolution
   function before the first await. Pass that snapshot as the `envOverride` for
   every candidate resolution. Add a gated-catalog spec that changes the ambient
   mapping before release and uses a saved `sonnet` or `haiku` value.

2. **Major — the explicit workspace snapshot resolves and prices against the ambient provider.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:669` and
   `:672` call `resolve(savedModel)` and `isSubscriptionCovered()` without an
   environment override. `readWorkspaceModelScope` pins the provider and setting
   key, but these two calls still use the active provider described at
   `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:37-39,172-175`.
   A request for workspace A that arrives while ambient workspace B is active
   can resolve A's `default` or tier alias with B's mapping. Its pricing text can
   also use B's billing policy. No mid-await switch is required for this failure.
   **Fix:** build the request's auth-environment snapshot from the pinned provider
   and its captured tiers, then use it for both calls and for defect 1. Derive
   `subscriptionCovered` directly from `scope.providerId` if a full environment
   is unnecessary for pricing. Add a spec where the ambient provider differs
   from the requested workspace before the call.

## Verified

- The frontend drops stale generations and scope keys at
  `libs/frontend/core/src/lib/services/model-state.service.ts:300-315`.
  The latest request after A → B → A remains eligible to apply.
- The handler echoes the exact request string at
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:627`.
  The frontend compares that exact echo at
  `libs/frontend/core/src/lib/services/model-state.service.ts:359-369`.
  Windows case, slash, and trailing-separator normalization therefore cannot
  differ between request and echo. `WorkspaceScopeResolver` normalizes the path
  only for settings lookup at
  `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:159-170`.
  I found no normal path that drops every current reply and leaves the initial
  load unset.
- Workspace setting reads use the same keys and app-scopable flags as
  `ModelSettings` and `ActiveProviderResolver.resolveActiveAuthForPath`:
  `libs/backend/settings-core/src/repositories/model-settings.ts:31-40`,
  `libs/backend/settings-core/src/repositories/active-provider-auth-key.ts:27-37`,
  `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:87-91,128-146`,
  and `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:691-711`.
  `providerSelectedModelDef` is app-scopable at
  `libs/backend/settings-core/src/schema/provider-schema.ts:60-71`.
  Scope precedence comes from the shared resolver at
  `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:80-103`.
- The optional resolver is registered by all three hosts:
  `libs/backend/platform-electron/src/settings/electron-settings-registration.ts:86-113`,
  `libs/backend/platform-cli/src/settings/cli-settings-registration.ts:89-115`,
  and `libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts:114-140`.
  Production Electron also resolves the token directly at
  `apps/ptah-electron/src/activation/bootstrap.ts:600-602`.
- The Zod parser accepts `undefined`, `null`, `{}`, and a nullable path at
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.schema.ts:80-100`.
  The CLI passes `undefined` at `apps/ptah-cli/src/cli/commands/config.ts:421-426`.
  The TUI passes `undefined` at `apps/ptah-tui/src/hooks/use-agent-config.ts:74-88`.
  The Electron e2e caller omits params at
  `apps/ptah-electron-e2e/src/specs/rpc.spec.ts:61-69`.
- The saved-model fallback now uses the captured provider and copied catalog at
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:663-671,724-743`.
  `savedModelOption` still rejects undeclared models and tier aliases at
  `libs/backend/rpc-handlers/src/lib/handlers/config-saved-model-option.ts:36-58`.
  The reported concrete `gpt-6-sol` case is covered without invented entries.
- Ambient Claude requests retain the previous list construction and exact-match
  selection. The remaining Claude race for resolved IDs is defect 1.
- The added lines contain no `any`, `as unknown as`, `@ts-ignore`, or
  `eslint-disable`. The Angular service retains signals and `inject()`.
  `reflect-metadata` remains the first import in the tsyringe spec. The new specs
  add no real timers. I saw no type error by reading the changed code.
- The handler already exceeded its line limit. This batch increases its size,
  but the instructions classify that as a note unless a new lint error exists.
  I did not establish a new lint error.

## Verification Limits

Read-only review only. I did not run tests, lint, typecheck, build, verify, or
diagnostics, as instructed.
