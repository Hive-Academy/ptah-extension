# Implementation Plan — TASK_2026_155 `/goal` Workflow

**Author**: software-architect | **Date**: 2026-07-14 | **Branch at start**: `ak/fix-canvas-issue`
**Status**: READY FOR TEAM-LEADER DECOMPOSITION
**Verdict**: The PM's load-bearing assumption **HOLDS** — the installed SDK natively supports blocking a Stop and injecting next-turn guidance. No fallback design required. All 8 open questions decided below with code-grounded positions.

---

## 0. TL;DR for the team-leader

- The whole feature rests on the SDK Stop-hook `decision: 'block'` contract. **Verified present** in the installed SDK types. Batch B must open with a 10-line runtime spike to confirm behavior (not just the type) before building on it.
- New backend lib `@ptah-extension/goal-workflow` (modelled on `cron-scheduler`) owns all goal state, persistence, and the evaluator loop. agent-sdk stays persistence-free (honors its charter) and only gains a small, additive **decision-returning** registry that the Stop hook consults after its existing fan-out.
- Existing Stop-hook fan-out (`notifyAll` + `emitTurnEnded`) runs **byte-identically** on every turn; the goal decision is layered on top and only flips the hook's return value. This is the Req 2.5 regression guarantee.
- 7 libs touched. One SQLite migration. One new RPC namespace `goal:` (dual-registered). Frontend gets a client-side `/goal` interceptor + an active-goal indicator fed by pushed events.

---

## 1. Load-bearing contract verification (Open Question 1) — VERIFIED

**Source of truth**: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

`SyncHookJSONOutput` (sdk.d.ts:5626) — the object a hook may return:

```ts
export declare type SyncHookJSONOutput = {
  continue?: boolean;        // false => turn fully ends
  suppressOutput?: boolean;
  stopReason?: string;       // shown to user when continue:false
  decision?: 'approve' | 'block';
  systemMessage?: string;    // USER-VISIBLE warning channel
  reason?: string;           // fed to the MODEL as directive (hidden) when decision:'block'
  terminalSequence?: string;
  hookSpecificOutput?: ...;
};
```

`HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput` (sdk.d.ts:803). Hooks return `Promise<HookJSONOutput>` (async supported).

`StopHookInput` (sdk.d.ts:5574) carries everything the decider needs with **zero extra I/O**:

```ts
StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;          // true when already inside a stop-hook continue loop
  last_assistant_message?: string;    // last turn's assistant text
  background_tasks?: BackgroundTaskSummary[];
  session_crons?: SessionCronSummary[];
};
```

`TerminalReason` (sdk.d.ts) enumerates `'stop_hook_prevented'` and `'hook_stopped'` — **proof the SDK runtime honors stop-hook blocking**, not just the type.

### The decided contract

| Intent                                                   | Hook return                                                     | Delivery                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Block the stop, keep working, steer next turn**        | `{ decision: 'block', reason: '<guidance>' }`                   | `reason` is injected to the model as a hidden directive (NOT a user chat message). SDK re-enters the same agentic loop. |
| **Allow the stop (goal achieved / no goal / fail-open)** | `{ continue: true }`                                            | Unchanged current behavior.                                                                                             |
| **User-visible warning** (evaluator broken)              | add `systemMessage: '<warning>'` alongside `{ continue: true }` | Surfaced to the user; distinct from the model directive.                                                                |

**Why nothing blocks today**: `stop-hook-handler.ts:106` unconditionally returns `{ continue: true }`. The change is to compute a decision after the existing fan-out and return `{ decision: 'block', reason }` when the goal decider says so.

**Residual risk (flag)**: the SDK _type_ is confirmed; the _interactive-path runtime behavior_ of `decision:'block'` re-entering the loop must be smoke-tested. Batch B opens with a spike (see §7 Batch B). Loop bounding is inherent: `Options.maxTurns` defaults to 200 (`sdk-query-options-builder.ts:1112`) and `stop_hook_active` lets us detect we are inside a continue loop.

---

## 2. Open-question decisions (2–8)

### Q2 — Transcript evidence strategy (DECIDED: `last_assistant_message` + bounded last-N window)

- **Primary evidence**: `input.last_assistant_message` (already in the hook input — no file read).
- **Context window**: last **N = 6** transcript messages read via `JsonlReaderService.readJsonlMessages` (`agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:124`), locating the file with `findSessionsDirectory(cwd)` (:52) then `{sessionId}.jsonl`.
- **Hard bound**: concatenated evidence truncated to **≤ 12 000 chars (~4k tokens)**, newest-first, older messages dropped first. This is the NFR "bounded transcript window" — per-turn evaluator cost cannot grow with session length.
- **Not** a running summary (too much machinery for v1). If the JSONL read fails, fall back to `last_assistant_message` alone (never throw — hook safety).

### Q3 — Evaluator transport (DECIDED: `InternalQueryService`, re-entrant-safe)

`InternalQueryService.execute()` (`internal-query.service.ts:16`) → `SdkQueryRunner.runOneShot()` (`sdk-query-runner.service.ts:140`) spawns a **fully independent claude-cli subprocess**: own `AbortController`, `permissionMode:'bypassPermissions'` (:281), `persistSession:false` (:285), no shared state with the parent interactive query. The parent query simply `await`s the hook promise while the child runs. **This is re-entrant-safe** — no raw HTTP call needed (raw HTTP would bypass provider/tier/auth-env resolution).

Evaluator query configuration:

- `model` = a single configurable default resolved to the **Haiku tier** (never the session's main model). Constant `GOAL_EVALUATOR_MODEL` resolved through `SdkModelService.resolveModelId` so it maps per-provider.
- `maxTurns: 1` — one assistant turn only.
- `outputFormat` = JSON schema for `{ achieved: boolean, reason: string }` (`runOneShot` passes it through at :315) → verdict lands in `SDKResultSuccess.structured_output`.
- `isPremium:false`, `mcpServerRunning:false` → MCP disabled (:404, :409).
- Hard **timeout = 20 s** via a caller-owned `AbortController`; on timeout → fail-open path (Req 2.4).
- **Zero-tools guarantee (Req 2.7)**: `maxTurns:1 + outputFormat` already prevents a tool loop. For a hard guarantee add a minimal, additive passthrough to `OneShotRunInput` — `disallowedTools?: string[]` (or `allowedTools: []`) — set to deny-all in `buildOneShotOptions` (:270). Small, focused change; keeps the "no tools" invariant explicit rather than emergent.

### Q4 — Where GoalManager lives (DECIDED: new lib `@ptah-extension/goal-workflow`)

agent-sdk's charter forbids persistence beyond SDK JSONL (`agent-sdk/CLAUDE.md` → "Does NOT belong: Persistence beyond what SDK writes"). So GoalManager does **not** live in agent-sdk. It goes in a new backend lib, structured exactly like `cron-scheduler` (SQLite-backed domain lib depending on `persistence-sqlite`).

**Dependency direction (no cycle)**: `goal-workflow → agent-sdk` (for `InternalQueryService` + `JsonlReaderService` + the decision-registry token). agent-sdk depends on **nothing new** — it exposes an interface the Stop hook calls; goal-workflow provides the implementation, wired at app-container time. This avoids the naive cycle (agent-sdk needing goal-workflow).

### Q5 — StopCallbackRegistry evolution (DECIDED: new first-class decision registry; leave the notify registry untouched)

Do **not** overload the existing fire-and-forget `StopCallbackRegistry` (`stop-callback-registry.ts:20`) — that would risk the Req 2.5 regression surface. Instead:

- Add a new **`StopDecisionRegistry`** in agent-sdk: single decision-returning callback slot (session-agnostic registry; the callback resolves the session internally). Type `StopDecider = (payload: StopDecisionInput) => Promise<StopDecision>` where `StopDecision = { block: false; systemMessage?: string } | { block: true; reason: string }`.
- `StopHookHandler` runs a **first-class goal-decision step AFTER** the existing `notifyAll` (:59) and `emitTurnEnded` (:87) fan-out — both preserved verbatim — then, if a decider is registered, awaits it and flips the return to `{ decision:'block', reason }` when it says block. Empty registry ⇒ output identical to today.

### Q6 — Resume trigger (DECIDED: re-arm only, per Req 6.2)

On session resume the goal is **restored as active from SQLite** (keyed by SDK sessionId) and the decider re-arms automatically on the next completed turn. **No auto-start of a turn.** Frontend hydrates the indicator by calling `goal:status` when a tab binds its session (SessionLoader path). The optional "resume working toward goal" one-click button is **out of v1 default** (documented as a future nicety).

### Q7 — Premium gating (DECIDED: NOT Pro-gated in v1)

`goal:` is added to `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44`) but **NOT** to `PRO_ONLY_METHOD_PREFIXES` (:110). It still passes the standard license middleware (any valid tier), consistent with `session:`/`chat:`. Rationale: goal mode adds no new authority (NFR Safety) and the evaluator runs without MCP, so it is not a premium capability. **Assumption** — revisit only if product wants `/goal` as a Pro upsell; if so, add `'goal:'` to `PRO_ONLY_METHOD_PREFIXES` and gate the evaluator via `FeatureGateService`.

### Q8 — Achieved-goal history retention (DECIDED: keep all, prune on session delete)

Retain all terminal records (`achieved`/`superseded`/`cleared`) per session. Prune via explicit delete on session deletion (Req 6.3) — the goals table keys on SDK sessionId, so cleanup joins the existing session-delete path. Add index `(session_id, status)`. Optional soft cap (keep newest 50 terminal records/session) is a cheap safety valve; include it. `goal:history` RPC is **optional** in v1.

---

## 3. Component & data model

### 3.1 GoalRecord (shared domain type — `libs/shared`)

```ts
type GoalStatus = 'active' | 'achieved' | 'superseded' | 'cleared';

interface GoalRecord {
  id: string; // ULID
  sessionId: string; // SDK canonical UUID (from system 'init')
  workspaceRoot: string | null;
  condition: string; // ≤ 4000 chars (validated)
  status: GoalStatus;
  turnsEvaluated: number; // 0 at creation
  evaluatorTokenSpend: number; // cumulative
  evaluatorModel: string; // resolved Haiku-class id
  lastReason: string | null; // latest evaluator reason
  consecutiveMalformed: number; // fail-open bookkeeping (Req 2.4)
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null; // set on terminal transition
}
```

### 3.2 SQLite schema (`persistence-sqlite` migration `0029_goals.ts`)

```sql
CREATE TABLE goals (
  id                    TEXT PRIMARY KEY,          -- ULID
  session_id            TEXT NOT NULL,
  workspace_root        TEXT,
  condition             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('active','achieved','superseded','cleared')),
  turns_evaluated       INTEGER NOT NULL DEFAULT 0,
  evaluator_token_spend INTEGER NOT NULL DEFAULT 0,
  evaluator_model       TEXT NOT NULL,
  last_reason           TEXT,
  consecutive_malformed INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  resolved_at           INTEGER
);
-- At most one ACTIVE goal per session (Req 5.2):
CREATE UNIQUE INDEX idx_goals_one_active ON goals(session_id) WHERE status = 'active';
CREATE INDEX idx_goals_session_status ON goals(session_id, status);
```

Follows the exact pattern of `migrations/0004_cron.ts`; append the migration to `migrations/index.ts` `MIGRATIONS` tuple (forward-only, append-only).

### 3.3 State transitions

```
(none) --set--> active
active --set(new)--> superseded (old) + active (new)     [Req 1.5 replace-on-reset]
active --evaluator:yes--> achieved                        [Req 2.3]
active --user /goal clear|stop|off|reset|none|cancel--> cleared   [Req 4.1]
active --evaluator:no--> active (turnsEvaluated++, lastReason, tokenSpend+=)  [Req 2.2]
```

Terminal states (`achieved`/`superseded`/`cleared`) are immutable.

### 3.4 Evaluator prompt + output schema

System-prompt append (goal-workflow constant): instructs the model it is a **read-only judge**, must not use tools, must decide only from supplied transcript evidence, and must return the structured verdict. `outputFormat` JSON schema:

```json
{
  "type": "object",
  "properties": {
    "achieved": { "type": "boolean" },
    "reason": { "type": "string", "maxLength": 500 }
  },
  "required": ["achieved", "reason"],
  "additionalProperties": false
}
```

### 3.5 Sequence — turn → evaluate → continue/stop

```
1. User: "/goal <cond>"
     MessageDispatchService intercept → GoalCommandService.parse
       → rpcCall('goal:set', {sessionId, condition})
         → GoalRpcHandlers.set → GoalManager.setGoal() persists ACTIVE
            (supersedes any existing active) → GoalNotifier pushes GOAL_UPDATED
       → GoalCommandService sends the condition as the first turn (messageSender.send)
2. Main agent runs a turn (normal permission gate, unchanged).
3. SDK Stop hook fires → StopHookHandler:
     a. notifyAll(...)          [UNCHANGED — stop-hook-handler.ts:59]
     b. emitTurnEnded(...)      [UNCHANGED — :87 → SessionLifecycleNotifier → webview]
     c. if StopDecisionRegistry non-empty → await decider.decide({
           sessionId, cwd, lastAssistantMessage, stopHookActive, terminalReason })
4. GoalStopDecider.decide:
     - resolve ACTIVE goal by sessionId; none → { block:false }  [fast path, zero cost]
     - terminalReason ∈ {aborted_streaming, aborted_tools, model_error,
         prompt_too_long, image_error, max_turns, hook_stopped, blocking_limit}
         → { block:false } (do NOT block on error/interrupt; goal stays active)  [Req 2.6 / NFR Safety]
     - build bounded evidence (§Q2)
     - GoalEvaluatorService.evaluate() → InternalQueryService one-shot (20s timeout)
       · achieved:true  → GoalManager.markAchieved(reason); push GOAL_ACHIEVED;
                          inject "goal achieved" transcript notice → { block:false }
       · achieved:false → GoalManager.recordContinuation(reason, tokens)
                          (turnsEvaluated++, lastReason, spend+=, consecutiveMalformed=0);
                          push GOAL_UPDATED → { block:true, reason: guidance(reason) }
       · malformed      → consecutiveMalformed++
                          · ==1 → { block:true, reason:"evaluator unclear; continue toward: <cond>" }
                          · >=2 → { block:false, systemMessage:"Goal evaluator returning unusable output; goal kept active, auto-continue paused." }  [Req 2.4]
       · timeout/unavailable(no key/provider down) → { block:false,
                          systemMessage:"Goal evaluator unreachable; goal kept active." }  [NFR Resilience — fail open immediately, no retry-block]
5. StopHookHandler returns the decision (wrapped in try/catch → on any throw returns {continue:true}, matching :96 swallow-and-log).  [Hook safety]
6. block:true → SDK re-enters loop with `reason` as directive → back to step 2.
```

**Resume path**: session resume → GoalManager reads store on next Stop for that sessionId → re-arms. Frontend calls `goal:status` on tab/session bind → hydrates indicator. No auto-turn.

---

## 4. Lib boundary decisions (what gets new code and why)

| Lib                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why / rule honored                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **`libs/shared`**                                                                        | `GoalRecord`/`GoalStatus` domain types; `rpc-goal.types.ts` (params/results); add `goal:*` to `RpcMethodName` (`types/rpc.types.ts`); `MESSAGE_TYPES.GOAL_UPDATED/GOAL_ACHIEVED/GOAL_CLEARED` (near `types/messages/message-constants.ts:121`) + Zod payload schemas                                                                                                                                                                                   | Shared FE/BE contracts live only here (frontend↔backend isolation).                                                                    |
| **`libs/backend/persistence-sqlite`**                                                    | `migrations/0029_goals.ts` + append to `migrations/index.ts`                                                                                                                                                                                                                                                                                                                                                                                           | Foundation lib owns migrations; forward-only append.                                                                                   |
| **`libs/backend/agent-sdk`**                                                             | NEW `helpers/stop-decision-registry.ts` (+ token in `di/tokens.ts`, register in `di/register.ts` near :254); MODIFY `helpers/stop-hook-handler.ts` to consult it after fan-out; export via `src/index.ts`; OPTIONAL `disallowedTools` passthrough in `sdk-query-runner.service.ts`                                                                                                                                                                     | Additive, persistence-free. Interface owned here so no cycle.                                                                          |
| **`libs/backend/goal-workflow` (NEW)**                                                   | `GoalStore` (SQLite CRUD), `GoalManager` (state machine + counters + notifier emitter), `GoalEvaluatorService` (evidence + InternalQuery), `GoalStopDecider` (implements `StopDecider`), evidence builder, evaluator prompt/schema, `errors.ts`, `di/{tokens,register}.ts`, `types.ts`, `index.ts`, `project.json`, `tsconfig*`                                                                                                                        | One concern per lib; mirrors `cron-scheduler`. Depends on `persistence-sqlite`, `agent-sdk`, `vscode-core`, `shared`, `platform-core`. |
| **`libs/backend/vscode-core`**                                                           | add `'goal:'` to `ALLOWED_METHOD_PREFIXES` (`messaging/rpc-handler.ts:44`) — NOT to `PRO_ONLY_METHOD_PREFIXES`                                                                                                                                                                                                                                                                                                                                         | RPC runtime guard (dual-registration rule).                                                                                            |
| **`libs/backend/rpc-handlers`**                                                          | NEW `handlers/goal-rpc.handlers.ts` + `goal-rpc.schema.ts` (Zod); add to `SHARED_HANDLERS` (`register-all.ts:53`) + `static METHODS` tuple; NEW `handlers/goal-notifier.ts` (pushes GOAL\_\* like `session-lifecycle-notifier.ts`); DI in `handlers/index.ts` barrel                                                                                                                                                                                   | One handler class per namespace; delegates to goal-workflow.                                                                           |
| **`libs/frontend/core`**                                                                 | NEW `GoalStore` (signals, per-session active goal); NEW `GoalMessageHandler implements MessageHandler` registered via `MESSAGE_HANDLERS` (`services/message-router.types.ts:49`) for GOAL\_\* pushes; goal RPC wrappers via `rpcCall` (`services/rpc-call.util.ts:196`)                                                                                                                                                                                | Backend→webview push consumed via existing message-router; no polling (Req 7.4).                                                       |
| **`libs/frontend/chat`**                                                                 | NEW `GoalCommandService` (parse/intercept `/goal` + aliases, call `goal:*`, render confirmations); wire into `MessageDispatchService.sendOrQueueMessage` (`services/chat-store/message-dispatch.service.ts:57`); add `/goal` to slash autocomplete source (feeds `slash-trigger.directive.ts`); NEW `ActiveGoalIndicatorComponent` mounted in `templates/chat-view.component.html` next to `<ptah-compact-session-card>` (:9); hydrate on session bind | `/goal` uses existing dispatch intercept (Req 7.3); component injects GoalStore so it stays in chat (chat CLAUDE.md rule).             |
| **App containers** (`apps/ptah-extension-vscode`, `apps/ptah-electron`, `apps/ptah-cli`) | register goal-workflow services; register `GoalStopDecider` into `StopDecisionRegistry`; register `GoalRpcHandlers` + `GoalNotifier`                                                                                                                                                                                                                                                                                                                   | Adapter selection/wiring lives in app layer. CLI gets RPC parity for free (Req 7.5).                                                   |

---

## 5. RPC surface (`goal:` — dual-registered)

| Method                    | Params (Zod)                                                              | Result                                                                        |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `goal:set`                | `{ sessionId: uuid, workspaceRoot?: string, condition: string(1..4000) }` | `{ goal: GoalRecord }` (rejects >4000 with user error, no mutation — Req 1.3) |
| `goal:status`             | `{ sessionId: uuid }`                                                     | `{ active: GoalRecord \| null, lastTerminal?: GoalRecord }`                   |
| `goal:clear`              | `{ sessionId: uuid }`                                                     | `{ cleared: boolean }` (no-op notice if none — Req 4.3)                       |
| `goal:history` (optional) | `{ sessionId: uuid, limit?: number }`                                     | `{ goals: GoalRecord[] }`                                                     |

Compile-time: add to `RpcMethodName` (`libs/shared/.../rpc.types.ts`) → drives the `register-all.ts` coverage assertion. Runtime: `'goal:'` in `ALLOWED_METHOD_PREFIXES`. All params/results Zod-validated at the boundary (Req 7.1).

Push messages (backend → webview, validated): `GOAL_UPDATED` (set/continuation), `GOAL_ACHIEVED`, `GOAL_CLEARED` — payloads carry `{ sessionId, goal }`.

---

## 6. Test strategy (high-level)

- **Regression guard (Req 2.5 — MANDATORY)**: `stop-hook-handler.spec.ts` — with an **empty** `StopDecisionRegistry`, assert output is byte-identical `{ continue:true }` AND `notifyAll` + `emitTurnEnded` fire with unchanged payloads (extend existing spec). Add a case: a registered decider returning `block` must NOT suppress `notifyAll`/`emitTurnEnded`. Confirm `session-lifecycle-notifier` still broadcasts `SESSION_TURN_ENDED` when the goal blocks (background-task nudges + cron wake unaffected — they key off `background_tasks`/`session_crons`, which are untouched).
- **SDK spike (Batch B gate)**: minimal integration test that a Stop hook returning `{decision:'block', reason}` actually re-enters the interactive loop and the model receives the reason.
- **Goal loop unit tests**: achieved / not-achieved / malformed-once (block) / malformed-twice (fail-open + warn) / timeout / unavailable → correct decision + counter mutations + push events.
- **Concurrency (Req 5.1)**: two sessionIds, decisions strictly isolated; one in-flight evaluation per session.
- **Persistence/resume (Req 6)**: set → reopen store → decider re-arms; session delete → rows pruned.
- **Interrupt (Req 2.6)**: aborted `terminalReason` → decider returns `block:false`, goal stays active.
- **Frontend**: GoalCommandService alias parsing; GoalMessageHandler updates GoalStore; indicator renders + one-click clear.

---

## 7. File-by-file change list, batched

**cli_delegation = AUTO.** Executor legend: **SA-BE** = backend-developer sub-agent, **SA-FE** = frontend-developer sub-agent, **SA-QA** = senior-tester sub-agent, **CLI** = junior CLI helper (codex/copilot/ollama/claude-cli) for self-contained read/scaffold/doc tasks. Backend evaluator-loop batches are tightly-coupled → keep on capable sub-agents; frontend + docs are parallelizable.

### Batch A — Shared contracts + schema (FOUNDATION, blocks B/C/D/F)

Executor: **SA-BE** · Mode: **sequential (first)**

- `libs/shared/.../types/goal/goal.types.ts` (CREATE) — `GoalRecord`, `GoalStatus`
- `libs/shared/.../types/rpc/rpc-goal.types.ts` (CREATE) — params/results
- `libs/shared/.../types/rpc.types.ts` (MODIFY) — add `goal:*` to `RpcMethodName`
- `libs/shared/.../types/messages/message-constants.ts` (MODIFY) — `GOAL_*` message types
- `libs/shared/.../types/messages/*goal*.schema.ts` (CREATE) — Zod payload schemas
- `libs/backend/persistence-sqlite/src/lib/migrations/0029_goals.ts` (CREATE)
- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (MODIFY) — append
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY :44) — add `'goal:'`

### Batch B — agent-sdk Stop-decision plumbing (TIGHTLY COUPLED, HIGHEST RISK)

Executor: **SA-BE** · Mode: **sequential** (open with the SDK spike; do NOT delegate to CLI)

- `libs/backend/agent-sdk/src/lib/helpers/stop-decision-registry.ts` (CREATE) — registry + `StopDecider`/`StopDecision`/`StopDecisionInput`
- `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts` (MODIFY) — consult registry after fan-out; wrap in existing try/catch
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY) — `SDK_STOP_DECISION_REGISTRY`
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY ~:254) — register registry
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts` (MODIFY) — optional `disallowedTools` passthrough (zero-tools guarantee)
- `libs/backend/agent-sdk/src/index.ts` (MODIFY) — export registry + types
- `stop-hook-handler.spec.ts` (MODIFY) — regression assertions

### Batch C — goal-workflow lib (CORE LOOP, depends A+B)

Executor: **SA-BE** · Mode: **sequential** (CLI may scaffold `project.json`/`tsconfig` only)

- `libs/backend/goal-workflow/` scaffold: `project.json`, `tsconfig.*`, `src/index.ts`, `src/lib/di/{tokens,register}.ts`, `src/lib/types.ts`, `src/lib/errors.ts`
- `src/lib/goal.store.ts` (CREATE) — SQLite CRUD (pattern: `cron-scheduler/job.store.ts`)
- `src/lib/goal-manager.ts` (CREATE) — state machine, counters, event emitter
- `src/lib/goal-evaluator.service.ts` (CREATE) — evidence builder + InternalQuery + parse
- `src/lib/goal-evidence.builder.ts` (CREATE) — bounded transcript window
- `src/lib/goal-stop-decider.ts` (CREATE) — implements `StopDecider`
- `src/lib/goal-evaluator.prompt.ts` (CREATE) — prompt + `outputFormat` schema + `GOAL_EVALUATOR_MODEL`

### Batch D — rpc-handlers wiring (depends A+C)

Executor: **SA-BE** · Mode: **sequential after C**

- `libs/backend/rpc-handlers/src/lib/handlers/goal-rpc.handlers.ts` (CREATE) + `goal-rpc.schema.ts` (CREATE)
- `libs/backend/rpc-handlers/src/lib/handlers/goal-notifier.ts` (CREATE) — GOAL\_\* push (pattern: `session-lifecycle-notifier.ts`)
- `libs/backend/rpc-handlers/src/lib/register-all.ts` (MODIFY :53) — add to `SHARED_HANDLERS`
- `libs/backend/rpc-handlers/src/lib/handlers/index.ts` (MODIFY) — barrel export

### Batch E — App container wiring (depends B+C+D)

Executor: **SA-BE** · Mode: **sequential**, small

- `apps/ptah-extension-vscode/.../container.ts`, `apps/ptah-electron/.../container.ts`, `apps/ptah-cli/.../container.ts` (MODIFY) — register goal-workflow, bind `GoalStopDecider` into `StopDecisionRegistry`, register `GoalRpcHandlers` + `GoalNotifier`

### Batch F — Frontend (PARALLELIZABLE with D/E once A lands)

Executor: **SA-FE** · Mode: **parallel** (after A)

- `libs/frontend/core/.../services/goal.store.ts` (CREATE) — signals
- `libs/frontend/core/.../services/goal-message.handler.ts` (CREATE) — `MESSAGE_HANDLERS` multi-provider
- `libs/frontend/core/.../services/index.ts` (MODIFY) — provider wiring
- `libs/frontend/chat/.../services/goal-command.service.ts` (CREATE) — parse/intercept + RPC + confirmations
- `libs/frontend/chat/.../services/chat-store/message-dispatch.service.ts` (MODIFY :57) — route `/goal`
- slash autocomplete source (MODIFY) — register `/goal` entry (feeds `slash-trigger.directive.ts`)
- `libs/frontend/chat/.../components/organisms/active-goal-indicator/*` (CREATE)
- `libs/frontend/chat/.../components/templates/chat-view.component.html` (MODIFY :9) — mount indicator
- session-bind hook (MODIFY) — call `goal:status` to hydrate on resume

### Batch G — Tests + docs (PARALLELIZABLE)

Executor: **SA-QA** (tests) + **CLI** (docs) · Mode: **parallel**

- goal-workflow unit specs, decider fail-open matrix, concurrency, persistence/resume specs
- rpc-handlers goal specs; frontend GoalCommandService/GoalStore specs
- docs: runtime-fetched (`ContentDownloadService` rule); **no trademarked AI names in VSIX-shipped non-JS files** (NFR Compliance)

**Coupling summary**: A→B→C→D→E is the critical spine (tightly coupled, sequential, capable executors). F runs parallel to D/E after A. G runs parallel once its target batch lands. CLI helpers suit lib scaffolding (project.json/tsconfig), docs, and self-contained "read file X, report exact type/signature" lookups — never the Stop-hook/decider logic.

---

## 8. Anti-pattern guardrails (honored)

- No backward-compat: `StopHookHandler` is modernized in place; no parallel "legacy stop path" (Scope §6).
- No cross-lib pollution: goal types live in `libs/shared`; agent-sdk exposes an interface, not a goal-workflow import; frontend never imports backend.
- No permission escalation: main agent still routes every tool through `SdkPermissionHandler`; the evaluator runs bypass-permissions in an isolated subprocess with tools denied (NFR Safety).
- Hook safety: every new branch in the Stop hook is inside the existing swallow-and-log try/catch → any throw degrades to `{ continue:true }` (NFR Resilience).
