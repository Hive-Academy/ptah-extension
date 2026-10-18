# Estimated prompt-cache expiry in the session inspector

## Goal

For a Claude Agent SDK session with observed prompt-cache usage and a known cache TTL, show an estimated countdown in the right-hand session inspector. Show the actual scheduled idle-compaction time when that session's existing idle-compaction service is armed. The host's clock supplies absolute timestamps; the webview updates their display locally.

## In scope

- Reuse `MainRequestTracker` and `IdleCompactionService`; retain idle compaction's current 1-hour-only eligibility and timing behavior.
- Carry optional cache metadata in the existing session-stats snapshot, which is already delivered by `session:stats` and `session:stats-live` and held per session across tabs.
- Show a cache tile in the inspector's SESSION section only for native Anthropic routes through the Claude Agent SDK when the last main-thread cache observation supports a known 1-hour or 5-minute TTL. Label the countdown as estimated.
- Keep the idle-compaction line current when the existing service arms, disarms, fires, or releases a session.
- Validate cache metadata independently at the webview boundary; bad cache data must not discard valid accounting statistics.
- Add scoped backend, shared-contract, and frontend tests, followed by the requested dark/light visual review.

## Out of scope

- A new RPC method, polling the host, a second request tracker, server cache introspection, or a promise that Anthropic will retain a cache until the estimate.
- Showing a timer for Codex, Cursor, other non-Claude providers, or Claude sessions whose TTL cannot be established from current-process evidence.
- Reconstructing cache TTL from historical transcript usage after backend owner loss. A webview reload can recover the estimate from a still-live backend owner on `chat:resume`.
- Changing idle-compaction enablement, token thresholds, fire fraction, or its confirmed-1-hour-write rule.
- A tile in the legacy inline `SessionStatsSummaryComponent`; the right sidebar currently renders `InspectorSessionStatsComponent`.

## Acceptance criteria

1. A native Anthropic main-thread request with a confirmed exclusive 1-hour cache write yields expiry at its existing observed request-start `anchorAt` plus 3,600,000 ms; an exclusive 5-minute write yields `anchorAt` plus 300,000 ms. A mixed confirmed split uses the shorter 5-minute TTL. A positive write without a usable split does not invent a TTL. The estimate uses the same anchor as idle compaction; no request-end timestamp is added.
2. After a known write, a later main-thread request with a cache read and no new write refreshes expiry from **that request's start anchor** using the last confirmed TTL. A subagent or synthetic assistant frame cannot refresh or clear the main estimate. A last main request with neither a read nor a confirmed write clears the displayed cache estimate.
3. Existing idle compaction still arms only from the last request's confirmed 1-hour write and its existing eligibility checks. While its attempt is pending, the inspector shows its actual `fireAt` as `Idle compaction in N min`. Disarm, fire, cancellation, stream end, stop, abort, and release clear the line on the last published snapshot, including input before the next result. As a frontend guard, hide the line once `now >= idleCompactAt + IDLE_FIRE_LATENESS_MS` (60 seconds).
4. The optional `cache` metadata is carried by the existing session snapshot in both `session:stats` and `session:stats-live`. Its public type is `ttl: '1h' | '5m'`, `lastRequestAt: number`, `expiresAt: number`, and optional `idleCompactAt: number`. The timestamps are epoch milliseconds. No new host RPC or polling is added.
5. The webview accepts only finite, non-negative timestamp values and a recognized TTL. An invalid `cache` field is dropped independently; the valid session-stats snapshot still installs. A missing cache field hides the tile. Old producers and historical snapshots continue to work.
6. For a valid future expiry the visible text is `Cache expires in N min (estimated)`, with a positive whole-minute countdown. At or after `expiresAt` it is `Cache expired`. The idle line shows only while the backend reports an armed time. The tile has accessible text and fits the inspector in dark/light themes and narrow widths.
7. One shared webview clock drives every mounted inspector cache tile with a 1-second tick. It runs only while at least one inspector tile is mounted and the document is visible, updates immediately on mount/visibility return, and releases its timer and visibility listener after the last tile unmounts. It does not create one timer per tab/session.
8. A cache update is published when a cache-hit request completes, and when idle compaction arms, disarms, fires, or releases, including changes during result settling and stream teardown. It advances the session snapshot revision so old in-flight messages cannot restore stale dates. All tabs bound to the same session show the same state; switching to another session does not inherit it.
9. Before a confirmed write, after an unknown-TTL observation, and when no live backend owner holds a cache estimate (backend restart or transcript-only browse), the tile is hidden. A webview reload/resume while that owner is live restores its cache estimate; a transcript aggregate never supplies one. Valid late or duplicate accounting events retain the existing revision-floor behavior and do not change per-turn footer completion semantics.
10. A Claude SDK session on a proxy route (`capacityRoute.kind !== 'native'`, including OpenRouter and Codex proxy) shows no cache tile even if its usage resembles Anthropic cache usage.

## Risks and verification focus

- The start anchor is an estimate of cache prefill time, so the displayed TTL can be conservative by a few seconds; a long response must not shift expiry to its end. Test that cache and idle deadlines use the same anchor.
- Live stats are throttled and can settle or release while an idle signal changes. Test the settling window, asynchronous context read, final release before publisher disposal, and callback failure so a stale `idleCompactAt` cannot remain on the last published snapshot.
- The SDK's cache-read usage does not identify a TTL. Retain only a TTL confirmed by a write in the same active owner lifetime; hide an unsupported or ambiguous estimate.
- Absolute host/webview timestamps share the same machine clock, but cache eviction may occur early. The UI must retain the `estimated` label and use the deadline itself after sleeping or a visibility change.
