# UI phase code logic review, round 2

## Verdict

**REVISE — 7/10.** The out-of-order rejected-read race from round 1 is fixed, but the generation guard can now suppress failed-push recovery after an unsuccessful newer action, leaving the old run visible as active.

## Finding status

**Round 1 new finding 1 — RESOLVED for the reported race.** `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:306-310` captures the generation before the failed-push read and checks it before applying the fallback. A newer start increments the generation at `:476-479`, and a successful status read increments it at `:389-398`; therefore an older rejected read cannot clear the newer run or replace its action message. `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts:566-615` covers that ordering with a deferred rejection.

## New findings

1. **Serious — `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:306-310,476-485`.** A failed push begins a status read; while it is pending, the user can click Start on the old background run because background-only runs are not busy (`:181-186`). `runStartLike` increments `statusGeneration` before sending the RPC. If that RPC fails or returns no data, it exits without refreshing status (`:481-485`). When the failed-push read then fails, the generation mismatch suppresses the fallback. The old `running` snapshot stays visible as indexing, although the backend reported failure; only the Start failure sentence is shown. Invalidate the fallback only when a newer status snapshot has arrived or an action has actually established a replacement run; otherwise allow the failed-push recovery. Add a deferred-read case where Start fails before the older read rejects.

## Decisions

- The exact round 1 defect is resolved because a newer successful run is protected. The unsuccessful-action path is a new stale-state defect, so the final verdict remains **REVISE**.
- The new spec covers only an accepted Start and successful newer status load (`libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts:566-615`). It does not exercise a rejected Start before the old read rejects.
- Review was read-only apart from this deliverable. No Nx, npm, tests, or git commands were run; coordinator verification was not independently reproduced. No matching review skill loader was exposed in this lane.
