# Implementation Plan (Part B: lane evaluation loop) - TASK_2026_646_136a

Pass B of 2. Scope: Requirement 5 (outcome record), 9 (Library Agents tab signals), 10 (failure class),
decision #23 (read seam to kept stores in place, telemetry and harvester independent of
`skillSynthesis.enabled`, `skillsLoaded`, handoff to TASK_2026_662_3eea). Pass A (routing) is out of scope.

## Inputs and constraints

- Requirements used: `task-description.md` § Scope (66-108), Req 5 (264-304), Req 9 (404-430), Req 10 (432-444),
  NFR (556-571), Proposed Removals (598-603), Open questions (621-636); `decisions.md` (whole, #12, #13, #18 as
  amended by #22, #19, #22, #23, #24); `context.md` § Scope additions 2 and 3 (102-147); `parity-inventory.md`.
- Research used: `research-codebase-survey.md` §2, §3, Reuse candidates, Gaps 1-8, Decisions 1 and 5;
  `research-runtime-survey.md` §1-§3, §7, orchestrator notes.
- Corrections applied: decision #22 supersedes the carve-out half of #18. No code moves: telemetry, verdicts,
  skill-load counting and the Library stay in `libs/backend/skill-synthesis` and `libs/frontend/skill-synthesis-ui`.
  Decision #24: anchors are against main `c57a9a1e7`.
- Design handoff used: none. Requirement 9 replaces one metric inside an existing card; no new surface, so no
  designer gate. The new metric block reuses the existing `metric` row markup of `clone-card.component.ts`.
- Out of scope (pass A): decision-model setting, `ptah_route_decide`, dispatchers, capability matrix, spread rule,
  family field definition, model discovery, System One client. Pass B only exposes the read port pass A consumes.
- Missing decision-critical input: none. Pass A assumed the read port
  `LaneOutcomeReader.recentOutcomes(laneId, { sinceMs })`; this part defines it concretely (Component 3); the
  integration pass reconciles names.

## Codebase evidence

All paths relative to the worktree root. "V" = opened this pass; "S" = taken from a survey anchor (not re-opened).

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Notifier constructor has logger, file system, optional agent adapter, no store (S) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:258-269` | Add one more optional injection (outcome recorder); lane completion never depends on it |
| `signal()` dedups on `${agentId}:${completedAt}` then builds the signal, then checks the parent (S) | same file `:292-297`, `:299`, `:305` | Write point: after `buildSignal` (:299), before the parent checks (:305): after dedup, so refusals are recorded too (Req 5.1) |
| APM passes a copy of `info` plus `{ reportsDelivered }` to the notifier (V) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:2529-2533` | The second `signal()` argument is the place to pass failure evidence without changing the signal content |
| APM already reads error segments and the last 16 KB of stdout to classify quota failures (V) | same file `:2391-2410` | The auth check reads the same texts at the same point; no new buffering |
| `AgentStatus = running/completed/failed/timeout/stopped`; `AgentFailureKind = 'quota'` only; verdict union (V) | `libs/shared/src/lib/types/agent-process.types.ts:43-44`, `:55`, `:538-539` | Failure class derives deterministically from status + failureKind + auth match + verdict (Req 10.2) |
| `SubagentStopPayload { subagentSessionId, parentSessionId, workspaceRoot, agentId, agentType, transcriptPath, timestamp }`; registry extends `CallbackRegistryBase` (V) | `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts:8-16`, `:21-26` | The outcome lib subscribes to the same registry independently of skill-synthesis; `agentId` is the subagent run key |
| Subagent telemetry is gated only by the telemetry flag, never by the master switch; `succeeded: true` hard-coded (V) | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:501-515` (`:510`), `:667-679` (`:675`); doc `:992-998` | Telemetry already runs with `skillSynthesis.enabled = false`; this task pins it with a test and adds `run_id`; `succeeded` is not read by the outcome record |
| Paused boot still starts the trigger (V) | `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:439-462`, `:480-482`, `:491-495` | No boot change needed for telemetry |
| Spec harvest is gated by the master switch, and only reached after the turn-complete flag and the rate limiter (V) | `skill-trigger.service.ts:476-489` (`:481`), `:446-474` (`:453-470`, `:473`), `:425-426` | Decouple: harvest from `onStop` on its own debounce, without the master switch, the turn-complete flag or the analyze rate limiter |
| Harvester writes spec verdicts into `skill_invocation_events` via `reconcileSubagentEvent` (V) | `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:92-129` (`:103-112`); `skill-candidate.store.ts:1354-1401` | "Spec verdicts" live on the event row (`succeeded`, `is_error`, `reconciled_at`, `verdict_source`); the seam reads them there |
| `recordSkillEvent` writes a fixed column list, ULID id generated inside (V) | `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:1168-1219` | Adding `run_id` = add one column to that list; nullable so old installs keep working |
| Event table schema (V) | `libs/backend/persistence-sqlite/src/lib/migrations/0021_skill_invocation_events.ts:2-11`; `0027_skill_event_reconciliation.ts:6-7`; `0030_skill_event_metrics.ts:14-21`; `0037_skill_invocation_session_join.ts:48-51` | Tokens, cost, duration, task id per row exist; session index exists; no per-run key exists → add `run_id` |
| `skill_session_verdicts` keyed by `session_id`, `evidence_class` CHECK (V) | `0034_skill_session_verdicts.ts:71-88` | Read-only for this task (no new writer); seam reads the evidence class for a run's own session when a row exists |
| Migrations: static SQL, nullable `ALTER ADD COLUMN`, append-only registry, last version 53 (V) | `migrations/0037_skill_invocation_session_join.ts:32-47`; `migrations/index.ts:84`, `:133`, `:388-391` | New migrations are 0054 and 0055 |
| Lazy SQLite-or-in-memory store selection by `isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` (V) | `libs/backend/task-specs/src/lib/di/register.ts:78-86` | Same pattern for the outcome store |
| VS Code host registers no SQLite connection; Thoth-free invariant is lint-enforced (V) | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:85-92`, `:107-108` | VS Code: in-memory outcome store (lost on restart, says so); the skill-synthesis adapter is never bound there |
| SQLite connection exposes `db`, `isOpen`, `onDidOpen` (V) | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:362`, `:450`, `:479` | Writes before the DB opens are dropped and logged, never queued forever, never thrown |
| Library is desktop-only (V) | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2285` | Agents-tab signals only need to render where the Library renders |
| Durable subagent handoff record when the budget monitor stops a subagent; monitor resolves `agentId` from its registry (V) | `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-record.ts:1-36`; `subagent-budget-monitor.ts:36`, `:518` | A budget stop is observable in agent-sdk by subagent `agentId` → subagent failure class source |
| `agent:` prefix already allowed (V) | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44`, `:66` | New webview method `agent:outcomeSignals` needs no prefix change |
| Batched scorecard precedent: one RPC per clone refresh, missing slug = "no data yet" (V) | `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:34-40`, `:72-84`; `skill-synthesis-rpc.service.ts:2`, `:128`, `:604-616`; `rpc.types.ts:2064-2067`, `:4058` | Signals load the same way, through `ClaudeRpcService` |
| Card metrics are a `computed` list with "Success" from `formatSuccessRate` (V) | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:401-439` (`:413-420`); inputs `:311-336`; drawer inputs `clone-detail-drawer.component.ts:430-455` | Replace the Success entry for `kind === 'agent'` only; new `outcomeSignals` input |
| Tags: cli-agent-runtime, task-specs, skill-synthesis = `scope:extension, type:feature`; persistence-sqlite = `scope:extension, type:util`; feature may depend on feature (V) | each `project.json:6`; `eslint.config.mjs:291-292`, `:407-415` | New lib `lane-outcomes` = `scope:extension, type:feature`; skill-synthesis → lane-outcomes and cli-agent-runtime → lane-outcomes are legal |

## Architecture decision

- Chosen approach: one new host-neutral backend lib, `libs/backend/lane-outcomes`, owns the outcome record: its
  store (SQLite in desktop and CLI, in-memory in VS Code), its recorder (write side), its reader (read side, the port
  pass A consumes) and the read seam port to the kept skill-synthesis stores. The seam is an interface + `Symbol.for`
  token declared in `lane-outcomes`; its only adapter lives in `libs/backend/skill-synthesis` and is bound only in
  Thoth hosts. Subagent tokens, cost, duration, spec verdict, session evidence and `skillsLoaded` are joined at READ
  time through the seam by the run key `run_id = SubagentStopPayload.agentId`; they are never copied into the
  outcome table. Lane records are written by the notifier after dedup; subagent records by a SubagentStop listener in
  `lane-outcomes`; review verdicts and declared subagent deliverables by one MCP tool, `ptah_outcome_report`.
- Rationale: Req 5.1 needs exactly one record per deduplicated completion, which only the notifier knows
  (`lane-completion-notifier.service.ts:292-299`). Req 5.4 needs a one-to-one join and forbids aggregates; the event
  table has no per-run key today (`0021`, `0030`, `0037`), so `run_id` is added in place. A read-time join removes the
  race between the SubagentStop listener and the asynchronous metrics extraction (`skill-trigger.service.ts:711-739`),
  picks up later harvester reconciliations, and means TASK_2026_662_3eea can delete the synthesis pipeline without
  touching `lane-outcomes` (context.md:135-138). VS Code must stay Thoth-free (`phase-2-libraries.ts:85-92`), so the
  record lib cannot import skill-synthesis; the dependency points skill-synthesis → lane-outcomes.
- Rejected alternatives:
  - Store inside `cli-agent-runtime`: the subagent writer, the Library RPC and pass A's routing would all depend on
    the lane runtime for a data record; it also deepens the `vscode-core` leak the runtime survey flags
    (`research-runtime-survey.md:152-153`).
  - Rows in skill-synthesis's own store (`skill_invocation_events` precedent): ties the record to the library
    TASK_2026_662_3eea trims, and VS Code has no Thoth store.
  - Copy subagent metrics into the outcome row at SubagentStop: the event row may not exist yet (metrics extraction
    is async, `skill-trigger.service.ts:713-726`), and later reconciliations would be missed.
  - Join by `(slug, session, time window)`: ambiguous for two same-agent runs in one session, which the Req 5.4
    fixture exercises.
- Assumptions (each has a check the implementer runs first):
  - A1: `SubagentStopPayload.agentId` is unique per subagent run. Check: the producer of the payload in agent-sdk
    (`ptah_code_search_symbols "SubagentStopCallbackRegistry notify"`) passes the SDK's per-run agent id, not the
    agent type. If it is not unique, use `subagentSessionId` as `run_id` instead; nothing else changes.
  - A2: The budget monitor can publish the stopped subagent's `agentId` at the stop (`subagent-budget-monitor.ts:518`
    resolves it from the registry for warnings). Check: read the stop path around `:36` and the `stopSubagent` call.
  - A3: Skill tool and prompt-expansion events of a subagent's nested session reach the PostToolUse /
    UserPromptExpansion registries with a session id the seam can match. Check: one capture test or a log line in a
    real subagent run. If they do not, `skillsLoaded` is `null` for subagents (never `[]`), as Req says for unknown.
  - A4: `AgentProcessInfo.role` holds the agent slug when a lane is spawned with a role file. Check: open
    `agent-process.types.ts:151` and the spawn path. If it does not, lane records do not count on Agents-tab cards.
- Effect on existing code: notifier gains one optional dependency and one guarded call; APM passes one more context
  field; skill-synthesis gains `run_id` on subagent events, a decoupled harvest path and the seam adapter; the
  Agents-tab "Success" entry is replaced for `kind === 'agent'` only. Nothing is deleted. `succeeded: true`
  (`:510`, `:675`) is left alone: it is TASK_2026_662_3eea's fix (context.md:142-143) and the record never reads it.

## Component specifications

Paths below are relative to `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\`.

### 1. Outcome contracts (shared types)

- Purpose: one definition of the record, its summary, the Agents-tab signals and the RPC contract, used by backend
  and webview.
- Responsibilities: types only plus the RPC registry entries. No logic.
- Verified contracts and entry points: reuses `LaneCompletionVerdict` (`agent-process.types.ts:538-539`) as the
  verdict type. RPC registry pattern `rpc.types.ts:2064-2067` (method → params/result) and the capability map
  `:4058`. Domain split rule: new RPC types go in a domain file under `libs/shared/src/lib/types/rpc/` (precedent
  `rpc/rpc-tasks.types.ts`, `rpc/rpc-skill-clone.types.ts`).
- Integration note (implementation-plan.md SC-1, SC-2, SC-4, SC-6): the canonical file content is in
  implementation-plan.md § Shared contracts. The changes from the block below:
  - `const` tuples for the enums.
  - `family: string` (non-null).
  - `SUBAGENT_LANE_ID` and `LANE_DEFAULT_MODEL`.
  - The `LaneOutcomeReader { recentOutcomes, isPersistent }` and `LaneFailureClassifier` interfaces move into
    this file.
  - `SpawnAgentRequest` and `AgentProcessInfo` gain `taskKind?` and `routingSource?`.
  This shared work is batch AB1, which absorbs B1.
- Contract (TypeScript, to be created in `lane-outcome.types.ts`):

```ts
export type OutcomeExecutorKind = 'cli' | 'ptah-cli' | 'subagent';
export type OutcomeTaskKind = 'plan' | 'implement' | 'review' | 'research' | 'tests' | 'docs';
export type LaneFailureClass = 'usage-limit' | 'auth' | 'crash' | 'timeout' | 'bad-output';
export type OutcomeRoutingSource = 'model' | 'ranking' | 'pin' | 'not-routed';
export type OutcomeFinalReview = 'approved' | 'rejected';
/** How a subagent record's tokens/cost/duration were obtained (Req 5.4). Lanes: 'not-applicable'. */
export type OutcomeTelemetryJoin = 'matched' | 'unmatched' | 'ambiguous' | 'unavailable' | 'not-applicable';

export interface LaneOutcomeRecord {
  readonly runId: string;            // lane: `${agentId}:${completedAt}` (the notifier dedup key); subagent: `subagent:${agentId}`
  readonly executorKind: OutcomeExecutorKind;
  readonly laneId: string;           // cli id, ptahCliId, or 'subagent'
  readonly agentId: string;
  readonly family: string | null;    // filled by pass A's family rule; null until known
  readonly provider: string | null;
  readonly model: string;            // as spawned; 'lane-default' when spawned without one
  readonly role: string | null;      // lane role; subagent slug
  readonly taskKind: OutcomeTaskKind | null;
  readonly taskId: string | null;
  readonly verdict: LaneCompletionVerdict;
  readonly failureClass: LaneFailureClass | null;
  readonly startedAt: number | null; // epoch ms
  readonly endedAt: number;          // epoch ms
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly routingSource: OutcomeRoutingSource;
  readonly reviseRounds: number;     // count of 'revise' verdicts; 0 is a real count, not "unknown"
  readonly finalReview: OutcomeFinalReview | null; // null = "not reviewed"
  readonly telemetryJoin: OutcomeTelemetryJoin;
  readonly skillsLoaded: readonly string[] | null; // null = unknown, never [] for unknown
  readonly sessionEvidenceClass: string | null;    // skill_session_verdicts.evidence_class for the run's session, if a row exists
}

/** The port pass A reads (Component 3). Text-free by construction. */
export type LaneOutcomeSummary = Pick<LaneOutcomeRecord,
  'runId' | 'laneId' | 'family' | 'model' | 'taskKind' | 'verdict' | 'failureClass' | 'finalReview' |
  'reviseRounds' | 'durationMs' | 'endedAt' | 'routingSource' | 'inputTokens' | 'outputTokens' | 'costUsd'>;

export interface OutcomeRatio { readonly numerator: number; readonly denominator: number; }
export interface AgentOutcomeSignals {
  readonly slug: string;
  readonly windowDays: number;
  readonly runCount: number;                       // records in window; 0 → UI "no data yet"
  readonly delivered: OutcomeRatio;                // Req 9.1 definition; denominator 0 → "no verified runs"
  readonly reviewPass: OutcomeRatio;               // denominator 0 → "not reviewed yet"
  readonly avgReviseRounds: number | null;         // one decimal; null when reviewPass.denominator === 0
  readonly topFailureClass: LaneFailureClass | null; // tie → newest latest occurrence; null → "no failures recorded"
}
```

- RPC contract (in `rpc/rpc-lane-outcome.types.ts`): `'agent:outcomeSignals'`: params
  `{ slugs: string[] }`, result `{ signals: Record<string, AgentOutcomeSignals>; windowDays: number; persistent:
  boolean }`. A slug with no records in W is absent from `signals` (same "missing = no data yet" rule as
  `skill-clones-state.service.ts:34-40`).
- Dependencies: none beyond existing shared types.
- Integration points: Components 3, 7, 8, 9; pass A imports `LaneOutcomeSummary` and `OutcomeTaskKind` (pass A may
  already define a task-kind union: the integration pass keeps one, in this file).
- Failure behaviour: not applicable (types).
- Quality requirements: no field may carry request text, prompt text, file contents or paths (Req 5.8).
- Verification seam: `npx nx typecheck shared`; the RPC registry compile check (`rpc.types.ts` capability map
  requires an entry for every method).
- Files: CREATE `libs/shared/src/lib/types/lane-outcome.types.ts`, CREATE
  `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts`; MODIFY `libs/shared/src/lib/types/rpc.types.ts`
  (method entry + capability map entry), MODIFY the shared barrel(s) that export types (`libs/shared/src/index.ts`
  or the types index it re-exports; implementer confirms which).

### 2. Schema migrations (persistence-sqlite)

- Purpose: persist outcome records; give subagent telemetry rows a per-run key.
- Responsibilities:
  - `0054_lane_outcome_records`: `CREATE TABLE IF NOT EXISTS lane_outcome_records` with columns `run_id TEXT PRIMARY
    KEY, executor_kind TEXT NOT NULL, lane_id TEXT NOT NULL, agent_id TEXT NOT NULL, family TEXT, provider TEXT,
    model TEXT NOT NULL, role TEXT, task_kind TEXT, task_id TEXT, verdict TEXT NOT NULL, failure_class TEXT,
    budget_stopped INTEGER NOT NULL DEFAULT 0, started_at INTEGER, ended_at INTEGER NOT NULL, duration_ms INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, routing_source TEXT NOT NULL DEFAULT 'not-routed',
    revise_rounds INTEGER NOT NULL DEFAULT 0, final_review TEXT, subagent_session_id TEXT, parent_session_id TEXT,
    workspace_root TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL`; indexes
    `(lane_id, ended_at DESC)`, `(role, ended_at DESC)`, `(agent_id, ended_at DESC)`. No `CHECK` on enum columns:
    SQLite cannot widen a CHECK without a rebuild (`0034_skill_session_verdicts.ts:29`); enums are validated by Zod
    at the write edge (Component 3).
  - `0055_skill_invocation_run_id`: `ALTER TABLE skill_invocation_events ADD COLUMN run_id TEXT;` +
    `CREATE INDEX IF NOT EXISTS idx_skill_inv_events_run ON skill_invocation_events(run_id);`. Nullable, no default,
    following `0037_skill_invocation_session_join.ts:32-47`.
- Verified contracts and entry points: `Migration` interface `migrations/index.ts:84`; registry `:133`; last entry
  v53 `:388-391`; static-SQL rule `0037:46-47`.
- Dependencies: none.
- Integration points: Component 3 (SQLite store), Component 6 (`run_id` writer and seam reader).
- Failure behaviour: the runner applies each version once (`0037:39-44`). A failed migration fails the DB open as for
  every other migration; the outcome store then reports `persistent: false` (Component 3).
- Quality requirements: static SQL only (ESLint `no-template-curly-in-migration`).
- Verification seam: one spec per migration in the `0037_*.spec.ts` style (applies on an in-memory DB, asserts
  columns and the index query plan); `npx nx test persistence-sqlite --parallel=1`.
- Files: CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts` (+ `.spec.ts`),
  CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0055_skill_invocation_run_id.ts` (+ `.spec.ts`), MODIFY
  `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`.

### 3. `lane-outcomes` library (store, recorder, reader, seam port)

- Purpose: own the outcome record end to end, host-neutral.
- Responsibilities:
  - `LaneOutcomeStore` interface with `SqliteLaneOutcomeStore` and `InMemoryLaneOutcomeStore`, selected lazily as in
    `task-specs/src/lib/di/register.ts:78-86`. Operations: `insertIfAbsent(row)`, `update(runId, patch)`,
    `get(runId)`, `findLatestByAgent(agentId)`, `findOpenSubagentRuns(slug, sinceMs)`, `listByLane(laneId, sinceMs)`,
    `listByRoles(slugs, sinceMs)`. `isPersistent(): boolean` (`true` only for SQLite with `isOpen`,
    `sqlite-connection.service.ts:450`).
  - `LaneOutcomeRecorder` (write side, every method never throws, logs and returns):
    `recordLaneCompletion(input: LaneCompletionOutcomeInput): void`;
    `recordSubagentStop(payload: SubagentStopPayload): void` (listener on the agent-sdk SubagentStop registry,
    registered by `startLaneOutcomes(container)`; writes `runId = subagent:${agentId}`, verdict `unverified`,
    `telemetryJoin` resolved at read time);
    `markSubagentBudgetStop(agentId: string): void` (listener on the new budget-stop registry, Component 5; upserts
    `budget_stopped = 1`, order-independent with the SubagentStop write because both upsert by `run_id`);
    `declareSubagentDeliverables(target, verdict, meta): Promise<OutcomeWriteResult>`;
    `attachReview(target, verdict): Promise<OutcomeWriteResult>`.
  - `LaneOutcomeReader` (the port pass A consumes, plus the Agents-tab query). Integration note (SC-2): the
    cross-lib port is the shared `LaneOutcomeReader { recentOutcomes, isPersistent }`. The interface below
    becomes `LaneOutcomeQueries extends LaneOutcomeReader`, adding `agentSignals` and `get`, and is registered
    under `LANE_OUTCOME_TOKENS.READER`. The recorder also injects the optional
    `LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER` port, which it calls once per new lane record with a null class
    (SC-4). `OutcomeReportArgsSchema` is SC-7 and lives only in this lib:

```ts
export interface LaneOutcomeReader {
  /** Records of one lane with endedAt >= window.sinceMs (absolute epoch ms), newest first. Never rejects:
   *  a store failure resolves [] and logs; callers combine with isPersistent() to say "no outcome history". */
  recentOutcomes(laneId: string, window: { readonly sinceMs: number }): Promise<readonly LaneOutcomeSummary[]>;
  /** Agents-tab signals for the given slugs over the last windowDays (W). Rejects on store failure (RPC shows error). */
  agentSignals(slugs: readonly string[], windowDays: number): Promise<Record<string, AgentOutcomeSignals>>;
  /** Full record including read-time joins, for tests and the report tool's echo. */
  get(runId: string): Promise<LaneOutcomeRecord | null>;
  isPersistent(): boolean;
}
```

  - `SkillTelemetrySeam` port (the read seam of decision #23, adapter in Component 6):

```ts
export interface SubagentRunTelemetry {
  readonly match: 'matched' | 'unmatched' | 'ambiguous';
  readonly inputTokens: number | null; readonly outputTokens: number | null;
  readonly costUsd: number | null; readonly durationMs: number | null;
  readonly taskId: string | null;
  readonly isError: boolean | null;          // row is_error after harvester reconciliation; null when unmatched
  readonly specVerdictSource: string | null; // verdict_source, e.g. 'spec:TASK_X' / 'spec-window:TASK_X'
}
export interface SkillTelemetrySeam {
  subagentRuns(runIds: readonly string[]): Promise<ReadonlyMap<string, SubagentRunTelemetry>>;
  skillsLoaded(scopes: readonly { runId: string; sessionId: string; fromMs: number; toMs: number }[]):
    Promise<ReadonlyMap<string, readonly string[] | null>>;
  sessionEvidence(sessionIds: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
}
```

  - Pure functions, one file each: `computeAgentSignals(records, windowDays)` (Req 9.1 rules exactly, including
    the tie-break by newest latest occurrence) and `applySubagentJoin(row, telemetry)` (sets tokens, cost,
    duration, `taskId` when the row has none, verdict `failed` when `isError === true` and no declared verdict
    overrides it (Req 5.5: an error row is `failed` regardless of declared paths), `telemetryJoin`).
  - Zod schemas at the write edge: `LaneOutcomeRowSchema` (enum columns, non-negative numbers, `model` non-empty)
    and `OutcomeReportArgsSchema` (Component 8). Invalid rows are dropped and logged, never partially written.
  - DI: `LANE_OUTCOME_TOKENS = { STORE, RECORDER, READER, SKILL_TELEMETRY_SEAM }`, each `Symbol.for('PtahLaneOutcome…')`
    (pattern `skill-synthesis/src/lib/di/tokens.ts:95`). `registerLaneOutcomeServices(container, logger)` and
    `startLaneOutcomes(container, logger)` (subscribes the two listeners; returns a disposer for host shutdown).
- Verified contracts and entry points: SubagentStop payload `subagent-stop-callback-registry.ts:8-16`; lazy store
  selection `task-specs/.../register.ts:78-86`; `PERSISTENCE_TOKENS.SQLITE_CONNECTION` (imported by task-specs,
  same file); connection `db`/`isOpen`/`onDidOpen` `sqlite-connection.service.ts:362,450,479`.
- Dependencies (direction → depends on): `@ptah-extension/shared`, `@ptah-extension/platform-core` (tokens),
  `@ptah-extension/persistence-sqlite` (tokens + connection type), `@ptah-extension/agent-sdk` (registry types and
  tokens). Logger (integration SC-9, replaces the vscode-core plan): `platform-core` has no logger token
  (verified). A local structural logger interface is passed to `registerLaneOutcomeServices(container, logger)`
  and registered under a lib-owned token. There is no `vscode-core` import. Must NOT import skill-synthesis, cli-agent-runtime, or any Thoth lib (VS Code is Thoth-free).
- Integration points: notifier (Component 4), skill-synthesis adapter (Component 6), RPC handler (Component 7), MCP
  report tool (Component 8), pass A routing (reads `LANE_OUTCOME_TOKENS.READER`).
- Failure behaviour: store unavailable or DB not yet open → write dropped with one `warn` log (ids only), lane
  completion unaffected (Req 5.9); seam unbound (VS Code) → subagent records `telemetryJoin: 'unavailable'`,
  metrics null, `skillsLoaded: null`; seam throws → same as unbound for that read, logged. Partial records are
  impossible: one INSERT per record; later facts are `UPDATE` patches on an existing `run_id`.
- Quality requirements: `recentOutcomes` and `agentSignals` are single indexed queries (the three indexes of
  0054); reads cap at 2 000 rows per lane / per slug set (log when capped). No timers, no polling.
- Verification seam: unit specs on the in-memory store and the pure functions; one SQLite-backed spec using the
  persistence-sqlite test helper used by the `0037` spec. Required tests: N distinct lane completions + 1 duplicate
  → N records (Req 5.1, driven through `recordLaneCompletion` with the same `runId`); two same-slug subagent runs
  in one session → each record carries its own row's tokens and the sums match (Req 5.4); review on unknown id →
  error naming the id, no write (Req 5.6); unknown values stored as null (Req 5.2); `skillsLoaded` null when seam
  unbound. `npx nx test lane-outcomes --parallel=1`.
- Files: CREATE `libs/backend/lane-outcomes/` (`project.json` with tags `scope:extension`, `type:feature`;
  `tsconfig*.json`, `jest.config.ts`, `src/index.ts`), `src/lib/store/lane-outcome.store.ts`,
  `src/lib/store/sqlite-lane-outcome.store.ts`, `src/lib/store/in-memory-lane-outcome.store.ts`,
  `src/lib/lane-outcome-recorder.service.ts`, `src/lib/lane-outcome-reader.service.ts`,
  `src/lib/skill-telemetry-seam.port.ts`, `src/lib/agent-signals.ts`, `src/lib/subagent-join.ts`,
  `src/lib/lane-outcome.schema.ts`, `src/lib/di/tokens.ts`, `src/lib/di/register.ts`, `src/lib/di/start.ts`, with
  a spec beside each logic file; MODIFY `tsconfig.base.json` (path alias `@ptah-extension/lane-outcomes`).

### 4. Lane write point and lane failure class (cli-agent-runtime)

- Purpose: write one record per deduplicated lane completion with a deterministic failure class (Req 5.1-5.3, 10.1-2).
- Responsibilities:
  - Pure `classifyLaneFailureClass(input): LaneFailureClass | null` in
    `limits/lane-failure-class.ts`: verdict `delivered`/`unverified` → null; `failureKind === 'quota'` → `usage-limit`;
    `status === 'timeout'` → `timeout`; `authMatched` → `auth`; `status === 'failed'` → `crash`;
    `status === 'completed'` with `no-deliverable` → `bad-output`; `status === 'stopped'` → null (a deliberate stop
    is not a lane failure). Order is the precedence.
  - Pure `matchesAuthFailure(texts: readonly string[]): boolean` in `limits/lane-auth-classifier.ts`: conservative
    case-insensitive patterns (`401`, `unauthori[sz]ed`, `not logged in`, `invalid api key`, `authentication
    (failed|required)`, `please (run|use) .*login`). Assumption: vendor wording varies; the pattern list is
    table-driven like `LaneLimitPattern` (`lane-limit-classifier.ts:84-90`, S) and extended by evidence only.
  - APM: compute `authMatched` from the same texts `classifyLaneFailure` reads (`agent-process-manager.service.ts:
    2395-2408`) on failed exits only, keep it on the tracked agent, and pass it in the `signal()` context next to
    `reportsDelivered` (`:2529-2533`).
  - Notifier: optional `@inject(LANE_OUTCOME_TOKENS.RECORDER, { isOptional: true })`; after `buildSignal` (:299)
    and before the parent checks (:305) call `recorder?.recordLaneCompletion({...})` inside its own `try/catch`. The
    input maps: `runId = dedup key`, `laneId = info.ptahCliId ?? info.cli`, `executorKind`, `agentId`, `model =
    info.model ?? 'lane-default'` (`agent-process.types.ts:140`, S), `provider = info.quotaOwner?.providerId ?? null`,
    `role`, `taskId` from `taskFolder` basename (`:125`, S), `verdict`, `failureClass`, times, `durationMs`, tokens
    and cost `null` (Req 5.3), and `taskKind ?? null` / `routingSource ?? 'not-routed'` from the SC-6 spawn
    fields, which APM copies from `SpawnAgentRequest` onto the tracked info in this batch. Integration notes:
    - `family = laneFamilyOf({ cli, ptahCliId, providerId: info.quotaOwner?.providerId })` (SC-5, IA-2).
    - The input also carries `status`, `failureKind` and `exitCode` for the SC-4 classifier. These fields
      are not persisted.
  - Export (not move) the notifier's deliverable stat helper and keep `sessionChildVerdictOf` exported (`:132-145`)
    so Component 8 applies the same disk rules (Req 5.5). Assumption A5: the helper behind `buildSignal`'s
    deliverable checks (`:512-520`, S) is a function of `IFileSystemProvider` + paths + spawn time; if it is a private
    method, lift it to a named export in the same file.
- Verified contracts and entry points: see Codebase evidence rows 1-5; `AgentStatus` `agent-process.types.ts:43-44`.
- Dependencies: cli-agent-runtime → lane-outcomes (new, legal per `eslint.config.mjs:407-415`).
- Integration points: Component 3 recorder; pass A adds `taskKind`/`routingSource` to the spawn record.
- Failure behaviour: recorder absent or throwing → logged once per completion, the signal path continues unchanged
  (Req 5.9). Refused deliveries are recorded too (write point is before the refusals).
- Quality requirements: no extra I/O on the completion path except the recorder call (synchronous enqueue; the
  SQLite write is sync better-sqlite3 and bounded to one row).
- Verification seam: notifier spec with a fake recorder: N completions + 1 duplicate → N `recordLaneCompletion`
  calls; recorder that throws → signal still delivered. Classifier table spec covering every row of the
  precedence list. `npx nx test cli-agent-runtime --parallel=1`.
- Files: CREATE `libs/backend/cli-agent-runtime/src/lib/limits/lane-failure-class.ts` (+ spec), CREATE
  `libs/backend/cli-agent-runtime/src/lib/limits/lane-auth-classifier.ts` (+ spec); MODIFY
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` (+ its spec), MODIFY
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`, MODIFY
  `libs/backend/cli-agent-runtime/src/index.ts` (export the deliverable helper if not exported).

### 5. Subagent budget-stop signal (agent-sdk)

- Purpose: make "Ptah stopped this subagent and left a handoff record" observable by subagent `agentId`
  (candidate subagent failure class, PR #728).
- Responsibilities: a `SubagentBudgetStopCallbackRegistry extends CallbackRegistryBase<{ agentId: string;
  parentSessionId: string; timestamp: number }>` (pattern `subagent-stop-callback-registry.ts:21-26`), registered
  in agent-sdk's DI with a `Symbol.for` token next to the SubagentStop registry token; `SubagentBudgetMonitor`
  notifies it once when its stop of a subagent is invoked with a record. Payload carries ids only, never handoff
  text (the record's own rule, `subagent-handoff-record.ts:34-35`).
- Verified contracts and entry points: `subagent-handoff-record.ts:1-36`; `subagent-budget-monitor.ts:36`, `:518`;
  registry base `subagent-stop-callback-registry.ts:3-6`. Assumption A2 (above).
- Dependencies: none new.
- Integration points: Component 3 listener maps it to `budget_stopped = 1`; the read-time failure class for a
  subagent record with `budget_stopped` and verdict `no-deliverable`/`failed` is `timeout` (see Decisions D6).
- Failure behaviour: a throwing listener is isolated by `CallbackRegistryBase` (Assumption: the base catches per
  callback; check `callback-registry.base.ts`); the stop proceeds regardless.
- Verification seam: monitor spec asserts one notify per stopped subagent and none for a withdrawn record.
  `npx nx test agent-sdk --parallel=1`.
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/subagent-budget-stop-callback-registry.ts` (+ spec);
  MODIFY `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` (+ spec), MODIFY
  `libs/backend/agent-sdk/src/lib/di/register.ts`, the agent-sdk tokens file and `libs/backend/agent-sdk/src/index.ts`.

### 6. Kept skill-synthesis stores, fixed in place (decision #23 items 1-3)

- Purpose: feed the outcome record from the kept stores without moving them, and keep them fed while
  `skillSynthesis.enabled` stays `false`.
- Responsibilities:
  - Run key: `onSubagentStop` passes `runId: payload.agentId` into `recordInvocation`
    (`skill-trigger.service.ts:506-514`), through `RecordSkillEventInput` (`skill-invocation-recorder.ts:35-46`) to
    `recordSkillEvent`, which adds `run_id` to its fixed column list (`skill-candidate.store.ts:1194-1218`). The
    Task PostToolUse branch (`:587-601`) writes `run_id = NULL`, so it can never make a join ambiguous.
  - Telemetry independence: already true (`:501-505`, `:571`, `:588`, `:668` read only the telemetry flag;
    `:992-998`; paused boot starts the trigger `boot-thoth-runtime.ts:480-482`). Pin it with a regression spec:
    master switch `false` + telemetry flag `true` → Skill, prompt-expansion and subagent events are recorded.
  - Harvester independence: remove the master-switch gate from `fireHarvest` (`:481`) and call it from `onStop`
    (`:425-428`) on its own per-workspace debounce (reuse `TURN_COMPLETE_DEBOUNCE_MS`), before the
    `readTurnCompleteEnabled()` return and outside the analyze rate limiter (`:453-470`). The turn-complete analyze
    path keeps its gates; it must no longer call `fireHarvest` (one caller only). The harvester is idempotent by
    marker and `reconciled_at` guard (`spec-harvester.service.ts:87-91`), so a second trigger path cannot
    double-write. Update the comment block at `:477-480` and the doc at `:995-997` to state the new rule.
  - Seam adapter `SkillTelemetrySeamAdapter implements SkillTelemetrySeam` in
    `libs/backend/skill-synthesis/src/lib/outcome-seam/`: `subagentRuns` = `SELECT … FROM skill_invocation_events
    WHERE source = 'subagent' AND run_id IN (…)` grouped per `run_id` (1 row → matched, 0 → unmatched, >1 →
    ambiguous with null metrics); `skillsLoaded` = distinct `skill_slug` where `source IN ('tool-use',
    'prompt-expansion') AND session_id = ? AND invoked_at BETWEEN ? AND ?` (served by `idx_skill_inv_events_session`,
    `0037:50`), returning `null` when capture is not proven for that session kind (Assumption A3), sorted, unique;
    `sessionEvidence` = `SELECT session_id, evidence_class FROM skill_session_verdicts WHERE session_id IN (…)`.
    Read-only; parameterised queries only. Bound to `LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM` inside
    `registerSkillSynthesisServices` (Thoth hosts only).
- Verified contracts and entry points: Codebase evidence rows 7-12.
- Dependencies: skill-synthesis → lane-outcomes (port + token only).
- Integration points: Component 3 reader; TASK_2026_662_3eea must keep `skill_invocation_events`,
  `skill_session_verdicts`, `SkillTriggerService` telemetry handlers, `SkillInvocationRecorder`,
  `SpecHarvesterService` and this adapter (see Handoff section).
- Failure behaviour: adapter query error → throws to the reader, which degrades that read to `unavailable`
  (Component 3). Harvest failure → existing debug log (`:484-487`).
- Quality requirements: `skillSynthesis.enabled` stays `false` in `~/.ptah/settings.json`; no new setting.
  Harvest runs at most once per debounce window per workspace.
- Verification seam: trigger spec (master off → harvest still runs on stop; turn-complete flag off → harvest still
  runs; rate limiter exhausted → harvest still runs; `runId` reaches the recorder for subagent stops only); store spec
  (run_id written; null for tool-use); adapter spec on an in-memory DB with two same-slug runs in one session
  (Req 5.4 fixture lives here and in Component 3). `npx nx test skill-synthesis --parallel=1`.
- Files: MODIFY `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` (+ spec),
  `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts` (+ spec),
  `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (+ spec), the skill-synthesis DI register file;
  CREATE `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts` (+ spec).

### 7. Agents-tab signals RPC (rpc-handlers)

- Purpose: serve `agent:outcomeSignals` to the Library.
- Responsibilities: handler validates `{ slugs }` with Zod (`z.object({ slugs: z.array(z.string().min(1).max(200))
  .max(500) }).strict()`, in `agent-outcome.schema.ts`, pattern `agent-rpc.schema.ts`), calls
  `reader.agentSignals(slugs, W)` with W = 30 days, returns `{ signals, windowDays: 30, persistent }`. Reader
  unregistered → returns `{ signals: {}, windowDays: 30, persistent: false }`.
- Verified contracts and entry points: `agent:` prefix `rpc-handler.ts:66`; registration file
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts` (exists, ptah_search_files); registry
  `rpc.types.ts:2064-2067`, `:4058`.
- Dependencies: rpc-handlers → lane-outcomes.
- Integration points: Component 9; guard specs `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`,
  `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, and the surface-composition spec (implementer locates
  it with `ptah_search_files "**/surface-composition.spec.ts"`).
- Failure behaviour: invalid params → `RpcUserError` with the Zod issue text (existing pattern); reader rejects →
  error result; the UI keeps cards without signals (Component 9).
- Quality requirements: one query per call regardless of slug count.
- Verification seam: handler spec (valid, invalid, reader missing, reader throws). `npx nx test rpc-handlers
  --parallel=1`.
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts` (+ spec), CREATE
  `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome.schema.ts`; MODIFY
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, MODIFY `rpc-allowlist.spec.ts`. The app
  guard specs (`rpc-surface.spec.ts`, Electron surface-composition) move to batch AB14 (integration R4b). The
  method name passes the TASK_2026_610 host-source guard (SC-8).

### 8. `ptah_outcome_report` MCP tool (vscode-lm-tools)

- Purpose: let the orchestrating agent declare a subagent's deliverables (Req 5.5) and attach review verdicts to any
  run (Req 5.6). This is the write channel Req 8's skill text calls; the skill text itself is outside pass B.
- Responsibilities: args (Zod `.strict()`, pattern `wait-tools-args.schema.ts:47-61`, S):

```ts
type OutcomeTarget =
  | { runId: string }                 // exact
  | { agentId: string }               // lane: newest record of that agent (a resumed lane's latest run)
  | { subagent: string };             // slug: the single open (no final review) subagent run of that slug in the
                                      // last 24 h; 0 → error "no open run for <slug>", >1 → error "ambiguous: pass runId"
type OutcomeReportArgs =
  | { kind: 'deliverables'; target: OutcomeTarget; paths: string[] /* ≤ 20, workspace-relative */;
      taskKind?: OutcomeTaskKind; taskId?: string; routingSource?: OutcomeRoutingSource }
  | { kind: 'review'; target: OutcomeTarget; verdict: 'approved' | 'rejected' | 'revise' };
```

  `deliverables`: the runner stats each path inside the workspace (reject `..` and absolute paths outside it),
  applies `sessionChildVerdictOf('completed', checks)` with the subagent's `startedAt` as spawn time (Component 4
  export), and calls `declareSubagentDeliverables`; paths are not stored (Req 5.8). `review`: `revise` increments
  `revise_rounds`; `approved`/`rejected` set `final_review`. Result echoes `{ runId, verdict | finalReview,
  reviseRounds }` so the agent can use `runId` later. Unknown target → MCP error naming it, nothing written (Req 5.6).
- Verified contracts and entry points (S, runtime survey §6): `MCPToolDefinition`
  (`mcp-core/types/mcp-protocol.types.ts:115-148`); builder example `agent-wait.tool.ts:36,72-123`; listing
  `protocol-dispatcher.ts:494-602`; dispatch `switch` `:1029`; deps `ProtocolHandlerDependencies` `:291-317`
  passed from `http-mcp-server.service.ts:389-405`; stdio `mcp-stdio/tool-builders.ts:92-126` and
  `agent-tool.dispatcher.ts:284-301`; system-prompt table `ptah-system-prompt.constant.ts:224-234`. Decision #24:
  dispatcher lines after `:524` shift +8.
- Dependencies: vscode-lm-tools → lane-outcomes; → cli-agent-runtime for the verdict helper (Assumption: already
  a dependency for the agent tools; check `project.json`/imports).
- Integration points: same dispatcher files pass A edits for `ptah_route_decide` → the team-leader sequences this
  batch after pass A's dispatcher batch or merges them (not parallel-safe with it).
- Failure behaviour: recorder unregistered → tool returns `{ recorded: false, reason: 'outcome store unavailable' }`
  (not an error: orchestration must continue). Store write failure → same shape, logged.
- Quality requirements: deferred (not eager) tool; result is a small JSON object (budget default).
- Verification seam: runner spec with a fake recorder and fake file system (target resolution, unknown id,
  ambiguous slug, path escape rejected, verdict rules). `npx nx test vscode-lm-tools --parallel=1`.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts`
  (+ spec; folder per the `agent-wait.tool.ts` location), importing `OutcomeReportArgsSchema` from
  lane-outcomes (integration SC-7: no second schema file). That is batch B10a. The edits to
  `protocol-dispatcher.ts`, `mcp-http/http-mcp-server.service.ts`, `mcp-stdio/tool-builders.ts`,
  `mcp-stdio/agent-tool.dispatcher.ts` and `ptah-system-prompt.constant.ts` (one table row) move to the merged
  batch AB9 (integration R2).

### 9. Library Agents tab outcome signals (skill-synthesis-ui)

- Purpose: replace "Success" on agent cards and the agent drawer with Req 9 signals.
- Responsibilities:
  - `SkillSynthesisRpcService.getAgentOutcomeSignals(slugs)` → `'agent:outcomeSignals'` through the injected
    `ClaudeRpcService` (pattern `skill-synthesis-rpc.service.ts:604-616`).
  - `SkillClonesStateService`: `agentOutcomeSignals = signal<Record<string, AgentOutcomeSignals>>({})` and
    `outcomeWindowDays = signal<number | null>(null)`, loaded in the same post-`refreshClones` step as
    `loadScorecards` (`skill-clones-state.service.ts:52-84`), one call for all agent slugs; failure → `{}` (cards
    show no signals, never a fabricated figure).
  - Pure formatter `formatAgentOutcomeSignals(signals | undefined, windowDays): CloneMetric[]` in
    `clones/agent-outcome-signals.ts`: absent or `runCount === 0` → one metric "Outcomes (30d): no data yet";
    otherwise "Delivered" `80% (4/5)` or "no verified runs"; "Review pass" `x% (n/d)` or "not reviewed yet";
    "Avg revise rounds" `1.5` hidden when review shows "not reviewed yet"; "Top failure" class or "no failures
    recorded". Window label "(last 30 days)" on the block. Whole-number percentages, `Math.round`.
  - `CloneCardComponent` and `CloneDetailDrawerComponent`: new `outcomeSignals = input<AgentOutcomeSignals |
    null>(null)` and `outcomeWindowDays = input<number | null>(null)`; in the metrics `computed`
    (`clone-card.component.ts:401-439`) the "Success" entry (`:413-420`) is emitted only when `c.kind !== 'agent'`;
    for agents the formatter's metrics are appended in its place. Same for the drawer (`:559-560`, parity row).
    Test ids `clone-metric-outcome-*`. `skill-clones-view.component.ts` passes the two inputs where it passes
    `[scorecard]` (`:313`, `:353`).
  - Components stay standalone, OnPush, signals, `inject()`; no new component (the metric row markup is reused).
- Verified contracts and entry points: Codebase evidence rows for clone card, drawer, state service and RPC service.
- Dependencies: skill-synthesis-ui → shared types only.
- Integration points: Component 7 contract.
- Failure behaviour: RPC failure → signals `{}`; the Skills and Commands tabs are untouched.
- Quality requirements: the metric list stays a pure `computed`; no per-card RPC; accessible text (values are text,
  not colour only).
- Verification seam: formatter spec covering every Req 9.1 branch and "no data yet"; `clone-card.component.spec.ts`
  and `clone-detail-drawer.component.spec.ts` new cases: two agents with different records show different signals
  (Req 9.5); agent card has no "Success"; skill and command cards keep "Success" unchanged (Req 9.3); Invocations,
  Last enhanced, History and the scorecard badge still render (Req 9.4); state-service spec for the batched load.
  `npx nx test skill-synthesis-ui --parallel=1`.
- Files: CREATE `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-outcome-signals.ts` (+ spec);
  MODIFY `clone-card.component.ts` (+ spec), `clone-detail-drawer.component.ts` (+ spec),
  `skill-clones-view.component.ts`, `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`
  (+ spec), `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts` (+ spec).

### 10. Host wiring (three composition roots)

- Purpose: register and start `lane-outcomes` in every host.
- Responsibilities: call `registerLaneOutcomeServices(container, logger)` before `registerCliAgentRuntimeServices`
  in `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` (`registerCliAgentRuntimeServices` call `:216`, S),
  `apps/ptah-electron/src/di/phase-2-libraries.ts` (`:305`, S) and `libs/backend/cli-engine/src/lib/container.ts`
  (`:736`, S); call `startLaneOutcomes` after the agent-sdk registries exist, keeping its disposer on the host's
  shutdown path. Update `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` and the three
  `container.smoke.spec.ts` files.
- Verified contracts and entry points: S anchors above; the pattern rule in the architect brief (phased roots).
- Dependencies: apps → lane-outcomes.
- Failure behaviour: registration cannot fail at runtime (lazy factories); start failure is logged and non-fatal.
- Verification seam: the smoke specs resolve the four tokens in each host; VS Code resolves the in-memory store and
  no seam. `npx nx test ptah-extension-vscode --parallel=1`, `npx nx test ptah-electron --parallel=1`,
  `npx nx test cli-engine --parallel=1`, one at a time.
- Files: MODIFY the three composition-root files above, `expected-resolvable.ts`, and the smoke specs under
  `apps/ptah-extension-vscode/src/di/`, `apps/ptah-electron/src/di/`, `apps/ptah-cli/src/di/`.

## Integration architecture

- Data flow, lane run: CLI process exits → APM classifies quota (`:2391-2410`) and auth (new) on failed exits →
  `signalLaneCompletion` (`:2529-2533`) → notifier `signal()` dedups (`:292-297`) → `buildSignal` (`:299`) →
  `recorder.recordLaneCompletion` (new, try/catch) → existing parent checks and delivery (`:305-356`, unchanged).
- Data flow, subagent run: SDK SubagentStop → agent-sdk registry → (a) skill-synthesis `onSubagentStop` records the
  telemetry row with `run_id = agentId` (async, metrics from transcript); (b) `lane-outcomes` listener inserts the
  record `subagent:${agentId}` (verdict `unverified`). Budget stop (if any) → budget-stop registry → `budget_stopped
  = 1`. Later: orchestrator calls `ptah_outcome_report` `deliverables` → verdict from disk rules; spec harvester (on
  `onStop`, ungated) reconciles the telemetry row's `is_error` from `batches.md`; orchestrator calls
  `ptah_outcome_report` `review` → `revise_rounds` / `final_review`.
- Data flow, read: pass A routing → `LaneOutcomeReader.recentOutcomes(laneId, { sinceMs })`; Library →
  `agent:outcomeSignals` → `reader.agentSignals(slugs, 30)`. For subagent rows the reader calls the seam once per
  query (batched `run_id IN (…)`), applies `applySubagentJoin`, then the failure class rule for subagents: verdict
  `failed`/`no-deliverable` with `budget_stopped` → `timeout`; with `isError === true` → `crash`; otherwise null
  (Req 10.1 allows null when undetermined).
- State or persistence: `lane_outcome_records` in the shared Thoth SQLite DB (desktop, CLI), owned by
  `lane-outcomes`; lifetime unbounded (one small row per run; retention is a follow-up, see Decisions D9). VS Code:
  in-memory, per process, `persistent: false` surfaced to pass A (NFR compatibility) and to the RPC.
  `skill_invocation_events.run_id` owned by skill-synthesis; read-only access through the seam.
- External boundaries: MCP tool args (Zod strict; paths confined to the workspace; ≤ 20 paths); RPC params (Zod
  strict; ≤ 500 slugs); write-edge row schema. All SQL parameterised. Logs carry ids, never text (Req 5.8).
- Failure and rollback: every write is best-effort and isolated (Req 5.9). A failed write leaves no row (single
  INSERT); a failed patch leaves the previous row. Migrations are forward-only like every other in the directory;
  rollback of the feature = unregistering `lane-outcomes` (reader absent → pass A uses seed/neutral; RPC returns
  `persistent: false`).
- Observability: one `warn` per dropped write with `{ runId, reason }`; `debug` per recorded run; the report tool
  echoes the stored state; `isPersistent()` makes "no history because no store" distinguishable from "no history".

## Resolutions of "Open — architect" items (pass B)

| Item (task-description.md) | Resolution |
| --- | --- |
| Window W (9.1, :625) | 30 days, fixed in the RPC handler and returned as `windowDays`; the card labels "last 30 days". Matches context.md:144-146 (about 30 days of records before evidence-driven patches). |
| Where outcome records live, and VS Code persistence (:626-627) | New table `lane_outcome_records` in the existing SQLite DB (migration 0054), owned by new lib `lane-outcomes`. VS Code has no SQLite (`phase-2-libraries.ts:85-92`): in-memory store, `persistent: false`, records lost on restart. The Library is desktop-only (`skills-synthesis-rpc.handlers.ts:2285`), so the Agents tab is unaffected. |
| Subagent run join key (5.4, :628) | `run_id = SubagentStopPayload.agentId`, written on the telemetry row by migration 0055 + `onSubagentStop`; outcome `runId = subagent:${agentId}`. Exactly one row → `matched`; 0 → `unmatched`; > 1 → `ambiguous`; no seam → `unavailable`. Assumption A1. |
| Lane run id and review attachment (5.6) | `runId = ${agentId}:${completedAt}` (the notifier dedup key). The completion envelope is not changed (out of scope), so the report tool also accepts `agentId` (newest run) and `subagent` slug (single open run). |
| Failure class sources (10.1-10.2) | Lanes: deterministic precedence in Component 4. Subagents: `budget_stopped` → `timeout`, telemetry `is_error` → `crash`, else null. No decision-model call in pass B; Req 10.3 (decision-model classification) is pass A's pipeline and may only fill a null class. |
| Durable subagent handoff records as failure class (decision #24) | Adopted as the `budget_stopped` signal (Component 5) mapped to `timeout`; see D6. |
| `skillsLoaded` (context.md:119-120) | Read-time through the seam for subagents; `null` for lanes (rival CLIs report no Skill events to Ptah) and wherever capture is unproven (A3). Never `[]` for unknown. |

## Architecture-level quality requirements

- Functional: N completions + 1 duplicate → N records; two same-agent subagent runs keep their own figures; unknown
  values are null; review on unknown id writes nothing and names the id; Agents-tab signals differ between two
  agents with different records; Skills/Commands "Success" unchanged; telemetry and harvest run with
  `skillSynthesis.enabled = false`.
- Performance: the completion path gains one synchronous single-row insert; reads are one indexed query (+ one
  batched seam query); the Library makes one extra RPC per clone refresh.
- Security: no request text, prompt text, file contents or deliverable paths stored or logged; MCP paths confined to
  the workspace; parameterised SQL; static migration SQL.
- Maintainability: `lane-outcomes` imports no Thoth lib and no cli-agent-runtime; skill-synthesis depends on
  `lane-outcomes`, never the reverse; new project tagged `scope:extension`, `type:feature`; no suppression of the
  boundary rule; files small and single-purpose.
- Testability: every pure rule (failure class precedence, auth match, signals, join) has a table spec; every write
  edge has a "dependency missing" and "dependency throws" spec.

## Proposed batches (pass B)

Library Nx project names carry the scope prefix (verified in each `project.json:2`): `@ptah-extension/shared`,
`@ptah-extension/agent-sdk`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/skill-synthesis-ui`,
`@ptah-extension/cli-engine`; apps are `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`. The short names in the
component verification seams map to these (implementer confirms `persistence-sqlite`, `cli-agent-runtime`,
`skill-synthesis`, `rpc-handlers` the same way). One heavy check at a time; `--parallel=1`; Jest `--maxWorkers=2`.

> Integration note: implementation-plan.md § Batches supersedes this table. The changes:
> - B1 is merged into AB1.
> - B9 is merged into AB14 with part A's host wiring.
> - B10 is split into B10a (the tool module only) and the merged registration batch AB9.
> - B7 runs after A10 because both edit `register-shared-rpc-handlers.ts`.
> - B3 runs before A13 because both edit the agent-sdk DI files.
> - The cross-pass `taskKind`/`routingSource`/`family` fields are delivered by AB1, A1b and B5 (SC-6).

| Batch | Component | Files (summary) | Nx project / verify | Depends on | CLI lane? |
| --- | --- | --- | --- | --- | --- |
| B1 | 1 | `libs/shared/src/lib/types/lane-outcome.types.ts`, `rpc/rpc-lane-outcome.types.ts`, `rpc.types.ts`, barrel | `npx nx typecheck @ptah-extension/shared` then `npx nx test @ptah-extension/shared --parallel=1` | none | yes (small, file-disjoint) |
| B2 | 2 | migrations 0054, 0055 (+ specs), `migrations/index.ts` | `npx nx test @ptah-extension/persistence-sqlite --parallel=1` | none | yes; parallel with B1, B3 |
| B3 | 5 | agent-sdk budget-stop registry, monitor notify, DI, barrel | `npx nx test @ptah-extension/agent-sdk --parallel=1` | none | yes; parallel with B1, B2 |
| B4 | 3 | new lib `libs/backend/lane-outcomes/**`, `tsconfig.base.json` alias | `npx nx test @ptah-extension/lane-outcomes --parallel=1` + `npx nx lint @ptah-extension/lane-outcomes` | B1, B2, B3 | yes (largest; one lane) |
| B5 | 4 | cli-agent-runtime classifiers, notifier, APM, barrel | `npx nx test @ptah-extension/cli-agent-runtime --parallel=1` | B1, B4 | yes; parallel with B6, B7 |
| B6 | 6 | skill-synthesis trigger, recorder, store, seam adapter, DI | `npx nx test @ptah-extension/skill-synthesis --parallel=1` | B2, B4 | yes; parallel with B5, B7 |
| B7 | 7 | rpc-handlers handler + schema + registration + guard specs | `npx nx test @ptah-extension/rpc-handlers --parallel=1` (guard specs in apps run in B9) | B1, B4 | yes; parallel with B5, B6 |
| B8 | 9 | skill-synthesis-ui formatter, card, drawer, view, state, RPC service | `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1` | B1 (contract only; can start after B1) | yes; parallel with B4-B7 |
| B9 | 10 | three composition roots, `expected-resolvable.ts`, smoke specs, `rpc-surface.spec.ts` | `npx nx test ptah-extension-vscode --parallel=1`, then `ptah-electron`, then `@ptah-extension/cli-engine` / `ptah-cli`, one at a time | B4, B5, B6, B7 | in-process preferred (touches composition roots shared with pass A) |
| B10 | 8 | `ptah_outcome_report` tool, both dispatchers, HTTP deps, system-prompt row | `npx nx test @ptah-extension/vscode-lm-tools --parallel=1` | B4, B5; and pass A's dispatcher batch | NOT parallel with pass A's dispatcher batch (same files) |

## Team-leader handoff

- Recommended executors: B1, B2, B3, B4, B5, B6, B7, B10 → backend-developer (server-side contracts, store,
  migrations, DI); B8 → frontend-developer (Angular signals/OnPush); B9 → backend-developer in-process (composition
  roots and smoke specs need cross-host judgment).
- Complexity: HIGH overall (8 projects, a new lib, two migrations, two cross-pass integration points); each batch is
  LOW-MEDIUM.
- Dependencies and ordering: component-level only, as in the table. Cross-pass: pass A adds `taskKind` /
  `routingSource` (and `family`) to the lane spawn record; until it lands, Component 4 writes `null` /
  `'not-routed'` / `null`. Pass A's dispatcher batch and B10 edit the same four files; B9 and pass A's host wiring may
  edit the same composition roots.
- Parallel-safe work: {B1, B2, B3, B8-after-B1} first; then B4; then {B5, B6, B7}; then B9; B10 last or merged with
  pass A's dispatcher batch.
- Files affected:
  - CREATE: `libs/shared/src/lib/types/lane-outcome.types.ts`; `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts`;
    `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts` (+ spec);
    `libs/backend/persistence-sqlite/src/lib/migrations/0055_skill_invocation_run_id.ts` (+ spec);
    `libs/backend/lane-outcomes/**` (Component 3 list); `libs/backend/agent-sdk/src/lib/helpers/subagent-budget-stop-callback-registry.ts` (+ spec);
    `libs/backend/cli-agent-runtime/src/lib/limits/lane-failure-class.ts` (+ spec);
    `libs/backend/cli-agent-runtime/src/lib/limits/lane-auth-classifier.ts` (+ spec);
    `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts` (+ spec);
    `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts` (+ spec), `agent-outcome.schema.ts`;
    `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts` (+ spec, + args schema);
    `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-outcome-signals.ts` (+ spec).
  - MODIFY: `libs/shared/src/lib/types/rpc.types.ts`, shared barrel; `migrations/index.ts`; `tsconfig.base.json`;
    agent-sdk monitor, DI register, tokens, barrel; notifier, APM, cli-agent-runtime barrel; skill-trigger service,
    invocation recorder, skill-candidate store, skill-synthesis DI register; `register-shared-rpc-handlers.ts`,
    `rpc-allowlist.spec.ts`, `rpc-surface.spec.ts`, surface-composition spec; `protocol-dispatcher.ts`,
    `http-mcp-server.service.ts`, `tool-builders.ts`, `agent-tool.dispatcher.ts`, `ptah-system-prompt.constant.ts`;
    clone card, drawer, clones view, clones state service, skill-synthesis RPC service (+ specs); three composition
    roots, `expected-resolvable.ts`, three `container.smoke.spec.ts`.
  - REWRITE: none. DELETE: none.
- Verification points: resolve A1-A5 before the batch that depends on each (A1 → B6/B4, A2 → B3, A3 → B6, A4 → B8
  acceptance, A5 → B5/B10); `npx nx lint` on every changed project (boundary rule); di-lint and `validate-deps` run
  on push (pre-push hook).

## Handoff to TASK_2026_662_3eea

TASK_2026_662_3eea deletes in place (its context.md:35-45). This task's code depends on the following, which that
task must keep, or must move with the dependency intact:

| Keep | Where | Why |
| --- | --- | --- |
| Table `skill_invocation_events` incl. columns `run_id` (0055), `is_error`, `reconciled_at`, `verdict_source`, metrics, `task_id`, `session_id` | persistence-sqlite migrations 0021/0027/0030/0037/0055 | Seam reads subagent metrics, spec verdicts and `skillsLoaded` from it. Never in the drop list (its context.md:42-43 does not list it; keep it that way) |
| Table `skill_session_verdicts` | migration 0034 | Seam reads `evidence_class`. Its writer is in `archaeology/` (`session-verdict.store.ts:81`), which 662 deletes → the table becomes historical/read-only; the seam reads it with its own SQL, so deleting `archaeology/` does not break this task |
| `SkillTriggerService` handlers `onSubagentStop` (telemetry half), `onPostToolUse` Skill/Task branches, `onUserPromptExpansion`, `onStop` → harvest, `recordInvocation`, `readSkillInvocationTelemetryEnabled` | `skill-trigger.service.ts` | Sole writers of telemetry rows and the harvest trigger; analyze/boot-scan/rate-limit paths around them may go |
| `SkillInvocationRecorder` | `skill-invocation-recorder.ts` | Writes `run_id`. (Distinct from `SkillInvocationTracker`, which 662 deletes) |
| `SkillCandidateStore.recordSkillEvent` and `reconcileSubagentEvent` | `skill-candidate.store.ts:1168-1219`, `:1354-1401` | They live in the candidates store class; if 662 deletes candidates, move these two methods (and the scorecard reads the Library needs) to an events store in the same lib before deleting the class |
| `SpecHarvesterService` | `spec-harvester.service.ts` | Writes spec verdicts onto event rows |
| `SkillTelemetrySeamAdapter` and its binding to `LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM` | `skill-synthesis/src/lib/outcome-seam/` | The read seam; if it is unbound, subagent records degrade to `unavailable` (no crash, but Req 5.4 data is lost) |
| `AgentScorecard` / getScorecards | parity-inventory row "Scorecard badge" | Kept on agent cards (Req 9.4) |

Notes for that task: its `succeeded → null` fix (its context.md:26-27) does not affect this task (the record never
reads `succeeded`; it reads `is_error`). Its "Enhance now" before/after check should call `agent:outcomeSignals`
(Component 7). Its proposal to replace Skills/Commands "Success %" reopens decision #13 and is the user's to approve
there, not here. New-skill suggestions are deleted by that task; this task adds nothing to them.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | New lib `libs/backend/lane-outcomes` (`scope:extension`, `type:feature`) owns the record | inside cli-agent-runtime; inside skill-synthesis store | VS Code Thoth-free (`phase-2-libraries.ts:85-92`); feature→feature legal (`eslint.config.mjs:407-415`); 662 trims skill-synthesis | yes |
| D2 | SQLite in desktop/CLI, in-memory in VS Code, chosen lazily | SQLite only; no VS Code support | `task-specs/.../register.ts:78-86` precedent; NFR "host without persistence still routes" | yes |
| D3 | Subagent join key `run_id = agentId`, new nullable column | session + time window; `subagentSessionId` | Req 5.4 two-run fixture; payload fields `subagent-stop-callback-registry.ts:8-16`; A1 fallback named | yes (migration additive) |
| D4 | Subagent metrics, spec verdict, evidence and `skillsLoaded` joined at read time, never copied | copy at SubagentStop | metrics extraction is async (`skill-trigger.service.ts:711-739`); harvester reconciles later; keeps 662's deletions off this code | yes |
| D5 | Lane failure class = deterministic precedence; `stopped` → null; auth by a conservative table-driven matcher | decision model; treat `stopped` as crash | Req 10.2; `AgentStatus` `agent-process.types.ts:43-44`; quota classifier precedent `:2391-2410` | yes |
| D6 | Budget-stopped subagent (handoff record) counts as `timeout` | null; add a sixth class | five classes are fixed by Req 10.1; a budget stop is a host-enforced run bound, the nearest class; adding a class would change the requirement | yes (one mapping line) |
| D7 | W = 30 days | 7; 90; configurable | context.md:144-146 ("about 30 days of outcome records") | yes |
| D8 | Agents-tab signals count records whose `role` equals the slug, both subagent and lane executors | subagents only | a lane spawned with a role file runs that agent definition; A4 guards it | yes |
| D9 | No retention/pruning in this task | prune after N days | one small row per run; no requirement; avoids a timer | yes |
| D10 | Write channel for Req 5.5/5.6 = one MCP tool `ptah_outcome_report` accepting `runId`, `agentId` or `subagent` slug | change the completion envelope to carry `runId` | envelope content is out of scope (task-description.md:96-98) | yes |
| D11 | `succeeded: true` left as is | fix here | context.md:142-143 assigns it to 662; the record does not read it | n/a |
| D12 | No `CHECK` constraints on enum columns; Zod at the write edge | CHECK in SQL | `0034_skill_session_verdicts.ts:29` (CHECK cannot be widened) | yes |

## Clarifications Needed

None. No capability is removed by pass B beyond the Agents-tab "Success" figure already approved (decision #13).
The table list of TASK_2026_662_3eea's data drop is that task's user approval, not this one.
