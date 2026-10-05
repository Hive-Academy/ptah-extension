# Implementation Plan Addendum - TASK_2026_597 - N7 budgets, N8 handoff workflow (revision 2)

Status: draft for Gate 2 (follow-up task, decision 11). Revision 2 resolves the REVISE review
(`implementation-plan-addendum-review.md`, F1-F15). Nothing is decomposed into batches before the user answers
`## Gate 2 decisions`. All line references are verified on branch `fix/task-597-followups` (HEAD `5bb19f9fb`, which
contains PR #634 merge `f314a4f8a`).

## Inputs and constraints

- Requirements used: `context.md` § User Decisions item 2 (A1 gated on E2), item 9 (N7, N8), item 11 (follow-up task,
  risk-based review); the review file (F1-F15); `research-report.md:96, 100` (E2, PostCompact).
- Corrections applied: "one figure, the one the chat shows" (coordinator, kept from revision 1). The weighted formula
  is a fallback only where no dollar figure exists.
- Revision 1 state: the file was unmodified by the stopped revision-2 run; this revision replaces it in place.
- Out of bounds (TASK_2026_609): agent-generation services and templates, `.claude/agents`, and the system-prompt parts
  of `sdk-query-options-builder.ts`. This plan touches none of them. Shared file with 609:
  `libs/backend/platform-core/src/file-settings-keys.ts` (append-only additions here).
- Missing decision-critical input: none. Four choices go to the user.

## What PR #634 shipped and what this addendum depends on

| Batch                        | State on main                                                                      | Used here?         | How                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| 23 (A1 machinery)            | Shipped `65aed6387`: `A1_DEFAULT_WINDOW` all `null`, live `applyAutoCompactConfig` | Yes                | `resolveAutoCompactControl` and the live `applyFlagSettings({autoCompactWindow})` path (component 4) |
| 42-44 (N3), 48-49 (N5)       | Shipped                                                                            | No                 | Unrelated                                                                                            |
| 16-17, 20-21 (6b settings)   | DEFERRED                                                                           | No                 | Budget keys use the existing file store plus `settings:get/set` instead                              |
| 26-27 (A8 coordinator, port) | DEFERRED                                                                           | No                 | Tighten reads `getContextUsage` itself; no `IContextUsagePort`                                       |
| 28 (A5 subagent monitor)     | DEFERRED                                                                           | Subagent part only | Component 10 waits for it (Decision 2)                                                               |
| 29-31 (A6 advisory, banner)  | DEFERRED                                                                           | No                 | Budget state rides the existing `session:stats` broadcast; a new budget banner is built here         |
| 36 (M subagent views)        | DEFERRED                                                                           | Subagent part only | Calibrates the safety-stop default                                                                   |
| 37-39 (N1 TTL)               | DEFERRED                                                                           | Subagent part only | Cache-write weight per subagent                                                                      |
| 40-41 (N2 cache state)       | DEFERRED                                                                           | Subagent part only | warm/cold input of resume advice                                                                     |
| 46-47 (N6 agent card)        | DEFERRED                                                                           | Subagent part only | Display of the per-subagent figure                                                                   |

Result: the session budget and the handoff workflow (components 1-9) depend only on code already on main. Everything
per-subagent (component 10) is a contract that is built with or after Batches 28, 36, 37 and 40-41.

## Codebase evidence

### The figure the chat shows (single source)

| Evidence                                                                                                                                 | Location                                                                                                                                                                                                        | Implication                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TOKENS chip = `snapshot().tokenCount`; COST = `snapshot().totalCost`; `knownCost` labelled subtotal when `pricingCoverage === 'partial'` | `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:669, 761, 768-776, 790-794`                                                                                                 | The budget numerator is these two fields of the same object.                                                             |
| The chip's `[snapshot]` is `tab.sessionStats`                                                                                            | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:27-31`; `chat-view.component.ts:773-777`                                                                                              | One per-tab slot.                                                                                                        |
| Live install: `session:stats` → `installSessionStats` (revision guard)                                                                   | `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:113-158`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2196-2209`                                               | Lower revisions are dropped; the budget must apply the same rule (F5).                                                   |
| Resume install: `chat:resume.stats` → `applyLoadedSessionStats`                                                                          | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1033`; `tab-manager.service.ts:2216-2237`                                                                                             | Second entry path (F2).                                                                                                  |
| Resume stats = owner snapshot when an owner exists, else transcript aggregate                                                            | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1002-1016`; called via `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:50-66` from `chat-session.service.ts:963` | The backend sees the resume figure at `readForResume`.                                                                   |
| Broadcast forwards `sessionStats` unchanged; absent → panel keeps the last one                                                           | `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:400-418`                                                                                                                                        | Absent ≠ unknown (F5).                                                                                                   |
| Snapshot producer: `publish()` returns a frozen object, prefix + Σ runs                                                                  | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:16-20, 652-700`                                                                                                                    | No second counter needed.                                                                                                |
| `snapshot()` is `null` with no owner or a prefix read in flight                                                                          | `session-stats-owner.service.ts:562-572`                                                                                                                                                                        | Defined "no figure" state.                                                                                               |
| Owner keyed by provisional tab key until `rebind`                                                                                        | `session-stats-owner.service.ts:381-391, 446-453`                                                                                                                                                               | Key budget state by the snapshot's `sessionId` (F1).                                                                     |
| `'reported'` cost: per-model `usage.costUSD` and `total_cost_usd` on direct Anthropic; `'unreported'` routes priced from the rate card   | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:579-600, 656-669`; `session-lifecycle/session-query-executor.service.ts:65-80`; owner `:52-59, 239-273`                                           | COST is provider-reported only on the direct route; history prefix is rate-card (`session-usage-aggregator.ts:252-292`). |
| `modelUsage` is cumulative per query, subagents included; `usage` is main-loop only                                                      | `stream-transformer.ts:653-655, 684-689`                                                                                                                                                                        | TOKENS/COST include Task-subagent spend live.                                                                            |
| Result order: `onTurnEnd` (releases held follow-up) BEFORE pricing awaits and `onResultStats`                                            | `stream-transformer.ts:513-516, 585-587, 788-791`; `sdk-agent-adapter.ts:1598-1602`; `session-registry.service.ts:516-530`                                                                                      | A held follow-up is sent before the crossing figure is known (F7).                                                       |
| `effectiveSessionId` becomes the SDK id at `system/init`                                                                                 | `stream-transformer.ts:393, 472-474, 775`                                                                                                                                                                       | `stats.sessionId` is the real id at result time.                                                                         |
| Wrapper id is the tab-derived `trackingId` for new sessions                                                                              | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:693, 796-800, 1581-1591`                                                                                                                                   | Never key by the wrapper id (F1).                                                                                        |
| `SessionStatsEntry`: `totalCost` null unless pricing full; `knownCost`; `tokenCount?`; `coverage`; `pricingCoverage: 'full'              | 'partial'                                                                                                                                                                                                       | 'none'`; `revision?`                                                                                                     | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:343-424, 436-439` | Measure rules in component 3. |

### Other integration points

| Evidence                                                                                                                                 | Location                                                                                                                                                                                                                                                | Implication                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `applyFlagSettings({effortLevel?, autoCompactWindow?: number \| null})`; `null` clears the key                                           | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:88-96`                                                                                                                                                                             | Restore = send the configured window or `null` (F14).                                     |
| Live apply loops over ALL live sessions with a timeout; never throws                                                                     | `session-lifecycle/session-control.service.ts:532-598`                                                                                                                                                                                                  | A settings change would overwrite a per-session tighten; needs an override (component 4). |
| `A1_DEFAULT_WINDOW = {claude: null, proxied: null}` until E2 passes; env wins                                                            | `helpers/auto-compact-control.ts:51-69, 166-203`                                                                                                                                                                                                        | Tighten must not assume the window is honoured.                                           |
| E2: source-level yes; live check = `getContextUsage().autoCompactThreshold` follows the window; proxied ids unproven                     | `research-report.md:96`; SDK `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2852, 3807`                                                                                                                                                          | Tighten verifies by read-back.                                                            |
| `getContextUsage` absent from Ptah's structural query mirror                                                                             | `session-lifecycle-manager.ts:80-104` (no member); grep in `libs/backend` (no hits)                                                                                                                                                                     | Add one member to the mirror.                                                             |
| `compact_boundary` is seen in the main stream; it carries no `parent_tool_use_id`                                                        | `stream-transformer.ts:795-797`; `claude-sdk.types.ts:356-364`; `sdk.d.ts:3530-3536`                                                                                                                                                                    | Count compactions here (F8).                                                              |
| PostCompact missed in four August auto events                                                                                            | `research-report.md:100`                                                                                                                                                                                                                                | Not the counting source.                                                                  |
| The chat's compaction count is per-tab memory, reset on load                                                                             | `compaction-lifecycle.service.ts:524-531`; `tab-manager.service.ts:1201, 2336`                                                                                                                                                                          | Both counts reset on restart; documented.                                                 |
| `NATIVE_COMMANDS = new Set(['clear'])`; `/compact` goes to the SDK via the slash router                                                  | `libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:37`; `chat-session.service.ts:836-873`                                                                                                                                             | Explicit allowlist (F3).                                                                  |
| `chat:continue` returns structured failures; Ptah CLI branch first                                                                       | `chat-session.service.ts:759-795`; `rpc-chat.types.ts:162-170`; `rpc-error-codes.types.ts:7`                                                                                                                                                            | Gate returns `errorCode`.                                                                 |
| Frontend handles `errorCode` on send results                                                                                             | `libs/frontend/chat/src/lib/services/message-sender.service.ts:97-111`                                                                                                                                                                                  | Same pattern for the budget code.                                                         |
| Other turn sources: surface submits, Ptah CLI                                                                                            | `chat/session/surface-submit-turn.service.ts:298`; `chat/ptah-cli/chat-ptah-cli.service.ts:274`                                                                                                                                                         | Not gated (accepted risk, below).                                                         |
| RPC manifest invariant "Total" and method registry                                                                                       | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:14-18, 283-295`; `libs/shared/src/lib/types/rpc.types.ts:785, 3695, 4157`; specs `rpc-allowlist.spec.ts`, `apps/*/src/di/rpc-surface.spec.ts`, `cli-engine/src/lib/rpc/rpc-surface.spec.ts` | New method, handler, manifest and specs land together (F4).                               |
| `settings:get/set` route file-based keys to `~/.ptah/settings.json`; set is allow-listed by `isFileBasedSettingKey`, no value validation | `rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:103-173`; used by `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:261, 280`                                                                                                   | Settings need no new RPC; validation on read (component 2).                               |
| File store key set and defaults                                                                                                          | `libs/backend/platform-core/src/file-settings-keys.ts:154, 460`                                                                                                                                                                                         | New keys here.                                                                            |
| `compaction.*` keys are VS Code contributions only today                                                                                 | grep `compaction.threshold`: `apps/ptah-extension-vscode/package.json`, provider `compaction-config-provider.ts:75-77`                                                                                                                                  | Use a new `sessionBudget.*` namespace, not the deferred 6b move.                          |
| Transcript tail read, bounded, not size-capped                                                                                           | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:239, 554-569`                                                                                                                                                                   | Handoff facts read at write time (restart-safe).                                          |
| Session id guard                                                                                                                         | `UUID_REGEX` `libs/shared/src/lib/types/branded.types.ts:39`, used `session-stats-reader.service.ts:36, 117`                                                                                                                                            | Validate before any path join (F12).                                                      |
| `~/.ptah` home root                                                                                                                      | `libs/backend/platform-core/src/content-download.service.ts:4-8`                                                                                                                                                                                        | Handoff directory root.                                                                   |
| Dumb banner pattern (inputs/outputs, OnPush) and host slot                                                                               | `chat/src/lib/components/molecules/notifications/resume-notification-banner.component.ts`; `chat-view.component.html:127-137`                                                                                                                           | New budget banner follows it.                                                             |
| `ChatStartParams.prompt`; `ChatResumeResult.stats`                                                                                       | `rpc-chat.types.ts:44-46, 268-292`                                                                                                                                                                                                                      | New session from handoff; resume carries budget.                                          |
| `stopSubagent(sessionId, taskId)`                                                                                                        | `helpers/subagent-message-dispatcher.ts:258`                                                                                                                                                                                                            | Used only by component 10.                                                                |

## Architecture decision

- Chosen approach: one `SessionBudgetService` in agent-sdk evaluates the SAME `SessionStatsEntry` the chat installs,
  on both entry paths (live `onResultStats`, resume `readForResume`). It never sums usage. Its state travels to the
  webview on the same messages that carry the snapshot (`session:stats` and `chat:resume`), so the chip's numerator
  and the budget's numerator are one object. Tighten is advisory by default; the live window change is opt-in and
  self-verifying (E2 read-back). The handoff is assembled deterministically from the transcript tail at write time.
- Rationale: the user's requirement "the limit and the chat display can never disagree" holds by construction; the
  plan uses only code already on main for the session part.
- Rejected alternatives:
  - A main-loop-only counter (`usage`, `stream-transformer.ts:687-688`): disagrees with TOKENS by the subagent spend.
  - A separate `session:contextAdvisory` push (A6, Batch 29): deferred; adding the channel here would build half of A6.
    The budget rides `ResultStatsPayload` instead (one optional field).
  - Relying on `autoCompactWindow` at 50%: unproven until E2 (decision item 2); proxied ids may ignore it.
  - An in-memory facts collector fed per stream message: hot-path cost and empty after restart. Reading the transcript
    tail at the 2-3 write moments costs one bounded read each.
  - A new compaction settings RPC: Batches 16-17 are deferred; `settings:get/set` already serves file-based keys.
- Assumptions (each with its check):
  - AS-1: `stats.sessionId` is the SDK id for every result of a new session. Check: adapter spec with tracking id ≠
    real id (`stream-transformer.ts:472-474` sets it before any result).
  - AS-2: `compact_boundary` in the parent stream is main-loop only. Check: one QA run with a compacting subagent; if
    subagent boundaries appear, filter on the session's own boundary ids.
  - AS-3: the transcript path is `<sessionsDir>/<sessionId>.jsonl` (as `session-stats-reader.service.ts:123-139`
    resolves it). Check: writer spec on a fixture dir.
  - AS-4: `getContextUsage()` is callable on a live query between turns. Check: E2 run (component 4).
- Effect on existing code: no change to owner, aggregator, ledger or transformer arithmetic. Additive optional fields
  on `ResultStatsPayload`, `ChatResumeResult`, `TabState`; one new RPC method; one new banner; one transformer call
  at the compact-boundary branch; a per-session window override in session control.

## Component specifications

### 1. Shared contracts

- Purpose: types and bounds shared by backend and UI.
- Responsibilities:
  - `SessionBudgetState { sessionId; stage: 'unknown'|'normal'|'tighten'|'handoff'|'limit'; unit: 'tokens'|'cost';
measure: 'tokens'|'cost'|'cost-lower-bound'|'weighted-fallback'; used: number|null; limit: number;
percent: number|null; lowerBound: boolean; revision: number|null; compactions: number; extensions: number;
window?: {target; applied; reason?: 'disabled'|'env-override'|'already-lower'|'not-honoured'|'failed'};
handoff?: {path|null; chars; truncated; writtenAt; writeError?}; blocked: boolean; dismissedStage? }`.
  - `SESSION_BUDGET_SETTINGS` bounds and defaults (table in component 2), used by the UI form and the backend reader.
  - `SESSION_BUDGET_REACHED` added to `RpcUserErrorCode`.
  - Optional `budget?: SessionBudgetState` on `ResultStatsPayload` (`agent-adapter.types.ts:44`) and on
    `ChatResumeResult` (`rpc-chat.types.ts:268`).
  - `session:budgetAction { sessionId; action: 'dismiss'|'extend'|'restore-window'|'write-handoff'|'preview-handoff' }
→ { success; state?; handoff?: {content; path|null}; error? }` in the method map and `RPC_METHOD_ENTRIES`.
- Dependencies: none (leaf).
- Failure: n/a (types).
- Verification seam: typecheck of every consumer of the two widened payloads (agent-sdk, cli-agent-runtime,
  rpc-handlers, chat, chat-state, chat-types) in the same unit of work (F10).
- Files: CREATE `libs/shared/src/lib/types/session-budget.types.ts`; MODIFY
  `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`, `libs/shared/src/lib/types/agent-adapter.types.ts`,
  `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`, shared barrel.

### 2. Settings keys and their reader

- Keys (file store, `FILE_BASED_SETTINGS_KEYS`/`_DEFAULTS`, `file-settings-keys.ts:154, 460`):

| Key                                     | Range              | Default                 | Basis                                  |
| --------------------------------------- | ------------------ | ----------------------- | -------------------------------------- |
| `sessionBudget.enabled`                 | boolean            | `true`                  | item 9                                 |
| `sessionBudget.unit`                    | `'tokens'\|'cost'` | `'tokens'` (Decision 1) | "about 50M raw tokens"                 |
| `sessionBudget.tokens`                  | 1M-2B integer      | `50000000`              | user target                            |
| `sessionBudget.usd`                     | 0.5-10,000         | `30`                    | 50M × $0.64/M (14.1M ↔ $8.96)          |
| `sessionBudget.fallbackWeightedTokens`  | 100k-500M integer  | `9000000`               | 50M × 0.18 (last session weighted/raw) |
| `sessionBudget.tightenPercent`          | 10-95, < handoff   | `50`                    | item 9                                 |
| `sessionBudget.handoffPercent`          | 20-99              | `80`                    | item 9                                 |
| `sessionBudget.handoffAfterCompactions` | 1-20               | `3`                     | item 9                                 |
| `sessionBudget.tightenWindowTokens`     | `null` or 100k-1M  | `null` (advisory only)  | decision item 2 (E2 gate)              |
| `sessionBudget.blockAtLimit`            | boolean            | `true`                  | Decision 4                             |

- Responsibilities: `SessionBudgetConfigProvider.getConfig()` reads through `ConfigManager` like
  `compaction-config-provider.ts:75-117`; any out-of-range value, or tighten ≥ handoff, is WARNed and read as the
  default (covers raw `settings:set` writes, which do not validate values).
- Failure: unreadable → defaults.
- Verification seam: provider spec (each bound, the cross-field rule, defaults).
- Files: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts` (+ its spec if it enumerates keys); CREATE
  `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts` (+ spec).

### 3. `SessionBudgetService` (agent-sdk) — stage machine

- Purpose: map the displayed figure to a stage and run each stage's action once.
- Responsibilities:
  - Key: `snapshot.sessionId` (F1). Never the wrapper id.
  - `observe(snapshot | undefined)` (live) and `observeLoaded(snapshot | null)` (resume): an absent snapshot keeps
    the last state; a snapshot with a lower `revision` than the last accepted is ignored (same rule as
    `tab-manager.service.ts:2196-2209`); `unknown` only before the first figure (F5). A resume snapshot without
    `revision` is accepted only when no state exists.
  - Measure (F6):
    - unit `tokens`: `used = tokenCount`; `undefined` → `unknown`; `lowerBound = coverage === 'partial'`.
    - unit `cost`: `totalCost` when non-null; else `knownCost` as `cost-lower-bound` (`≥`) when `pricingCoverage ===
'partial'`; else (`'none'`) `weighted-fallback` from `snapshot.tokens` against `fallbackWeightedTokens`.
    - Once a session enters `weighted-fallback` it keeps that measure until a settings change (no flapping).
  - `recordCompaction(sessionId)`: called from the main-loop `compact_boundary` branch (F8); main loop only (AS-2);
    in memory, resets on restart exactly like the chat's per-tab count.
  - Stage = highest of percent bands (`<tighten`, `≥tighten`, `≥handoff`, `≥100`) and `handoff` when
    `compactions ≥ handoffAfterCompactions`. Stages only rise, except after `extend` or a settings change.
  - Actions, once per stage entry: tighten → component 4 (only when `tightenWindowTokens` is set, else
    `window.reason='disabled'`); handoff → component 5 write; limit → fresh write + `blocked = blockAtLimit`.
  - `canSend(sessionId)`: state, else `statsOwner.snapshot(sessionId)` evaluated on the fly, else ok (F2).
  - `act(sessionId, action)`: dismiss, extend (limit only, +20% per extension, INFO), restore-window (component 4),
    write-handoff, preview-handoff.
  - `release(sessionId)` on session end; `clearAll()` on disposal. INFO one line per stage change.
- Dependencies: `SDK_SESSION_STATS_OWNER` (`di/tokens.ts:40`), component 2, 4, 5. No frontend, rpc-handlers or
  vscode-core dependency beyond the logger already used in agent-sdk.
- Failure: no figure → `unknown`, never blocks; at most the crossing turn plus one held follow-up run past 100% (F7,
  accepted and specced: `onTurnEnd` releases the held message before `onResultStats`); write or tighten failure →
  state fields set, WARN once, stage still advances.
- Quality: no timers or polling; one map entry per live session, released on end.
- Verification seam: pure stage function spec (boundaries 49.9/50/79.9/80/99.9/100, compaction trigger, lower bound,
  extend, revision ignore, absent snapshot, measure stickiness); service spec with fakes.
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-stage.ts`,
  `session-budget.service.ts`, `weighted-tokens.ts` (+ specs; weights input 1, cache write 1.25, cache read 0.1,
  output 5; fixture 177M/7.7M/1.1M → 32.8M).

### 4. Per-session auto-compact window override (E2-gated tighten)

- Purpose: lower one session's window and prove the runtime honoured it.
- Responsibilities:
  - `SessionControl.applySessionAutoCompactWindow(sessionId, window | null)`: same timeout and logging as
    `session-control.service.ts:559-595`; records the override on the session record so `applyAutoCompactConfig`
    keeps it for that session instead of overwriting it.
  - Skip with a reason: `env-override` when `envWindow` is set (`auto-compact-control.ts:189-192`); `already-lower`
    when the read-back threshold is already ≤ target.
  - Verify: after the apply, `query.getContextUsage()`; if `autoCompactThreshold` did not move to ≤ target, send `null`
    back, set `not-honoured`, WARN once. This is the E2 live check for that model class; its result is logged with the
    class so the A1 default decision can use it.
  - Restore (F14): clear the override and send what `resolveAutoCompactControl` gives for the current config, or
    `null` (runtime decides) when that is unset; never a guessed class default.
- Dependencies: Batch 23 code only. Adds `getContextUsage` to the structural query mirror
  (`session-lifecycle-manager.ts:80-104`).
- Failure: any throw → `failed`, session keeps its window.
- Verification seam: session-control spec (override survives a config re-apply; read-back miss restores null; env
  skip; timeout).
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`,
  `session-lifecycle-manager.ts`, `session-lifecycle/session-registry.service.ts` (record field) (+ specs).

### 5. Handoff builder and writer (agent-sdk)

- Purpose: a bounded, deterministic `handoff.md`; no model call (Decision 3).
- Facts, read at write time from the main transcript tail (`readJsonlTail`, 4 MB window): latest compact summary
  (≤2,500 chars; also the goal source), else the first user prompt in the window (≤1,000); Edit/Write/MultiEdit/
  NotebookEdit paths (≤50, "+N more"); latest TodoWrite items not completed (≤20); next action (first in-progress,
  else first pending, else last assistant text ≤800); task folder paths matching `.ptah/specs/TASK_\d{4}_\d{3}…` (≤5).
  Works the same after a restart.
- Schema: fixed sections (Session/Budget/Task folders, Goal, Decisions and current state, Changed files, Open items,
  Next action, How to continue), total cap 8,000 chars, `[truncated]` markers. Seed prompt ≤ 8,200 chars.
- Location (Decision 3): `~/.ptah/handoffs/<sessionId>.md`, atomic temp+rename, retention newest 50 files pruned on
  write (F15). Session id must match `UUID_REGEX`; the resolved path must stay under the handoffs dir (F12).
- Failure: read or write error → content kept in memory for the session, `writeError` set, WARN once.
- Verification seam: builder spec on fixture transcripts (each fact, caps, truncation), writer spec on a temp dir
  (atomic rename, retention, rejected id, path escape).
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts`,
  `session-handoff-writer.ts` (+ specs).

### 6. agent-sdk wiring

- Responsibilities: token `SDK_SESSION_BUDGET`; registration (`di/register.ts:161-173` pattern);
  `wrapResultStatsForActivity` (`sdk-agent-adapter.ts:1581-1591`) calls `observe(stats.sessionStats)` and passes
  `{...stats, budget}` to `inner` with the identical `sessionStats` reference; session end (`:806`, `:1389-1395`)
  calls `release`; `StreamTransformer` calls `recordCompaction(effectiveSessionId)` at `stream-transformer.ts:795`.
- Failure: `observe` wrapped; an exception logs once and the inner callback still runs unchanged.
- Verification seam: adapter parity spec (same object reference; new session with tracking id ≠ real id keys by the
  real id); transformer spec (boundary recorded once per boundary).
- Files: MODIFY `libs/backend/agent-sdk/src/lib/di/tokens.ts`, `di/register.ts`, `sdk-agent-adapter.ts`,
  `helpers/stream-transformer.ts`, agent-sdk barrel (+ specs).

### 7. Broadcast forwarding (cli-agent-runtime)

- Responsibility: `sendStatsWithRetry` forwards `budget` next to `sessionStats` (`sdk-callbacks.ts:409-418`).
- Verification seam: sdk-callbacks spec.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` (+ spec).

### 8. rpc-handlers: gate, resume, action RPC

- Responsibilities:
  - `chat:continue`: after the Ptah CLI branch (`chat-session.service.ts:792-795`) and BEFORE the slash/resume branch
    (`:836`), if `canSend` is not ok and the trimmed prompt is not exactly `/compact` or `/clear` (allowlist, F3),
    return `{success:false, errorCode:'SESSION_BUDGET_REACHED', error}`. Custom slash commands are blocked.
  - Resume (`:963`): `observeLoaded(result.stats)` and attach `budget` to the result.
  - `SessionBudgetRpcHandlers` with `session:budgetAction` (zod: `sessionId` UUID, action enum), exported from
    `handlers/index.ts`, a manifest entry like `manifest.ts:283-286`.
- Not gated (accepted risk, recorded): surface submits (`surface-submit-turn.service.ts:298`, MCP-apps contract
  would need a new reject reason) and Ptah CLI sessions (outside the snapshot).
- Failure: budget token missing on a host → gate ok, action returns `{success:false, error:'unavailable'}`.
- Verification seam: chat-session spec (blocked; `/compact` and `/clear` pass; a custom command is blocked; unknown
  passes; resume attaches budget); handler spec; manifest, allowlist and the three rpc-surface specs updated in the
  same unit as the method map (F4).
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.ts` (+ spec); MODIFY
  `chat/session/chat-session.service.ts` (+ spec), `handlers/index.ts`, `host-profile/manifest.ts`,
  `rpc-allowlist.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
  `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`.

### 9. Frontend

- Tab state: `TabState.sessionBudget` (`chat-types.ts:643` neighbour); set by `handleSessionStats` from
  `stats.budget` with the snapshot (`session-stats-aggregator.service.ts:54, 130-158`) and by the loader from the
  resume result (`session-loader.service.ts:1033`).
- Chip (`session-stats-summary.component.ts`): optional input `budget: SessionBudgetState | null`. Numerator for
  `tokens`/`cost` stays `snapshot()`; `used` from the budget is shown only for `cost-lower-bound` (`≥ $x`) and
  `weighted-fallback` ("est. 6.2M / 9M weighted — no price for this model"). Label text depends on measure (F6).
- Banner: new dumb `session-budget-banner.component.ts` in `molecules/notifications/` (pattern
  `resume-notification-banner.component.ts`), placed in the `chat-view.component.html:127-137` slot; OnPush,
  `role="status"` (tighten/handoff), `role="alert"` (limit); preview renders plain text in `<pre>`.
  "Continue in new session" starts a tab with `ChatStartParams.prompt = seed`.
- Send failure: `message-sender.service.ts` handles `SESSION_BUDGET_REACHED` like `handleAuthRequired` (`:97-111`).
- Settings card: `session-budget-settings.component.ts` in `settings/ptah-ai/`, hosted by
  `orchestration-settings.component.ts` in its own `@defer (on viewport)`, reading and writing through
  `settings:get/set` with the shared bounds for inline validation.
- Verification seam: aggregator and loader specs (budget installed with the snapshot, revision rule); chip spec (each
  measure label); banner spec (each stage, buttons, roles); message-sender spec; settings card spec.
- Files: MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`,
  `chat-store/session-loader.service.ts`, `libs/frontend/chat/src/lib/services/message-sender.service.ts`,
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`,
  `chat/src/lib/components/templates/chat-view.component.html` and `.ts`,
  `chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` (+ specs); CREATE
  `chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`,
  `chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts` (+ specs).

### 10. Subagent budgets and resume advice (contract; built with Batches 28, 36, 37, 40-41, 46-47)

- Contract kept from revision 1, corrected:
  - Per subagent, in the A5 monitor: `contextTokens` (last request input + cache read + cache write) and
    `weightedUsed` (TTL-aware cache-write weight from Batch 37). Safety stop at `subagentStopWeightedTokens`
    (provisional 3M, final from Batch 36 p95) through `stopSubagent` (`subagent-message-dispatcher.ts:258`).
  - Advice: `fresh` when stopped, cold, context ≥ `subagentHandoffTokens` (150k), or budget reached; else `resume`.
  - F11: the backend `contextTokens` is the one figure; Batch 46.2's frontend `contextTokens` is replaced by it, and
    running-subagent figures reach `MonitoredAgent` on the existing subagent event stream, not a poll.
  - F9: the "session + subagents" information total is already TOKENS; a subagent share (monitor figure) may be shown
    beside it, labelled approximate, never as a limit figure.
- Files: as revision 1 component 6-7, planned when those batches are scheduled.

## Integration architecture

- Data flow: SDK `result` → owner `replaceRun` → snapshot → wrapper `observe` → `{...stats, budget}` → broadcast →
  aggregator installs snapshot and budget together → chip and banner. Resume: `readForResume` → `observeLoaded` →
  `chat:resume {stats, budget}` → loader. Send: `chat:continue` → `canSend`. Compaction: `compact_boundary` →
  `recordCompaction`. Actions: banner → `session:budgetAction`.
- State: in memory per session; handoff files persist in `~/.ptah/handoffs/` (50 newest). After a restart the stage
  is recomputed from the resume snapshot; compaction count, extensions and dismissals reset (as the chat's count does).
- External boundaries: RPC input validated with zod (UUID, enum); settings validated on read; handoff path confined;
  handoff text rendered as text only.
- Failure and rollback: fail-open everywhere except the explicit block; `sessionBudget.enabled=false` removes block
  and banner on the next figure.
- Observability: INFO per stage change, extend, tighten result (with model class, feeding the E2 record); WARN once per
  session for tighten miss, handoff failure, observe error.

## Architecture-level quality requirements

- Functional: `state.used` equals the chip's TOKENS or COST for the same revision on both live and resume paths; the
  next `chat:continue` after a 100% figure is blocked except `/compact` and `/clear`; "Continue in new session" sends
  only the seed.
- Performance: O(1) per result; transcript tail read only at 2-3 write moments; no timers or polls.
- Security: UUID-checked ids, confined paths, no HTML rendering, no secrets beyond what the transcript holds.
- Maintainability: shared types in `shared`; services in `agent-sdk`; RPC in `rpc-handlers`; no vscode-core changes;
  no edits to TASK_2026_609 areas; A1 defaults untouched.
- Testability: pure stage, measure and weighting functions carry the logic; one parity spec per entry path.

## Review resolution

| Finding                      | Resolution                                                                                                                       | Where                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| F1 key by wrapper id         | Key by `snapshot.sessionId`; parity spec with tracking id ≠ real id                                                              | Comp. 3, 6; AS-1      |
| F2 resume path unknown       | `observeLoaded` at `readForResume`; `canSend` falls back to `statsOwner.snapshot`                                                | Comp. 3, 8            |
| F3 `/compact` not native     | Explicit allowlist `/compact`, `/clear` before the slash/resume branch; custom commands blocked                                  | Comp. 8               |
| F4 RPC manifest              | One new method; map, handler, manifest, allowlist and three surface specs in one unit; settings use existing `settings:get/set`  | Comp. 1, 8            |
| F5 absent snapshot           | Absent keeps state; lower revision ignored; `unknown` only before the first figure                                               | Comp. 3               |
| F6 cost fallback             | `knownCost` lower bound when partial; weighted only at `'none'`; sticky measure; `used`/`measure` in chip input; label by reason | Comp. 3, 9            |
| F7 held follow-up            | Accepted: at most crossing turn + one held follow-up; specced and stated in the limit text                                       | Comp. 3               |
| F8 compaction source         | `compact_boundary`, main loop; resets on restart like the chat; tighten → earlier handoff stated in text                         | Comp. 3, 6; user text |
| F9 subagent info total       | TOKENS is the info total; optional labelled share; "needs a second, approximate figure"                                          | Comp. 10; Decision 2  |
| F10 batch deps               | No batch table (team-leader owns it); ordering constraints and same-unit typecheck rules below                                   | Handoff               |
| F11 two context figures      | Backend figure only; event delivery, no poll                                                                                     | Comp. 10              |
| F12 id in path               | `UUID_REGEX` + confined resolve                                                                                                  | Comp. 5, 8            |
| F13 reported-cost preference | Stated in Decision 1                                                                                                             | Gate 2                |
| F14 tighten/restore          | Text says it compacts on the next request when above target; restore sends configured window or `null`                           | Comp. 4; user text    |
| F15 retention/location       | Newest 50 files; location is Decision 3                                                                                          | Comp. 5; Gate 2       |

## User-facing text (changes from revision 1 only)

- Tighten, advisory (default while E2 is open): "Half of this session's budget is used (<used> of <limit>). Run
  /compact or start a fresh session for unrelated work to slow the spend."
- Tighten, applied: "... Ptah lowered auto-compact to <target> tokens for this session. If the context is already above
  that, the next request compacts first. More compactions bring the handoff step sooner." Not-honoured reason text:
  "this model ignored the lower auto-compact setting".
- Limit: "... New messages here are paused after the current turn (one queued message may still run). /compact and
  /clear still work."
- Cost lower bound: "COST ≥ $x / $30 (some models have no price)". Weighted: "est. <used> / <limit> weighted tokens (no
  price for this model)".
- All other stage texts, buttons and roles: as revision 1 § User-facing text.

## Team-leader handoff

- Recommended executors: backend-developer for components 1-8; frontend-developer for 9; component 10 is not
  scheduled until Batches 28, 36, 37 and 40-41 exist.
- Complexity: MEDIUM-HIGH (stage machine plus two entry paths across five libraries); each component LOW-MEDIUM.
- Dependencies and ordering (component level): 1 before all; 2 before 3; 4 and 5 before 3's actions are wired; 6
  after 3-5; 7 after 1; 8 after 6; 9 after 7 and 8. A unit that widens `ResultStatsPayload` or `ChatResumeResult`
  typechecks agent-sdk, cli-agent-runtime, rpc-handlers, chat-types, chat-state and chat in the same unit. The RPC
  method map change and component 8's handler, manifest and surface specs are one unit.
- Parallel-safe: 4 and 5 (disjoint files); 7 with 4-5; 9's settings card with 3-8.
- Files affected: CREATE 11 (listed per component); MODIFY about 30 (listed per component).
- Verification points: parity specs on both entry paths; no `undefined → 0` coercion; `.ptah/handoffs` never inside a
  workspace; `A1_DEFAULT_WINDOW` unchanged; repository commands
  `npx nx run-many -t typecheck,lint,test -p <touched projects>` plus `@ptah-extension/cli-engine` and the three app
  typechecks after component 8. QA: one scripted session at `sessionBudget.tokens = 2000000` through all stages
  (chip = state, block, `/compact` passes, seed-only new session), and one proxied-route run in `cost` unit.

## Gate 2 decisions

1. **Session budget unit.** You prefer provider-reported figures, but COST is provider-reported only for live runs on
   the direct Anthropic route; resumed history and every proxied route are rate-card estimates, and with subscription
   auth the "reported" dollars are API-equivalent, not billed.
   - TOKENS as displayed, 50M (Recommended): present whenever the chip shows stats, identical on every provider.
   - COST as displayed, $30: closest to money; `≥` lower bound when some models are unpriced; weighted fallback (9M)
     only when nothing is priced.
2. **Subagents in the budget.** TOKENS and COST already include Task-subagent spend; excluding it needs a second,
   approximate figure.
   - Count the displayed figure, ship the session part now, build per-subagent resume advice and safety stop with the
     deferred Batches 28/36/37/40-41 (Recommended).
   - Same, plus show an approximate subagent share beside TOKENS once the monitor exists.
   - Exclude subagents from the limit with a main-loop-only counter (will not match the chip).
3. **Handoff writing and location.**
   - Deterministic from the transcript, `~/.ptah/handoffs/`, newest 50 kept (Recommended): free, never in your repo.
   - Deterministic, written beside the detected task folder (`.ptah/specs/TASK_…/handoff.md`), home dir otherwise.
   - Deterministic plus an "Improve with model" button that spends one extra request.
4. **At 100%.**
   - Pause new messages after the current turn, with "Allow 20% more" and "Continue in new session" (Recommended).
   - Banner only, never pause.
   - Pause with no override.
