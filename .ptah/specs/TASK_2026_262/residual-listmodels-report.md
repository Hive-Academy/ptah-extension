# TASK_2026_262 — residual item: `provider:listModels` never re-applied tiers

Closed **after** Batch 3's cancellation, not by it. Batch 3 cancelled its
error-channel scope (Tasks 3.1 and 3.2); this item was bundled into that batch
but is not part of what was cancelled. The go/no-go record says so itself — its
closing paragraph names this as "the higher-value re-point" if budget is spent
here at all.

---

## 1. The trace: where the re-apply belongs

### 1.1 What actually creates the gap

`applyPersistedTiers` derives from whatever catalogue is on hand **at the moment
it runs**, and its single production trigger is `switchActiveProvider`, i.e.
provider activation. Its write is a one-shot mutation of the process-global
`authEnv` + `process.env`.

`fetchModels` — which is the entire body of `provider:listModels` — warms both
catalogue sources that `readLiveCatalog` reads (`modelCache.set` at
`provider-models.service.ts:247` and `:411`; `persistCatalog` at `:248` and
`:287`) and writes **no tier env var of its own**. So the picker manufactures
exactly the input the derivation wants and nothing tells the derivation it
exists. Before this change that state cleared only on the next activation — an
auth flow the user has no reason to re-enter.

### 1.2 `fetchModels` has exactly two production callers

Verified by search across the repo, excluding specs:

| Caller                                                                    | Already re-applies?                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `refreshTiersFromLiveCatalog` (`provider-models.service.ts:793`)          | **Yes** — `:796` is `this.applyPersistedTiers(providerId, { apiKey })` |
| `ProviderRpcHandlers.registerListModels` (`provider-rpc.handlers.ts:475`) | No — the gap                                                           |

**This is what decided the placement.** Hooking the re-apply inside
`fetchModels` would fire on both, and on the internal path it would double-apply
for zero gain (the refresh applies again the moment it returns). Hooking it at
the one caller that does not re-apply is the whole of the change.

The counter-consideration was `auth-providers/CLAUDE.md`'s standing warning: _"If
you add a fifth site, wire the derivation into it"_. That warning is about tier
**writers** — sites that own a copy of the precedence chain. This is not one.
The guards, the precedence chain, the derivation and the env write all stay in
`ProviderModelsService`; the handler reports an event and decides nothing. The
writer count is still four (three writers, one reader), and
`getLiveDerivedTiers` is still the one accessor.

### 1.3 The gap is real but narrower than "always" — stated because it changes what the fix buys

`fetchDynamicModels` (`:412`) already calls `autoResolveDefaultTiers` on the
`modelsEndpoint` route, which persists claude-named ids via `setModelTier`. So
for a router whose catalogue happens to carry `anthropic/claude-*`, the picker
**did** populate the tier env — through the path both earlier batches flagged as
a **precedence violation** (it writes into the user-choice slot, the top of the
chain, and it has no activeness guard).

Where the gap is fully live:

- **Any catalogue with no claude-named models.** `autoResolveDefaultTiers`'
  regexes are claude-only, so it writes nothing. This is the LM Studio case and
  the generic non-Anthropic-hosting router case.
- **The whole dynamic-fetcher route** (`:225-271`), which `autoResolveDefaultTiers`
  never reaches. `lm-studio` — no `modelsEndpoint`, no `staticModels`, i.e. the
  one provider with nowhere else to get a catalogue — travels only this route.
- **Warm-cache returns.** `fetchDynamicModels` early-returns on a cache hit
  (`:362-381`) before `autoResolveDefaultTiers`.

Where the two interact, they compose correctly: if `autoResolveDefaultTiers` has
already filled the env, guard 2 below short-circuits and the new path does
nothing. No conflict, and no dependency on that method's continued existence —
which matters, because both earlier batches recommend deleting it.

### 1.4 Did Batch 2's "only the global env" scoping hold? **Yes — verified, not taken**

The claim was that the lane and profile paths read the catalogue at
snapshot-build time and so pick up a warmed cache for free.

- `WorkspaceProviderProfileResolver.applyProviderTiers`
  (`workspace-provider-profile-resolver.ts:388-399`) — `derived ??= this.providerModels.getLiveDerivedTiers(providerId)`,
  evaluated lazily **while building the snapshot**, which is built per session.
- `ProviderAuthResolver.buildTierValues` (`provider-auth-resolver.ts:326-338`) —
  the identical lazy call, evaluated while building each lane's override env.

`getLiveDerivedTiers` → `readLiveCatalog` → `modelCache` then the persisted
catalogue. A picker fetch writes both. So the next snapshot or lane env built
after the warm derives from it with no explicit trigger. Writer #1 is the only
one whose write is a durable global mutated once, and therefore the only one
that needs re-running. **The scoping held; I did not widen.**

---

## 2. What changed

Two files. No new dependency, no new RPC method, no signature change to any
existing method.

### `libs/backend/auth-providers/src/lib/provider-models.service.ts`

New public method `reapplyTiersForWarmedCatalog(providerId: string): void`,
synchronous and total, with a docblock stating each guard's reason:

1. **Activeness** — returns unless `providerId === this.resolveActiveProviderId()`.
   `applyPersistedTiers` does not check activeness and writes process-global
   env; the picker is precisely where a user routinely inspects a provider they
   are not using. Without this, browsing LM Studio's models while OpenRouter is
   active repoints the OpenRouter session at ids OpenRouter cannot serve — a
   **silent wrong-model send**, strictly worse than the 404 this carrier exists
   to remove.
2. **Only fill a hole** — returns when every tier env var already has a value.
   Reported honestly in the spec and the docblock as a **cheap exit, not a
   safety property**: `applyPersistedTiers` is idempotent over a resolved
   configuration, so removing this guard wastes work rather than corrupting
   anything.
3. **Something new to derive from** — returns when `getLiveDerivedTiers` still
   yields `{}`. Without it, a picker open against a provider with no catalogue
   reaches `applyPersistedTiers`, finds the same hole, and schedules **another**
   out-of-band fetch — turning a UI action into a network round trip that cannot
   succeed where the one the user just triggered did not.

The body then delegates to `applyPersistedTiers`. Everything is wrapped in
`catch (error: unknown)` narrowed with `instanceof Error`, ending in a debug
line — the same fire-and-forget-with-logged-swallow idiom as
`persistCatalog` and `refreshTiersFromLiveCatalog`.

### `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`

Three lines in `registerListModels`, after the success log:

```ts
if (result.totalCount > 0) {
  this.providerModels.reapplyTiersForWarmedCatalog(providerId);
}
```

`totalCount` rather than `models.length` because the latter is already narrowed
by `toolUseOnly`. `providerId` is the **resolved** id, not `validated.providerId`
— an unresolved `undefined` would silently disable the activeness guard.

### Constraints, checked one by one

| Constraint                                                     | How it is met                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No new error channel, no new RPC namespace                     | Neither added. `ProviderRpcHandlers.METHODS` is unchanged; nothing in `libs/shared` or `vscode-core` was touched. The cancelled scope stays cancelled.                                        |
| Must not clobber an explicit user choice                       | Delegating to `applyPersistedTiers` keeps `userTiers ?? providerDefaults ?? liveDerived` intact; guard 2 means the pick is usually never reached at all. Pinned by a spec and by mutation M6. |
| A failed or slow path must never throw into a handler          | Total by construction — every path returns, the body is try/caught, the failure ends in a debug line. Pinned by mutation M5.                                                                  |
| Do not make `applyPersistedTiers`/`switchActiveProvider` async | Neither signature changed. The new method is synchronous too, so **no call site anywhere was touched**.                                                                                       |
| Do not privilege a provider; no id literals                    | No provider id appears in either production edit. Ids appear only in spec fixtures, as they already did.                                                                                      |
| `catch (error: unknown)` narrowed with `instanceof Error`      | Yes, in the one new catch.                                                                                                                                                                    |

---

## 3. The spec that fails without the change

`provider-models.service.spec.ts` → `ProviderModelsService.reapplyTiersForWarmedCatalog`,
six cases. The headline one is
**`fills the tiers a picker fetch made derivable, where activation could not`**,
built as the sequence a user actually meets rather than as a direct method call:

1. LM Studio is the active provider; its `/v1/models` is down at activation, so
   the activation-time refresh fetches nothing and every tier stays unset —
   asserted, because nothing retries on a timer by design;
2. the server comes up and the user opens the picker (`fetchModels`), warming
   the catalogue;
3. the tiers now resolve to catalogue ids.

Step 3 is impossible without this change. A dynamic fetcher stands in for the
HTTP call because `fetchModels` warms `modelCache` and persists identically on
both live routes and this needs no axios mock — the same technique the existing
`persisted model catalog` and `cold cache` specs already use.

Two rpc-handlers cases pin the seam: the trigger fires with the **resolved**
provider id, and does **not** fire when the provider returned no catalogue.

One helper change: `makeService` in the auth-providers spec now also returns its
`logger`, so guard 2 can be observed. Additive; no existing case altered.

---

## 4. Mutation testing — 9 mutants, exact counts

Baseline for both filtered runs: **auth-providers `provider-models.service.spec.ts`
55 passed / 55 total**; **rpc-handlers `provider-rpc.handlers.spec.ts` 30 passed
/ 30 total**. Each mutant applied alone and reverted before the next.

| #   | Mutation                                                             | Result                  | Test(s) that caught it                                                                                                                                                |
| --- | -------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `reapplyTiersForWarmedCatalog` body made a no-op                     | **2 failed, 53 passed** | `fills the tiers a picker fetch made derivable…`; `leaves a user pick alone…`                                                                                         |
| M2  | Activeness guard removed                                             | **1 failed, 54 passed** | `refuses to write for a provider that is not the active one`                                                                                                          |
| M3  | "Only fill a hole" guard removed                                     | **1 failed, 54 passed** | `declines silently when there is no hole to fill`                                                                                                                     |
| M4  | "Something new to derive from" guard removed                         | **1 failed, 54 passed** | `does not turn a picker open into a second round trip when nothing was warmed`                                                                                        |
| M5  | `catch` rethrows instead of swallowing                               | **1 failed, 54 passed** | `swallows its own failure rather than throwing into the RPC handler`                                                                                                  |
| M6  | Precedence flipped to `liveDerived ?? userTiers ?? providerDefaults` | **3 failed, 52 passed** | mine: `leaves a user pick alone…`; **plus Batch 1's** `lets a user pick outrank the live catalogue` and `lets a registry defaultTiers map outrank the live catalogue` |
| M7  | Handler trigger deleted                                              | **1 failed, 29 passed** | `tells the models service the catalog was warmed, with the RESOLVED provider id`                                                                                      |
| M8  | Handler passes `validated.providerId` instead of the resolved id     | **1 failed, 29 passed** | same case                                                                                                                                                             |
| M9  | Handler's `result.totalCount > 0` condition dropped                  | **1 failed, 29 passed** | `does not claim a warm when the provider returned no catalog at all`                                                                                                  |

Every mutant was caught; no zero-count mutation to report. **M6 is the one worth
reading twice**: it is a mutation of Batch 1's code, not mine, and it fails my
precedence case alongside Batch 1's two — which is the evidence that
`userTiers ?? providerDefaults ?? liveDerived` genuinely holds on this new
trigger rather than being asserted about it.

Note on M3: it catches the guard through the one debug line the method emits
when it acts. That is the guard's only observable, and the report says plainly
above that this guard is an efficiency exit rather than a safety property.

---

## 5. Gate — real numbers

`npx nx run-many -t test lint typecheck -p auth-providers rpc-handlers shared skill-synthesis --skip-nx-cache`
→ **Successfully ran targets test, lint, typecheck for 4 projects.** 12/12 green.

| Project         | Tests (this run)                   | Stated baseline | Delta                                      | Lint                      | Typecheck |
| --------------- | ---------------------------------- | --------------- | ------------------------------------------ | ------------------------- | --------- |
| auth-providers  | **596 passed / 596**               | 590             | **+6, all mine**                           | 0 errors, **2 warnings**  | clean     |
| shared          | **762 passed / 762**               | 762             | 0 — untouched                              | 0 errors, **0 warnings**  | clean     |
| skill-synthesis | **1268 passed**, 37 skipped / 1305 | 1260            | +8, **none mine** — see below              | 0 errors, **30 warnings** | clean     |
| rpc-handlers    | **2132 passed**, 31 skipped / 2163 | 2116            | +16: **+2 mine**, +14 not mine — see below | 0 errors, **9 warnings**  | clean     |

Warning counts match the stated baseline exactly (2 / 30 / clean / 9) and **0
lint errors everywhere**. No warning was added or removed.

### Two things to say plainly

**Concurrent sessions moved two of these counts.** `skill-synthesis` gained 8
tests and `rpc-handlers` gained 14 between the start of this session and the
final run, from other sessions' uncommitted work
(`libs/backend/rpc-handlers/src/lib/harness/harness-constants.spec.ts`, untracked;
additions to `harness-rpc.handlers.spec.ts`). I touched no file in
`skill-synthesis` and no harness file. My own contribution to the deltas is
exactly **+6 auth-providers, +2 rpc-handlers**.

**One transient failure, not mine, now gone.** An intermediate run had
`harness-constants.spec.ts › buildNewProjectSeedPrompt › stays vendor-neutral so
any adapter can serve it` failing. That file is another session's untracked
work against their own modified `harness-constants.ts`; it passes in the final
run, having been fixed at their end. Recorded so the intermediate red is not
mistaken for something this change caused.

An earlier intermediate run also showed two `provider-rpc.handlers.spec.ts`
failures — `this.providerModels.reapplyTiersForWarmedCatalog is not a function`
— caused by the baseline run overlapping my first edit before the spec's narrow
mock had gained the method. Both pass in the final run. Worth recording because
it demonstrates the seam is exercised by the pre-existing suite, not only by the
two cases I added.

**Nothing was committed.** No `git add`, no stash, no checkout. The working tree
retains every other session's changes untouched.

---

## 6. What survives of Batch 1's residual hole

| Item                                                                             | Status after this change                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. The refresh window** — `applyPersistedTiers` returns before the fetch lands | **Survives.** Unchanged in width: one HTTP round trip (10 s remote / 5 s local timeout), opening at activation while the user is still in the auth flow. Closing it needs either a synchronous fetch on a `string`-returning resolver, or the error channel argued and declined in Batch 3.                                                        |
| **2. Offline `/v1/models` behind a live inference endpoint**                     | **Survives, but is now narrower in practice.** Before, recovery waited for the next provider activation. Now opening the model picker — which is what a user does when the model list looks wrong — recovers it, provided the server has come back. Nothing still retries on a timer, by design. This is the case the headline spec is built from. |
| **3. A catalogue fetched by somebody else does not re-apply tiers**              | **Closed.** This change.                                                                                                                                                                                                                                                                                                                           |
| **4. Per-workspace profiles not reached at all**                                 | **Closed by Batch 2** (Task 2.1). Re-verified here in §1.4 — the profile resolver derives at snapshot-build time and now benefits from a picker warm for free.                                                                                                                                                                                     |

Both survivors are already recorded as accepted in `auth-providers/CLAUDE.md`
under _Freshness_, and `ModelResolver.warnUnservableTierValue` remains their
un-narrowed diagnostic. That documentation stays accurate: this change adds a
second, user-initiated recovery route into the same window, and narrows nothing.

**Doc note, deliberately not acted on.** `auth-providers/CLAUDE.md`'s _Freshness_
paragraph says "the next provider activation retries". That is now "the next
provider activation **or model-picker open** retries". It is one clause in a
file Batch 4 already closed out, and amending it is a decision about that
document rather than part of this item — flagged here for whoever re-opens the
carrier rather than edited in unilaterally.
