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
