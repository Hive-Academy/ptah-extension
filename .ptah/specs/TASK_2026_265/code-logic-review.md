# Code Logic Review - TASK_2026_265

## Review Summary

| Metric              | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Overall Score       | 8/10                                                          |
| Assessment          | APPROVED                                                      |
| Critical Issues     | 0                                                             |
| Serious Issues      | 0                                                             |
| Moderate Issues     | 1                                                             |
| Minor Issues        | 1                                                             |
| Failure Modes Found | 3 (all pre-existing / accepted, none introduced by this diff) |

Scope note: Decision 1 (delete, no migration) is not re-litigated. Everything
below verifies whether the deletion is implemented correctly and whether the
claims in `implementation-report.md` and `CLAUDE.md` hold up against the
actual code, independently reproduced.

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

The residual case (already named as accepted in `context.md`/`CLAUDE.md`):
an install that opened the `openrouter`/`requesty` model picker before this
fix has a guess sitting in `provider.<id>.mainAgent.modelTier.<tier>` that
looks exactly like a deliberate user choice — nothing marks it, nothing
surfaces it in the UI. This is documented, not hidden, and is explicitly out
of scope to fix here. I re-verified the read path (`getPersistedTierValue`,
`provider-models.service.ts:1149-1163`) and confirmed no marker exists to
distinguish it — grep for `isGuessed`/`autoResolved` across `libs/backend`
independently returns nothing, matching the research report.

### 2. What user action causes unexpected behavior?

None newly introduced. A user opening a non-active provider's model picker
(the exact Defect 2 scenario) now leaves the active session's tier env
completely untouched — I reproduced this by restoring the deleted code and
watching the same spec go red for exactly this action, then confirmed it's
green with the deletion in place (see Mutation Reproduction below).

### 3. What data makes this produce wrong results?

Same residual as (1): a catalogue whose ids happen to satisfy the old
`/claude.*(sonnet|opus|haiku)/i` regex, fetched before this fix shipped, on
`openrouter` or `requesty`. Nothing in this diff changes that population —
it only stops new writes.

### 4. What happens when dependencies fail?

`persistCatalog` and `modelCache.set` are untouched by the deletion (verified
directly at `provider-models.service.ts:409-419` and `:277-289`) — a fetch
failure still falls through to the existing static/persisted-catalogue
fallback chain exactly as before. The deleted function's own failure mode
(swallowed by `setModelTier`'s no `try/catch`... actually `setModelTier` has
no swallow, it would have thrown into `fetchDynamicModels`'s outer `catch`)
no longer exists as a failure mode at all — removing it removes a class of
crash risk, not adds one.

### 5. What's missing that the requirements didn't mention?

Nothing found beyond what `context.md`/`research-report.md` already named as
accepted residue. See "Disagreement, not a finding" at the end for the one
thing I'd flag if the decision were still open — but per instructions it is
not a finding.

---

## Failure Mode Analysis

### Failure Mode 1: Persisted guess pre-dating the fix (ACCEPTED, documented)

- **Trigger**: install opened `openrouter`/`requesty` model picker before this
  fix shipped, on a provider with no persisted tiers at the time.
- **Symptoms**: `deriveTiersFromCatalog` never runs for that provider/tier —
  the persisted guess (an id from that provider's own catalogue) is served
  forever until the user sets or clears the tier explicitly.
- **Impact**: quality-only (an arbitrary-but-servable pick outranking a
  `defaultTiers` map the registry may later add), not a failing session —
  confirmed by tracing `getPersistedTierValue` as the literal first link in
  all three writers (`applyPersistedTiers:661`, `buildTierValues:322`,
  `applyProviderTiers:380`).
- **Current handling**: none — deliberately, per Decision 1.
- **Recommendation**: none — this is the accepted residual, correctly
  documented in `CLAUDE.md:181-197` in a way that matches the actual
  precedence code (verified, not just read).

### Failure Mode 2: Fire-and-forget `persistCatalog` racing the Defect-1 spec's guard assertion (SUSPECTED, ruled out)

- **Trigger**: `fetchModels` calls `void this.persistCatalog(...)` without
  awaiting it (`provider-models.service.ts:287`). The Defect-1 spec asserts
  `keys` contains `provider.openrouter.modelCatalog` immediately after
  `await service.fetchModels(...)` returns.
- **Symptoms if real**: the assertion could pass or fail depending on
  microtask timing, making the guard flaky rather than load-bearing.
- **Impact if real**: the vacuous-pass protection the developer added would
  itself be unreliable.
- **Current handling**: traced explicitly — `persistCatalog`'s body has no
  `await` before its own `this.config.set(...)` call, and `MockConfigManager.set`
  is an async function with no internal `await` before mutating the backing
  store, so both the store mutation and the `jest.fn()` call record happen
  synchronously the instant `persistCatalog` is invoked, before `fetchModels`
  returns control to the test. Confirmed empirically too: the guard assertion
  passed in every run (both the isolated spec run and the full-suite run).
- **Recommendation**: none — ruled out, not a bug.

### Failure Mode 3: Cross-file `process.env` leakage between specs sharing a Jest worker (SUSPECTED, ruled out)

- **Trigger**: this spec mutates process-global `ANTHROPIC_DEFAULT_*_MODEL`
  env vars; other specs in the same lib (`provider-models.service.spec.ts`,
  `workspace-provider-profile-resolver.spec.ts`, `provider-auth-resolver.spec.ts`,
  `model-resolver.spec.ts`) also touch the same three keys.
- **Symptoms if real**: a stray env value from one spec file poisoning
  another, order-dependent pass/fail.
- **Impact if real**: exactly the class of bug the task calls out as
  dangerous — hides for months.
- **Current handling**: `beforeEach` snapshots and clears all three keys;
  `afterEach` restores the snapshot unconditionally (Jest always runs
  `afterEach`, including after a failing assertion, unless the hook itself
  throws — it doesn't here, it's a plain loop with no I/O that can fail).
  Ran the full `auth-providers` suite (34 suites / 598 tests) and it passed
  clean, matching the developer's claimed numbers exactly.
- **Recommendation**: none — ruled out for this suite as currently composed.

---

## Independent Verification — Item by Item

### 1. Did deletion break a consumer? — VERIFIED, no break

Traced the full path independently, not from the CLAUDE.md table:

- `fetchDynamicModels` (`provider-models.service.ts:350-443`): the deleted
  call site's neighbors — `this.modelCache.set(...)` at `:411` — are
  untouched; confirmed by reading the post-diff file directly.
- `fetchModels`'s caller-side `void this.persistCatalog(...)` (`:287`) is
  entirely independent of `fetchDynamicModels` and unaffected.
- `readLiveCatalog` (`:590-594`) reads exactly those two sources
  (in-memory first, persisted second) — this is what `getLiveDerivedTiers`
  (`:624-626`) feeds into `deriveTiersFromCatalog`.
- First-run / setup-wizard path traced concretely: `switchActiveProvider`
  (`:916-926`, docblock states "all eight production call sites are inside
  strategy `configure` methods") calls `applyPersistedTiers(providerId,
options)`. For a cold `openrouter` selection: `userTiers` all null,
  `providerDefaults` `{}` (registry declares none for `openrouter`),
  `derivedFor(tier)` calls `getLiveDerivedTiers` which returns `{}` on a
  still-empty catalogue (verified in `model-tier-derivation.ts:66-69` — "an
  unreadable catalogue returns `{}`, never a guess"). `applyPersistedTiers`
  then finds `unresolved.length > 0` and fires
  `refreshTiersFromLiveCatalog(providerId, options.apiKey, unresolved)`
  (`:697-703`), which fetches the catalogue and calls `applyPersistedTiers`
  again — now with a populated catalogue to derive from. This machinery is
  entirely pre-existing (TASK_2026_262) and untouched by this diff; deleting
  `autoResolveDefaultTiers` does not touch it.
- Conclusion: a user selecting `openrouter` for the first time gets a working
  (if one-round-trip-delayed) tier resolution via the read-time rule, exactly
  as claimed. No hole introduced.

### 2. Are the two specs load-bearing? — CONFIRMED by independent mutation

I restored `autoResolveDefaultTiers` and its call site verbatim (via targeted
`Edit`, not `git checkout`) and ran
`npx nx test auth-providers --testFile=provider-models-cross-provider-contamination.spec.ts --skip-nx-cache`.
Both tests went RED, with output matching the developer's pasted transcript
essentially verbatim (same failing assertions, same received values:
`"anthropic/claude-opus-4.5"` leaking into `process.env`, same three
`provider.openrouter.mainAgent.modelTier.*` keys appearing where `[]` was
expected). I then reverted both edits by targeted `Edit` and confirmed via
`git diff --stat` that the file changed by exactly `3 insertions(+), 46 deletions(-)`
relative to HEAD — identical to the diff shown before my mutation, i.e. the
file is back to the developer's version, not `git checkout`-restored. Re-ran
the spec afterward: 2/2 green, consistent with the intact working tree.

### 3. Do the specs pass for the right reason? — CONFIRMED, guard is real

The Defect-1 spec's vacuity guard (`expect(keys).toContain('provider.openrouter.modelCatalog')`)
is not decorative. Traced the mock (`config-manager.mock.ts:98-106`): `config.set`
is a plain `jest.fn()` wrapping an async function with no internal `await`
before the store mutation, so the mutation and the call record both happen
synchronously the instant `persistCatalog` is invoked — no race with the
`void`, fire-and-forget call. Confirmed by the mutation run above: when the
deleted code was restored, the SAME guard assertion (`toContain('provider.openrouter.modelCatalog')`)
was never the one that failed — only the `modelTier` assertions failed, which
is exactly the property the spec claims to isolate. See Failure Mode 2 above
for the fuller trace.

### 4. Env leakage — CONFIRMED, teardown is sound

`beforeEach`/`afterEach` snapshot-and-restore all three tier env keys
unconditionally (`provider-models-cross-provider-contamination.spec.ts:136-152`).
Ran the full `auth-providers` suite (`npx nx test auth-providers --skip-nx-cache`):
**34 suites / 598 tests passed**, matching the developer's claimed numbers
exactly — including the four other spec files in this lib that also touch
the same three env keys (`provider-models.service.spec.ts`,
`workspace-provider-profile-resolver.spec.ts`, `provider-auth-resolver.spec.ts`,
`model-resolver.spec.ts`). No order-dependent failure observed.

### 5. Is the CLAUDE.md accepted-residual paragraph accurate? — CONFIRMED

Read all three writers directly, not from the table:

- `applyPersistedTiers` (`provider-models.service.ts:657-704`):
  `userTiers[key] ?? providerDefaults[key] ?? derivedFor(key)`, where
  `userTiers = this.getModelTiers(providerId, 'mainAgent')`.
- `ProviderAuthResolver.buildTierValues` (`provider-auth-resolver.ts:317-330`):
  `overrides = this.providerModels.getModelTiers(providerId, scope)`, same
  shape.
- `WorkspaceProviderProfileResolver.applyProviderTiers`
  (`workspace-provider-profile-resolver.ts:376-394`):
  `persisted = this.providerModels.getModelTiers(providerId, 'mainAgent')`,
  same shape.

All three read `getModelTiers` → `getPersistedTierValue` (`:1149-1163`),
which checks the scoped key then (for `mainAgent`) the legacy key, and
returns as soon as either is truthy — before `defaultTiers` or the
derivation is even consulted. This is exactly what the CLAUDE.md paragraph
claims ("nothing reads it as suspect... `deriveTiersFromCatalog` is never
even consulted... permanently, until the user sets that tier explicitly (or
clears it)"). `clearModelTier` (`:560-577`) clears the same scoped key
`setModelTier` wrote to, so the stated self-heal path ("set or clear the
tier") is real, not aspirational. The paragraph neither overstates nor
understates the residual — it matches the code.

### 6. Standard logic review

- **Stubs / dead code**: none. The 35-line method plus docblock is fully
  removed, no `_unused` rename, no commented-out block (confirmed by reading
  the diff directly, not trusting the report's line-count claim, though it
  matches: `-49/+6` reported, `-46/+3` observed net across the whole file —
  the discrepancy is the report's number includes the 4-line comment reword
  at the `reapplyTiersForWarmedCatalog` guard, which nets to +3 not +6; a
  cosmetic mismatch in the report's arithmetic, not a code issue).
- **Provider privileging**: none introduced. The new spec uses `'openrouter'`
  and `'moonshot'` as test data/fixture values only — no `if (providerId ===
'...')` branch appears in any touched production file (confirmed via
  `git diff` review of all 5 changed files).
- **Invented model ids**: none. Every id asserted in the new spec (`anthropic/claude-opus-4.5`,
  `-sonnet-4.5`, `-haiku-4.5`) is `===` an entry in the test's own
  `OPENROUTER_API_RESPONSE` fixture.
- **Error handling**: unchanged. The deleted function had no `try/catch` of
  its own (a `setModelTier` failure would have propagated to
  `fetchDynamicModels`'s existing outer `catch`); removing it does not
  remove any error-handling surface.
- **Comment/docblock accuracy**: the four stale-reference cleanups (
  `provider-models.service.ts`, `model-tier-derivation.ts`,
  `model-tier-derivation.spec.ts`, `sakana-provider-entry.ts`) all read
  correctly post-edit and no longer point at deleted code — verified by
  reading each in the diff.
- **Gates**: independently re-ran lint (`0 errors, 2 warnings`, both
  pre-existing `no-non-null-assertion` in `translation/`, unrelated to this
  change) and typecheck (clean) for `auth-providers` — both match the
  developer's reported numbers exactly.

---

## Critical Issues

None found.

## Serious Issues

None found.

## Moderate Issues

### Issue 1: `Failure Mode 4` wording in Q4 of this report — not a code issue, just naming for the record

Not a code defect — noting only because the paranoid-questions section
requires an answer. The removed function was `private`, called from exactly
one site inside a `try` block that already had a `catch` (`fetchDynamicModels`'s
outer catch at `:426-441`), so it was never a standalone failure surface. No
action needed.

## Minor Issues

### Issue 1: Implementation report's line-count arithmetic is slightly off

`implementation-report.md` states "Net `provider-models.service.ts`: **-49 /
+6**" for the whole file, then separately claims "+6 is the reworded hazard
note." Actual diff: `-46/+3` for the whole file (`git diff --stat` shows
`49 ++--` total changed lines across insert/delete, and the two hunks are
`-1/+0` for the call site and `-45/+3` for the method-removal-plus-comment
hunk, i.e. `-46/+3` net, not `-49/+6`). Cosmetic — does not affect the
correctness of the change, and I independently verified the actual diff
content (not the arithmetic) matches what's claimed to have been removed and
reworded.

---

## Mutation Reproduction (raw output)

Restored code — both tests RED (matches developer's pasted transcript):

```
● the model-catalogue fetch path writes no tier of its own › leaves the ACTIVE
  session tier env untouched when a NON-active provider is browsed (Defect 2)
  expect(received).toBeUndefined()
  Received: "anthropic/claude-opus-4.5"

● the model-catalogue fetch path writes no tier of its own › persists no
  DERIVED tier into the user-choice config key, even for the ACTIVE provider (Defect 1)
  - Array []
  + Array [
  +   "provider.openrouter.mainAgent.modelTier.sonnet",
  +   "provider.openrouter.mainAgent.modelTier.opus",
  +   "provider.openrouter.mainAgent.modelTier.haiku",
  + ]

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
```

Deletion restored (targeted `Edit`, reverting my own mutation) — both GREEN:

```
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

`git diff --stat` after revert:
`libs/backend/auth-providers/src/lib/provider-models.service.ts | 49 ++--------------------`
`1 file changed, 3 insertions(+), 46 deletions(-)` — identical shape to the
diff observed before the mutation, confirming the file is back to the
developer's committed-to-working-tree state.

Full suite after revert: `34 suites / 598 tests passed` (auth-providers).
Lint: `0 errors, 2 warnings` (pre-existing, unrelated files). Typecheck: clean.

---

## Requirements Fulfillment

| Requirement                                                             | Status                                      | Concern                                  |
| ----------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Delete `autoResolveDefaultTiers` + call site, no migration              | COMPLETE                                    | None                                     |
| Two regression specs, mutation-proven                                   | COMPLETE                                    | Verified independently, not just trusted |
| `CLAUDE.md` "Precedence" section updated to reflect deletion + residual | COMPLETE                                    | Verified against actual code, matches    |
| No provider privileged, no invented model ids                           | COMPLETE                                    | Verified                                 |
| No migration / provenance marker / settings-version bump added          | COMPLETE (correctly absent, per Decision 1) | N/A                                      |

## Edge Case Analysis

| Edge Case                                          | Handled          | How                                                                                                       | Concern                 |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| Non-active provider browsed, no persisted tiers    | YES              | Fetch path writes no tier at all (Defect 2 spec)                                                          | None                    |
| Active provider fetched, no persisted tiers        | YES              | Same fetch path, still writes no tier (Defect 1 spec)                                                     | None                    |
| Cold first-run provider selection (setup wizard)   | YES              | `switchActiveProvider` → `applyPersistedTiers` → `refreshTiersFromLiveCatalog` (pre-existing, unaffected) | None                    |
| Pre-fix persisted guess on `openrouter`/`requesty` | NOT self-healing | Documented residual, Decision 1                                                                           | Accepted, not a finding |
| Catalogue read failure mid-derivation              | YES              | `deriveTiersFromCatalog` returns `{}` on null/unreadable input                                            | None                    |
| Env leakage across spec files in same worker       | NO leak observed | `beforeEach`/`afterEach` snapshot-restore, full-suite run green                                           | None                    |

## Integration Risk Assessment

| Integration                                                            | Failure Probability | Impact                                                | Mitigation                                                        |
| ---------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `fetchModels` → `persistCatalog` (fire-and-forget) → mock/config store | LOW                 | Test guard could be flaky                             | Traced synchronous execution semantics; ruled out                 |
| Deletion → three tier writers                                          | LOW                 | Would silently strand a provider with no defaultTiers | Traced all three end to end; unaffected, read-time rule covers it |
| Pre-fix persisted guess → post-fix precedence                          | MEDIUM (accepted)   | Stale tier outranks future registry `defaultTiers`    | Documented, Decision 1, out of scope here                         |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: None introduced by this diff. The one residual risk (pre-fix
persisted guesses on `openrouter`/`requesty`) is a known, deliberate,
correctly-documented consequence of Decision 1, not a defect in this
implementation.

## What Robust Implementation Would Include

Nothing further belongs in _this_ task's scope. If the accepted residual is
ever revisited (a separate task, per Decision 1's reasoning), a robust
version would need a marker distinguishing a derived guess from a deliberate
user pick (a flag or separate config key), so a future migration could target
exactly the guesses and leave real user choices alone — the reason today's
decision correctly declined a blind one-time clear.

---

## Disagreement, not a finding

None. Decision 1 and its reasoning (residue is servable not broken; a
one-time clear would risk discarding real user choices on the two providers
most likely to have them) hold up under my own trace of the precedence code —
I found nothing that contradicts the stated reasoning, and I am not
recommending a migration, provenance marker, or settings-version bump.
