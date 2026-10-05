# Fix round — FM-3 (rekey merge drops an in-flight stop)

Source finding: `reviews/de-code-logic-review-a.md` FM-3.

## Changed files

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts`

## The change

- `SessionState` gains `mergedInto?: SessionState`. When `rekey` merges into an existing `toSessionId` record, the
  dropped `existing` record is pointed at the surviving one (`existing.mergedInto = session`).
- On a duplicate `toolCallId`, `rekey` now keeps the `existing` subagent state when it has a stop running or done
  (`hasStopStarted`) and the `from` state does not. Otherwise the `from` state still wins, as before.
- `isCurrent()` is replaced by `liveSession()`. It follows `mergedInto` to the surviving record and returns it only
  while that record is still the map entry for its id. It returns `undefined` after a real `release()`, so a release
  still suppresses the bookkeeping.
- When `stop()` settles, it resolves `live` and the subagent state kept there (`liveState`). If `liveState.stopFired` is
  already set, it returns, so bookkeeping runs once. Otherwise it marks `liveState` (`stopFired`/`stopped`, or failure
  counting through `onStopFailed`), sets the registry record to completed, and pushes one handoff through
  `pushParentMessage` to `live.sessionId` with `live.taskTexts`.
- DI shape is unchanged: the constructor still takes the lazy dispatcher port, and nothing new is injected.

## Regression specs (added)

- `a stop in flight on the merged-into session finishes once after a rekey`: a stop is pending on `session-2`, and
  `session-1` holds the same subagent. After `rekey(session-1, session-2)` the stop resolves. The spec expects one
  handoff to `session-2`, one registry `completed` update and `stopped: true`. A further 300k message does not stop
  again.
- `a stop in flight across a rekey merge sends no handoff once released`: the same setup, then `release('session-2')`
  before the stop resolves. The spec expects no handoff, no registry update and no snapshot.

## Checks

| Command | Exit | Result |
| --- | --- | --- |
| `npx jest -c libs/backend/agent-sdk/jest.config.ts .../subagent-budget-monitor.spec.ts` | 0 | 27/27 passed |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` | 0 | Successfully ran typecheck, lint, test |
| `npx nx run di-lint:lint` | 0 | pass |
| `npx nx run degradation-audit:lint` | 0 | pass |

The `session-handoff-writer.spec.ts` flake did not occur in this run.
