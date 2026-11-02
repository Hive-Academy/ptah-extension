# Code Logic Review, Batch 6 (rich Codex quota DTO)

Score: 6/10. Verdict: REVISE. Blocking 0, Serious 1, Moderate 4, Minor 2.
Scope: diff read for codex-account-usage.types.ts, codex-account-usage-client.ts, codex-plan-usage.reader.ts, plan-limit.types.ts. Spec files and the lane report were not read. No tests were run (as instructed).

## Serious

### S1. The default `rateLimits` snapshot is dropped when `rateLimitsByLimitId` has no `codex` key
- File: codex-account-usage-client.ts usageResult (`orderedIds` / `buckets`, about lines 133-160), consumed by codex-plan-usage.reader.ts (`result.buckets ?? [...]`).
- Scenario: the response carries `rateLimitsByLimitId` with only non-codex ids, or ids that do not include `codex`. `buckets` then contains only the hashed buckets, and the default `response.rateLimits` is never emitted as a bucket.
- Before this batch the code fell back to `response.rateLimits`. Now the reader uses `result.buckets` and ignores `result.quota`, so the default windows disappear.
- Impact: the plan shows no primary or secondary window although the provider returned them. This conflicts with the requirement to preserve both `rateLimitsByLimitId` and the default limits.
- The `?? response.rateLimits` inside the map (about line 148) is dead code, because the key always exists.
- Fix: when `codex` is not among the ids and `rateLimits` has any value, prepend a `codex` bucket built from `response.rateLimits`.

## Moderate

### M1. The active bucket's window keys change for every qualified response
- File: reader toWindow (about lines 165-175).
- With `qualified` true, the key becomes `other:codex:primary`, replacing the duration-derived `five_hour` / `weekly`. The `kind` is kept.
- Ledger rules, history and cooldowns key on `window.key` (plan-limit-ledger.rules.ts, plan-limit-tiles.ts `windowKey`). Existing persisted state keyed `five_hour` therefore stops matching.
- The plan asks for "stable bucket-qualified keys", but it should also cover continuity for the existing `codex` bucket.
- Fix: keep the descriptor key for the `codex` bucket and qualify only the other buckets. Otherwise record the migration as deliberate.

### M2. Non-codex labels are position-based, not stable
- File: client about line 150, `Limit ${position + 1}`.
- The position comes from the lexical order of native ids, so a newly appearing id shifts the labels of the others. The keys stay stable (a hash of the native id), but the user sees "Limit 2" turn into "Limit 3".
- This is acceptable only if documented. Alternatively derive the label from the hash order or a sanitised `limitName` allowlist.

### M3. Boundary validation is a hand-rolled partial check, not Zod
- File: client `safeCode` / `safeDecimal` / `bucket`.
- `primary` and `secondary` are spread through unvalidated, including any extra native fields (frozen copies, but they travel in the DTO).
- `individual.remainingPercent`, `individual.resetsAt` and `credits.hasCredits` / `unlimited` are not type-checked.
- Throws on a malformed shape (for example null `rateLimits`) are caught by the read-level `catch`, which gives `stale` or `unavailable`. So the reader is not killed, but a single bad field discards the whole snapshot instead of that field.
- I did not verify whether `child.request` already applies a response Zod schema upstream (the notification path does use `safeParse`). If it does not, the "Zod at the boundary" requirement is unmet.
- Fix: parse the response (or each bucket) with a schema and drop only the invalid fields. At minimum, pick `usedPercent` / `windowDurationMins` / `resetsAt` explicitly instead of spreading.

### M4. Window-less bucket evidence is lost
- File: reader. `reachedType` and `spendControlReached` are attached only to windows.
- A bucket with a reached type or spend-control flag but no primary or secondary window loses both. The allowances only carry credits and individual.
- Note that `rateLimitReachedType` is also gated by the `atLimit` check for exhaustion. That is correct and no zeros are invented.

## Minor
- m1. The reader builds `normaliseInstant(...)` twice per `resetsAt` (about lines 95-115). Compute it once.
- m2. `resetCreditsAvailable` / `upsellAvailable` are set to `true` on mere presence of the object. That fits "boolean availability", but the detail is not preserved and the semantics are lossy if the payload carries a disabled state. Confirm against the protocol schema.

## Checks requested
- Malformed or partial payloads: invalid decimals, bad reached-type codes and bad plan types are dropped (client `safeCode` / `safeDecimal`). Missing windows give no window and no zero. A throw is handled at the read level (see M3). OK apart from M3.
- Key collisions: the sha256 slice is 64 bits per id, which is negligible risk. The `codex` id is reserved and unhashed, so only the literal id `codex` can map to it. OK.
- Ordering: `codex` first, then lexical by native id, and primary before secondary per bucket. This is deterministic, but note the reader comment says "client-provided order". OK.
- Unlimited credits: `balance` is omitted when `unlimited` is true (client credits block). The numeric balance cannot render for unlimited. The renderer must still check the `unlimited` flag, and no frontend consumes it yet. OK.
- Service dropping the owner-level fields: the new shared fields are all optional, so old producers and consumers are unaffected. Windows carry `bucketId` / `reachedType` / `spendControlReached` and do flow through the ledger. The allowances, credits, individualAllowance and reset/upsell flags are produced but unconsumed until the service is wired. That is coherent and harmless, but it is dead data until a later batch. Make sure that batch is tracked.
- Strict TS: the `as const` template key is valid against `other:${string}`. The spreads of `false` / `undefined` in object literals pass strict mode. I could not run the typechecker.
- No Codex-specific frontend branch: the shared types are provider-neutral and I found no frontend change. OK.

## Verdict
REVISE: fix S1, and decide on M1. M3 should be confirmed or fixed before relying on the boundary guarantees.

## Round 2

Score: 8/10. Verdict: APPROVE (0 blocking, 0 serious, 1 moderate residual, 2 minor). I read the code in the working tree (codex-account-usage-client.ts 70-260, codex-plan-usage.reader.ts 75-170, the report's Revision 1). I did not run anything, and the spec files were not read, so the lane's spec line citations are unchecked.

### Resolution
- S1 resolved: usageResult prepends a default `codex` bucket when the id map has no `codex` key (client, around "defaultBucket"), and the compatibility `quota` is derived from the active bucket.
- M1 resolved: the reader qualifies keys only when `bucket.id !== 'codex'` (reader toWindow). The `codex` bucket keeps the duration-derived `five_hour` / `weekly` keys. `bucketId` is still attached.
- M2 resolved: the label is `Limit ${id.slice(-6)}`, derived from the hash, independent of position and stable under insertion. It is opaque to users but leaks nothing.
- M3 acceptable as is. `usageResult` now takes `unknown` and every field is parsed with Zod, dropping only the invalid subfield (per-window, individual limit, credits, decimal, code). Wire-level all-or-nothing rejection in `CodexAppServerProcess` is an upstream choice, and a rejected response ends in stale or unavailable, which is the safe outcome. Accepting this depends on the lane's claim about the process, which I did not re-read. Recommend a follow-up note, not a blocker.
- M4 resolved: the allowance now carries `reachedType` / `spendControlReached` and is emitted for window-less buckets.
- Minors resolved: the individual reset is normalised once.

### Residual
- R1 (moderate, narrow): if `rateLimitsByLimitId.codex` exists but is malformed or empty, it is filtered out (`Object.keys(entry).length > 2`). The default `rateLimits` is then not prepended, because the check is `!byId?.['codex']` on the raw key. A valid default snapshot is lost in that case. Fix: test whether an emitted `codex` bucket exists, not whether the raw key exists.
- R2 (minor): `Limit abc123` labels read as noise to users. A neutral ordinal shown by the frontend may be nicer, but it must not use position-based identity.
- R3 (minor): the reset/upsell flags remain presence-only, as noted.
- No regression found: ordering (`codex` first, then lexical), primary before secondary, unlimited credits omit `balance`, and no frontend changes. Owner-level fields are still dropped by the plan usage service, which remains a tracked follow-up.

## Round 3 (R1)

Verdict: APPROVE

- R1 resolved. `codex-account-usage-client.ts:216` drops a codex bucket with <=2 keys (malformed `{ primary: 'malformed' }` yields only id+label); the guard at `:218-222` now tests emitted buckets (`buckets.some(e => e.id === 'codex')`) instead of the raw key, so the default `rateLimits` bucket is prepended.
- Ordering: unshift places codex first, consistent with the sort at `:198-202`; a valid codex bucket still suppresses the default (no duplicate id).
- `quota` (`:223,235-241`) derives from `buckets.find(id==='codex')`, so it now picks up the fallback windows. `planType` (`:224-234`) falls back to `rateLimits.planType` when the codex fields lack one or fail parsing; unchanged and correct.
- Spec `codex-account-usage-client.spec.ts:407-415` exercises exactly this path (pre-fix it produced no buckets and no quota, so it would fail). Types are fine: `buckets?.[0].primary?.usedPercent` mirrors the existing usage at `:425`/`:443`. Assertions avoid `windowDurationMins`, so they do not depend on extra emitted fields.
- No new findings. Residual: no test covers planType fallback in this malformed-codex case (minor).
