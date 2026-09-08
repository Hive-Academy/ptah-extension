# TASK_2026_391 Batch 5 — context-usage gauge

## Verdict

**PASS.** `CTX` no longer divides resumed aggregate tokens by the model window.
`chat:resume` now carries a dedicated latest-main-turn context snapshot, and
both full session switching and renderer-restored tabs apply that snapshot.
The lifetime `TOKENS` data path is unchanged.

Independent final reviews approved the result:

- logic: 8/10, no blocking, serious, or moderate findings;
- style: 8/10, no blocking or serious findings.

No commit was created.

## Root cause, verified before editing

Before this batch, `SessionLoaderService` first applied the resume aggregate as
the intended persisted/lifetime display stats, then independently summed
`stats.tokens.input + stats.tokens.cacheRead + stats.tokens.output` and
published that total as `liveModelStats.contextUsed`. In the measured case that
made `896,300 / 1,000,000 = 89.6%` look like context fill.

The old code was in
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
(pre-change lines 643-668). Its `cumulativeExceedsWindow` branch suppressed the
write only after the same wrong cumulative input exceeded the window; it did
not turn the input into a context measurement.

The intended live behavior was already documented and implemented in
`session-stats-aggregator.service.ts:20-29` and
`session-live-stats.util.ts:75-106`: prefer the latest turn's context frame and
do not confidently publish a cumulative fallback after compaction or after it
has exceeded the window.

## What the backend actually provided

Before the fix, `SessionHistoryReaderService.aggregateUsageStats()` returned
aggregate `tokens`, aggregate cost, an aggregate-selected `model`, and a
per-model cumulative breakdown. `ChatResumeResult.stats` exposed no globally
latest main-turn context figure (`rpc-chat.types.ts`, pre-change lines
257-276).

The reader did have the necessary source data: it had already parsed ordered
main-session JSONL usage frames and found the last `compact_boundary` before
aggregating (`session-history-reader.service.ts:741-764` after the change).
Agent-session histories were also available, but those are lifetime/cost
contributors and are not the root conversation's context.

## Requirement 4 decision: option (b), RPC plumbing

The fix adds the optional existing-RPC field
`stats.contextSnapshot = { model, contextTokens }` at
`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:268`.

This was preferable to always rendering an honest blank because the backend
had already parsed the exact source-of-truth frame during resume. The snapshot
is assigned only while traversing post-boundary main-session assistant frames;
therefore the final assignment is the globally latest root turn
(`session-history-reader.service.ts:764-795`). Agent usage still contributes to
lifetime totals and cost/model breakdowns but cannot overwrite CTX identity.

The token formula matches the live streaming producer: input + cache-read +
cache-creation, excluding response output. This means the value is on the same
order as a compaction marker's post-token figure, though the two can differ by
the response-output component.

No RPC method or namespace was added, so `ALLOWED_METHOD_PREFIXES` required no
change.

## Frontend behavior

`SessionLoaderService.applyResumeStats()` at lines 720-753 now owns the complete
resume-stat application policy:

- the original aggregate stats still go to `applyLoadedSessionStats`, which
  preserves the lifetime `TOKENS` chip;
- the per-model aggregate list is preserved and enriched only with known model
  context windows;
- CTX is computed solely from `contextSnapshot`;
- an absent snapshot clears `liveModelStats`, producing the honest unknown
  state instead of a cumulative percentage.

Both resume consumers call this helper: full switching at line 648 and
renderer-restored tabs at line 906. The restored path also clears stale stats
after a successful response with no stats and revalidates `(TabId, SessionId)`
after the asynchronous RPC before writing, preventing a delayed response from
updating a rebound tab. The `TabId` conversion uses `TabId.from()`.

The old resume-local `cumulativeExceedsWindow` guard is gone. It is dead code
because cumulative totals no longer feed the gauge.

All `[compaction-diag]` logging remains, including the loader site at lines
574-584. `compaction-lifecycle.service.ts` was not changed.

## RED then GREEN

The initial regression in
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
provided 896,300 aggregate tokens and an 11,016-token latest context for a
1,000,000-token model.

Focused red command:

```text
npx nx test @ptah-extension/chat --testPathPatterns=session-loader.service.spec.ts --testNamePattern="uses the post-compaction last-turn context instead of cumulative resume tokens for the gauge" --runInBand --skipNxCache
```

Verbatim failure excerpt:

```text
FAIL chat libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts
  ● SessionLoaderService › tab-targeted compaction reload › uses the post-compaction last-turn context instead of cumulative resume tokens for the gauge
    expect(jest.fn()).toHaveBeenCalledWith(...expected)
    - Expected
    + Received
      "tab-target-b",
      Object {
    -   "contextPercent": 1.1,
    -   "contextUsed": 11016,
    +   "contextPercent": 89.6,
    +   "contextUsed": 896300,
        "contextWindow": 1000000,
        "model": "claude-opus-5",
      },
    Number of calls: 1

Test Suites: 1 failed, 1 total
Tests:       1 failed, 36 skipped, 37 total
Snapshots:   0 total
NX   Running target test for project @ptah-extension/chat failed
```

After the final contract design, the test is named `uses the dedicated context
snapshot model instead of aggregate resume stats for the gauge` and asserts the
same 896,300-versus-11,016 symptom. The focused SessionLoader suite finished
with 38 passed and 2 skipped. Backend regressions additionally prove:

- the globally latest main model wins over an older aggregate-cost winner;
- agent usage cannot select or overwrite root CTX;
- the last post-compaction frame uses the same formula as live streaming.

No existing test encoded the cumulative behavior as correct. No test was
weakened or removed.

## Required verification gate — final working tree

Because `agent-sdk` and `shared` changed, both were added to all three commands.
Every Nx header confirmed **6 projects**.

### Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/agent-sdk @ptah-extension/shared
```

Verbatim terminal result (routine repeated Node `NO_COLOR` and worker-teardown
warnings omitted; all result lines below are unchanged):

```text
 NX   Running target test for 6 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat-ui
- @ptah-extension/agent-sdk
- @ptah-extension/shared

Test Suites: 55 passed, 55 total
Tests:       1310 passed, 1310 total
Snapshots:   0 total

Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1442 passed, 1444 total
Snapshots:   0 total

Test Suites: 15 passed, 15 total
Tests:       338 passed, 338 total
Snapshots:   0 total

Test Suites: 25 passed, 25 total
Tests:       152 passed, 152 total
Snapshots:   0 total

Test Suites: 22 passed, 22 total
Tests:       1 skipped, 450 passed, 451 total
Snapshots:   0 total

Test Suites: 65 passed, 65 total
Tests:       2 skipped, 1004 passed, 1006 total
Snapshots:   0 total

 NX   Successfully ran target test for 6 projects

Nx read the output from the cache instead of running the command for 5 out of 6 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/agent-sdk @ptah-extension/shared
```

Verbatim terminal output:

```text
 NX   Running target typecheck for 6 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat-ui
- @ptah-extension/agent-sdk
- @ptah-extension/shared

> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json

> nx run @ptah-extension/chat-state:typecheck
> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json

> nx run @ptah-extension/agent-sdk:typecheck
> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json

> nx run @ptah-extension/chat-streaming:typecheck
> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json

> nx run @ptah-extension/chat-ui:typecheck
> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json

> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

 NX   Successfully ran target typecheck for 6 projects

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/agent-sdk @ptah-extension/shared
```

Verbatim terminal result (individual existing warning listings omitted; summary
lines are unchanged):

```text
 NX   Running target lint for 6 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat-ui
- @ptah-extension/agent-sdk
- @ptah-extension/shared

Linting "@ptah-extension/shared"...
✖ 2 problems (0 errors, 2 warnings)

Linting "@ptah-extension/agent-sdk"...
✖ 38 problems (0 errors, 38 warnings)

Linting "@ptah-extension/chat-state"...
✖ 3 problems (0 errors, 3 warnings)

Linting "@ptah-extension/chat-ui"...
✖ 6 problems (0 errors, 6 warnings)

Linting "@ptah-extension/chat-streaming"...
✖ 2 problems (0 errors, 2 warnings)

Linting "@ptah-extension/chat"...
✖ 17 problems (0 errors, 17 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.

 NX   Successfully ran target lint for 6 projects

Nx read the output from the cache instead of running the command for 6 out of 6 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

All warnings are pre-existing and outside the new lines. `git diff --check`
also passed.

## Files changed for Batch 5

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- Batch 5 evidence/review reports under `.ptah/specs/TASK_2026_391/`

`session-stats-summary.component.ts`, `tab-manager.service.ts`, and the
compaction diagnostic services did not require production changes.
