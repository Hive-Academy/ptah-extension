# TASK_2026_391 Batch 5 — frontend remediation notes

## Root cause

The original resume path preserved intended lifetime totals through
`applyLoadedSessionStats`, then independently summed those cumulative totals
and published them as `liveModelStats`. That produced the measured 89.6% gauge
from 896,300 lifetime tokens despite a post-compaction context near 11,016.

The first Batch 5 fix still coupled CTX provenance to entries in the cumulative
`modelUsageList` and passed `hasCompacted: true` as a sentinel. Review also
identified a second resume consumer:
`refreshResumableSubagentsForSession` restored renderer state through
`chat:resume` but did not apply the returned stats, so a persisted stale CTX
could survive an ordinary app/webview restoration.

## Remediated implementation

`SessionLoaderService.applyResumeStats` now owns all frontend resume-stat
application:

- `applyLoadedSessionStats` receives aggregate stats unchanged, preserving
  lifetime TOKENS and cost.
- `modelUsageList` remains cumulative and gains only locally derived context
  windows for display.
- CTX comes exclusively from the dedicated
  `stats.contextSnapshot { model, contextTokens }` payload. The snapshot model
  therefore wins over aggregate `stats.model` and `modelUsageList` selection.
- When the snapshot is absent, `setLiveModelStats(tabId, null)` honestly clears
  the stale gauge.

Both `switchSession` and the renderer-restoration
`refreshResumableSubagentsForSession` consumer call the helper. The loader no
longer imports `deriveLiveModelStats`, consumes per-model
`lastTurnContextTokens`, or uses the false `hasCompacted` sentinel. The old
resume-local `cumulativeExceedsWindow` guard remains removed because cumulative
totals no longer participate in resume CTX calculation.

`[compaction-diag]` logging is unchanged.

The restored path now converts the legacy string-typed `activeTabId` signal at
its boundary with `TabId.from(...)`; the refresh method and stats helper carry
only branded `TabId` values. After the asynchronous RPC returns successfully,
the loader revalidates that the tab still exists and still owns the captured
session before any tab-scoped write. A successful response with null/absent
stats clears preloaded, live, and model-usage state; an unsuccessful RPC
returns before clearing, preserving the prior display.

## Regression proof

Before the production remediation:

```text
npx nx test @ptah-extension/chat --runInBand --testPathPatterns=session-loader.service.spec.ts --testNamePattern="replaces a restored loaded tab stale stats|uses the dedicated context snapshot model"
```

The run failed red with two failures:

```text
restoreCliSessionsForSession › replaces a restored loaded tab stale stats from the resume snapshot
Expected applyLoadedSessionStats(...)
Number of calls: 0

tab-targeted compaction reload › uses the dedicated context snapshot model instead of aggregate resume stats for the gauge
Expected: { model: "claude-opus-5", contextUsed: 11016, contextWindow: 1000000, contextPercent: 1.1 }
Received: null

Test Suites: 1 failed, 1 total
Tests:       2 failed, 36 skipped, 38 total
```

Two additional regressions pin successful-null clearing and a deferred response
whose tab is rebound to another session. After remediation, the complete
focused service spec passed green:

```text
npx nx test @ptah-extension/chat --runInBand --testPathPatterns=session-loader.service.spec.ts
NX   Successfully ran target test for project @ptah-extension/chat
Test Suites: 1 passed, 1 total
Tests:       2 skipped, 38 passed, 40 total
```

No existing test was weakened. The prior Batch 5 regression was updated from
the superseded per-model `lastTurnContextTokens` contract to the reviewed
dedicated `contextSnapshot` contract.

## Focused verification

```text
npx nx run @ptah-extension/chat:typecheck
NX   Successfully ran target typecheck for project @ptah-extension/chat

npx nx run @ptah-extension/chat:lint
NX   Successfully ran target lint for project @ptah-extension/chat
17 problems (0 errors, 17 warnings)
```

The warnings are pre-existing. The touched service's only warning remains the
existing empty `createNewSession` method.
