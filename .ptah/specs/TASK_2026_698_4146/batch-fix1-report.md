# Backend fix round 1

## Fixes

| Item | Fix and source | Regression spec |
| --- | --- | --- |
| S1 / FM1 | `idle-request-tracker.ts:60,82`: the first request of a turn uses the later of the idle anchor and frame time minus the existing skew for `cacheAnchorAt`; idle `anchorAt` and `ttl` are unchanged. | `idle-request-tracker.spec.ts:71` — `anchors the first cache request of turn two near its frame after a long gap` |
| S2 / FM3 | `session-stats-live.ts:71-72`: reject expiry unequal to `lastRequestAt + ttl`, and reject an idle deadline before the last request. | `session-stats-live.spec.ts:85` — `drops only malformed cache %p`, including mismatched TTL/expiry and early idle deadline |
| M1 / FM2 | `idle-compaction.service.ts:297-317`: a native turn with no main request leaves its cache estimate and retained TTL alone. | `idle-compaction.service.spec.ts:199` — `keeps the cache estimate when a turn ends without a main request` |
| M2 / FM4 | `session-stats-owner.service.ts:774-779`: clear the idle deadline and advance the visible revision before publishing the released snapshot. | `session-stats-owner.service.spec.ts:1439` — `removes the pending idle deadline before publishing the released snapshot` |
| M3 / FM5 | `idle-compaction.service.ts:319-321`: clear the estimate at a compact boundary or post-compact signal while retaining the confirmed TTL. | `idle-compaction.service.spec.ts:215` — `clears the cache estimate at a compact boundary and retains the confirmed TTL` |
| M4 / FM7 | `idle-compaction.service.ts:73-74,287-295,323-344`: log each setter's first false result once at debug level, without payloads. | `idle-compaction.service.spec.ts:239` — `logs failed cache and idle projections once at debug level without payloads` |

## Verification

- Changed shared Jest spec: **pass**, 1 suite / 64 tests.
- Changed agent SDK Jest specs: **pass**, 3 suites / 134 tests.
- Related live publisher and stream transformer Jest specs: **pass**, 2 suites / 59 tests.
- `nx typecheck @ptah-extension/shared --parallel=1`: **pass**.
- `nx typecheck @ptah-extension/agent-sdk --parallel=1`: **pass**.
- `nx lint @ptah-extension/agent-sdk --parallel=1`: **pass**.
- `nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`: **failed** after 3m22s. The requested short terminal output contained only Nx's failed-target summary, so the failing Jest case is unknown. The full target was not rerun solely to recover its output.
- Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript timeout; both required Nx typechecks passed.

## Decisions

- Used the first request frame minus the existing skew for the cache anchor, rather than adding an input hook. This keeps the established idle eligibility anchor unchanged and touches no additional producer file. Reversible.
- Logged false setter results once per service instance for each setter. The owner also returns false for a no-op, so these messages indicate an unapplied projection without claiming a rekey failure. Reversible.
- Cleared the estimate on both compact boundary and post-compact events because either may establish that the old prefix is invalid. Kept the confirmed TTL for a later cache read. Reversible.

## Not done

- FM6 was explicitly excluded.
- The full agent SDK test target's failing case remains unidentified because its output was truncated by the prescribed tail and no saved task output was available.
