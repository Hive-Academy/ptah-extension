# TASK_2026_262 — Batch 1 report

**Headline**: the chat path's `'default'` now resolves to a real catalogue id on
all three no-`defaultTiers` providers, via a third link in `applyPersistedTiers`
(`userTiers ?? defaultTiers ?? liveDerived`) fed by a synchronous catalogue read
with an out-of-band refresh behind it. `ModelResolver.resolve` is byte-identical
in behaviour — which means **R3's prediction that the characterization pair goes
green-to-red is wrong**, and that is the loudest thing in this report.

Nothing committed, nothing staged. `.ptah/specs/TASK_2026_242/` and
`TASK_2026_257/` untouched.

---

## Files changed

| File                                                                                                      | What                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/model-tier-derivation.ts`                 | **NEW** — the catalogue→tier rule, pure function, 0 dependencies on the service                                                                  |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/model-tier-derivation.spec.ts`            | **NEW** — 15 cases over 3 catalogue shapes                                                                                                       |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/provider-models.service.ts`               | third precedence link, `readLiveCatalog`, `refreshTiersFromLiveCatalog`, `applyTierMetadata` source, optional `apiKey` on `switchActiveProvider` |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/provider-models.service.spec.ts`          | +9 cases — precedence, cold cache, offline server, bounded work                                                                                  |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/model-resolver.ts`                   | **docblock + warn message only** — no executable change                                                                                          |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts`              | characterization pair rewritten (not deleted) + 1 end-to-end case                                                                                |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts`      | 3 call sites now pass the key they already hold                                                                                                  |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts` | 6 assertions updated — they are now the R4 evidence                                                                                              |

No registry entry changed. No model id invented. No provider id appears in any
new executable body.

---

## Task 1.1 — ground truth, one line each

The characterization pair from `5c9094f12`, before any edit:

- **`sends a bare tier alias verbatim when the provider declares no defaultTiers`**
  — asserts `resolve('haiku')` returns the string `'haiku'` under an OpenRouter
  auth env; it exists to _refute_ "swap the pinned judge id for a tier alias",
  because on the exposed providers the alias is no more servable than the id.
- **`sends a dated claude id verbatim there too — the two fallbacks are equally unresolved`**
  — asserts `resolve('claude-haiku-4-5-20251001')` returns itself under the same
  env; it is the other half of that refutation, closing the "then use the pinned
  id" escape.

The other five in the block, and why they must not move: `names exactly the
registry entries the docs say are exposed` derives `{lm-studio, openrouter,
requesty}` from `ANTHROPIC_PROVIDERS` so the "3 of 11" prose cannot rot;
`resolves the alias through defaultTiers when the provider declares them` is the
precedence contract; `does NOT resolve a dated claude id through defaultTiers`
pins the Q3 asymmetry; `warns once per provider and value` is the only
mutation-proved case in the original set; `stays silent on direct Anthropic`
guards the case where the pinned id is correct.

Two facts from the reading that changed the design:

- `LocalModelTranslationProxy.listModels` (`local-model-translation-proxy.ts:148-154`)
  hardcodes `supportsToolUse: false` and `contextLength: 4096` on **every** LM
  Studio entry. So a tool-use filter would empty an LM Studio catalogue, and a
  context-length ranking has nothing to discriminate. Both are handled
  explicitly rather than accidentally.
- `di/register.ts:37-40` binds `SDK_AUTH_ENV` with `registerInstance` — **one
  shared object**. That is the load-bearing property of the whole approach: a
  tier written out of band is visible to a `ModelResolver` constructed earlier.
  It now has its own assertion (see 1.5).

---

## Task 1.2 — the derivation rule

**Placement**: a new sibling module, not a private method. Three reasons.
`provider-models.service.ts` is already 950 lines and this is the highest-risk
piece in the change (R2), so it deserves a test surface that does not need a
service, a config mock, a logger and an env. Task 2.1 is explicitly required to
_reuse_ this rather than re-implement it — an exported pure function is reusable
and a private method is not. And it is genuinely a different concern: the
service does I/O, caching and env mutation; this does arithmetic on an array.
It is deliberately **not** added to the lib barrel — `workspace-provider-profile-resolver.ts`
is in the same lib and imports it relatively.

**The rule** (full reasoning is in the file's docblock, written so a future
reader can disagree with it on purpose):

1. Candidates = entries with a non-empty `id`, narrowed to `supportsToolUse`.
   **If that filter empties the list, the whole list is used.** A catalogue must
   not be silenced by its own silence — LM Studio reports no tool support for
   anything, and those are exactly the models the user loaded in order to run an
   agent against them. When _some_ entries declare it, the rest are genuinely
   unusable and are dropped.
2. **Nominal pass** — a model whose `id` or `name` contains the tier word on a
   word boundary wins that tier; ties go to the greatest `id` under a code-unit
   sort. This is the provider naming the tier itself, and it is the branch that
   fires for `openrouter` and `requesty` in practice. `.sort().at(-1)` is
   reused from `autoResolveDefaultTiers` (`provider-models.service.ts:527-538`)
   rather than invented. Two flaws are documented, not hidden: lexicographic
   compare orders `4.10` before `4.9`, and a suffixed variant sorts above its
   base id. Both still return a servable id from the family that was asked for.
3. **Ordinal pass** — rank by `contextLength` descending, tie-break `id`
   ascending; opus = largest, haiku = smallest, sonnet = `floor((n-1)/2)`.
   **Context length is chosen over price deliberately.** Price is the more
   intuitive capability proxy, but ranking by price means the top tier is
   selected _because it is expensive_ — on a ~200-model router that silently
   points a user's first message at whatever the priciest listing happens to be.
   Context length cannot make that mistake. Its own failure — a small
   long-context model out-ranking a large short-context one — is quality-only
   and reversible by picking a model.
4. **No discriminating signal → one id, not a fabricated spread.** Fewer than
   two distinct context lengths means there is nothing to rank by, and deriving
   three different answers from the alphabet would be a guess wearing a rule's
   clothes. Every unset tier gets the same id: the code-unit-first candidate,
   chosen for order-independence. In practice only uniform-metadata catalogues
   reach here, i.e. local ones, where every model is free and equally servable.
   **That fall-out is why the file contains no provider id anywhere** — the
   local/remote distinction emerges from the data, not from a branch.

**What it does with a catalogue it cannot read**: returns `{}`. Empty array,
`null`, `undefined`, and an array where no entry carries a usable `id` all
return `{}` and never throw. `{}` means the caller writes nothing, which is
exactly today's behaviour — so an unreadable catalogue degrades to the status
quo ante, never to a guess. Every string the function can return is `===` an
`id` on an entry of the input array; that is asserted across every fixture, and
it is what makes "no invented model ids" true by construction rather than by
review.

**Acceptance**: 15 cases over the three required shapes (broad router, two-model
local server, empty) plus null/undefined/junk, single-model, order-independence
and the never-synthesise property. Mutation counts below.

---

## Task 1.3 — wiring, and the precedence contract

`applyPersistedTiers(providerId, options?)` now computes
`userTiers[k] ?? providerDefaults[k] ?? derivedFor(k)`. The derivation is
consulted **lazily** — `liveDerived ??= deriveTiersFromCatalog(...)` — so a
provider whose static data covers all three tiers never reads a catalogue at
all.

- **Precedence is exactly that order**, and it has two dedicated specs: a user
  pick beats the catalogue (and the tiers the user did _not_ pick still come
  from the catalogue), and a registry `defaultTiers` map beats the catalogue
  with the expectation derived from `getAnthropicProvider(...)` rather than
  hardcoded. Rationale: a user's pick is a choice and a registry map is a
  verified statement by whoever added the entry; a heuristic over a live list
  outranks neither.
- **The read is synchronous** — `readLiveCatalog` is in-memory `modelCache`
  first, then `readPersistedCatalog` (`:165`). No network on this path. It is
  deliberately **not** allowed to fall back to `staticModels`: that is a repo
  literal frozen at release time, and the entire point of deriving from a
  catalogue is that the provider vouched for the ids.
- **`applyPersistedTiers` and `switchActiveProvider` stay synchronous.** R5's
  8-call-site ripple is avoided entirely. They gain an _optional_ second
  argument (`{ apiKey }`) used only by the out-of-band refresh, so five of the
  eight sites are untouched; the three that hold a real key now pass it.
- **`applyTierMetadata` (`:658`) did NOT still behave correctly**, and this is a
  finding rather than a confirmation. It looked up the model in `modelCache`
  only — which is cold on precisely the run where the _persisted_ catalogue does
  the work, so a live-derived tier would have lost its `_NAME`/`_DESCRIPTION`
  and the picker would have shown a bare id. It now reads the same
  cache-then-persisted accessor the derivation does. A live-derived tier is by
  construction an id from that catalogue, so the lookup cannot miss. Mutation-proved (M8).

**Acceptance case**: `applyPersistedTiers('openrouter')` with a populated
persisted catalogue writes `anthropic/claude-opus-4.5` /
`...sonnet-4.5` / `...haiku-4.5` into `authEnv` and `process.env`, where
`followup-a-report.md:126-128` documents it previously and legitimately wrote
nothing.

**One thing found and deliberately not changed.** `autoResolveDefaultTiers`
(`:517`) already does a claude-only version of the nominal pass — but it
persists its result via `setModelTier`, i.e. into the **user-choice slot**, the
top of the precedence chain. That conflates "we guessed this" with "the user
chose this", and the guess then outranks a `defaultTiers` map the registry might
gain later. I did not unify the two: promoting my heuristic into the user slot
would be a real regression, and demoting `autoResolveDefaultTiers` is a
behaviour change with its own spec set and no bearing on this batch. The two now
live at different precedence levels on purpose. **Recommended follow-up**: delete
`autoResolveDefaultTiers` in favour of the read-time rule, because a value that
is never persisted can be re-derived when the catalogue changes, whereas a
persisted guess is permanent.

---

## Task 1.4 — cold cache and offline local server (design Q1)

### Shape chosen

The plan's recommended shape, adopted: **in-memory cache → persisted catalog
(sync) → async refresh out of band.** Assumption 1 (resolve cannot become async)
and Assumption 3 (a sync catalogue read already exists) both held under
inspection and are not re-derived here.

`applyPersistedTiers` ends by checking whether any tier is still unset and, if
so, fires `void this.refreshTiersFromLiveCatalog(providerId, apiKey, unresolved)`.

### What happens when no catalogue has ever been fetched

The synchronous pass finds nothing and writes nothing — identical to today.
Then the refresh fetches the catalogue through the ordinary `fetchModels` path
(which populates `modelCache` **and** persists, so the next process start is
warm) and calls `applyPersistedTiers` again, which now succeeds. Nothing else
has to ask. Pinned by `recovers from a cold cache: nothing persisted, then the
refresh lands`.

**The refresh yields once (`await Promise.resolve()`) before it looks for a
dynamic fetcher, and that is not incidental.** `local-proxy.strategy.ts:101-102`
and `local-native.strategy.ts:153-161` call `registerDynamicFetcher` on the
statement _immediately after_ `switchActiveProvider`. Without the yield, LM
Studio — the one provider with no `modelsEndpoint`, no static models and
therefore nowhere else to get a catalogue — would never resolve. The spec
registers the fetcher after the switch, exactly as the strategy does, and M7
proves the yield is load-bearing.

### What happens when LM Studio is offline

`fetchModels` already swallows a throwing fetcher (`:246-255`) and returns an
empty list. The refresh sees `models.length === 0` and returns. Outcome:
**unchanged tiers, no throw, no unhandled rejection, one debug line.** Every
other failure — a 401 from an expired key, an axios timeout, an unknown provider
— lands in the same `catch (error: unknown)` narrowed with `instanceof Error`.
Pinned by `survives an offline local server without throwing or writing a guess`.

Note the surrounding reality: when LM Studio is not running at all, the
_proxy start_ fails first and `configure` returns `configured: false` with "LM
Studio is not running". The window this branch covers is the narrow one where
the inference endpoint is up but `/v1/models` is not.

### Is the apiKey in hand? (R4 — traced, not assumed)

Traced at all eight sites:

| Site                               | Key at that point                                                                                | Passed? |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| `api-key.strategy.ts:456`          | `providerKey` from SecretStorage, in scope — `authEnv` holds only the **proxy placeholder** here | yes     |
| `api-key.strategy.ts:591`          | `trimmed`, from the env-var fallback                                                             | yes     |
| `api-key.strategy.ts:635`          | `providerKey`, SecretStorage                                                                     | yes     |
| `local-proxy.strategy.ts:101`      | none needed — `authType: 'none'`, dynamic fetcher                                                | n/a     |
| `local-native.strategy.ts:153,222` | dynamic fetcher; both entries declare `defaultTiers` anyway                                      | n/a     |
| `oauth-proxy.strategy.ts:146,247`  | dynamic fetchers registered in `rpc-handlers`                                                    | n/a     |

The proxy path at `:456` is why reading the key off `authEnv` was rejected: for
`openrouter` — the headline provider — `authEnv.ANTHROPIC_AUTH_TOKEN` is
`OPENROUTER_PROXY_TOKEN_PLACEHOLDER` at exactly that moment, and sending it as a
Bearer token would be a dirty guess. Injecting a secrets service into
`ProviderModelsService` was the alternative; it was rejected as a real coupling
increase for a value three call sites already hold. The optional argument keeps
both methods synchronous and leaves five call sites untouched. The key is never
logged.

### Bounded work

`tierRefreshInFlight` holds a per-provider entry that is cleared only _after_
the re-application, so the re-application cannot schedule a refresh of its own —
no loop, no storm. The route check (`dynamic fetcher || modelsEndpoint`) runs
after the yield and returns quietly for a provider with nowhere to fetch from,
so `applyPersistedTiers('anthropic')` costs one microtask and no `fetchModels`
call. Specs: `fetches at most once per activation, and not at all when nothing
is missing`; `does not reach for a catalogue for a provider that has no route to
one`.

### Residual hole — explicit, this is Batch 3's input

1. **The refresh window.** `applyPersistedTiers` returns before the fetch lands.
   A message sent in that window still resolves to the bare tier word. Duration
   = one HTTP round trip (axios timeout 10 s remote, 5 s local). The window
   opens at provider activation, i.e. while the user is still in the auth flow,
   so it is small — but it is not zero and it is the only remaining instance of
   the original bug on a healthy system.
2. **Offline `/v1/models` with a live inference endpoint.** Retried only on the
   next provider activation. Nothing retries on a timer, by design.
3. **A catalogue fetched by somebody else does not re-apply tiers.**
   `provider:listModels` (the model picker) calls `fetchModels` and warms both
   caches, but never re-runs `applyPersistedTiers`. So a user who opens the
   picker inside the window warms the cache and still waits for the next
   activation. This is the cheapest remaining gap to close and my recommended
   scope for Batch 3 — with the guard `providerId === resolveActiveProviderId()`,
   because `applyPersistedTiers` does not check activeness and applying tiers for
   a non-active provider would corrupt the active one's env. (**Pre-existing
   hazard worth recording**: `autoResolveDefaultTiers` already writes tier env
   vars for whichever provider was fetched, with no activeness guard.)
4. **Per-workspace profiles are not reached at all.** `workspace-provider-profile-resolver.ts:334-345`
   builds a _snapshot_ env with its own copy of the chain; a late write into the
   shared `authEnv` does not retro-fill a snapshot already taken. Assumption 5
   predicted this and Batch 2 owns it — but until 2.1 lands it is part of the
   live residual hole, not a future one.

---

## Task 1.5 — the characterization pair

### Loud finding: R3 is wrong, and Assumption 2 is why

R3 predicted the pair would go green-to-red and warned that deleting it is the
likeliest way this task fails. **The pair did not go red. It cannot.** The fix
sits one layer below `ModelResolver`: `resolve` still has nothing to work with
when `ANTHROPIC_DEFAULT_HAIKU_MODEL` is empty, and both cases construct an env
in which it is empty. The two statements in `tasks.md` contradict each other —
Assumption 2 says the approach closes the gap "without touching `resolve()`'s
signature at all", which is true and which necessarily means these two cases
keep passing. R3 assumed a fix inside `resolve`. Flagging it because a developer
who _expected_ red might have "fixed" the test suite to produce it.

So the pair was rewritten for **meaning**, not for outcome, and a third case was
added to carry the behaviour change.

### Old vs new, side by side

|                     | Old                                                                                 | New                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**            | `sends a bare tier alias verbatim when the provider declares no defaultTiers`       | `sends a bare tier alias verbatim while the tier env var is still empty`                                                                                                                                         |
| **Assertion**       | `resolve('haiku') === 'haiku'`                                                      | _unchanged_                                                                                                                                                                                                      |
| **Claim around it** | this is the permanent end state; the refutation of "just fall back to a tier alias" | emptiness is no longer the steady state — `applyPersistedTiers` fills it from the live catalogue, so this characterises the window before the first catalogue lands, i.e. exactly the residual hole 1.4 measured |

|                     | Old                                                                                     | New                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**            | `sends a dated claude id verbatim there too — the two fallbacks are equally unresolved` | `sends a dated claude id verbatim in that same window — both branches read the one env var`                                                                             |
| **Assertion**       | `resolve(PINNED_CLAUDE_ID) === PINNED_CLAUDE_ID`                                        | _unchanged_                                                                                                                                                             |
| **Claim around it** | swapping the pinned id for an alias buys nothing                                        | still true, and now for a _reason_: `:43` and `:57` read the same variable, which is why one fix reaches the judge id, the lane alias and the chat `'default'` together |

Each carries a comment recording its old name, that it was TASK_2026_250
characterization, and why TASK_2026_262 changed the framing. The block docblock
was amended in the same terms. Nothing was deleted.

### The new case, which is where the behaviour change is pinned

`resolves the chat path default to a catalogue id once the tiers are applied`
wires the real collaborator in: one `AuthEnv` object shared by
`ProviderModelsService` and `ModelResolver`, exactly as `di/register.ts:37-40`
binds it. It asserts `resolve('default') === 'opus'` before, then
`=== 'anthropic/claude-opus-4.5'` after `applyPersistedTiers('openrouter')`, and
that the pinned judge id resolves to the catalogue's haiku in the same breath.
Without the shared-object property the whole approach fails silently and no unit
test of either class alone would notice; this is the test that would notice.

### The three cases that had to keep passing, and did

`names exactly the registry entries the docs say are exposed` — **passes
unchanged**; no registry entry gained `defaultTiers`, so the "3 of 11" figure is
still true and Task 4.1 must not "fix" it. `resolves the alias through
defaultTiers when the provider declares them` — **passes unchanged**, and it is
now half of the 1.3 precedence contract. `does NOT resolve a dated claude id
through defaultTiers` — **passes unchanged and untouched**, per Q3 below.

---

## Task 1.6 — warn disposition and the `claude-*` asymmetry

### The warn: STAYS, at exactly its current width, with the docblock corrected

The sentence "Closing that needs the provider's LIVE model list, which is not
this function's to fetch" was half-true and is now half-historical: it is still
not _this function's_ to fetch, but it is now somebody's, and that somebody
writes into the very env vars both branches read. The docblock says so, and adds
the consequence — reaching the warn now means the catalogue has not landed yet
or could not be fetched at all, a transient or broken state rather than a
permanent shape. The message gained the same information: "Its model catalog has
not been fetched yet, or could not be fetched — check the provider is reachable,
or select an explicit model for it."

I considered narrowing it and rejected that. The warn is now the **only** signal
for exactly the cases 1.4's residual hole describes — a message sent inside the
refresh window, a local server that was offline at activation. Narrowing it
would suppress the one measurement Q2 and Batch 3 need in order to be decided on
evidence. Removing it would be worse for the same reason. Its guards are already
correct: direct Anthropic and `claude-cli` stay silent, an unrecognised real
model id is still never warned about. No executable change.

### Q3: the `claude-*` asymmetry is LEFT, and the argument is now stronger

`resolve`'s `claude-*` branch consults only the tier env var, never
`defaultTiers`. `followup-a-report.md:278-282` left it as characterization
because the env var is populated on every third-party activation path, making
the gap unreachable. Batch 1 does not weaken that argument — it strengthens it.
The env var is now populated from _more_ sources than before, so the branch
resolves in strictly more situations than it did. And the change would still buy
nothing where it appears to matter: the only case in which the env var is empty
_and_ `defaultTiers` could help is a provider that declares `defaultTiers` but
never ran `applyPersistedTiers` — and for the three providers this carrier is
about, `defaultTiers` is empty by definition, so consulting it closes exactly
zero of them. It remains machinery for an unreachable case (YAGNI), and it stays
pinned as characterization so removing it later is a deliberate act. `does NOT
resolve a dated claude id through defaultTiers` was not altered.

---

## Task 1.7 — design Q2 recommendation: error vs verbatim send

**Recommendation: NO. Do not give an unresolvable tier a failure channel.**
Batch 3 should be marked ❌ CANCELLED against this scope and, if the budget is
spent at all, re-pointed at residual-hole item 3 above. This is a
recommendation, not a preference, and here is what it rests on.

### The asymmetry, stated

Background lanes have `auth-unresolvable`; the chat path has nothing. That
asymmetry is real, and before Batch 1 it was the argument for closing it: the
chat path's failure was permanent, silent and universal for three providers. It
is now none of those three. The condition an error channel would report has
gone from a steady state to a timing window.

### What the user sees today vs under the proposal

Today: the provider returns a 404 whose body says, in OpenRouter's and
Requesty's own words, that the model was not found — legible but unbranded, and
Ptah's log carries the one-time warn that names the provider and says what to
do. Under the proposal: a Ptah-branded, actionable "select a model for this
provider". That is better. It is not several-days-of-cross-cutting-work better,
and it is not worth what it costs below.

### Blast radius — which callers would need a channel they do not have

`ModelResolver.resolve` returns `string` and is reached through
`IModelResolver` from five synchronous call sites. Three of them are
**session-history reads** (`session-history-reader.service.ts:499,589,725`).
Giving `resolve` a failure mode makes a _past_ session unreadable because the
_present_ provider has no catalogue. That is strictly worse than sending a
string the endpoint rejects, and it is not a cost that can be engineered away —
it is inherent in putting a failure on a shared resolver.

Of the four callers in `context.md:44-60`: the chat path has a user-facing error
channel and could surface one; the OpenRouter passthrough has none and its 404
_is_ the error; the profile resolver's ladder ends in `model` with no failure
route; and `resolveJudgeModel` returns `string` to an enhancer that calls it
directly.

**On `followup-a-report.md:170` — I agree, with one qualification.** Its three
reasons for refusing `resolveJudgeModel` a failure channel were: it needs the
registry inside `skill-synthesis`; the enhancer calls it directly with no
failure path; and stalling would halt all background learning for OpenRouter
users. The first two stand unchanged and are structural. The **third is now
weaker** — after Batch 1 the judge id resolves in the ordinary case, so a stall
would be rare rather than universal, and "halts all background learning" is no
longer accurate. But weakening the least structural of three reasons does not
overturn the conclusion; it just means the objection now rests on the two that
were always the stronger ones. The verdict holds.

### Is the residual hole large enough to need this?

No, and that is the deciding point. Item 1 is a sub-round-trip window at
activation. Item 2 is narrow enough that the surrounding activation usually
fails loudly first. Item 3 is closable in a few lines with no new channel. Item
4 is Batch 2's, and is a _missing wiring_, not a missing error type — an error
channel would report it rather than fix it, which is the wrong trade for a
defect that has a real fix one batch away.

Building an error channel now would be sizing machinery for a permanent
condition, one batch after the change that stopped it being permanent — the
exact YAGNI failure the standing constraints warn about.

### The cost of saying no, stated plainly

A user who sends a message inside the refresh window, or whose LM Studio
`/v1/models` is unreachable while its inference endpoint is up, gets a raw
provider 404 rather than an actionable message. Ptah's own log carries the warn,
so support can diagnose it in one line; **the user cannot self-diagnose without
opening the log.** If that is judged unacceptable, the proportionate answer is
to surface the existing warn where the user already is — the message still
sends, and the explanation sits next to the 404 — not to add a failure channel
through four callers and a synchronous history-read path.

---

## Mutation tests — exact before/after counts

Baseline before the change: `Test Suites: 30 passed, 30 total | Tests: 546
passed, 546 total`. After: **`31 passed, 31 total | 571 passed, 571 total`**
(+1 suite, +25 tests). Every mutation below was applied to a green tree, run
against the full `auth-providers` suite, and reverted.

| #   | Mutation                                               | Result                        | First failure                                                                 |
| --- | ------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------- |
| M1  | nominal pass takes `.at(0)` instead of `.at(-1)`       | **2 failed**, 569 passed, 571 | `takes each tier from the model that names that tier`                         |
| M2  | tool-use filter no longer falls back to the whole list | **6 failed**, 565 passed, 571 | `still produces a mapping even though every entry reports no tool use`        |
| M3  | no-ordering-signal branch removed (always spread)      | **2 failed**, 569 passed, 571 | `maps every tier to one id rather than inventing a spread from the alphabet`  |
| M4  | `derivedFor` returns `undefined` (third link severed)  | **6 failed**, 565 passed, 571 | `resolves the chat path default to a catalogue id once the tiers are applied` |
| M5  | precedence inverted to derived-first                   | **2 failed**, 569 passed, 571 | `lets a user pick outrank the live catalogue`                                 |
| M6  | out-of-band refresh never scheduled                    | **2 failed**, 569 passed, 571 | `recovers from a cold cache: nothing persisted, then the refresh lands`       |
| M7  | `await Promise.resolve()` yield removed                | **2 failed**, 569 passed, 571 | `recovers from a cold cache: nothing persisted, then the refresh lands`       |
| M8  | `applyTierMetadata` back to `modelCache`-only          | **1 failed**, 570 passed, 571 | `labels a live-derived tier from the same catalogue it was derived from`      |

Every behaviour change has at least one spec that fails without it. M7 is the
one worth noting: without it the LM Studio path silently degrades to "no tiers",
and only the fetcher-registered-after-the-switch spec catches it.

The two rewritten characterization cases are **regression guards, not
mutation-proved**, and are named as such — they pass before and after by design,
because their assertions describe behaviour this batch deliberately did not
change (see 1.5).

---

## Gate

`npx nx run-many -t test lint typecheck -p auth-providers shared rpc-handlers skill-synthesis`
— **all 12 targets succeeded.** Real numbers:

```
shared            Test Suites: 32 passed, 32 total   | Tests: 762 passed, 762 total
auth-providers    Test Suites: 31 passed, 31 total   | Tests: 571 passed, 571 total
rpc-handlers      Test Suites: 78 passed, 78 total   | Tests: 31 skipped, 2116 passed, 2147 total
skill-synthesis   Test Suites: 6 skipped, 62 passed, 62 of 68 | Tests: 37 skipped, 1256 passed, 1293 total

lint  auth-providers   ✖ 2 problems (0 errors, 2 warnings)
lint  skill-synthesis  ✖ 30 problems (0 errors, 30 warnings)
lint  rpc-handlers     ✖ 9 problems (0 errors, 9 warnings)
lint  shared           (clean)
typecheck              (clean, all four)
```

`auth-providers` holds at the TASK_2026_250 baseline of 2, and they are the same
two `no-non-null-assertion` warnings in the same two files
(`translation/responses-stream-translator.ts:312`,
`translation/translation-proxy-base.ts:107`) — neither a file I touched.
`skill-synthesis` holds at 30. `rpc-handlers` had no stated baseline; its 9 are
pre-existing unused-var / empty-function warnings and I changed nothing in that
project. **No new warning in any touched file.** Prettier run over all eight.

---

## Batch 1 verification checklist

| Item                                                                                              | Status                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openrouter`, nothing selected, populated catalogue → `'default'` resolves to a real catalogue id | ✅ end-to-end spec in `model-resolver.spec.ts`                                                                                                                            |
| Same for `lm-studio`                                                                              | ✅ cold-cache spec — the two-model local catalogue resolves all three tiers                                                                                               |
| Same for `requesty`                                                                               | ✅ by construction — it takes the identical `modelsEndpoint` route as `openrouter` and the derivation contains no provider branch; the router-shaped fixture is its shape |
| Precedence: user tier > `defaultTiers` > live-derived                                             | ✅ two specs, M5-proved                                                                                                                                                   |
| Cold cache and offline fetcher: defined, non-throwing outcomes                                    | ✅ two specs, M6/M7-proved                                                                                                                                                |
| Characterization pair rewritten, not deleted; other five still pass                               | ✅ — and R3's green-to-red prediction is refuted, loudly                                                                                                                  |
| Gate green; mutation counts reported                                                              | ✅ 8 mutations, all caught                                                                                                                                                |
| Q1 answered, Q3 answered, warn disposition stated, Q2 recommendation carried                      | ✅                                                                                                                                                                        |
