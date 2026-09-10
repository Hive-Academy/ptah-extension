# TASK_2026_414 — Implementation batches

Design and evidence: `implementation-plan.md` in this folder. Read it before you start any batch.

Rules for every batch:

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/compaction-ui-consistency` (branch `fix/compaction-ui-consistency`). Never touch the root checkout.
- Executor: Ollama Cloud CLI, ptahCliId `pc-85830910-3d81-4248-84c1-4fa52752dd19`. No substitute provider without user consent.
- No commits, no pushes, no `git reset`, no bare `git stash`. No app restart, no live session-log edits.
- Batches run in order. One batch at a time. Each batch ends with the review/test gate in section 7.
- Test with `npx nx run-many`, never `nx test a b c`. Verify the `Running target test for N projects` header shows the N you requested.
- No `project.json` edits planned. If a batch must edit one, run `npx nx reset` first, and only when no other executor works in the worktree.
- Leave the `[compaction-diag]` `console.warn` blocks alone unless your change touches those exact lines.

---

## Batch 1 — Backend: single snapshot + compaction readiness + stale flag

Goal. One transcript parse feeds events, messages, and stats. The reader verifies the expected compaction boundary with a bounded retry. `chat:resume` reports a stale parse instead of returning it as if valid.

Files:

1. `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
   - Add optional `staleSnapshot?: boolean` to `ChatResumeResult` with a doc comment: true only when a recent compaction was known and the new boundary did not appear within the bounded retry budget.
2. `libs/backend/agent-sdk/src/lib/helpers/compaction-readiness-registry.ts` (new)
   - Bounded insertion-ordered map, 64 entries, LRU evict on insert past the bound.
   - `record(sessionId, entry: { boundaryRecordedAt: number })`.
   - `latest(sessionId)` returns the entry, or `null` when absent or older than `COMPACTION_READINESS_WINDOW_MS = 15 * 60_000`.
   - `clear()` for tests.
3. `libs/backend/agent-sdk/src/lib/message-transform/transformer-helpers.ts`
   - Add `readonly compactionReadiness: CompactionReadinessRegistry` to `TransformerHelpers`.
4. `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts`
   - In `transformCompactBoundary` (lines 32-96): after the sessionId-resolve guard (lines 66-78), call `helpers.compactionReadiness.record(sessionId, { boundaryRecordedAt: Date.now() })`. Skip the record exactly when emission is skipped.
5. `libs/backend/agent-sdk/src/lib/di/tokens.ts` + `libs/backend/agent-sdk/src/lib/di/register.ts` (or the lib's registration file per the existing pattern)
   - `SDK_COMPACTION_READINESS_REGISTRY: Symbol.for('SdkCompactionReadinessRegistry')`, singleton registration. Follow the `SDK_LIVE_USAGE_TRACKER` pattern.
6. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
   - Extract the boundary-scan + filter core of `readHistoryMessages` (lines 332-430) into a private `projectSimpleMessages(rawMessages, extractContent)`. `readHistoryMessages` calls it; behavior identical.
   - `readSessionHistory` (lines 135-214): new optional param `options?: { awaitCompactionBoundary?: boolean }`.
     - Add `messages` to the return value, computed from the SAME `mainMessages` array with `projectSimpleMessages`.
     - When `awaitCompactionBoundary` is true and the registry holds a recent entry for the session: scan the parse for the last `compact_boundary` line timestamp. Accept when it is at or after `entry.boundaryRecordedAt - COMPACTION_READINESS_SLACK_MS` (60 s). When not accepted: retry up to `MAX_COMPACTION_READINESS_ATTEMPTS = 5`, delay `COMPACTION_READINESS_RETRY_DELAY_MS = 150` between attempts, re-calling `readJsonlMessages` each time (the `(size, mtimeMs)` memo makes unchanged attempts free). After the last failed attempt, proceed with what was read and set `staleSnapshot: true` on the return value.
     - No registry entry, or entry outside the window: today's path, `staleSnapshot` absent.
   - Update the two-parse doc comment at `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:348-349` to the single-snapshot rule.
7. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
   - `resumeSession`: pass `{ awaitCompactionBoundary: true }` at line 798. Delete the `readHistoryAsMessages` call at line 805 and use `result.messages`. Thread `staleSnapshot` into the result.
8. Specs:
   - `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` — check whether it pins `ChatResumeResult` fields; update it if it does.
   - `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` — extend: (a) events and messages in the return come from one parse and share one boundary drop; (b) stale-then-ready JSONL: registry entry exists, first parse lacks the new boundary, retry loop observes the file change and returns ready; (c) budget exhausted → `staleSnapshot: true`; (d) no registry entry → flag absent; (e) boundary line written at completion time does not break the slack comparison (217 s compaction duration case).
   - New `compaction-readiness-registry.spec.ts`: LRU bound, recency window, `latest` after `clear`.
   - `libs/backend/agent-sdk/src/lib/message-transform/` transformer spec: `transformCompactBoundary` records only when a session id resolves.
   - `libs/backend/rpc-handlers` existing resume spec (`chat-session-resume-activate.spec.ts`): update for the single-read call shape and `staleSnapshot` passthrough.

Constraints:

- Do not change `ChatResumeParams`, `chat-rpc.schema.ts`, or the stats-only caller at `session-rpc.handlers.ts:834`.
- Do not delete `readHistoryAsMessages`. Add a doc note: `chat:resume` must not call it.
- Keep `readHistoryForCuration` behavior identical.
- No arbitrary sleep outside the bounded retry loop.

Test gate:

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx affected -t typecheck
```

Review gate: code-logic-reviewer + code-style-reviewer on the diff. Focus points: memo interaction with the retry loop, registry window math, single-parse guarantee, additive contract only.

---

## Batch 2 — Frontend: stale-snapshot guard in the compaction reload

Goal. A stale resume result never replaces the visible tab state. The tab stays on its compacted marker and reloads clean data on the next session switch.

Depends on: Batch 1 (the `staleSnapshot` field).

Files:

1. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
   - In `switchSession` after the `chat:resume` result and the second `requireTargetTab` (line 670-672), before the apply block (line 697): when `opts?.reason === 'compaction'` AND `resumeResult.data?.staleSnapshot === true`, do not apply events, messages, or stats. Restore the tab: status `loaded`, `markTabIdle`, keep the `preloadedStats` that `applyCompactionComplete` installed. Warn once. Return normally so the pending-settle counter still clears compaction state.
   - Do not change the non-compaction resume path.
2. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
   - New cases: (a) compaction reload with `staleSnapshot: true` → no event/message/stats apply, tab restored, state not 'resuming'; (b) compaction reload with flag absent → normal apply; (c) normal resume with `staleSnapshot: true` (defensive) → normal apply (flag consumed only on compaction reason); (d) pin the existing dedup: two concurrent `switchSession` calls with the same `${sessionId}:${targetTabId}` share one in-flight load; (e) pin `requireTargetTab`: a tab that no longer owns the session throws.

Constraints:

- Do not add sleeps or re-try loops on the frontend. The bounded backend retry is the only retry.
- Do not touch `_inFlightSessions` semantics, `requireTargetTab`, `clearPendingUpdates`, or turn-state floors.

Test gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state
npx nx affected -t typecheck
```

Review gate: code-logic-reviewer + code-style-reviewer. Focus points: pending-settle counter still clears, no stuck 'resuming' state, guard scoped to reason 'compaction'.

---

## Batch 3 — Frontend: per-session compaction timers

Goal. Two concurrent compactions keep independent safety timers. Every exit path cleans its own timer.

Depends on: Batch 2 (same file family; avoids merge conflicts in `compaction-lifecycle.service.ts`).

Files:

1. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`
   - Replace `compactionTimeoutId` (line 57) with `private readonly compactionTimers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; tabIds: string[]; convIds: string[] }>()`.
   - `handleCompactionStart` (lines 110-152): clear and re-arm only the entry for that session id. The callback closes over that session's `tabIds` and `convIds`, re-verifies each tab still binds the session, then applies the timeout reset. The callback deletes its own map entry.
   - `handleCompactionComplete` (lines 261-427): clear only the entry for `result.compactionSessionId` (lines 268-271 replacement).
   - `clearCompactionState(tabId?)` (lines 526-547): with a tab id, clear entries whose `convIds` include that tab's conversation. Without a tab id, clear all entries. Keep both external callers working: `chat-lifecycle.service.ts:277` (sweep) and `session-stats-aggregator.service.ts:85` (tab-scoped).
2. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`
   - New cases: (a) two sessions start compaction → two live timers, neither cancels the other; (b) session A completes → only A's timer cleared, B's still armed; (c) timeout fires for A → only A's tabs get the reset; (d) `clearCompactionState()` clears all; (e) `clearCompactionState(tabId)` clears only entries bound to that tab's conversation; (f) timeout callback skips a tab that closed or re-bound during the wait.

Constraints:

- Keep `COMPACTION_SAFETY_TIMEOUT_MS = 600000` unchanged.
- Do not change `handleCompactionComplete` fan-out logic, marker stamping, or the reload-target selection. Only the timer bookkeeping changes.
- Do not remove the `[compaction-diag]` warns unless your edit rewrites those exact lines.

Test gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state
npx nx affected -t typecheck
```

Review gate: code-logic-reviewer + code-style-reviewer. Focus points: every exit path deletes its entry (complete, per-tab clear, sweep, timeout fire), no timer leak on repeated starts of the same session.

---

## Batch 4 — Frontend: post-compaction context seed + neutral marker wording

Goal. After compaction, the context display shows the SDK-reported post-compaction size when it is known and stays blank when it is not. The marker never claims a shrinkage the numbers contradict.

Depends on: Batch 3 (same service; sequential order prevents conflicts).

Files:

1. `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
   - `applyCompactionComplete` (lines 1730-1753): payload gains optional `postCompactionContextTokens?: number | null`. When the value is a positive finite number AND the tab's current `liveModelStats` has a model, seed `liveModelStats` with `{ model, contextUsed: postCompactionContextTokens, contextWindow, contextPercent }` instead of `null`. Missing, zero, negative, or NaN → `null` (unchanged). Cumulative cost/token fields stay untouched.
2. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`
   - In `handleCompactionComplete`, pass `postCompactionContextTokens: result.postTokens ?? null` to `applyCompactionComplete` for each fan-out tab.
3. `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
   - New cases: (a) postTokens 21930 + known model → seeded stats with that value; (b) postTokens absent → `liveModelStats` null; (c) postTokens 0 → null (unknown is not zero); (d) cumulative tokens/cost unchanged by the seed; (e) a later live usage frame still overwrites the seed.
4. `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts`
   - `tokenLine` (lines 97-105): keep "shrank" only when `preTokens > postTokens`. When `postTokens >= preTokens`, render `` `${format(pre)} → ${format(post)} tokens` `` with no verb. Either value null → no line (unchanged).
5. `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts`
   - New cases: (a) pre 150000 / post 21000 → "shrank"; (b) pre 144 / post 21930 → neutral, no "shrank"; (c) equal values → neutral; (d) one value null → no token line.

Constraints:

- Do not touch `aggregateUsageStats`, `LiveUsageTracker`, `SessionStatsAggregator`, or `preloadedStats` preservation.
- No other refactors in the marker component.

Test gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx affected -t typecheck
```

Review gate: code-logic-reviewer + code-style-reviewer. Focus points: seed only when positive and finite, no synthetic zero overwrites real context, cumulative totals unchanged.

---

## Batch 5 — Backend: artifact parity between live transform and replay

Goal. The same transcript artifacts produce the same user-visible messages on live transform and on replay. Fix only divergences the parity spec proves.

Depends on: Batch 1 (same lib; sequential order prevents conflicts).

Files:

1. New spec `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts` (or the replay spec folder if the repo prefers; follow existing spec placement).
   - Fixture corpus, each through BOTH `SdkMessageTransformer.transform` (live path) and the replay path (`session-replay.service.ts`): `isSynthetic: true` user line; `isMeta: true` user line; `sourceToolUseID` user line; tool-result-only user line; `<task-notification>` text; interrupt-sentinel text; `<skill-format>`, `<command-message>`, `<command-name>`, skill base-directory, invoked-skills, plan-file, frontmatter content patterns; local command output line; one genuine user text; one genuine assistant text; the `No response requested.` probe line.
   - Assert: the user-visible message set is identical between the two paths.
2. Run the spec. Record which fixtures diverge. Expected (from code reading, not yet proven by test): replay lets the `isSkillOrMetaContent` patterns through.
3. Fix ONLY the proven divergences. Expected minimal fix: `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` user-message gate (lines 122-144) gains the `isSkillOrMetaContent` check, imported from `message-transform-helpers.ts` (same lib). If the spec proves the live path misses task-notification or interrupt-sentinel user text, add those checks to the live gate in `sdk-message-transformer.ts` (lines 159-191).
4. Update the spec to cover the fixed behavior. Add regression cases to the replay spec if the repo separates them.

Constraints:

- No timestamp sorting. No blanket drop of genuine user or assistant messages.
- Compaction summary semantics stay unchanged: boundary drop rule, marker summary persistence, `compact_boundary` handling.
- The `No response requested.` provenance stays a hypothesis. Fix it only if the parity spec proves a rule that covers it without dropping genuine content. Otherwise record the finding in the review notes and leave it.

Test gate:

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx affected -t typecheck
```

Review gate: code-logic-reviewer + code-style-reviewer. Focus points: filter direction (replay gains live's checks, not the reverse, unless the spec proves otherwise), no genuine content dropped, fixture coverage matches the corpus above.

---

## Completion gate (after Batch 5)

1. Full suite over all touched projects:

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx affected -t typecheck
```

Verify the header shows 7 projects.

2. Map each acceptance item from `context.md` (1-6) to the batch and spec that covers it. Record the mapping in the task folder.
3. Confirm no `[compaction-diag]` warns were removed outside the allowed exception.
4. Confirm no commit and no push exist on the branch beyond the starting commit `30d37f61c`.
