# Decisions - TASK_2026_627

Team-leader decisions taken while verifying batches. Each names the batch, the choice and why.

## D1 (Batch 3): `## Agent handoff` sits under the document title

- Choice: accept the agent section directly under the `# Session handoff` title line, as the first
  section of `content` and of the seed (after the seed preamble), rather than before the title.
- Why: implementation-plan.md:340 asks for the section "at the top of `document.content`". Keeping
  the title as the first line preserves the document shape; the agent text is still the first
  section and is never squeezed out (R8 regression spec). Moving it above the title is a one-line
  change in `withAgentHandoff` if ever required.

## D2 (Batch 3): stale seed-cap comment goes to Batch 4

- Finding: `libs/shared/src/lib/types/session-budget.types.ts:319` still says the seed is at most
  8,200 characters; since Batch 3 it is 14,200.
- Choice: not fixed in the Batch 3 commit. Added to Task 4.1, which already owns the shared contract
  in the same lib (`@ptah-extension/shared`) and runs the shared typecheck.
- Why: the team-leader does not edit code, and Batch 3's scoped checks did not cover the shared lib.
  The comment is documentation only; nothing reads or validates it. Batch 4 grows from 6 to 7 files
  by one comment line, still 2 libs.

## D3 (Batch 3): `di/register.ts` edit is in scope

- Choice: accept the one-line change passing `c.resolve(MainThreadNoticeQueue)` to the
  `SessionBudgetService` factory.
- Why: the service is built by a factory, not decorator injection; without the line the optional
  queue is never supplied in production and `release`/`clearAll` would clear nothing (Task 3.2's
  requirement). `MainThreadNoticeQueue` is registered earlier in the same file (Batch 1).

## D4 (Batch 4): `SessionHandoverRuntime.subagentsInFlight` becomes required (in Task 5.2)

- Finding: the executor made the method optional (`subagentsInFlight?(id): number`) so that
  `session-lifecycle/session-stream-pump.service.spec.ts:290`, whose `attachRuntime({...})` literal
  sits outside the batch, keeps compiling.
- Judgement: optional is safe at runtime. The coordinator reads
  `this.runtime?.subagentsInFlight?.(id) ?? 0`, so a missing method counts as 0 subagents, which is
  the pre-batch behaviour. The only production runtime (`session-lifecycle-manager.ts:502`) supplies
  it, and the lifecycle spec asserts the count. So Batch 4 is accepted and committed (833e5dadd).
- Choice: still make it required, and add `subagentsInFlight: jest.fn().mockReturnValue(0)` to the
  stream-pump spec mock. This is Task 5.2, not a Batch 4 rejection.
- Why: with an optional member, a runtime that forgets the method fails open without any signal.
  The work-in-flight gate this task adds is then disabled, and a handover cuts off running
  subagents. A required member lets the compiler catch that. The fix is one line in a test-only file
  in the same lib, so "outside the batch" is a scoping reason, not a design reason. It goes in
  Batch 5 because that batch already precedes the Phase 1 review and is small (2 libs, 4 files).
- Resolved in Batch 5 (6cb27e3e4): the method is required, `workInFlight` calls
  `this.runtime?.subagentsInFlight(id) ?? 0`, and the stream-pump spec mock supplies it. Typecheck of
  `@ptah-extension/agent-sdk` passed with no other edits. The leftover `subagentsInFlight?.(` calls
  in `session-lifecycle-manager.spec.ts:897, 909` still compile and are harmless; they can be tidied
  later.

## D5 (Phase 1 review): S1 is confirmed. At the blocking limit, the waiting op becomes `budget-limit`

- Evidence: `session-handover-coordinator.service.ts:293-312`. `reason = live?.reason ?? ...` keeps
  `budget-auto` for a live operation, so the gate still applies when `atBlockingLimit` is true. The
  plan says "`budget-limit` is not gated (the user confirms)" (implementation-plan.md:270).
- Choice: Task 5F.1 item 1. The waiting `budget-auto` operation is converted in place to
  `budget-limit`, keeping the same operation id. `waitingFor` is cleared, and the operation follows
  the existing path to `awaiting-confirmation` (or starts, if `userConfirmed`).
- Why convert rather than just skip the gate: if only the gate were skipped, a `budget-auto` op at
  the hard limit would start automatically and cut off running subagents without a click. That
  contradicts the plan's limit path (:395-396).

## D6 (Phase 1 review): S2 is confirmed. The wait is bounded at 15 minutes, then the user is asked

- Evidence: `getRunningBySession` has no expiry check (`vscode-core/.../subagent-registry.service.ts:574-597`).
  The registry TTL is 24 hours (`:18, :63`), so an expiry filter alone does not bound the wait.
  `countRunningLanes` counts any `running` lane.
- Bound: `WORK_IN_FLIGHT_WAIT_LIMIT_MS = 900_000`. It equals `MAX_AGENT_WAIT_MS`
  (`cli-agent-runtime/.../agent-process-manager.service.ts:211`), the longest time the main agent
  itself blocks in `ptah_agent_wait`. Work still "running" after that long, with no terminal that
  clears it, is either leaked or long enough that a person should decide. The existing
  `HANDOFF_REQUEST_TIMEOUT_MS` (180 s) was rejected as the bound: legitimate subagents and lanes
  run longer than 3 minutes.
- Action at the bound: escalate. The operation moves to `awaiting-confirmation` and stays
  `budget-auto`; it does not proceed automatically. Proceeding would close the source and end any
  running subagent that is still doing real work. Escalating keeps every input: held inputs are
  transferred on "Continue now" and restored on "Cancel". The banner already offers both actions at
  the handoff stage (constraint added to Task 6.2). One WARN line records the escalation.
- No timer: the check runs at each terminal (and via `armHandoverIfIdle` → `armAtTerminal`),
  because the plan forbids new timers, observers or polls (implementation-plan.md:421). Remaining
  gap, accepted: if no terminal ever arrives, the op keeps waiting. Usage cannot grow without
  turns, and "Continue now" is always available. When turns do arrive, S1 (D5) guarantees the
  blocking limit reaches a confirmation.

## D7 (Phase 1 review): M3 and M4 qualify for the fix round, because they lose data

- Rule applied: a Moderate is fixed only if it can break a lane config or lose data.
- M3 is confirmed (`coordinator:617-625`). `readHistoryForCuration` drops everything before the
  last compaction boundary (`session-history-reader.service.ts:792-795`). A compaction between the
  two reads removes `previousId`, so `previousIndex = -1` and every assistant message is joined.
  The builder keeps the head (D7/M4), so the agent's real handoff, the last message, is lost and
  replaced by old text. That is data loss of the R8 deliverable. Fix: Task 5F.1 item 3.
- M4 is confirmed (`session-handoff-builder.ts:212-223` `capText` keeps the head; `quoteWithin`
  `:659-676` uses it). The prompt orders `## Still running` and `## Next action` last
  (`coordinator:135-146`), so any handoff over 6,000 characters loses exactly the sections the
  successor needs, including the ids of running lanes. That is data loss. Fix: Task 5F.2 (head and
  tail), plus a length line in the prompt (Task 5F.1 item 4).

## D8 (Phase 1 review): the remaining findings are deferred, recorded, or dropped

Deferred as named later tasks (batches.md "Deferred follow-ups"):

- 627-L1 (M1, notice can miss the Agent result). The race is confirmed: the notice is posted only
  after `await stopSubagent` (`subagent-budget-monitor.ts:666-690`). It is not data loss: the
  notice is advisory, and the plan's failure rule is "notice not delivered → terminal handover
  still runs" (implementation-plan.md:403-404). Target: Batch 7, which adds the wrap-up notice on
  the same queue.
- 627-L2 (M2, stale `waitingFor`). Confirmed (`snapshot` `:782`; `cancel`/`fail`/`sourceEnded` keep
  it). It is display only, and its one planned consumer (Task 6.2) keys on `waiting-for-turn-end`.
  That guard is now written into Task 6.2. S1 and S2 clear it on their own transitions.
- 627-L3 (M5, `startedTasks` unpruned). Confirmed. The entries are small and released at session
  end.
- 627-L4 (style Moderates 1 and 2: concrete coordinator injection and registration in the
  constructor). Allowed by the lib boundary; no runtime fault; nothing lost.
- 627-L5 (per-terminal republish at INFO, and the style minor on INFO per publish). Noisy but
  bounded.
- 627-L6 (`admitInterrupt` refuses an interrupt during `waiting-for-turn-end`). This is existing
  behaviour from 9fe19b56e and is not part of this diff. `interruptCurrentTurn` only forces a new
  turn for a queued message (`session-control.service.ts:86-92`); the message is not lost. The wait
  is now bounded by D6.

Recorded only (Minor, not fixed):

- `clearAll` clears notices only for sessions that have a budget entry (at most 4 per session,
  capped).
- `setLaneWorkProvider` has a single slot. Correct today; the release is identity-guarded.
- `@inject(...) noticeQueue?` uses a different optional idiom from `{ isOptional: true }`.
- `MainThreadNoticeQueue` uses a class token while the `SDK_TOKENS.*` entries use Symbol.for tokens;
  the repository is already mixed (`SessionRotationAdvisor`).
- `logger: Logger | null` uses the positional-factory style (historical).

Dropped as not a defect in this diff, with evidence:

- "`armHandoverIfIdle` has no caller". This is by design: its caller is Task 8.1, which is blocked
  on TASK_2026_626 (batches.md "Plan deviations").
- "Notice text embeds model-authored task text". `handoffMessage` already embedded `taskText`
  before this task (`git show af9ed9112:.../subagent-budget-monitor.ts`, lines 690 and 699). Only
  the carrier changed. The text is the parent's own `Agent` prompt echoed back to the parent, and
  the queue caps it at 2,000 characters.
- "Seed-cap doc comment may duplicate the constant". Verified: `14_200` is defined once, in
  `SESSION_HANDOFF_LIMITS.seedChars` (`session-handoff-builder.ts:50`).
  `session-budget.types.ts:319` only refers to it in prose (D2).

## D9 (Batch 5F): accept the new `max-lines` warning now; extract the work gate later (627-L7)

- Evidence: `npx nx lint @ptah-extension/agent-sdk --parallel=1` after 5F reports 0 errors and 53
  warnings (baseline 52). The new one is `session-handover-coordinator.service.ts:811:1 max-lines`,
  "File has too many lines (726). Maximum allowed is 700". The file was at about 697 counted lines
  before 5F (Batch 4 record: "the coordinator stays under `max-lines`"). The growth is the S1
  in-place conversion, the S2 bound and the M3 fallback, all required by the fix round.
- Options: (a) accept the warning and name a later extraction task; (b) a Batch 5G extraction before
  the re-review.
- Choice: (a). The re-review is meant to check S1, S2, M3 and M4 only, on one commit
  (`6cb27e3e4..44eba9fc3`). An extraction first would move the very code under review into a new
  file and add a second commit, so the re-review would also have to prove a refactor preserved
  behaviour. It is a warning, not an error, and the 5F verification rule ("no warning on a changed
  line") holds: it is reported on the last line.
- Follow-up 627-L7 (batches.md "Deferred follow-ups"): after the re-review accepts, extract the
  work-in-flight gate (`workInFlight`, the wait bound, the S1 conversion and the lane-provider slot)
  into its own helper in `session-handoff/`, split by responsibility, no suppression comment.
  Behaviour-preserving; existing specs must pass unchanged.

## D10 (out of scope): unbound `remove` in the agent lane grid (OOS-1)

- Reported by the user from the running app: closing a lane throws "Cannot set properties of
  undefined (setting 'userPicked')".
- Cause: `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:55`
  passes the unbound method `remove` into the template context, so `this.userPicked = true` at
  `:200` runs with `this` undefined.
- Not caused by this branch and not a task of it. Recorded only; awaiting the user's choice (a
  separate task, or a batch on this branch).

## D11 (Phase 1 re-review): Phase 1 closes; the fenced-block tail cut is recorded, not fixed (627-L8)

- `code-logic-rereview-5F.md` on `6cb27e3e4..44eba9fc3`: APPROVED. S1, S2, M3 and M4 are FIXED, and
  no new Blocking or Serious defect was found.
- One Minor: when an over-cap agent handoff has neither `## Still running` nor `## Next action`, the
  fallback tail in `capHeadAndTail` starts at a line start inside the last half of the budget, and
  that line can be inside a fenced code block. The quoted section then shows an unbalanced fence.
- Not fixed: the fix-round rule fixes Minor findings only by record. The reviewer rates it display
  only: the cut is marked with `[truncated]`, and the heading-based tail (the normal case) is
  unaffected. Scheduled as 627-L8.
- Phase 1 (Batches 1-5 and 5F) is closed. Batch 6 (Phase 2) starts. Task 6.2 already carries the M2
  guard (627-L2): counts only while the phase is `waiting-for-turn-end`.

## D12 (Phase 3 unblock): `origin/main` with TASK_2026_626 merged into the branch at `91376becf`

- 626 (PR #698) is in main. The orchestrator merged `origin/main` into `fix/session-budget-handoff`
  (`91376becf`); Batches 7 and 8 are unblocked.
- One conflict, `libs/frontend/chat/src/lib/services/message-sender.service.ts`: resolved to the
  branch side (R9 `console.info` for a budget refusal and a handover hold), a superset of main's
  change.
- Post-merge checks (orchestrator): typecheck of shared, agent-sdk, cli-agent-runtime, chat-ui and
  chat passed; chat `message-sender` and `session-budget-actions` specs 90/90 passed.
- Lint: the agent-sdk warning count rose 53 -> 54 with the merge, not with Batch 7. Checked per file
  with eslint against the pre-merge commit `0ab622eb4`: `session-stats-owner.service.ts` grew from
  902 to 1112 lines and now has a `max-lines` warning (709 > 700) it did not have before; the other
  merged files kept their warning counts, and `session-budget.service.ts` had its `max-lines` warning
  before Batch 7. Owned by 626; not fixed here.

## D13 (Batch 7): a newer authoritative revision drops the live figure; an older live one is ignored

- Accepted. 626's owner contract (`session-stats-owner.service.ts:15`, `clearProvisional`) says every
  authoritative snapshot carries a higher revision than any live one before it, so `>` in
  `acceptOrThrow` and `<` in `observeLive` are the right comparisons; an equal-revision live snapshot
  (another run still holds an estimate) is accepted.
- Without it, a turn-end overestimate would stay in `stageFor`, which the lifecycle reads before
  Batch 8's `onTurnTerminal` runs, and could arm a `budget-auto` handover the result does not justify.

## D14 (Batch 7): disable, extend and a settings change clear the live figure

- Accepted. Each changes the limit or the measure the estimate was computed against; resetting
  `liveNoticedRank` on extend or a settings change lets the wrap-up notice post again against the
  new limit. Disable never creates an entry.

## D15 (Batch 7): the first turn's live figure is evaluated without the measure check

- Accepted. With no authoritative figure there is nothing to compare against. Residual (Minor,
  recorded): on a cost budget whose first-turn estimate has an unpriced row, the live figure may be
  measured as a lower bound or the weighted fallback and raise `stageFor` (advisory only; it never
  refuses a send) until the first authoritative snapshot, whose higher revision drops it (D13).
  For the Phase 3 code-logic review to weigh; no fix now.

## D16 (Batch 7): the small amount formatter in `session-budget.service.ts` is kept

- Accepted. `formatAmount` in `session-handoff-builder.ts` is not exported, and the executor stayed
  within its two files. Recorded as Minor duplication; can be unified with any later touch of the
  handoff builder.

## D17 (Batch 8): a live `limit` estimate must not auto-arm at the turn terminal

- Evidence: the terminal runs before the result (`stream-transformer.ts:698` vs `:996`), so at
  `onTurnTerminal` `isAtBlockingLimit` reads only the authoritative figure (`canSend`) and is false,
  while `stageFor` returns the live `limit`. With `atHandoffStage` true and no work in flight,
  `armAtTerminal` creates `budget-auto` in `armed` and calls `startAutomatic` at once
  (`session-handover-coordinator.service.ts:319-377`). S1 (D5) converts only an op still in
  `waiting-for-turn-end` (`:309-318`), so when the blocking result then reaches `armHandoverIfIdle`
  the op is already running and is never converted. The rotation proceeds without the user's click
  and without the "Allow 20% more" choice.
- That contradicts user decision 1 (`handoff.md:24`, limit = one click "New session") and D5's own
  reason ("a `budget-auto` op at the hard limit would start automatically ... without a click").
- Choice: not accepted. The live figure may arm automatically at the terminal only at `handoff`
  (the plan's path, implementation-plan.md:387-388); `limit` counts as the handoff stage only in the
  post-result `armHandoverIfIdle`, where the live figure is already cleared and the stage is
  authoritative. The lifecycle cannot tell a blocking from a non-blocking budget for a live-only
  `limit` (no public config on `SessionBudgetService`), so deferring to the result is the only safe
  choice inside the batch's files. Fix listed in batches.md Batch 8.

## D18 (Batch 8): the Batch 7 regression is real and stays fixed through the result path

- Evidence: `stageFor` returns the higher of the authoritative and live stages
  (`session-budget.service.ts:381-387`), so authoritative `handoff` + live `limit` gave `limit`, and
  `=== 'handoff'` armed nothing; a non-blocking authoritative `limit` never armed at all. With D17's
  split, both recover when the result lands: `wrapResultStatsForActivity` calls
  `armHandoverIfIdle` for `handoff`/`limit`, which arms `budget-limit` (blocking) or `budget-auto`
  (non-blocking or still `handoff`).
- Residual (Minor, recorded as 627-L13): if a held input starts the next turn before the result is
  processed, `armHandoverIfIdle` is a no-op and a non-blocking authoritative `limit` is not armed at
  the next terminal either; it arms after the first result that lands with the source idle.

## D19 (Batch 8): the Prettier reformat of four Batch 4 blocks is accepted

- Formatting only (the `admitInterrupt` lambda, `queueOwnedHandoff`, `isOwnedHandoffPendingOrRunning`,
  the two `subagentsInFlight` loops); the diff shows no token change. The file must pass
  `prettier --check`, and these blocks were the only ones failing it.

## D20 (Batch 8): the turn-end order finding is accepted; the live overestimate goes to Phase 3

- Confirmed: the live figure decides the terminal arming, and D13 cannot drop it there because the
  result has not arrived. This is the plan's intended path (implementation-plan.md:387-394), so no
  change in Batch 8.
- For the Phase 3 code-logic review: (1) a live `handoff` overestimate the result does not justify
  starts `budget-auto`; (2) a live `handoff` at the terminal whose result reaches the blocking limit
  has already started `budget-auto` and is not converted by S1, the same click bypass as D17 by a
  narrower route. Any fix would touch the coordinator, outside Batch 8.
