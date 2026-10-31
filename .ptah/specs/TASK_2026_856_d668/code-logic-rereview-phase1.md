# Code Logic Re-review, Phase 1 fix round: TASK_2026_856_d668

Scope: `git diff 67202eeed..HEAD` (41b28eabf, 6f523472a). Read-only. I read the diff, the surrounding code and the new specs. I ran no checks, because the gates already passed.

## Findings addressed

| Finding | Status | Evidence |
| --- | --- | --- |
| Logic M1: explicit session id check before carry | FIXED | `session-loader.service.ts:1255-1256` takes `prior` only when `tab?.claudeSessionId === sessionId`. Both the compaction-seed branch and the `sameModel` carry read `prior`, so both are guarded. The new spec covers a different-session tab. |
| Logic M3: every non-duplicate result counts a turn | FIXED | `session-stats-owner.service.ts:602-632`. `ignored-error`, `rejected-invalid` and `rejected-non-monotonic` now do `run.turns++` and `touch`. `duplicate` and `stale-owner` count nothing. `durationMs` is still added only on `accepted`, which is correct. |
| Logic M4: `lockSeen` on regeneration entries | FIXED, with a residual (N2 below) | `enhanced-prompts-rpc.handlers.ts:542-546`, `:603-621`. Once the lock has been seen and then drops, the entry is deleted. An entry whose lock was never seen is kept. |
| Logic m2: identity wrapper | FIXED | `session-live-stats.util.ts:78` uses `numerator` directly. The `contextFillTokens` import is removed. |
| Style S1: one shared token-count guard | PARTIAL | `isValidTokenCount` is exported (`token-usage.utils.ts:4`, `utils/index.ts:93`). `cli-usage.utils.ts`, `context-fill.utils.ts` and `sessionTokenTotal` use it. The inline guard remains at `session-live-stats.util.ts:72-76`. See N3. |
| Style S2: comment the 0-means-unknown contract | FIXED | `live-context-stats.ts:33`. |

## Checks you asked for

1. **No prompt is counted twice.**
   - `stream-transformer.ts:~1000-1040` has an if/else. A result with per-model usage goes to `recordResult`. Otherwise, when `!hasNoSdkTokenUsage`, it goes to `markRunIncomplete`. The two paths are mutually exclusive for one result, so one prompt increments `turns` once.
   - A `recordResult` ignored-error result increments once and does not enter `markRunIncomplete`.
   - A `duplicate` result does not increment. A repeated SDK result is therefore not double-counted.
2. **`touch()` on non-accepted outcomes is safe.**
   - `touch` (`:864`) just invalidates the cached snapshot and advances the revision. The revision bump is needed, because `turns` now changes.
   - `publish` runs after the switch, in the caller path.
   - The `rejected-non-monotonic` branch sets `firstRejection` exactly once, as before.
3. **A never-seen lock stays until the ceiling.** This is correct for a run that fails before taking the lock.
   - The entry is removed by the handler's own `finally` (`:580-583`, token-guarded), as soon as `regenerate()` settles.
   - A failure before the lock, such as an invalidate throw, a `runWizard` early return or a missing config, settles the await and deletes the entry. The ceiling only covers a hung run.
   - The lock is taken once per regenerate (`enhanced-prompts.service.ts:827` invalidate, then `runWizard`), so there is no second gap after the lock is first seen.
4. **`session-loader`.**
   - The compaction reload (`:1083`) targets the same tab and session, so `claudeSessionId === sessionId` holds and the seed is still preserved.
   - A tab that has no `claudeSessionId` yet has nothing worth carrying.
   - The new spec checks the cue label is "—" for the non-carry case.
   - I did not touch the NUL byte.

## New defects

No Blocking or Serious issues.

- **N1 (Minor, behaviour change): `contextFillTokens` and `sessionTokenTotal` tighten their guards.**
  - `context-fill.utils.ts:11` now treats a negative count as 0, where it used to pass it through.
  - `token-usage.utils.ts:31` now returns null for a negative `tokenCount`.
  - Both are safer and match the stated intent, and the specs were updated. Noted only because it is a shared-lib change on every host.
- **N2 (Minor): `liveEntry` mutates state inside a read, and a foreign lock can set `lockSeen`.**
  - `liveEntry` (`enhanced-prompts-rpc.handlers.ts:612-614`) sets `entry.lockSeen` from the service-wide `generationInProgress`, which I flagged as shared in the original M4 text.
  - If another operation (a `runWizard` or a bound run) holds the lock when `getStatus` polls a pending regenerate, `lockSeen` becomes true. If that foreign lock is released before this run takes the lock, the entry is deleted early.
  - `getStatus` then reports "not regenerating", and a second `regenerate` is allowed. That second call is then rejected by the service lock, so there is no corruption.
  - This is an unlikely sequence and much smaller than M4, so I accept it.
- **N3 (Minor, maintainability): the S1 sweep is incomplete.** `session-live-stats.util.ts:72-76` still hand-writes `typeof n === 'number' && Number.isFinite(n) && n >= 0`. It should use `isValidTokenCount(numerator)`.
- **N4 (Minor, format): `session-loader.service.ts:1256` is about 86 columns.** Prettier would wrap it. `session-loader.service.spec.ts` and `utils/index.ts:93` have similar long lines. lint-staged presumably formatted them, so this is only worth a glance.

## Verdict

APPROVED. 0 blocking, 0 serious, 0 moderate, 4 minor (N1-N4). M1, M3, M4 and m2 are FIXED. S2 is FIXED. S1 is PARTIAL (N3).
