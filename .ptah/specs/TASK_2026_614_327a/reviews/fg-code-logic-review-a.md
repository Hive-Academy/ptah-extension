# Code Logic Review — `TASK_2026_614_327a` (Stage F + G, backend part 1, reviewer A)

Scope: `git diff 55f245619..08e51a353 -- libs/backend/agent-sdk libs/backend/vscode-core libs/shared libs/backend/cli-agent-runtime/src/lib/session-children`
(38 files, +1806/-144). Batches 16, 17, 18, 22, 27, 28, 30, 31 (plus the shared `pricing.utils.ts` hunk of Batch 32).
Inputs read: `context.md` § Stage F / Stage G / User Decisions (Stage F + G); `batches.md` § Stage F + G batches
(decisions, Batches 16-18, 22, 27, 28, 30, 31); `batch-16/22/31-report.md` (gap notes). Every production hunk was read
together with its surrounding code; spec hunks were read only where a finding depends on them.
`ptah_get_diagnostics` on `session-budget.service.ts`, `subagent-budget-monitor.ts` and `session-spawner.service.ts`:
0 errors.

## Summary

| Metric              | Value               |
| ------------------- | ------------------- |
| Overall score       | 6/10                |
| Assessment          | APPROVED WITH FIXES |
| Blocking issues     | 0                   |
| Serious issues      | 1                   |
| Moderate issues     | 5                   |
| Minor issues        | 5                   |
| Failure modes found | 7                   |

Why 6 and not 7: most of the original findings are really fixed. F.1 M5, M7 (eviction and headless child), M1, M4;
F.6 `keepPreviousFigure` and `.tmp`; G.1; G.2 ordering; FM-4, FM-5, FM-6, FM-8, FM-9; and F.5 M1 are fixed, each with
a spec. Two fixes are only partial, though. F.5 B1 still leaves the main case unbound (S1). G.2 still lets an old id
start a fresh, never-released record after release (M1, the exact case the 22.1 spec claims to cover). F.1 M3 flags
the written handoff but not the preview or rotation seed (M3). Why 6 and not 5: nothing loses persisted data or breaks
a lane config. The one data-adjacent risk is in-memory budget state (M5).

## Five logic questions

### 1. How does this fail silently?

- A SubagentStart without `toolUseId` for a brand-new foreground subagent is only WARNed. The subagent then has no
  registry record, so steer, stop and the budget monitor's stop of that subagent all silently do nothing for its
  whole life (`subagent-hook-handler.ts:278-279`, `:332-347`). See S1.
- A SubagentStart without `toolUseId` whose exact `agentId` match is a `completed` record is logged as "bound". The
  record stays `completed`, because `update(record.toolCallId, {})` changes no status (`subagent-hook-handler.ts:362-375`).
  See M2.
- A subagent message under an old id that arrives after `release` creates a fresh monitor state under that old id
  (`subagent-budget-monitor.ts:421-428`, `:443-456`). Nothing releases it later, and the spec that is meant to forbid
  this does not assert on the old id (`subagent-budget-monitor.spec.ts:529-543`). See M1.
- A rotation seeded through `preview-handoff` gets no `readStatus` when the transcript could not be read
  (`session-budget.service.ts:767`). See M3.

### 2. What user action produces unexpected behaviour?

- The user resumes a completed subagent through `subagent:send-message`, and its start comes without `toolUseId`. The
  agent runs, but the registry still says `completed` (M2).
- The user clicks "Allow 20% more" at the limit, while a stale record with no query for the same SDK id ages out of
  the idle sweep. The extension, dismissals and stage of the live session are dropped, so the next send is blocked
  again (M5).

### 3. What input data produces a wrong answer?

- A rekey chain X→Y, then `release(Y)`, then a late assistant message under X. The monitor counts it into a new state X
  instead of dropping it (M1).
- A stop that rejects on a state that a rekey merged since. The retry gate stores the attempt's message id from the
  pre-merge state on the merged state (`subagent-budget-monitor.ts:565`, `:655`), so the gate may compare against the
  wrong request (m1).

### 4. What happens when a dependency fails?

- `adapter.interruptSession` throws in the spawner's stop path (`session-spawner.service.ts:731-737`). The adapter
  never reached `releaseStatsOwners` (`sdk-agent-adapter.ts:1491-1492`), so the stats lease survives. The spawner then
  releases the budget (`session-spawner.service.ts:741`), and a late live figure passes the lease guard at
  `session-budget.service.ts:810-811`. The entry is recreated and never released again (M4).
- An interrupt that hangs: `interruptInBackground` releases the budget only in `.finally` (`session-spawner.service.ts:1319-1327`),
  so the entry lives until dispose (m4).
- When a session-control restore fails, it now reports `{ applied: true, reason: 'restore-failed' }`
  (`session-control.service.ts:828-832`). The budget service reports `success: false` with the state
  (`session-budget.service.ts:728-733`). This matches the shared doc (`session-budget.types.ts:40-61`) and is OK.
- A throwing eviction listener is WARNed per listener, and the sweep continues (`session-registry.service.ts:626-640`). OK.

### 5. What is missing that the requirements never mentioned?

- A tombstone for released monitor ids, as the budget service has (`released`, capped at 1024). The monitor has none (M1).
- A rule that eviction releases a real SDK id only when no other record still holds it (M5).
- `/clear` is listed in M7 (context.md F.1). The adapter explicitly does not release on it (`sdk-agent-adapter.ts:1480-1492`),
  but neither the batch nor the report records that M7's `/clear` part is closed by design (m5).

## Failure modes

### FM-A: Unbound foreground subagent (F-F residual)

- Trigger: SubagentStart without `toolUseId` for an agent that no registry record names yet.
- Symptom: no record. `subagent:stop`, `subagent:send-message` and the budget monitor's stop cannot reach the agent.
  The monitor logs "stop deferred" once.
- Evidence: `subagent-hook-handler.ts:279` → `:324-347`. `batch-31-report.md:53-60` records the gap.
- Current handling: a WARN with `matchCount: 0`.
- Recommendation: see S1.

### FM-B: Old-id state recreated after release

- Trigger: `rekey(X→Y)`, then `release(Y)` (the tap's `onStreamEnd`), then `observe(X, subagentMsg)`.
- Symptom: a new `SessionState` under X counts tokens. It can reach the stop threshold and call
  `stopSubagent` or `pushParentMessage` for a dead id. It is never released.
- Evidence: `subagent-budget-monitor.ts:421-428` drops the aliases, `:443-456` creates the state unconditionally, and
  `subagent-budget-monitor.spec.ts:529-543` checks only `session-2` and `session-3`.
- Current handling: none.
- Recommendation: see M1.

### FM-C: Completed record "bound" but not revived

- Trigger: SubagentStart without `toolUseId`, with an exact `agentId` match whose status is `completed`.
- Symptom: the INFO says "bound", but the status stays `completed`.
- Evidence: `subagent-hook-handler.ts:352-375`.
- Recommendation: see M2.

### FM-D: Preview or rotation seed without the read flag

- Trigger: the transcript read fails, or the workspace is unknown, during `preview-handoff`.
- Symptom: the seed content has no transcript, and nothing says so.
- Evidence: `session-budget.service.ts:767-772`. `HandoffCopy` has no `readStatus`.
- Recommendation: see M3.

### FM-E: Entry resurrected after a failed child interrupt

- Trigger: `interruptSession` throws while stopping a child, and then a result arrives.
- Symptom: a budget entry for a stopped child that is never released.
- Evidence: `session-spawner.service.ts:731-741`, `sdk-agent-adapter.ts:1488-1492`, `session-budget.service.ts:810-819`.
- Recommendation: see M4.

### FM-F: Eviction releases a real id another record still serves

- Trigger: a record registered with `realSessionId = S` that never gets a query (registry doc
  `session-registry.service.ts:247-249`; `query` stays `null`, `:268`) idles past the TTL while another record runs S.
- Symptom: `releaseBudget([tabB, S])` drops the live session's entry: extensions, dismissals, stage, window.
- Evidence: `session-registry.service.ts:604-617`, `:627-629`; `sdk-agent-adapter.ts:261-263`.
- Current handling: none. Plausibility is unproven: I did not trace every caller that registers without a query.
- Recommendation: see M5.

### FM-G: Retry gate keyed on the pre-merge state

- Trigger: a stop rejects after a rekey merge replaced the subagent's state.
- Symptom: one extra stop attempt on the same request, or one missed attempt.
- Evidence: `subagent-budget-monitor.ts:565`, `:582`, `:655`.
- Recommendation: see m1.

## Blocking issues

None.

## Serious issues

### S1 — F.5 B1 / F-F: a new foreground subagent without `toolUseId` stays unbound

- File: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:279`, `:324-347`
- Scenario: the SDK fires SubagentStart without `toolUseId` for a new foreground Task. No record names its `agentId`
  yet, because the `agentId:` line only comes with the Task tool result. `bindStartByAgentId` finds 0 matches and
  WARNs. The decision text for F-F (a) reads "bind when the Task tool result names that exact id". The implementation
  only matches records that already exist (replay, snapshot, an earlier start). Nothing binds when the tool result
  arrives (`batch-31-report.md:56-60`).
- Impact: B1 was about exactly this case, and it is still open. The subagent cannot be steered, stopped or
  budget-stopped (the monitor needs the record's `taskId`) for its whole run. The user sees a running agent that the
  stop control and the per-subagent budget cannot reach.
- Fix: either implement the second half (hold the unbound start keyed by `(parentSessionId, agentId)` with a TTL and
  bind it when the Task `tool_result`'s `agentId:` line is parsed — `background-started-event.ts:56` already parses
  it), or record B1 as PARTIAL with a named later task in `batches.md`, and in the PR body, so it is not reported as
  fixed. It cannot break a lane config or lose data, so explicit acceptance is a valid outcome. Silent "COMPLETE" is not.

## Moderate and minor issues

### Moderate

- **M1 — Monitor recreates state for an old id after release (G.2 / Task 22.1 not fully met).**
  `subagent-budget-monitor.ts:421-428` removes every alias whose chain reaches the released id. `sessionState`
  (`:443-456`) then creates a fresh state for the raw old id. The task text says "after release no state is created".
  The spec at `subagent-budget-monitor.spec.ts:529-543` is titled "no state lands on it afterwards", but it checks only
  `session-2` and `session-3`, not `SESSION`, which now holds state.
  Fix: keep a capped `released` tombstone, as `SessionBudgetService` does (`session-budget.service.ts:172`, `:287-296`),
  covering the released id and every alias source. Have `observe` / `recordTaskTexts` skip tombstoned ids until a tap
  binds them again, and add `expect(getSnapshot(SESSION, TOOL_CALL)).toBeUndefined()`.
  Fix this round? No: no lane config or data at risk, only a bounded leak.
- **M2 — An exact `agentId` match on a `completed` record is treated as live.** `subagent-hook-handler.ts:352-375`
  re-registers only `interrupted`, and every other status gets `update(…, {})`. A completed agent that is resumed
  therefore stays `completed` while the log says "bound". Fix: re-register every status except `running` and
  `background`, or at least `completed`, and add a spec. Fix this round? No.
- **M3 — F.1 M3 is only half closed: preview and rotation seed carry no read status.** `session-budget.service.ts:767`
  discards `readStatus`, and `HandoffCopy` (`content`, `seed`, `path`) has no field for it. Only `entry.handoff`, the
  banner's written handoff (`:590-601`), is flagged. "Continue in new session" or "Rotate" then seeds from a transcript-less
  document without warning. Fix: add `readStatus` to `HandoffCopy`, set it in both builders, and surface it on the
  action result. Fix this round? No.
- **M4 — A failed child interrupt lets a late figure recreate a budget entry that is never released.**
  `session-spawner.service.ts:731-741`: the interrupt throws, so `releaseStatsOwners` never ran
  (`sdk-agent-adapter.ts:1491-1492`). The lease guard at `session-budget.service.ts:811` then lets the next live figure
  recreate the entry, and no later release comes. Fix: on interrupt failure, release the budget in the adapter's error
  path, or have `trackedEntry` also refuse when the lease predates the release (record the generation at release).
  Fix this round? No.
- **M5 — Eviction releases `realSessionId` even when another record still holds it.**
  `session-registry.service.ts:604-617` evicts query-less records. `:627-629` passes `rec.realSessionId` to the budget
  release without checking `bySessionId` or other `byTabId` records for the same id. A live session on the same SDK id
  loses its "Allow 20% more" extensions and its dismissals, and is blocked again at the next send. Plausibility depends
  on query-less registrations of a resumed id; see residual uncertainty. Fix: in `notifyEvicted`, include
  `realSessionId` only when no remaining record maps to it (two-line guard), plus a spec.
  Fix this round? Recommended: it can lose the user's in-memory budget state (extensions), which is the "lose data"
  bar, though it is not persisted data.

### Minor

- **m1** The retry gate takes `attemptMessageId` from `state` (`subagent-budget-monitor.ts:565`) but stores it on
  `liveState` (`:655`). After a merge the gate compares against a different state's `lastMessageId`, which costs at
  most one stray attempt.
- **m2** `rekey` records an alias even when `from` has no state (`subagent-budget-monitor.ts:381-382`). Aliases are
  removed only through `release` chains, so a rekey for an id no tap tracked stays in `aliases` for the process
  lifetime.
- **m3** Re-registering an interrupted match resets `startedAt` to now and drops `isBackground` and `backgroundStartedAt`
  (`subagent-hook-handler.ts:352-361`, `subagent-registry.service.ts:113-124`). A resumed background agent is listed
  as a foreground agent.
- **m4** `interruptInBackground` releases the budget only once the interrupt settles
  (`session-spawner.service.ts:1319-1327`). A hung interrupt keeps the entry until dispose.
- **m5** Traceability: M7 names `/clear`, but the adapter keeps the budget on `/clear` by design
  (`sdk-agent-adapter.ts:1480-1492`). Batch 16 and its report do not say that the `/clear` part is closed with that
  rationale.

## Data flow

1. Result → `SessionBudgetService.observe` → `accept` → `trackedEntry` (`:804-820`). OK: a released id is dropped on
   `live` while there is no stats lease, and re-tracked on `loaded` or when a new owner exists. Gap: M4 (the lease
   survives a failed interrupt).
2. Compaction → `recordCompaction` → `trackedEntry('live')`. OK.
3. User action → `act`. `write-handoff` and `preview-handoff` refuse without an entry (`:742`, `:759`), and
   `restore-window` refuses without a figure (`:719`). OK (F.1 M5). `restore-failed` maps to `success: false` with
   state. OK (F-A).
4. Handoff build → `buildHandoff` returns `readStatus` → written handoff flagged (`:601`). Gap: the preview drops it
   (M3).
5. Session end → `endSession` / `endSessionIfTokenMatches` → stats owners released, then the budget. OK (order
   matches the lease guard). Idle eviction → `onEvicted` → `releaseBudget`. Gap: M5. Headless child stop → interrupt
   → `markEnded` → `releaseBudget`. Gap: M4.
6. Stream message → tap `onMessage` → monitor `observe` (old id resolved through aliases). OK during the run; gap
   after release (M1).
7. Turn end → context-usage read → `.then` uses `currentId(this.sessionId)`. OK (FM-4).
8. Stream end → tap `release` resolves every tracked id plus its rekeyed id, and skips ids a newer run owns. OK
   (FM-5, FM-9). The "already active" resume passes the same tap (`sdk-agent-adapter.ts:1002-1003`; the WeakMap key is
   the same `Query` object that `setSessionQuery` stores, `session-query-executor.service.ts:780-804`). OK. A second
   consumer ending first releases the tap. That is acceptable because both `for await` loops share one generator.
9. SubagentStart → `toolUseId` registers it. Without `toolUseId`, an exact `agentId` match binds. Gaps: S1, M2.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| F.1 M1 restore shape (F-A `restore-failed`) | COMPLETE | Type doc, control and budget service agree |
| F.1 M3 empty or failed handoff read flagged | PARTIAL | Written handoff only; preview and seed not flagged (M3) |
| F.1 M4 v4-only UUID check | COMPLETE | Verified v4 and commented (`branded.types.ts:39-40`) |
| F.1 M5 handoff actions for unknown sessions | COMPLETE | — |
| F.1 M7 release on eviction, `/clear`, headless child | PARTIAL | Eviction: M5 over-release. Child: M4. `/clear` not recorded (m5) |
| F.5 M1 `markAllInterrupted` stamps `lastActivityAt` | COMPLETE | — |
| F.5 B1 / F-F `agentId` binding without `toolUseId` | PARTIAL | New foreground subagent unbound (S1); `completed` match (M2) |
| F.6 `keepPreviousFigure`, `.tmp` orphan | COMPLETE | — |
| G.1 warn-once threshold and env | COMPLETE | — |
| G.2 rekey ordering against buffered old-id messages | PARTIAL | During the run OK; after release, the old id starts a fresh state (M1) |
| G.7 rename (G-B) | COMPLETE | — |
| G.8 FM-4/5/6/8/9, capper `numLines`, tap doc, guarded callback, already-active tap | COMPLETE | m1, m2 |
| G-E FM-7 doc note | COMPLETE | `post-tool-use-hook-handler.ts:136-141` |
| F-E pricing helper (shared part) | COMPLETE (shared part only) | Consumer is frontend; not reviewed here |

Implicit requirements not addressed: tombstones for released monitor ids (M1); eviction must not release an id that
another record holds (M5).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Late result after `endSession` | YES | Lease released before budget release; guard on lease | — |
| Late result after a failed child interrupt | NO | Lease still exists | M4 |
| Released ids beyond 1024 | YES | Oldest dropped | The oldest id can be resurrected by a very late figure (acceptable) |
| Old-id subagent message after release | NO | New state created | M1 |
| Rekey back to an earlier id | YES | `aliases.delete(to)` before set | — |
| Several stop rejects from one request | YES | `failedStopMessageId` gate | m1 after merge |
| Stop in flight on both merged records | YES | `onStopFailed` skips while in flight | — |
| `agentId` match: 0 / 1 / several | YES | WARN / bind / WARN | `completed` match (M2) |
| Hook invoked without `options` | YES | `options?.signal` | — |
| Orphan `.tmp` younger than 10 min | YES | Kept | — |
| Restore fails | YES | `restore-failed`, `applied: true` | — |

## Verdict

- Recommendation: APPROVED WITH FIXES
- Confidence: MEDIUM. All in-scope production hunks were read. M5's plausibility depends on query-less registrations
  that I did not trace to their callers, and the frontend consumers of `readStatus`, `restore-failed` and
  `pricesCacheTokens` are out of scope.
- Top risk: a foreground subagent that starts without `toolUseId` stays unbound, so it cannot be stopped or
  budget-stopped (S1), while F.5 B1 is reported as fixed.
- Fix this round: S1, either implemented or explicitly re-recorded as PARTIAL with a named later task; M5 (two-line
  guard, protects the user's budget extensions).
- Named later tasks are acceptable for M1-M4 and m1-m5. None of them can break a lane config or lose persisted data.
- What a robust implementation would add: deferred binding of an unbound start on the Task tool result; a capped
  tombstone of released ids in the monitor; `readStatus` on `HandoffCopy`; eviction release scoped to ids no other
  record holds; budget release on the adapter's interrupt-failure path.

Unreviewed in this scope: none of the production files; spec files were read only where a finding depends on them.
