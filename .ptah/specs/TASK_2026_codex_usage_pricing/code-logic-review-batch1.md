# Code Logic Review, Batch 1 (Native counter input)

Review family: claude (in-process subagent); implementer: codex (gpt-6-sol).
Scope: `libs/backend/codex-runtime/src/lib/{codex-event-translator.ts, codex-event-translator.spec.ts, codex-runtime.types.ts, codex-protocol-schemas.ts}`. Read-only static review; no tests, typecheck or lint were run (one runs in the background).

Score: 6/10. Verdict: REVISE.

## Check results

1. Schema vs pinned protocol: field names match `TokenUsageBreakdown` (schema.json:25935-25970): five required fields, `cacheWriteInputTokens` optional, default 0. Unknown fields are tolerated (plain `z.object`). Reasoning is kept as a subset of output and never re-added (`counters`, types.ts:193). Invalid payloads are not swallowed, but rejection loses the whole update (D1, D2).
2. Translator accumulation: a repeated total yields an identical snapshot, so nothing is added. Two requests in one turn are exact, because delta = total - baseline. A decrease, or a changed breakdown at an equal `totalTokens`, is flagged and keeps the last good snapshot, so values are never negative. Failed and interrupted terminals carry the last evidence and usage. Compaction does not touch the counters. Child identity is kept by (threadId, turnId) keys. The existing `CodexReportedUsage` shape is unchanged (only an optional `evidence` is added), so the consumers named in the brief still compile.
3. Cache-write assumption: see D1.
4. Strict TS: no `any`, `as unknown as`, `ts-ignore`, non-null `!` or `as never` found in the diff. There is no `console`. No degradation-audit comments were added. The translator has no Logger, so nothing is logged (D4). The spec uses plain string ids, which type-check because the lib defines no branded ids.
5. Spec coverage: covered are two requests plus a repeat, a decrease and an equal-total change, malformed and impossible payloads, failed and interrupted terminals, and compaction plus a child thread. Gaps are in D7.

## Defects

D1 (Serious) codex-protocol-schemas.ts:644-649. The refine `cachedInputTokens + cacheWriteInputTokens <= inputTokens` rests on a cache-write inclusion that the pinned schema does not prove (the report admits this). If native `inputTokens` excludes cache writes, any real update with a cache write larger than the uncached remainder fails validation. The translator then calls `invalid()` (translator.ts:383-390), which emits only a generic `unsupportedNotification` error, or `[]` if the correlation is unparsable. The tokens are lost with no counters, which is the silent loss that U3 forbids. The refine is also on the shared `usage` schema used by `codex-protocol-methods.ts:346-347`, so it widens the rejection to the validator path. The disjoint projection itself cannot go negative while the refine holds, but only because it drops data.
Fix: do not reject. Keep `usage` structurally validated (integers, nonnegative). In `counters()`, when `cached + write > input`, set a `classesInconsistent` flag on the evidence and keep the raw classes with `uncachedInputTokens = max(0, input - cached - write)`. Alternatively treat write as additive in that case. Let the pricing batch refuse to price flagged evidence. Drop the refine from the shared `usage`.

D2 (Serious) codex-protocol-schemas.ts:659-668. The `last <= total` refine across six fields rejects the whole notification. After a resume, a compaction, or any server that reports `total` as a rebased or billable figure, a legitimate update is dropped with only a generic error, and the totals never advance. Fix: validate shape only, and emit the evidence with `resetOrStale: true` or a new `lastExceedsTotal` flag instead of discarding it.

D3 (Moderate) translator.ts:254-277 and 283-287. After a genuine reset, `this.totals` is never rebased, so every later update stays `resetOrStale` and the turn `usage` snapshot stays frozen until the old maximum is exceeded. The absolute evidence still flows, so batch 2 can rebase, but this translator never recovers and nothing documents it. Fix: record an epoch counter in the evidence, or allow the same total to repeat N times after a decrease as a rebase hint. At minimum document the frozen behaviour in the types comment.

D4 (Moderate) translator.ts:272-277, plus the `invalid` path. Stale, reset and rejected usage is reported only as a boolean on an event that no consumer reads yet, and as a content-free error. The plan asks for these cases to be flagged and reported. Fix: inject an optional Logger (or return a typed `usage-rejected` code carrying the field class, with no values) so a rejection can be seen. The same applies to a decrease.

D5 (Moderate) translator.ts:250 and `emit` (371-372). Any usage update arriving after the turn terminal is dropped (`terminals.has`). That breaks U3 whenever a final totals update trails `turn/completed`, which is plausible for failed or interrupted turns. This is pre-existing, but U3 depends on it now. Fix: for a late update on a terminated turn, still emit the evidence, with `terminalState` set to the recorded terminal status, or at least record it in `totals`. Add a spec.

D6 (Minor) translator.ts:268. `Date.now()` is not injectable, and the spec only asserts `expect.any(Number)`. Inject a clock, or document that the timestamp is receipt time.

D7 (Minor) spec. No test for a `cacheWrite`-heavy rejection or acceptance case (after D1 is fixed), none for a late update after a terminal (D5), none for a stuck stale thread (D3), and none for a stale update when no prior snapshot exists (the empty `usage: {}` branch at translator.ts:275). Confirm that `codex-chat-events.ts` treats an empty usage object as a no-op rather than a zero total.

D8 (Minor) `src/index.ts`. `CodexUsageEvidence` and `CodexUsageCounters` are not re-exported, so batch 2 cannot import them through the package alias. Add the export.

D9 (Minor) translator.ts:329-331. A terminal whose last usage update was flagged stale carries the earlier accepted evidence. That is acceptable, but it should be stated in the comments: the terminal evidence is the last accepted evidence, not the last observed one.

## Notes

- U3 child threads: the translator keeps identity, but `codex-context.ts:404-410` still filters child-thread events, so batch 1 alone does not deliver child usage. This is out of scope and correctly deferred to batch 2.
- Repeated identical totals are re-emitted as full usage events with `resetOrStale: false`. Downstream owners must dedupe by comparing the totals, as the type comment says.

## Round 1

Score: 8/10. Verdict: APPROVE (batch 2 carries the deferred items below). Static read only; no tests, typecheck or lint were run.

### D1-D9 status

- D1 FIXED. The cross-class refine is removed from the shared `usage` (codex-protocol-schemas.ts:636-644, now only nonnegative safe integers). The translator keeps raw classes and flags `classesInconsistent`/`cacheSemanticsAmbiguous` (codex-event-translator.ts:282-292). `counters()` clamps uncached at 0 (:35-47). Spec: spec.ts:421.
- D2 FIXED. The `last <= total` refine is gone. `lastExceedsTotal` is flagged and the baseline falls back to ZERO_USAGE (translator.ts:281, 333-336). Spec: spec.ts:435.
- D3 FIXED for the explicit-marker path, DEFERRED for the pinned protocol. `counterReset` is optional in `tokenUsageNotification` (schemas.ts:652-656). A reset starts an epoch, zeroes the baseline and carries the prior turn usage as an offset (translator.ts:322-327). Spec: spec.ts:458. Without a marker, a decrease stays stale. This is recorded in the report's open risks and is acceptable as deferred.
- D4 FIXED. Content-free `diagnostics` on the evidence and a typed `usageNotificationInvalid` error with `diagnostic: 'invalid-payload'` (types.ts:203-221, 320; translator.ts:269-271, 293-298, 432-445). Nothing logs, but the reason is observable.
- D5 FIXED. Terminal status is kept in a Map, and usage is emitted after the terminal with `terminalState` set (translator.ts:300, 389, 427). Spec: spec.ts:482. codex-context.ts:401-405 still drops post-terminal and child events before host consumers. That is the deferred batch-2 filter, recorded in the report.
- D6 FIXED. Injectable `now` defaults to `Date.now` (translator.ts:150).
- D7 FIXED. Cache-write, `last > total`, empty-snapshot stale, reset and late-usage specs are added (spec.ts:421-496). The `usage: {}` no-op is confirmed in codex-chat-events.ts:272-283, per the report.
- D8 FIXED. `CodexUsageCounters`, `CodexUsageEvidence` and `CodexUsageDiagnostic` are re-exported (index.ts:22-24).
- D9 FIXED. The comment is at translator.ts:376. A stale update never writes `this.evidence`, so the terminal carries the last accepted evidence.

### Regression checks

- `usage` still validates every previous payload except negative values, which the old `integer` schema accepted. codex-protocol-methods.ts:343-350 still builds `tokenUsage` from `usage`, so it stays compatible. Optional keys such as `parentThreadId` and `counterReset` are read from the raw params, because codex-context.ts:410 passes the raw frame to the translator.
- The turn-delta output for a normal sequence is unchanged: `total - baseline`, with the same baseline derivation, plus `lastRequestTotalTokens` and `modelContextWindow`. `cacheWriteInputTokens` is now always present in the usage as 0 when omitted. This is harmless to the codex-chat-events consumers (the field already existed) but is a small shape delta.
- No negative or double-counted classes. Totals only advance when `totalTokens` strictly grows (or on a proved reset), and any per-field decrease or equal-total change is stale and not accepted. The reset offset is the key's prior usage, so a second reset in one turn does not double-count. The uncached projection is clamped.
- Strict TS: no `any`, `as unknown as` or non-null `!` in the diff. Specs use plain string ids and `counterReset?: true`, which type-check. This is by reading only; ts-jest was not run.

### New defects

N1 (Minor) translator.ts:`dispose` and :388-392. The `usage`, `baselines`, `evidence` and `epochTurnOffsets` entries are no longer deleted at the terminal (done on purpose for late usage). They grow per turn until `dispose`, as the `terminals` map already does. Fix: batch 2 should cap or expire entries after a grace period.

N2 (Minor) translator.ts:300-310. A late usage event after a terminal is emitted with an updated turn `usage`, but the terminal event already carried the older snapshot. Consumers must prefer the later event. Fix: batch 2 documents or enforces this when it removes the codex-context filter.

### Deferred (acceptable)

codex-context.ts:401-410 child-thread and post-terminal filtering; a reset marker absent from the pinned protocol; cache-write inclusion unverified (flagged as ambiguous); first-turn baseline across a persisted lifetime checkpoint.
