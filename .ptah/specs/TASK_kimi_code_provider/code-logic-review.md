# Code Logic Review — `TASK_kimi_code_provider`

Static read only. No tests, typecheck, lint or nx were run.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 5              |
| Failure modes found | 8              |

Why 6 and not 7-8: the core design (static capabilities, fail-closed on unknown ids, key in
`ANTHROPIC_API_KEY`, blanking both vars in workspace snapshots) is implemented consistently at the
three tier-env sites. But the headline CLI path (`auth use kimi-code`) does not activate Kimi at
all, the new capability env can leak across workspace sessions, and the env-fallback key path now
treats the standard Anthropic variable as the Kimi key. Why not 5: none of these is a regression
that breaks the stored-key, UI-selected happy path.

## Five logic questions

### 1. How does this fail silently?

- `ptah auth use kimi-code` reports `auth.use.applied` and exits 0, but writes
  `authMethod=apiKey, anthropicProviderId=null` (`apps/ptah-cli/src/cli/commands/auth.ts:742-747`,
  `:815-836`). `ActiveProviderResolver` maps `apiKey` to the direct Anthropic provider and ignores
  `ptah.defaultProvider` (`libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:30-31`,
  `effective-route.ts:88-101`). The next run goes to api.anthropic.com. Nothing on the output says so.
- Effort on a model that is not in a tier slot is dropped without a message
  (`sdk-model-service.ts:170-175`, `provider-models.service.ts:1088-1090`).
- A haiku override of `k3.1-pro` (thinking-only) makes every internal one-shot fail with a provider
  400; nothing warns at the time it is set.

### 2. What user action produces unexpected behaviour?

- Running `ptah auth use kimi-code` (see above).
- Pinning workspace A to Kimi Code and workspace B to another provider (or leaving the global
  provider as Kimi Code) leaks Kimi's capability allowlist into B's session (Finding S2).
- Deleting the stored Kimi key while `anthropicProviderId=kimi-code` remains selected, with
  `ANTHROPIC_API_KEY` set in the shell (Finding S3).
- Choosing a custom or off-tier model id in the Ptah CLI agent config (`selectedModel`) or a raw spawn
  `model` override.

### 3. What input data produces a wrong answer?

- A tier mapped to a model id absent from `staticModels` (custom id, different case is handled, a
  `[1m]`-less or provider-renamed id) yields no `_SUPPORTED_CAPABILITIES`. The runtime then falls to
  its Claude-family heuristic and drops effort.
- Spawn/stored model that is one of the 7 static ids but is not the model the tier var holds
  (`ptah-cli-registry.ts:679-684`): the runtime matches capabilities by
  `ANTHROPIC_DEFAULT_<TIER>_MODEL`, so only three of the seven models can ever carry capabilities at
  once.

### 4. What happens when a dependency fails?

- Not applicable to a network call in this change: kimi-code has no `modelsEndpoint`, so there is no
  new failing dependency in listing.
- Unknown (stale) provider id: now fails closed in `ApiKeyStrategy.configureProviderApiKey`
  (`api-key.strategy.ts:557-567`) and `ProviderAuthResolver.resolveThirdPartyApiKey`
  (`provider-auth-resolver.ts:253-258`). One gap remains in the draft path (Finding M2).

### 5. What is missing that the requirements never mentioned?

- Any guard that haiku/sonnet tier overrides are thinking-off-capable models.
- Any user-visible signal that effort is not honoured for a model.
- Clearing `_SUPPORTED_CAPABILITIES` in per-workspace snapshots (Finding S2).
- A schema/wire-level validation that `ProviderProfile.authEnv` carries the capability keys (accepted
  risk, not re-reported).

## Failure modes

### FM1 `auth use kimi-code` does not select Kimi Code

- Trigger: `ptah auth use kimi-code` (also `openrouter`, `z-ai` today, same table).
- Symptom: success notification; later runs use direct Anthropic (or fail with no Anthropic key).
- Evidence: `auth.ts:742-747`, `active-provider-resolver.ts:30-31`, `effective-route.ts:94-101`;
  `auth.spec.ts:1017-1040` asserts this plan as correct.
- Current handling: writes `authMethod=apiKey`, `defaultProvider=kimi-code`, `anthropicProviderId=null`.
- Recommendation: write `authMethod=thirdParty` and `anthropicProviderId=kimi-code` (what the Copilot and
  Codex rows do for `oauth`), then have the spec assert the routed provider via `resolveActiveAuth`.

### FM2 Stale capability env in workspace-pinned sessions

- Trigger: global provider is Kimi Code (its capability vars live in `process.env`), a workspace is
  pinned to another provider whose snapshot sets `ANTHROPIC_DEFAULT_OPUS_MODEL` but not
  `_SUPPORTED_CAPABILITIES`. Same in reverse when the workspace tier override is an unlisted model.
- Symptom: the other provider's model runs with Kimi's allowlist: no `adaptive_thinking`, so the
  runtime sends `enabled` thinking; `xhigh/max` effort is sent to models that reject it. Likely 400s.
- Evidence: snapshot is built from `createEmptyAuthEnv()` (`auth-env.types.ts:53-55`); only
  `buildStaticTierCapabilityEnv` adds capability keys (`workspace-provider-profile-resolver.ts:496-502`);
  the query env is `{...process.env, ...buildTierEnvDefaults(effectiveAuthEnv), ...effectiveAuthEnv}`
  (`sdk-query-options-builder.ts:1331-1334`; same shape `session-query-executor.service.ts:637-639`,
  `sdk-query-runner.service.ts:602`). `buildLaneEnv` strips `ALL_TIER_ENV_KEYS` for the one-shot lane
  (`provider-auth-resolver.ts:69-74`, `:511-517`), the workspace path does not.
- Recommendation: in `applyProviderTiers` (and the native/direct/proxy snapshots), set every key in
  `ALL_TIER_ENV_KEYS` the provider does not declare to `''` (present-and-empty, so it wins the spread),
  or strip them the way `buildLaneEnv` does.

### FM3 Anthropic env key used as the Kimi key

- Trigger: no Kimi key in secret storage, `anthropicProviderId=kimi-code`, `ANTHROPIC_API_KEY` set in the
  shell or left in `process.env` by a prior direct-Anthropic configure.
- Symptom: log says "Using Kimi Code via environment fallback"; the user's Anthropic key is sent as
  `x-api-key` to api.kimi.ai.
- Evidence: `api-key.strategy.ts:575-578` (`envSnapshot?.[authEnvVar]` is now `ANTHROPIC_API_KEY`),
  snapshot taken from `process.env` at `auth-manager.ts:172-176`.
- Current handling: none. Reachability matches the pre-existing accepted risk; what changed is that for
  this provider the first link is now the variable every developer already has for Anthropic.
- Recommendation: for providers whose registry `authEnvVar` is `ANTHROPIC_API_KEY` and which are not
  `isDirectAnthropic`, do not take the env fallback (or read a provider-specific variable, for example
  the `KIMI_CODE_API_KEY` name the RPC handler already uses at `llm-rpc-app.handlers.ts:70-73`).

### FM4 Effort dropped for off-tier models

- Trigger: Ptah CLI agent `selectedModel` or spawn `options.model` set to any static id not held by a
  tier var; or a tier mapped to a custom id.
- Symptom: effort setting works for OpenRouter/Anthropic, silently ignored here.
- Evidence: `ptah-cli-registry.ts:679-684` (model is not forced into a tier slot),
  `sdk-model-service.ts:170-175`, `provider-models.service.ts:1088-1090` (deletes the key).
- Recommendation: when the resolved session model has declared capabilities but is not any tier's model,
  write its capabilities onto the tier slot that will carry it, or log once at warn that effort is not
  forwarded.

### FM5 Thinking-only model in a thinking-off slot

- Trigger: user maps haiku (or sonnet) to `k3.1-pro`/`k3.1-pro[1m]`/`k3.1-pro-highspeed`.
- Symptom: commit-message, title and curator one-shots fail with a provider error.
- Evidence: `kimi-code-provider-entry.ts:46-57, 61-67` (description says thinking-only); no check in
  `provider-models.service.ts` `setModelTier` (`:657-666`).
- Recommendation: at minimum a warn-level log and a UI hint on the haiku slot.

### FM6 Retired-id draft key can go to the default vendor

- Trigger: `auth:verifyDraftConnection` with `authMode: 'apiKey'`, no `baseUrl`, retired or unknown
  `providerId` (the UI state still carries `moonshot`, see `providers-settings-state.service.spec.ts:1269-1278`).
- Symptom: the draft key is sent to the default provider host.
- Evidence: `provider-auth-resolver.ts:633-641` -> `resolveDraftApiKeyBaseUrl` -> `getProviderBaseUrl`
  (`provider-registry.ts:765-777`, falls back to the default provider's URL). The new guard exists only
  in `resolveThirdPartyApiKey` (`:253-258`), not in `buildDraftOverride`.
- Recommendation: in the `apiKey` draft branch, require `draft.baseUrl` or a registry entry; throw
  `ProviderAuthError` otherwise.

### FM7 Stale `moonshot` ids in other persisted settings

- Trigger: `memory.curatorProvider`, lane `provider`, workspace overrides still say `moonshot`.
- Symptom: `ProviderAuthError` from `resolve()` on every background run. Not checked whether callers
  surface it or swallow it; unverified.
- Evidence: `provider-auth-resolver.ts:253-258`.
- Recommendation: confirm callers report the error; add a one-time settings cleanup or a visible notice.

### FM8 Workspace profile for an unknown provider returns `undefined`

- Trigger: workspace pinned to `moonshot`.
- Symptom: `buildProfile` logs a warning and returns `undefined`
  (`workspace-provider-profile-resolver.ts:194-201`); the comment at `:361-362` says the caller decides
  whether the shared env serves the session. If it does, the workspace silently runs on the global provider
  and key, not on an error.
- Recommendation: check the caller (`sdk-agent-adapter.ts` around `:1694`) and make it error for a pinned
  but unresolvable provider. Not verified here.

## Blocking issues

None found.

## Serious issues

### S1 `auth use kimi-code` selects direct Anthropic

- File: `apps/ptah-cli/src/cli/commands/auth.ts:742-747`
- Scenario: user runs `ptah auth use kimi-code`, then `ptah run`.
- Impact: success reported, wrong provider used. Pre-existing for `openrouter` and `z-ai`, but this task
  rewrites the case, adds a spec that locks the wrong plan in (`auth.spec.ts:1017-1040`), and documents it
  (README, skill references).
- Fix: see FM1.

### S2 Capability env leaks between workspaces and providers

- File: `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:496-502`
- Scenario and impact: FM2.
- Fix: FM2.

### S3 Anthropic-standard env var accepted as the Kimi key

- File: `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:575-578`
- Scenario and impact: FM3. A credential for one vendor is sent to another.
- Fix: FM3.

## Moderate and minor issues

- M1 `provider-models.service.ts:1072-1090`: `applyTierMetadata` now also publishes `_NAME`/`_DESCRIPTION` from
  `staticModels` for every static-only provider (Z.AI, Ollama), not only Kimi Code. This changes labels
  elsewhere. Only capabilities were intended; check this is acceptable.
- M2 `provider-auth-resolver.ts:633-641`: draft `apiKey` path not covered by the fail-closed guard (FM6).
- M3 `kimi-code-provider-entry.ts:38-44`: every model declares `xhigh_effort` and `max_effort`. The task notes
  only say Kimi maps medium to high; if Kimi rejects `xhigh`/`max`, the picker will offer levels that 400.
  Verify against the live service (assumption).
- M4 `kimi-code-provider-entry.ts:69`: the capability lookup uses the id `k3.1-pro[1m]` verbatim. If the
  runtime strips `[1m]` before comparing against `ANTHROPIC_DEFAULT_OPUS_MODEL`, effort is dropped for that
  one model only. Unverified.
- M5 FM5 and FM7 as listed above.
- Minor: `llm-rpc-app.handlers.ts:70-73` invents `KIMI_CODE_API_KEY`; no other code reads it, so it is only
  the name used for the in-process env slot that RPC sets at `:399`. Fine, but not documented as a user-facing
  env var; the strategy fallback (FM3) does not honour it.
- Minor: `sdk-model-service.ts:995-1010` builds `${baseUrl}/v1/models` which would be
  `https://api.kimi.ai/coding//v1/models` if ever reached for a third-party; today it is only called from the
  direct-API-key path (`:948`), so no effect.

## Data flow

1. Registry entry `KIMI_CODE_PROVIDER_ENTRY` (static models + capabilities): OK.
2. Key stored via `auth:setApiKey` under provider id `kimi-code` (`api-key-methods.ts:103-127`): OK.
3. `AuthManager` -> `ApiKeyStrategy.configureProviderApiKey` sets `ANTHROPIC_API_KEY` only (the previous
   provider's `ANTHROPIC_AUTH_TOKEN` is cleared at `auth-manager.ts:178`): OK. Env fallback: gap FM3.
4. `switchActiveProvider` -> `clearAllTierEnvVars` (includes capability keys) -> `applyPersistedTiers` ->
   `applyTierMetadata`: OK. Custom tier id: capabilities cleared, effort dropped (FM4).
5. Main session env: `{...process.env, ...tierDefaults, ...authEnv}`: OK for the global session, gap FM2 for
   workspace snapshots.
6. One-shot lanes: `buildLaneEnv` strips everything then adds `buildTierValues` + capability env: OK.
7. Ptah CLI agent: `buildSafeEnv` does not forward ambient tier vars; `applyTierEnv` adds capabilities: OK for
   tiers, gap FM4 for off-tier models.
8. CLI `auth use`: gap FM1.

## Requirements fulfilment

| Requirement                                                    | Status   | Gap                                                |
| -------------------------------------------------------------- | -------- | -------------------------------------------------- |
| Single `kimi-code` provider, base URL, key in `ANTHROPIC_API_KEY` | COMPLETE | Env fallback can supply a foreign key (FM3)        |
| Static models, no cost fields, default tiers                   | COMPLETE | None                                               |
| Capability env applied at the three tier-env sites             | PARTIAL  | Not cleared for other providers' workspaces (FM2)  |
| Stale `moonshot` fails closed                                  | PARTIAL  | Draft path (FM6), workspace fallback unverified (FM8) |
| Workspace sessions blank both auth vars                        | COMPLETE | `workspace-provider-profile-resolver.ts:341-342`   |
| Anthropic model fetcher requires `isDirectAnthropic`           | COMPLETE | `provider-rpc.handlers.ts:445`                     |
| CLI `auth use` / `init`                                        | PARTIAL  | `auth use` does not route to Kimi (FM1); `init` priority list is fine |
| Model/effort settings parity with other providers              | PARTIAL  | Off-tier models, custom ids (FM4)                  |

Implicit requirements not addressed: warning when a haiku/sonnet override cannot run thinking-off; a visible
signal when effort is not forwarded.

## Edge cases

| Case                                     | Handled | How                                   | Concern                          |
| ---------------------------------------- | ------- | ------------------------------------- | -------------------------------- |
| Retired `moonshot` in active provider    | YES     | `configure` returns error             | No UI recovery path checked      |
| Retired id in one-shot resolve           | YES     | `ProviderAuthError`                   | Callers' handling unverified     |
| Retired id in draft verify               | NO      | falls back to default URL             | FM6                              |
| Tier mapped to unlisted model            | PARTIAL | capabilities deleted                  | Effort silently dropped          |
| Case-different model id                  | YES     | lower-case compare                    | None                             |
| Switch Kimi -> other provider (global)   | YES     | `clearAllTierEnvVars`                 | None                             |
| Switch via workspace pin                 | NO      | snapshot does not clear               | FM2                              |
| Both auth vars set from earlier provider | YES     | blanked in snapshot; cleared globally | None                             |
| Key in shell env, none stored            | NO      | env fallback                          | FM3                              |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (no code was executed; runtime behaviour of the pinned CLI on `[1m]` ids,
  `xhigh/max` effort and capability matching is taken from the plan, not verified)
- Top risk: workspace sessions inherit another provider's `_SUPPORTED_CAPABILITIES` from `process.env`
  (FM2), and `auth use kimi-code` silently routes to direct Anthropic (FM1).
- What a robust implementation would add: blank non-declared tier env keys in every workspace snapshot;
  fix the `auth use` plan to `thirdParty` plus `anthropicProviderId`; skip the env-key fallback for
  non-Anthropic providers that use `ANTHROPIC_API_KEY`; guard the draft path; warn when effort cannot be
  forwarded or a thinking-only model sits in the haiku slot.
