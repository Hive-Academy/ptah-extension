# TASK_2026_414 — Compaction UI consistency: implementation plan

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/compaction-ui-consistency` (branch `fix/compaction-ui-consistency`)
- All product edits and test runs target the worktree, never the root checkout.
- Executor for every batch: Ollama Cloud CLI, ptahCliId `pc-85830910-3d81-4248-84c1-4fa52752dd19`. No substitute provider without user consent.
- No commits or pushes. No live session/log mutations. Do not restart the app.

All line numbers below were verified against the worktree on 2026-09-10.

## 1. Proven causes (verified in code + logs)

### P1 — Mixed snapshot: `chat:resume` performs two independent transcript reads

`ChatSessionService.resumeSession` reads the transcript twice, sequentially:

- `chat-session.service.ts:798` — `readSessionHistory` (events + stats; drops pre-boundary inside `session-replay.service.ts`).
- `chat-session.service.ts:805` — `readHistoryAsMessages` (messages; drops pre-boundary inside `readHistoryMessages`, `session-history-reader.service.ts:379-393`).

`JsonlReaderService.readJsonlMessages` memoizes on `(path, size, mtimeMs)` (`jsonl-reader.service.ts`, TASK_2026_353 token rule). During the post-compaction reload the SDK appended the new `compact_boundary` + summary lines between the two reads, so `size/mtimeMs` moved and the second read re-parsed a NEWER file. Result (verified log, session `8a0a185b`): events from the pre-compaction parse (old boundary, 194 events) mixed with messages from the post-compaction parse (new boundary, 4 messages). Session `d1808e88` returned 609 events / 16 messages with no new boundary at all. Later reloads found the new boundaries (9 events / 4 messages) — the boundary does land on disk shortly after; the first read raced it.

### P2 — Singleton compaction safety timer

`compaction-lifecycle.service.ts:57` holds ONE `compactionTimeoutId`. `handleCompactionStart` (lines 120-123) clears any existing timer before arming its own (lines 136-151). Two concurrent compactions (two live sessions/tiles) therefore cancel each other's 10-minute safety net: session B's start disarms session A's timer, and whichever completes first (line 268-271) disarms the rest. `clearCompactionState` (lines 527-530) also clears the single timer on every call.

### P3 — Marker always claims shrinkage

`compaction-marker.component.ts:97-105`: `tokenLine` is always `` `shrank ${pre} → ${post} tokens` ``. Observed boundary metadata: preTokens 144/68, postTokens 21930/17369 — post > pre, so the chip asserts a shrinkage the numbers contradict.

### P4 — Post-compaction context display is blanked by construction

Mechanics, all verified:

- `aggregateUsageStats` (`session-history-reader.service.ts:744-755, 832-834`) slices stats to the post-boundary segment and returns `null` when that segment holds no usage. Immediately after a compaction, with no assistant turn since the boundary, `stats` is `null` and `stats.contextSnapshot` cannot exist.
- `applyCompactionComplete` (`tab-manager.service.ts:1750`) sets `liveModelStats: null`.
- In `switchSession` (`session-loader.service.ts:686-696`), `stats == null` plus `targetTabId` set (always true for compaction reloads) hits neither branch, so nothing restores the context display until the next live turn.

The compaction itself produced a trustworthy post-compaction context size — `compact_metadata.post_tokens` (21930/17369), already plumbed end-to-end: SDK → `system-message.transformer.ts:91` → `CompactionCompleteEvent.postTokens` → `accumulator-core.service.ts:569` → `streaming-handler.service.ts:340` → `chat.store.ts:366` → `handleCompactionComplete` → currently only into the marker record.

## 2. Hypotheses (explicitly NOT treated as proven)

- H1 — preTokens 144/68 equaling the last assistant output usage with input/cache zero is provider-side `compact_metadata` accounting (the SDK computes it from usage frames the provider reports). This is distinct from the refresh failure (context.md). We do not attempt to fix provider accounting; the marker wording fix (P3) is the user-visible mitigation.
- H2 — Live vs replay artifact filter divergence lets injected/synthetic content through replay. The CODE divergence is proven (see §5); which artifact a user actually saw (the `No response requested.` screenshot) is UNVERIFIED. Batch 5 probes it; no fix lands without a proven rule.
- H3 — The first post-compaction read can legitimately observe a transcript that does not yet contain the expected new boundary (SDK flush timing). Supported by P1's log evidence ("later reloads found the boundary"); the bounded-readiness design (§4.1) assumes it.

## 3. Verified contracts (current state)

- `CompactionCompleteEvent` (`libs/shared/src/lib/types/execution/stream.ts:264-274`): `trigger`, optional `preTokens`/`postTokens`/`durationMs`.
- `ChatResumeParams` (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:210-230`): no compaction-related field today; zod-validated by `ChatResumeParamsSchema` in `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (spec: `chat-rpc.schema.spec.ts:115-150`, including a known-keys assertion).
- `ChatResumeResult` (`rpc-chat.types.ts:233-310`): `messages` (deprecated), `events`, `stats.contextSnapshot`, `resumableSubagents`, `cliSessions`, `activated`, `activationError`.
- `readSessionHistory` (`session-history-reader.service.ts:135-214`): returns `{ events, stats }`; internally holds `mainMessages` (the full parsed array), `agentSessions`; seeds `LiveUsageTracker` (`seedLiveUsageBaseline`, lines 248-268, stops at last `compact_boundary`).
- `readHistoryAsMessages` / `readHistoryMessages` (lines 280-430): boundary scan + `extractTextContent` + `<task-notification>` drop. No other production caller besides `chat-session.service.ts:805` (verified by grep; `readHistoryForCuration` shares the private core but is a separate public method used by the memory curator).
- `transformCompactBoundary` (`system-message.transformer.ts:32-96`): clears streaming state, resolves sessionId (caller → payload → activeIds[0]), prunes subagents, `clearSessionTokenSnapshot` (line 81), emits `compaction_complete` with `timestamp: Date.now()` and metadata passthrough. Skips emission when no sessionId resolves (lines 66-78).
- Frontend reload chain: `chat.store.ts:361-368` → `CompactionLifecycleService.handleCompactionComplete` (`compaction-lifecycle.service.ts:261-427`): marker stamp (351), `applyCompactionComplete` per fan-out tab (381), then `switchSession(sessionId, { reason: 'compaction', targetTabId })` per target (410-423) with a pending-settle counter.
- `switchSession` (`session-loader.service.ts:552-745`): dedup via `_inFlightSessions` keyed `${sessionId}:${targetTabId}` (557-568); `requireTargetTab` throws when the tab no longer owns the session (747-756); prefers `events` replay path (697) over legacy `messages` (714).
- `CompactionMarkerRecord` + `setCompactionMarkerTokens` (`conversation-registry.service.ts:263-285`): per-conversation, field-wise merge with persisted prior, `completedAt` max-merge.
- Timer sweep callers: `chat-lifecycle.service.ts:277` (`clearCompactionState()`, no tab) and `session-stats-aggregator.service.ts:85` (`clearCompactionState(t.id)`).

## 4. Design

### 4.1 Consistent boundary-verified reload (acceptance 1)

Two independent fixes, layered:

**(a) Single snapshot (kills the mixed snapshot by construction).**
`readSessionHistory` gains the messages projection: extract the boundary-scan + filter core of `readHistoryMessages` into a private `projectSimpleMessages(rawMessages, extractContent)` and call it inside `readSessionHistory` with `eventFactory.extractTextContent`. Return shape grows additively:

```ts
{ events, stats, messages: SimpleHistoryMessage[] }   // messages from the SAME mainMessages parse
```

`resumeSession` (`chat-session.service.ts:805`) drops its `readHistoryAsMessages` call and uses `result.messages`. Events and messages now drop pre-boundary by the SAME rule over the SAME array — a mid-read file change can no longer split them. The stale doc comment at `jsonl-reader.service.ts:348-349` ("chat:resume calls readSessionHistory() and then readHistoryAsMessages() — two full parses") is updated in the same change.

`readHistoryAsMessages` stays: it is documented public API of `@ptah-extension/agent-sdk` with its own specs, and `readHistoryForCuration` shares its core. It gets a doc note that `chat:resume` must not call it (single-snapshot rule). Deleting public API mid-bugfix is out of scope.

**(b) Bounded boundary readiness (kills the stale snapshot).**
The backend already knows, in-process, when it transformed a `compact_boundary` — the same process that serves `chat:resume`. No frontend timestamp plumbing, no clock skew.

- New injectable `CompactionReadinessRegistry` (`agent-sdk`, helpers): bounded insertion-ordered map (64 entries, LRU-evicted — same bound pattern as `RESUME_BASELINE_LIMIT`), `record(sessionId, { boundaryRecordedAt, boundaryLineTimestamp? })` and `latest(sessionId)`. Retention rule: entries older than `COMPACTION_READINESS_WINDOW_MS` (15 min) answer `null` — recency is the validity token, not a TTL sweep (the LRU is only the leak guard; matches the repo's read-cache rules).
- Producer: `transformCompactBoundary` records AFTER the resolvedSessionId guard (skip exactly when emission is skipped). `TransformerHelpers` (`transformer-helpers.ts:10`) gains a `readonly compactionReadiness` member; DI token `SDK_COMPACTION_READINESS_REGISTRY: Symbol.for('SdkCompactionReadinessRegistry')` in `di/tokens.ts` + `register.ts`.
- Consumer: `readSessionHistory` gains an options param `{ awaitCompactionBoundary?: boolean }`. When set AND the registry holds a recent entry for the session, the reader verifies the parse's last `compact_boundary` line timestamp is at/after `entry.boundaryLineTimestamp - COMPACTION_READINESS_SLACK_MS` (60 s). If not: bounded retry — `MAX_COMPACTION_READINESS_ATTEMPTS = 5`, `COMPACTION_READINESS_RETRY_DELAY_MS = 150` (worst case ≈ 750 ms), re-calling `readJsonlMessages` (memoized: an unchanged `(size, mtimeMs)` token costs nothing; a changed token re-parses). No arbitrary sleep is the sole mechanism — the loop is token-gated and bounded.
- Only `ChatSessionService.resumeSession` passes `awaitCompactionBoundary: true` (opt-in; the stats-only caller at `session-rpc.handlers.ts:834` is untouched). The registry's recency window is the real gate: normal resumes of sessions without a recent compaction take the exact same path as today.
- Readiness result travels out as `ChatResumeResult.staleSnapshot?: boolean` (additive, `rpc-chat.types.ts`): `true` only when the hint was checked and the boundary never appeared within the budget; absent otherwise. No `ChatResumeParams` change, no `chat-rpc.schema.ts` change.
- Check `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` for any shape-pinning of `ChatResumeResult` and update if it enumerates result fields.

**Frontend stale guard** (`session-loader.service.ts`, after the `chat:resume` return, before the apply block at line 697): when `opts?.reason === 'compaction'` and `resumeResult.data?.staleSnapshot === true` — do NOT apply events/messages/stats (the payload is a pre-compaction parse; applying it is exactly the defect), restore the tab (`markTabIdle`, status `loaded`, keep `preloadedStats` installed by `applyCompactionComplete`), warn once, return normally so the pending-settle counter still clears compaction state. The tab shows the compacted marker and refills correctly on the next session switch, which re-resumes and now finds the boundary. Non-compaction resumes keep today's behavior unchanged.

**Unchanged guards, to be test-pinned (acceptance 1 "preserve newer live turns and tab isolation", acceptance 6 "existing load deduplication"):** `_inFlightSessions` dedup key `${sessionId}:${targetTabId}`, `requireTargetTab` ownership throw, `clearPendingUpdates` before targeted replay (`session-loader.service.ts:631-633`), turn-state revision floors (untouched — no writer in this task).

### 4.2 Reliable post-compaction context stats (acceptance 2)

- `TabManagerService.applyCompactionComplete` (`tab-manager.service.ts:1730-1753`) payload gains `postCompactionContextTokens?: number | null`. When it is a positive finite number AND the tab's current `liveModelStats` has a model, the write seeds `liveModelStats` with `{ model, contextUsed: postCompactionContextTokens, contextWindow, contextPercent }` instead of `null`. Zero, negative, NaN, or missing → `null` (unchanged) — **unknown is not zero, and zero is not evidence**.
- `handleCompactionComplete` passes `result.postTokens` through (it already computes nothing new — the value rides the existing chain, §1 P4).
- Cumulative cost/tokens are untouched: `preloadedStats` preservation and `SessionStatsAggregator` grace-window logic stay exactly as-is. `aggregateUsageStats` slicing is unchanged. No change to `LiveUsageTracker` semantics (TASK_2026_374 rules stand; `clearSessionTokenSnapshot` at boundary, lines `system-message.transformer.ts:81`, stays).
- H1 (provider preTokens accounting) is explicitly not addressed beyond the marker wording.

### 4.3 SDK artifact semantics, live vs replay (acceptance 3)

Verified divergence — live user-message gate (`sdk-message-transformer.ts:159-191`): `isSynthetic === true`; skill-tool-active unless tool_result; `isSkillOrMetaContent` patterns (`message-transform-helpers.ts:28-77`: `sourceToolUseID`, `<skill-format>`, `<command-message>`, `<command-name>`, skill base-directory, invoked-skills, plan-file, frontmatter). Replay user gate (`session-replay.service.ts:122-144`): `isMeta === true`; `sourceToolUseID`; tool_result-only; `<task-notification>`; interrupt sentinel.

Batch 5 lands a parity spec FIRST (fixture corpus: every pattern above, a genuine user text, a local-command-output line, and the `No response requested.` probe), running the same fixtures through `SdkMessageTransformer.transform` and `replayToStreamEvents`, asserting the same user-visible message set. Then only the divergences the spec proves are fixed — expected minimal change: replay gains the `isSkillOrMetaContent` content patterns for user lines (same lib, import from `message-transform-helpers`). Constraints: no timestamp sorting, no blanket drop of genuine user/assistant messages, compaction summary semantics (boundary drop + registry-persisted marker summary) unchanged.

### 4.4 Per-session compaction timers (acceptance 4)

Replace the singleton with `private readonly compactionTimers = new Map<SessionId, { timeoutId; tabIds; convIds }>()`:

- `handleCompactionStart(sessionId)`: clear + re-arm ONLY the entry for that session; callback closes over that session's `tabIds`/`convIds` and re-verifies each tab still binds the session before `applyCompactionTimeoutReset` (a tab may have closed or re-bound during the 10 minutes).
- `handleCompactionComplete(result.compactionSessionId)`: clear only that session's entry.
- `clearCompactionState(tabId?)`: with tabId → clear entries whose `convIds` include the tab's conversation; without → clear ALL entries (full-sweep semantics preserved for `chat-lifecycle.service.ts:277`).
- Timeout fire: delete own entry (`this.compactionTimers.delete(sessionId)` inside the callback — the current code already nulls its own handle, line 147).

### 4.5 Neutral marker wording (acceptance 5)

`tokenLine` (`compaction-marker.component.ts:97-105`): keep "shrank" only when `preTokens > postTokens` (a demonstrated reduction); when `postTokens >= preTokens` render `` `${format(pre)} → ${format(post)} tokens` `` with no verb. Either value null → no line (unchanged). No other refactors in the component.

## 5. Explicitly out of scope

- Provider-side `compact_metadata` accounting (H1).
- The `No response requested.` screenshot provenance (H2) — probe only.
- Deleting `readHistoryAsMessages` public API.
- The `[compaction-diag]` `console.warn` blocks (`compaction-lifecycle.service.ts:325-345, 393-398`; `session-loader.service.ts:613-626`) — marked TEMPORARY, but removing them is an unrelated refactor (scope item 5); leave them unless a batch touches those exact lines for its own change.
- Any change to `ChatResumeParams` / `chat-rpc.schema.ts`.
- Turn-state, dedup, revision-floor, or `LiveUsageTracker` semantics.

## 6. Race and concurrency guards (summary)

| Race                                      | Guard                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Transcript appended between two reads     | Single snapshot — one parse feeds events + messages (§4.1a)                                  |
| Boundary not yet flushed at reload        | Bounded token-gated retry + `staleSnapshot` flag + frontend no-apply guard (§4.1b)           |
| Unchanged-file retry cost                 | `readJsonlMessages` memo on `(size, mtimeMs)` — retries are free until the file moves        |
| Two concurrent compactions                | Per-session timer map, per-session clear (§4.4)                                              |
| Tab closed/re-bound during a 10-min timer | Callback re-verifies session ownership before reset (§4.4)                                   |
| Duplicate concurrent reloads              | `_inFlightSessions` keyed `${sessionId}:${targetTabId}` (existing, test-pinned)              |
| Reload target drift                       | `requireTargetTab` ownership throw (existing, test-pinned)                                   |
| Readiness registry growth                 | 64-entry LRU + 15-min recency window                                                         |
| Stale guard misfiring on normal resumes   | Opt-in flag + registry recency gate; `staleSnapshot` consumed only on `reason: 'compaction'` |

## 7. Test commands (verified project names)

```bash
# Never `nx test projA projB projC` — first project only. Always run-many, then check the header count:
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx run-many -t test -p @ptah-extension/chat-streaming   # only if a batch touches it (none planned)
npx nx affected -t typecheck                                # after each batch
```

Run from the worktree root. Verify the `Running target test for N projects` header shows the N requested. No `project.json` edits are planned, so no `npx nx reset` is required; if one becomes necessary, never run it while another executor works in the worktree.
