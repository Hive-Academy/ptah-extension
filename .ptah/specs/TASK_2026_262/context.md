# TASK_2026_262 — context

## Where this came from

Split out of TASK_2026_250 on 2026-08-16, from its follow-up track A. 250 was
filed as a `skill-synthesis` defect: the judge lane's `inherit` branch falls back
to a pinned dated Claude id where the memory curator was moved to a bare tier
alias (TASK_2026_159), so a user on a non-Anthropic provider gets an id their
endpoint cannot serve.

**The investigation refuted the premise of its own fix.** The alias does not help.
That is why this is a separate carrier rather than a line in 250: the defect is
one layer below `skill-synthesis` and is not specific to background work.

## The refutation, traced

`libs/backend/auth-providers/src/lib/auth/model-resolver.ts`, `resolve('haiku')`
under a provider that declares no `defaultTiers`:

- `:55` `isEnvMappedTier('haiku')` → true; `:57` `env['ANTHROPIC_DEFAULT_HAIKU_MODEL']`
  is unset — that is the premise — so it falls through.
- `:77` `isModelTier('haiku')` → true; `:78` not direct Anthropic; `:81`
  `getDefaultTiers(env)` → `getAnthropicProvider(id)?.defaultTiers ?? null` → **null**.
- `:85` `return lower` — the bare string `'haiku'` goes to the endpoint.

The alias's whole premise — TASK_2026_159's, and `resolveLaneModel` line 3's — is
that it resolves _through the provider entry's `defaultTiers`_. On an entry that
has none there is nothing to resolve through. **The bare alias and the pinned
dated id are equally unservable, on exactly the providers that are exposed.**
Pinned by a load-bearing pair of cases in `model-resolver.spec.ts`.

## The three exposed entries, and why the registry is not the fix

| Entry        | Why it declares no `defaultTiers`                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requesty`   | Documented deliberate at `entries/requesty-provider-entry.ts:19-23` — the only slug in its docs is on the OpenAI-compat lane, not the Anthropic passthrough lane the entry uses, and "shipping an unverified tier map would silently break every 'Default (recommended)' selection". |
| `lm-studio`  | `entries/local-provider-entry.ts:148-163` — `isLocal: true`, models fetched from LM Studio's `/v1/models`. A static map names a model the user may not have loaded.                                                                                                                  |
| `openrouter` | `provider-registry.ts:180-192` — `modelsEndpoint` only, a ~200-model dynamic catalogue. A repo-wide search found no production OpenRouter-format slug to cite; every `anthropic/claude-*` occurrence is a spec fixture, JSDoc example or UI placeholder.                             |

All three omissions are deliberate and two say so in their own comments. Adding a
tier map ships exactly what `requesty`'s comment refuses. The fix is not in the
registry.

## Every caller with the same shape

This is why it cannot be closed in one caller:

- **Foreground chat** — `rpc-handlers/src/lib/chat/session/chat-session.service.ts:418`
  and `:1009` substitute the literal `'default'` for an empty `selectedModel`;
  `resolve('default')` recurses to `resolve('opus')` (`model-resolver.ts:51-53`)
  and falls out at `:85` as the bare `'opus'`. **This is the biggest and most
  user-visible instance** — it is where users meet it.
- **OpenRouter passthrough** — `openrouter-translation-proxy.ts:80-82`
  `normalizeModelId` is the identity function (`translation-proxy-base.ts:266`),
  so nothing downstream repairs it.
- **skill-synthesis lanes** — `resolveLaneModel` line 3 (bare alias) and
  `resolveJudgeModel` (pinned id) hit the identical wall.
- **Per-workspace profiles** — `workspace-provider-profile-resolver.ts:360-368`,
  the chain `snapshot env → defaultTiers → staticModels[0] → model`, every link
  empty for these three.

## What TASK_2026_250 shipped instead, and what it deliberately did not

Shipped: a one-time `logger.warn` in `ModelResolver.resolve` at both points where
a tier-shaped value leaves verbatim, keyed `${providerId}:${value}`, guarded so
direct Anthropic and `claude-cli` (`nativeAuth`, empty auth env — its endpoint IS
Anthropic, so the pinned id is correct there) stay silent. An unrecognised string
is deliberately not warned about: that is a real model id someone picked, and
warning on it would train everyone to ignore the warning.

**It is a diagnostic, never a fallback — there is no id to substitute.** That is
this carrier's whole reason to exist.

Also ruled out there, so do not re-investigate: `applyPersistedTiers` DOES run on
every third-party auth path (single production caller `switchActiveProvider`,
five strategy branches traced), so "the tier env was never populated" is not a
second failure mode. `applyPersistedTiers('openrouter')` runs and legitimately
writes nothing, because `effectiveTiers` is all-`undefined` and the `if (value)`
guard skips every key.

## The fix

One live-model-list resolution step in `ProviderModelsService` /
`DynamicModelFetcher`, consulted when a tier-shaped value cannot resolve through
the env var or `defaultTiers`. It is what `requesty-provider-entry.ts:19-23` says
tiers should come from, and one implementation serves the chat path, the lane
alias path, the pinned-id path and the profile resolver together.

Open design questions for whoever takes it:

- Where the live list is cached, and what happens on a cold cache or an offline
  local server — a network round trip cannot sit on every `resolve()`.
- Whether an unresolvable tier should be an error rather than a verbatim send.
  Today it is silent-except-the-warn; the background lanes have a stall channel
  (`auth-unresolvable`) but the chat path does not.
- Whether `ModelResolver.resolve`'s `claude-*` branch should also consult
  `defaultTiers` (it currently consults only the tier env var, unlike the alias
  branch). TASK_2026_250 left the asymmetry deliberately, pinned as
  characterization, because point 3 above makes the gap unreachable.

## Verification when it is taken

- Nothing-configured on each of `openrouter`, `lm-studio`, `requesty` resolves to
  a model id that provider's catalogue actually contains — not a tier word, not a
  dated Anthropic id.
- The chat path's `'default'` substitution resolves the same way.
- The `model-resolver.spec.ts` pair added by TASK_2026_250 asserts the CURRENT
  verbatim behaviour. It is characterization, not a contract — expect to rewrite
  it, and read its comments first so the rewrite is deliberate.
- `nx run-many -t test lint typecheck -p auth-providers shared rpc-handlers skill-synthesis`.
