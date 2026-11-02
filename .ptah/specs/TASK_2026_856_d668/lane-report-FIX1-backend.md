# FIX1 backend lane report

## Changes

- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:352,602`: documented prompt counting and handled every `RunResultOutcome` explicitly. Accepted, ignored-error, rejected-invalid, and rejected-non-monotonic increment turns and refresh the snapshot. Duplicate and stale-owner do not. Duration and turn cost still apply only to accepted results.
- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts:279,303,536,642,650`: added prefix-4 tests for accepted → ignored-error → accepted = 7, duplicate = 0 extra turns, and rejected outcomes. Updated assertions that previously expected the same snapshot object after a counted rejected result.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:88,542,603`: added `lockSeen` to in-flight regeneration entries. `liveEntry` keeps the start gap visible, observes the lock, and clears entries only after an observed release or the run ceiling. Kept the token-guarded `finally` delete.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts:1192,1224,1267,1311`: getStatus expects the ISO start during the force gap; a second regenerate in the gap is rejected without losing the first status; force-release tests observe the lock before releasing it.

## Verification

- Agent SDK requested check: `NX   1 task: 0 succeeded, 1 failed`; Jest reported `Tests: 2 failed, 103 passed, 105 total`. Both failures were old snapshot identity assertions for now-counted rejected results. Those assertions were corrected after this single requested run.
- RPC handlers requested check: `NX   1 task: 1 succeeded` (exit code 0).
- `git diff --check` for the four scoped files: passed.
- Scoped Ptah diagnostics: unavailable after two 45-second attempts; TypeScript check remained in progress.

## Not done

- The agent SDK test was not rerun after the assertion corrections because the task specified each requested check once. Its final passing status is unverified.
- Skill invocation was unavailable in this lane: the tool list contained skill search/create tools but no skill invocation tool.
