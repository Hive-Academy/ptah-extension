# TASK_2026_262 — Batch 2 report

**Headline**: the per-workspace profile path now resolves tiers from the live
catalogue (2.1), and a **fourth caller nobody had counted** — the background
lane's own auth env — turned out to be broken in exactly the same way and is
fixed here too. **Assumption 6 is right about `skill-synthesis` and wrong about
why**: the library needed zero production change, but not because Batch 1
reached it. Batch 1's write is _deliberately deleted_ on the lane path by
`buildLaneEnv`, so a third copy of the tier chain had to grow the third link
independently. That is the loudest thing in this report.

`rpc-handlers`: **no change**, and there is now a spec that runs the chat path's
own literal through to the id the OpenRouter proxy would put on the wire.

Nothing committed, nothing staged. `.ptah/specs/TASK_2026_242/` and
`TASK_2026_257/` untouched. A concurrent session has files in the tree; none of
them were read, edited, or staged.

---

## Files changed

| File                                                                                                                       | What                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/provider-models.service.ts`                                | new public `getLiveDerivedTiers(providerId)` — the derivation + catalogue-read composition, extracted so all three writers share it |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`               | **2.1** — third precedence link in `applyProviderTiers`; ladder narrowed by one provably-dead rung                                  |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts`          | **NEW** — 10 cases; this class had no spec file at all                                                                              |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts`                            | **the unplanned fix** — third precedence link in `buildTierValues` (the lane / curator override env)                                |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.spec.ts`                       | +5 cases, harness extended with a `derivedTiers` seam                                                                               |
| `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.spec.ts` | **NEW** — 4 cases, incl. the 2.3 end-to-end; this proxy had no spec file                                                            |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.ts`                                        | **docblock only** — boundary section corrected                                                                                      |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/model-resolver.spec.ts`                                   | +3 cases — the shape contract that makes "no production change" true                                                                |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`                           | **docblock only** — line-2 / line-3 bullets corrected                                                                               |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.spec.ts`                      | +1 case, +1 comment corrected                                                                                                       |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/CLAUDE.md`                                                        | two bullets corrected                                                                                                               |

No registry entry changed. No model id invented. No provider id added to any
executable body in `skill-synthesis`. `skill-synthesis` still has zero direct
SDK imports and gained no new dependency, test-only or otherwise.

---

## Task 2.1 — the per-workspace profile resolver

### The reuse, and where it was put

`workspace-provider-profile-resolver.ts:334-345` held its own
`persisted ?? defaults` chain. It now reads
`persisted ?? defaults ?? derivedFor(tier)` (`:400-406`), consulted **lazily**
— `derived ??= this.providerModels.getLiveDerivedTiers(providerId)` — so a
provider whose static data covers all three tiers never touches a catalogue.
Proved by the lane-side twin case (`never reaches for a catalogue when the
static data already covers every tier`).

Batch 1 left `deriveTiersFromCatalog` exported so this task could reuse it. I
went one step further and did **not** call it directly. Two things have to agree
between the three writers, not one: the _rule_ (which id is opus) and the
_source_ (in-memory cache → persisted catalogue, and **never** `staticModels`).
Importing only the rule would have left each writer choosing its own source, and
a disagreement there is invisible — the profile path would derive from
`staticModels` while the chat path derived from the live list, and both would
look correct in isolation. So the composition is now one public method,
`ProviderModelsService.getLiveDerivedTiers` (`provider-models.service.ts:640-671`),
and `applyPersistedTiers` was refactored onto it too (`:712`). It is pure with
respect to globals — a synchronous read plus arithmetic — which is what makes it
safe for the two snapshot callers whose entire reason to exist is that they do
not disturb the live session.

### The refresh: **not here**, and the argument

The shape difference the brief flagged is real and decided against an
out-of-band refresh on this path. Three reasons, compounding:

1. **The only refresh that exists mutates globals.**
   `refreshTiersFromLiveCatalog` ends by calling `applyPersistedTiers`, which
   writes `this.authEnv` and `process.env`. Calling it from here would let a
   per-workspace profile repoint the process-global env — for a provider very
   likely _not_ the globally active one. That is precisely the cross-workspace
   contamination this class was written to prevent, and it would be a worse
   defect than the one being fixed. (A catalogue-only warm variant, with no tier
   application, would be global-safe — see below for why I did not build one.)
2. **It could not help the session being built.** The snapshot is constructed
   synchronously and handed straight to `startChatSession({ providerProfile })`.
   A catalogue landing a round trip later cannot retro-fill an object already
   passed on. `followup`-style late writes work on the chat path only because
   `authEnv` is one shared object; a snapshot is by definition not.
3. **The warm is inherited, so there is nothing to build.** Reaching any of the
   three tier-writing call sites requires stored credentials for that provider
   (`getProviderKey`, or `proxyPool.acquire`'s own credential check). Storing
   them ran a strategy `configure` → `switchActiveProvider` →
   `applyPersistedTiers`, which fired Batch 1's refresh and persisted the
   catalogue to `provider.<id>.modelCatalog`. By the time a workspace can pin a
   provider, the synchronous read normally finds a catalogue already there.

A catalogue-only warm would therefore be new machinery for a case already
covered by an earlier activation — the YAGNI the standing constraints name. The
residual is Batch 1's, unchanged and not enlarged: if that earlier fetch failed
(offline at configure time), this snapshot derives nothing and the ladder takes
over. Retried on the next activation, never on a timer.

### The ladder at `:353-369`: it NARROWS

Decision: **narrows by exactly one rung, and the rest stays as a backstop.**

- `provider?.defaultTiers?.opus` — **removed.** It was unreachable, before this
  change and after it, and the deadness is _structural_ rather than contingent.
  Every call site that passes a defined `provider` to `resolveModel` runs
  `applyProviderTiers` with that same `provider` first
  (`:239`, `:265`, `:309`); the two direct-Anthropic builders pass `undefined`.
  `applyProviderTiers` writes `persisted ?? defaults ?? derived` into the
  snapshot, so the three snapshot rungs above are all falsy **only when
  `defaults.opus` is falsy too**. A rung that can fire only when its own value
  is empty is not a backstop; it is a misleading one, because it implies the
  snapshot might not already include `defaultTiers` — the single conclusion a
  reader must not draw here.
- `provider?.staticModels?.[0]?.id` — **stays.** Not subsumed: the derivation
  reads the LIVE catalogue and deliberately refuses `staticModels`, and
  `applyProviderTiers` never reads them either. An entry with static models, no
  `defaultTiers` and no fetched catalogue reaches this rung with nothing above
  it having fired. No registry entry is shaped that way today — the only two
  with `staticModels` (`moonshot`, `z-ai`) also declare `defaultTiers`, and
  `customEntryToAnthropicProvider` never sets `staticModels` on a user-defined
  entry — but that is a fact about _data_, which the next entry can change,
  where the removed rung is dead whatever the registry contains. **Delete what
  cannot fire; keep what merely does not.**
- `model` — **stays** as terminal. Sending the tier word verbatim is the
  residual Q2 declined to convert into a failure channel: this method has no
  error route, and a profile that refused to build would take the workspace's
  chat down rather than let the endpoint say what is wrong.

### Acceptance

`resolves a workspace pinned to a no-defaultTiers provider to a real catalogue
id` — `requesty` (no `defaultTiers`, `requiresProxy: false`), nothing selected,
a persisted catalogue → `profile.model === 'anthropic/claude-opus-4.5'`. Plus
the proxy branch (`openrouter`), both precedence rungs, the no-global-write
guarantee, and the two untouched global-auth fallbacks. The suite drives the
**real** `ProviderModelsService`, `ModelResolver` and `ActiveProviderResolver`,
because every link that matters is a link _between_ those objects; a suite that
stubbed `getLiveDerivedTiers` would assert that this file calls a function
rather than that a workspace ends up on a servable model.

---

## Task 2.2 — skill-synthesis

### Production change in `skill-synthesis`: **NONE.** Assumption 6's conclusion holds.

### But Assumption 2 was incomplete, and this is the loud part

Assumption 2 says a third link on `applyPersistedTiers` closes "the chat path,
the lane alias path and the pinned-id path" because `resolve()` reads the env
var first on both branches. That is true **only for callers reading the ambient
env**. Traced rather than assumed:

- `resolveLaneModel` **line 2** (no lane provider) → `IProviderAuthResolver`
  returns `null` for a blank id → `input.auth` is undefined →
  `SdkQueryRunner.buildOneShotOptions` resolves against `this.authEnv`
  (`sdk-query-runner.service.ts:283,292-295`). **Batch 1 covers this.** Same for
  a lane pinned to the provider that is already active — `ProviderAuthResolver.resolve`
  returns `null` at `:106-108`.
- `resolveLaneModel` **line 3** (a lane provider is set, and it is not the
  active one) → the lane gets an override env from `buildLaneEnv`, which
  **blanks every `ALL_TIER_ENV_KEYS` entry out of the ambient env by design**
  (`provider-auth-resolver.ts:58-63,350-356`), then layers
  `buildTierValues(providerId, 'lane')` on top. `buildTierValues` was a **third
  copy** of `persisted ?? defaults` with no live link. So Batch 1's write
  arrived on this path only to be deleted, and a lane pinned to `openrouter`,
  `lm-studio` or `requesty` had no tier mapping at all — the bare alias reached
  the endpoint verbatim.

**That is not a corner; it is the case lanes exist for.** A user on direct
Anthropic who points the judge lane at OpenRouter to keep background work off
their paid quota hits it every time. `context.md:56-57` lists "skill-synthesis
lanes" as a caller, and `tasks.md` Assumption 5 found the _second_ copy of the
chain but not the third.

**Fixed** at `provider-auth-resolver.ts:319-329`: the same third link, the same
precedence, the same shared `getLiveDerivedTiers`. It stays in `auth-providers`,
one layer below, which is why `skill-synthesis` still needed nothing — same
shape as Batch 1's fix, for the same reason.

Two properties preserved deliberately: the derivation is asked for the
**resolved** provider, never the active one (a leak there would give an
LM-Studio lane OpenRouter's ids — pinned, M15), and the write is snapshot-only,
so `does not mutate process.env while resolving a lane` still passes untouched.

### The spec that proves the no-change claim

The proof is in two halves in two libraries, on purpose:

- **In `skill-synthesis`** (`model-resolver.spec.ts`, `lane-resolver.service.spec.ts`):
  the _shape_ of the values this library hands downstream — the property the
  remap depends on and which nothing had ever asserted.
  `JUDGE_DEFAULT_MODEL_ID` must be `claude-`-prefixed and must name exactly one
  tier word (that is what `detectTierFromClaudeId` needs), for **every** entry
  in `ANTHROPIC_PROVIDERS`, generated from the registry; and every lane's
  `defaultTier` must be one of the three env-mapped tier words. Mutation-proved
  (M18, M19).
- **In `auth-providers`**: that those shapes resolve. The ambient half is Batch
  1's `resolves the chat path default to a catalogue id once the tiers are
applied`, which already asserts the pinned judge id itself
  (`model-resolver.spec.ts:403-405`). The lane half is the new
  `live-catalogue tiers for a lane` block.

**Deliberately not joined into one spec.** Importing `auth-providers` from
`skill-synthesis` is permitted by the tag rules (both `scope:extension` /
`type:feature`) and would make a prettier test — but this library keeps
`IInternalQuery`, `LaneAuthOverride` and `ILaneAuthResolver` as local structural
mirrors specifically to avoid that edge, and a test-only import is still an edge
in `nx graph`. Stated in both spec docblocks so the split reads as a choice.

### Docblocks corrected

- `skill-synthesis/src/lib/model-resolver.ts` — the boundary section. It said
  the pinned id "reaches the endpoint verbatim" on three named providers and
  that closing it "needs the provider's LIVE model list". Now: that is
  implemented, one layer down, in both the ambient and the lane chain; the
  boundary is no longer _which provider_ but _whether that provider's catalogue
  has landed_. The closing paragraph's "one stated boundary" is replaced with
  the distinction that matters — no provider-shaped boundary remains, a timing
  boundary does. Kept: why a tier alias buys nothing (now with the reason —
  `:43` and `:57` read one variable), and that Decision 1 was never what held
  the gap open.
- `lanes/lane-resolver.service.ts` — line-2 and line-3 bullets. Line 2's
  "except on the three registry entries" is now "except while that provider's
  catalogue has not landed". Line 3 said the alias resolves "through the
  provider entry's `defaultTiers`", which was never the whole truth and is now
  actively wrong: it resolves through the lane env's own tier var, which
  `buildTierValues` rebuilds on the three-link chain. Both bullets now say the
  two branches share **one** boundary rather than line 2 having a weakness line
  3 lacks.
- `skill-synthesis/CLAUDE.md` — the "Lane resolution is three lines" bullet and
  the "Inherit keeps a PINNED default" bullet. The second keeps **3 of 11**
  verbatim and says explicitly that no registry entry changed and that what
  moved is the fallback _below_ `defaultTiers`.
- One in-spec comment at `lane-resolver.service.spec.ts:161` that repeated the
  same wrong claim.

`lane-resolver.providers.spec.ts`'s registry-coverage scan **passes unchanged**
(125 tests in that file's suite pair, all green). No provider id was added to
any executable body — the corrections are all docblocks and comments, which
`Function.prototype.toString` does not see.

---

## Task 2.3 — passthrough and chat substitution

### Production change: **NONE**, in either file.

`normalizeModelId` is the identity function
(`openrouter-translation-proxy.ts:80-82`), applied once at
`translation-proxy-base.ts:266` with nothing downstream touching the id. That is
the contract, not a defect: OpenRouter expects full provider-prefixed ids and
this proxy has no catalogue of its own, so a mapping invented here would be
exactly the wrong-but-servable model R2 exists to prevent. It also means an
unresolved tier cannot be caught late — which is _why_ the fix had to be
upstream, and is now stated in the spec rather than in a report nobody rereads.

`chat-session.service.ts:418` and `:1009` both read
`options?.model || selectedModel.get() || 'default'`. `'default'` is now a
resolvable value on all eleven entries, so the substitution sites are correct as
written. Changing them would mean teaching the RPC layer about tiers, which is
the coupling `ModelResolver` exists to hold.

### The end-to-end spec

`openrouter-translation-proxy.spec.ts` (new file — this proxy had none) runs the
chat literal through the whole pipe: `'default'` → real `ProviderModelsService`
with a persisted OpenRouter catalogue → real `ModelResolver` on the shared
`AuthEnv` the proxy strategy leaves → real `normalizeModelId` →
`'anthropic/claude-opus-4.5'`, asserted to be a member of the fixture catalogue.
The companion case pins the residual: with no catalogue ever fetched, the same
pipe yields `'opus'`.

**One seam, declared.** The spec restates `'default'` as a literal rather than
importing `ChatSessionService`. `rpc-handlers` depends on `auth-providers`, so
importing it back inverts the graph; and instantiating `ChatSessionService` to
assert a two-`||` default would need a harness heavier than the assertion —
`chat-session-auth.spec.ts` says in its own docblock that it only exercises
early-return paths for that reason. The two sites are cited by line in the spec
docblock so the restatement is checkable in one grep. I judged a heavyweight
harness disproportionate and am naming that rather than implying full coverage.

**Assumption 2 is NOT incomplete for `rpc-handlers`** — Batch 1 covered the chat
path completely, and this spec is the proof, not a patch.

---

## Mutation tests — exact before/after counts

Baseline entering Batch 2: `auth-providers` 31 suites / 571 tests;
`skill-synthesis` 62 of 68 suites / 1256 passed. After: **`auth-providers` 33
suites / 590 tests** (+2 suites, +19 tests), **`skill-synthesis` 62 of 68 /
1260 passed** (+4 tests). Every mutation was applied to a green tree, run, and
reverted; `git diff` is clean of all of them.

| #   | Mutation                                                                        | Result                         | First failure                                                                                  |
| --- | ------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| M9  | profile resolver: third link severed                                            | **3 failed**, 587 passed, 590  | `resolves a workspace pinned to a no-defaultTiers provider to a real catalogue id`             |
| M10 | profile resolver: precedence inverted to derived-first                          | **2 failed**, 588 passed, 590  | `lets a user tier outrank the catalogue, tier by tier`                                         |
| M11 | profile resolver: `defaults` severed from the chain                             | **2 failed**, 588 passed, 590  | `carries a registry defaultTiers value through the SNAPSHOT, not through the ladder`           |
| M12 | ladder: removed rung re-added as a loud sentinel                                | **0 failed**, 590 passed, 590  | — _see note_                                                                                   |
| M13 | `buildTierValues`: third link severed (lane path)                               | **2 failed**, 588 passed, 590  | `gives a lane on a no-defaultTiers provider a tier mapping from that provider's own catalogue` |
| M14 | `buildTierValues`: precedence inverted to derived-first                         | **2 failed**, 588 passed, 590  | `lets the lane-scoped user override outrank the catalogue…`                                    |
| M15 | `buildTierValues`: derives from the ACTIVE provider instead of the resolved one | **2 failed**, 588 passed, 590  | `derives from the RESOLVED provider, never the active chat one`                                |
| M16 | `normalizeModelId` stops being the identity (`.split('/').pop()`)               | **2 failed**, 588 passed, 590  | `passes a provider-prefixed id through untouched`                                              |
| M17 | `getLiveDerivedTiers` returns `{}` (shared accessor severed)                    | **10 failed**, 580 passed, 590 | 4 suites — incl. Batch 1's chat-path case, proving the extraction did not orphan it            |
| M18 | `JUDGE_DEFAULT_MODEL_ID` → `'gpt-5-mini'`                                       | **3 failed**, 147 passed, 150  | `ships a claude-prefixed id, which is what makes the tier remap reachable`                     |
| M19 | one lane's `defaultTier` → `'fast'`                                             | **1 failed**, 124 passed, 125  | `ships a tier word on every lane — the shape the downstream remap needs`                       |

**M12 is reported as a zero deliberately, and it is honest rather than a gap.**
Re-adding the removed ladder rung as `'SENTINEL-RUNG-FIRED'` changes nothing,
because no test can arm it — arming it needs all three snapshot tier vars empty
_and_ `defaults.opus` truthy, which `applyProviderTiers` makes contradictory. I
tried to force it (sever `defaults?.opus` from `applyProviderTiers` with the
sentinel in place): the ladder's _sonnet_ rung fires first, because `defaults`
still supplies sonnet. **The rung's deadness is structural, proved by argument
and by M11, not by a mutation** — M11 shows the snapshot is what carries a
`defaultTiers` value, which is the whole content of the claim. Saying so plainly
because a table row reading "0 failed" with no explanation is how a removal
sneaks through.

M17 is the one worth a second look: it fails Batch 1's own end-to-end case as
well as both of Batch 2's, which is the evidence that refactoring
`applyPersistedTiers` onto the shared accessor kept it wired rather than
quietly duplicating it.

---

## Gate

`npx nx run-many -t test lint typecheck -p auth-providers shared rpc-handlers skill-synthesis`
— **all 12 targets succeeded.** Real numbers:

```
shared            Test Suites: 32 passed, 32 total  | Tests: 762 passed, 762 total
auth-providers    Test Suites: 33 passed, 33 total  | Tests: 590 passed, 590 total
rpc-handlers      Test Suites: 78 passed, 78 total  | Tests: 31 skipped, 2116 passed, 2147 total
skill-synthesis   Test Suites: 6 skipped, 62 passed, 62 of 68 | Tests: 37 skipped, 1260 passed, 1297 total

lint  auth-providers   ✖ 2 problems (0 errors, 2 warnings)
lint  skill-synthesis  ✖ 30 problems (0 errors, 30 warnings)
lint  rpc-handlers     ✖ 9 problems (0 errors, 9 warnings)
lint  shared           (clean)
typecheck              (clean, all four)
```

Every count is at or above the Batch 1 baseline, and every warning count is
**identical** to it. `auth-providers`' 2 are the same two
`no-non-null-assertion` warnings in `translation/responses-stream-translator.ts:312`
and `translation/translation-proxy-base.ts:107` — neither a file I touched.
`skill-synthesis` holds at 30, `rpc-handlers` at 9 (untouched project).
**No new warning in any touched file.** Prettier run over all eleven.

---

## Batch 2 verification checklist

| Item                                                               | Status                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| All four `context.md:44-60` callers resolve to a real catalogue id | ✅ chat (Batch 1) · profile resolver (2.1) · lanes — **via a fix Batch 1 did not make**, see 2.2 · passthrough (2.3, end-to-end spec) |
| No provider-id literal in any `skill-synthesis` executable body    | ✅ docblocks and comments only; `lane-resolver.providers.spec.ts` green                                                               |
| `skill-synthesis` still has zero direct SDK imports                | ✅ and zero new deps of any kind, test-only included                                                                                  |
| Gate green, including `rpc-handlers`                               | ✅ 12/12 targets, warning counts unchanged                                                                                            |
| Mutation counts reported for every behaviour change                | ✅ 11 mutations; M12 reported as a zero with its reason                                                                               |

---

## Found and not fixed

1. **`autoResolveDefaultTiers` still writes into the user-choice slot.** Batch 1
   flagged it (`provider-models.service.ts:517`, persists a heuristic via
   `setModelTier`, i.e. above `defaultTiers` in the precedence chain). Batch 2
   did not touch it — it is a behaviour change with its own spec set and no
   bearing on either of this batch's paths. Batch 1's recommendation to delete
   it in favour of the read-time rule still stands and is now stronger, since
   the read-time rule covers three writers rather than one.
2. **`buildTierValues`' "no haiku tier" warn is now noisier than it needs to
   be** relative to what it describes. Its message says downstream "will
   substitute ANOTHER provider default or send the bare alias", which after this
   change is reached only when the resolved provider has no catalogue either.
   Left exactly as-is for the same reason `ModelResolver`'s warn was: it is now
   one of the two signals for the residual timing window, and narrowing it would
   hide the measurement Batch 3 would need. Worth revisiting only once the
   window is closed.
3. **The chat-session substitution literal is verified by reading, not by a
   test.** See 2.3 — a `ChatSessionService` harness was judged disproportionate
   to a two-`||` default. If the team disagrees, the cheapest fix is a
   source-scan guard on those two lines, not a harness.
4. **Residual-hole item 3 from Batch 1 is untouched and still the cheapest
   remaining gap** — `provider:listModels` warms both catalogue caches but never
   re-runs `applyPersistedTiers`. Batch 1 recommended it as Batch 3's scope, and
   Batch 2 found nothing that changes that assessment. Note that after 2.2 it
   would also want the lane/profile paths considered, though both of those read
   the catalogue at snapshot-build time and so pick up a warmed cache for free —
   only the global env needs the explicit re-apply.
