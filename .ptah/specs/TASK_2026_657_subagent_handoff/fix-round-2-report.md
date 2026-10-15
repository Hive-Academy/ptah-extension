# Fix round 2 — R2 finding 2 / new defect (terminal fallback discards a handoff)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice` (branch
`fix/subagent-handoff-notice`, base `45485a0c1`). Not committed, not pushed.

## Change

`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.ts`

- `:43` new `PENDING_HANDOFF_MAX_RETRIES = 5`.
- `:63-70` new `PendingHandoff` record (`sessionId`, `toolCallId`, `text`, `retries`,
  `inFlight`) held in a `Map` keyed by spawning tool call id (`:82`). The map lives inside
  the session-owned delivery, which the monitor owns.
- `:107-151` `send`: the retry loop moved to `push` (`:207-244`), which returns
  `settled` (sent, timed out, or session released) or `failed` with the error type. When
  the drop-triggered send (`keepPending=false`) fails all 3 attempts, `:128-140` stores a
  pending record and logs one warn ("kept pending for the next main-thread message").
  Before this change it logged and dropped the handoff. The first failure still queues
  the main-thread notice fallback as before.
- `:159-195` `retryPending(sessionId)`: runs at each later main-thread message of the
  session. For each record of that live session that is not in flight, it pushes once.
  The record is deleted when the push settles or the session is released. After
  `PENDING_HANDOFF_MAX_RETRIES` failed retries it is deleted with one warn that carries
  ids, the retry count and the error type, but no task or prompt text. The `inFlight`
  guard means overlapping opportunities never push the same record twice.
- `:198-204` `release()`: deletes every record whose session no longer resolves live.
- Header doc `:1-35` describes the record route and the timeout decision.

`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`, wiring
only (+9/-2 lines):

- `observe`: a main-thread user message (`tool_result`) awaits
  `delivery.retryPending(sessionId)` after `recordToolResults` (`:362`). A main-thread
  assistant message awaits it after `recordTaskTexts` (`:371`). These are the existing
  natural opportunities: the parent's stream is running again. No timer was added.
- `release` calls `this.delivery.release()` after `this.sessions.delete` (`:588`), so a
  released session's records are dropped. A retry that finishes after release deletes
  its record because of the live-session check.
- Doc comments in the file header (`:42-44`) and on `observe` are updated.

## Specs

`subagent-handoff-delivery.spec.ts`, with a new helper `keepPendingRecord` that runs 3
rejects, clears the fallback at turn end, then sees 3 more rejects:

- (a) `:122`: after 3 rejects, the turn-end clear and 3 more rejects, the record is kept
  (6 pushes, 1 notice, 2 warns without text, queue empty). The next `retryPending`
  delivers once and a second call does not push. This replaces the old "logged, not
  queued again" spec, which asserted the defect.
- Exactly-once under overlap, `:143`: two concurrent `retryPending` calls make one push.
- (b) `:161`: session release followed by `delivery.release()` drops the record. With
  the session live again, `retryPending` does not push.
- (c) `:174`: after `PENDING_HANDOFF_MAX_RETRIES` failed retries there is exactly one
  warn without text and the record is dropped. A later opportunity does not push.
- (d) `:196`: a send that times out counts as delivered: no retry, no queued notice and
  no pending record (a later `retryPending` does not push). `:212`: a timed-out retry
  also drops the record.

`subagent-budget-monitor.spec.ts:1271`, end to end through the monitor: a background
handoff gets 3 rejects, the fallback is cleared, 3 more rejects follow, then two later
main-thread tool results deliver the handoff once.

## Results

- `npx jest -c libs/backend/agent-sdk/jest.config.ts .../subagent-handoff-delivery.spec.ts .../subagent-budget-monitor.spec.ts --coverage=false --maxWorkers=1`:
  `Test Suites: 2 passed, 2 total; Tests: 79 passed, 79 total`.
- `npx eslint` on the 4 changed files: no output (clean, no `max-lines` warning on the
  monitor).
- `npx prettier --check` on the 4 changed files: "All matched files use Prettier code
  style!"
- `ptah_get_diagnostics` (errors) on the changed sources: 0 errors. It reported
  `analyzed: null`, so ts-jest compiling the specs is the effective type check.
- No Nx project-wide runs and no build.

## Changed files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts`

## Decisions

1. **`SEND_TIMEOUT` counts as delivered: kept as before, now documented.** Evidence:
   - Dispatcher `subagent-message-dispatcher.ts:254-268` races
     `query.streamInput(single())` against a 10 s timer. The timer rejects the race but
     does not abort or cancel `streamInput`, so the write keeps running.
   - SDK `@anthropic-ai/claude-agent-sdk` 0.3.278 `sdk.mjs` `Query.streamInput`: for
     each yielded message it calls `await Promise.resolve(this.transport.write(...))`.
     `ProcessTransport.write` writes to the CLI stdin synchronously, or pushes onto
     `pendingWrites` while the process is still spawning. After that, when the query has
     bidirectional needs, `streamInput` `await this.waitForFirstResult()`.
   - So a slow `streamInput` means either the message was already written (or buffered)
     and the SDK is waiting for a result, or the write is still pending and will
     complete. Neither case is a lost message.
   - Resending risks a duplicate handoff. That breaks the exactly-once requirement and
     is more likely than loss.
2. **Opportunity = any later main-thread message observed by the monitor** (a
   `tool_result` user message or a main-thread assistant message). These are the
   existing hook paths. The main-thread `tool_result` is the stream-side counterpart of
   the PostToolUse the notice queue already rides on. Main-thread assistant messages
   cover the start of the next parent turn. They arrive only while the parent's query
   is streaming, which is when a push can succeed. No timer loop.
3. **One push per opportunity (no backoff inside), cap 5** (`PENDING_HANDOFF_MAX_RETRIES`).
   - Each record therefore has at most 3 + 3 + 5 = 11 pushes, then exactly one warn
     with ids, retry count and error type only.
   - A burst of main-thread messages can use the 5 retries quickly. That is accepted:
     failures while the stream is live are likely persistent, and the bound is
     required.
4. **Records keyed by spawning tool call id, with the creation-time live session id.**
   - `liveSessionId` resolves rekeys at retry time.
   - `release()` sweeps records whose session no longer resolves. The monitor calls it
     after deleting the session, so per-session bookkeeping is not duplicated.
   - A record exists only after the queue dropped the notice. A handoff therefore never
     sits in the queue and in a record at the same time, so it cannot be delivered
     twice.

## Out of scope

None found.
