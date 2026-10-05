# Code Logic Review — `TASK_2026_614_327a` (Stage D + E, half A)

Scope: `git diff origin/main...HEAD -- libs/backend/agent-sdk libs/backend/tool-output-reducers libs/backend/cli-engine`
(35 files, production first). Context read: `batches.md` (User Decisions; Batches 1, 3, 4, 5, 6.1, 7, 12, 15), the
`batch-15-report.md`, `batch-1-report.md`. Specs read only to confirm claimed regression tests (monitor, PostToolUse,
executor/transformer).

Known open items not re-reported: `ptah.agent.waitFor` cancel hook (Task 8.3), review-A m5, spool `gitignoreFailure`
not logged by the vscode-lm-tools dispatcher caller.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 3        |
| Failure modes found | 9        |

Why 7 and not 8: one D.12 item (A-m7) is only partly closed, and the new PostCompact rekey of the monitor does not
handle subagent messages that are already buffered under the old id. Why not 6: the main paths the brief asked about
hold up. These are release on normal end, error and abort after the Batch 15 refactor; the retry ending at release; the
DI cycle; the D.3 gate; the 10 s bound and the abort; and the freshness check. Each has the regression test its batch
names.

## Five logic questions

### 1. How does this fail silently?

- An invalid `compaction.threshold` or an out-of-range `CLAUDE_CODE_AUTO_COMPACT_WINDOW` still logs a warn on every
  `getConfig()` (`compaction-config-provider.ts:118, 202, 209`). `getConfig()` runs on every tool call
  (`tool-output-capper.ts:136`) and every subagent message (`subagent-budget-monitor.ts:304`). Only the four budget
  keys got the warn-once set (`:172-186`). The fault is log noise, not lost data.
- When the 10 s bound passes, the PostToolUse hook returns the uncapped output, and the only sign is one warn line
  (`post-tool-use-hook-handler.ts:136-147`). The model then receives the full oversized output. This is by design
  (fail-open), but the capper keeps running and may still write a spool file that no output points to.
- After a PostCompact rekey, a context-usage reading that was in flight lands in the port under the new id. The tap
  still hands it to the coordinator under the old id (`session-query-executor.service.ts:351-364`).
  `CompactionCoordinator.onContextUsage` returns `false` for an unknown id (`compaction-coordinator.ts:156-157`), so
  the coordinator silently drops that turn's reading.

### 2. What user action produces unexpected behaviour?

- A user who turns off `compaction.enabled` to stop auto-compaction now also turns off subagent stops
  (`subagent-budget-monitor.ts:314-323`). This is Decision 2 (a), as recorded. It is logged once per session at
  `info`.
- The user steers a subagent while the monitor's handoff is pending. Both now go through `serialisedPush`
  (`subagent-message-dispatcher.ts:217-240`), so they arrive in call order. This item is closed.

### 3. What input data produces a wrong answer?

- A subagent message whose `session_id` is still the pre-compaction id, processed after the PostCompact hook has run
  the rekey. The monitor creates a new, empty `SessionState` under the old id (`subagent-budget-monitor.ts:284, 386-398`)
  and restarts `weightedUsed` for that subagent there. The weighted safety stop then fires late, because the total is
  split across two keys. See FM-2.
- A whole-file Read outline: `numLines` counts the trailer lines as well (`tool-output-capper.ts:313`). The error is
  off by one or two lines, which is harmless.

### 4. What happens when a dependency fails?

- `stopSubagent` rejects: the stop is retried on the subagent's next message, up to 3 attempts in all, then given up
  with one warn and no handoff (`subagent-budget-monitor.ts:556-582`). A stop that settles after release is neither
  retried nor handed off (`:509-511`), and `CompactionSessionTap.observe` returns early once released
  (`session-query-executor.service.ts:221-222`), so no retry can fire after release. The retries have no spacing,
  though. An SDK request streams one assistant message per content block, so all three attempts can be spent within
  milliseconds on a single request (Minor).
- A throwing `onMessage` or `onStreamEnd` is logged, and the stream and its outcome go on (`stream-transformer.ts:439-456,
  918-935`). A throwing coordinator subscriber goes to the logger callback, and the transition loop continues
  (`compaction-coordinator.ts:266-276, 312-320`; `di/register.ts:437-450`).
- The capper hangs: the bound or the abort settles the race. A late rejection is absorbed by `Promise.race`, and the
  timer and the listener are cleaned up in `finally` (`post-tool-use-hook-handler.ts:126-162`).
- `.gitignore` write fails (EACCES): the spool file is still written, and the failure is returned and logged
  (`spool.ts:184-195`, `apply-output-budget.ts:190-195`). It is logged on every spooled output, not once (Minor).

### 5. What is missing that the requirements never mentioned?

- Monitor and port state rekeyed to the new id is only released if a later stream message carries that id. The tap
  learns ids only from messages (`session-query-executor.service.ts:278, 339`). If the stream ends right after the
  compaction, that state stays in the singletons. The leak is small and bounded per session.
- `StreamTransformConfig.onMessage` and `onStreamEnd` are optional (`stream-transformer.ts:243, 249`). Only the producer
  side, `ExecuteQueryResult`, is required. The `resumeSession` "already active" path calls `transform` with neither
  (`sdk-agent-adapter.ts:953-970`). That gap already existed (it never had the watchdog either). Still, the D.11 goal
  of making a forgotten tap a compile error holds only on the producer side.

## Failure modes

### FM-1: A-m7 warn-on-every-call remains for threshold and env window

- Trigger: `ptah.compaction.threshold` is set outside [100k, 1M], or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set to a
  clamped or non-integer value.
- Symptom: one warn per tool call and per subagent message, for the life of the process.
- Evidence: `compaction-config-provider.ts:110-129` (threshold), `:196-218` (env window). The warn-once set covers only
  `readBudget` (`:169-188`).
- Current handling: warns on every call.
- Recommendation: route both warnings through the same `warnedBudgets`-style set, keyed by key and value.

### FM-2: PostCompact rekey loses ordering against buffered old-id subagent messages

- Trigger: the PostCompact hook runs while subagent messages stamped with the old `session_id` are still queued for the
  transformer. Hook control requests are handled when they arrive; stream messages wait for the consumer.
- Symptom: a second `SessionState` appears under the old id. That subagent's `weightedUsed` restarts from that
  message's share, so the safety stop fires late. A second stop attempt is avoided only because the registry drops
  completed records (`subagent-budget-monitor.ts:483-495`), and that path logs a misleading "no task id yet" warn.
- Evidence: `subagent-budget-monitor.ts:355-379` (rekey), `:284` / `:386-398` (new state on an unknown id);
  `session-query-executor.service.ts:271-279` (the id comes from `message.session_id`).
- Current handling: none. The port has the in-flight-read guard (`context-usage.port.ts:109-116`); the monitor has no
  equivalent.
- Recommendation: keep a `from → to` alias map in the monitor after `rekey`, and resolve an incoming old id to the
  current one (cleared on release).

### FM-3: Rekey merge discards an in-flight stop on the merged-away session

- Trigger: state already exists under `toSessionId`, and a stop is in flight on that session object when `rekey` runs.
- Symptom: `rekey` keeps the `from` object and drops the `to` object (`subagent-budget-monitor.ts:363-378`), so
  `isCurrent()` is false for the in-flight stop (`:509`). A stop that succeeded is then treated as "released": the
  registry is not marked completed, no handoff is pushed, and `stopFired` stays false. The next message stops an
  already stopped task again. If that call rejects, the parent never receives a handoff.
- Evidence: `subagent-budget-monitor.ts:363-378, 402-404, 509-511`.
- Current handling: none. The spec at `subagent-budget-monitor.spec.ts:426` covers the merge without a stop in flight.
- Recommendation: merge into the `existing` (to) object instead, or rebind `isCurrent` to "the state object is still
  reachable".

### FM-4: Coordinator drops the turn-end reading taken across a PostCompact

- Trigger: a `result` arrives, the port read is in flight, and PostCompact rekeys.
- Symptom: the reading is stored under the new id, but the tap calls `onContextUsage(oldId)`, which returns false.
  Arming is skipped for that turn.
- Evidence: `session-query-executor.service.ts:351-366`; `compaction-coordinator.ts:156-157`.
- Recommendation: let the tap read its current `this.sessionId` in the `.then`, or have the port resolve to the
  reading's current id.

### FM-5: Rekeyed state not released when the stream ends right after compaction

- Trigger: PostCompact rekeys the port and the monitor, then the stream ends before any message carries the new id.
- Symptom: `lastReadings[newId]`, the `turnReads` entry and the monitor `SessionState` under the new id are left in the
  singletons.
- Evidence: `session-query-executor.service.ts:278, 305-330, 339`; `compaction-hook-handler.ts:536-539`.
- Recommendation: have the hook handler report the rebind to the run (or let the tap release the payload id it learns
  from the coordinator), so release covers the new id.

### FM-6: Stop retries spent in one request burst

- Trigger: `stopSubagent` rejects for a transient reason while the SDK streams several content-block messages of one
  request.
- Symptom: all 3 attempts run within milliseconds, then "giving up, no handoff sent".
- Evidence: `subagent-budget-monitor.ts:299, 556-570` (a retry on every next message, with no `lastMessageId` or time
  gate).
- Recommendation: retry only on a new API message id, or after a minimum interval.

### FM-7: Late capper work after timeout

- Trigger: the cap takes longer than 10 s.
- Symptom: the original output is returned, but the capper may still write a spool file that nothing references.
- Evidence: `post-tool-use-hook-handler.ts:136-141`.
- Recommendation: pass an `AbortSignal` into `ToolOutputCapper.cap` (later task), or accept and document.

### FM-8: `signal` dereferenced outside the fail-open `try`

- Trigger: a hook invocation without `options` (non-SDK invoker or a future SDK change).
- Symptom: the `TypeError` at `post-tool-use-hook-handler.ts:123` rejects the whole hook instead of failing open.
- Evidence: `post-tool-use-hook-handler.ts:85-89, 123`.
- Recommendation: `options?.signal` and treat a missing signal as never aborted.

### FM-9: Release is keyed by session id, not by run

- Trigger (theoretical, not reproduced): an old run's stream ends without an abort after a new run of the same real
  id has bound. `bind` skips `register` when the coordinator already knows the id
  (`session-query-executor.service.ts:340-345`).
- Symptom: the old tap's `release` unregisters the new run's coordinator record, port readings and monitor state.
- Evidence: `session-query-executor.service.ts:305-330`. `endSession` aborts first (`session-control.service.ts`
  interrupt, then abort, then removal), so the abort listener releases synchronously and the slash-command and resume
  paths are safe. I found no path where a non-abort end overlaps a new run.
- Recommendation: residual risk only. A run token check in `release` would close it.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

Moderate:

- FM-1: A-m7 only partly closed (`compaction-config-provider.ts:118, 202, 209`).
- FM-2: monitor rekey against buffered old-id messages (`subagent-budget-monitor.ts:355-379, 284`).
- FM-3: rekey merge drops an in-flight stop's bookkeeping (`subagent-budget-monitor.ts:363-378, 509`).

Minor:

- FM-4 (`session-query-executor.service.ts:364`), FM-5 (`:278, 339`), FM-6 (`subagent-budget-monitor.ts:556-570`), FM-7
  (`post-tool-use-hook-handler.ts:136`), FM-8 (`:123`), FM-9 (`session-query-executor.service.ts:305-330`).
- The `.gitignore` failure is logged on every spool write, not once per directory (`apply-output-budget.ts:190-195`).
- `numLines` includes the trailer lines (`tool-output-capper.ts:313`).
- `budgetDefault` throws on every `getConfig()`, not once at construction (`compaction-config-provider.ts:41-48`). It
  is guarded by the defaults spec; if it ever fired, it would turn every capper and monitor call into a caught failure.
- `resumeSession`'s "already active" `transform` passes neither tap callback (`sdk-agent-adapter.ts:953-970`). This
  already existed; it is noted because D.11's guarantee is producer-side only.

## Data flow

1. The SDK message enters `StreamTransformer` (`stream-transformer.ts:434`): the watchdog observes it, then `onMessage`
   runs inside a try/catch (`:439-456`). OK.
2. `CompactionSessionTap.observe` returns early when released (`session-query-executor.service.ts:221`). OK.
3. Main-loop message: `bind` on a new id, then the status, boundary and result go to the coordinator. A main-loop
   assistant message with a `tool_use` goes to the monitor for the task text (`:240-261`). OK.
4. Subagent message: goes to `monitor.observe(id, msg, cacheTtl)`. The TTL is set right after `build()` (`:720`), before
   any message can arrive. OK.
5. Monitor: counting deduplicates by API message id. The D.3 gate is checked before a stop
   (`subagent-budget-monitor.ts:314`). The stop runs with `stopInFlight`; on success it marks the registry, pushes the
   handoff with the task text through the dispatcher lock, then rechecks release (`:497-552`). The gap is FM-3 on rekey.
6. PostToolUse: the cap is raced against 10 s and the abort signal, and fails open (`post-tool-use-hook-handler.ts:115-162`).
   OK, see FM-7 and FM-8.
7. PostCompact: the coordinator rebinds, then the port and monitor are rekeyed, each fail-open
   (`compaction-hook-handler.ts:528-539`). The gaps are FM-2, FM-4 and FM-5.
8. Teardown: the `finally` stops the watchdog, then `onStreamEnd` releases the tap. The abort listener also releases
   it, and the call is idempotent (`stream-transformer.ts:914-935`; `session-query-executor.service.ts:540-544, 775`). OK.
9. DI: the monitor factory resolves the logger, config provider and registry eagerly, and the dispatcher lazily
   (`di/register.ts:463-482`). Nothing on that path resolves `SessionLifecycleManager`. The hook handler's new
   `@inject` of the port and the monitor reaches the same factory, which has no back edge, so the PR 647 cycle is not
   recreated. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D.1 outline metadata (Task 1.1) | COMPLETE | `numLines` counts trailer lines (trivial) |
| D.2 release on normal end (Task 3.1, moved by 15.1) | COMPLETE | Producer side only; FM-9 residual |
| D.3 `compaction.enabled` gates the stop (Task 12.1) | COMPLETE | Counting and snapshot kept; logged once per session |
| D.6 fresh rotation handoff (Task 6.1) | COMPLETE | Identity-based `usageSeq` errs toward a rebuild (safe direction) |
| D.7 effective TTL to the monitor (Task 3.2) | COMPLETE | — |
| D.8 task text, ordered push, bounded retry, listener errors (4.1-4.3) | COMPLETE | FM-6 (no retry spacing) |
| D.9 N2 typed default lookup | COMPLETE | Throws per call, not at construction (Minor) |
| D.9 N3 `.gitignore` failures reported | COMPLETE (this half) | Logged per spool; the dispatcher caller is a known open item |
| D.10 CLI binds `SDK_CODE_OUTLINER` | COMPLETE | Matches the VS Code and Electron factories; the capper resolves it once |
| D.11 explicit `onMessage` / `onStreamEnd` | COMPLETE | Consumer config optional; the `resumeSession` already-active path |
| D.12 A-m1 | COMPLETE | Watchdog subclass deleted |
| D.12 A-m6 PostCompact rekey port + monitor | PARTIAL | FM-2, FM-3, FM-5 |
| D.12 A-m7 warn once | PARTIAL | FM-1: threshold and env-window warns still fire per call |
| D.12 A-m8 bounded PostToolUse cap + abort | COMPLETE | FM-7, FM-8 minor |
| D.12 A-m9 listener errors logged | COMPLETE | — |
| D.12 B-m7 `contextTokens` honesty | COMPLETE | — |

Implicit requirements not addressed: monitor id aliasing after a rekey (FM-2); releasing ids learned only through the
hook (FM-5).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Stream ends normally, then a resumed run | YES | `onStreamEnd` releases; the new tap registers afresh | FM-9 theoretical |
| Stream error | YES | `finally` releases; the error is rethrown unchanged | — |
| Abort before the stream reaches the transformer | YES | The abort listener releases | — |
| `onStreamEnd` throws | YES | Logged; the outcome is kept | — |
| `stopSubagent` rejects | YES | 3 attempts, then give up | FM-6 |
| Stop settles after release | YES | `isCurrent` check | FM-3 under rekey |
| Steer and handoff in the same tick | YES | `serialisedPush` | — |
| `compaction.enabled=false` | YES | Counts and snapshot kept, no stop | — |
| Capper hangs / hook aborted | YES | 10 s race, abort listener | FM-7, FM-8 |
| PostCompact with a read in flight | PARTIAL | The port moves the read | The coordinator drops it (FM-4) |
| Buffered old-id subagent messages after PostCompact | NO | — | FM-2 |
| Handoff after a newer snapshot or an extend | YES | `usageSeq` compared with `handoffCopySeq` | — |
| `.gitignore` EACCES | YES | Returned and logged; spool kept | Logged per spool |
| Missing platform-core default | YES | Throws (spec pins all four keys) | Per call |

## Verdict

- Recommendation: APPROVE. The three Moderate items can go to a follow-up; none blocks Stage D.
- Confidence: MEDIUM. I read every production file in the diff in full where it changed and traced its callers. I did
  not confirm whether the SDK really delivers old-id subagent messages after PostCompact (FM-2 rests on how the queues
  are ordered), and I did not confirm whether the session registry rebinds to a post-compaction id without a new
  `init`.
- Top risk: after a PostCompact that changes the session id, the subagent monitor can split one subagent's spend across
  two ids. The safety stop then fires late, or the record of a successful stop is lost.
- What a robust implementation would add:
  - an alias from the old to the new id in the monitor (and port) after a rekey;
  - a merge into the target object (or an `isCurrent` check that the state object is still reachable);
  - warn-once for the threshold and env-window warnings;
  - retries gated on a new API message id;
  - `options?.signal` in the PostToolUse hook;
  - a run token check in `CompactionSessionTap.release`.
