# Implementation Report — TASK_2026_265

**Decision implemented as instructed: delete `autoResolveDefaultTiers` and its call
site, ship no migration.** I did not disagree with it and did not implement an
alternative. Nothing is committed; everything is in the working tree.

---

## 1. The deletion

### Call site — verified as the only one before removing it

`libs/backend/auth-providers/src/lib/provider-models.service.ts:412` (pre-edit),
inside `fetchDynamicModels`:

```ts
this.modelCache.set(providerId, { models, timestamp: now });
await this.autoResolveDefaultTiers(providerId, models); // ← deleted
```

Re-verified rather than trusted: a repo-wide `Grep` for `autoResolveDefaultTiers`
before touching anything returned exactly one invocation (`:412`), one
declaration (`:530`), and four prose/comment mentions (listed in §4). The
research report's trace holds.

### `modelCache.set` and `persistCatalog` — re-verified independent

Both are load-bearing for the read-time rule, so I re-read them rather than
trusting the report:

- `modelCache.set(providerId, …)` is the **statement before** the deleted call
  (`:411`), not part of it, and is untouched by the edit.
- `persistCatalog` is not called by `fetchDynamicModels` at all. It is called by
  the **caller**, `fetchModels:287` (`void this.persistCatalog(providerId,
result.models)`), after `fetchDynamicModels` returns and after
  `mergeStaticMetadata`. Nothing in that chain passed through the deleted
  function.
- `getLiveDerivedTiers` → `readLiveCatalog` (`:634-638` pre-edit) reads exactly
  those two sources, in-memory first, persisted second, synchronously.

So the catalogue that used to feed the regex guess still exists and now feeds
`deriveTiersFromCatalog` instead. This is proven, not asserted — the Defect 1
spec ends by calling `getLiveDerivedTiers('openrouter')` after the fetch and
asserting all three tiers derive correctly (§2).

### What was removed

The 35-line private method plus its docblock (`:523-564` pre-edit) and the
single call. No `_unused` rename, no commented-out block, no tombstone comment
in the deleted location. Net `provider-models.service.ts`: **-46 / +3** (the +3
is the reworded hazard note below). `git diff --numstat` confirms `3	46`;
an earlier version of this line said `-49 / +6`, which was arithmetic error —
caught in code-logic review, corrected here.

### Stale comment references — cleaned, because the gate treats them as misses

Four comments referenced the function by name and would have become dangling
pointers to code that no longer exists:

| File                                                                   | What it said                                                                                                                                                                                       | What it says now                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-models.service.ts` (`reapplyTiersForWarmedCatalog` guard #1) | "`autoResolveDefaultTiers` has this hazard **today**… do not copy it"                                                                                                                              | names it as a second writer deleted for exactly this hazard (TASK_2026_265), keeps the "do not reintroduce" instruction                                                                                                                                        |
| `model-tier-derivation.ts:32-38`                                       | `.sort().at(-1)` "convention already used by `autoResolveDefaultTiers` (`provider-models.service.ts:527-538`)" — a line reference that is now wrong twice over                                     | convention "inherited from the auto-resolver this rule replaced", **plus** the correction the research report established: the old `.sort()` had no comparator and was provably inert, so this is the first implementation where the convention actually sorts |
| `model-tier-derivation.spec.ts:85`                                     | "reused from autoResolveDefaultTiers"                                                                                                                                                              | "inherited from the fetch-path auto-resolver this rule replaced"                                                                                                                                                                                               |
| `libs/shared/.../sakana-provider-entry.ts:51`                          | "`autoResolveDefaultTiers()` only matches `claude.*(...)`, so Fugu falls back to these explicit mappings" — the stated _reason_ `SAKANA_DEFAULT_TIERS` exists, and it evaporated with the function | Fugu ids name no tier, so the derivation can only reach them via the context-length ordinal pass; the explicit map is the verified statement that outranks it                                                                                                  |

The Sakana one is the only edit outside `auth-providers`. It is comment-only —
`SAKANA_DEFAULT_TIERS` values are unchanged, no provider behaviour moves, and
`nx test shared` covers it (32 suites / 762 tests, all green).

---

## 2. The specs

`libs/backend/auth-providers/src/lib/provider-models-cross-provider-contamination.spec.ts`
(filename kept for traceability with the research report). I reviewed the
researcher's spec critically before adopting it and changed the following.

**Fixed in the inherited spec:**

- **Env teardown was already correct but partial.** It snapshotted and restored
  the three tier keys — good — but the assertions only checked `process.env`.
  `setModelTier`'s `mainAgent` branch writes the shared `AuthEnv` object too, and
  that object is what `reapplyTiersForWarmedCatalog`'s "already resolved" guard
  reads. A leak there is invisible to the original spec. Now asserted.
- **Vacuous-pass risk.** The original had no proof the fetch actually happened.
  If `axios.get` were mis-mocked, or the registry entry for `openrouter` lost its
  `modelsEndpoint`, `fetchModels` would fall through to a different branch and
  every "must be undefined" assertion would pass for the wrong reason. Now pinned:
  `expect(mockedAxios.get).toHaveBeenCalledTimes(1)` and the returned catalogue is
  asserted to contain `anthropic/claude-opus-4.5` — i.e. the input the deleted
  regex needed is proven present.
- **Ordering / leakage.** `savedEnv` is rebuilt from a single `TIER_ENV_KEYS`
  constant in `beforeEach` and restored in `afterEach`, so a mid-test failure
  cannot poison a sibling spec sharing the Jest worker. Both tests are
  order-independent: each constructs its own service, its own
  `MockConfigManager` bag and its own `AuthEnv`. Nothing is shared but the
  process env, which is saved/restored around every test.
- **Naming.** `describe` renamed from "Defect 2 repro" to a statement of the
  property being pinned — this is a permanent regression guard now, not a
  reproduction.
- Indentation glitch at the old line 141 fixed.

**New — Defect 1, and why it is a genuinely separate case:**

> `persists no DERIVED tier into the user-choice config key, even for the ACTIVE
provider`

It fetches `openrouter` **while `openrouter` is the active provider**. That is
deliberate: an activeness guard — the obvious alternative fix — would satisfy the
Defect 2 spec and still fail this one. Only "the fetch path writes no tier at
all" passes both. It asserts:

- no `config.set` key matches `/^provider\.[^.]+\.(?:[^.]+\.)?modelTier\./`
  (scoped **and** legacy unscoped shapes);
- `provider.openrouter.modelCatalog` **was** written — so the assertion above is
  not passing because nothing ran;
- `getModelTiers('openrouter', …)` still reads `{sonnet: null, opus: null,
haiku: null}` on both `mainAgent` and `cliAgent` — the read side of the same
  property, through the accessor all three tier writers actually use;
- `getLiveDerivedTiers('openrouter')` returns all three tiers from the catalogue
  — the replacement working.

### Mutation proof (actual output, not estimated)

Restored the function and its call site verbatim in the working copy, ran, then
removed them again.

**With the deleted code restored — both RED:**

```
FAIL  auth-providers  libs/backend/auth-providers/src/lib/provider-models-cross-provider-contamination.spec.ts
  ● the model-catalogue fetch path writes no tier of its own › leaves the ACTIVE
    session tier env untouched when a NON-active provider is browsed (Defect 2)
    expect(received).toBeUndefined()
    Received: "anthropic/claude-opus-4.5"
      191 |     expect(service.resolveActiveProviderId()).toBe('moonshot');
      192 |     for (const key of TIER_ENV_KEYS) {
    > 193 |       expect(process.env[key]).toBeUndefined();
          |                                ^

  ● the model-catalogue fetch path writes no tier of its own › persists no
    DERIVED tier into the user-choice config key, even for the ACTIVE provider (Defect 1)
    expect(received).toEqual(expected) // deep equality
    - Expected  - 1
    + Received  + 5
    - Array []
    + Array [
    +   "provider.openrouter.mainAgent.modelTier.sonnet",
    +   "provider.openrouter.mainAgent.modelTier.opus",
    +   "provider.openrouter.mainAgent.modelTier.haiku",
    + ]
      > 232 |     expect(keys.filter((key) => TIER_CONFIG_KEY.test(key))).toEqual([]);

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
```

Note the two failures are on **different assertions in different files' worth of
behaviour** — env-global write vs. config persistence — which is the evidence
that they pin two distinct properties rather than one property twice.

**With the deletion in place — both GREEN:**

```
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Time:        3.961 s
```

The mutation was reverted by targeted `Edit` calls to the one file I had
changed. No `git checkout`, no `git stash`, nothing outside my own edits was
touched.

---

## 3. `libs/backend/auth-providers/CLAUDE.md`

Replaced the "Precedence, and the one thing that violates it" section
(heading now "…and the violation that was removed from it"). It contains:

1. **The rule stated as a rule**, not as a description of one function:
   `provider.<id>.<scope>.modelTier.<tier>` is the user-choice slot and nothing
   derived may be written into it.
2. **What was deleted and what replaced it** — the read-time rule, with the
   mechanical reason it suffices (the fetch still warms `modelCache` and still
   calls `persistCatalog`, which is exactly what `getLiveDerivedTiers` reads).
   Both specs named, and the reason they are two rather than one.
3. **The accepted residual, stated so it cannot be misread as closed.** In its
   own paragraph, leading with "the hole is closed for new writes only" and
   containing, explicitly: the guess is **not self-healing**; it sits in the
   top-of-precedence key so `deriveTiersFromCatalog` is **never even consulted**
   for that provider/tier; it persists until the user sets or clears that tier;
   **no migration was shipped, deliberately**, because no marker distinguishes a
   guess from a deliberate pick and a one-time clear would silently discard real
   choices on exactly the two providers most likely to have them. It closes with
   a direct instruction to the next reader who arrives with a user's wrong-looking
   `openrouter` tiers: the fix is for the user to set or clear the tier, not to
   add the migration.

**Not touched:** the "Tier derivation" rule sections, the FOUR-sites table, the
lane paragraph, "What did NOT change", "Freshness". The deletion changes no count
or claim in them — the auto-resolver was never one of the FOUR sites; it was
documented separately, as a violation alongside them.

---

## 4. Gates — real numbers

| Gate                      | Command                                                                                                      | Result                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regression spec alone     | `npx nx test auth-providers --testFile=provider-models-cross-provider-contamination.spec.ts --skip-nx-cache` | **1 suite / 2 tests passed**                                                                                                                                                                              |
| Full lib tests            | `npx nx test auth-providers --skip-nx-cache`                                                                 | **34 suites / 598 tests passed, 2 snapshots passed** (21.7 s)                                                                                                                                             |
| Lint                      | `npx nx run @ptah-extension/auth-providers:lint --skip-nx-cache`                                             | **0 errors, 2 warnings** — both `no-non-null-assertion`, in `translation/responses-stream-translator.ts:312` and `translation/translation-proxy-base.ts:107`. **Pre-existing, in files I did not touch.** |
| Typecheck                 | `npx nx run @ptah-extension/auth-providers:typecheck` (`tsc --noEmit`)                                       | **clean**                                                                                                                                                                                                 |
| `shared` (Sakana comment) | `npx nx test shared` / `lint` / `typecheck`                                                                  | **32 suites / 762 tests passed**; lint "All files pass"; typecheck clean                                                                                                                                  |

### Final grep

`Grep autoResolveDefaultTiers` over the whole repo — **8 files, zero live code
or spec references**:

- `.ptah/specs/TASK_2026_265/{task,context,research-report}.md` — prose
- `.ptah/specs/TASK_2026_262/{batch-1,batch-2,batch-4,residual-listmodels}-report.md` — prose
- `libs/backend/auth-providers/CLAUDE.md` — the one deliberate past-tense sentence
  ("used to violate that… TASK_2026_265 deleted the function and its call site
  outright")

Gate satisfied.

---

## 5. Files in the working tree (nothing committed)

| File                                                                                                                  | Change                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models.service.ts`                           | deleted `autoResolveDefaultTiers` + its `:412` call; reworded the `reapplyTiersForWarmedCatalog` hazard note (−49/+6) |
| `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models-cross-provider-contamination.spec.ts` | **new/untracked** — two mutation-proven regression specs (Defect 2 + Defect 1)                                        |
| `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\model-tier-derivation.ts`                             | docblock: dangling reference → past tense, plus the "old `.sort()` was inert" correction                              |
| `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\model-tier-derivation.spec.ts`                        | comment only                                                                                                          |
| `D:\projects\ptah-extension\libs\backend\auth-providers\CLAUDE.md`                                                    | Precedence section rewritten; accepted residual documented                                                            |
| `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries\sakana-provider-entry.ts`                           | comment only — `SAKANA_DEFAULT_TIERS` rationale restated without the deleted function                                 |

Out-of-scope items confirmed untouched: `byIdAscending`'s lexicographic sort, any
migration or clearing of persisted tier keys, `chat-session.service.ts:418`, and
the four TASK_2026_262 tier-writer sites.

## 6. Standing constraints

- No commit, no staging. No `git add`, no `git stash`, no `git checkout`. Only
  the six files above were modified, all by targeted `Edit`/`Write`.
- No `if (providerId === '…')` added anywhere; the specs use `openrouter` and
  `moonshot` as data, never as a branch in production code.
- No invented model ids — every id in the specs comes from the researcher's
  OpenRouter-shaped fixture, and the derived-tier assertion checks ids that are
  `===` entries of that fixture.
- `catch (error: unknown)` unchanged throughout; the deletion removed no error
  handling.

## 7. One thing worth flagging

Two `no-non-null-assertion` lint warnings exist in
`libs/backend/auth-providers/src/lib/translation/` and are unrelated to this
task. I left them alone. Flagging so they are not read as introduced here.
