# Implementation Plan Addendum - TASK_2026_597 - Decision 10 (N7 budgets, N8 handoff workflow)

Status: draft for Gate 2. No batch may be appended to `batches.md` before the user approves this addendum and answers
`## Decisions for the user`.

## Inputs and constraints

- Requirements used: `context.md` § User Decisions items 9 and 10 (lines 108-146); coordinator message (2026-10-03):
  "the budgets must use the SAME values the chat already shows in the session stats summary (TOKENS 14.1M, COST $8.96)
  ... Do not invent a second counter".
- Plan components integrated with (read by grep only): 6b `implementation-plan.md:802-822`, 17 `:1122-1154`,
  19 `:1183-1200`, 20 `:1202-1223`, 21 `:1225-1253`, settings table `:430-431`, `compaction:getConfig` `:463`.
- Batches integrated with (headers and task bodies read): 16-17, 20-21, 23, 26-31, 32, 36, 37-41, 46-47
  (`batches.md:1102-1200, 1286-1370, 1426-1476, 1557-1787, 1789-1842, 2073-2278, 2413-2470`).
- Corrections applied: the coordinator message above replaces the "reuse the ledger, weighted fallback" wording of item
  10 with "one figure, the one the chat shows".
- Missing decision-critical input: none blocks the design. Four choices need the user (see the last section).

## Codebase evidence

### What the chat's TOKENS and COST are today (verified trace)

| Evidence                                                                                                                                                                                                                            | Location                                                                                                                                                                                                      | Implication                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The summary renders ONLY the backend snapshot: TOKENS = `snapshot().tokenCount`, COST = `snapshot().totalCost` (`null` → "cost unavailable", plus a labelled `knownCost` subtotal when pricing is partial)                          | `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:669, 761, 768-776, 790-794`                                                                                               | The budget must read `SessionStatsEntry.tokenCount` / `.totalCost` of the same snapshot object.                   |
| The chat installs the snapshot as-is from `session:stats.sessionStats`, after shape and session-id checks; no frontend arithmetic                                                                                                   | `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:113-160, 239-256`                                                                                                         | No frontend counter exists to diverge from.                                                                       |
| `session-live-stats.util.ts` derives only the context badge (latest main request / capacity); it is "not an accounting figure"                                                                                                      | `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:38-105`; `session-stats-summary.component.ts:672-676`                                                                              | Context % is a separate signal (A6/A8 use it); it is not the budget.                                              |
| `tokenCount` = input + output + cacheRead + cacheCreation (all four classes)                                                                                                                                                        | `session-usage-aggregator.ts:432, 461`; owner run contribution `session-stats-owner.service.ts:837-838`; type doc `libs/shared/src/lib/types/rpc/rpc-session.types.ts:367-368`                                | TOKENS is raw tokens, dominated by cache-read. It is optional in the type, so "absent" must be handled.           |
| Snapshot = fixed history prefix + Σ per query run (latest cumulative SDK result minus restored base)                                                                                                                                | `session-stats-owner.service.ts:16-20, 652-701`                                                                                                                                                               | Lifetime of the session, all turns, across restarts and resumes.                                                  |
| Live runs come from the SDK `result.modelUsage` (cumulative per query, every model, Task subagents included); the per-turn `usage` is main-loop only and is NOT counted                                                             | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:653-655, 684-689, 704-718, 767-773`                                                                                                             | TOKENS and COST include subagent spend live. Live subagent spend is not separable (only per model id).            |
| History prefix aggregates the parent ledger AND every subagent ledger (`scope: 'session'`)                                                                                                                                          | `session-usage-aggregator.ts:161-171, 243-250`; ledgers per transcript file `session-usage-ledger.ts:37-48, 213-247`                                                                                          | From history, parent vs subagent IS separable (separate ledgers), but the snapshot sums them.                     |
| Snapshot is published per SDK `result` (one per turn) on `session:stats`, and returned to `onResultStats`                                                                                                                           | `stream-transformer.ts:698-746, 788-791`; broadcast `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:400-418`; adapter wrapper `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1581-1591` | Budget granularity is per turn, not per request. The wrapper sees the exact object the webview gets.              |
| `snapshot(sessionId)` returns `null` while the prefix read is in flight or the session has no owner                                                                                                                                 | `session-stats-owner.service.ts:562-572`                                                                                                                                                                      | "No stats yet" is a defined state.                                                                                |
| A run without per-model usage marks the snapshot `coverage: 'partial'` and `totalCost: null`                                                                                                                                        | `session-stats-owner.service.ts:528-546, 680-692`                                                                                                                                                             | TOKENS is then a lower bound; COST is null.                                                                       |
| Cost authority per query: `'reported'` only on the direct Anthropic route; every translated/custom base URL (Ollama Cloud, OpenRouter, Codex/OpenAI translation proxy) is `'unreported'` and priced from the rate card per model id | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:65-80`; `session-stats-owner.service.ts:52-59, 239-259, 656-669` (transformer)                                    | "COST" is provider-reported only for direct Anthropic runs.                                                       |
| History prefix dollars are ALWAYS rate-card priced (`calculateMessageCost` per model), never the provider's figure                                                                                                                  | `session-usage-aggregator.ts:252-292`                                                                                                                                                                         | A resumed session's COST = estimated prefix + reported live runs.                                                 |
| `totalCost` is `null` whenever any counted model is unpriced (partial sum is never a total)                                                                                                                                         | `rpc-session.types.ts:348-353`; `session-usage-aggregator.ts:279-292`                                                                                                                                         | COST can be unavailable on proxied models missing from the rate card; TOKENS never is (when the snapshot exists). |
| Codex/OpenCode/other CLI lanes are separate processes; the owner only takes SDK results and transcript ledgers of the session                                                                                                       | `session-usage-aggregator.ts:243-250`; owner API `session-stats-owner.service.ts:386-560`                                                                                                                     | Lane spend is in neither TOKENS nor COST. Lanes keep their own guards (Batches 32, 35).                           |

### Other integration points

| Evidence                                                                                                                                  | Location                                                                                                                                                                                                | Implication                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `applyFlagSettings` accepts only `{effortLevel}` today; Batch 23.4 widens it to `{effortLevel?, autoCompactWindow?}`                      | `session-lifecycle-manager.ts:86`; `session-control.service.ts:499`; `batches.md:1462-1469`                                                                                                             | Tighten stage reuses the Batch 23.4 path; no new SDK call.                             |
| `IContextUsagePort` returns `{totalTokens, maxTokens, autoCompactThreshold?, source}` once per turn end (planned)                         | `implementation-plan.md:1245-1246`; `batches.md:1575-1582`                                                                                                                                              | Current threshold for the "already lower" check.                                       |
| PostCompact emits `compactionComplete` with `compactSummary`                                                                              | `compaction-hook-handler.ts:463-469`; `sdk-adapter-events.service.ts:131, 181` (`emitCompactionComplete` / `onCompactionComplete`)                                                                      | Compaction count and the latest summary come from an existing event.                   |
| A6 advisory message `session:contextAdvisory` with `kind: 'rotation-suggested'` and `seedPrompt` (planned)                                | `batches.md:1686-1711`; banner `:1764-1771`; store `:1773-1780`                                                                                                                                         | N8 reuses the message, emitter, notifier and banner by adding a second `kind`.         |
| `compaction.subagentHandoffTokens` default 150,000 (range 50k-1M) is the A5 stop threshold                                                | `implementation-plan.md:430, 1183-1200`                                                                                                                                                                 | It equals the provisional 150k resume limit: reuse the key, no new one.                |
| `stopSubagent(sessionId, taskId)` exists                                                                                                  | `subagent-message-dispatcher.ts:258`                                                                                                                                                                    | Safety stop reuses it (Batch 28 already does).                                         |
| N2: `SubagentCacheInfo {cacheState, effectiveTtl, idleMs}`, `computeSubagentCacheState`; injector lines and status RPC carry it (planned) | `batches.md:2221-2271`                                                                                                                                                                                  | `resumeAdvice` sits next to it.                                                        |
| N6: `MonitoredAgent` gains `contextTokens`, `cacheState`, `usage`, `estimatedCostUsd` (planned)                                           | `batches.md:2431-2438, 2456-2462`                                                                                                                                                                       | Agent card shows the same per-subagent figure the backend budgets.                     |
| `chat:continue` returns `{success:false, error, errorCode?}`; `ChatContinueResult.errorCode` is `RpcUserErrorCode`                        | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:759-795`; `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:162-170`; `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:7` | The limit block is a structured `errorCode`, not a thrown error.                       |
| `ChatStartParams.prompt` starts a new session with a first prompt                                                                         | `rpc-chat.types.ts:44-46`                                                                                                                                                                               | "Continue in new session" needs no new start RPC.                                      |
| File-based settings set and defaults                                                                                                      | `libs/backend/platform-core/src/file-settings-keys.ts:154, 456`                                                                                                                                         | New keys go here (ConfigManager file store), served by the 6b `compaction:*` RPC.      |
| The summary is bound in `chat-view.component.html:27-31` (`[snapshot]`, `[liveModelStats]`, `[compactionCount]`)                          | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:27-31`                                                                                                                        | The budget input is added on the same element.                                         |
| No weighted-token helper exists in `shared`, `agent-sdk` or `scripts/agent-usage`                                                         | grep for `weighted` (no hits)                                                                                                                                                                           | One pure helper is created; it is used only by the fallback and the per-subagent stop. |

### Calibration numbers (from context.md § Handoff and the user's chat)

- Last session: 177M cache-read, 7.7M cache-write, 1.1M output, 1,075 requests. Raw TOKENS ≈ 186M (+ uncached input,
  small). Weighted ≈ 17.7M + 9.6M (cache write ×1.25) + 5.5M ≈ 33M (≈38M if all cache writes were 1h at ×2).
  Weighted/raw ≈ 0.18.
- User's chat: TOKENS 14.1M ↔ COST $8.96 → $0.64 per 1M displayed tokens for that mix.
- A 50M TOKENS budget therefore equals ≈ 9M weighted and ≈ $32 at that mix. The last session would have reached
  50M TOKENS after roughly a quarter of its requests.

## Architecture decision

- Chosen approach: one backend `SessionBudgetService` in `agent-sdk` that evaluates the SAME `SessionStatsEntry` object
  the stream transformer hands to `onResultStats` (and the webview receives). It reads `tokenCount` (unit `tokens`) or
  `totalCost` (unit `cost`). It never sums anything itself. The weighted formula is used only when the unit is `cost`
  and `totalCost` is `null`. Stage actions reuse Batch 23.4 (live window), A8/A6 events and banner, A5 stop, and N2
  cache state. Per-subagent budgets live in the A5 `SubagentBudgetMonitor`, and the agent card shows that same figure.
- Rationale: the user requires one figure ("the limit and the chat display can never disagree"). The snapshot is
  already the single authority (`session-stats-owner.service.ts:1-3`), is lifetime-correct across resumes, and is
  published per turn.
- Rejected alternatives:
  - A main-loop-only counter (summing the per-turn `usage`, `stream-transformer.ts:687-688`): it would be a second
    counter that disagrees with TOKENS by exactly the subagent spend. Rejected by the coordinator message.
  - Reading the ledger directly per turn: the ledger is the restart path of the same aggregator; reading it live
    duplicates the owner and re-reads JSONL each turn.
  - A model-written handoff (an extra model request at 80%): adds spend in a token-burn task and can fail or
    hallucinate. Deterministic assembly is chosen (Decision 3 lets the user override).
  - Writing `handoff.md` into the workspace (`<cwd>/.ptah/handoffs/`): `.ptah/**` is git-ignored here
    (`.gitignore:135`) but not in user repositories, so it would create untracked files in users' repos. The handoff
    goes under `~/.ptah/handoffs/` (same home-dir root as `platform-core/src/content-download.service.ts:98`).
  - A new banner component: A6's banner (Batch 31) already has the "start a new session from a seed" action.
- Assumptions (each with its check):
  - AS-B1: Batch 23.4 `applyFlagSettings({autoCompactWindow})` changes the threshold of a live query. Check: Batch 23
    spec plus E2 result in `research-report.md`. If E2 failed for the class, tighten is a logged no-op (see failure
    behaviour).
  - AS-B2: forwarded subagent assistant messages carry per-request `usage` (A5's AS10, `batches.md:1649`). If not, the
    per-subagent budget is `null` and advice falls back to cache state only.
  - AS-B3: `SessionStatsEntry.tokenCount` is always set by the owner (`session-usage-aggregator.ts:432`). Check: owner
    spec asserts it; the evaluator treats `undefined` as "unknown", never 0.
  - AS-B4: `chat:continue` is the only path that sends a NEW user turn to an idle SDK session; mid-turn follow-ups go
    through `surface-submit-turn.service.ts`. Check: grep both for `sdkAdapter.send*` callers before Batch 55.
- Effect on existing code: no change to the owner, aggregator, ledger, transformer arithmetic or the summary's
  existing figures. A6's payload gains a second `kind`; A5's monitor gains a weighted total and a second stop reason;
  N2's status gains three fields; the summary gains an optional `budget` input.

## Component specifications

### 1. Shared budget contracts and pure helpers

- Purpose: one set of types and two pure functions used by backend and UI.
- Responsibilities:
  - `SessionBudgetUnit = 'tokens' | 'cost'`; `SessionBudgetStage = 'unknown' | 'normal' | 'tighten' | 'handoff' | 'limit'`.
  - `SessionBudgetState = { sessionId; stage; unit; measure: 'tokens' | 'cost' | 'weighted-fallback'; used: number | null;
limit: number; percent: number | null; lowerBound: boolean; compactions: number; extensions: number;
window?: { target: number; applied: boolean; reason?: 'env-override' | 'not-supported' | 'already-lower' | 'failed' };
handoff?: { path: string | null; chars: number; truncated: boolean; writtenAt: number; writeError?: string };
blocked: boolean; dismissedStage?: SessionBudgetStage }`.
  - `weightedTokens({input, output, cacheRead, cacheCreation}, cacheWriteWeight: 1.25 | 2): number` = input×1 +
    cacheCreation×w + cacheRead×0.1 + output×5. Pure; no rounding beyond integer.
  - `computeSubagentResumeAdvice({cacheState, contextTokens, contextLimit, budgetUsed, budgetLimit, stopped})` →
    `{ advice: 'resume' | 'fresh'; reason: 'warm-small' | 'cold' | 'context-over-limit' | 'budget-over-limit' |
'stopped' | 'cache-only' }`. Rule: `stopped` → fresh; `cold` → fresh; `contextTokens ≥ contextLimit` → fresh;
    `budgetLimit > 0 && budgetUsed ≥ budgetLimit` → fresh; warm and both known and below → resume `warm-small`; warm
    with unknown context/budget → resume `cache-only`.
  - `SESSION_BUDGET_REACHED` added to `RpcUserErrorCode`.
  - A6 payload (Batch 29.1) widened to a union: existing `{kind:'rotation-suggested', ...}` plus
    `{kind:'budget-stage', sessionId, state: SessionBudgetState, seedPrompt?: string}`.
  - RPC types: `session:getBudgetState {sessionId} → {state: SessionBudgetState | null}`;
    `session:budgetAction {sessionId, action: 'dismiss' | 'extend' | 'restore-window' | 'write-handoff'} →
{success, state?, error?}`; `session:getHandoff {sessionId} → {content: string | null; path: string | null}`.
  - `compaction:getConfig` / `setConfig` types gain the keys in the settings table below.
- Verified contracts: `rpc-error-codes.types.ts:7`; `rpc-chat.types.ts:162-170`; method map and
  `RPC_METHOD_ENTRIES` in `libs/shared/src/lib/types/rpc.types.ts` (registry at `:3665` per plan 6b `:822`).
- Dependencies: none (shared is the leaf).
- Failure behaviour: helpers are total; `weightedTokens` rejects non-finite input by returning `null` (caller treats as
  unknown).
- Quality: no `any`; every union exhaustively switched in specs.
- Verification seam: unit specs for both helpers (each advice reason; weights 1.25 and 2; the "33M" calibration row
  as a fixture: 177M/7.7M/1.1M → 32.8M at ×1.25).
- Files:
  - CREATE `libs/shared/src/lib/types/session-budget.types.ts`, `libs/shared/src/lib/utils/session-budget.utils.ts` (+ spec),
    `libs/shared/src/lib/types/rpc/rpc-session-budget.types.ts`.
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`,
    `libs/shared/src/lib/types/rpc/rpc-compaction.types.ts` (Batch 16.1 file), `libs/shared/src/lib/types/sdk-hook.types.ts`
    (Batch 29.1 payload), the shared barrel exports.

### 2. Settings keys (file store) and their RPC

- Purpose: user-editable budgets, validated before write, host-independent.
- Keys (all `ptah.` file-based, added to `FILE_BASED_SETTINGS_KEYS` / `_DEFAULTS`, `file-settings-keys.ts:154, 456`):

| Key                                              | Type / range                                                                   | Default                                                | Evidence for default                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| `compaction.sessionBudgetEnabled`                | boolean                                                                        | `true`                                                 | Decision 10 asks for budgets on                         |
| `compaction.sessionBudgetUnit`                   | `'tokens' \| 'cost'`                                                           | `'tokens'` (Decision 1)                                | user target is "about 50M raw tokens"                   |
| `compaction.sessionBudgetTokens`                 | integer 1,000,000-2,000,000,000                                                | `50000000`                                             | user target                                             |
| `compaction.sessionBudgetUsd`                    | number 0.5-10,000                                                              | `30`                                                   | 50M × $0.64/M from the user's 14.1M ↔ $8.96             |
| `compaction.sessionBudgetFallbackWeightedTokens` | integer 100,000-500,000,000                                                    | `9000000`                                              | 50M × 0.18 (last session weighted/raw)                  |
| `compaction.budgetTightenPercent`                | integer 10-95                                                                  | `50`                                                   | decision 10                                             |
| `compaction.budgetHandoffPercent`                | integer 20-99, must be > tighten                                               | `80`                                                   | decision 10                                             |
| `compaction.budgetHandoffAfterCompactions`       | integer 1-20                                                                   | `3`                                                    | decision 10                                             |
| `compaction.budgetTightenWindowTokens`           | integer 100,000-1,000,000 (same bounds as `compaction.threshold`, plan `:835`) | `120000`                                               | 60% of the A1 class default 200,000 (plan `:1140-1141`) |
| `compaction.budgetBlockAtLimit`                  | boolean                                                                        | `true`                                                 | decision 10 "no new requests"                           |
| `compaction.subagentStopWeightedTokens`          | integer 0 (off) or 100,000-100,000,000                                         | `3000000` provisional; final from Batch 50 calibration | decision 10                                             |
| (reused) `compaction.subagentHandoffTokens`      | existing 50,000-1,000,000                                                      | existing `150000`                                      | doubles as the resume context limit                     |

- Responsibilities: `CompactionRpcHandlers` (6b) validates every new key (range, the tighten < handoff cross-field rule,
  enum) before any write and rejects with the field and range; `CompactionConfigProvider` returns the new keys;
  hand-edited invalid values read as unset → default (existing behaviour `compaction-config-provider.ts:62-76`).
- Dependencies: Batches 16-17 (the 6b handler and provider exist).
- Failure: invalid write → `{success:false, error:'<field>: must be <range>'}`, nothing written.
- Verification seam: handler spec (each bound, cross-field rule, round-trip), provider spec (defaults, invalid → default).
- Files: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/compaction-rpc.handlers.ts` (+ spec),
  `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (+ spec).

### 3. `SessionBudgetService` (agent-sdk) — N7 session budget + N8 stage machine

- Purpose: per session, map the displayed figure to a stage and run each stage's action once.
- Responsibilities:
  - `observe(sessionId, snapshot: SessionStatsEntry | undefined)`: called from the `onResultStats` wrapper with the SAME
    `sessionStats` object the webview receives. Measure:
    - unit `tokens`: `used = snapshot.tokenCount`; `undefined` → stage `unknown`.
    - unit `cost`: `used = snapshot.totalCost`; when `null` → `measure: 'weighted-fallback'`,
      `used = weightedTokens(snapshot.tokens, 1.25)`, `limit = sessionBudgetFallbackWeightedTokens`.
    - `lowerBound = snapshot.coverage === 'partial'`.
    - limit = configured limit × (1 + 0.2 × extensions).
  - Stage = highest of: by percent (`<tighten` normal, `≥tighten` tighten, `≥handoff` handoff, `≥100` limit) and
    `handoff` when `compactions ≥ budgetHandoffAfterCompactions`. Stages only rise, except after `extend` or a settings
    change, when they are recomputed from the new limit.
  - `onCompactionComplete` (existing event `sdk-adapter-events.service.ts:181`) increments `compactions` and stores
    `compactSummary` in the facts collector (component 4). Only completed compactions count; A8 BACKOFF does not.
  - Actions, each once per stage entry:
    - tighten: target = `budgetTightenWindowTokens`. Skip with `reason` when the A1 source is `env`
      (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` wins, plan `:1128-1129`), when A8 is OBSERVE_ONLY (`not-supported`), or when
      the port's `autoCompactThreshold` is already ≤ target (`already-lower`). Else call the Batch 23.4
      `applyFlagSettings({autoCompactWindow: target})` through the session lifecycle.
    - handoff: ask component 4 to write the handoff; store `handoff` in the state.
    - limit: rewrite the handoff (fresh facts), set `blocked = budgetBlockAtLimit`.
  - Emit `session:contextAdvisory {kind:'budget-stage', state, seedPrompt}` through the A6 emitter (Batch 29.3) on each
    stage change, including back to `normal` after `extend` (clears the banner). Log one INFO line per change:
    `[SessionBudget] <sessionId> <from>→<to> used=<n> limit=<n> measure=<m>`.
  - `canSend(sessionId)`: `{ ok: true } | { ok: false, state }`. `unknown` and missing state → ok.
  - `act(sessionId, action)`: `dismiss` (sets `dismissedStage` = current; banner hidden until the next stage),
    `extend` (only in `limit`; extensions++; INFO log), `restore-window` (re-applies the configured
    `compaction.threshold`, or the class default when none), `write-handoff` (manual write now).
  - `release(sessionId)` on session end and `clearAll()` on disposal.
- Verified contracts: owner snapshot shape `rpc-session.types.ts:343-393`; wrapper `sdk-agent-adapter.ts:1581-1591`;
  session end `sdk-agent-adapter.ts:1391-1395`; events `sdk-adapter-events.service.ts:131, 181`.
- Dependencies (direction agent-sdk internal only): `CompactionConfigProvider`, `IContextUsagePort` and
  `CompactionCoordinator` state (Batch 26), session lifecycle `applyFlagSettings` (Batch 23.4), A6 emit (Batch 29.3),
  component 4. No dependency on the frontend, rpc-handlers or vscode-core.
- Integration points: rpc-handlers reads `canSend` / `getState` / `act` through a new `SDK_SESSION_BUDGET` token (same
  pattern as `SDK_SESSION_STATS_READER` injected in `session-rpc.handlers.ts:160`).
- Failure behaviour:
  - no snapshot (`null`, prefix read in flight, or no owner): stage `unknown`; no action; never blocks.
  - stats late: evaluation waits for the next `result`; at most one turn of overshoot past 100% (no interrupt of a
    running turn; documented in the limit text as "after this turn").
  - `totalCost` null with unit `cost`: weighted fallback, labelled.
  - tighten call throws: `window.applied=false, reason:'failed'`, WARN once; stage still advances.
  - handoff write fails: content stays in memory; `handoff.writeError` set; WARN once; the continue action still works.
  - settings unreadable: defaults (provider behaviour).
- Quality: no timers, no polling; state map bounded by live sessions and released on session end.
- Verification seam: pure stage function spec (every boundary 49.9/50/79.9/80/99.9/100, compaction trigger, lower bound,
  extend, unit switch, fallback); service spec with fakes for lifecycle, port, emitter, writer (each action once, each
  failure path, release).
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/session-budget-stage.ts` (pure, + spec),
  `libs/backend/agent-sdk/src/lib/helpers/compaction/session-budget.service.ts` (+ spec).

### 4. Handoff facts collector and writer (agent-sdk) — N8 `handoff.md`

- Purpose: a deterministic, bounded handoff with no extra model call.
- Location: `~/.ptah/handoffs/<sessionId>.md` (UUID session ids; outside the user's repository). Written atomically
  (write `<file>.tmp`, then rename) with `fs/promises` (existing agent-sdk pattern, e.g.
  `helpers/attachment-processor.service.ts:7`). Overwritten on each write for that session.
- Writer: Ptah (backend), on entering `handoff`, again on `limit`, and on the manual `write-handoff` action.
- Facts (per session, in memory, each bounded), fed from stream messages by the executor (same feed as Batch 28.3):
  - goal: the session's first user prompt text (≤1,000 chars);
  - decisions/state: the latest `compactSummary` (≤2,500 chars), else "No compaction summary yet.";
  - changed files: unique `file_path` / `notebook_path` inputs of Edit, Write, MultiEdit, NotebookEdit tool uses from
    the main loop and subagents (≤50 paths, then "+N more");
  - open items: the latest TodoWrite list, items not `completed` (≤20);
  - next action: first `in_progress` todo, else first `pending`, else the last assistant text (≤800 chars);
  - task folders: matches of `\.ptah[\\/]specs[\\/]TASK_\d{4}_\d{3}[\w-]*` in user prompts and tool inputs (≤5).
- Schema (Markdown, fixed section order; total cap 8,000 chars; a section over its cap ends with `[truncated]`):

```
# Session handoff
- Session: <sessionId> | Written: <ISO time> | Stage: handoff|limit
- Budget: <used> of <limit> <unit label> (<percent>%)
- Task folders: <paths or "none found">
## Goal
## Decisions and current state
## Changed files
## Open items
## Next action
## How to continue
Continue this work from this handoff. Read the task folder files listed above for detail; do not re-read files you do not need.
```

- Seed prompt for the new session: `Continue from the handoff of session <sessionId> (saved at <path>).\n\n<handoff>`
  (≤8,200 chars; sent as `ChatStartParams.prompt`).
- After an app restart the collector is empty for a resumed session; the handoff then states "Earlier facts are not
  available after a restart; see session <id>." (Assumption AS-B5: seeding from the transcript is deferred; resolve at
  Gate 2 only if the user asks.)
- Failure: write error → returned to component 3 (content kept); collector errors are caught per message and logged
  once (fail-open; the chat stream is never affected).
- Verification seam: collector spec (each fact type, caps, dedupe, subagent tool uses), renderer spec (golden text,
  8,000 cap, truncation markers), writer spec with a temp dir (atomic rename, failure surfaces).
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/handoff-facts-collector.ts`,
  `session-handoff-renderer.ts`, `session-handoff-writer.ts` (+ specs), same folder.

### 5. agent-sdk wiring

- Responsibilities: tokens `SDK_SESSION_BUDGET`, `SDK_HANDOFF_FACTS_COLLECTOR`; register; `wrapResultStatsForActivity`
  (`sdk-agent-adapter.ts:1581`) also calls `sessionBudget.observe(sessionId, stats.sessionStats)`; session end
  (`:1391-1395`) calls `release`; the executor feeds stream messages to the collector (next to the Batch 28.3 monitor
  feed); `onCompactionComplete` subscription registered once in the service constructor with its unsubscribe on dispose.
- Failure: `observe` is wrapped so an exception logs once and never breaks `onResultStats`.
- Verification seam: adapter spec (observe receives the identical object passed to the inner callback; release on
  end); executor spec (collector fed).
- Files: MODIFY `libs/backend/agent-sdk/src/lib/di/tokens.ts`, `libs/backend/agent-sdk/src/lib/di/register.ts`,
  `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (+ specs).

### 6. Subagent budget and resume advice (agent-sdk monitor) — N7 subagent part

- Purpose: per subagent, the context and spend the main agent needs to choose resume vs fresh, plus a safety stop.
- Responsibilities (extends Batch 28 `SubagentBudgetMonitor`):
  - Per subagent keep `contextTokens` (last request input + cacheRead + cacheCreation, A5's existing measure) and
    `weightedUsed` (Σ `weightedTokens` per request, deduped by `message.id`, cache-write weight from the effective TTL
    of `resolveSubagentPromptCacheTtl`, Batch 37: `1h` → 2, else 1.25).
  - Safety stop: `subagentStopWeightedTokens > 0 && weightedUsed ≥ limit` → the existing stop path (stop, one parent
    message, not resumable) with the text: "Subagent `<type>` was stopped after using <n> weighted tokens (limit <m>).
    Start a fresh subagent with a short brief; its output so far is in the session transcript."
  - `getSubagentBudget(sessionId, agentId)` → `{contextTokens: number | null; budgetUsed: number | null;
budgetLimit: number; stopped: boolean}`.
- Why weighted here and not TOKENS: the session snapshot has no per-subagent split (verified above), so a per-subagent
  figure must come from the monitor in any case; the agent card (Batch 46/47) displays this same backend figure, so
  display and limit still agree. Decision 2 lets the user change this.
- Failure: no usage on forwarded messages → `null` figures, observe-only (A5 behaviour), advice `cache-only`.
- Verification seam: monitor spec (accumulation, dedupe, TTL weight, stop once, `null` path).
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` (+ spec).

### 7. Orchestrator-facing subagent status (rpc-handlers)

- Responsibilities:
  - `chat-subagent-context-injector.service.ts` (Batch 41.1 line) becomes:
    `- <type> (<id>): cache warm|cold (TTL 1h, idle 3 min) · context 82k / 150k · used 1.2M / 3M weighted · advice: resume|fresh (<reason>)`.
    The guidance line becomes: "Resume a subagent only when advice is resume (cache warm and context below the limit).
    Otherwise start a fresh subagent with a short brief."
  - `subagent-rpc.handlers.ts` (Batch 41.2) adds optional `budget {contextTokens, budgetUsed, budgetLimit}` and
    `resumeAdvice {advice, reason}` next to `cacheInfo`.
  - Advice computed with `computeSubagentResumeAdvice` (component 1); context limit = `compaction.subagentHandoffTokens`.
- Dependencies: rpc-handlers → agent-sdk token `SDK_SUBAGENT_BUDGET_MONITOR` (Batch 28.3) and shared helper.
  CLI lanes are unchanged (they keep Batch 32's gate).
- Failure: monitor missing a subagent → fields omitted; advice from cache state only.
- Verification seam: injector spec (line text for each reason), RPC spec (optional fields).
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` (+ specs), `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
  (optional fields).

### 8. Send gate and budget RPC (rpc-handlers)

- Responsibilities:
  - `chat:continue` (`chat-session.service.ts:759`), after the Ptah CLI branch (`:792-794`) and before resume/send:
    when `canSend` is not ok, return `{success:false, errorCode:'SESSION_BUDGET_REACHED', error:<limit text>}`.
    Native slash commands (`/compact`, `/clear`, … `slash-command-interceptor.ts` `NATIVE_COMMANDS`) pass, so the user
    can still compact. The same check on the mid-turn follow-up path in `surface-submit-turn.service.ts` if AS-B4 shows
    it sends new user turns.
  - New `SessionBudgetRpcHandlers`: `session:getBudgetState`, `session:budgetAction`, `session:getHandoff`; input
    validated with zod (session id string, action enum); registered in `register-shared-rpc-handlers.ts`.
- Failure: budget service missing (host without agent-sdk) → `canSend` ok; RPC returns `{state:null}`.
- Verification seam: chat-session spec (blocked, native slash allowed, unknown passes), handler spec (validation,
  each action).
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.ts` (+ spec); MODIFY
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ spec), possibly
  `surface-submit-turn.service.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`.

### 9. Frontend: banner stages, stats chip budget, settings, agent card

- Banner (reuse Batch 31 `session-rotation-banner`): input becomes the advisory union; `budget-stage` renders the stage
  text below. Buttons call `session:budgetAction` or start a new session with `ChatStartParams.prompt = seedPrompt`
  (sent immediately for "Continue in new session"; A6's rotation keeps "prefill, user sends"). "Preview handoff" opens
  an inline `<details>` with the text rendered as plain text (`<pre>`), fetched lazily via `session:getHandoff`.
  On tab activation the store calls `session:getBudgetState` so a reload restores the banner. OnPush, signals,
  `role="status"` (tighten/handoff) and `role="alert"` (limit).
- Stats chip (`session-stats-summary.component.ts`): new optional input `budget: {unit, limit, stage, lowerBound} | null`.
  The numerator is the component's existing `snapshot().tokenCount` / `totalCost`, so it cannot differ from TOKENS/COST.
  Label: `TOKENS 14.1M / 50M` (or `COST $8.96 / $30`); `≥` prefix when `lowerBound`; colour by stage. Fallback label:
  "est. 6.2M / 9M weighted (this provider reports no cost)".
- Settings: `session-budget-settings.component.ts` beside the Batch 21 card, in its own `@defer (on viewport)`; fields
  from component 2 with inline range messages; state in the Batch 20 services.
- Agent card (Batch 46/47): `MonitoredAgent` maps `budget` and `resumeAdvice` from the backend RPC (no frontend
  recomputation); the header shows "context 82k/150k · 1.2M/3M weighted · resume".
- Files: MODIFY `libs/frontend/chat/src/lib/components/molecules/session-rotation-banner.component.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`,
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` and `.ts`,
  `libs/frontend/core/src/lib/services/providers-settings.types.ts`, `providers-commit.service.ts`,
  `providers-settings-state.service.ts`, `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`,
  `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`,
  `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`, `stats-bar.utils.ts`
  (+ specs); CREATE `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts` (+ spec).

## User-facing text per stage (exact)

Placeholders: `<used>`, `<limit>` formatted like the chip (`14.1M`, `$8.96`); `<unit>` = "tokens" | "of cost" |
"weighted tokens (estimate)".

- Normal (<50%): no banner. Chip tooltip: "Session budget: <percent>% used (<used> of <limit>). At 50% Ptah lowers
  auto-compact; at 80% it prepares a handoff; at 100% new messages pause."
- Tighten (≥50%):
  - Title: "Half of this session's budget is used"
  - Body (applied): "<used> of <limit> <unit>. Ptah lowered auto-compact to <target> tokens for this session, so each
    request resends less context. Start a fresh session for unrelated work."
  - Body (not applied): "<used> of <limit> <unit>. Ptah could not lower auto-compact here (<reason text>). Use /compact
    or start a fresh session to slow the spend." Reason texts: env-override "CLAUDE_CODE_AUTO_COMPACT_WINDOW is set";
    not-supported "this provider does not support it"; already-lower "it is already at or below <target>"; failed
    "the change was rejected".
  - Buttons: "OK" (dismiss), "Restore auto-compact" (only when applied).
- Prepare handoff (≥80% or 3rd compaction):
  - Title: "Time to hand off this session"
  - Body: "<used> of <limit> <unit> (<percent>%)." or "This session has compacted <n> times, and each compaction loses
    detail." then "Ptah saved a handoff with the goal, decisions, changed files, open items and next step. At 100% new
    messages in this session pause."
  - Buttons: "Start new session from handoff" (primary), "Preview handoff", "Keep working" (dismiss).
  - Write failure line: "Ptah could not save the handoff file (<error>). You can still start a new session; the handoff
    text is kept until this session closes."
- Limit (100%):
  - Title: "This session reached its budget"
  - Body: "<used> of <limit> <unit>. New messages here are paused so the context stops growing. Continue in a new
    session that starts with only the handoff (about <handoffChars/4> tokens instead of <contextTokens>)."
  - Buttons: "Continue in new session" (primary), "Preview handoff", "Allow 20% more".
  - Blocked send error (`SESSION_BUDGET_REACHED`): "This session reached its budget (<used> of <limit>). Use “Continue
    in new session” or “Allow 20% more” in the banner. /compact still works."
  - With `budgetBlockAtLimit=false`: same banner, body ends "New messages are not paused (blocking is off in settings)."

## Integration architecture

- Data flow:
  1. SDK `result` → `StreamTransformer` → `SessionStatsOwnerService.replaceRun` → snapshot
     (`stream-transformer.ts:704-746`).
  2. `onResultStats({..., sessionStats})` → adapter wrapper → `SessionBudgetService.observe(snapshot)` and the inner
     callback → `session:stats` → chat summary (same object).
  3. Stage change → action (Batch 23.4 window / handoff writer / block flag) → `session:contextAdvisory
{kind:'budget-stage'}` → `SessionLifecycleNotifier` (Batch 30.1) → webview store → banner.
  4. User clicks → `session:budgetAction` or `chat:start {prompt: seedPrompt}`.
  5. Next `chat:continue` → `canSend` → blocked or sent.
  6. Subagent messages → executor → `SubagentBudgetMonitor` (+ facts collector) → status RPC and injector line →
     orchestrator and agent card.
- State: all budget and handoff state in memory per session, released on session end. The handoff file persists in
  `~/.ptah/handoffs/`. After a restart the snapshot is rebuilt from the transcript (owner contract), so the stage is
  recomputed on the next result; extensions and dismissals reset (the user can extend again).
- External boundaries: settings values validated in the RPC handler; RPC inputs validated with zod; handoff content is
  rendered as text, never HTML; no secret is written (facts are prompts, file paths, todo text, model summaries, the
  same material already in `~/.claude/projects` transcripts).
- Failure and rollback: every step is fail-open except the explicit block. Disabling `compaction.sessionBudgetEnabled`
  removes the block and banners on the next result.
- Observability: INFO per stage change, per extend, per tighten result; WARN once per session for tighten failure,
  handoff write failure and observe errors.

## Architecture-level quality requirements

- Functional: for any session, `state.used` equals the chat's TOKENS (unit tokens) or COST (unit cost) for the same
  revision; a 100% crossing blocks the next `chat:continue` but not `/compact`; "Continue in new session" starts a tab
  whose first prompt is the handoff only.
- Performance: one stage evaluation per SDK result (O(1)); no timers or polling; facts bounded (caps above).
- Security: no HTML rendering of handoff text; file under the user's home dir; atomic write.
- Maintainability: no new counter; shared types in `shared`, services in `agent-sdk`, RPC in `rpc-handlers`, no
  vscode-core changes; Angular OnPush + signals.
- Testability: pure stage and advice functions carry the logic; services tested with fakes; one parity spec asserts
  `observe` receives the identical object the webview callback receives.

## Suggested batch split (numbering continues at 50)

| Batch | Scope                                                                                                                                                                                                            | Executor           | Depends on                                                                    | Verify (scoped)                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 50    | M: weighted per subagent and p50/p95 per type in `--subagents`; record the calibration in `measurements/s9-subagent-baselines.md` (default = p95 × 1.5 rounded to 0.5M, floor 3M unless the data says otherwise) | backend-developer  | 36                                                                            | `npm run test:scripts`                                                                                             |
| 51    | Component 1 + component 2 keys in `platform-core`                                                                                                                                                                | backend-developer  | 16, 29.1, 40                                                                  | `nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/platform-core` + three-app typecheck |
| 52    | Components 3 and 4 (new files) + provider keys                                                                                                                                                                   | backend-developer  | 23, 26, 29, 51                                                                | `-p @ptah-extension/agent-sdk`                                                                                     |
| 53    | Component 5 wiring                                                                                                                                                                                               | backend-developer  | 27, 28, 52                                                                    | `-p @ptah-extension/agent-sdk`                                                                                     |
| 54    | Component 6 (monitor)                                                                                                                                                                                            | backend-developer  | 28, 37, 51; serial with 53 only if both touch the executor feed (they do not) | `-p @ptah-extension/agent-sdk`                                                                                     |
| 55    | Component 8 + compaction RPC keys                                                                                                                                                                                | backend-developer  | 17, 30, 53                                                                    | `-p @ptah-extension/rpc-handlers` + three-app typecheck                                                            |
| 56    | Component 7                                                                                                                                                                                                      | backend-developer  | 41, 54                                                                        | `-p @ptah-extension/rpc-handlers @ptah-extension/shared` + three-app typecheck                                     |
| 57    | Settings state (frontend core)                                                                                                                                                                                   | frontend-developer | 20, 51                                                                        | `-p @ptah-extension/core`                                                                                          |
| 58    | Settings card                                                                                                                                                                                                    | frontend-developer | 21, 57                                                                        | `-p @ptah-extension/chat`                                                                                          |
| 59    | Banner stages + store + new session from handoff                                                                                                                                                                 | frontend-developer | 31, 55                                                                        | `-p @ptah-extension/chat` (visual-reviewer dark + light)                                                           |
| 60    | Stats chip budget input + chat-view binding                                                                                                                                                                      | frontend-developer | 51, 59 (same `chat-view` area; serial)                                        | `-p @ptah-extension/chat-ui @ptah-extension/chat`                                                                  |
| 61    | Agent card budget and advice                                                                                                                                                                                     | frontend-developer | 47, 56                                                                        | `-p @ptah-extension/chat-streaming @ptah-extension/chat`                                                           |

- Parallel-safe: 50 with all; 54 with 52-53 (file-disjoint: the monitor file only); 56 with 55; 57-58 with 52-56.
- QA (senior-tester, within the decision 6/7 run budget): one scripted session with a lowered budget
  (`sessionBudgetTokens = 2,000,000`) that walks normal → tighten → handoff → limit; assert chip = state, block works,
  `/compact` passes, new session starts with only the handoff; one proxied-route run with unit `cost` to see the
  fallback label.

## Team-leader handoff

- Recommended executors: backend-developer for 50-56 (agent-sdk/rpc-handlers/shared); frontend-developer for 57-61.
- Complexity: HIGH overall (stage machine across four libraries and live session plumbing); each batch MEDIUM or LOW.
- Dependencies: component level only — 1 before everything; 3 needs 23.4, 26 and 29; 5 needs 3-4; 7 needs 6 and 41;
  8 needs 5; 9 needs 8 and 31.
- Files affected: CREATE 11 (listed per component), MODIFY about 30 (listed per component).
- Verification points: confirm AS-B1..AS-B4 before Batches 52/55; parity spec (identical snapshot object); no
  `undefined` → 0 coercion; `.ptah/handoffs` never created inside a workspace.

## Decisions for the user

1. Session budget unit.
   - TOKENS as displayed (Recommended): always present when the chat shows stats, works on every provider, matches
     your "about 50M" target; default 50,000,000. It counts cache-read at full weight, so it tracks context resent
     per request rather than dollars.
   - COST as displayed: closest to money; default $30 (from your 14.1M ↔ $8.96). Only direct-Anthropic runs are
     provider-reported; history and proxied runs are rate-card estimates; unpriced models make it unavailable and the
     weighted fallback (default 9M) applies.
   - Weighted tokens: not shown anywhere in the chat today, so it would be a second figure; offered only as the
     fallback.
2. Subagent spend in the session limit. Your note said subagents should not count by default, but the chat's TOKENS
   and COST already include them, and live data cannot separate them.
   - Count the figure as displayed, subagents included (Recommended): one figure, display and limit agree.
   - Exclude subagents: needs a second, main-loop-only counter that will not match the chat.
3. How the handoff is written.
   - Deterministic, from session facts, no model call (Recommended): free, cannot fail on the model, capped at 8,000
     chars.
   - Deterministic plus an optional "Improve with model" button that spends one extra request.
4. At 100%.
   - Pause new messages, with "Allow 20% more" and "Continue in new session" (Recommended).
   - Banner only, never pause.
   - Pause with no override.
