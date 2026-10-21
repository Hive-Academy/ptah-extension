# Code Logic Review — `TASK_2026_707` dashboard v2, final correction

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | Both remaining defects are fixed and proved |
| Verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Score 8 is the sound band. It is not 9–10: the two sides of the budget are proved by separate specs, not one process that runs real `discoverTargets` inside `assemble`, and a detection that lands on the exact 12s timeout still drops the CLI-store source (the same degradation as a hung detector). It is not 6–7: the reserve matches the requested 12s read window, the cold OpenCode owner is both kept and read, overflow evidence reaches `title` and `aria-label`, and the new specs assert no leftover timers.

Scope read: `plan-limits-snapshot.service.ts` assemble/read path, the new snapshot spec, `discoverTargets` deadline use and `cliStores`, the new discovery spec, `detailLines`, the evidence collapse in `plan-tile-view.model.ts`, and the tile spec. No source edits.

## Defects

| # | Status | Evidence |
| --- | --- | --- |
| 1 | fixed | Discovery is given `deadlineAt - RESERVED_READ_MS` with `RESERVED_READ_MS = SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12s) while reads still use the 24s `deadlineAt` (`plan-limits-snapshot.service.ts:85-86`, `:149-152`). After a 12s discovery the OpenCode read-kind owner is passed to `getOwnerSnapshot` and keeps `unsupported-config`, and the call is still under 24s with no timers (`plan-limits-snapshot.service.spec.ts:161-185`). Detection at 11_999ms with Codex installed and a hung `resolveCodexHomeOwner` still returns the OpenCode CLI-store owner (`plan-limit-owner-discovery.service.spec.ts:379-397`). `cliStores` resolves owners synchronously (`plan-limit-owner-discovery.service.ts:374-393`), so the sliver of deadline after a near-12s detection is enough. Reads then have about 12s: `readOwner` takes `min(limitLookupDeadlineMs, deadlineAt - now)` (`plan-limits-snapshot.service.ts:187-188`). Wall clock stays about 24s against the 30s client timeout. |
| 2 | fixed | The overflow chip's `title` is the hidden sentences (`plan-tile-view.model.ts:1021-1028`). `detailLines` uses that `title` for `__more-evidence` and `text` otherwise (`provider-account-tile.component.ts:102-111`). Those lines feed `aria-label` and the section `title` (`:114-123`). Three evidence rows assert `Limit hit (first|second|third)` on both, and the visible line stays the first (`provider-account-tile.component.spec.ts:62-78`). |

## Budget and regressions

- Selected-provider, session, and Ptah CLI sources still start with detection, not after it (`plan-limit-owner-discovery.service.ts:219-248`). A 12s discovery window does not serialize them behind the Codex lane.
- The Codex lane still starts only after detection. If detection uses the whole 12s discovery deadline, `fromSource` sees `remainingMs <= 0` and drops that lane (`plan-limit-owner-discovery.service.ts:605-609`). That is the reserve working: the lane cannot spend the read window. The next refresh can still retain a late Codex home owner through the existing `retainNextCodexHomeOwner` path. Owners that were discovered are not removed in `assemble`.
- A read that times out or throws still becomes `service-unavailable` with ledger windows, not a dropped owner and not a fake 0 (`plan-limits-snapshot.service.ts:212-224`, `:231-238`).
- The read timer is cleared in `finally` (`:225-227`). Both new specs expect `jest.getTimerCount()` to be 0.
- `ownerSnapshotForProvider` still reads with `withDeadline` false (`:137-139`), so the single-account lookup is unchanged.
- Evidence past the second item is no longer replaced by the `+N more` label in the accessible name. The first two notices stay their own lines. No new empty `title` path: `evidenceNotice` always sets `title` (`plan-tile-view.model.ts:871-881`).

## New defects

None.

## Jest

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts plan-limits-snapshot --coverage=false --maxWorkers=2 --silent` — 1 suite passed, 12 tests passed (14.5s). This includes the reserve spec.
- Discovery spec (36 tests) and the tile spec (6 tests) were not re-run here. The correction report records both PASS. The assertions above were read in source.

`ptah_get_diagnostics` was not run. No browser check. This correction does not change a rendered route beyond the accessible name already covered by the tile spec.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the reserve math and the evidence lines. MEDIUM only for the unrun discovery and tile suites; their assertions match the code that was read.
- Top risk closed: a slow successful detection plus a hung Codex home resolution no longer consumes the owner-read budget, and overflow evidence stays in the tile's accessible name.
