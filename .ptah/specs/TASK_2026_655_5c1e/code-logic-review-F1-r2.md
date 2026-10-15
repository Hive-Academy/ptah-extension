# Code Logic Review F1, round 2 (re-review) - TASK_2026_655

Reviewer: Claude family (independent of the codex implementer). Read-only review; no jest/nx run.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 2 |

Scope read in full: `persisted-content-filter.ts` (499 lines) and `persisted-content-filter.spec.ts`
(564 lines), in chunks; the round-1 review; `batch-F1-report.md` `## Revise round 1`; the addendum rule
T text at `:1040-1069`. The four round-1 orderings were re-traced against the new code, and the new
tests were traced by hand (event by event) against the filter state, not just read for names. I did
not run the specs (the orchestrator runs checks serially), so "would fail on the defect" below is
established by tracing the pre-fix behaviour recorded in the round-1 review, not by execution.

## Round 1 resolution

| Defect | Status | Evidence |
| --- | --- | --- |
| 1. Non-history `tool_start`/`tool_delta` absorbed as a thinking prefix (content loss) | RESOLVED | `absorb` now only accepts `AbsorbableEvent` (text/thinking/signature), `persisted-content-filter.ts:25,267`. Tracked path: a tool event that is not a history tool reaches `:408` and returns `mismatch` (release + keep) before `joined`/`kind` are computed; the already-positioned path returns `mismatch` at `:391` (unreachable today because tool blocks are never absorbed, harmless). The beyond-page branch `:401-406` keeps it. Pre-snapshot path: `preStream` handles tool events in its own branch `:332-335` (history tool: drop; otherwise flush the anchor and keep) before any text/thinking comparison. Re-traced the original ordering (`H = [thinking "t"]`, stream `tool_start toolu_9`): tracked, `pos = ks = 0`, `:408` mismatch, anchor released, event kept, later `tool_delta`s hit `phase = 'pass'` and are kept. No new loss or duplicate path: the complete path compares by signature (`same`, `:432`) and was never affected. |
| 2. Pre-snapshot complete non-block event kept the whole batch (duplicate agent, head, tail) | RESOLVED | `:319`: in an open pre-batch whose block events were all dropped, any non-content event is dropped without touching `preBatchDropped`; `:300-306` then drops `message_complete` and the queued complete head. Trace: `message_start(complete)` held, `tool_start(complete, t)` matches `H[0..k0)` and drops, `agent_start` drops at `:319`, `message_complete` drops and the head is filtered out of the queue. A kept block (`:320`) clears `preBatchDropped`, so a batch with any kept content still keeps its tail and non-block events. Zero-block batch: head and tail both dropped. |
| 3. Rule T stored the redelivery record when reconcile found no node; retired filter did neither | RESOLVED | `:181-185`: the record is stored only when `reconcileHistoryToolResult` returns `true`; a `false` leaves the next redelivery kept and re-reconciled (no record, no drop). Retirement: `:108-112` returns `keep` unconditionally for every event; for a `tool_result` whose id is in `historyToolIds` it calls `reconcileRetiredResult` (`:187-189`) only when the stored record differs or is absent, and `retire(true)` sets `retiredDiscarded` (`:155`) so it never calls the callback of a tab that no longer owns the session. This is exactly the orchestrator decision: always keep after retirement, reconcile only when changed or unrecorded, record only on `true`, nothing dropped. Pre-retirement `result()` `:168-175` is unchanged except for the store condition. No new loss: a real result is never dropped unless it equals a stored non-synthetic record. |
| 4. Throwing `deliverToTab` left already-delivered events queued | RESOLVED | `flush` `:229-236` splices the entry before delivering it; `release` `:238-249` and `retireState` `:479-491` `shift()` before delivering, and a slot is removed from `state.blocks` before `rebuild`. After a throw the remaining entries stay queued exactly once; delivered ones are not replayed. No double delivery path found; the only residual is a partially rebuilt block (see Minor 2). |

## Missing tests

All 16 items are now covered. "Fails on the defect" is by trace of the pre-fix code.

| # | Item | Test (spec line) | Would fail on the defective behaviour? |
| --- | --- | --- | --- |
| 1 | Defect 1, non-history tool vs thinking; tool id differs from `H[ks]` | `:291` (tracked), `:302` (P3), `:312` "different tool" | Yes: pre-fix returned `drop` for `tool('toolu_9')` against `H = [thinking]`; both assert `keep` and `delivered = [anchor]`. |
| 2 | R-B3d tool and text variants against `[text n1, tool toolu_9]` | `:312-323` (`it.each`) | Yes for the tool variant now asserts `keep` plus anchor release, and the text variant asserts the stream-mismatch release. |
| 3 | Tracked beyond-page block, with and without a loose block | `:325`, `:334` | Yes: `:334` asserts the loose `a` (blockIndex 1) is rebuilt after the anchor and before the kept block (`delivered[1]`). Traced end to end. |
| 4 | R-B1s(c) unpersisted pre-snapshot prefix | `:346` | Yes: asserts `keep`, `delivered = [anchor]`, and the continuation kept. |
| 5 | R-B1s(a) end to end with deferred anchor | `:358` | Yes: asserts `delivered = [anchor, deferred]` after the later block and none extra at the terminal. |
| 6 | R-B6 case 2 | `:376` | Yes: asserts the head is released before the kept text and the tail kept. |
| 7 | R-B5 stream subagent text after kept thinking | `:388` | Yes (drop asserted after the kept thinking). |
| 8 | R-B3c large prefix, exact and changed complete, terminal | `:395` (2500 deltas, two variants) | Yes for the rebuild/discard outcome (`delivered` has no text_delta only in the exact variant). Weak point: the terminal-discards-the-anchor claim is not asserted (see Minor 1). |
| 9 | Thinking rebuild order and fresh id | `:407` | Yes: asserts event order, merged `thin`, id differs from the first delta. |
| 10 | P3 first `thinking_start`/`signature_delta`; passed block | `:426` | Yes for absorb/pass; the rebuilt `thinking_start`/`signature` content is not asserted, only `delivered[0]`. |
| 11 | Tool identity advances `ks`/`k` | `:438` | Yes: if identity did not advance, the stream text at index 1 would be compared with the tool at `H[0]` and mismatch. |
| 12 | Pre-snapshot complete non-block event; zero-block batch | `:451`, `:461` | Yes: pre-fix `agent_start` was `keep` and the tail `keep`. |
| 13 | Retirement ordering with kept content / loose mix | `:469`, `:479`, plus `:261,271` | Yes: queued delta delivered before the terminal, loose blocks `par`,`oth` released in order after the anchor. |
| 14 | Rule T cases: isError-only, JSON inequalities, reconcile `false`, post-retirement | `:494`, `:509`, `:518` | Yes: array vs object, extra key and `undefined` field each force a reconcile; `:509` asserts two reconcile calls (pre-fix would drop the second); `:518` asserts reconcile counts 1 then 2 and no call after `retire(true)`. |
| 15 | Throwing `deliverToTab` | `:533`, `:549` | Yes: pre-fix both would redeliver the anchor (`:533`) or the anchor and rebuilt block (`:549`); both assert the exact delivered list. |
| 16 | Rename the misleading `:204` test | `:204` now reads "handles three history records in one complete batch then passes later blocks" | Done. |

## Defects

None of Blocking, Serious or Moderate severity found in the changed code.

### Minor 1 - R-B3c terminal assertion is incomplete (test only)

File: `persisted-content-filter.spec.ts:403-404`. Ordering: 2500-delta absorbed prefix, exact complete
batch drops, terminal `turn_state`. The test asserts only that no `text_delta` was delivered; the anchor
`message_start` being discarded (retirement with nothing kept, `persisted-content-filter.ts:478`) is not
asserted. A regression that flushes the anchor at retirement would not be caught. Correction: add
`expect(delivered).toEqual([])` for the exact variant.

### Minor 2 - A throw inside `decide` drops the triggering event and can leave a half-rebuilt block

Files: `persisted-content-filter.ts:251-260` (`rebuild`), `:461-467` (`mismatch`), `:156-159` (`retire`).
Ordering: `deliverToTab` throws while `mismatch` releases the queue, or inside `rebuild` after
`thinkingStart` but before the merged delta, or inside `retireState`. `decide`/`retire` propagate, so the
event that caused the mismatch is never returned as `keep` for that tab, a rebuilt block is partly
delivered, and after a throw in `retire` the remaining queue is never released (the filter is already
`retired`). This is the spec's per-entry try/catch model (`addendum:1503`), exceptional, and it is not a
regression of this round (round 1 had the same property plus redelivery). Correction if wanted in F2: the
caller treats a thrown `decide` as `keep` for that tab.

## Notes

- `persisted-content-filter.ts:391` (positioned existing block + tool event) is unreachable because tool
  blocks are never absorbed; harmless.
- Spec-level, unchanged from round 1 and not a regression: rule T's first bullet drops a result equal to
  the stored non-synthetic record. If the same tool were rendered live after a mismatch release, its live
  node would not receive that identical result (`addendum:1053-1058` assumes the live node shows it).
  This needs a decision in F2 only if the mismatch-then-live-tool case is considered reachable.
- The `discardLoosePrefix` prefix-only matching note from round 1 stands (spec-mandated).

## Verdict

APPROVED, score 8/10. All four round-1 defects are fixed at the cited lines, the orchestrator's
post-retirement decision is implemented exactly, no new loss or duplicate path was found by tracing, and
every one of the 16 missing-test items has an assertion that distinguishes the defective behaviour. The
two Minor items are optional follow-ups; neither blocks F2 wiring.
