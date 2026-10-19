# Implementation plan: estimated prompt-cache expiry

## Verified contracts and current path

| Contract | Code evidence | Consequence |
| --- | --- | --- |
| `MainRequestTracker` receives only top-level frames, keys requests by API message id, parses usage from assistant frames, and returns an idle `anchorAt` near request start plus `1h`/`not-1h` at turn end. | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:239-256,464-473`; `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.ts:16-20,23-93` | Extend the tracker with last-request cache evidence; reuse `anchorAt` for expiry and preserve existing idle classification. No `endedAt`. |
| The usage reader supplies `cacheReadTokens`, `cacheWriteTokens`, and optional `cacheWriteByTtl` split; cache reads carry no TTL. | `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:205-236`; prior `TASK_2026_692_f748/decisions.md:10` | Inherit TTL on a read only from an earlier confirmed write in the active owner; never infer 1h or 5m from read counts. |
| Idle service state owns the pending attempt's real `fireAt` and changes synchronously through its signal queue; it has request-start, input, pre/post-compact, settings, rekey, and release signals. | `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:32-101,157-199`; `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:150-215,445-503` | Publish `idleCompactAt` from `attempt.kind === 'pending' ? attempt.fireAt : undefined` after each transition, including clear transitions. Do not calculate it from the cache deadline. |
| The owner builds one immutable `SessionStatsEntry` with a process-local monotonic revision; its watch hook drives the existing live publisher. | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:370-406,665-684,789-857` | Store cache projection with the owner, touch revision only on a real cache change, and notify its watcher. Fence writes by current owner/run identity. |
| The Claude SDK path also serves proxy providers; only `resolveCapacityRoute`'s native route is direct Anthropic. The tap's session class currently carries `codexProxy` but no native flag. | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:97-144,675-678`; `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:32-38` | Carry `nativeAnthropic` through the tap's `session-bound` signal; only native runs may project a cache tile. |
| `onTurnEnd` runs before result accounting; the result callback may be skipped, and the live publisher suppresses flushes while settling. Current teardown disposes the publisher before `onStreamEnd`. | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:695-705,964-1005,1086-1103`; `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts:208-227,346-353` | Preserve a cache-dirty revision through settle/dispose, track any result revision actually published, and invoke the tap's synchronous release-clear before publisher disposal. |
| Callback wiring already broadcasts result and live snapshots. | `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:133-179`; `libs/shared/src/lib/types/agent-adapter.types.ts:75-125` | Nested `sessionStats.cache` reaches both existing events without changing callback or RPC signatures. |
| Live parser checks only the envelope; the consumer validates the deep snapshot. The non-live event and resume path install `SessionStatsEntry` through tab state. | `libs/shared/src/lib/types/messages/session-stats-live.ts:20-38,95-125`; `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:119-149,207-239`; `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:1-55` | Sanitize the optional cache independently on the live parser, and again at the view input for non-live/resume snapshots; never reject accounting for a bad cache field. |
| The right inspector receives `SessionStatsInputs`, and its SESSION tile is `InspectorSessionStatsComponent`; it mounts only while the shell is open. The older summary component is not in this path. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:283-316`; `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:28-45`; `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:18-63`; `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts:118-124,182-198` | Add the cache tile to the inspector component and derive its input from the existing snapshot. No duplicate store or legacy-summary tile. |
| The revision floor rejects lower revisions and admits equal ones for the same publication; it resets on attachment. | `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:58-90` | Each cache state change needs a new owner revision; absent cache in fresh history remains hidden. |

## Data flow and ownership

1. The existing `CompactionSessionTap` feeds top-level frames to its `MainRequestTracker`. Add last-real-request cache-read/write evidence and `cacheAnchorAt` to `LastRequestSnapshot`; `cacheAnchorAt` copies that request's **existing** idle `anchorAt`, not a new clock measurement. When a new **real** request id starts, reset that cache candidate's evidence. A synthetic assistant model (`<...>`) must not advance or clear the cache candidate; retain its anchor separately if a later synthetic frame advances the idle slot, while idle tracking remains unchanged. An exclusive positive 1h or 5m write confirms that TTL; a mixed positive split conservatively confirms `5m`; a positive write without a usable split makes TTL unknown. Keep `classifyCacheTtl` and its current last-request idle `ttl` result unchanged. Subagent frames stay excluded by the tap (`session-query-executor.service.ts:239-256`; `idle-request-tracker.ts:45-68`).
2. In `IdleCompactionService`, on `turn-ended` read the owner-held retained TTL and project cache for the **last real main request** only. A confirmed write replaces the retained TTL; a read without a write inherits it; neither read nor write clears the display but may retain the known TTL for a later read; an ambiguous positive write clears both. For usable evidence, `lastRequestAt = cacheAnchorAt`, `expiresAt = cacheAnchorAt + (ttl === '1h' ? 3_600_000 : 300_000)`. Validate finite non-negative time and safe addition before publishing. No second request tracker, new time measurement, or per-session timer is created; a new owner has no retained TTL.
3. `session-query-executor.service.ts:97-144,675-678` supplies `nativeAnthropic: rec.capacityRoute?.kind === 'native'` in the tap's session class; `session-bound` carries it beside `codexProxy`. The idle service writes `cache` only for a native run. A proxy or unknown route clears any prior cache projection and retained TTL for that run even if its usage has Anthropic-shaped cache fields. This gate does **not** change idle-compaction eligibility.
4. After every idle reducer step, compare pending `attempt.fireAt` with owner `idleCompactAt`; update only on change. Disarm, fire, cancel, settings/prefix change, release, and rekey publish removal or move as applicable. On release, clear `idleCompactAt` synchronously before the owner can publish its final snapshot; retain the cache expiry estimate in that final snapshot. A stale run cannot mutate a replacement owner.
5. The owner adds `onCacheChanged()` to `OwnerWatcher` and composes the optional wire field in its immutable snapshot. Every published cache change touches the monotonic revision, invalidates the cached snapshot, and synchronously notifies the watcher. The exact two-writer API and fencing are below. A cache-only change while the owner prefix read is pending is retained in owner state, but `publishLive` returns `null` until the prefix is ready (`session-stats-owner.service.ts:620-636`); the later result snapshot carries it.
6. `LiveSessionStatsPublisher.onCacheChanged` marks `cacheDirty` even while `settling`. Outside settling it requests the existing throttled flush. `settle()` on **every** result exit and `dispose()` check the current owner snapshot after clearing the run estimate and emit a cache-changed authoritative snapshot when its revision exceeds both the last emitted live revision and the result revision actually published; they do this even if no provisional estimate was shown. `StreamTransformer` calls a new publisher `noteResultPublished(sessionStats)` only after `onResultStats` successfully returns, so duplicate/no-usage/no-callback exits cannot consume the dirty revision. Preserve existing provisional/context handling and footer semantics; clear `cacheDirty` only after a successful publication or when no newer cache revision remains.
7. Teardown uses review option (a): add a guarded `beforeLiveStatsDispose` callback to `StreamTransformer` and invoke it immediately before `livePublisher.dispose()` in its `finally`, leaving the existing `dispose()` then `onStreamEnd` order in place (`stream-transformer.ts:1086-1103`). `SessionQueryExecutorService` supplies the idempotent `compactionTap.release()` for that callback and retains its abort listener and `onStreamEnd` fallback (`session-query-executor.service.ts:686-690,915-925`). Carry this callback through `ExecuteQueryResult` and `sdk-agent-adapter.ts`; release synchronously clears the armed owner field while the publisher is attached, and `dispose()` flushes that revision before detaching. Test normal end, stop, abort, and early owner release.
8. The shared live parser validates nested cache and omits only `cache` if malformed. `SessionStatsInputs` carries a sanitized cache from the selected tab/ChatStore snapshot, so result and resume snapshots receive the same guard. `SessionStatsSource` remains a computed selector. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1041-1059` uses a live owner snapshot for resume when present and spreads its `cache` into the response; transcript aggregation alone never creates it.
9. `InspectorSessionStatsComponent` hosts a small `InspectorCacheTileComponent` in its SESSION grid. A root-provided `CacheCountdownClock` injects `DOCUMENT`, exposes a `Date.now()` signal, and runs one 1-second interval while at least one tile is mounted and the document is visible. The tile registers once and releases with `DestroyRef`; mount/visibility return sample immediately. Countdowns derive from absolute timestamps.

## Stats-owner write contract

In the owner file, derive `type CacheTtl = NonNullable<SessionStatsEntry['cache']>['ttl']` and `type CacheEstimate = Pick<NonNullable<SessionStatsEntry['cache']>, 'ttl' | 'lastRequestAt' | 'expiresAt'>` from the shared public `SessionStatsEntry`; no second wire type. Add `OwnerState.cacheTtl: CacheTtl | null`, `cacheEstimate: CacheEstimate | null`, and `idleCompactAt: number | null`, initialized empty in `createState`/`startNew`; preserve these fields across runs and rekey of the **same** owner. The retained TTL is separate from the displayed estimate.

```ts
getCacheTtl(sessionId: string, runToken: string): CacheTtl | null;
setCacheEstimate(
  sessionId: string,
  runToken: string,
  estimate: CacheEstimate | null,
  retainedTtl: CacheTtl | null,
): boolean;
setIdleCompactAt(sessionId: string, runToken: string, at: number | null): boolean;
```

Each method looks up `states.get(sessionId)` and requires `state.runs.has(runToken)`; a missing/replaced owner or stale run returns `null`/`false` without creating a run. A read-only hit passes the inherited `retainedTtl`; a real request with neither read nor write passes `estimate: null` but preserves `retainedTtl`; an ambiguous write passes both `null`. The estimate setter updates `cacheTtl` even when the wire projection is unchanged, but returns `true`, calls `touch(state)`, and invokes `watcher.onCacheChanged()` only when visible cache content changes. `setIdleCompactAt` stores the reducer's pending time, with the same no-op/revision rule for *visible* cache content. `build()` includes `cache` only when `cacheEstimate` exists and adds `idleCompactAt` only while pending; no idle-only tile. Extend every `OwnerWatcher` implementer: publisher (`live-session-stats-publisher.ts:171-175`) and the recording/fake watchers in `session-stats-owner.service.spec.ts:1350-1360,1598-1686`. Do not use `runFor` in these methods: it creates runs and defeats the stale-run fence.

## Exact wire type and parser rules

Add this optional field to `SessionStatsEntry` in `libs/shared/src/lib/types/rpc/rpc-session.types.ts`:

```ts
readonly cache?: {
  readonly ttl: '1h' | '5m';
  readonly lastRequestAt: number; // Unix epoch milliseconds, existing main request-start anchorAt
  readonly expiresAt: number;     // lastRequestAt + confirmed TTL
  readonly idleCompactAt?: number; // existing idle attempt.fireAt, only while pending
};
```

`ResultStatsPayload.sessionStats` and `SessionStatsLivePayload.sessionStats` already use `SessionStatsEntry`, so the wire key is `sessionStats.cache` on both existing messages. It is not attached to arbitrary `session:stats-batch` transcript aggregates. No `null` sentinel is needed: an authoritative newer snapshot without `cache` clears the tile. `parseSessionStatsCache(value: unknown)` returns the typed object only for a plain object, the two allowed TTL literals, and finite non-negative epoch-millisecond numbers; require `expiresAt >= lastRequestAt` and finite TTL addition, and apply the same checks to optional `idleCompactAt`. An invalid member drops the whole **cache field only**, not the stats snapshot or message. Do not coerce strings, `NaN`, infinities, negative numbers, arrays, or partial objects. Keep the existing live parser's envelope and provisional/context rules. The non-live/resume selector calls the same cache parser before passing the field to the inspector.

## Display and failure behavior

- While `expiresAt > now`, use `Math.max(1, Math.ceil((expiresAt - now) / 60_000))` in `Cache expires in N min (estimated)`; at equality or later use `Cache expired`. Show `Idle compaction in N min` only while `idleCompactAt` exists **and** `now < idleCompactAt + IDLE_FIRE_LATENESS_MS` (60 seconds; `idle-compaction.types.ts:9`); use `Math.max(0, Math.ceil((idleCompactAt - now) / 60_000))` for the count. The backend clear still removes the line immediately; the lateness cap prevents a stale `0 min` line from persisting.
- A first turn with no confirmed cache write, a read-only resumed turn with no retained TTL, an ambiguous positive write, and a proxy/unknown route produce no `cache` and no tile. Cache eviction before the deadline remains possible; retain `estimated`. Host and webview use the same machine clock; no clock-skew correction is needed.
- If the optional idle/cache projection or live callback fails, keep the stream and accounting path working, log through `Logger` with no raw usage/error payload or secret. Intentional catches receive `// degradation-audit: <category> - <reason>`. A failed projection hides or preserves the last safe cache estimate, never fabricates a newer deadline.
- The clock stops on inspector close, browser document hidden, and last component destruction. On return it samples wall time immediately; sleep/wake naturally jumps to `Cache expired` if due. Multiple tabs bound to one session use the owner's snapshot revision and the existing tab fan-out; switching session id reads the new session's own snapshot.

## Files and tests

### Batch 1a — contract, request evidence, owner (then 1b and 1c)

| File | Action and test |
| --- | --- |
| `libs/shared/src/lib/types/rpc/rpc-session.types.ts` | MODIFY: add optional `SessionStatsEntry.cache` type. |
| `libs/shared/src/lib/types/messages/session-stats-live.ts` | MODIFY: export cache parser and sanitize nested cache on live payloads, preserving valid snapshots. |
| `libs/shared/src/lib/types/messages/session-stats-live.spec.ts` | MODIFY: valid 1h/5m/idle, malformed timestamp/TTL/shape drops only cache; old payload stays valid. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts` | MODIFY: extend `LastRequestSnapshot` with cache evidence/`cacheAnchorAt` and `session-bound` with `nativeAnthropic`; keep `anchorAt` and idle fields. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.ts` | MODIFY: capture last real main request's read/write evidence and existing anchor, choose 5m for a mixed confirmed split, skip synthetic cache candidate; no `endedAt`. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.spec.ts` | MODIFY: last request versus first write, read hit, mixed 5m, unknown write, synthetic assistant frame, subagent exclusion, no request. |
| `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts` | MODIFY: exact `getCacheTtl`/`setCacheEstimate`/`setIdleCompactAt` API above, run-token fence, owner retention, immutable projection, revision and `onCacheChanged`. |
| `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts` | MODIFY: retained TTL versus visible cache, no-op revision, watcher fakes, stale/replaced run, rekey, release, prefix pending. |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` | MODIFY: `chat:resume` snapshot preserves cache from a live owner; transcript-only aggregate has no cache. |

Scoped verification, one heavy command at a time: PowerShell `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/shared --parallel=1 --coverage=false --maxWorkers=2`, then `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`. This nine-file batch stays within 40 tool calls using targeted reads.

### Batch 1b — idle projection, route gate, lifecycle hook

| File | Action and test |
| --- | --- |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts` | MODIFY: consume owner API; project only native Anthropic; clear on every idle state transition and synchronously on release. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts` | MODIFY: 1h/5m/read-refresh, proxy gate, arm/disarm/fire/input/release, stale-run and multi-session cases; existing idle eligibility unchanged. |
| `libs/backend/agent-sdk/src/lib/di/register.ts` | MODIFY: pass existing stats owner into idle-service factory; preserve optional-service failure isolation. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` | MODIFY: set `nativeAnthropic` from `capacityRoute.kind`, pass it at session bind, and supply idempotent tap release as `beforeLiveStatsDispose` while retaining abort/onStreamEnd paths. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` | MODIFY: native versus proxy session-bound signal; normal-end/abort release callback and idempotency. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` | MODIFY: add `beforeLiveStatsDispose?: () => void` to `ExecuteQueryResult` so the callback has a typed path to the adapter. |

Scoped verification: PowerShell `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`. This six-file batch stays within 40 tool calls; it follows 1a and precedes 1c because the callback type must be transported.

### Batch 1c — live publication and teardown

| File | Action and test |
| --- | --- |
| `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts` | MODIFY: `cacheDirty`, cache watcher, `noteResultPublished`, deferred settle/dispose flush by revision; preserve provisional/context semantics and callback-failure isolation. |
| `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts` | MODIFY: cache-only idle publish, change during settling, result-published dedupe, no-result/duplicate exits, dispose flush, callback failure. |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` | MODIFY: call `noteResultPublished` only after successful result callback; invoke guarded `beforeLiveStatsDispose` immediately before publisher disposal, without reordering existing dispose/onStreamEnd. |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts` | MODIFY: late arm/clear in settling, skipped result callbacks, revision order, final clear before detach, footer unchanged. |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts` | MODIFY: before-dispose callback order, callback throw isolation, normal/end/error/abort path. |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` | MODIFY: extend `StreamTap`/`rememberStreamTap` and carry `beforeLiveStatsDispose` through each new/reused stream path into transformer options. |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` | MODIFY: callback forwarded on new and reused streams; existing onStreamEnd behavior preserved. |

Scoped verification: PowerShell `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`. This seven-file batch is file-disjoint from 1a/1b and stays within 40 tool calls with targeted reads. Run its heavy check alone.

### Batch 2 — right inspector presentation (after backend contract)

| File | Action and test |
| --- | --- |
| `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts` | MODIFY: derive sanitized `cache` from the selected tab/ChatStore snapshot for this inspector; preserve the existing session switch and null-availability rules. |
| `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.spec.ts` | CREATE: live-owner resume cache survives selection, transcript-only/invalid cache hides, tab switch isolation. |
| `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts` | MODIFY: add nullable cache to `SessionStatsInputs`; no accounting recomputation. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/cache-countdown-clock.service.ts` | CREATE: root-provided `DOCUMENT`-injected clock, one 1-second interval, ref-counted visibility listener and release path. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/cache-countdown-clock.service.spec.ts` | CREATE: one timer across two consumers; immediate mount/visible sample; hidden and last-release cleanup. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts` | CREATE: small OnPush presentational tile with expiry and guarded idle countdown, accessible labels, narrow/dark/light layout. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.spec.ts` | CREATE: expiry boundary, 1h/5m labels, idle lateness cutoff and aria text. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts` | MODIFY: mount cache tile in SESSION grid only when sanitized cache exists; pass clock and cache input. |
| `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.spec.ts` | MODIFY: hidden without data, mount/unmount, session switch, responsive structure. |

Scoped verification, one heavy command at a time: PowerShell `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/chat-ui --parallel=1 --coverage=false --maxWorkers=2`, then `$env:NX_NO_CLOUD='true'; npx nx test @ptah-extension/chat --parallel=1 --coverage=false --maxWorkers=2`. This ten-file batch stays within 40 tool calls with targeted reads. The orchestrator handles the separate dark/light before-and-after screenshot review requested in `context.md:40-47`.

No production file or test is changed by this architecture deliverable. The listed paths are the implementation work, not edits made in this lane.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep cache metadata on `SessionStatsEntry`, nested as `sessionStats.cache`. | Top-level fields on each event; separate RPC; nested owner snapshot (chosen). | Both callbacks carry `SessionStatsEntry`; owner revisions and tab routing already exist (`agent-adapter.types.ts:75-104`, `session-stats-owner.service.ts:789-857`). | Yes; a later wire migration would be needed. |
| Use last main request's existing `anchorAt` as `lastRequestAt` and expiry basis. | Observed request end; `message_start` time; existing idle anchor (chosen). | Cache prefill occurs near request start; tracker anchor is near start and idle deadlines already use it (`idle-request-tracker.ts:57-68`, `idle-compaction.types.ts:162-164`). The task brief explicitly marked end time as proposed for validation. | Yes; wire semantics would need a versioned change. |
| Project only native Anthropic routes. | Trust usage shape; permit proxies; `capacityRoute.kind === 'native'` (chosen). | `resolveCapacityRoute` distinguishes direct Anthropic from proxies (`session-query-executor.service.ts:97-144`); usage shapes alone do not prove Anthropic TTL semantics. | Yes. |
| Retain TTL only after a confirmed write in the current owner; mixed split uses the shorter confirmed 5m TTL. | Assume account TTL; infer from read count; hide mixed; shortest confirmed split (chosen). | Usage reader exposes split only on writes (`subagent-budget-monitor.ts:222-235`); prior idle decision #7 forbids read-derived TTL. The 5m tail expires first. | Yes. |
| Restore a live owner estimate on webview reload, but never derive it from transcript history. | Hide on every resume; reconstruct from transcript; reuse live owner snapshot (chosen). | `session-history-reader.service.ts:1041-1059` snapshots the owner first and spreads fields; transcript aggregates do not have cache liveness. | Yes. |
| Keep cache projection in optional `IdleCompactionService` and write through the stats owner. | New tracker/service; put cache logic in transformer; existing idle reducer (chosen). | Idle reducer already owns request and pending-attempt signals; DI factory can fail (`di/register.ts:544-556`). If that optional service fails, the timer tile is unavailable while accounting continues. | Yes. |
| Flush cache-only revisions at settle/dispose and synchronously release the tap before dispose. | Rely on result callback; reorder dispose/onStreamEnd; explicit pre-dispose release hook plus dirty flush (chosen). | Result callbacks can be skipped and settling blocks flush (`stream-transformer.ts:964-1005`; `live-session-stats-publisher.ts:223-227,346-353`); current teardown disposes first (`stream-transformer.ts:1086-1103`). | Yes. |
| Use the inspector's SESSION grid, not the legacy summary component. | Both surfaces; summary only; inspector (chosen). | `chat-view.component.html:283-316` mounts `ptah-session-inspector`, which mounts `ptah-inspector-session-stats` (`session-inspector.component.html:28-45`). | Yes. |
| Share one clock across inspector tiles, keyed by mount count and document visibility. | Per tile timer; existing plan-limit clock; dedicated shared clock (chosen). | Inspector mounts only when open; plan-limit time is unrelated and may run when the inspector is closed (`chat-view.component.html:283-316`, `session-stats-source.ts:96-101`). | Yes. |

## Lane-introduced constraints

- Cache-read refresh requires a previously confirmed TTL in the current owner and positive `cacheReadTokens`; otherwise hide the estimate. This conservative rule is added because the SDK read counter has no TTL split.
- A mixed confirmed split selects 5m, the shorter confirmed TTL; a positive write without a usable split clears the estimate and retained TTL.
- The UI uses whole minutes rounded up for a future cache expiry and allows `0 min` for a due idle attempt only until `IDLE_FIRE_LATENESS_MS` elapses. These display rules make boundaries deterministic.
- Cache metadata lives only in live owner snapshots, not transcript-derived batch aggregates, to avoid presenting an old cache as live after reload.
- Keep new source files below the repository's 700 non-blank/non-comment line warning limit (`eslint.config.mjs:558-561`); measure the already large owner and transformer before adding code. Keep clock and tile separate from the dense inspector component. The frontend uses a local 60,000 ms lateness guard matching backend `IDLE_FIRE_LATENESS_MS`; it does not import backend internals. Respect strict TypeScript, no new `any` or `as unknown as`, `Logger` rather than console in backend, hand parser or Zod at the boundary, `@ptah-extension/*` public-index imports across libraries, and a `// degradation-audit: <category> - <reason>` comment on each new intentional catch in projection, publisher, lifecycle hook, and clock listener.

## Clarifications Needed

None. The task context and current contracts support the decisions above.

## Revision log

- Round 1: changed expiry to the existing request-start anchor; gated cache projection to native Anthropic; specified owner methods and run fencing; closed settle/teardown lost-update paths; split backend work into file-disjoint 1a/1b/1c batches; corrected reload/history behavior and added the frontend lateness guard.
