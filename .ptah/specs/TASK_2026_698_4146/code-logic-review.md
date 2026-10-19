# Code Logic Review — `TASK_2026_698_4146`

Review family: reviewer Claude (in-process subagent), implementer codex

## Phase 1 — backend

Scope: `git diff 241d4ff3c..5df5238b3 -- libs/` (Batches 1a, 1b, 1c). Source files were read in full around every
changed hunk. No tests were run; no diagnostics run (the verification evidence is the batch reports and the specs
in the diff, which I read for coverage only).

### Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 5              |
| Failure modes found | 7              |

### Five logic questions

1. Silent failure. A turn with no main request clears a still-valid estimate (S2/M1). The parser accepts an
   `expiresAt` that contradicts `ttl` (S3 below, `session-stats-live.ts:70-71`). `setCacheEstimate` and
   `setIdleCompactAt` return `false` for an unknown run or owner and the caller ignores it
   (`idle-compaction.service.ts:303,310`), so a rekeyed session can silently stop projecting.
2. Unexpected user action. Return to a session after a long idle and send a message: the displayed expiry can be
   already in the past while the cache was just rewritten (S1). A slash command or any turn that makes no main
   request wipes the countdown (M1).
3. Wrong answer rather than error. Anchor is the previous turn end for the first request of turn 2+ (S1). Mixed
   5m/1h write split is reported as `5m` (conservative, acceptable and consistent with `classifyCacheTtl`).
4. Dependency failure. Owner mutation, watcher, and callback throws are all caught with a degradation-audit
   comment and a once-per-kind warn; stream is never interrupted. `emit()` failure restores `cacheDirty` so the
   next exit retries. OK.
5. Missing from requirements. No expiry-time clearing: the estimate stays on the owner after `expiresAt` passes
   (frontend must decide). No invalidation when idle compaction fires: the old prefix cache is gone but the old
   estimate stays until the next turn ends (M3). `idleCompactAt` in a released owner's final snapshot (M2).

### Failure modes

#### FM1 Stale first-request anchor after idle

- Trigger: turn N ends (`endTurn` sets `turnStartAt = lastNonRequestFrameAt = now`), user sends the next message
  minutes or hours later. Nothing updates the tracker on user input: `idle.input` only goes to the reducer, never
  to `MainRequestTracker`. The first `message_start` computes
  `anchorAt = max(turnStartAt, lastNonRequestFrameAt - 5000)` = the previous turn end, unless a keyless main frame
  arrived first.
- Symptom: `cacheAnchorAt` = old turn end; `expiresAt = oldEnd + 5m` is already past although the request just
  wrote or refreshed the cache. UI shows an expired cache for a hot one.
- Evidence: `idle-request-tracker.ts:61-66, 79-83, 115-123`; spec at `idle-request-tracker.spec.ts:50` only pins the
  first turn (construction time).
- Current handling: none. The same anchor is correct-enough for idle compaction (fires early), wrong for display.
- Recommendation: add a tracker input hook (or take the first frame's `at` minus skew) for the cache anchor, e.g.
  `cacheAnchorAt = max(anchorAt, at - IDLE_ANCHOR_SKEW_MS)` when the request is the first of the turn, or call
  `requestTracker.noteInput(Date.now())` from the same place `idle.input` is signalled.

#### FM2 Turn without a main request clears the estimate

- Trigger: native route, `turn-ended` with `lastRequest === null` (local slash command, aborted turn before any
  request key).
- Symptom: countdown disappears although the cache is unchanged.
- Evidence: `idle-compaction.service.ts:304-306` calls `setCacheEstimate(..., null, retained)`.
- Recommendation: leave the existing estimate alone when `request` is null (do not call, or pass through the old
  estimate); clear only when a request is seen with `ttl === null`.

#### FM3 Parser does not validate expiresAt against ttl

- Trigger: any payload with `expiresAt >= lastRequestAt` and a valid ttl.
- Symptom: wrong expiry rendered; `expected` is computed and never compared.
- Evidence: `libs/shared/src/lib/types/messages/session-stats-live.ts:70-71`.
- Recommendation: `if (expiresAt !== expected) return null;` (or tolerate a small delta if clock rounding is
  intended). Add a spec for a mismatching pair.

#### FM4 Stale idleCompactAt in the settled snapshot of a released owner

- Trigger: Stop or `/clear` releases the owner (`release()` publishes `settled`) while an idle attempt is pending;
  the tap release that clears `idleCompactAt` runs later, and `state.runs`/owner are gone by then
  (`setIdleCompactAt` returns false).
- Symptom: final snapshot sent to the UI still says idle compaction is scheduled for a session that will never fire.
- Evidence: `session-stats-owner.service.ts:719-744` (no clear of `idleCompactAt`), `:909-916`.
- Recommendation: clear `idleCompactAt` in `release()` before `publish`.

#### FM5 Estimate survives idle compaction firing

- Trigger: attempt becomes in-flight and the compaction rewrites the prefix; the cache is invalidated.
- Evidence: `projectCache` only sets `idleCompactAt` to null (line 310-314); estimate untouched.
- Symptom: countdown keeps running for a dead cache until the next turn ends.
- Recommendation: on a successful compact boundary or post-compact, clear the estimate (keep `cacheTtl`).

#### FM6 lastEmitted set after the callback

- Trigger: `onLiveStats` synchronously causes an owner mutation (cache signal -> nested `flush`).
- Symptom: nested newer snapshot emitted first, then outer sets `lastEmitted` back to the older revision; the
  newer snapshot can be re-emitted later (harmless duplicate; frontend floor accepts equal revision).
- Evidence: `live-session-stats-publisher.ts:324-328` and `flush` at `:423-462`.
- Recommendation: set `lastEmitted = max(...)` or set before the call and roll back on throw. Minor.

#### FM7 Projection is a no-op after owner rekey

- Trigger: idle `rekey` changes `state.sessionId` to `toId` while the owner is still keyed by the old id (or the
  reverse); `setCacheEstimate/ setIdleCompactAt` return `false`, ignored.
- Evidence: `idle-session.reducer.ts:405-407`, `idle-compaction.service.ts:282-314` (uses `step.state.sessionId`).
- Recommendation: log once (debug) when the setter returns false, or verify in a spec that owner rebind and idle
  rekey agree on the id. I could not prove a failing path, so this is Moderate/uncertain.

### Blocking issues

None.

### Serious issues

#### S1 First-request anchor can be the previous turn end (FM1)

- File: `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.ts:61-66, 79-83`
- Scenario: user returns after the TTL and sends a message; the SDK emits no keyless main frame before
  `message_start`.
- Impact: the headline feature (expiry) shows "expired" for a freshly written cache on every second-and-later turn
  after an idle gap. This is the exact case users care about.
- Fix: see FM1.

#### S2 Parser trusts expiresAt (FM3)

- File: `libs/shared/src/lib/types/messages/session-stats-live.ts:70-71`
- Scenario/Impact: dead `expected` variable; boundary validation is incomplete although the code and comment claim
  it validates the projection. Combined with S1-style backend bugs nothing catches the inconsistency.
- Fix: compare `expiresAt` to `expected`.

### Moderate and minor issues

- M1 (FM2) `idle-compaction.service.ts:304-306`: null request clears a valid estimate.
- M2 (FM4) `session-stats-owner.service.ts:719-744`: release leaves `idleCompactAt` in the settled snapshot.
- M3 (FM5) `idle-compaction.service.ts:310-314`: estimate not invalidated by compaction.
- M4 (FM7) `idle-compaction.service.ts:303,310`: setter return values ignored; add a debug log or counter.
- M5 `session-stats-live.ts:142-146`: the `as Record<string, unknown> & SessionStatsEntry` assertion also covers
  the unchanged `sessionStats` branch; the deep shape is still only checked by the consumer. Acceptable but note
  that `idleCompactAt` is not required to be `<= expiresAt` or `>= lastRequestAt`.
- Minor `live-session-stats-publisher.ts:324-328` (FM6). Minor: `session-query-executor.service.ts` introduces
  `RouteAwareIdleSignals` as an intersection type instead of extending `IdleCompactionSignals`; no behaviour impact
  (style reviewer's call).

### Checks that passed (evidence)

- Native-route gate: `session-query-executor.service.ts:699` `rec.capacityRoute?.kind === 'native'`; the registry
  default route is `{ kind: 'proxy', providerId: null }` (`session-registry.service.ts:259`), so a missing route
  fails closed to no cache. `resolveCapacityRoute` returns `native` only for `isDirectAnthropic` (`:98-100`). One
  tap is built per query in the executor, so new, resumed and reused-stream paths all go through the same
  line; `sdk-agent-adapter.ts` only forwards the new callback.
- Synthetic frames: tracker returns before touching `cacheRequestKey/cacheAnchorAt/cacheUsage` for any model that
  starts with `<` (`idle-request-tracker.ts:72-78`); publisher drops `<...>` models (`live-session-stats-publisher.ts:331`).
  Subagent frames are filtered in the tap (`session-query-executor.service.ts:250-253`) and in the tracker (`:48`).
- TTL: write>0 uses the write TTL (`5m` wins a mixed split), read-only refresh inherits the retained TTL, write
  without a split resets retention to null (conservative). Retention lives on `OwnerState`, so it survives turns,
  runs and rekey, and a new owner (`startNew`) starts null. Non-native `session-bound` clears both.
- idleCompactAt: set only from `attempt.kind === 'pending'`; every reducer path that drops the attempt
  (request-started/input, release, settings, prefix change, fire, cancel) produces a step that re-projects `null`.
  `session-released` keeps `runToken` so the projection and `finalize` both clear it. The Subject is synchronous,
  so the clear precedes publisher dispose. Per-run fence: `runs.has(runToken)` plus the executor's `runOwners`
  guard stop an older tap from releasing a newer run's idle state.
- Live publication: cache change while idle -> watcher -> `requestFlush` -> `publishLive(null)` returns the
  authoritative snapshot at the bumped revision and emits; while `settling`, `cacheDirty` is held and `settle()`
  emits it only if its revision is newer than both `lastEmitted` and `resultPublishedRevision` (`:503-515`).
  `noteResultPublished` is skipped when `onResultStats` throws, when the result is a duplicate, and when
  validation drops it, so those exits are settled by `settle()` and no update is lost. `beforeLiveStatsDispose`
  runs inside `runGuardedCallback` before `livePublisher.dispose()` (`stream-transformer.ts:1096-1103`); tap
  `release` and `dispose` are both idempotent. Frontend floor (`session-stats-snapshot.ts:85-88`) installs an
  equal or higher revision, and every cache mutation calls `touch`, which advances revision.
- Errors and logging: every new catch carries a `degradation-audit` comment, logs through the existing
  safe/warn-once helpers with the error name only, and no path logs paths, secrets or content.

### Data flow

1. Tap `bind` -> `idle.sessionBound(..., nativeAnthropic)` -> reducer -> `projectCache` (clears on non-native). OK.
2. Frames -> `MainRequestTracker.observe` (cache request key/anchor/usage, synthetic excluded). Gap: anchor for
   the first request of turn 2+ (FM1).
3. `result` -> `turnEnded(snapshot)` -> `projectCache` computes ttl/estimate -> `owner.setCacheEstimate`. Gap: null
   request clears (FM2).
4. Owner `touch` + `onCacheChanged` -> publisher flush/defer. OK.
5. Result branch `noteResultPublished` / `settle`. OK.
6. Tap release -> group finalize -> `setIdleCompactAt(null)` before `dispose`. OK (owner-release ordering, FM4).
7. Wire parse `parseSessionStatsCache`. Gap: no ttl/expiresAt consistency check (FM3).

### Requirements fulfilment

| Requirement                                   | Status   | Gap                                           |
| --------------------------------------------- | -------- | --------------------------------------------- |
| Expiry = last main request anchor + TTL       | PARTIAL  | Anchor stale for turn 2+ first request (S1)   |
| Cache-read refresh inherits retained TTL      | COMPLETE | Null after resume until first write (by design) |
| Native Anthropic routes only                  | COMPLETE | Fails closed when route missing               |
| Subagent and synthetic frames excluded        | COMPLETE |                                               |
| idleCompactAt only while attempt pending      | COMPLETE | Stale in released owner's final snapshot (M2) |
| Cache-only change reaches live stats          | COMPLETE |                                               |
| Parser drops only invalid cache               | PARTIAL  | No ttl/expiresAt consistency (S2)             |

Implicit requirements not addressed: invalidating the estimate on compaction; clearing at expiry (UI concern).

### Edge cases

| Case                                  | Handled | How                              | Concern                    |
| ------------------------------------- | ------- | -------------------------------- | -------------------------- |
| Mixed 5m+1h write split               | YES     | Reports 5m                       | Conservative, documented?  |
| Read-only turn, no retained TTL       | YES     | No estimate                      | Resume shows nothing       |
| Result callback throws                | YES     | Not noted, settle emits          |                            |
| Duplicate / no-result exit            | YES     | settle emits when cache newer    |                            |
| Emit callback throws                  | YES     | cacheDirty restored              |                            |
| Non-native route                      | YES     | Clears estimate and TTL          |                            |
| Long idle then new message            | NO      | Anchor = previous turn end       | S1                         |
| Turn with no main request             | NO      | Estimate wiped                   | M1                         |
| Owner released with pending attempt   | NO      | Stale idleCompactAt in final     | M2                         |

### Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (static review; whether the SDK emits a keyless main frame before the first `message_start` of
  a later turn was not verified at runtime, which decides how often S1 hits)
- Top risk: wrong expiry after an idle gap because the tracker anchors the first request of a later turn at the
  previous turn end.
- What a robust implementation would add: input-aware anchor for the first request of each turn; a
  `expiresAt === lastRequestAt + ttl` check in the parser; keep the estimate when a turn made no main request;
  clear `idleCompactAt` in owner `release()`; invalidate the estimate on compaction; a spec for each.

## Phase 2 — frontend

Review family: reviewer Claude (in-process subagent), implementer codex.
Scope: commit 20199ac83 (read whole: `cache-countdown-clock.service.ts`, `inspector-cache-tile.component.ts`, the inspector / session-stats-view / session-stats-source hunks) plus `parseSessionStatsCache` and the chat-state snapshot parse (`session-stats-snapshot.ts:140-145`). No tests run; code read only. Uncommitted backend/shared edits ignored.

Verdict: APPROVED with moderate/minor follow-ups. Score 8/10. Blocking 0, Serious 0, Moderate 3, Minor 4.

### Verified correct

- Reactivity: `expiryText`/`idleText`/`accessibleText` are `computed()` reading `clock.now()` (a signal) and the `cache` input signal; the template reads them, so each tick marks the OnPush (or zoneless) view dirty and re-renders. No manual markForCheck needed.
- Boundary math (`inspector-cache-tile.component.ts:26-38`): `remaining > 0` gives `max(1, ceil(rem/60000))`, so 1 ms to 60 s reads "1 min", exactly 0 reads "Cache expired" (matches plan). Idle line hidden at `now >= fireAt + 60 s`; between `fireAt` and `fireAt + 60 s` it shows "0 min" (clamped, never negative). Matches the plan's lateness cap.
- Clock ref-count (`cache-countdown-clock.service.ts:23-36`): listener added on 0->1, removed on 1->0; release idempotent; `start()` guards `interval === null` so no double interval; hidden-at-acquire adds the listener but no timer; becoming visible re-samples then restarts. `acquire()` runs in the constructor inside the injection context (`inject(DestroyRef)`); unmount releases. No interval leak found.
- Session switch: the tile holds no per-session state. Its only input is `s.cache` from `inputs()`, which reads the host's own tab snapshot (`session-stats-source.ts:120-127,190`), so session B can never show session A's cache. `@if (s.cache; as cache)` removes the tile when the snapshot has no valid cache.
- Hidden paths: non-Claude / no-cache snapshot -> `parseSessionStatsCache(undefined)` -> `null` -> no tile. Invalid object -> `null` -> hidden. The chat-state parse drops only the cache field, not the snapshot (`session-stats-snapshot.ts:140-145`). Resume/history snapshots go through the same selector: a history snapshot without cache stays hidden.
- Mount scope: the inspector exists only under `@if (hostsInspector() && shell.isOpen() ...)` (`chat-view.component.html:285`), and the canvas details aside is `@if`-guarded, so "only while visible" holds by unmounting plus the visibilitychange pause.
- Angular rules: standalone, OnPush, `inject()`, `input.required()`, no NgModule, no `[innerHTML]`. chat-ui imports only `@ptah-extension/shared`; chat imports `parseSessionStatsCache` from shared (no chat -> chat-ui reverse import). All files far under the 700-line `max-lines` warning (inspector component 218 lines).

### Findings

**Moderate**

1. Clock keeps ticking after nothing can change - `cache-countdown-clock.service.ts:42-44`. Once `expiresAt` has passed and no `idleCompactAt` is pending (the steady state for any idle session, including final-snapshot "Cache expired" tiles), the 1 s interval still runs while the inspector is open. Each tick re-runs three computeds and, in the zone fallback (`apps/ptah-extension-webview/src/app/app.config.ts:144-146`), triggers an app-wide CD pass per second. Visible text only changes on minute boundaries. Fix: schedule the next tick at the next minute boundary (or 1 s only in the last minute, otherwise 5-10 s), and stop when expired with no idle pending. Not a correctness bug; a cost-while-open item against "one shared timer".
2. aria-label on a non-interactive generic `div` - `inspector-cache-tile.component.ts:15`. `aria-label` on an element with no role is ignored or prohibited by most screen readers, so the long accessible text (idle line, eviction caveat) is effectively unreachable; `title` is mouse-only. The visible "(estimated)" suffix covers the main caveat. Fix: add `role="group"` (not a live region) or replace with visually-hidden text. `accessibleText` also yields a double space when `idleText()` is null (harmless).
3. Signal write in a component constructor - `cache-countdown-clock.service.ts:25` (`acquire()` does `tick.set(Date.now())`, called from the constructor at `inspector-cache-tile.component.ts:46`). With two tiles mounted (e.g. split view), a second tile's construction during the parent's render writes a signal that the first tile's computeds depend on, dirtying that view mid-CD. Angular runs directive construction with a null consumer so NG0600 should not fire, and zoneless just schedules another pass, but I did not prove it with a two-tile render. Fix: only re-sample on 0->1 (or when stale) and add a two-tile test.

**Minor**

4. `inspector-cache-tile.component.ts:23` shows the raw TTL literal ("5m"/"1h"); consider "5 min"/"1 hour".
5. `session-stats-source.ts:190` calls `parseSessionStatsCache(snapshot()?.cache)` inside `inputs`, allocating a new object on every evaluation, so the `cache` input identity changes whenever any stat changes and the tile's computeds re-run. Cheap; a dedicated `computed` on the cache would stabilise it. The cache is also validated twice (chat-state ingress and here) - harmless.
6. `SessionStatsInputs.cache` is optional (`session-stats-view.ts:11`), so any host building inputs by hand compiles without it and silently never shows the tile. `injectSessionStatsSource` is the only builder today; no gap now.
7. `Date.now()` is compared with a backend-produced `expiresAt`; any host with clock skew (remote/CLI) is off by the skew. The "(estimated)" wording covers it. No action.

### Five questions (frontend)

1. Silent failure: invalid or absent cache hides the tile with no signal - intended. Hidden-document pause leaves a stale value until re-sampled on visibility return. No success-looking failure found.
2. User action: tab/session switching, closing and reopening the inspector, backgrounding and sleep/wake all resolve correctly (immediate re-sample, "Cache expired" if due).
3. Wrong-answer input: `parseSessionStatsCache` computes `expected = lastRequestAt + ttl` but never compares it with `expiresAt` (`libs/shared/src/lib/types/messages/session-stats-live.ts:72-74`), so a valid-shaped but inconsistent `expiresAt` renders a wrong countdown. The plan only demands `expiresAt >= lastRequestAt` and finite addition, so this is a Phase 1 looseness, not a frontend defect.
4. Dependency failure: if snapshots stop arriving, the tile counts down from the last `expiresAt` to "Cache expired" - acceptable for an estimate.
5. Missing: a test with two tiles mounted at once, and a component-level assertion that rendered text changes after a clock tick under OnPush (service spec covers ticking only).

### Requirements

| Requirement | Status | Gap |
| --- | --- | --- |
| "Cache expires in N min (estimated)" | COMPLETE | none |
| "Idle compaction in N min" while armed | COMPLETE | none |
| "Cache expired" | COMPLETE | none |
| Hide tile without cache data | COMPLETE | none |
| One shared timer, only while panel visible | COMPLETE | M1: ticks every second even when nothing can change |
| OnPush + signals | COMPLETE | none |
| Accessibility text | PARTIAL | M2 |

## Phase 1 — re-review

Scope: `git show 1eb95b874` only (non-spec source read in full). No tests run. Review family: reviewer Claude
(in-process subagent), implementer codex.

### Per-item status

| Item | Status | Evidence |
| ---- | ------ | -------- |
| S1 first-request anchor | FIXED for the normal case | `idle-request-tracker.ts:60,82-84`: `firstOfTurn = requestKey === null`, anchor `max(anchorAt, at - 5000)` |
| S2 parser expiresAt | FIXED | `session-stats-live.ts:71` strict `expiresAt !== expected`; `idleCompactAt < lastRequestAt` also rejected (`:72`). Backend uses the same constants, Date.now integers, so no false rejection |
| M1 null request wipes estimate | FIXED | the `else` branch is removed (`idle-compaction.service.ts` turn-ended block); estimate and retained TTL are untouched |
| M2 idleCompactAt in released snapshot | PARTIAL (snapshot yes, UI no) | `session-stats-owner.service.ts:775-778` clears it and `cleared ||= estimate !== null` is correct (no revision bump when it is invisible). But the publisher never emits it, see N2 |
| M3 compaction invalidates estimate | FIXED, one ordering caveat | `idle-compaction.service.ts` `compact-boundary`/`post-compact` branch clears the estimate and keeps the TTL; clearing on non-idle compactions is correct because any compaction rewrites the prefix |
| M4 setter return ignored | NOT effectively fixed | see N1 |
| FM6 | Not fixed by decision (Minor) | accepted |

### New defects introduced

#### N1 (Moderate) Miss logging is one-shot per service and treats legitimate no-ops as misses

- `setCacheEstimate` returns `false` for an unknown run AND for an unchanged estimate (dedupe);
  `setIdleCompactAt` returns `visible`, i.e. `false` whenever no estimate exists or the value is unchanged.
  `idle-compaction.service.ts` (`cacheProjectionMissLogged`, `idleProjectionMissLogged`) logs on the first
  `false` for the whole service instance, not per session.
- `projectCache` runs on every step, so the first benign no-op (for example `setIdleCompactAt(null)` on a
  session without an estimate) consumes the one-shot. A real miss from a rekey or unknown run is then never
  logged. The debug line also reads as a defect when nothing is wrong.
- Fix: have the setters return a tri-state (applied / unchanged / unknown-run), or check ownership with a
  separate `hasRun` query, and log only the unknown-run case, keyed per session.

#### N2 (Moderate) Owner release does not reach the UI, so M2 is not fixed end to end

- `onOwnerReleased` (`live-session-stats-publisher.ts`, unchanged) calls `emitAuthoritative(settled)`, which emits
  only when `estimateShown` or `cacheDirty && revision > lastEmitted`. `SessionStatsOwnerService.release()` does
  not call `onCacheChanged`, so `cacheDirty` is false and the cleaned snapshot is dropped. The UI keeps the last
  emitted snapshot, which still contains `idleCompactAt`.
- Scenario: Stop or `/clear` while an idle attempt is pending and no provisional estimate is showing. This is the
  case M2 described.
- Fix: in `onOwnerReleased`, treat a settled revision above `lastEmitted.revision` and above
  `resultPublishedRevision` as emit-worthy when the settled snapshot carries `cache`, or set `cacheDirty` there.

#### N3 (Minor) S1 residuals

- A synthetic frame arriving first sets `requestKey` (the synthetic early-return is after `requestKey` is
  assigned, `idle-request-tracker.ts:61-80`), so the real first request is no longer `firstOfTurn` and gets the
  old previous-turn anchor. Fix: derive `firstOfTurn` from `cacheRequestKey === null` instead.
- Without partial-message streaming the first frame is the complete `assistant` frame, so `at - 5s` can sit
  well after the real request start, overestimating the expiry by the response duration. Prefer the earliest frame
  of the request, or document the limit.

#### N4 (Minor) M3 ordering

- `post-compact` comes from `events.onCompactionComplete`, a separate source from the stream. If it were
  delivered after the compaction turn's own `turn-ended`, it would clear a fresh valid estimate. I could not
  prove the order; a spec that delivers `turn-ended` then `post-compact` would settle it.

### Verdict

- Recommendation: REVISE (small). Score 7/10. Blocking 0, Serious 0, Moderate 2 (N1, N2), Minor 2.
- Confidence: MEDIUM-HIGH (static review).
- Top risk: N2, a stale idle-compaction time stays on screen after Stop or `/clear`.
- Required before approval: N2 fix with a publisher spec; N1 (or drop the log). N3 and N4 may be follow-ups.

## Phase 1 — final review

Scope: `git show d9cfec11a` only (non-spec source read in full, against `session-stats-owner.service.ts:770-785`
from the previous commit). No tests run. Review family: reviewer Claude (in-process subagent), implementer codex.

### Per-item status

| Item | Status | Evidence |
| ---- | ------ | -------- |
| N1 one-shot miss log conflating no-ops | FIXED by removal | both flags and the `setEstimate` wrapper are gone from `idle-compaction.service.ts`. Side effect: a genuine unknown-run miss is now unlogged again (Minor, accepted; the original M4 observability is dropped, not delivered) |
| N2 release does not reach the UI | FIXED | `live-session-stats-publisher.ts` `onOwnerReleased` -> `emitAuthoritative(settled, true)`; `cacheIsNewer` also holds when `released && (snapshot.cache !== undefined \|\| lastEmitted.cache === true)`, still gated on revision above `lastEmitted` and `resultPublishedRevision`; `lastEmitted.cache` recorded in `emit()` |
| N3a synthetic-first frame | FIXED | `idle-request-tracker.ts:60` `firstOfTurn = cacheRequestKey === null`. The synthetic early-return precedes the `cacheRequestKey` assignment, so the first real request keeps `max(anchorAt, at - skew)` |
| N3b, N4 | Follow-ups by decision (row 15) | not reviewed |

### Checks requested

- Revision bump on release when only `idleCompactAt` was cleared: `release()` sets `idleCompactAt = null` and
  `cleared ||= cacheEstimate !== null`, then `touch` only if `cleared`. With an estimate present the revision
  advances, so the settled revision exceeds the last emitted one (which carried `idleCompactAt`) and the snapshot
  is emitted without `idleCompactAt`. With no estimate the field was never visible, so no bump and no emit is the
  correct result (`lastEmitted.cache` is false there too).
- Double emit with the estimate path: `emitAuthoritative` has a single `if (shown || cacheIsNewer)` branch and one
  `emit`, and `estimateShown` is reset first, so a release with both a shown provisional estimate and a newer cache
  revision sends one payload. The `released` flag set before the call blocks any later settle or dispose emit.
- Cache removed rather than changed (compaction cleared the estimate, then release): `lastEmitted.cache === true`
  with a cache-less newer snapshot emits, so the UI countdown is cleared. Correct.
- Reentrancy and failure: `emit` failure on release is only warned; the publisher is already released, which is
  the same behaviour as before the change.

### New defects

None blocking or serious. Minor: `emitAuthoritative`'s `released` boolean parameter makes the release path implicit;
the cache-aware gate only runs for `released`, so `settle()`/`dispose()` still rely on `cacheDirty`, which is
consistent with the earlier analysis.

### Verdict

- Recommendation: APPROVED (scope: Phase 1 backend, with N3b and N4 as recorded follow-ups)
- Score 8/10. Blocking 0, Serious 0, Moderate 0, Minor 2 (dropped miss logging, implicit `released` parameter).
- Confidence: MEDIUM-HIGH (static review; no runtime check of SDK frame order).
- Top residual risk: `post-compact` ordering against the compaction turn's `turn-ended` (N4) and the
  non-streamed first-frame overestimate (N3b), both tracked.
