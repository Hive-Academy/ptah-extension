# TASK_2026_250 — follow-up track A report

**Headline**: the hazard is real, but it is not a `skill-synthesis` defect and not a
Decision 1 defect — a bare tier alias is _equally_ unservable on the three exposed
providers, so reversing Decision 1 would close nothing. Applied on top of `8a578c124`
and `f1c4bebc3` as working-tree changes. Nothing committed, nothing staged.

---

## Files changed

| File                                                                                                    | What                                                                  |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/model-resolver.ts`                 | **the one behaviour change** — one-time diagnostic warn (no fallback) |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts`            | new `describe` block, 7 cases — pins the whole investigation          |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.providers.spec.ts` | scan surface widened; one false comment corrected                     |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.ts`                     | docblock only — boundary section rewritten                            |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`        | docblock only — line-2/line-3 bullets                                 |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/CLAUDE.md`                                     | bullets 1 and "inherit keeps a PINNED default"                        |

`JUDGE_DEFAULT_MODEL_ID`, `resolveJudgeModel`'s executable body, `resolveLaneModel`
and `lane-resolver.service.spec.ts:116` are all **untouched**. Decision 1 is not
reversed. No model id was invented; no registry entry gained a `defaultTiers`.
I stayed out of `platform-core/src/file-settings-keys.ts`,
`agent-sdk/.../settings-export.types.ts` and `settings-core/**` (another session is
in there), and touched nothing in `.ptah/specs/TASK_2026_242|257|261` or the staged
docs rename.

---

## Investigation point 1 — is "add `defaultTiers` to the three entries" correct?

**No, for all three.** Your doubt was right about two of them and holds for the third.

- **`requesty`** — the omission is documented as deliberate, verbatim, at
  `libs/shared/src/lib/providers/entries/requesty-provider-entry.ts:19-23`: _"No
  `defaultTiers` and no `staticModels`. The only model slug seen in the docs
  (`anthropic/claude-sonnet-4-5-20250514`) appears on the OpenAI-compat lane, not on
  the Anthropic passthrough lane this entry uses. Shipping an unverified tier map
  would silently break every 'Default (recommended)' selection, so tiers come from
  the live model list instead."_ Adding one would ship exactly what that comment
  refuses.
- **`lm-studio`** — `libs/shared/src/lib/providers/entries/local-provider-entry.ts:148-163`.
  `isLocal: true`, no `staticModels`, and the entry's own comment says _"models are
  fetched dynamically from LM Studio's /v1/models"_. A static tier map names a model
  the user may not have loaded, so it is meaningless by nature, as you suspected.
- **`openrouter`** — `libs/shared/src/lib/providers/provider-registry.ts:180-192`.
  No `defaultTiers`, no `staticModels`, `modelsEndpoint` only: a 200-model dynamic
  catalogue. Picking three of them would be inventing defaults. I searched the whole
  repo for an existing OpenRouter-format slug that could be cited instead — **there
  is no production literal anywhere**; every `anthropic/claude-*` and `openai/gpt-*`
  occurrence in `libs/` and `apps/` is a spec fixture, a JSDoc example, or UI
  placeholder text. So there is nothing to cite, and per your rule I did not guess.

So the fix cannot live in the registry, and I did not put it there.

## Investigation point 2 — does a bare tier alias actually help these providers?

**No. It is returned verbatim too, and this is the finding that reframes the whole
item.** Traced through `libs/backend/auth-providers/src/lib/auth/model-resolver.ts`
for `resolve('haiku')` under a provider with no `defaultTiers`:

- `:55` `isEnvMappedTier('haiku')` → true; `:57` `env['ANTHROPIC_DEFAULT_HAIKU_MODEL']`
  is unset (that is the premise) → falls through.
- `:77` `isModelTier('haiku')` → true; `:78` not direct Anthropic; `:81`
  `getDefaultTiers(env)` → `getAnthropicProvider(id)?.defaultTiers ?? null` → **null**.
- `:85` `return lower` — the bare string `'haiku'` goes to the endpoint.

The alias's whole premise (TASK_2026_159, and `resolveLaneModel`'s line 3) is that it
resolves _through the provider entry's `defaultTiers`_. On an entry that has none there
is nothing to resolve through, so the alias and the pinned dated id are **equally
unservable, on exactly the providers that are exposed**. Switching the fallback would
substitute one string the endpoint rejects for another.

Consequence for your constraint hierarchy: constraint 2's escape hatch does not
apply. Closing the hazard does **not** require reversing Decision 1 — reversing
Decision 1 does not close the hazard. That is a stronger result than "no such fix
exists", and it is now a test rather than a paragraph (see mutation counts).

Two further things fell out of the same trace, both worth the record:

- **The gap is not specific to the `resolveJudgeModel` branch.** `resolveLaneModel`
  line 3 (lane names a provider) hits the identical wall — which makes
  `lane-resolver.providers.spec.ts`'s comment _"the tier alias travels and is
  resolved by the provider entry's `defaultTiers` downstream"_ false for those three
  entries. Corrected.
- **The gap is not specific to background work at all.** The foreground chat has it
  identically: `rpc-handlers/src/lib/chat/session/chat-session.service.ts:418` and
  `:1009` substitute the literal `'default'` for an empty `selectedModel`;
  `resolve('default')` recurses to `resolve('opus')` (`model-resolver.ts:51-53`) and
  falls out at `:85` as the bare string `'opus'`, which the OpenRouter translation
  proxy passes through unchanged (`openrouter-translation-proxy.ts:80-82`
  `normalizeModelId` is the identity function; `translation-proxy-base.ts:266`). The
  same shape exists on the per-workspace-profile path
  (`workspace-provider-profile-resolver.ts:360-368`, every fallback empty).
  So this is a **product-wide gap for dynamic-catalogue providers**, not a
  skill-synthesis one, and background synthesis is where it was merely noticed.

## Investigation point 3 — does `applyPersistedTiers` run on every auth path?

**Yes for every third-party provider. This failure mode is ruled out, not merely
untraced.**

`applyPersistedTiers` (`provider-models.service.ts:617`) has exactly one production
caller: `switchActiveProvider` (`:702-709`). All activation funnels through
`AuthManager.doConfigureAuthentication` (`auth-manager.ts:138-192`), which clears the
tier env at `:159` and dispatches `strategy.configure` at `:190`. Every third-party
branch that returns `configured: true` calls `switchActiveProvider`:

| Strategy                   | Lines    | Path                                                |
| -------------------------- | -------- | --------------------------------------------------- |
| `api-key.strategy.ts`      | 456      | `configureProxyProvider` — the OpenRouter path      |
| `api-key.strategy.ts`      | 591, 635 | `configureProviderApiKey` (env-var / SecretStorage) |
| `oauth-proxy.strategy.ts`  | 146, 247 | Copilot, Codex                                      |
| `local-proxy.strategy.ts`  | 101      | LM Studio                                           |
| `local-native.strategy.ts` | 153, 222 | Ollama, Ollama Cloud                                |

The only `configured: true` returns that skip it are `api-key.strategy.ts:517,541`
(`configureDirectApiKey`) — the direct-Anthropic path, which correctly wants no
remapping and calls `clearAllTierEnvVars()` at `:714`.

So a provider that **declares** `defaultTiers` genuinely has `ANTHROPIC_DEFAULT_*_MODEL`
populated, and the previously-unresolved second failure mode ("a provider that DOES
declare `defaultTiers` is still exposed if the function never ran") is theoretical.
Decision 1's safety argument now has **one** stated boundary instead of two. It also
means `applyPersistedTiers('openrouter')` runs and legitimately writes nothing —
`effectiveTiers` is all-`undefined` and the `if (value)` guard at `:632` skips every
key. The bug was never a missing invocation.

## Investigation point 4 — `providerSelectedModelDef`

**Checked; it does not undermine the guard.** `settings-core/src/schema/provider-schema.ts:60-72`
builds `provider.<authKey>.selectedModel` with `default: ''` and
`schema: MODEL_SELECTED_SCHEMA`, which is `z.string()` and nothing more
(`settings-core/src/schema/model-schema.ts:8`, whose own comment says _"Empty string
means 'no model selected'"_). So a registered key always yields a string and
`readSetting`'s `typeof raw === 'string'` guard is pure defence there; it does real
work only on the `provider.thirdParty.<custom-id>.selectedModel` route, which is
pattern-routed with no registered default and returns `undefined`. No action, and
the follow-up section of the implementation report was right about this.

---

## The fix I chose, and why the alternatives were wrong

**Chosen: a one-time `logger.warn` in `ModelResolver.resolve` at the two points where
a tier-shaped value is about to leave verbatim** — the `claude-*` branch (`:47`) and
the tier-alias branch (`:85`) — implemented as `warnUnservableTierValue`, keyed
`${providerId}:${value}` so a model-list re-resolve for the picker cannot flood the
log. It is guarded by `isDirectAnthropic(env)` and by `getActiveProviderId(env)`
returning a provider, so direct Anthropic and `claude-cli` (`nativeAuth`, empty auth
env) are silent — the pinned id is correct there. An **unrecognised** string
(`kimi-k2.5`, `anthropic/claude-haiku-4.5`) is deliberately not warned about: that is
a real model id the user or provider picked and passing it through is correct;
warning about it would train everyone to ignore the warning.

It is a **diagnostic, never a fallback** — there is no id to substitute, which is the
whole finding. What it buys: the single likeliest silent failure in this area
(default install, `openrouter` active, no model selected → a 404 with nothing in
Ptah's own logs) becomes legible, on every path at once (chat, lanes, enhancer),
at zero behavioural risk.

Alternatives, and why each was wrong:

| Candidate                                                               | Verdict                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `defaultTiers` to `openrouter` / `lm-studio` / `requesty`           | **Rejected.** All three omissions are deliberate and two are documented as such; there is no citable id in the repo or in those providers' docs for the lane these entries use. Point 1.                                                                 |
| Reverse Decision 1 → bare tier alias                                    | **Rejected, and it is not merely "the user's call" — it does not work.** The alias resolves through the same `defaultTiers` and is sent verbatim on exactly the exposed providers. Point 2.                                                              |
| Make the `claude-*` branch fall back to `defaultTiers` too              | **Rejected.** It closes only the failure mode point 3 just ruled out, so it is machinery for an unreachable case (YAGNI). Its absence is now pinned as characterization instead, so removing the asymmetry later is a deliberate act.                    |
| Have `resolveJudgeModel` detect the no-tier-map case and stall the lane | **Rejected.** It needs the registry inside `skill-synthesis`, gives `resolveJudgeModel` a failure channel it does not have (the enhancer calls it directly), and would halt all background learning for OpenRouter users — a product decision, not mine. |
| Resolve the empty-selection case from the provider's LIVE model list    | **Right answer, out of scope.** It is what `requesty-provider-entry.ts:19-23` says tiers should come from, and it fixes the foreground chat too. A `ProviderModelsService` / `DynamicModelFetcher` change; needs its own carrier.                        |

## The scan-surface overclaim — widened (the preferred option)

`lane-resolver.providers.spec.ts`'s "names no registry provider" scan now covers
`resolveLaneModel` and `resolveJudgeModel` alongside the three `LaneResolverService`
prototype methods, so `CLAUDE.md` bullet 1's word _"mechanically"_ is now true rather
than corrected-down. Both free functions are already exported, so no production
surface changed.

One property makes this workable and is stated in the spec: `Function.prototype.toString`
returns the **body** only, so the docblocks above these functions are not scanned —
which matters, because those docblocks legitimately name the three entries that omit
`defaultTiers`. Code is the subject, prose is not. (An fs-based scan of the source
files would have failed for exactly that reason.) I also corrected the false comment
at the alias assertion, and updated `CLAUDE.md` bullet 1 to name the covered surface
rather than gesture at the file.

---

## Mutation tests — exact counts

**1. The scan widening (proves the overclaim, and proves the fix).** Mutated
`resolveJudgeModel`'s body to `readSetting(ws, ANTHROPIC_PROVIDER_ID_KEY) || 'openrouter'`
— a realistic drift — then ran `skill-synthesis` in both spec states:

| Spec state                     | Result                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Widened scan (this change)** | `Tests: 1 failed, 37 skipped, 1255 passed, 1293 total` — the one failure is `registry coverage › names no registry provider anywhere in the model-resolution chain` |
| **Pre-change scan (`HEAD`)**   | `Tests: 37 skipped, 1256 passed, 1293 total` — **passes**, catching nothing                                                                                         |

That is the overclaim demonstrated rather than asserted: identical production defect,
old scan green, new scan red. Both files restored afterwards.

**2. The `ModelResolver` warn.** Reverted `model-resolver.ts` to `HEAD` keeping all
specs, ran the full `auth-providers` suite:

```
Test Suites: 1 failed, 29 passed, 30 total
Tests:       1 failed, 545 passed, 546 total
```

The single failure is `warns once per provider and value, and never for a real
provider model id` (`model-resolver.spec.ts:284`). Restored → 30/30 suites, 546/546.

**Named honestly as regression guards, not mutation-proved** — the other six cases in
the new block pass before _and_ after by design, because they are characterization of
behaviour I deliberately did **not** change:

- `names exactly the registry entries the docs say are exposed` — derives the
  no-`defaultTiers` set from `ANTHROPIC_PROVIDERS` and pins it to
  `{lm-studio, openrouter, requesty}`, so the "3 of 11" figure in three prose sites
  cannot rot silently.
- `sends a bare tier alias verbatim when the provider declares no defaultTiers` and
  `sends a dated claude id verbatim there too` — **the load-bearing pair**: point 2's
  refutation, in code.
- `resolves the alias through defaultTiers when the provider declares them` — the
  contrast case, expectation derived from `getAnthropicProvider(...)`, not hardcoded.
- `does NOT resolve a dated claude id through defaultTiers — only through the tier env var`
  — the asymmetry between the two branches, pinned with its "why this is not a live
  defect" reasoning attached.
- `stays silent on direct Anthropic, where the pinned id is correct`.

## Gate

`npx nx run-many -t test lint typecheck -p skill-synthesis shared auth-providers`
— **all three targets, all three projects, succeeded.** Real numbers:

```
shared            Test Suites: 32 passed, 32 total  |  Tests: 762 passed, 762 total
auth-providers    Test Suites: 30 passed, 30 total  |  Tests: 546 passed, 546 total
skill-synthesis   Test Suites: 6 skipped, 62 passed, 62 of 68  |  Tests: 37 skipped, 1256 passed, 1293 total

lint  skill-synthesis  ✖ 30 problems (0 errors, 30 warnings)
lint  auth-providers   ✖  2 problems (0 errors,  2 warnings)
lint  shared           (clean)
typecheck              (clean, all three)
```

Nothing failed. `auth-providers` went 539 → 546 tests (the 7 new cases); its 2 lint
warnings are pre-existing `no-non-null-assertion` in
`translation/responses-stream-translator.ts:312` and
`translation/translation-proxy-base.ts:107`, neither a file I touched.
`skill-synthesis` holds at 1256 passed and the identical 30 pre-existing warnings
(`no-explicit-any` and unused disable directives in `queue/`, `gates/` and
`spec-harvester.concurrent-attribution.spec.ts`) — none in a file I touched.
Prettier run over all six changed files.

---

## Left open, with reasons

1. **The residual hazard is mitigated, not closed, and cannot be closed from here.**
   `openrouter`, `lm-studio` and `requesty` still send an unresolvable model string
   when nothing is selected. The real fix is to resolve that case from the provider's
   **live** model list — which fixes the foreground chat (`'opus'`), the lane alias
   path and this path in one place. That is a `ProviderModelsService` /
   `DynamicModelFetcher` change and deserves its own carrier; it is now the single
   highest-value thing left in this area. **Note that it is a bigger and more
   user-visible bug than the one this task was filed about**: the chat path is where
   users meet it.
2. **The foreground-chat instance is unfixed and now documented in three places** —
   `chat-session.service.ts:418` / `:1009` substituting `'default'`. I did not touch
   `rpc-handlers`; it is the same root cause as (1) and belongs in the same carrier.
3. **`workspace-provider-profile-resolver.ts:360-368` has the identical fallback
   chain** (`snapshot env → defaultTiers → staticModels[0] → model`), every link
   empty for the three providers. Same carrier.
4. **The `claude-*` branch's asymmetry stands.** It resolves only through the tier
   env var, never through `defaultTiers`, unlike the alias branch. Point 3 shows the
   env var is always populated in practice, so closing it would be machinery for an
   unreachable case — but it is now pinned as characterization, so anyone who wants
   to remove the asymmetry does so on purpose and sees the test.
5. **The scan still covers the resolution functions, not their private helpers.**
   `readSetting` and `DEFAULT_AUTH_METHOD` in `skill-synthesis/src/lib/model-resolver.ts`
   are module-private and outside any `.toString()` surface. `readSetting` takes its
   key as a parameter and cannot name a provider, so there is nothing there to leak —
   but the claim in `CLAUDE.md` is now worded as what is actually scanned, not as
   blanket coverage, so this is a stated limit rather than a second overclaim.
