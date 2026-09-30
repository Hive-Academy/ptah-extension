# Code Logic Review — Batch 1, `TASK_2026_575_74a4`

Scope: the uncommitted change to `libs/shared/src/lib/utils/pricing.utils.ts` and
`.../pricing.utils.spec.ts` in worktree `task-575-session-cost` (base `722d921ab`).
Reviewed in full; no source edited; no git state changed.

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Minor issues        | 1                                    |
| Failure modes found | 0 new (2 pre-existing noted)         |

Evidence: full read of `pricing.utils.ts` (632 lines) and the spec at base and after
the change; parity source `stream-transformer.ts:82-89`; `batches.md` Batch 1;
`context.md` decisions 5 and 6(d); `research-addendum.md` Q3; `jest` run — 106/106
passed; type check of both files — 0 errors.

## Five logic questions

### 1. How does this fail silently?

It does not, for the batch scope. An unknown or variant id returns `null` from
`findModelPricing` (`pricing.utils.ts:229-239`) and `calculateMessageCost` returns
`null`, never `0` (`pricing.utils.ts:397-398`). A miss emits a warning once per
distinct id (`pricing.utils.ts:233-238`). No path converts a lookup miss into a
zero-dollar figure.

### 2. What user action produces unexpected behaviour?

None found. A user on a distinctly priced variant gets that variant's entry when
the catalog publishes one (`pricing.utils.ts:326-336`, order verified by
`pricing.utils.spec.ts:286-297`). Otherwise the id resolves to the base model's
rates, which is the intended fix.

### 3. What input data produces a wrong answer?

One exotic shape diverges from the specified candidate order — finding 1 below.
It needs two catalog keys (`x/y[1m]` and `x/y`) registered at once. No realistic
catalog shape in this repository does that today.

### 4. What happens when a dependency fails?

The OpenRouter catalog fetch failing leaves the runtime map at its bundled layer;
tagged and unknown ids then return `null` and the UI renders "Pricing
unavailable". No fallback to `0` exists anywhere in the changed path.

### 5. What is missing that the requirements never mentioned?

Long-context per-call tiering for `>200K` prompts. Deferred by scope decision 5;
recorded in `research-addendum.md` Q3. Not counted against this batch. See note N2.

## Requirements confirmation

| #  | Requirement                                                                 | Verdict   | Evidence |
| -- | --------------------------------------------------------------------------- | --------- | -------- |
| 1  | Exact catalog key `claude-opus-5-5[1m]` wins over base, also behind a prefix | CONFIRMED | `pricing.utils.ts:326-336`; test `pricing.utils.spec.ts:286-297` (`'anthropic/claude-opus-5-5[1m]'` → `OPUS_1M` at line 289-291) |
| 2  | `claude-opus-5-5-codex[1m]`, `foo[1m]`, `[1m]` stay unpriced; cost is `null`; no reverse/partial match | CONFIRMED | Partial loop uses `startsWith` only, remainder must be a date (`pricing.utils.ts:347-354`); no `includes` anywhere (`pricing.utils.ts:341-363`); tests `pricing.utils.spec.ts:299-305` |
| 3  | Date-snapshot rule unchanged, applied on the tag-stripped id                  | CONFIRMED | `normalizedId = untaggedId` (`pricing.utils.ts:338`), `DATE_SNAPSHOT_SUFFIX` test unchanged (`pricing.utils.ts:354`); date+tag id resolves to base (`pricing.utils.spec.ts:258`) |
| 4  | `getModelContextWindow` keeps base behaviour for `[1m]` ids via `stripVariantTags=false` | CONFIRMED | Call site `pricing.utils.ts:519`; tag-stripping skipped (`pricing.utils.ts:322-324`); guard test `pricing.utils.spec.ts:307-314` |
| 5  | Tests pin the behaviours and fail on base; not tautological                   | CONFIRMED | See "Evidence for fail-on-base" below |
| 6  | Parity of `normalizeModelKey` with the local copy                             | CONFIRMED | `pricing.utils.ts:286-289` vs `stream-transformer.ts:82-89` — same order (trim, lowercase, `(\[[^\]]*\])+$` strip, prefix via `lastIndexOf('/')+1`, date regex); both regexes identical |

Tests that fail on base `722d921ab`: the positive `it.each` block
(`pricing.utils.spec.ts:272-284`) — base has no tag stripping, so
`findModelPricing('claude-opus-5-5[1m]')` returns `null`, not `OPUS`; the
exact-catalog preference test (`pricing.utils.spec.ts:286-297`); and the whole
file fails to compile on base because `normalizeModelKey` and
`stripModelVariantTags` do not exist there (spec imports at
`pricing.utils.spec.ts:17,19`). The negative tests (`pricing.utils.spec.ts:299-305`)
and the context-window guard (`pricing.utils.spec.ts:307-314`) also pass on base —
they are invariant pins that guard against future over-matching, which matches
their intent in `batches.md` (R6). They are not tautological: they assert concrete
outputs (`OPUS` rates, `0.01`, `200_000`, `1_000_000`) and `console.warn` silence.

## Findings

### 1. MINOR — candidate order deviates from the order specified in `batches.md` Task 1.1

- File: `libs/shared/src/lib/utils/pricing.utils.ts:326-331`
- Scenario: the catalog holds both a tag-spelled key `claude-opus-5-5[1m]` and a
  prefixed base key `anthropic/claude-opus-5-5`, and the query is
  `anthropic/claude-opus-5-5[1m]`. The implementation tries the prefix-stripped
  spelling (candidate 2) before the tag-stripped spelling (candidate 3), so it
  returns the `[1m]` entry. `batches.md` Task 1.1 specifies tag-strip as step 2
  and prefix-strip as step 3, which would return the prefixed base entry.
- Impact: low. Both candidates differ from the query by exactly one transform,
  and both orders keep the R6 invariant "a distinctly priced variant is never
  collapsed onto its base model" (`pricing.utils.ts:297-301` documents the
  implemented order). No wrong-model billing is possible under either order
  because every candidate is still an exact key.
- Fix: none required for correctness. If strict conformance to the batch order is
  wanted, swap candidates 2 and 3 in the `exactIds` array; otherwise update the
  Task 1.1 wording to match the implementation.

### N1. NOTE (pre-existing, not counted) — prototype-key lookup

- File: `libs/shared/src/lib/utils/pricing.utils.ts:333`
- `modelPricingMap[id]` is a plain-object truthy check. An id spelling that names
  an inherited property (e.g. `constructor`) returns a non-pricing truthy value,
  which `calculateMessageCost` then turns into `NaN`. The old code had the same
  pattern; the batch extends it to four candidate spellings. Recommend
  `Object.hasOwn(modelPricingMap, id)` in a later hardening batch.

### N2. NOTE (deferred, not counted) — long-context tiering

- File: `libs/shared/src/lib/utils/pricing.utils.ts:392-409`
- A `[1m]` id bills at the base model's published rates regardless of prompt
  size; a `>200K` call is under-billed. Deferred by scope decision 5.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty string id | YES | `findModelPricing` early return `pricing.utils.ts:222-224`; `getModelContextWindow` returns 0 (`pricing.utils.ts:516`) | none |
| `[1m]` alone (strips to empty) | YES | Empty candidates skipped by `id &&` guard (`pricing.utils.ts:333`); partial loop cannot match an empty id (`pricing.utils.ts:348-352`); test `pricing.utils.spec.ts:300` | none |
| Multiple tags `[1m][fast]` | YES | `(\[[^\]]*\])+$` strips the run (`pricing.utils.ts:253,264-266`); test `pricing.utils.spec.ts:324-334` | none |
| Mid-string tag `claude-[1m]-opus` | YES | Regex is `$`-anchored; id unchanged (`pricing.utils.ts:253`); test `pricing.utils.spec.ts:329` | none |
| Uppercase id and tag `Claude-Opus-5-5[1M]` | YES | Lowercase before strip (`pricing.utils.ts:321-324`); test `pricing.utils.spec.ts:276` | none |
| Date snapshot plus tag | YES | Strip tags first, then date partial match (`pricing.utils.ts:322-324,338-360`); test `pricing.utils.spec.ts:277,279` | none |
| Double prefix `openrouter/anthropic/...` | YES | `slice(lastIndexOf('/') + 1)` keeps the last segment (`pricing.utils.ts:269-271`); test `pricing.utils.spec.ts:335-337` | none |
| Variant id `codex[1m]` after strip | YES | Remainder `-codex` fails the date regex (`pricing.utils.ts:354`); test `pricing.utils.spec.ts:299-305` | none |
| Trailing slash `anthropic/` | YES | Strips to empty; empty candidates skipped (`pricing.utils.ts:270,333`) | none |
| Empty brackets `model[]` | YES (by design) | `[^\]]*` allows an empty tag, stripped like any tag (`pricing.utils.ts:253`); identical to the local copy's regex (`stream-transformer.ts:86`) | none — parity required |
| Catalog key registered mixed-case | PARTIAL | `registerProviderPricing` adds a lowercase twin (`pricing.utils.ts:158-165`); a key added via raw `updatePricingMap` in mixed case is unreachable by exact match | pre-existing behaviour, unchanged |

## Data flow

1. `findModelPricing(modelId)` — guards empty and `<...>` ids (`pricing.utils.ts:222-227`). OK.
2. `lookupPricingEntry(modelId, true)` — lowercase, then four exact candidates,
   most specific first (`pricing.utils.ts:321-336`). OK — tag entry wins before
   base, behind a prefix.
3. Date-snapshot partial match over the tag-stripped and prefix-stripped id,
   forward direction only, remainder must be a date (`pricing.utils.ts:338-360`). OK — no reverse match.
4. Miss → one warning per distinct id, dedup set (`pricing.utils.ts:233-238`), return `null`. OK.
5. `calculateMessageCost` — `null` pricing propagates to `null`
   (`pricing.utils.ts:397-398`); known pricing multiplies each token class and
   rounds to 6 decimals (`pricing.utils.ts:400-408`). OK.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the exact-candidate order differs from the order written in
  `batches.md` Task 1.1, but only in a two-key catalog shape this repository does
  not produce today, and no wrong-rate billing follows from it.
- What a robust implementation would add: a `Object.hasOwn` guard on the map
  lookup (N1); the long-context tiering follow-up (N2); when Task 2.2 lands, a
  shared import in `stream-transformer.ts` so the two normalizers cannot drift.

Verification evidence: `npx jest -c libs/shared/jest.config.ts
libs/shared/src/lib/utils/pricing.utils.spec.ts` — 106 passed, 106 total;
type check of both changed files — 0 errors. Barrel export confirmed at
`libs/shared/src/index.ts:55` (`export * from './lib/utils/pricing.utils';`),
so the barrel identity test (`pricing.utils.spec.ts:342-348`) is real.