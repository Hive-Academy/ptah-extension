# TASK_2026_414 — Compaction UI consistency: reconciled implementation plan

Reviewed against `5f79f5ad8` (including PR490). Work only in this worktree; no commits, pushes, app restart, or session-log mutation.

## Verdict

Keep the fix, but replace the old timestamp/readiness-window proposal. It would accept an old boundary within a 60-second slack, adds a permanent time-based registry, and turns flush timing into a clock-comparison problem. The current typed SDK compact-boundary contract does not expose the JSONL line `uuid`, so a true boundary identity cannot be carried from the stream to the file reader.

Use the smallest safe substitute: a process-local, per-session expected boundary **ordinal**. A successful history parse records the number of `compact_boundary` lines it observed. When the transformer emits a resolved completion, it records “next ordinal” from that baseline. The compaction-only resume accepts a snapshot only when its boundary count reaches that explicit expected ordinal. There is no timestamp, slack, expiry window, or frontend retry. If no baseline exists or the bounded retry cannot observe the expected ordinal, return the one immutable snapshot with `staleSnapshot: true`; the frontend deliberately leaves the compacted state intact rather than applying known-stale data.

This is one narrowly-scoped singleton because producer and reader otherwise have no shared state. It must be bounded by entry count and clear a pending expectation after the compaction resume settles; do not add a general readiness service, persistent state, or new RPC request field.

## Verified causes and retained scope

1. `ChatSessionService.resumeSession` still makes two sequential reads (`readSessionHistory`, then `readHistoryAsMessages`), which can mix generations. Return text messages from the same parsed array as replay events and stats.
2. `CompactionLifecycleService` still has one `compactionTimeoutId`; concurrent sessions cancel each other.
3. The marker still says “shrank” even when `postTokens >= preTokens`.
4. `applyCompactionComplete` clears `liveModelStats`; compaction `postTokens` is already carried to the lifecycle handler and can seed only the context display.
5. Replay and live user-artifact filters differ, but the user-visible consequence must be proved by a parity test before changing a filter.

PR490 is preserved. It fixes provider/Codex usage-context handling; it does not justify provider-accounting changes here. Do not alter `compact_metadata` accounting, `aggregateUsageStats`, `LiveUsageTracker`, `SessionStatsAggregator`, or cumulative cost/token totals.

## Design

### Immutable, boundary-ready resume

`SessionHistoryReaderService.readSessionHistory` reads JSONL once per attempt. Its return grows additively to `{ events, messages, stats, staleSnapshot? }`; both projections consume the same `mainMessages` array and therefore the same last-boundary drop. `ChatSessionService.resumeSession` uses those returned messages and no longer calls `readHistoryAsMessages`.

Keep `readHistoryAsMessages` and `readHistoryForCuration` public behavior unchanged. Extract only the text projection into a private helper, and document that `chat:resume` must use the single-snapshot result.

Add `CompactionBoundaryGenerationRegistry` in `agent-sdk`:

- per session, retain the latest observed boundary count and, only while pending, its expected next count;
- reader records the count for every successful full history parse, but captures any pending expectation before updating that observation;
- `transformCompactBoundary` records an expectation only after resolving a session id, using the latest count plus one; absent baseline becomes an explicit unverified expectation, never an assumed-ready one. Inject this singleton into `SdkMessageTransformer` and pass it through `createIsolated()` so all compact-boundary paths share the same expectation;
- the compaction-only reader compares counts, not timestamps. It retries a small, fixed number of event-loop turns only while a pending expectation is unmet, re-reading via the existing `(size, mtimeMs)` cache token. No `Date.now`, delay duration, slack, recency TTL, or sleep;
- the expectation is consumed on ready or exhausted response. The registry has a small insertion-order cap solely for process-memory safety; pending entries must never survive a completed response.

The stats-only `session:stats-batch` caller does not opt in. `ChatResumeParams` and its Zod schema remain unchanged. `ChatResumeResult.staleSnapshot?: true` is additive and means precisely: a compaction reload could not verify its expected boundary generation. A compaction result without a baseline is stale by design rather than risking a pre-boundary overwrite.

In `SessionLoaderService`, consume that flag only for `reason: 'compaction'`, after the ownership re-check and before stats/event/message application. Mark the targeted tab loaded/idle, keep the compaction marker and preloaded totals installed by `applyCompactionComplete`, and return normally so the lifecycle pending-settle accounting clears. Do not schedule a frontend retry. Normal resumes, deduplication, target ownership, pending-update clearing, and turn-state floors stay unchanged.

### Per-session recovery timers

Replace the singleton handle with a map keyed by `SessionId`; each entry owns its timeout, fan-out tab ids, and conversation ids. Starting A only replaces A. Completion clears only its session. A tab-scoped clear removes only entries associated with that tab’s current conversation; a sweep removes all. Timeout deletes its own entry before applying resets and verifies that every captured tab is still bound to that session. Preserve the 600000 ms safety timeout and all current fan-out/reload selection.

### Context seed and marker copy

`applyCompactionComplete` accepts `postCompactionContextTokens`. With a positive finite post value and an existing model, seed only `liveModelStats.contextUsed` (and recompute its percent from the existing model/window data). Missing, zero, negative, non-finite value, or no model remains `null`. Do not synthesize zero or write cumulative fields. `handleCompactionComplete` forwards `result.postTokens`.

The marker says “shrank” only for `preTokens > postTokens`; equal or increasing values render a neutral `pre → post tokens` line; a null endpoint renders no line.

### Artifact parity, proof before change

First add a focused parity test that compares normalized visible user/assistant text from live transformation and replay for each compatible fixture: synthetic/meta, `sourceToolUseID`, tool-result-only, task notification, interrupt sentinel, each `isSkillOrMetaContent` pattern, local-command output where both paths have a representation, genuine user/assistant text, and the `No response requested.` probe. The test must report a concrete divergence. Only then apply the smallest matching replay-side filter change (expected: replay imports `isSkillOrMetaContent`). Do not force parity for protocol-only messages that one path cannot represent, sort timestamps, or blanket-drop content. Leave the screenshot provenance untouched unless a proven rule safely covers it.

## Explicitly out of scope

- Provider `compact_metadata` accounting and any PR490 provider changes.
- A timestamp/readiness-window/slack design, persisted readiness data, or new frontend polling.
- `ChatResumeParams`, `chat-rpc.schema.ts`, `LiveUsageTracker`, aggregate usage, turn-state, dedup, revision floors, and compaction fan-out policy.
- Deleting `readHistoryAsMessages`.
- Removing the marked `[compaction-diag]` warnings.

## Acceptance-to-proof map

| Acceptance | Proof |
| --- | --- |
| Boundary-ready immutable resume | Batch 1 single-parse, ordinal-ready, stale, dedup, ownership specs; Batch 2 guard spec |
| Context seed without synthetic zero | Batch 4 tab-manager specs |
| Live/replay artifact handling | Batch 5 parity-first spec and only its proven regression |
| Independent recovery timers | Batch 3 concurrent-session and cleanup specs |
| Neutral wording | Batch 4 marker specs |
| Targeted regressions | Batches 1–5 test gates and completion run |

## Verified commands

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx affected -t typecheck
```

No `project.json` edit is planned; do not run `nx reset`.
