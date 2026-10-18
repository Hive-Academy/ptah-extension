# Plan review - TASK_2026_698_4146

| Field | Value |
| --- | --- |
| Documents reviewed | `task-description.md`, `implementation-plan.md` |
| Author | codex CLI lane |
| Reviewer | Claude subagent (in-process, cross-side) |
| Revision | 2 |
| Round | 2 |
| Verdict | **APPROVED** (round 1: REVISE) |

The overall shape is right. The plan reuses `MainRequestTracker` and `IdleCompactionService`, stores the
projection on the stats owner, carries it nested in `SessionStatsEntry` over the two existing events, and puts
the tile on the correct surface. Five issues need fixing before implementation. Two of them change the
contract (items 1 and 2), and one is a lost-update path (item 3).

## Citation spot-check

| Plan claim | Result |
| --- | --- |
| Tracker anchor near request start, usage from assistant frame (`idle-request-tracker.ts:57-68`) | Verified. `anchorAt = max(turnStart, lastNonRequestFrameAt - 5s)` (:60-63); usage at :66-68. |
| Usage split only when `cache_creation` present (`subagent-budget-monitor.ts:222-235`) | Verified (:225-235). |
| Idle types and pending `fireAt` (`idle-compaction.types.ts:157-199`) | Verified. The pending attempt also has `expiresAt` (:164). |
| `onTurnEnd` before result accounting, settle in `finally` (`stream-transformer.ts:695-705, 905-1005`) | Verified (:696-705, :1002-1006). |
| Teardown calls `dispose` before `onStreamEnd` | Verified (`stream-transformer.ts:1092-1101`). |
| Owner watcher, revision, watch, release (`session-stats-owner.service.ts`) | Verified. `OwnerWatcher` :372-380, `watch` :662-674, `release` :706-727. |
| Live parser checks only the envelope (`session-stats-live.ts:20-38`) | Verified (:23-29). |
| Revision floor admits equal, rejects lower (`session-stats-snapshot.ts:58-90`) | Verified (:83-90). |
| Inspector is the right-sidebar tile | Verified. `chat-view.component.html:285` mounts the inspector only while `shell.isOpen()`. `session-inspector.component.html:38-46` mounts `ptah-inspector-session-stats`. The plan correctly keeps `SessionStatsSummaryComponent` out of scope. |

## Blocking / serious items

### 1. Expiry is anchored to request end. The server refreshes the TTL near request start.

- Evidence: the cache entry's lifetime restarts when the server reads or writes it during prefill, which happens
  at the start of the request. The existing idle code already relies on this. It anchors to the start
  (`idle-request-tracker.ts:57-63`) and derives `IdleAttempt.expiresAt` from that anchor
  (`idle-compaction.types.ts:162-164`). The plan instead adds a new `endedAt` taken from the last assistant
  frame (plan :19-20; task-description AC1/AC2 and "Risks").
- Failure: a main request with extended thinking plus a long answer can run 2-4 minutes. On a 5-minute TTL
  (API key), the tile then shows "expires in 5 min" when the real remaining time is 1-3 min. The user sends
  a message expecting a cache hit and gets an uncached re-read, which is exactly the outcome the feature
  exists to prevent. The tile and the idle line also drift apart: the idle `fireAt` is anchor-based and the
  tile would be end-based.
- Fix: set `lastRequestAt` to the last main request's existing `anchorAt` (conservative, and identical to the
  idle service's basis). Set `expiresAt = anchorAt + TTL`. Do not add `endedAt`. Update AC1, AC2, the wire
  comment (plan :33) and the "Risks" bullet. The tracker change shrinks to recording cache evidence only. The
  user's brief said "end", but it also said "validate in the plan, do not treat as final". Record this as a
  decision in `decisions.md` (options: end / message_start time / anchor; chosen: anchor). If the orchestrator
  keeps "end", record it as an explicit deviation from conservative behaviour.

### 2. No gate for non-Anthropic routes through the Claude SDK

- Evidence: the agent-sdk path also serves proxied providers through `ANTHROPIC_BASE_URL`.
  `resolveCapacityRoute` returns `{kind:'native', providerId:'anthropic'}` only for a direct Anthropic
  connection (`session-query-executor.service.ts:97-101`), and `{kind:'proxy', ...}` otherwise
  (OpenRouter, Copilot, Codex proxy, others: :102-144). The tap's session class carries only
  `codexProxy` (:675-678). The plan says "non-Claude sessions produce no `cache`" (plan :44) but gives no
  mechanism. Its only filter is the usage shape.
- Failure: an Anthropic-compatible proxy that echoes `cache_creation.ephemeral_5m_input_tokens` gets a timer
  whose TTL semantics are not Anthropic's. This contradicts the user's "Hide the tile for ... non-Claude
  providers".
- Fix: add `nativeAnthropic: rec.capacityRoute?.kind === 'native'` to the session class passed to
  `CompactionSessionTap` and to the `session-bound` idle signal (next to `codexProxy`). The idle service
  projects `cache` only when it is true. Add
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (and its
  spec) to the file list. Add an acceptance criterion: "A Claude SDK session on a proxy route (any
  `capacityRoute.kind !== 'native'`) shows no tile."

### 3. A cache-only change can be lost in the settling window or at stream teardown, leaving a stale idle line

- Evidence:
  - The plan routes cache changes through an owner watcher into the live publisher (plan :22). The
    publisher's `canFlush()` refuses to flush while `settling` (`live-session-stats-publisher.ts:346-353`).
    `settle()` emits only when a provisional estimate was shown (:223-227).
  - Several result exits emit no `session:stats` at all: a duplicate, a result with no usage, or a missing
    callback (`stream-transformer.ts:965-981`).
  - The idle `turn-context` signal (arming) arrives asynchronously after the context read
    (`session-query-executor.service.ts:475-490`). It can land during the pricing awaits that run before
    `replaceRun`. A cache refresh or clear from `turn-ended` happens synchronously inside `onTurnEnd`
    (:464-473), while `settling` is already set or about to be.
  - At teardown, `livePublisher.dispose()` detaches before `onStreamEnd` (`stream-transformer.ts:1092-1101`).
    The idle `sessionReleased` clear is sent from the tap release (`session-query-executor.service.ts:413`).
    The plan only says "ensure ... is emitted before the publisher detaches" without a mechanism.
- Trace for the question "does `idleCompactAt` reach the webview while idle": yes, in the common path. The
  query is a long-lived streaming-input query (the pump `session-stream-pump.service.ts` and
  `promptMode 'idle+streamInput'` at `session-query-executor.service.ts:873`). The publisher therefore stays
  attached across turns, and an arm after `settle()` flushes through the watcher (similar to
  `onAgentRecorded`, :259-276). It is lost only in the windows above.
- Failure: "Idle compaction in 0 min" stays on screen indefinitely after a stop. Or a disarm caused by input
  before the next result never reaches the webview (AC3).
- Fix, in the plan text:
  1. `onCacheChanged` sets `cacheDirty`. If `canFlush()` is false because of `settling`, defer the flush.
     `settle()` (on every exit) and `dispose()` then emit the owner snapshot when
     `snapshot.revision > lastEmitted.revision` and the result path did not already publish that revision.
  2. Choose one teardown mechanism and test it:
     - (a) The tap's release clears the owner's `idleCompactAt` synchronously before `dispose`. For example,
       the abort listener already calls `compactionTap.release()` (`session-query-executor.service.ts:686-690`).
       Make the idle release-clear happen there, ahead of the transformer `finally`.
     - (b) Move `livePublisher.dispose()` after `onStreamEnd`.

     Prefer (a), because it does not reorder an established teardown.
  3. Frontend defence in depth: hide the idle line once `now >= idleCompactAt + IDLE_FIRE_LATENESS_MS`
     (60 s, `idle-compaction.types.ts:9`). Do not show `0 min` forever.

### 4. Batch 1 is too large for one codex lane (15 files, 4 dense specs)

- Evidence: plan :50-69. The owner is 1112 raw lines, the transformer 1108, the publisher 600 and the idle
  service 505. Each has a large spec. A 40-tool-call ceiling will not fit reading, editing and testing all
  four services.
- Fix: split Batch 1 into file-disjoint batches:
  - **1a: contract + evidence + owner.** `rpc-session.types.ts`, `session-stats-live.ts` (+spec),
    `idle-compaction.types.ts`, `idle-request-tracker.ts` (+spec), `session-stats-owner.service.ts` (+spec).
    This batch fixes the owner write API (item 5) that 1b and 1c consume.
  - **1b: projection + gate.** `idle-compaction.service.ts` (+spec), `di/register.ts`,
    `session-query-executor.service.ts` (+spec) for the native gate (item 2) and the release-clear (item 3a).
  - **1c: publication.** `live-session-stats-publisher.ts` (+spec), `stream-transformer.ts`
    (+`stream-transformer.live-stats.spec.ts`) for item 3.1.
  - Order: 1a, then 1b and 1c (file-disjoint, so the lanes can run in parallel, with their heavy checks run
    one at a time), then Batch 2. Batch 2 (6 files) can stay as one batch, or the clock (2 files) can split
    from the tile (4 files).

### 5. The owner write contract for two writers is unspecified

- Evidence: plan :20-22 describe "store cache projection with the owner", "fence writes by current owner/run
  identity" and an `onCacheChanged` watcher, but name no method. Two writers touch the same field at different
  moments:
  - the `turn-ended` estimate (sync, inside `onTurnEnd`);
  - `idleCompactAt` (any reducer step, including after rekey and release).

  The owner's existing writers use two different fences. `recordAgent` looks up by session id only (:595-602).
  `publishLive` and `clearProvisional` use generation plus run token (:620-656). The idle service knows the
  `runToken` (from `session-bound`, `idle-compaction.types.ts:33-38`) but not the stats generation.
  `OwnerWatcher` is an interface with two members (:372-380). Adding a member breaks every implementer and
  every fake.
- Fix: name the API in the plan, for example:
  - `setCacheEstimate(sessionId, runToken, estimate: {ttl, lastRequestAt, expiresAt} | null): boolean`
  - `setIdleCompactAt(sessionId, runToken, at: number | null): boolean`

  Each looks up `states.get(sessionId)`, requires `state.runs.has(runToken)` (the stale-run fence), and does
  nothing when the value is unchanged. Otherwise it calls `touch(state)` and notifies
  `watcher.onCacheChanged()`. `build()` composes `cache` only when the estimate exists, and `idleCompactAt`
  never appears without an estimate. Also state the retained-TTL location: `OwnerState.cacheTtl`, which
  survives across runs of the same owner and starts empty on `startNew` / `createState`. List the spec fakes
  that implement `OwnerWatcher` and must be updated.

## Answers to the review questions

1. **Expiry model.** "Last main request + TTL, a hit refreshes, subagents excluded" is correct. The subagent
   exclusion is already structural (`idle-request-tracker.ts:45-46`, tap :240-243). The anchor must change
   (item 1).
   - Hiding on "positive write without split" is fine. Native Anthropic responses always include
     `cache_creation`, and the split exists only when they do (`subagent-budget-monitor.ts:225-235`). With
     item 2, this case only arises on unusual routes.
   - "Read-only with no retained TTL" is rare in practice. Each new turn writes its own delta, so the first
     request after a resume normally carries a confirmed split. Hiding is acceptable.
   - Recommended, not blocking: for a **mixed** split (both buckets > 0), use `'5m'` instead of hiding. The
     shorter bucket covers the conversation tail, so its expiry is when the next message stops being a full
     hit. That uses the minimum of the confirmed TTLs and does not invent one. If adopted, amend AC1
     ("mixed → shorter confirmed TTL").
2. **`idleCompactAt` while idle.** Yes, it reaches the webview in the normal path: the publisher stays
   attached across turns of the streaming-input query and flushes through the watcher. It is lost in the
   settling window and at teardown (item 3).
3. **Revision floor.** Cache-only updates are accepted. Each change calls `touch()` (a new process-wide
   revision, `session-stats-owner.service.ts:784`), and `admit` accepts `>= floor`
   (`session-stats-snapshot.ts:86-89`). `handleLiveSessionStats` installs authoritative live snapshots too
   (`session-stats-aggregator.service.ts:207-239`). The publisher's dedupe compares revision plus provisional
   (`live-session-stats-publisher.ts:416-422`), so a bumped revision is emitted. Note:
   `isValidSessionStatsSnapshot` ignores unknown keys (`session-stats-snapshot.ts:20-56`), so a malformed
   `cache` does not reject the snapshot. The selector-side `parseSessionStatsCache` is therefore the real
   guard, and the live-parser sanitizing is redundant but harmless.
4. **Batch sizing.** See item 4.
5. **Frontend.**
   - Module boundaries: `chat-ui` and `chat` are both `scope:webview, type:feature` (`project.json:7` in each).
     The plan keeps the clock and tile in `chat-ui` and the parser in `shared`, and `chat-ui` must not import
     `@ptah-extension/chat`. OK.
   - OnPush plus a signal clock is fine.
   - Notes for the plan:
     - State the tick. A 1 s `setInterval`, only while visible and only with at least one subscriber, is
       simple and lets `Cache expired` flip on time. Alternatively, use a `setTimeout` scheduled to the
       nearest minute boundary or deadline.
     - Inject `DOCUMENT` (not the global) so the spec can drive `visibilitychange`.
     - Render the tile as its own small presentational component, for example
       `inspector-cache-tile.component.ts`, rather than growing the 216-line dense inline template of
       `inspector-session-stats.component.ts`.
   - File size: `max-lines` is 700 non-blank, non-comment lines, as a warning (`eslint.config.mjs:558-561`).
     The owner (1112 raw lines) and the transformer (1108) must be measured before adding to them.
6. **Missing acceptance criteria.** Native-route gate (item 2). Stream-end and stop clear (item 3).
   Webview-reload restore (note below). History replay (note below).

## Notes (non-blocking)

- **Synthetic assistant frames.** The tracker treats any main assistant frame with an id as a request
  (`idle-request-tracker.ts:50-68`). A `<synthetic>` error or interrupt frame yields zero usage, which would
  **clear** a valid estimate (AC2's "neither read nor write clears"). The live publisher already skips
  synthetic models (`live-session-stats-publisher.ts:300-301`). Skip them for cache evidence too, leaving
  idle behaviour unchanged, and add a test.
- **Webview reload with a live backend.** `publishHistoryStats` answers with `statsOwner.snapshot(sessionId)`
  when an owner is live (`session-history-reader.service.ts:1041-1042`), so `cache` comes back on
  `chat:resume`. This is correct and desirable.
  - AC9's "after a fresh reload/resume with no new cache evidence, the tile is hidden" should read: "hidden
    when no live backend owner holds a cache estimate (backend restart, transcript-only browse)".
  - Add a test that the resume snapshot keeps `cache` and that a transcript aggregate never has it.
  - Confirm that the spread at `session-history-reader.service.ts:1049+` preserves the field.
- **Resume prefix pending.** `publishLive` returns `null` while `state.pending !== null`
  (`session-stats-owner.service.ts:626`), so a cache-only flush during the first prefix load is dropped. The
  `turn-ended` path then republishes through the result snapshot, which is acceptable. Mention it so nobody
  "fixes" it.
- **Projection location.** Putting the projection in `IdleCompactionService` makes the tile depend on an
  optional service. Its factory can fail and be cached as failed (`di/register.ts:544-556`; prior
  completion-report item 12). This is acceptable for one implementation, but record it under Decisions as a
  known coupling: if the idle service fails, there is no tile.
- **Display rounding.** `Math.max(1, ceil(...))` is fine. With item 1's anchor, the first display right after
  a 1h turn reads "60 min" only for very short requests. That is expected.
- **Degradation-audit comments.** These are required on every new intentional catch: publisher, idle
  projection, and clock listener.

## task-description.md

Its scope and out-of-scope sections are sound. It correctly excludes the legacy summary, transcript
reconstruction, and any change to idle eligibility. Required amendments follow the items above:

- AC1 and AC2: "observed request end" becomes "observed request start anchor" (item 1). Optionally, mixed
  TTL takes the shorter confirmed TTL (answer 1).
- New AC: a proxy route shows no tile (item 2).
- AC3: add "stream end / stop / abort clears the idle line on the last published snapshot", plus the
  frontend lateness guard (item 3).
- AC7: name the tick period (answer 5).
- AC9: reword the reload/resume clause as in the notes.
- "Risks": drop the end-timestamp bullet (item 1). Keep the ordering bullet and name the settling window
  explicitly.

## Round 2

Scope: round-1 items 1-5 and the task-description amendments only. Orchestrator decisions 7 (anchor-based
expiry) and 8 (native-route gate) are settled (`decisions.md` rows 7-8) and are not reopened here.

| # | Item | Status | Evidence |
| - | ---- | ------ | -------- |
| 1 | Anchor expiry at request start | **Fixed** | Plan step 1-2 (`implementation-plan.md:20-21`) add `cacheAnchorAt` as a copy of the existing `anchorAt` and set `expiresAt = cacheAnchorAt + TTL`. There is no `endedAt` (:79). The wire comment changed (:54). AC1/AC2 rewritten (`task-description.md:26-27`). The mixed split takes 5m, as recommended. The synthetic-frame skip was added (:20, AC2). |
| 2 | Native-route gate | **Fixed** | Plan step 3 (:22) adds `nativeAnthropic: rec.capacityRoute?.kind === 'native'` on the tap session class and the `session-bound` signal. A proxy route clears any prior projection, and idle eligibility is unchanged. New AC10 (`task-description.md:35`). Evidence verified: `session-query-executor.service.ts:97-101` (native), :675-678 (session class). |
| 3 | Settling and teardown lost updates | **Fixed** | Step 6 (:25): `cacheDirty` is marked even while settling. `settle()` on every exit and `dispose()` emit when the owner revision exceeds both the last live revision and the result revision. `noteResultPublished` is called only after a successful `onResultStats`. Step 7 (:26) chooses option (a): a guarded `beforeLiveStatsDispose` runs immediately before `livePublisher.dispose()` with no reordering. The frontend lateness guard was added (:13, AC3). |
| 4 | Batch split | **Fixed** | 1a (9 files, :71-83), 1b (6, :87-98), 1c (7, :100-112), Batch 2 (10, :114-128). They run sequentially (1a, then 1b, then 1c), which is correct because 1c consumes the `ExecuteQueryResult` field added in 1b (:96, :98). |
| 5 | Owner write API and fencing | **Fixed** | `getCacheTtl` / `setCacheEstimate` / `setIdleCompactAt` (:34-43). The fence is `states.get(sessionId)` plus `state.runs.has(runToken)`, with an explicit ban on `runFor` (:45). Retained TTL is kept separate from the visible estimate. The watcher implementers to update are listed. |

### Spot-checks of new claims

- **Pre-dispose tap release.** Verified.
  - `compactionTap.release()` is idempotent and already wired twice: by the abort listener
    (`session-query-executor.service.ts:686-690`) and by `onStreamEnd`, with the comment "release() is
    idempotent, so both paths are safe" (:916-920).
  - Release calls `idle.sessionReleased(id)` synchronously (:413).
  - The transformer's `finally` order is `activityWatchdog.stop()`, then `livePublisher.dispose()`, then
    `onStreamEnd` (`stream-transformer.ts:1086-1101`), so a hook placed just before `dispose()` runs while
    the watcher is still attached.
  - The adapter carries the tap through `StreamTap` / `rememberStreamTap` on the new and reused paths
    (`sdk-agent-adapter.ts:89, 1037, 1150-1153, 1348`), matching the 1c file list.
- **Run-token fence.** Sound.
  - The owner never deletes runs (no `runs.delete` / `runs.clear` in `session-stats-owner.service.ts`), so a
    run token stays valid for the owner's lifetime. A replaced owner is a new `OwnerState` with an empty
    `runs` map, so a stale run fails the fence.
  - The idle service's `runToken` (the tap's `rec.token`) is the same token the transformer and owner use:
    the adapter passes `runToken: sessionToken`, and `existingSession.token` on reuse
    (`sdk-agent-adapter.ts:1022, 1185, 1333, 1688`), and `beginRun` registers it (:993, 1283, 1674).
- **Watcher implementers.** The publisher's watcher literal is at `live-session-stats-publisher.ts:172-175`,
  as cited.

### Task-description amendments

All are applied:

- AC1 and AC2: anchor, mixed 5m, synthetic frames (`task-description.md:26-27`).
- AC3: stream end, stop and abort, plus the lateness guard (:28).
- AC7: 1-second tick (:32).
- AC8: settling and teardown (:33).
- AC9: wording for a live owner versus a transcript (:34), with a matching out-of-scope line (:20).
- AC10: proxy routes (:35).
- The risks section now covers the anchor and the settling window (:39-40).

### Notes (non-blocking)

- **The `OwnerWatcher` change breaks the 1a check until 1c lands.** Adding a required `onCacheChanged()` to
  `OwnerWatcher` in 1a (`session-stats-owner.service.ts:371`) breaks typechecking of the publisher's watcher
  literal (`live-session-stats-publisher.ts:172-175`). The publisher only changes in 1c, so 1a's scoped
  agent-sdk check fails. Fix it in one of two ways:
  - declare the member optional and notify with `watcher.onCacheChanged?.()`; or
  - let 1a add a one-line no-op `onCacheChanged` to the publisher literal, and the team-leader moves that
    file's ownership accordingly.

  The team-leader can settle this at decomposition.
- **AC6 and AC3 overlap.** AC6's "idle line shows only while the backend reports an armed time" and AC3's
  lateness guard are compatible. The tile spec should test both conditions together (armed and past
  `fireAt + 60 s` means hidden).

### Verdict

**APPROVED.** All five round-1 items are fixed with verified evidence. The remaining notes are for
decomposition.
