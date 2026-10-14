# Fix round 3: R3 new findings 1 (Blocking) and 2 (Serious)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice` (branch
`fix/subagent-handoff-notice`, HEAD `51fb2c3cb`). Nothing was committed or pushed, and no
state-changing git command was run.

Paths below are relative to `libs/backend/agent-sdk/src/lib/helpers/compaction/`.

## R3 finding 2 (Serious): a parent message arrived before the pending record existed

`subagent-handoff-delivery.ts`

- `:229-262` adds `sendDropped`, which replaces `send(..., keepPending=false)`. The queue's
  `onDropped` for the fallback notice (`:169-173`) now calls it. It registers the pending
  record **before** the drop-triggered send starts (`:247`). The push then runs through
  `pushRecord` (`:297-315`), which holds `inFlight` for the whole 3-attempt backoff.
- `:104-114` gives the `PendingHandoff` record two new flags: `missed` and `noticeDue`.
- `retryPending` `:189-213` handles a record that is in flight by setting
  `record.missed = true` (`:206`) instead of skipping it silently. It never starts a
  second push.
- `retryIfMissed` `:289-294` runs after a failed drop-triggered send (`:261`) and after a
  failed retry (`:271`). When an opportunity was missed, it makes one retry right away,
  which counts toward the cap. Recursion is bounded by `PENDING_HANDOFF_MAX_RETRIES`.
- Exactly-once:
  - `inFlight` means only one caller pushes a record at a time.
  - `retryPending` also skips a record that an earlier `await` in the same loop saw
    delivered or replaced: `this.pending.get(record.toolCallId) !== record` (`:200`).
    This closes a latent double push when two records and two concurrent opportunities
    interleave.
  - A record is created only after the queue dropped the notice, so a handoff is never
    queued and pending at the same time.

## R3 finding 1 (Blocking): the retry cap deleted the handoff silently

`subagent-handoff-delivery.ts`

- `:72-80` adds the exported `Handoff` type: `text`, `subject: HandoffSubject` and
  `notesPath?`. `post` (`:139`) and `send` (`:152`) take a `Handoff` instead of the text.
- `:86-101` adds `undeliveredHandoffNotice(handoff)`. It says that the monitor stopped
  subagent `` `type` `` (plus `('name')` when there is one), and that its handoff message
  could not be delivered. It then gives:
  - the progress notes path, or "unavailable (workspace unknown)";
  - the output file and task id, using the normal handoff's wording, or the task id in
    the task notification.

  It contains no task or prompt text.
- `retryRecord` `:265-286`: at the cap it logs one warn (ids, retry count and error type,
  no text) and calls `postUndeliveredNotice`.
- `postUndeliveredNotice` `:321-343` removes the record and posts the notice through the
  existing main-thread notice route (`postMainThreadNotice`, the same PostToolUse queue
  the fallback uses).
  - If the queue drops that notice while the session is live, the `onDropped` callback
    puts the record back with `noticeDue = true` and logs one warn.
  - At the next main-thread message, `retryPending` posts the notice again (`:207-208`)
    and does not push again.
  - If the session was released, the record is not put back.
  - Memory stays bounded: there is at most one record per spawning tool call (the map key)
    and at most one queued undelivered notice per record. While the notice is queued the
    record is out of the map, so it is never both. `release()` (`:216-222`) drops records
    at session end. No timer was added.
- Header doc `:1-44` describes the remembered opportunity and the undelivered notice.

`subagent-budget-monitor.ts` (wiring only; eslint `max-lines` still clean)

- `:98` imports `type Handoff`.
- `:256`: `pendingNotice` now holds `{ sessionId, handoff }`. `:736,739` withdraw
  `pending.handoff.text` and send `pending.handoff`.
- `:865-883`: `runHandoff` names the existing `HandoffSubject` literal `subject`, passes it
  to `handoffMessage` unchanged, and builds `{ text, subject, notesPath: files.paths?.notes }`.
  The notes path is the same one the handoff names.
- `:895-907`: `deliverHandoff` takes and forwards the `Handoff`.
- Header doc `:43-45` gains one sentence about the undelivered notice.

## Specs (`subagent-handoff-delivery.spec.ts`)

- The harness has a `HANDOFF` fixture whose text includes `SECRET-PROMPT`, a notes path, and
  `UNDELIVERED = undeliveredHandoffNotice(HANDOFF)`. Existing `send`/`post` calls now pass
  `HANDOFF`.
- `:183` (finding 2): the first send gets 3 rejects and the fallback is cleared at turn end.
  The drop-triggered push 1 rejects. `retryPending` runs **during the backoff** and
  produces no extra push. Pushes 2 and 3 then reject. The remembered retry then delivers
  right away (push 7, with the text). A later `retryPending` does not push, and the queue
  is empty.
- `:216` (finding 2): the remembered retry also rejects. The record is kept, and the next
  opportunity delivers it exactly once.
- `:239` (finding 1) replaces the old "dropped with one warn" spec. After
  `PENDING_HANDOFF_MAX_RETRIES` failed retries:
  - exactly one `postMainThreadNotice` and one warn, with no text;
  - two later opportunities push nothing and post no second notice;
  - the queue holds exactly `UNDELIVERED`.
- `:267` (finding 1): the undelivered notice is dropped by a turn-end clear. Two later
  opportunities make one re-post and no push, and the queue holds `UNDELIVERED`.
- `:287` (finding 1): the session is released, then the clear drops the notice. The record
  is not kept, and no later re-post happens.
- `:304`: the notice names the notes path, the output file and task id, and the teammate
  name. It shows "unavailable (workspace unknown)" without a notes path and never contains
  the task text.

## Results (run from the worktree)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts .../subagent-handoff-delivery.spec.ts .../subagent-budget-monitor.spec.ts --coverage=false --maxWorkers=2`:
  `Test Suites: 2 passed, 2 total; Tests: 84 passed, 84 total` (79 before, with 1 spec
  replaced and 6 added).
- `npx eslint` on the 3 changed files: exit 0 with no output. The first run warned
  `max-lines` 701/700 on the monitor; I removed 3 lines in `runHandoff` and the re-run was
  clean.
- `npx prettier --write` on the 3 changed files: all unchanged, and `--check` on the
  monitor passes.
- `ptah_get_diagnostics` (errors) on the 2 changed sources: 0 errors, `analyzed: null`. The
  ts-jest compile of both specs is the effective type check.
- No Nx, build, serve or e2e commands were run.

## Changed files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`

`subagent-budget-monitor.spec.ts` needed no change; it passes as is.

## Decisions

1. **Finding 2: register first and remember.** The record exists before the drop-triggered
   send starts, so an opportunity during its backoff is never lost. Because that
   opportunity means the parent stream is live right now, it is remembered (`missed`) and
   used for one immediate retry after the in-flight push fails, instead of waiting for
   another message that may not come in this turn. The remembered retry counts toward the
   cap, so the number of pushes is still bounded (3 + 3 + 5).
2. **Finding 1: an undelivered notice after the cap, not an unbounded record.** At the cap,
   a short notice built from the handoff's subject and notes path goes to the existing
   main-thread notice queue, and the record is dropped. "Route unavailable" means the
   queue's own failure signal: the notice was dropped undelivered (turn end, queue bound).
   The record then comes back for re-posting only, never for pushing, until the session
   ends.
   - `postMainThreadNotice` is synchronous and does not report failure, so a dropped
     notice is the only observable unavailability.
   - The notice is posted at most once per opportunity, and never while one is still
     queued.
3. **The notice text is built in the delivery module** (`undeliveredHandoffNotice`),
   because `subagent-handoff-message.ts` is outside this round's file scope.
   - The monitor passes data (`HandoffSubject`, notes path) and builds no text, which keeps
     its change to wiring.
   - The output-file sentence reuses the handoff's exact wording.
   - The notice can never carry task or prompt text: it does not receive `taskText`.
4. **`SEND_TIMEOUT` still counts as delivered. This is unchanged on purpose**
   (`subagent-handoff-delivery.ts`, `push`).
   - The policy predates this work, and the R3 reviewer did not count it as a new defect.
   - The trade-off is the one recorded in fix-round-2 Decision 1. The dispatcher's
     10-second race does not cancel `streamInput`, which has already written or buffered
     the message. Resending risks a duplicate handoff.
   - There is still no delivery acknowledgment, so a timeout cannot prove consumption.
     That gap is out of scope for this round.

## Out of scope

- No monitor-level end-to-end spec covers the undelivered-notice path. The unit specs pin
  the delivery behaviour. The monitor wiring (`subject` plus `files.paths?.notes`) is
  covered only by type checking and the existing monitor specs, which still pass.
