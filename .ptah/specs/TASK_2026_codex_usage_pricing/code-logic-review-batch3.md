# Code Logic Review — Usage batch 3 (Shared price contract)

Review family: claude (in-process subagent); implementer: codex

Scope: `git diff -- libs/shared libs/backend/cli-agent-runtime` (7 files; the foreign `task-tracking/landing-live-demo/HANDOFF.md` ignored). Read-only. No verify, test, lint or typecheck was run; compile and spec status is reasoned by reading.

Score: 7.5/10. Verdict: APPROVE. There are no blocking or serious defects, and the moderate items are fixable in batch 4 or 5.

## Checks

1. **Existing Claude callers.**
   - The diff only adds exports (`findExactModelPricing`, `calculateExactMessageCost`, optional `ModelPricing` metadata fields) and optional type fields.
   - `findModelPricing` (`pricing.utils.ts:231`), `lookupPricingEntry` and `calculateMessageCost` (`:414`) are untouched.
   - No existing consumer calls the new functions (grep over `libs/` and `apps/`). Claude payloads are unchanged.
   - sdk-callbacks spreads each new field only when `!== undefined`, so the legacy payload is byte-identical.
2. **Exact-rate guard.** Correct, with the caveats in D1 to D3 below.
   - Lookup is an own-key hit on the lowercased id (`pricing.utils.ts:464-466`). The only variant is `claude-*[1m]` falling back to its base key (`:468-470`), and a distinct tagged entry wins.
   - There is no provider-prefix, date-snapshot, family or prefix fallback, and `Object.hasOwn` blocks prototype keys.
   - Any used class without a valid rate gives `totalCost: null`. Coverage is `partial` if some used class is priced, otherwise `none` (`:536-552`).
   - Cache counters need `cacheSemantics: 'disjoint'`, and the default is conservative.
   - The four classes are priced once through the existing `calculateMessageCost`. `reasoningOutputTokens` is not part of `TokenBreakdown` and is never priced.
   - Subscription gives `covered-by-subscription` (U1) and API key gives `estimated` (U2). No rates were invented.
3. **Types.**
   - Every new field is optional and the changes are type-only.
   - `pricingCoverage` already existed on `SessionStatsEntry` (`rpc-session.types.ts:443`) and is reused. `ResultStatsPayload` gains it as an optional field.
   - The new import cycle (`pricing.utils` and `rpc-session.types` import each other) is `import type` only and is erased. It is acceptable.
   - No Zod schema covers `SessionStatsEntry`, `ResultStatsPayload` or `session:stats`. `messages/schemas.ts:304` only has a `totalCost` entry on an unrelated object, so there is no IPC schema to update.
   - The hand-written `parseSessionStatsLivePayload` and `isValidSessionStatsSnapshot` (`chat-state/session-stats-snapshot.ts:20-57`) ignore unknown keys. The new fields therefore pass through, but unvalidated (see D4).
4. **Strict TS, console, audit.**
   - No `console` use was added, and the types are strict-safe.
   - The spec is plausible to type-check:
     - `reasoningOutputTokens` is passed via a variable, so there is no excess-property error.
     - Every required `SessionStatsEntry` field is present.
     - `SessionId.create` exists.
   - I hand-checked the spec arithmetic (0.006, 0.0006, 0.00064) and the partial and none paths. They are consistent.
   - The degradation audit claim was not re-run; the report states it exited 0.
5. **No Codex rate card, end to end.**
   - `CODEX_PROVIDER_ENTRY` zero rates (`codex-provider-entry.ts:25-26`) never enter `modelPricingMap`. `seedStaticModelPricing` returns early for subscription providers (`provider-registry.ts:853`), and the Codex entry is the only holder of those zeros.
   - With no hydrated exact id, `calculateExactMessageCost` returns `totalCost: null, costBasis: 'unknown', coverage: 'none'`, which is "unavailable" and not $0.00.
   - The helper is not yet wired. Until batch 4 calls it, today's Codex path is unchanged, so end-to-end behaviour cannot be confirmed here.
   - A $0.00 can still come from the helper in two ways (D1, D2).

## Defects

1. **D1 (Moderate). Zero-token input prices as a known $0.** `pricing.utils.ts:527-556`.
   - The scenario is `{input:0, output:0}` with valid rates.
   - It returns `totalCost: 0, pricingCoverage: 'full'`. A Codex turn or session with no usage evidence would then show $0.00 rather than "unavailable".
   - U3 says a terminal with no usage event is unknown, not zero.
   - Fix: return `totalCost: null, coverage: 'none'` when the total used-token count is 0, or document that batch 4 must not call it without positive counts, and add a spec.
2. **D2 (Moderate). A zero-rate exact entry is accepted.** `validRate` is at `pricing.utils.ts:487-489` and `rate >= 0` admits `0`.
   - Both input and output rates being `0` give a priced `$0.00 full` result.
   - It is currently unreachable for Codex, but any future zero placeholder registered under an exact slug would pass.
   - Legitimate free tiers (`:free`, Ollama) also give zero.
   - Fix: add an option `allowZeroRate` (default false), or reject all-zero input and output rates when `billingMode` is 'subscription' or 'api-key'. Add a spec.
3. **D3 (Moderate). A null total carries a misleading `costBasis`.** `pricing.utils.ts:523-529` and `:547-552`.
   - A null total with `billingMode: 'api-key'` is labelled `costBasis: 'estimated'`.
   - A null total with `billingMode: 'subscription'` is labelled `covered-by-subscription`.
   - A consumer that keys the chip label on `costBasis` alone can show "Estimate" or "Covered" next to "unavailable".
   - Fix: return `costBasis: 'unknown'` whenever `totalCost` is null, and document it. The spec asserts only `toMatchObject` on `totalCost` and coverage, so it will not catch this.
4. **D4 (Minor). Doc claim not backed by code.** `session-stats-live.ts:29` says "the consumer validates their shape".
   - `isValidSessionStatsSnapshot` does not check `costBasis`, `pricingCoverage` or `priceProvenance`. An out-of-union string will install as-is.
   - Fix: add `isOptional` checks in batch 5, or reword the comment.
5. **D5 (Moderate). `[1m]` fallback prices a 1M-context request at the base rate.** `pricing.utils.ts:468-470`.
   - Only for Claude, and shared with the existing lookup.
   - Long-context premium tiers are not modelled, so the result is exact-looking but may underestimate.
   - Fix: note it in the doc comment, or fall back only when the base entry declares no long-context tier.
6. **D6 (Minor). Provenance is thin for hydrated rates.** `ModelPricing.catalogSource`, `catalogVersion` and `effectiveDate` are never filled by `feedPricingMap` (`provider-models.service.ts:1338-1346`) or `seedStaticModelPricing`.
   - OpenRouter-fed Codex rates carry only `modelIdUsed`, so "catalog evidence" is empty.
   - This is a known open risk in the batch report.
   - Fix: in batch 4, set `catalogSource: 'openrouter'` and the fetch date when feeding the map.
7. **D7 (Minor). Top-level fields duplicate the snapshot fields.** `sdk-callbacks.ts:444-450` forwards `costBasis`, `pricingCoverage` and `priceProvenance` at the top level, and `sessionStats` carries the same names.
   - The two can diverge, and the plan says the snapshot is authoritative.
   - Fix: pick the snapshot as the single source and document which one the frontend reads.
8. **D8 (Minor). Formatting.** `pricing.utils.ts:527-534` and `:529` exceed the Prettier width.
   - The spec has many cramped single-line object arguments (`pricing.utils.spec.ts:~520-680`).
   - The pre-commit lint-staged run will reformat them. This belongs to the style review.

## Not found

- No placeholder, stub or fabricated rate.
- No swallowed error: the function is pure.
- No cross-family fallback: `gpt-fixture-codex`, `gpt-fixture-2026-01-01` and `gpt-fixture[1m]` all return null in the spec.
- Residual uncertainty: specs and typecheck were not run, and the persisted-snapshot field-by-field rebuild at `session-stats-owner.service.ts:933` may drop the new fields. That is batch 4 scope.

## Round 1

Review family: claude (in-process subagent). Read-only; nothing was run (no tests, lint, typecheck or diagnostics). Scope: the uncommitted diff in `libs/shared` (the foreign `task-tracking/landing-live-demo/HANDOFF.md` was ignored) and `sdk-callbacks.ts`.

Score: 8.5/10. Verdict: APPROVE. No blocking or serious defects. Two minor items and one moderate item are listed below and can ride along with batch 4.

### D1-D8 status

| Defect | Status | Evidence |
| --- | --- | --- |
| D1 zero tokens give $0.00 | Fixed, with spec | An all-zero turn without `usageObserved` returns null, `unknown` basis and `none` coverage (`pricing.utils.ts:543-550`). An observed zero gives a real 0, `estimated` and `full`. Spec `pricing.utils.spec.ts:~655-675` covers both. |
| D2 zero or invalid rate | Fixed, with spec | `validRate` requires finite and `> 0` (`pricing.utils.ts:493-495`). Spec covers 0, -1, +/-Infinity and NaN (`spec:~623-650`). |
| D3 null total with a basis label | Fixed, with spec | Every null path returns `costBasis: 'unknown'`: unknown billing mode, unknown model, `[1m]` base-only, bad counts, zero evidence, missing rate and ambiguous cache. The type doc is updated (`rpc-session.types.ts:487-493`). The spec asserts `unknown` on each path for both billing modes. |
| D4 live-wire comment | Fixed | `session-stats-live.ts:27-30` now says the consumer does not validate these fields. The ` * ` continuation lines are mis-indented by one space (cosmetic; route to style). |
| D5 `[1m]` base rate | Fixed, with spec | `findExactModelPricing` still resolves the base key, but `calculateExactMessageCost` returns unknown when `modelIdUsed !== modelId.toLowerCase()`. A distinct tagged entry wins and is priced (spec `:548-585`). |
| D6 provenance gaps | Fixed, with spec | Missing source, version and date become explicit `null` (`pricing.utils.ts:519-524`), and the `PriceProvenance` doc says so. The spec covers all three nulls. |
| D7 duplicate wire fields | Fixed | `sdk-callbacks.ts` has no diff and carries no new spreads. The optional fields travel only inside the authoritative `sessionStats` object (`sdk-callbacks.ts:441-447`). The existing pass-through spec covers the snapshot. |
| D8 line width | Not checkable here | I did not run Prettier. Several spec expressions are visibly unformatted, for example `{ modelIdUsed: ..., pricing: rates,` on one line at `spec:~528-531`. This is a style matter, not logic; the lint and format gate will catch it. |

### Regression checks

- **Strict TS.** The diff adds no `any`, `ts-ignore` or `as unknown as`. The only `console.warn` (`pricing.utils.ts:245`) already existed and is untouched.
- **Degradation audit.** The new exact-rate code is pure and has no catch blocks, so no audit tags are needed.
- **No invented prices.** The diff adds no catalog entries. Unknown models, unknown billing mode and missing rates all give null, never $0. The spec fixtures use `gpt-fixture-*` names.
- **Host safety.** Every new type field is optional and type-only. `SessionCostBasis` gains the member `'unknown'`, but the union is new. The helpers are not called by any host yet, so Claude payloads for the Electron, VS Code, CLI, TUI and webview consumers are unchanged. The `import type` cycle is erased at compile time.

### Findings

- **Moderate (M1).** `calculateExactMessageCost` rounds through `calculateMessageCost` to 6 decimals (`pricing.utils.ts:430`). A small but real turn, such as a few cache-read tokens at 1e-7 each, rounds to `totalCost: 0` and is labelled `estimated` and `full`. That is a $0.00 for non-zero usage, which D1 was meant to rule out. Either carry the unrounded sum in the exact path or return null/`partial` when usage is positive and the rounded cost is 0. No spec covers this.
- **Minor (m1).** The input and output rates are required whether or not those token classes are used (`pricing.utils.ts:~535`), but cache rates are only required when used. A cache-only or output-only turn on a model with one missing rate becomes unavailable. This is conservative and safe, but inconsistent. Add a spec or document the intent.
- **Minor (m2).** `ResultStatsPayload.costBasis`, `pricingCoverage` and `priceProvenance` (`agent-adapter.types.ts:65-73`) are never put on the wire, because `sendStatsWithRetry` forwards only `sessionStats`. They are inert until batch 4 sets them. `ExactCostResult.priceProvenance` is a single object while the payload and `SessionStatsEntry` carry arrays, so batch 4 must wrap it. The session-stats-owner field-by-field snapshot rebuild (`session-stats-owner.service.ts:~933`) remains an open batch 4 risk, as in the original review.
- **Minor (m3).** Spec coverage gaps:
  - No case for a zero or invalid cache rate on a used cache class.
  - No case for a non-integer or negative token count (`Number.isSafeInteger` guard).
  - No wiring spec for `sdk-callbacks`, which the report already admits.
  - Fixtures written through `updatePricingMap` mutate shared module state across tests (same pattern as the existing specs).

### Five-line verdict

- Silent failure: none found; every missing-evidence path returns null with `unknown`, except the rounding case M1.
- Wrong answer from data: M1 only.
- Dependency shape: invalid rates (NaN, infinities, zero, negative) are rejected.
- Missing requirement: none for this batch.
- Recommendation: APPROVE. Confidence: HIGH on the reading; specs and typecheck were not run.
