# Code Logic Review (Phase 3) — `TASK_2026_692_f748`

Scope: `git diff -w ec61276b1..HEAD -- libs/` (Batches 14-17). Read in full: the transformer stamp, `IdleCompactionService`
notice map and `idle-session.reducer.ts` notice effects, `ConversationRegistry` marker methods, accumulator, streaming-handler,
chat.store, `CompactionLifecycleService` (both marker writes), chat-view, marker component. Orchestrator-run specs and typechecks
were taken as given; I ran nothing.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | APPROVED       |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

## Checks requested

### 1. Notice reaches the marker only for an idle-caused boundary

- Producer order is correct. `StreamTransformer` runs `onMessage` (the compaction tap and executor `observe`) before it transforms the
  message (`stream-transformer.ts:541-547`). `observe` calls `idle.compactBoundary` (`session-query-executor.service.ts:282`), and
  `enqueue` drains synchronously (`idle-compaction.service.ts:~420-440`). So `set-notice` (`idle-session.reducer.ts:262-270`) has run
  before `transformCompactBoundary` reads it (`system-message.transformer.ts:109`). Both sides use the SDK message `session_id`, so
  rekeyed ids line up. `set-notice` fires only from `precompact` or `postcompacted` phases of an in-flight idle attempt, so a manual
  or auto boundary with no attempt never creates one.
- Lifetime of `notices` (`idle-compaction.service.ts:68, 266, 287-295, 490`). The notice is not consumed on read. It is cleared by:
  - `input` (reducer:137; `sendMessage` calls `input` at `session-lifecycle-manager.ts:722`);
  - `session-bound` with a new `runToken` (reducer:106; every `executeQuery` relaunch, so the manual `executeSlashCommandQuery`
    route, which does not call `input`, still clears it);
  - the next `turn-ended` once the idle period is closed (reducer:181);
  - `pre-compact` in `postcompacted` (reducer:237);
  - group teardown and dispose.

  A later manual `/compact` or auto boundary therefore cannot pick up the earlier notice via any normal path. This is lifetime-based,
  not boundary-keyed (see Moderate 1).
- PostCompact advisory fallback: D4 holds. The fallback path carries no `idleCompaction`; a boundary-less write cannot match
  `sameBoundary` and drops it (`conversation-registry.service.ts:306-308`). A late authoritative boundary restores it
  (`mergeLateCompactionBoundary`, lifecycle:776-784).
- Reload from persisted state: `readPersisted` validates finite, number and >= 0 (`conversation-registry.service.ts:392-397`). A
  malformed value is dropped to generic text. The persisted notice is tied to the persisted marker of the same conversation. Different
  tabs/conversations key by conversation id, and `chat-view` resolves the marker per tab (`chat-view.component.ts:1312-1320`).

### 2. ConversationRegistry

- `setCompactionMarkerTokens` (:303-308): `fields.idleCompaction ?? (sameBoundary ? prior.idleCompaction : undefined)`. A new boundary
  without a notice drops it; the same boundary re-written without one (summary-only or late merge) keeps it. `sameBoundary` requires a
  non-empty id, so two boundary-less writes do not falsely merge. Correct.
- `setCompactionMarkerSummary` (:345-348): keeps the notice only for the identical boundary id. Correct. The caller passes the
  boundary id only when the generation is authoritatively complete (lifecycle:641-645), so a summary arriving first drops nothing
  that the later authoritative write will not re-supply.
- Both `setCompactionMarkerTokens` call sites (lifecycle:520-528 and 776-784) forward `result.idleCompaction`.

### 3. Forwarding hops

All present, no hop drops the field: `stream.ts:291` → accumulator result type and return (`accumulator-core.service.ts:139, 586`) →
streaming-handler return type at :205-208 and the internal result type at :414-418 → `compactionComplete` call at :495-499 →
`chat.store.ts:428` → `handleCompactionComplete` param (lifecycle:363) → both registry writes → `chat-view.component.html:96` →
`CompactionMarkerComponent.idleCompaction` input. The second streaming-handler `compactionComplete` site (:569, background) uses the
same result object, so the notice is not lost for background tabs.

### 4. Marker component

`compaction-marker.component.ts:24-31` renders `Compacted while idle to save usage before the prompt cache expired (was {{format}}
tokens).` for a set input and `Context compacted` otherwise. This matches AC 6.1 text, and `format` is the same `toLocaleString`
used by the token line. "manual" appears nowhere in the component (AC 6.2). The idle text and the "· pre → post" token line both
show the pre-token count; harmless duplication.

## Five logic questions

1. Silent failure: if the notice map is cleared before the transformer reads it, the user sees the generic marker. That degraded
   outcome is correct per the plan, never a wrong idle text.
2. User action: typing into the session after an idle compaction clears the notice before any later boundary. A manual `/compact`
   via `executeSlashCommandQuery` clears it through the new `runToken`.
3. Wrong-answer input: a non-finite `pre_tokens` falls back to `attempt.contextTokens` (reducer:268), so the number shown is never NaN.
4. Dependency failure: if the idle service is absent or throws, the optional call (`idleCompactionNoticeFor?.`) yields no notice and
   the generic marker shows. `session-lifecycle-manager.ts:745` uses `?.` on a possibly undefined service.
5. Missing: no test exercises the transformer reading after a clearing event; the stale-read protection is entirely in the reducer.

## Failure modes

### Stale idle text on a marker whose boundary was invalidated

- Trigger: `markCompactionStart` or `setCompactionState({inFlight:true})` runs `invalidateMarkerMeasurement`
  (`conversation-registry.service.ts:187-194, 237-239, 415-423`), which spreads `...prior` and clears only `boundaryId` and
  `measurement`. `idleCompaction` (and the old pre/post tokens) survive.
- Symptom: a later manual or auto compaction that starts and then fails or times out (the lifecycle safety timeout) leaves the old marker
  visible with "Compacted while idle ..." text, now unrelated to the latest compaction. It is hidden only once a later user message
  exists (`chat-view.component.ts:1305-1308`).
- Current handling: the next successful completion overwrites it correctly. An advisory fallback with no boundary id also drops it.
- Recommendation: include `idleCompaction: undefined` in the invalidated marker (:419).

### Notice lifetime is time-based, not boundary-keyed

- Trigger: the backend notice stays in `notices` from `compact-boundary` until a clear event (see Check 1). Any path that produces a
  second `compact_boundary` for the same session with no `input`, `session-bound` or `turn-ended` in between (for example an SDK-initiated
  auto compaction in a background-task turn started without user input) would be stamped as idle.
- Evidence: `idle-compaction.service.ts:490` returns without consuming; the reducer clears only at the events listed above.
- Current handling: very unlikely path (the clear on the compaction's own `result` turn-end closes most of the window).
- Recommendation: make `boundaryNoticeFor` consume the entry (delete on first read), or record the boundary uuid at `set-notice`.

### Marker still visible after a failed new compaction

Covered by the first failure mode; same remedy.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. Moderate: `invalidateMarkerMeasurement` retains `idleCompaction` (`conversation-registry.service.ts:419`). A spec should pin that
   `markCompactionStart` clears it.
2. Moderate: backend notice is not consume-on-read (`idle-compaction.service.ts:490`). The plan's "never wrong idle text" rests on
   clear-event ordering. A spec that drives two boundaries on one session without an intervening clear would document the contract.
3. Minor: idle sentence and token line repeat the pre-token figure (`compaction-marker.component.ts:24-33`).
4. Minor: `readPersisted` accepts an `idleCompaction` on a record without a `boundaryId`; harmless since it is only displayed with that
   marker.

## Data flow

1. SDK `compact_boundary` message: executor `observe` sets the notice (OK, runs before the transform).
2. `transformCompactBoundary` stamps `idleCompaction` on `compaction_complete` (OK).
3. Accumulator result (OK) → streaming-handler results, foreground and background (OK) → `chat.store` (OK).
4. `handleCompactionComplete` / `mergeLateCompactionBoundary` → registry writes (OK; gap: invalidation, Moderate 1).
5. Persisted via `writePersisted`, validated on read (OK).
6. `chat-view` binds the marker; the component renders idle or generic text (OK).

## Requirements fulfilment

| Requirement                                   | Status   | Gap                                       |
| --------------------------------------------- | -------- | ----------------------------------------- |
| AC 6.1 notice text and N format               | COMPLETE | none                                      |
| AC 6.2 no manual label                        | COMPLETE | none                                      |
| AC 6.3 no notice on skip/cancel               | COMPLETE | no `set-notice` outside boundary phases   |
| AC 6.4 manual/auto boundary shows no idle text | COMPLETE | relies on clear events; see Moderate 2    |
| D4 advisory fallback generic                  | COMPLETE | none                                      |

Implicit requirements not addressed: clear the idle text when a later compaction starts (Moderate 1).

## Edge cases

| Case                                 | Handled | How                                  | Concern                         |
| ------------------------------------ | ------- | ------------------------------------ | ------------------------------- |
| Rekeyed session id                   | YES     | same SDK `session_id` both sides     | none                            |
| Persisted garbage notice             | YES     | finite >= 0 validation               | none                            |
| New boundary without notice          | YES     | dropped in token write               | none                            |
| Compaction start invalidation        | NO      | `idleCompaction` survives            | Moderate 1                      |
| Second boundary with no clear event  | PARTIAL | not consume-on-read                  | Moderate 2                      |
| Different tab/conversation           | YES     | per-conversation marker              | none                            |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (static trace only; no specs run by me)
- Top risk: stale idle text on an invalidated marker after a failed later compaction (`conversation-registry.service.ts:419`).
- What a robust implementation would add: clear `idleCompaction` in `invalidateMarkerMeasurement`; make the backend notice consume-on-read
  or boundary-keyed; add specs for both.
