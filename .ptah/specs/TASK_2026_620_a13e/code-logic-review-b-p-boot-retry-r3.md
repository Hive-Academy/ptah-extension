# B-P boot/retry r3 review

Reviewed latest commit `48572ef5e`.

## Finding status

1. **CLOSED for the simple stopped-run path — prior r2 host-continuation finding (P3).** A stopped service reports that state through `isStopped()` ([skill-synthesis.service.ts:571](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:571), [skill-synthesis.service.ts:577](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:577)); both host trigger gates now consult it ([boot-thoth-runtime.ts:412](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:412), [boot-thoth-runtime.ts:417](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:417), [cli-engine thoth-runtime.ts:287](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:287), [cli-engine thoth-runtime.ts:292](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:292)). A paused boot is not stopped, so its normal continuation still arms the owed boot scan. Once the abandoned run has settled, a subsequent `start()` deliberately resets `stopped` and can begin a new lifecycle ([skill-synthesis.service.ts:373](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:373)).

## New finding

2. **SERIOUS — a start that joins an abandoned in-flight run clears the shutdown guard and can start the trigger after stop (P3).** `start()` resets `stopped = false` *before* checking `startRun` ([skill-synthesis.service.ts:373](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:373), [skill-synthesis.service.ts:392](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:392)). Therefore: (1) start A awaits migration; (2) `stop()` advances lifecycle and sets `stopped`; (3) start B arrives before A settles, immediately clears `stopped`, and joins A; (4) A observes its stale lifecycle and returns without setting `started`; (5) its Thoth `.then()` or CLI post-`await` continuation sees `isStopped() === false` and starts the trigger ([skill-synthesis.service.ts:398](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:398), [skill-synthesis.service.ts:432](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:432), [boot-thoth-runtime.ts:463](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:463), [cli-engine thoth-runtime.ts:322](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:322)). This violates the required no-trigger-after-stop invariant and leaves service state unstarted. Reset `stopped` only when beginning a new, non-joined run (after the `startRun` branch), or make the run return an explicit started/abandoned result; add an integration test for stop → joining start → completion.

## Verification

- `Tests:       12 passed, 12 total` — `npx nx test skill-synthesis --testPathPatterns=pause-resume`.
- `Tests:       103 passed, 103 total` — `npx nx test thoth-runtime`.
- `Tests:       222 passed, 222 total` — `npx nx test cli-engine`.

## Verdict

**REVISE.** The approved guard fixes the direct abandoned-start case but not the stop-then-joining-start interleaving.
