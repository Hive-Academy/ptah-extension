# Code Logic Review — `TASK_2026_707` cold-start fix

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | The incomplete marker, bounded follow-up, and Usage timeout match the cold-start failure |
| Verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Score 8 is the sound band. It is not 9–10: the store spec proves one recovery, not the third-retry stop or a destroy that races an in-flight pull. It is not 6–7: the marker is tied to the detection promise, a finished detection stays unmarked, follow-ups stop at three, and the Usage client timeout sits 10s above the host scan budget.

## What was checked

### Marker

`discoverTargets` sets `discoveryIncomplete` only when the detection `fromSource` result is `undefined` (`plan-limit-owner-discovery.service.ts:283-285`). `fromSource` returns `undefined` on deadline miss, on `remainingMs <= 0`, or on throw (`:605-634`). A resolved detection, including an empty installed list, is an array, so the flag is false.

The hung-detector spec expects `true` after 12s with the selected provider and Ptah CLI owners kept (`plan-limit-owner-discovery.service.spec.ts:345-355`). The slow successful detection spec expects `false` (`:314-333`). `assemble` copies the flag with `=== true` (`plan-limits-snapshot.service.ts:150-157`), so a mock or caller that omits it does not look incomplete. The snapshot spec asserts the payload flag (`plan-limits-snapshot.service.spec.ts:101-108`).

A later pull joins the same `detectAll` promise while it is running, and a finished run is cached (`cli-detection.service.ts:87-104`). The follow-up does not start a second detection.

### Follow-up loop

On an incomplete snapshot the store applies it, then schedules one pull one second later, at most three times (`plan-limits.store.ts:186-196`). `incompleteRetryCount` increments before the wait and is reset on any load that is not itself a follow-up (`:177`). The fourth incomplete response does not schedule. There is no loop while detection keeps failing.

`load` clears a pending follow-up timer before starting (`:175-176`). The next pull is armed only after the RPC returns, so the retries do not overlap. A newer `load` bumps `loadGeneration`; a stale response returns before `apply` and before another schedule (`:185`). Destroy clears the timer (`:123-126`). The store is `providedIn: 'root'` (`:73`), so that destroy is app teardown. An RPC that resolves after teardown could arm one more timer; that window is process exit, not a dashboard session.

Each follow-up is one `provider:getPlanLimits` after the previous one has finished, plus one second. Worst case is the original call plus three more, sequential, not a parallel burst. Detection work is deduplicated as above. The spec shows the first incomplete roster, then Codex present after 1s, with two RPC calls (`plan-limits.store.spec.ts:130-140`).

### Contract

`discoveryIncomplete` is optional on `PlanLimitsSnapshot` (`plan-limit.types.ts:236-241`). `provider:getPlanLimits` result is that type (`rpc-providers.types.ts:226`). `ProviderGetPlanLimitsSchema` validates params only (`provider-rpc.schema.ts:133`); the result is not parsed by a strict Zod object that would reject the new field. The webview guard allows the field to be missing or a boolean and rejects other types (`plan-limits.store.ts:359-360`). An older client that ignores unknown JSON fields still accepts the snapshot. VS Code uses this store. A CLI consumer of the typed snapshot can ignore the optional field.

### Usage timeout

`analytics:spendSummary` is called with `timeout: 40_000` (`analytics-usage.store.ts:122-127`). The host aborts the scan at `USAGE_SUMMARY_BUDGET_MS` (30_000) (`analytics-rpc.handlers.ts:33`, `:84-86`). The client no longer shares that 30s budget. The other `ClaudeRpcService.call` default is unchanged. The extra 10s is transport and scheduling after the host returns, which is what a scan that finishes on its own deadline needs.

### Timers in specs

Discovery's hung-detector spec expects `jest.getTimerCount()` 0 (`plan-limit-owner-discovery.service.spec.ts:357`). `fromSource` clears its deadline timer in `finally`. The store's clock spec expects no interval before the first load and none after `TestBed.resetTestingModule()` (`plan-limits.store.spec.ts:579-607`). The new retry test ends on a complete snapshot, which does not arm another timeout.

## Defects

None.

## Jest

`npx jest -c libs/frontend/core/jest.config.ts plan-limits.store --coverage=false --maxWorkers=2 --silent` — 1 suite passed, 35 tests passed (51.1s).

Not re-run here: discovery 36 and snapshot 13, recorded PASS in `cold-start-fix.md`. Their new assertions were read in source.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the marker and the three-pull cap. MEDIUM for destroy-during-RPC, which the spec does not fire.
- The cold path that accepted a two-owner roster and stopped now marks that roster and pulls again until detection completes or three follow-ups have run.
