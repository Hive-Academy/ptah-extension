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
