# Batch 8r-3 Revise 1 Review

Verdict: REVISE
Score: 7/10
Review family: kimi-code (reviewer) / grok (implementer)

## Defects

1. **Major — native Claude CLI auth receives a third-party resolution env.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:110-137`
   special-cases only `anthropic`. A persisted `thirdParty` + `claude-cli` scope
   therefore gets `http://127.0.0.1` and the registry's Claude tier overrides.
   The real native-auth env is empty by contract:
   `libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts:4-18`.
   `CliStrategy` also clears the tier vars at
   `libs/backend/auth-providers/src/lib/auth/strategies/cli.strategy.ts:57-60`.
   `ModelResolver` treats the real empty env as direct Anthropic, but treats the
   synthetic env as third-party (`model-resolver.ts:53-89`). This changes both
   explicit-workspace and null-scope behavior. For example, a saved
   `claude-haiku-4-5` now resolves to the registry haiku default
   `claude-haiku-5-5`. If the catalog contains 5.5 but omits 4.5, the handler
   selects 5.5 instead of appending the saved static 4.5 option.
   **Fix:** look up the provider before the direct-auth branch. Return the same
   empty env, with no tier vars, when `provider?.nativeAuth === true`. Add null
   and explicit-workspace specs for `thirdParty` + `claude-cli` with a saved
   Claude ID that the catalog omits.

2. **Major — the snapshot drops the runtime's live-catalog tier fallback.**
   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:125-127`
   stops at persisted tier, then registry `defaultTiers`. The runtime chain is
   persisted tier, registry default, then live-derived tier:
   `libs/backend/auth-providers/src/lib/provider-models.service.ts:861-877`.
   The per-workspace runtime uses the same three stages at
   `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:773-792`.
   OpenRouter, LM Studio, and Requesty have no registry defaults. With no
   persisted override, their real env can still contain a live-derived mapping.
   Before 8r-3, a null-scope saved `haiku` or `default` resolved through that
   mapping. The new synthetic env leaves the alias unresolved, so no concrete
   catalog entry matches it. Explicit workspaces lose the same mapping.
   **Fix:** capture `providerModels.getLiveDerivedTiers(providerId)` before the
   catalog awaits. Use `persisted ?? registry default ?? live derived` for each
   tier. Add a spec with no persisted or registry tier, a live-derived haiku or
   opus ID, and a saved alias. Cover both a null scope and an explicit scope.

## Verified

- The two reported ambient-read races are structurally closed. The handler
  captures the scope before the awaits at
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:573-578`.
  Every later candidate resolve receives `resolutionEnv` at `:612-617`.
  Saved-model resolution uses the same env at `:745-756`. Subscription coverage
  uses the pinned provider ID at `:759` and does not read the ambient env.
- Direct Anthropic has the correct empty direct-auth shape. OpenRouter, Kimi
  Code, Codex, and Copilot use the same placeholder identities that
  `getActiveProviderId` recognizes at
  `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:197-213`.
  Z.AI uses its registry hostname. The two defects above are the remaining
  semantic mismatches that I confirmed.
- `isSubscriptionCoveredProvider` exists at
  `libs/shared/src/lib/providers/provider-registry.ts:832-837`. It is exported
  through `libs/shared/src/lib/providers/index.ts:11` and
  `libs/shared/src/index.ts:81`. The handler imports only public
  `@ptah-extension/*` indexes.
- The placeholder token stays in the local resolution env. The handler passes
  it only to `ModelResolver.resolve`. The handler logs do not include the env.
  This path does not persist the env or send it over a network.
- `import 'reflect-metadata';` remains first in the handler spec. The revised
  specs add no real timers. I found no new `any`, `as unknown as`,
  `@ts-ignore`, or `eslint-disable` in the revised handler and tests. I saw no
  visible type error by reading the changed code.
- `git diff --check` passed for all batch files. It printed only the existing
  CRLF conversion warnings for the handler and its spec.

## Verification Limits

Read-only review only. I did not run tests, lint, typecheck, build, verify, or
diagnostics, as instructed.
