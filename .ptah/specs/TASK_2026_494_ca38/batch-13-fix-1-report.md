# Batch 13 fix round 1 — TASK_2026_494

Executor: frontend-developer. I did not run git. Every edited file is under
`libs/frontend/mcp-apps-page/src/lib/services/`. I did not touch `state/`, `apps-surface-sync.ts`,
`apps-workspace-slice.ts`, `components/`, `src/index.ts` or `libs/frontend/declarative-dashboard`.

## Fixes

### Fix 1 (SERIOUS): a queued mutation is never sent on a base below the expected revision

`apps-surface-lanes.ts`:

- `:402-409` `armWait` arms ONE tick every `APPS_ECHO_GRACE_MS`. It records when the wait began (`waitStartedAt`, `:140`, `:404`).
- `:418-445` `onWaitTick` handles each tick:
  - If the lane is no longer behind (or has nothing queued), it pumps. The mutation sends only when materialized >= expected; `pump` checks this at `:376-379` before it takes the base at `:387`.
  - `:439`: while behind, every tick after the first grace period calls `this.host.requestRead()`. This is the same compensation as `apps-submit-flow.ts` `onWaitTick`, because `AppsSurfaceSync` does not re-arm after a failed grace read. The first period is skipped on purpose. The expectation that started the wait already triggered a read at that moment: either the sync's Rule 3 grace read or the `stale-revision` read. Asking again on that same tick would always coalesce into a duplicate read.
  - `:434-437`: past `APPS_ECHO_WAIT_LIMIT_MS` the lane does NOT send. It calls `dropQueue`.
- `:451-477` `dropQueue`:
  - It retires every queued change overlay and sets the per-input notice `APPS_CHANGE_TEXT.notSynced`: "Your value was not saved: the page could not confirm the latest state of this app." (`:62`)
  - For a queued select, it marks the Req 6.6 unsynced notice "Selection not shared with the agent: the page could not confirm the latest state of this app." (`:74`)
  - The log line gives only a count, with no payload values.
  - The lane's expected revision stays, so a later edit waits again and is never sent stale.
- `:55` `APPS_ECHO_WAIT_LIMIT_MS` is now `APPS_ECHO_GRACE_MS + 2 * APPS_SURFACE_READ_TIMEOUT_MS` (21.5 s), up from 11.5 s.
  - **Deviation.** With the old value, a grace read that hangs for its full 10 s timeout ends exactly at the limit, so the lane's own follow-up read never had a chance. The new value lets the grace read and one follow-up read each run their full timeout.
  - Specs refer to the symbol, not the number.
- `:19-45` The class doc no longer says "sends on the held base".

### Fix 2 (SERIOUS): serialization between submit and lanes is symmetric

- `apps-surface-lanes.ts:113` adds `AppsLaneHost.isSubmitting(surfaceId)`. At `:361-367`, `pump` holds the lane (and clears any wait tick) while a submit of that surface is sending or polling.
- `apps-submit-flow.ts:302-308` `isSubmitting(surfaceId)` is true when the active submit is on that surface and its phase is `sending` or `polling`. It is false for `waiting`, because a waiting submit waits for the lanes. Holding the lanes then would deadlock.
- `apps-submit-flow.ts:96` adds `AppsSubmitHost.submitEnded()`. `finish()` (`:628-636`) calls it after the final state, and the facade passes it to `lanes.pumpAll()`. Any lane held behind the submit then sends on the materialized base. If the submit acknowledged a revision, the lane first waits for that revision.
- `apps-surface-operations.service.ts:379-380` wires `isSubmitting`; `:413` wires `submitEnded`.

### Fix 3 (MODERATE): a dedicated lanes spec

`apps-surface-lanes.spec.ts` is NEW, 439 lines. It drives `AppsSurfaceLanes` against the REAL `AppsSurfaceSync` and reducer, with:

- a scripted RPC that uses the real timeout and abort timing;
- a recording host;
- a store that re-pumps the lanes on every surface write, as the facade effect does.

Its `afterEach` (`:252`) checks every `surface:change` and `surface:select` in every spec: the sent revision must be >= the highest acknowledged revision at send time.

### Fix 4 (MODERATE): release the records of conversations that are not active

- `apps-session.service.ts:149-166` adds ONE readonly computed, `ownedRoutingIds: Signal<ReadonlySet<string>>`. It holds the routing ids of every slice's conversation, active or not.
  - Its `equal` compares members, so streaming or focus patches do not re-fire dependents.
  - Nothing else in that file changed.
- `apps-surface-operations.service.ts`:
  - `:123-129`: the effect now tracks `ownedRoutingIds()` instead of `workspaceKey()`.
  - `:258-275` `reconcile`: every held routing id (records, `_ui`, `_submitted`) that no slice owns is released at `:269`. That covers discard, failed start, and workspace removal, whether or not the workspace was active.
  - The old `routingByKey` discard detection is gone; the owned set replaces it.
  - `release()` (`:245-256`) now also drops the routing id's submitted bubbles. `withoutKey` helper: `:91-98`.
- The dependency direction is unchanged: the operations service injects the session, and the session imports nothing from operations.

## New specs

`apps-surface-lanes.spec.ts`:

- `echo wait (Rule 3; own writes never conflict)`:
  - "the grace read fails, a later tick reads, and the queued change sends on the NEW base". It asserts that the sent revision equals the caught-up `materializedRevision` (2).
  - "reads keep failing until the limit: nothing more is sent, the overlays retire, the notices show". It asserts:
    - zero further `surface:change` and zero `surface:select`;
    - the overlay was retired;
    - the change notice and the Req 6.6 select notice are shown;
    - no payload value appears in `console.warn`;
    - no timers remain;
    - a later edit waits and sends on base 2.
  - "an echo during the wait sends at once and releases the wait tick"
- `workspace switch (not shown)`: "pauses a queued change with no timer, and resumes it on the materialized base when shown"
- `surface gone`: "deletes the lane: the queue is dropped unsent and nothing waits"
- `submit in flight (symmetric serialization)`:
  - "holds a change while the surface submits, then sends it on the materialized base"
  - "holds a select too, then sends it on the materialized base"
- `dispose`: "clears the wait tick and aborts the mutation in flight"

`apps-submit-flow.spec.ts`:

- `serialization with the lanes (symmetric)` (`:563`):
  - "a change committed while surface:action is pending waits until the action settles, then sends on the materialized base". The change is held through `pending` and polling, then waits for the acknowledged revision 2, then is sent with base = materialized = 2.
  - "with no revision to wait for, the held change sends as soon as the action settles"
- `release of a conversation that is not shown` (`:611`): "a removed non-active workspace releases its lanes, poll timer and record, with no timers left"

`apps-session.service.spec.ts:655`: "ownedRoutingIds lists every slice conversation, shown or not, and drops a removed or discarded one". It includes a check that the set instance is kept when no conversation changed.

## Added assertions only

No existing assertion was changed, weakened or removed, and no existing fixture value changed. Existing spec files received only additions:

- `apps-surface-operations.service.spec.ts` and `apps-submit-flow.spec.ts`:
  - an `ackedAtSend` field on the scripted call;
  - a pass-through spy on `AppsSessionService.expectSurfaceRevision` that records the highest acknowledged revision;
  - the same base-never-below-acknowledged-revision check in `afterEach` (`:266` and `:275`).
- `apps-submit-flow.spec.ts` also lifts the two `TabManagerService` signals into variables (`activePath`, `removed`). They have the same initial values (`'/ws-a'`, `null`), so the new removal spec can drive them.

All 199 B13 tests passed unchanged, both after the source fixes and before any spec edit.

## Line counts

| File | Lines |
| --- | --- |
| `apps-surface-lanes.ts` | 663 |
| `apps-surface-lanes.spec.ts` (new) | 439 |
| `apps-surface-operations.service.ts` | 448 |
| `apps-surface-operations.service.spec.ts` | 700 |
| `apps-submit-flow.ts` | 658 |
| `apps-submit-flow.spec.ts` | 638 |
| `apps-session.service.ts` | 635 |
| `apps-session.service.spec.ts` | 790 |

`apps-session.service.spec.ts` was already 768 lines when it was committed (B14), before this round. This round added the one required 22-line spec, and it had to go in that file. Lint `max-lines` excludes `*.spec.ts` (`eslint.config.mjs:507-518`). Every file this batch owns is at most 700 lines.

## Test counts

- Before: 10 suites, 199 tests.
- After: 11 suites, 211 tests. The 12 new tests are 8 in the lanes spec, 3 in the submit-flow spec and 1 in the session spec. All pass.
- Lint reports no errors or warnings in the project.

## Verification

Run from the worktree root:
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache --parallel=2 --output-style=static` (exit 0)

- Test Suites: 11 passed, 11 total
- Tests: 211 passed, 211 total

Last 10 lines:

```


 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


  Run duration:      13.2s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     11.5s (1 task)
  Recoverable time:  1.6s (12% of the run)
```
