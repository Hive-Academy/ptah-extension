# Research Report — TASK_2026_265

## VERDICT

- **Q1 — Defect 2: REPRODUCED.** Real spec, real service, mocked `axios` only. Goes red on today's code (pasted below). Scope is narrower than the hypothesis's worst case, but the core claim holds: browsing a non-active provider's model picker writes GLOBAL tier env vars from that provider's catalogue with zero activeness check.
- **Q2 — Deletion of `autoResolveDefaultTiers`: SAFE-WITH-MIGRATION, not SAFE outright.** The read-time rule covers every code path the writer currently covers. But deleting the writer only stops _new_ contamination — it does nothing for a provider that already has a persisted guess sitting in the exact same top-of-precedence config key all three writers read. That guess is permanent and outranks the live-derived rule forever, with no marker anywhere distinguishing "guessed" from "chosen." Comparison table in context.md is directionally correct but understates one row (see below) and mischaracterizes another (`.sort()` is not lexicographic in the function being deleted — it's a no-op).
- **Q3 — One line:** the risky sort is not in the code being deleted (that one is provably inert, see below); the risky sort is in `deriveTiersFromCatalog`'s `byIdAscending`, which survives Q2 — it disagrees with recency at the `4.9`/`4.10` boundary and on suffixed variants (`:thinking`), neither yet present in shipped catalogues but both plausible given the version cadence already in the repo (`4.5` → `4.6` → `4.7` → `4.8` on file today).

---

## Q1 — Defect 2

### Call-site trace

`provider:listModels` (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:452-499`) takes `providerId` from **client-supplied RPC params**, resolved only via `resolveProviderId()` (`:429-435`: param, else config default) — never checked against the active provider. It then calls:

```
this.providerModels.fetchModels(providerId, apiKey ?? null, ...)   // :475
```

`fetchModels` (`provider-models.service.ts:216-345`) branches:

- if a **dynamic fetcher** is registered for `providerId` (copilot, codex, claude-cli/anthropic, ollama, ollama-cloud, and per-activation local-proxy/local-native providers like lm-studio) → **never reaches `autoResolveDefaultTiers`**. That call only exists inside `fetchDynamicModels`.
- else if `provider.modelsEndpoint && apiKey` → calls `fetchDynamicModels` (`:350-444`), which at **`:412`** calls `await this.autoResolveDefaultTiers(providerId, models)` unconditionally for whichever `providerId` was requested, with no comparison to `resolveActiveProviderId()`.

`autoResolveDefaultTiers` (`:530-564`) guards only on **persisted tiers already existing** for that provider (`:534-537`), then regex-matches `models` for `claude.*(sonnet|opus|haiku)` and calls `setModelTier(providerId, tier, modelId, 'mainAgent')`, which (`:507-512`) writes:

```
this.authEnv[envVar] = modelId;
process.env[envVar] = modelId;   // GLOBAL
```

There is **no upstream guard** anywhere between the RPC handler and this write. The RPC handler does call `reapplyTiersForWarmedCatalog(providerId)` afterward (`:495-497`), and _that_ method does check `providerId !== this.resolveActiveProviderId()` (`:863`) — but it only _re-applies_ tiers; it does not undo the write `autoResolveDefaultTiers` already made three lines earlier, deep inside the same `fetchModels` call. The activeness guard exists in the codebase, just not on the path that actually does the damage.

### Preconditions verified independently

1. **Fetch path reachable for a non-active provider** — confirmed by reading: `providerId` is a caller-supplied RPC param, never checked. Also confirmed empirically: the RPC handler spec (`provider-rpc.handlers.spec.ts`) mocks `ProviderModelsService` entirely and never asserts an activeness check exists for `listModels` — its absence in that spec is consistent with the handler not having one.
2. **Target provider has no persisted tier values** — this is `autoResolveDefaultTiers`'s own guard (`:534-537`), trivially true for any provider a user hasn't touched yet (the common case — that's the entire reason the function exists).
3. **Catalogue contains ids matching `/claude.*(sonnet|opus|haiku)/i`** — checked against the actual registry (`libs/shared/src/lib/providers/provider-registry.ts`, `requesty-provider-entry.ts`, `sakana-provider-entry.ts`). Of the providers that reach the vulnerable `fetchDynamicModels` path (`modelsEndpoint` set, no dynamic fetcher registered): `openrouter` and `requesty` carry live `anthropic/claude-*` ids and match. `moonshot` and `z-ai` also reach the vulnerable path but their catalogues (`kimi-*`, `glm-*`) never match the regex, so the write silently no-ops for them. `sakana`'s own provider-entry docblock (`sakana-provider-entry.ts:51-52`) explicitly notes this same regex only matches `claude.*` and defines `defaultTiers` specifically because Fugu ids don't match — so Sakana is unaffected in practice too. **Net: the real blast radius is `openrouter` and `requesty` as the poisoning source**, not "any provider," because precondition 3 only holds for those two among shipped registry entries. A user-defined custom provider proxying an Anthropic-shaped catalogue would also qualify.

### The spec

Written to `libs/backend/auth-providers/src/lib/provider-models-cross-provider-contamination.spec.ts`. Constructs the real `ProviderModelsService` (only `axios` is mocked), sets the active provider to `moonshot` via the real `ActiveProviderResolver`, then calls `fetchModels('openrouter', 'sk-or-test-key')` — i.e. browsing OpenRouter's picker while Moonshot is the active chat provider — and asserts the tier env vars the active Moonshot session resolves through remain untouched.

Run: `npx nx test auth-providers --testFile=provider-models-cross-provider-contamination.spec.ts`

```
FAIL   auth-providers   libs/backend/auth-providers/src/lib/provider-models-cross-provider-contamination.spec.ts
  ● Defect 2 repro — browsing a non-active provider contaminates the active session tier env
    › writes GLOBAL tier env vars for a provider that is NOT the active one, with no persisted
      tiers and no activeness check
    expect(received).toBeUndefined()
    Received: "anthropic/claude-opus-4.5"
      168 |     // (provider-models.service.ts:530-564), reached from the fetch at
      169 |     // :412, has no such check and fails this expectation.
    > 170 |     expect(process.env[ENV_OPUS]).toBeUndefined();
          |                                    ^
      171 |     expect(process.env[ENV_SONNET]).toBeUndefined();
      172 |     expect(process.env[ENV_HAIKU]).toBeUndefined();
      173 |   });

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

Red on today's code, exactly on the write the trace predicted (`ANTHROPIC_DEFAULT_OPUS_MODEL` = OpenRouter's `anthropic/claude-opus-4.5`, while `resolveActiveProviderId()` still correctly reports `moonshot`). I confirmed this isn't a tautological assertion by first writing it the other way (asserting the buggy value _is_ written) — that version passed cleanly, i.e. the write genuinely happens; only after inverting to the "what should hold" form does it go red, which is the actual proof.

### Blast radius / what the user experiences

- **Not a 404 at picker-open time.** Nothing surfaces to the UI when the contamination happens — `provider:listModels` returns its normal result.
- **The next message sent on the active session** is what breaks. `ModelResolver.resolve` (per `auth-providers/CLAUDE.md` "Tier derivation") reads exactly `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and substitutes nothing else. A Moonshot session resolving a tier alias (`'opus'`, or `'default'` which recurses to `'opus'`) now sends OpenRouter's id (e.g. `anthropic/claude-opus-4.5`) as the model parameter to **Moonshot's** API. Moonshot has no such model → the provider rejects the request (400/404-shaped error), on the user's next turn, with no clear link back to "I opened the model picker for a different provider a minute ago."
- **Combinations affected:** any pairing where the ACTIVE provider is anything, and the BROWSED (non-active) provider is `openrouter` or `requesty` (or a custom Anthropic-shaped router) with no persisted tiers yet. Browsing `moonshot`, `z-ai`, `sakana`, `copilot`, `codex`, `ollama`, or any local/lm-studio provider while something else is active does **not** trigger the write (registry entries don't match the regex, or the dynamic-fetcher branch bypasses `autoResolveDefaultTiers` entirely).
- Once a session is poisoned, it stays poisoned until something else overwrites those three env vars — e.g. a real provider switch (`switchActiveProvider` calls `clearAllTierEnvVars()` first) — so a user who reloads/switches providers self-heals; a user who just keeps chatting on the same session does not.

---

## Q2 — Is deleting `autoResolveDefaultTiers` safe?

### Coverage: does the read-time rule fire on every path the writer covers?

Yes, structurally. `autoResolveDefaultTiers` is reached from exactly one place (`fetchDynamicModels:412`), which runs _after_ `this.modelCache.set(providerId, { models, timestamp: now })` (`:411`) and _before_ `fetchModels`'s own `persistCatalog(providerId, result.models)` call (`:287`, in the caller). Both catalogue-population steps are **independent of `autoResolveDefaultTiers`** — deleting the writer does not touch `modelCache.set` or `persistCatalog`. `getLiveDerivedTiers` → `readLiveCatalog` (`:634-638`) reads exactly this in-memory-then-persisted catalogue, synchronously. So every catalogue that used to feed the regex guess still exists and still feeds `deriveTiersFromCatalog` after deletion. All three writers (`applyPersistedTiers`, `WorkspaceProviderProfileResolver.applyProviderTiers`, `ProviderAuthResolver.buildTierValues`) already call `getLiveDerivedTiers` as their third link — confirmed by reading `provider-auth-resolver.ts:317-349` and `workspace-provider-profile-resolver.ts:375-400` directly, not from the CLAUDE.md table alone.

### The crux: persisted guesses outrank the read-time rule forever

`autoResolveDefaultTiers` calls `setModelTier(providerId, tier, modelId, 'mainAgent')`, which persists to `provider.<id>.mainAgent.modelTier.<tier>` (`getTierConfigKey`, `:134-140`). That is the **exact same key** `getModelTiers`/`getPersistedTierValue` read as "user pick" — the top of `user pick ?? registry defaultTiers ?? live-derived` — for **all three writers**, verified directly:

- `applyPersistedTiers` (`:701-748`): `userTiers = this.getModelTiers(providerId, 'mainAgent')` → `effectiveTiers[tier] = userTiers[...] ?? providerDefaults[...] ?? derivedFor(...)`.
- `ProviderAuthResolver.buildTierValues` (`:317-349`): `overrides = this.providerModels.getModelTiers(providerId, scope)` → same precedence.
- `WorkspaceProviderProfileResolver.applyProviderTiers` (`:375-400`): `persisted = this.providerModels.getModelTiers(providerId, 'mainAgent')` → same precedence.

There is **no marker anywhere** — no separate config key, no boolean flag, no timestamp — distinguishing "the auto-resolver guessed this" from "the user explicitly chose this." I grepped for `isGuessed`/`autoResolved`/`guessedTier` and any similar marker across `libs/backend`: none exists. Deleting `autoResolveDefaultTiers` stops **future** writes into that slot, but:

- A user who already opened a model picker for `openrouter` or `requesty` (as themselves, or via the Defect 2 path — the write is identical either way) before this fix ships has a value sitting in `provider.openrouter.mainAgent.modelTier.opus` today.
- After deletion, `getModelTiers('openrouter', 'mainAgent').opus` still returns that value — nothing reads or clears it.
- `applyPersistedTiers`/`buildTierValues`/`applyProviderTiers` all see it as `userTiers.opus` truthy → `derivedFor('opus')` is **never even called** for that tier → `deriveTiersFromCatalog`, however correct, is permanently short-circuited for that user/provider/tier combination.
- Consequence named directly in the CLAUDE.md "Precedence" section and independently confirmed here: "the guess then outranks a `defaultTiers` map the registry might gain later" — this is not hypothetical, it is exactly what the precedence chain does on every read.

**This is the reason deletion alone is insufficient.** A migration (clearing `provider.*.mainAgent.modelTier.*` keys that were never explicitly user-set, or some equivalent) is required to make deletion actually close the hole for existing installs, not just new ones. I am not proposing the mechanism — that's a fix decision — but the report would be incomplete without naming it as load-bearing: **without it, Q2's answer is UNSAFE, not SAFE.**

### Verifying the comparison table against actual code

| Row                 | context.md claim                                     | Verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching            | claude-only regex vs. provider-agnostic nominal pass | **Correct.** `autoResolveDefaultTiers`: `/claude.*(sonnet)/i` etc. (hardcoded, provider-blind). `deriveTiersFromCatalog.namesTier`: `\b${tier}\b` on `id` or `name`, no provider name anywhere in the file.                                                                                                                                                                                                                                                                                                                                          |
| Ordinal fallback    | none vs. context-length ordinal                      | **Correct.** `autoResolveDefaultTiers` has no fallback — an unmatched tier just stays `undefined` and the loop skips it (`:554-563`). `deriveTiersFromCatalog` ranks by `contextLength` descending when the nominal pass leaves a hole (`:143-151`).                                                                                                                                                                                                                                                                                                 |
| Ranking within tier | `.sort().at(-1)` — **described as lexicographic**    | **Wrong as stated — the more important finding of this report.** See Q3: `autoResolveDefaultTiers`'s `.sort()` has **no comparator** and is called on an array of `ProviderModelInfo` _objects_, not strings. It is provably a no-op (verified below), so the actual behavior is "last element of the regex-filtered array in API-response order," not "lexicographically greatest id." `deriveTiersFromCatalog` is the one that's genuinely lexicographic (`.sort(byIdAscending)`, a real string comparator on `.id`). The table conflates the two. |
| Persisted           | yes, user-choice slot vs. no, read-time              | **Correct**, and this is the row that matters most — see the crux above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Scope of write      | global env + config vs. snapshot / caller-scoped     | **Correct** for writer #1 (`applyPersistedTiers`) vs. writers #2/#3, but all three read the _same_ persisted config key regardless of where they write their own output — the "snapshot-only" writers are just as permanently blocked by a stale guess as the global one.                                                                                                                                                                                                                                                                            |

### Anything a persisted version provides that read-time doesn't?

Checked the specific case named in the task: **"tiers surviving when the catalogue is unreachable."** This survives identically either way, because it's provided by `persistCatalog`/`readPersistedCatalog` (config key `provider.<id>.modelCatalog`), which is entirely separate machinery from `autoResolveDefaultTiers` and is untouched by deleting it. `readLiveCatalog` (`:634-638`) already falls back to the persisted catalogue with no network call. So this specific concern is a non-issue for Q2.

One narrower, genuinely-losable behavior: if a user's persisted _catalogue_ (`modelCatalog`) is ever cleared/corrupted independently of their persisted _tier_ (`modelTier`) — e.g. manual settings edit, or a future "clear cache" action that only clears the catalogue — the old writer's guess would still resolve (it's a flat string), where the read-time rule would return `{}` until the catalogue is refetched. This is a narrow edge case (two independent config keys diverging), not the primary concern, but is a real asymmetry worth naming for completeness.

---

## Q3 — The lexicographic sort

**The function being deleted does not actually perform a lexicographic sort.** `autoResolveDefaultTiers`:

```ts
models
  .filter((m) => /claude.*(sonnet)/i.test(m.id || m.name))
  .sort()
  .at(-1)?.id;
```

`.sort()` with no comparator, called on an array of `ProviderModelInfo` objects (not strings). Per spec, `Array.prototype.sort()` with no comparator converts each element via `String(x)` and compares those. A plain object with no custom `toString`/`valueOf` stringifies to `"[object Object]"` for every element, so every comparison returns 0 and — since ES2019 sort is stable — the array order is **unchanged**. Verified directly:

```
$ node -e "
const models = [
  {id:'anthropic/claude-3-sonnet-20240229'},
  {id:'anthropic/claude-sonnet-4.5'},
  {id:'anthropic/claude-3.5-sonnet-20241022'},
];
console.log(models.slice().sort().map(m=>m.id));
"
[ 'anthropic/claude-3-sonnet-20240229',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-3.5-sonnet-20241022' ]
```

`.at(-1)` here returns whatever the API happened to list last among the regex matches — **arbitrary, API-response-order-dependent, not "newest."** The function's own docblock ("Pattern-matches the newest Claude model per tier") is therefore inaccurate for what the code actually does, independent of Defect 1/2. Since Q2 concludes this function should go (contingent on the migration), this particular bug is moot **for future behavior** — but it is relevant to Q1/Q2 evidence: any persisted guess written by today's code is not even the "best guess by version" its authors intended; it's whatever the provider's API returned last, which is not guaranteed stable across two calls to the same endpoint.

**The sort that survives (and matters going forward) is `deriveTiersFromCatalog`'s `byIdAscending`** — a real string comparator, genuinely lexicographic, on `.id`. Concrete disagreement cases, using ids in the exact shape the repo's own fixtures and static entries already use (`anthropic/claude-opus-4-7` appears literally in `openrouter-pricing.service.spec.ts:24`; `claude-opus-4.5`/`.6`/`.7` appear literally in `copilot-provider-entry.ts:21-66`):

1. **Double-digit point release** (not yet shipped, but the existing sequence `4.5 → 4.6 → 4.7 → 4.8` makes `4.9 → 4.10` a plausible near-term event):
   ```
   $ node -e "console.log(['anthropic/claude-opus-4.9','anthropic/claude-opus-4.10'].sort())"
   [ 'anthropic/claude-opus-4.10', 'anthropic/claude-opus-4.9' ]
   ```
   `byIdAscending` would rank `4.9` as newest (`.at(-1)`), silently mis-selecting the actually-older `4.9` over `4.10` once both exist on a router catalogue. This is the exact case the function's own docblock (`model-tier-derivation.ts:33-38`) already names as a known, accepted flaw — I'm confirming it reproduces, not discovering it.
2. **Suffixed variant** (OpenRouter is publicly known to ship `:thinking`/mode-suffixed ids alongside base ids — the same naming family as the repo's own `anthropic/claude-opus-4-7` fixture):
   ```
   $ node -e "console.log(['anthropic/claude-3.7-sonnet','anthropic/claude-3.7-sonnet:thinking'].sort())"
   [ 'anthropic/claude-3.7-sonnet', 'anthropic/claude-3.7-sonnet:thinking' ]
   ```
   The suffixed id sorts last and would be picked as the tier's default, which is a different serving mode of the same model, not a newer one — also already named in the same docblock.

**Does it matter given Q2's answer?** For `autoResolveDefaultTiers`: no — moot, it's going away, and its own sort was never doing what it claimed regardless. For `deriveTiersFromCatalog`: **yes, it still matters**, because that function is the one being kept and is the one every writer will lean on more heavily once the writer that used to short-circuit it (via a persisted guess) is gone — _for new users_. For existing users with a stale persisted guess (the Q2 crux), it's irrelevant either way, because their tier never reaches the derivation at all. Today's shipped static/known catalogues (single-digit minors, no suffix collisions on `sonnet`/`opus`/`haiku`-named entries) don't yet trigger either case, so this is a latent risk rather than an active one — worth a one-line note in the CLAUDE.md docblock's existing caveat, not a blocking finding for this task.

---

## Files touched by this research

- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models-cross-provider-contamination.spec.ts` — new spec, red on today's code, proves Q1. Left in the working tree, uncommitted, per standing constraints.
- No other files modified. No fix proposed or written, per task scope.

## What the CLAUDE.md "Precedence" section needs (not done here — flagged per Verification checklist in context.md)

`libs/backend/auth-providers/CLAUDE.md:163-171` currently describes `autoResolveDefaultTiers` as a live known violation and recommends deletion as "the recommended fix." If a fix lands, that paragraph needs two updates, not one: (1) that the function is gone, and (2) — the part easy to miss — a note that a persisted guess written by the old code before the fix shipped is **not** self-healing and needs the migration path named in Q2, or the paragraph will describe a hole as closed when it is only closed for new installs.
