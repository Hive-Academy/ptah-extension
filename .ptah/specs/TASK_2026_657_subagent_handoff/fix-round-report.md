# Fix round — code-logic-review findings 1-5

Worktree: D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice
(branch fix/subagent-handoff-notice). Nothing committed. Nothing pushed.

Status: DONE. All 5 findings fixed; the changed specs pass; eslint reports 0 problems on the
changed sources (max-lines is not exceeded).

Paths below are relative to `libs/backend/agent-sdk/src/lib/`.

## Finding 1 (BLOCKING): foreground handoff lost on queue eviction

- Change: `helpers/main-thread-notice-queue.ts`: `post(sessionId, text, onDropped?)` (:64).
  It now stores `{ text, onDropped }` entries. `onDropped` runs when a notice leaves the queue
  undelivered, either evicted past the cap (:77) or dropped by `clear` (:117-120, at turn end
  or session end). It never runs for `take` (delivered) or `withdraw` (taken back). A callback
  that throws is logged at debug and does not affect the other callbacks (:124).
- Change: new `helpers/compaction/subagent-handoff-delivery.ts`. `post()` (:68) queues the
  handoff with `onDropped` set to send it as a user turn. The monitor calls it for foreground
  stops (`subagent-budget-monitor.ts:898`). The undrained-withdraw path still sends through
  `delivery.send` (:732).
- Exactly once: each queue entry leaves the queue once, by take, withdraw or drop, and only
  a drop sends it. Handoff texts now contain the task id (finding 4). Withdrawing by text
  therefore cannot match another subagent's identical notice.
- DI: `di/register.ts:523` passes `onDropped` through.
- Proving specs:
  - `subagent-budget-monitor.spec.ts:1198`: "five foreground stops before any drain: every
    handoff is delivered exactly once". The evicted one is pushed, the other 4 are drained,
    and each later tool result sends nothing more. Every task id appears exactly once.
  - `main-thread-notice-queue.spec.ts`, `describe('onDropped')`: eviction runs only the
    oldest notice's callback; clear runs all of them; take and withdraw run none; a throwing
    callback is isolated.
  - `subagent-handoff-delivery.spec.ts`: "post: a notice evicted past the queue bound is sent
    as a user turn" and "post: a notice drained by take is never sent again".
- Result: pass.

## Finding 2 (BLOCKING): background pushParentMessage rejection swallowed

- Change: `SubagentHandoffDelivery.send` (`subagent-handoff-delivery.ts:81`):
  - It makes up to `PARENT_PUSH_ATTEMPTS = 3` attempts (:31), with a linear backoff of
    `PARENT_PUSH_RETRY_DELAY_MS = 500` ms per attempt (:33, so 500 ms and then 1 s).
  - Before each attempt it resolves the session's current id. A rekey moves it; if the
    session was released, delivery stops.
  - If every attempt fails, the handoff is kept pending in the main-thread notice queue. The
    next main-thread PostToolUse carries it, and one warn line is logged with ids, attempt
    count and error type, never the text.
  - If that fallback notice is also dropped (turn-end `clear`), one last send runs with no
    further fallback, because at turn end the query reads input again. If that send fails
    too, a second warn is logged.
  - The monitor's `pushHandoff` was removed. Background stops call `delivery.send`
    (`subagent-budget-monitor.ts:892`).
- `SEND_TIMEOUT` is not retried and not queued (:107). See Decisions.
- Proving specs:
  - `subagent-handoff-delivery.spec.ts`:
    - reject once, then success after exactly the backoff;
    - every attempt rejects, so the handoff waits in the queue, with one warn that does not
      contain the text;
    - the fallback is dropped at turn end, so there is one last send and nothing after it;
    - the last send fails, so it is logged and not queued again;
    - a timed-out push is neither retried nor queued;
    - a session released between attempts gets no further push.
  - `subagent-budget-monitor.spec.ts:1223` covers reject-then-succeed through the monitor;
    `:1243` covers all-reject, where the handoff stays pending in the queue, is taken by the
    next PostToolUse, and is warned once.
- Result: pass.

## Finding 3 (SERIOUS): prepareHandoffFiles unbounded

- Change: `helpers/compaction/subagent-handoff-files.ts`:
  - `HANDOFF_FILES_TIMEOUT_MS = 5_000` (:40).
  - New `prepareHandoffFiles(files, paths, prompt)` (:113) races the file operations against
    the timer and clears the timer in `finally`. On expiry or rejection it returns
    `{ paths, taskSaved: false, notesWritten: false, unavailable: true }`. It never rejects.
  - `HandoffFileState` moved here from the message module and gained `unavailable` (:49).
  - The monitor's private method was removed. The stop calls the function (`:840`) and warns
    when the files are unavailable (`:845`).
- Degraded message (`subagent-handoff-message.ts:84`): "Its progress notes file: unavailable
  (the file check did not finish); look for <notes>." The task prompt is taken from the Agent
  call, and the resume instruction reads "If <notes> exists, read it first ...".
- A late completion cannot cause a second notice: the stop continues only once, after the
  race, and the late promise result is ignored.
- Proving specs:
  - `subagent-handoff-files.spec.ts`, `describe('prepareHandoffFiles')`, with fake timers:
    nothing settles before 5 s; the result is unavailable at 5 s; a late result changes
    nothing; a rejection reads as unavailable.
  - `subagent-budget-monitor.spec.ts:1271`: file checks that never settle produce one
    degraded handoff after the bound; finishing the save late adds no second push or notice.
- Result: pass.

## Finding 4 (SERIOUS): hard stop does not name the output file

- Change:
  - `HandoffSubject` now carries `taskId` and an optional `outputFile`
    (`subagent-handoff-message.ts`). The stop passes the task id it used (`taskId` from
    `task_started` or the registry) and `task?.outputFile` (`subagent-budget-monitor.ts:863`).
  - The output file is correlated at stop time from the spawning tool result. For a
    background agent, the SDK's "Async agent launched" result contains an `output_file:`
    line, and `readOutputFile` (`:942`, string or text blocks) records it in
    `SpawnTask.outputFile` (`:716`).
  - Message (`subagent-handoff-message.ts:91-92`): "Its output so far is in <file> (task
    <id>)." or "Its output file: not yet known; it is in the task notification for task
    <id>." The second form is used for foreground stops, whose tool result arrives only
    after the stop.
- Proving specs:
  - `subagent-budget-monitor.spec.ts:1313` names the concrete path and the task id.
  - `:1128` checks the "not yet known ... task task-9." form.
- Result: pass.

## Finding 5 (MODERATE): unknown workspace omits notes status

- Change: `subagent-handoff-message.ts:82`. A notes line is now always printed, and with no
  workspace it reads "Its progress notes file: unavailable (workspace unknown)."
- Proving spec: `subagent-budget-monitor.spec.ts:1157`. The former "names no files" test now
  also asserts this line.
- Result: pass.

## Changed files

All paths are under `libs/backend/agent-sdk/src/lib/`:

- MODIFIED `helpers/main-thread-notice-queue.ts`: `onDropped` on eviction and clear.
- CREATED `helpers/compaction/subagent-handoff-delivery.ts`: user-turn retry, queue fallback,
  and send on drop.
- MODIFIED `helpers/compaction/subagent-handoff-files.ts`: `HANDOFF_FILES_TIMEOUT_MS`,
  `prepareHandoffFiles`, and `HandoffFileState` (moved here).
- MODIFIED `helpers/compaction/subagent-handoff-message.ts`: notes line always present,
  degraded file state, and task id / output file line.
- MODIFIED `helpers/compaction/subagent-budget-monitor.ts`: uses the delivery helper and the
  timed file preparation, records the output file, and updates the header doc. It is still
  under max-lines; eslint is clean.
- MODIFIED `di/register.ts`: passes `onDropped` through to `MainThreadNoticeQueue.post`.
- Specs:
  - CREATED `helpers/compaction/subagent-handoff-delivery.spec.ts`.
  - MODIFIED `helpers/compaction/subagent-budget-monitor.spec.ts`: the harness forwards
    `onDropped` and accepts a `handoffFiles` override; six assertions gained
    `expect.any(Function)`; the output and notes assertions are updated; there is a new
    `describe('delivery under load and failure')`.
  - MODIFIED `helpers/compaction/subagent-handoff-files.spec.ts`.
  - MODIFIED `helpers/main-thread-notice-queue.spec.ts`.
  - MODIFIED `helpers/session-lifecycle/session-query-executor.service.spec.ts`: one
    assertion gained `expect.any(Function)` for the new third argument.

## Verification (run from the worktree root)

- Jest on the five changed specs:
  `npx jest -c libs/backend/agent-sdk/jest.config.ts <subagent-budget-monitor, subagent-handoff-delivery, subagent-handoff-files, main-thread-notice-queue, session-query-executor.service specs> --coverage=false --maxWorkers=1`
  Result: Test Suites: 5 passed, 5 total. Tests: 147 passed, 147 total.
- `npx eslint` on the 5 changed sources: 0 problems; max-lines is not hit. On the specs, 2
  warnings remain, both in `session-query-executor.service.spec.ts` at lines 446 and 668.
  Neither line was touched in this round.
- `prettier --write` was applied to the changed files.
- `ptah_get_diagnostics`, scoped to the changed sources: 0 errors. Its coverage was reported
  as `analyzed: null`, which may mean it did not analyze the worktree, so the orchestrator's
  `nx typecheck agent-sdk` remains the authority.
- Not run, as instructed: `nx test`, `nx typecheck` and `nx lint` for agent-sdk.

## Decisions

- Drop notification is a per-notice callback (`onDropped`) rather than a delivery
  acknowledgement from the hook. This keeps the rule "absent means delivered" true:
  everything that removes a notice without delivering it now says so. It also needs no new
  wiring between the hook and the monitor.
- `clear()` also runs `onDropped`. At turn end the session budget clears the queue, and a
  handoff still pending there would otherwise be lost silently. A send at turn end is the
  right route, because the query reads input again at that point. On session release the
  send finds the session gone (the monitor's `liveSessionId`) and stops; at most one push
  is attempted against the dead session.
- Each fallback level runs at most once. A handoff goes first to the queue or a send. If the
  send fails, it goes to the queue. If that queue notice is dropped, one last send runs and
  nothing follows. So there is no loop, and the length of an eviction chain is bounded by the
  number of handoffs.
- `SEND_TIMEOUT` is not retried and not re-queued. The dispatcher leaves `streamInput`
  pending after its 10 s timeout, so the session may still read that message, and a retry or
  a queue copy could deliver the handoff twice, which would mean two fresh subagents.
  Rejections that prove non-delivery are retried and fall back: `SESSION_NOT_FOUND`,
  `SESSION_ENDED` and other errors.
- The output file is taken from the spawning tool result, which for a background agent is
  available before the stop. A foreground stop says "not yet known" with the concrete task
  id. The SDK `task_notification` arrives only after the stop, so waiting for it would delay
  the handoff or require a second message.
- `prepareHandoffFiles` is a module function in `subagent-handoff-files.ts` that takes the
  files port, so specs can inject stalled operations. `HandoffFileState` moved beside it (the
  message module imports it type-only) to avoid an import cycle between the two modules.
- The monitor's line budget was met by moving delivery into `subagent-handoff-delivery.ts`
  and file preparation into the files module.

## Out-of-scope observations

- `message-transform/background-started-event.ts:52-53` uses `JSON.stringify` on array
  content before matching `output_file:`. With text blocks, the escaped `\n` would make the
  captured path run to the end of the JSON. This was not touched; the monitor uses its own
  parser for string and text-block content.
