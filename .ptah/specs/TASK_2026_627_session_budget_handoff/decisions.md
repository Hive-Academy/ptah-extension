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
