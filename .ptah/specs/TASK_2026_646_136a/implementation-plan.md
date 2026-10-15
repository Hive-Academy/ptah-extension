# Implementation Plan - TASK_2026_646_136a (integrated)

Status: integration pass, revised after Gate 2 review round 1 (see § Revision log). `implementation-plan-part-a.md` (routing) and `implementation-plan-part-b.md`
(evaluation loop) are normative sections of this plan. Where this file and a part disagree, this file wins.
Both parts carry short "Integration note" markers where this pass changed them.

## Overview and component map

The task adds two host-neutral backend libraries that do not import each other:

- `libs/backend/lane-routing` (part A) decides. It ranks lanes and subagents from the capability matrix,
  the outcome history, the spread rule and hard constraints. When a decision model is set, the model refines
  that ranking (decision #12). It exposes `ptah_route_decide` and, after this pass, the decision-model
  failure classifier for Req 10.3.
- `libs/backend/lane-outcomes` (part B) records. It writes one outcome record per lane or subagent run and
  serves the history read port routing uses. It also serves the Agents-tab signals and the
  `ptah_outcome_report` write channel. The read seam into the skill-synthesis stores, which stay where they
  are, is an adapter that lives in `skill-synthesis`.

The two libraries meet in three places only: shared types in `@ptah-extension/shared`, two token aliases in
the three composition roots, and the orchestration skill text. Dependency direction (all edges are new
unless marked existing; every edge is legal under `scope:extension` / `type:feature`,
`eslint.config.mjs:407-415`):

```
shared <- lane-routing <- { vscode-lm-tools, rpc-handlers, agent-sdk, apps }
shared <- lane-outcomes <- { cli-agent-runtime, skill-synthesis, rpc-handlers, vscode-lm-tools, apps }
lane-outcomes -> { platform-core, persistence-sqlite, agent-sdk }        (no edge to lane-routing)
lane-routing  -> { platform-core }                                     (no edge to lane-outcomes)
cli-agent-runtime -> agent-sdk (existing, capability-resolver.service.ts); agent-sdk imports neither
cli-agent-runtime nor vscode-lm-tools nor skill-synthesis (verified by grep), so lane-outcomes -> agent-sdk
and agent-sdk -> lane-routing close no cycle.
```

| Component | Lib | Nx project | Part section |
| --- | --- | --- | --- |
| Lane family (`laneFamilyOf`, row `family`) | shared, vscode-lm-tools | `@ptah-extension/shared`, `@ptah-extension/vscode-lm-tools` | A §1 |
| Outcome contracts and RPC types | shared | `@ptah-extension/shared` | B §1, superseded in part by § Shared contracts |
| Spawn routing fields (`taskKind`, `routingSource`) | shared, vscode-lm-tools, cli-agent-runtime | three projects | this file § Shared contracts (new) |
| `lane-routing` scaffold, DI, constants | lane-routing | `@ptah-extension/lane-routing` | A §2, § Routing constants |
| Capability matrix (seed, store, local derivation) | lane-routing | `@ptah-extension/lane-routing` | A §3 |
| Ranking engine (constraints, score, spread, rotation) | lane-routing | `@ptah-extension/lane-routing` | A §4 |
| Decision-model settings, System One client, payload | lane-routing | `@ptah-extension/lane-routing` | A §5 |
| Route decide pipeline | lane-routing | `@ptah-extension/lane-routing` | A §6 |
| Reasons and confidence | lane-routing | `@ptah-extension/lane-routing` | A §7 |
| Decision-model failure classifier (Req 10.3) | lane-routing | `@ptah-extension/lane-routing` | this file (new, batch A16) |
| MCP `ptah_route_decide` | vscode-lm-tools | `@ptah-extension/vscode-lm-tools` | A §8 |
| Lane model listing adapter | rpc-handlers | `@ptah-extension/rpc-handlers` | A §9 |
| Structured-output adapter | agent-sdk | `@ptah-extension/agent-sdk` | A §10 |
| Decision model settings row | shared, rpc-handlers, chat | three projects | A §11 |
| Migrations 0054, 0055 | persistence-sqlite | `@ptah-extension/persistence-sqlite` | B §2 |
| `lane-outcomes` store, recorder, reader, seam port | lane-outcomes | `@ptah-extension/lane-outcomes` | B §3 |
| Lane write point, failure class | cli-agent-runtime | `@ptah-extension/cli-agent-runtime` | B §4 |
| Subagent budget-stop signal | agent-sdk | `@ptah-extension/agent-sdk` | B §5 |
| Kept skill-synthesis stores, fixed in place (#23) | skill-synthesis | `@ptah-extension/skill-synthesis` | B §6 |
| `agent:outcomeSignals` RPC | rpc-handlers | `@ptah-extension/rpc-handlers` | B §7 |
| MCP `ptah_outcome_report` | vscode-lm-tools | `@ptah-extension/vscode-lm-tools` | B §8 |
| Library Agents-tab signals | skill-synthesis-ui | `@ptah-extension/skill-synthesis-ui` | B §9 |
| Host wiring and guard specs (both libs) | apps, cli-engine | `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`, `@ptah-extension/cli-engine` | A §12 + B §10, merged here (AB14) |
| Orchestration skill integration | plugin assets | none (docs) | A §13, Req 8.7 call sites set here |

Nx project names: part B verified the `@ptah-extension/` prefix in `project.json:2` for shared, agent-sdk,
vscode-lm-tools, skill-synthesis-ui and cli-engine. Each batch confirms the name for its own project before
running a command. The two new libs are named `@ptah-extension/lane-routing` and
`@ptah-extension/lane-outcomes`.

## Shared contracts

Each contract is stated once, here. The parts refer to it.

### SC-1 Outcome vocabulary and record: `libs/shared/src/lib/types/lane-outcome.types.ts` (batch AB1)

Part B §1 is the base. This pass changed four things: it adds `const` tuples so each lib's Zod schemas use
one source for the enums, makes `family` non-null, adds the two named constants, and moves the two port
interfaces (SC-2, SC-4) into this file.

```ts
import type { AgentStatus, LaneCompletionVerdict } from './agent-process.types';

export const OUTCOME_TASK_KINDS = ['plan', 'implement', 'review', 'research', 'tests', 'docs'] as const;
export type OutcomeTaskKind = (typeof OUTCOME_TASK_KINDS)[number];
export const LANE_FAILURE_CLASSES = ['usage-limit', 'auth', 'crash', 'timeout', 'bad-output'] as const;
export type LaneFailureClass = (typeof LANE_FAILURE_CLASSES)[number];
export const OUTCOME_ROUTING_SOURCES = ['model', 'ranking', 'pin', 'not-routed'] as const;
export type OutcomeRoutingSource = (typeof OUTCOME_ROUTING_SOURCES)[number];
export type OutcomeExecutorKind = 'cli' | 'ptah-cli' | 'subagent';
export type OutcomeFinalReview = 'approved' | 'rejected';
export type OutcomeTelemetryJoin = 'matched' | 'unmatched' | 'ambiguous' | 'unavailable' | 'not-applicable';

/** Executor id of every subagent record (Req 5.2 "or `subagent`"); the slug is in `role`. */
export const SUBAGENT_LANE_ID = 'subagent';
/** Model value of a run spawned without a model (Req 5.2); routing treats it as its own model key. */
export const LANE_DEFAULT_MODEL = 'lane-default';

export interface LaneOutcomeRecord {
  readonly runId: string;            // lane `${agentId}:${completedAt}` (notifier dedup key); subagent `subagent:${agentId}`
  readonly executorKind: OutcomeExecutorKind;
  readonly laneId: string;           // cli id, ptahCliId, or SUBAGENT_LANE_ID
  readonly agentId: string;
  readonly family: string;           // laneFamilyOf(...) at write time (SC-5); SUBAGENT_FAMILY for subagents
  readonly provider: string | null;
  readonly model: string;            // as spawned; LANE_DEFAULT_MODEL when spawned without one
  readonly role: string | null;      // lane role; subagent slug
  readonly taskKind: OutcomeTaskKind | null;   // null = not routed with one
  readonly taskId: string | null;
  readonly verdict: LaneCompletionVerdict;
  readonly failureClass: LaneFailureClass | null;
  readonly startedAt: number | null;
  readonly endedAt: number;
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly routingSource: OutcomeRoutingSource;
  readonly reviseRounds: number;
  readonly finalReview: OutcomeFinalReview | null;
  readonly deliverablesDeclaredAt: number | null; // set by the first `deliverables` report (finding 4)
  readonly telemetryJoin: OutcomeTelemetryJoin;
  readonly skillsLoaded: readonly string[] | null;   // null = unknown, never [] for unknown
  readonly sessionEvidenceClass: string | null;
}

/** What routing reads. Holds no text. */
export type LaneOutcomeSummary = Pick<LaneOutcomeRecord,
  'runId' | 'laneId' | 'family' | 'model' | 'taskKind' | 'verdict' | 'failureClass' | 'finalReview' |
  'reviseRounds' | 'durationMs' | 'endedAt' | 'routingSource' | 'inputTokens' | 'outputTokens' | 'costUsd'>;

export interface OutcomeRatio { readonly numerator: number; readonly denominator: number; }
export interface AgentOutcomeSignals {               // unchanged from part B §1
  readonly slug: string;
  readonly windowDays: number;
  readonly runCount: number;
  readonly delivered: OutcomeRatio;
  readonly reviewPass: OutcomeRatio;
  readonly avgReviseRounds: number | null;
  readonly topFailureClass: LaneFailureClass | null;
}
```

The SQLite row (`0054`, part B §2) keeps `family TEXT` nullable. The write-edge Zod schema
(`LaneOutcomeRowSchema`, lane-outcomes) requires a non-empty `family`.

### SC-2 History read port (routing → outcomes)

```ts
// lane-outcome.types.ts (shared) — the only outcome interface lane-routing sees
export interface LaneOutcomeReader {
  /** Records of one lane with endedAt >= window.sinceMs, newest first. Never rejects: store failure → [] + log.
   *  Unknown laneId → []. Target latency 200 ms; routing races it inside its 2000 ms gather deadline. */
  recentOutcomes(laneId: string, window: { readonly sinceMs: number }): Promise<readonly LaneOutcomeSummary[]>;
  /** true when the active durable store is readable (SQLite open in desktop/CLI, the IStateStorage-backed
   *  store in VS Code; SC-10). false only while the desktop/CLI DB is not yet open or no store is registered
   *  → routing adds the Req 4.5 "no outcome history" reason and uses seed/neutral scores. */
  isPersistent(): boolean;
}
```

- lane-outcomes defines `interface LaneOutcomeQueries extends LaneOutcomeReader { agentSignals(...); get(...) }`
  (the rest of part B §3's reader) and registers one service under `LANE_OUTCOME_TOKENS.READER`.
- lane-routing keeps its consumer-owned token `LANE_ROUTING_TOKENS.LANE_OUTCOME_READER` and injects it as
  optional. It does not create `lane-outcome-reader.port.ts`; it imports the type from shared.
- Routing calls `recentOutcomes` once per distinct candidate `laneId`, and once with `SUBAGENT_LANE_ID` for
  subagent candidates. It groups rows by `family` / `model` / `taskKind`, skips `taskKind === null`, and
  computes the delivered rate as delivered ÷ (delivered + no-deliverable + failed) and the review pass rate as
  approved ÷ (approved + rejected). The window stays at part A's 90 days (Req 6 derivation). It is a separate
  constant from part B's W = 30 days (Req 9.1 card), so the two values do not conflict.

### SC-3 Token aliases (composition roots, batch AB14)

Precedent: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:214` and
`apps/ptah-electron/src/di/phase-2-libraries.ts:302` already alias a port token with `useToken`.

```ts
container.register(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER, { useToken: LANE_OUTCOME_TOKENS.READER });
container.register(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER, { useToken: LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER });
```

Each root does this in all three hosts, after both `register*Services` calls. In VS Code `READER` resolves
the `IStateStorage`-backed store (SC-10), so routing reads `isPersistent() === true` there too.

### SC-4 Failure-classifier port (outcomes → routing, Req 10.3 / 12.5)

```ts
// lane-outcome.types.ts (shared)
export interface LaneFailureClassificationInput {   // ids, enums and numbers only: no text (NFR Security)
  readonly runId: string;
  readonly executorKind: Exclude<OutcomeExecutorKind, 'subagent'>;
  readonly family: string;
  readonly status: AgentStatus;
  readonly verdict: Extract<LaneCompletionVerdict, 'no-deliverable' | 'failed'>;
  readonly failureKind: string | null;   // APM's limit classifier output, e.g. 'quota'
  readonly exitCode: number | null;
  readonly durationMs: number | null;
}
export interface LaneFailureClassifier {
  /** Never rejects. Unset decision model → null with zero requests. At most one request per call. */
  classify(input: LaneFailureClassificationInput): Promise<LaneFailureClass | null>;
}
```

- Provider: `DecisionModelFailureClassifier` in lane-routing (batch A16), registered as
  `LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER`. It sends one `choice` question whose options are
  `LANE_FAILURE_CLASSES`, with the input as `state`. It uses part A's per-request timeout (3000 + 250 ms) and
  part A's `answer-validation.ts` acceptance rule (threshold 0.5, strict less-than → null). An answer outside
  the five classes → null.
- Consumer: `LaneOutcomeRecorder.recordLaneCompletion` (batch B4) injects
  `LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER` as optional. It calls the classifier only when all of these hold:
  the insert created a new row (a duplicate makes no call), `failureClass === null`, the verdict is
  `no-deliverable` or `failed`, and the status is not `stopped`. The call is fire-and-forget. A non-null answer
  becomes a single `update(runId, { failureClass })`; a rejection is logged as a `warn` carrying ids only. A
  deterministic class never reaches the classifier (Req 10.2). Subagent classes stay read-time only (part B
  §3).
- `LaneCompletionOutcomeInput` (part B §4) gains `status`, `failureKind` and `exitCode`. These feed the
  classifier only and are not persisted.

### SC-5 Lane family: `libs/shared/src/lib/utils/lane-family.ts` (batch AB1)

```ts
export interface LaneFamilyInput {
  readonly cli: string;
  readonly ptahCliId?: string | null;
  readonly providerId?: string | null;
}
export const SUBAGENT_FAMILY = 'claude';
/** providerId for cli === 'ptah-cli' (fallback 'ptah-cli:' + ptahCliId, then 'ptah-cli'); else cli. */
export function laneFamilyOf(input: LaneFamilyInput): string;
```

This changes part A §1 from `laneFamilyOf(row)` to a structural input, so the notifier can call it with
`{ cli: info.cli, ptahCliId: info.ptahCliId, providerId: info.quotaOwner?.providerId }`. `CliDetectionResult`
satisfies the interface.

### SC-6 Spawn routing fields (new; batches AB1, A1b, B5)

Req 5.2 asks for the task kind and routing source of each run, but neither part carried them to the spawn.

```ts
// libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts (inside the .strict() object)
taskKind: z.enum(OUTCOME_TASK_KINDS).optional(),
routingSource: z.enum(['model', 'ranking', 'pin']).optional(),   // never forwarded to the CLI

// libs/shared/src/lib/types/agent-process.types.ts
// SpawnAgentRequest (:228) and AgentProcessInfo (:120) gain:
readonly taskKind?: OutcomeTaskKind;
readonly routingSource?: Exclude<OutcomeRoutingSource, 'not-routed'>;
```

- APM copies both fields from the request onto the tracked info (B5).
- The notifier maps `taskKind ?? null` and `routingSource ?? 'not-routed'` (B5).
- Part A's `ChosenEntry` (part A § Contracts, result schema) gains `taskKind: z.enum(OUTCOME_TASK_KINDS)`. The
  value comes from the existing phase-kind → task-kind table, so the skill can copy `taskKind` and `source`
  into the spawn.

### SC-7 `ptah_outcome_report` args: one schema, owned by lane-outcomes (batch B4)

Part B §3 and §8 named two homes for this schema. It lives only in `lane-outcomes` and is exported from the
lib. The tool file in vscode-lm-tools imports it.

```ts
const OutcomeTargetSchema = z.union([
  z.object({ runId: z.string().min(1).max(200) }).strict(),
  z.object({ agentId: z.string().min(1).max(200) }).strict(),
]); // Gate 2 revision 2: the `{ subagent: slug }` form is removed (decision #41)
export const OutcomeReportArgsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('deliverables'), target: OutcomeTargetSchema,
    paths: z.array(z.string().min(1).max(1024)).max(20),          // workspace-relative; never stored
    taskKind: z.enum(OUTCOME_TASK_KINDS).optional(),
    taskId: z.string().min(1).max(200).optional(),
    routingSource: z.enum(OUTCOME_ROUTING_SOURCES).optional(),
  }).strict(),
  z.object({
    kind: z.literal('review'), target: OutcomeTargetSchema,
    verdict: z.enum(['approved', 'rejected', 'revise']),
  }).strict(),
]);
```

Target resolution (Gate 2 revision 2 finding 2; replaces revision 1's text and part B §8's slug rule). Correctness
does not depend on IA-4: Ptah itself tells the orchestrating model the run key of every subagent it spawns.

**Ptah run tag (the correlation Ptah controls).** Ptah's own PostToolUse hook already returns
`hookSpecificOutput.additionalContext` on a main-thread tool result
(`libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:151-159`), and the budget monitor
already rides a notice on the spawning `Agent`/`Task` tool result through that hook
(`compaction/subagent-budget-monitor.ts:46-51`). The hook input carries `tool_use_id`
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2561`), `tool_name` and `tool_response`, and has no
`agent_id` on a main-thread call (`post-tool-use-hook-handler.ts:86`). The Task tool_use id is the subagent
registry key: `SubagentRegistryService.get(toolCallId)` (`vscode-core/src/services/subagent-registry.service.ts:379`)
returns the record that the SubagentStart hook registered with the run's `agentId`, and
`getToolCallIdByAgentId` (`:749`) is the reverse lookup the SubagentStop handler already uses
(`subagent-hook-handler.ts:438-455`). Batch B3 adds the tag:

- In `PostToolUseHookHandler.createHooks`, for a main-thread call (`input.agent_id` absent) whose `tool_name` is
  in the budget monitor's `SUBAGENT_TOOL_NAMES` (`'Agent'`, `'Task'`, `subagent-budget-monitor.ts:184`), the
  handler (new optional last constructor parameter `@inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)`, optional like
  the notice queues at `post-tool-use-hook-handler.ts:68-73`) resolves `agentId` =
  `subagentRegistry?.get(input.tool_use_id)?.agentId`, else `tool_response.agentId`
  (SDK `AgentOutput.agentId`, `sdk-tools.d.ts:100-102`, and `:156` for an async launch). When the two disagree,
  the registry value wins and one `warn` logs both. The id must match `^[A-Za-z0-9_-]{1,200}$`; otherwise no
  tag is added and one `debug` line says why.
- It appends one line to `additionalContext`, after any existing notice:
  `ptah-run: runId=subagent:<agentId>`. The line holds only the id, never prompt or result text.
- The helper `subagent-run-tag.ts` (pure function: hook input + registry lookup → tag line or `null`) owns the
  grammar; the A15 skill text quotes the same grammar. The hook still never throws: a lookup failure adds no
  tag, logs `debug`, and leaves the tool result unchanged.
- The run key `subagent:<agentId>` equals the record key that SC-1 writes from `SubagentStopPayload.agentId`
  (`subagent-hook-handler.ts:520-524`), because the registry's `agentId` and the stop's `agent_id` are the same
  run's hook id (the stop handler resolves the registry record by that id at `:438-455`). Each run has its own
  tag, so repeated and concurrent runs of one slug never compete.

**Target forms (the skill uses them in this order).**

- `{ runId }`: the tag's run id, or a lane run id. Exact record; when the record does not exist yet, see the
  report hold below; otherwise an error naming the id (Req 5.6).
- `{ agentId }`: the `agentId:` line of the SDK's Agent result text, used only when no tag is visible (IA-4,
  now an optimisation). Resolution: the subagent record or held run `subagent:${agentId}`, then the newest lane
  record of that `agentId`. Both present → "ambiguous" error, nothing written. Neither → treated as
  `{ runId: 'subagent:' + agentId }` (report hold).
- No tag and no `agentId` line: no Ptah subagent record can exist for that run (both come from the same hook
  id), so the skill makes no report for it, as when the tool is not listed.

**Report hold (report before its stop insert).** The SubagentStop insert is enqueued before a foreground
run's tool result reaches the parent, and SC-10 applies a report after every earlier op, so a foreground
report normally finds its row. A background run, a dropped or late stop hook, or a pre-open journal can still
let a report arrive first. Then:

- A `deliverables` report whose target is a `subagent:` run id with no row is held: the tool stats the paths at
  call time and stores only the stat facts (`checks: [{ exists, mtimeMs }]`, never the paths, Req 5.8) with
  `taskKind`, `taskId`, `routingSource` and its `reportId`. Desktop/CLI: table `lane_outcome_held_reports
  (report_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, held_at INTEGER
  NOT NULL, expires_at INTEGER NOT NULL)` with an index on `run_id` (migration 0054, B2). VS Code: the `held`
  array of the KV store object. The tool returns `{ recorded: 'held', runId }` and the text "held until run
  <runId> stops".
- A `review` report for a `subagent:` run id with no row is held only when a held `deliverables` report for the
  same run exists; otherwise it is the Req 5.6 error naming the id. A lane run id is never held (lane records
  are inserted at completion, before any report).
- Join: the subagent-stop op (SC-10 table) inserts the row and, in the same transaction (KV: the same `update`),
  applies the run's held reports in `held_at` order (the deliverables verdict is computed then with
  `sessionChildVerdictOf` and the row's `startedAt`, as part B §8 does at call time), writes their receipts and
  deletes them. A replayed join is a no-op through the receipts.
- Expiry: a held report expires 24 h after `held_at`. The drain removes expired holds at most once per 60 s,
  with one `warn` per report (`{ runId, reportId, kind, reason: 'held-report-expired' }`). At most 500 holds
  exist; a new hold beyond that is refused with `{ ok: false, error: 'too many held reports' }`, which the tool
  shows (the newest is refused, never a held one).
- `deliverables` sets `verdict` and `deliverablesDeclaredAt`. A second `deliverables` report for the same run
  replaces the verdict (the latest declaration wins) and keeps the first `deliverablesDeclaredAt`.

Acceptance fixtures (B10a sequence spec on the real recorder, pipeline and `InMemoryLaneOutcomeStore`; B3 hook
spec; B4 hold specs):

- Tag path (B3 + B10a): two concurrent runs A and B of one slug, registered with distinct `agentId`s; PostToolUse
  for each Task tool_use id yields `ptah-run: runId=subagent:<A>` and `…<B>`. Report B then A by `{ runId }` →
  each record has its own verdict. A third, repeated run C of the slug → its own tag and record; A and B
  untouched. Registry miss → the tag comes from `tool_response.agentId`; mismatch → the registry wins with one
  `warn`; an id outside the pattern → no tag. A subagent's own tool call (`agent_id` set) gets no tag.
- `agentId` path (B10a): the same A/B/C sequence reported by `{ agentId }` gives the same records.
- Report before stop, both paths (B4 + B10a): report A by `{ runId }` and B by `{ agentId }` before either stop
  → both `held`; stop B then A → each record gets its own verdict and receipt, the hold is empty. A review
  `revise` held behind A's held deliverables → `reviseRounds 1` after the join. A review for an unknown
  `subagent:` id with no held deliverables → the Req 5.6 error.
- Concurrent same-slug, one held and one applied: A stopped, B not; report both → A `applied`, B `held`; B's
  stop joins B only.
- Expiry: a hold older than 24 h (fake timers) is removed with one `warn`; the 501st hold is refused.
- Restart with holds: holds survive a new store over the same storage (KV) or the reopened SQLite file and
  join when the stop arrives.

### SC-8 RPC surface

| Method | Owner | Params / result | Guard status |
| --- | --- | --- | --- |
| `agent:getConfig` / `agent:setConfig` (existing) | A11 | gain the decision-model fields (part A D5) | no new method |
| `agent:outcomeSignals` (new) | B7 | `{ slugs: string[] }` (Zod `.strict()`, ≤ 500 × ≤ 200 chars) → `{ signals, windowDays: 30, persistent }` | prefix `agent:` is allowed (`rpc-handler.ts:66`, part B). The host-source baseline guard checks only names that match `/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i` (`host-source-registry.contract.spec.ts:17-21`), and this name matches none of them, so no TASK_2026_610 exception is needed. |

### SC-9 Logging in the two new libs

Neither new lib imports `vscode-core`. `platform-core` has no logger token (verified by grep of
`libs/backend/platform-core/src`). Each lib declares a local structural logger interface
(`debug/info/warn/error(message, meta?)`), takes the host logger as a parameter of its `register*Services`
function, and registers it under a token the lib owns. The vscode-core `Logger` satisfies the interface
structurally. This replaces part B §3's "take `TOKENS.LOGGER` from `vscode-core`" and matches part A §2.

### SC-10 Outcome write pipeline and durable storage in every host (batch B4; findings 1 and 5)

This supersedes part B's "in-memory store in VS Code" and "writes before the DB opens are dropped". There is
one write pipeline for every host. No recorder method writes to a store on the caller's stack.

Evidence:

- Every host already binds the host-neutral `IStateStorage` port under `PLATFORM_TOKENS.STATE_STORAGE`
  (`libs/backend/platform-core/src/di/tokens.ts:16`). VS Code binds `VscodeStateStorage(context.globalState)`
  (`libs/backend/platform-vscode/src/registration.ts:63-65`), which is durable across restarts. The CLI binds
  `CliStateStorage(userDataPath, 'global-state.json')` (`libs/backend/platform-cli/src/registration.ts:68-70`),
  and Electron binds `ElectronStateStorage` (`libs/backend/platform-electron/src/registration.ts:115-117`). The
  port is `get / update / keys` (`libs/backend/platform-core/src/interfaces/state-storage.interface.ts`).
- The SQLite connection exposes `isOpen` and `onDidOpen` (`sqlite-connection.service.ts:450`, `:479-486`). It
  has no open-failure event (verified by grep), so a DB that never opens looks the same as one that opens late.

Storage, chosen once in `registerLaneOutcomeServices` (lazy factory, same as `task-specs/.../register.ts:78-86`):

| Host | Primary store | Journal |
| --- | --- | --- |
| Desktop, CLI (`PERSISTENCE_TOKENS.SQLITE_CONNECTION` registered) | `SqliteLaneOutcomeStore` (`lane_outcome_records`, migration 0054) | `KeyValueOutcomeJournal` over `PLATFORM_TOKENS.STATE_STORAGE`, key `ptah.laneOutcomes.journal.v1` |
| VS Code (no SQLite connection, `phase-2-libraries.ts:85-92`) | `KeyValueLaneOutcomeStore` over `PLATFORM_TOKENS.STATE_STORAGE`, key `ptah.laneOutcomes.records.v1` | none (the primary is always ready) |
| Neither token registered (tests only) | `InMemoryLaneOutcomeStore`, `isPersistent() === false` | none |

`InMemoryLaneOutcomeStore` stays as the test double and the last-resort fallback. No production host selects it.

`KeyValueLaneOutcomeStore` keeps one JSON object `{ rows: LaneOutcomeRow[], receipts, held }` (the SC-1 row,
no text fields, Req 5.8; receipts and held reports per SC-10 keys and SC-7 report hold).
It is bounded: rows with `endedAt` older than 90 days (the SC-2 routing window) are evicted on every write,
then the oldest beyond 2 000 rows. Evictions are logged at `debug` with a count. Each drain batch does one
`update(key, rows)`, never one per op. Reads filter the in-memory copy with the same rules as the SQLite queries.
`isPersistent()` returns `true`.

`OutcomeWritePipeline` (new, `lane-outcomes/src/lib/write/outcome-write-pipeline.ts`):

- `enqueue(op): void` is synchronous and O(1). It never validates, never touches a store and never throws. It
  is the only thing `recordLaneCompletion`, `recordSubagentStop` and `markSubagentBudgetStop` do. Zod row
  validation runs inside the drain.
- `submit(op): Promise<OutcomeWriteResult>` is for report ops: `declareSubagentDeliverables` and
  `attachReview`. It resolves after every earlier op has been applied or journaled, so a report never
  overtakes the insert of its own run. Result (Gate 2 revision 2): `{ ok: true, state, runId }` with
  `state` = `'applied'` (row changed), `'held'` (run row not inserted yet, SC-7 report hold) or `'queued'`
  (backlog mode, below), or `{ ok: false, error }`.
- Ordering: one FIFO, one consumer, ops applied strictly in enqueue order. The drain is scheduled with
  `setImmediate`, never on the caller's stack. It applies at most 25 ops per turn, then yields with another
  `setImmediate`, so a slow synchronous better-sqlite3 write holds the event loop for one bounded batch at most.
- Idempotency keys (Gate 2 revision 2 finding 1). Every op has a key, so any replay, of any entry that did
  or did not land, is safe:

  | Op | Key | Apply rule |
  | --- | --- | --- |
  | lane completion | `run_id` (the notifier's dedup key) | `insertIfAbsent` |
  | subagent stop | `subagent:${agentId}` | `insertIfAbsent`, then join the run's held reports in the same transaction (SC-7 report hold) |
  | budget stop | `subagent:${agentId}` | upsert `budget_stopped = 1` |
  | deliverables report | `reportId` (UUID the tool mints once per call) | skip if a receipt exists; else latest declaration wins, first `deliverablesDeclaredAt` kept, receipt written |
  | review report | `reportId` | skip if a receipt exists; else `revise` adds 1 / `approved`/`rejected` set `final_review`, receipt written |

  Receipts live in `lane_outcome_report_receipts(report_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT
  NOT NULL, applied_at INTEGER NOT NULL)` (migration 0054, batch B2), written in the same better-sqlite3
  transaction as the row change. The VS Code KV store keeps `{ rows, receipts, held }` in its one key and
  writes all three in the same `update`. Receipts are evicted with their row (90 days). `revise_rounds + 1`
  is therefore applied exactly once per `reportId`, which replaces round 1's "`attachReview` is never
  journaled or replayed".
- Per-op acknowledgement (Gate 2 revision 2 finding 1; replaces "replay, then clear"). An op leaves the
  in-memory queue or the journal only after its store apply has returned. Desktop/CLI: each op applies in its
  own better-sqlite3 transaction; after each drain turn (at most 25 ops) the journal is rewritten once,
  without the acknowledged entries (one `IStateStorage.update` per turn, never one per op). A crash between a
  SQLite commit and that rewrite leaves an entry that already landed; its key makes the replay a no-op.
  VS Code (same pipeline, same rule): the turn's rows, receipts and held reports are one `update`, and the
  turn's ops are acknowledged only when that `update` resolves.
- Failure classes. **Permanent**: the op's row fails Zod validation, or SQLite reports a constraint error
  other than the op's own key (`SQLITE_CONSTRAINT_CHECK`, `SQLITE_CONSTRAINT_NOTNULL`). It can never succeed,
  so the entry moves to the dead-letter key `ptah.laneOutcomes.journal.rejected.v1` (op kind, ids, error
  code; no text) with one `warn`, and the drain continues. The dead-letter list keeps the newest 200 entries
  and counts older ones in its `overflow` field. **Transient**: every other failure (`SQLITE_BUSY`,
  `SQLITE_IOERR`, a closed connection, a rejected `IStateStorage.update`). The drain stops at that op, and that
  op and every later op keep their FIFO order: desktop/CLI moves them to the journal tail (backlog mode);
  VS Code keeps them at the head of the in-memory queue. Retry after 250 ms, 1 s, 5 s, 30 s, then every 60 s,
  and also on `onDidOpen` and at the next start. Logging: one `warn` (ids, code) at the first failure of a
  streak, one `warn` per 10 further failed retries with the count, one `info` when the backlog drains.
- Backlog mode (desktop/CLI). The journal is one ordered list `{ nextSeq, entries: [{ seq, op }],
  droppedAtCapacity }` under `ptah.laneOutcomes.journal.v1`. While it is non-empty (DB not open yet, or a
  transient failure), every new op, fire-and-forget or report, is appended to its tail, and the drain
  consumes only from its head. FIFO across retries and restarts follows from that single list. When it
  empties, the pipeline returns to direct mode. On `onDidOpen`, and at start when `isOpen` is already true,
  the drain starts from the head. A run that ends before the DB opens, or in a process that exits before the
  DB ever opens, is applied at the next start that opens the DB.
- Report ops in backlog mode are journaled too (their `reportId` makes them idempotent), and `submit`
  resolves `{ ok: true, state: 'queued', runId }` once the append resolves; the tool shows "queued until the
  outcome store is available". The Req 5.6 unknown-id check then runs when the entry is applied: an unknown
  id is logged at `warn` with the id, nothing is written, and the entry is acknowledged. With the store open
  and the journal empty (the normal case) the check runs before `submit` resolves, and the tool returns the
  Req 5.6 error naming the id.
- Journal capacity: 5 000 entries (an entry is ids, numbers and at most 20 path checks, about 300 bytes, so
  the whole value stays near 1.5 MB in the host's state file). An accepted entry is never discarded before
  it is applied or classed permanent. When the journal is full, the incoming op is not appended (the newest
  is refused, never an accepted one); `droppedAtCapacity` is incremented in the same `update`, so the count
  survives restarts; one `warn` at the first refusal and then one per 100 refusals; and every start whose
  journal has `droppedAtCapacity > 0` or dead-letter entries logs one `warn` with both counts. Consistency with
  Req 5: Req 5.7 holds for every op the pipeline accepted. Reaching capacity needs at least 5 000 ops while the
  store is unavailable, which is a write failure under Req 5.9: the lane result still reaches the session
  (the enqueue never blocks or throws) and the failure is logged and counted. This is decision #40.
- In-memory queue (direct mode): at most 1 000 ops. Desktop/CLI: an op that arrives when it is full is
  appended to the journal instead (backlog mode), not dropped. VS Code: the primary store is the only durable
  medium, so an op that arrives when the queue is full (the KV `update` has been failing for 1 000 ops) is
  refused with one `warn` (`{ runId, reason: 'queue-full' }`) and counted, under Req 5.9.
- Shutdown: the `startLaneOutcomes` disposer stops `enqueue`, then drains for at most 2 000 ms. Desktop/CLI:
  unacknowledged in-memory ops are appended to the journal in order in one `update`. VS Code: one final
  `update` attempt; ops it does not acknowledge are counted in one `warn`. The disposer is awaited on the host
  shutdown path (AB14).

Effect on part B: §3's `LaneOutcomeRecorder` methods return as soon as `enqueue` returns. §4's notifier call
site stays where it is (after `buildSignal`, before the parent checks, so refusals are recorded), and it is
now a synchronous enqueue with no store I/O. §3's "write dropped when the DB is not open" no longer applies.

Required tests (B4 unless noted):

- Restart, VS Code shape: a `KeyValueLaneOutcomeStore` over a fake `IStateStorage`. Write 3 records, build a
  new store and pipeline over the same storage object, and `recentOutcomes` returns the 3 records.
- Restart, desktop shape: the SQLite-backed spec (0037 test helper) writes records, closes the connection,
  reopens it on the same file, and reads them back.
- Delayed open: SQLite connection fake with `isOpen = false`. Enqueue 2 lane completions and 1 subagent stop.
  Assert the journal holds 3 ops and the store has 0 rows. Fire `onDidOpen`, and the store has 3 rows and the
  journal is empty. Variant: build a new pipeline over the same journal storage (process restart before
  open), open it, and the same 3 rows appear. Variant: replay the same entries twice and there are still 3
  rows (idempotent keys).
- Report before open (revision 2): a deliverables report submitted while `isOpen = false` resolves
  `{ ok: true, state: 'queued' }`, is journaled behind the run's stop op, and is applied after it on open. A
  review naming an unknown id while queued → one `warn` naming the id at apply time, nothing written.
- Ordering: `declareSubagentDeliverables` submitted right after `recordSubagentStop` for the same run applies
  after the insert.
- Replay insert failure (revision 2, finding 1): journal `[L1, S1, L2]`; the fake store throws `SQLITE_IOERR`
  on S1 once. After the first pass L1 is a row and the journal is exactly `[S1, L2]` in that order, with L2 not
  applied. Advance 250 ms: S1 and L2 are rows, the journal is empty, and one `warn` plus one `info` were
  logged.
- Restart during a failure streak: same failure, then dispose and build a new pipeline over the same storage
  with a healthy store; on open the rows are L1, S1, L2 and the journal is empty.
- Recovery after open: DB open (direct mode); op 2 of 3 fails transiently → ops 2 and 3 are journaled in order;
  a new op 4 is appended behind them; on recovery 2, 3, 4 are applied in that order.
- Ack crash: the store commits L1, then the journal rewrite rejects; a new pipeline over the same storage
  replays L1 and the store still has one L1 row. Same for a review `revise` report: `reviseRounds` stays 1.
- Permanent failure: an entry whose row fails Zod validation moves to `ptah.laneOutcomes.journal.rejected.v1`
  with one `warn`, and the entries behind it are applied.
- More than 1 000 pre-open completions: 1 500 lane completions while `isOpen = false` → the journal holds
  1 500 entries; on open all 1 500 rows exist, no turn applies more than 25 ops, and the journal is rewritten
  once per turn.
- Capacity: a full journal (5 000 entries) plus one op → the op is refused, `droppedAtCapacity` is 1 after a
  restart, one `warn`; all 5 000 accepted entries are applied on open.
- VS Code ack: the KV `update` rejects once → no op is acknowledged, the 250 ms retry writes all of them in
  order; queue full (1 000 ops while `update` keeps failing) → the next op is refused with one `warn`.
- Bound: KV store over 2 000 rows → oldest evicted with their receipts.
- Shutdown: disposer flushes pending ops within 2 000 ms; a store that never resolves → the disposer still
  returns by the deadline, and the remaining ops are journaled.
- Signal path (B5, notifier spec, real `OutcomeWritePipeline` over a fake store, Jest fake timers): a store
  whose write takes 5 s, and a store that throws. In both cases the parent receives the completion signal
  without advancing the 5 s timer, `signal()` never awaits the store, and the throwing case logs one warn.
  A third case: `enqueue` itself is replaced by a throwing stub, and the signal is still delivered (the
  notifier keeps its `try/catch`).

## Reconciliation log

| # | Conflict | Resolution | Part edited |
| --- | --- | --- | --- |
| R1 | **Reader contract.** Part A assumed `LaneOutcomeSummary {completedAt, deliveryVerdict, reviewVerdict, family: string, model: string \| null, laneId 'subagent:<role>'}` with a port file and token in lane-routing. Part B defined `{endedAt, verdict, finalReview, family: string \| null, model 'lane-default', laneId 'subagent'}` plus a four-method reader in lane-outcomes with its own token. | Part B's field set wins because it is the record (SC-1). `family` is non-null and `laneId` is `'subagent'` (Req 5.2 wording). `model` uses `'lane-default'`, which routing treats as its own key. The port is `LaneOutcomeReader {recentOutcomes, isPersistent}` in shared (SC-2). Part B's extra methods move to `LaneOutcomeQueries extends LaneOutcomeReader`. Both tokens stay, joined by a `useToken` alias in the roots (SC-3). Rejected: lane-routing importing lane-outcomes, which would pull persistence-sqlite and agent-sdk into the decision engine's graph. Also rejected: lane-outcomes importing lane-routing, which would make the record depend on routing. | A § Assumed contract (replaced by a pointer), A3 row; B §1, §3 |
| R2 | **Dispatcher files.** A9a and A9b (route tool) and B10 (report tool) all edit `protocol-dispatcher.ts`, `mcp-stdio/tool-builders.ts`, `mcp-stdio/agent-tool.dispatcher.ts` and `ptah-system-prompt.constant.ts`. A9b also edits `ptah-api-builder.service.ts`; B10 also edits `http-mcp-server.service.ts`. | Split by file kind. **A9a** creates only the route modules (tool definition, handler, namespace builder and their specs). **B10a** creates only the report tool module and its spec. **AB9** is one batch that makes every edit to an existing registration file for both tools. Order: A9a ‖ B10a → AB9. | A batch table (A9a/A9b → A9a + AB9); B batch table (B10 → B10a + AB9) |
| R3 | **Req 8.7 call site.** Part A §13 deferred it; part B named `ptah_outcome_report` but left the skill text out of scope. | A15 writes three call sites. (1) Lane spawns pass `taskKind` and `routingSource` from the Gate 0.1 row (SC-6). Lane records need no report (Req 5.1). (2) After each subagent run: `ptah_outcome_report {kind:'deliverables', target:{runId:<Ptah run tag>} (else {agentId}), paths, taskKind, taskId, routingSource}` (Gate 2 revision 2, SC-7). The skill keeps the `runId`. (3) After each review verdict: `{kind:'review', target:{runId}}`, or `{agentId}` for a lane run, plus the verdict. When the tool is not listed, the skill skips the report silently. Budget-stopped subagents need no skill action: the B3 registry records them. | A §13, A15 row |
| R4a | **Shared lib.** A1 and B1 both edit the shared barrel and both add types. | Merged into **AB1**, together with SC-4 to SC-6. | A and B batch tables |
| R4b | **Composition roots and guard specs.** A14 and B9 edit the same three roots, `expected-resolvable.ts` and the smoke specs. B7 also listed `rpc-surface.spec.ts` (an app spec) and the Electron surface-composition spec. | Merged into **AB14** (in-process), together with the two aliases (SC-3). The app-level guard specs move from B7 to AB14. `rpc-allowlist.spec.ts` stays in B7 because it belongs to the rpc-handlers project. | A and B batch tables, B §7 |
| R4c | **rpc-handlers.** A10 and B7 both edit `register-shared-rpc-handlers.ts`. | Ordered: A10 (wave 3) before B7 (wave 4). | none (ordering only) |
| R4d | **agent-sdk.** A13 and B3 both edit agent-sdk DI `register.ts`, tokens and barrel. | Ordered: B3 (wave 1) before A13 (wave 4). | none |
| R4e | **`tsconfig.base.json`.** A2 and B4 each add a path alias. | Different waves (1 and 2). | none |
| R4f | **New RPC method against the TASK_2026_610 baseline.** Part A D5 avoided new methods for this reason; part B adds `agent:outcomeSignals`. | Checked the guard (SC-8): it fails only on names that match the host-source pattern. `agent:outcomeSignals` passes. Part A D5 stays as decided (it is reversible). Both parts must keep every new method name clear of the pattern. | none |
| R4g | **Logger.** Part A forbids `vscode-core` in lane-routing. Part B planned to import `TOKENS.LOGGER` from `vscode-core` into lane-outcomes, which breaks the repo rule against new vscode-core imports in host-neutral libs. | SC-9: both libs take a structural logger. | B §3 |
| R4h | **Report-args schema home.** Part B §3 put it in lane-outcomes and §8 put it beside the tool. | It lives in lane-outcomes only (SC-7). | B §8 |
| R4i | **Migrations.** | Only part B adds migrations (0054, 0055, after v53 at `migrations/index.ts:388-391`). Part A persists rotation through `IStateStorage` and the matrix in `~/.ptah/routing/*.json`. No conflict. | none |
| R4j | **Constants.** Part A uses a 90-day derivation window; part B uses W = 30 days. Both use the task-kind union. | Different purposes, so both stay. The single task-kind union is `OUTCOME_TASK_KINDS` in shared, which part A's `PHASE_KINDS` → task-kind table and its rotation key K import. | A3 row note |
| R5 | **Gap: Req 5.2 task kind / routing source.** Each part expected the other to add them to the spawn. | SC-6 adds them: spawn args, shared types and APM (B5), with `taskKind` on `ChosenEntry`. | A § Contracts note; B §4 note |
| R6 | **Gap: Req 10.3 and the 12.5 classification budget.** Neither part designed the decision-model failure classification. | New batch **A16** (lane-routing classifier) and the recorder hook in B4 (SC-4). | A batch table (A16 row); B §3 note |
| R7 | **Assumption ids.** Both parts used A1-A5. | Renamed PA-1..PA-5 and PB-1..PB-5, plus the inline checks each part named (PB-6..PB-8) and this pass's IA-1..IA-3. See § Assumptions. | none (ids are mapped here) |

## Requirement coverage

| Req / AC | Batches |
| --- | --- |
| 1.1-1.8 decision-model setting | A6a (client, `routeMissing` on any live 404/405), A6b (1.3-1.5 settings; probe = version + `POST /v1/systemone` compared with a control path, an answer equal to the control's → `unsupported-endpoint`; specs: recent version + generic JSON 404 → unsupported, route-specific validation error → ready; live mark persisted across restart), A8 (live 404 → `markUnsupported`, row shows unsupported), A11 (config RPC), A12 (row UI, 1.4 disclosure), A13 (1.2 structured output, 1.8 confidence null) |
| 2.1 any host, HTTP and stdio | A9a, AB9, AB14 |
| 2.2-2.3, 2.5 args/result contract, field-named errors | A3, A9a |
| 2.4 stored preference | A5b, A8 |
| 2.6-2.7 | A8 |
| 3.1, 3.7 | A8 |
| 3.2-3.6 hard constraints (3.3 reviewer family) | A5a, AB1 (`laneFamilyOf`) |
| 4.1-4.6 non-blocking fallback | A6a, A8; 4.5 "no outcome store" via SC-2 `isPersistent` + AB14 alias |
| 5.1 one record per deduped completion | B5 |
| 5.2 record fields | AB1, B4, B5; task kind/routing source via SC-6 (AB1, A1b, B5, A15) |
| 5.3 lane tokens/cost null | B5 |
| 5.4 subagent one-to-one join | B2 (0055), B4, B6 (recorder dedup by exact `runId` for subagent events; two runs in one 2 s bucket end-to-end spec) |
| 5.5 declared deliverables | B5 (helper export), B2 (`deliverables_declared_at`), B3 (Ptah run tag on the Agent result, IA-5), B4 + B10a (SC-7 run-tag and `agentId` targets, report hold with join and expiry; repeated/concurrent same-slug and report-before-stop specs on both paths), B2 (held-report and receipt tables), AB9, A15 (report by run tag, else `agentId`) |
| 5.6 review attach | B4 (receipts: one `revise` per `reportId` across replays), B10a, AB9, A15 |
| 5.7 persists, routing reads | B2, B4 (SC-10: SQLite, VS Code `IStateStorage` store, journal with per-op acknowledgement, backlog mode and a 5 000-entry capacity that refuses only the newest op; restart, delayed-open, replay-failure, ack-crash, recovery, >1 000 pre-open and capacity fixtures), A4b, AB14 (alias, disposer awaited on shutdown) |
| 5.8 no text | B4 (row schema), SC-4 input shape (A16, B4) |
| 5.9 write failure non-blocking | B4 (SC-10 pipeline: async drain, bound, permanent/transient failure classes with backoff retry, logged and counted refusals), B5 (notifier signal-path specs with delayed and throwing stores) |
| 6.1-6.3 seed matrix | A4 |
| 6.4-6.8 user edits, local derivation, view file | A4b |
| 6.9 no vendor-to-task tables | A15 |
| 7.1-7.6 spread | A5b |
| 7.7-7.8 | A8 |
| 8.1-8.6 skill at Pre-flight/Gate 0.1 | A15 |
| 8.7 outcome reports | A15 (call sites R3; every subagent report by the Ptah run tag, else the Agent result's `agentId`; review by the kept `runId`), B3 (run tag), B4 (report hold), B10a (sequence specs on both paths, report before stop), needs AB9 |
| 9.1-9.5 Agents-tab signals (9.4 scorecard kept; decision #13 replacement) | B4 (`computeAgentSignals`), B7, B8 |
| 10.1-10.2 failure class | B5 (lanes), B3 + B4 (subagents) |
| 10.3 decision-model classification | A16, B4 (hook), AB14 (alias) |
| 11.1-11.5 model discovery | A10 (11.1 incl. Ptah CLI provider discovery via `ProviderModelsService.fetchModels`, provenance and timeout-isolation specs), A8 (11.2-11.5 deadlines) |
| 12.1-12.9 pipeline and budget | A8, A6a (size limit); 12.5 classification budget A16 |
| 13.1-13.5 reasons/confidence | A7, A8 |
| NFR Performance / Token cost | A8, A16 |
| NFR Security (payload field set) | A6a (`decision-payload.spec.ts`), A16 (classifier payload spec), B4 |
| NFR Compatibility | AB9, AB14 |
| #23(1) read seam to kept stores | B4 (port), B6 (adapter, bound in Thoth hosts) |
| #23(2) telemetry + harvester independent of `skillSynthesis.enabled` | B6 |
| #23(3) `skillsLoaded` | B4, B6 |
| #23(4) TASK_2026_662_3eea handoff | part B § Handoff + this file § Handoff (docs) |

Gaps found and closed in this pass: Req 5.2 task kind/routing source (R5), Req 10.3 and 12.5
classification (R6). There are no open gaps.

## Batches

The team-leader owns the final decomposition. Rules for every batch, which every lane prompt must repeat
(CLAUDE.md):

- Verify only the changed project, with `--parallel=1` for Nx and `--maxWorkers=2` for Jest.
- Run one heavy check at a time across all lanes.
- Never run a workspace-wide check, and never run `build`, `serve`, `e2e` or `package`.

`J(lib, specs)` below is short for `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
In the Kind column, "Shipping" means the batch needs a cross-family code review, and "Docs" means a text
review only. A lane is the right executor for a bounded, self-contained batch; cross-cutting wiring stays
in-process.

| Id | Title | Files (or part ref) | Nx project(s) | Depends on | Scoped verify | File-disjoint within wave | Executor | Kind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AB1 | Shared contracts | CREATE `libs/shared/src/lib/utils/lane-family.ts` (+ spec), `libs/shared/src/lib/types/lane-outcome.types.ts` (SC-1, SC-2, SC-4), `libs/shared/src/lib/types/rpc/rpc-lane-outcome.types.ts`; MODIFY `agent-process.types.ts` (`CliDetectionResult.family?`, SC-6 fields), `rpc.types.ts` (method + capability map), shared barrel (A §1 shared part + B §1) | `@ptah-extension/shared` | none | `npx nx test @ptah-extension/shared --parallel=1` (includes `host-source-registry.contract.spec.ts`), then `npx nx typecheck @ptah-extension/shared` | yes | CLI lane | Shipping (small) |
| A2 | lane-routing scaffold | A §2 files. Tokens include `LANE_OUTCOME_READER` and `FAILURE_CLASSIFIER`; local logger interface (SC-9); MODIFY `tsconfig.base.json` | `@ptah-extension/lane-routing` | none | `npx nx test @ptah-extension/lane-routing --parallel=1` + `npx nx lint @ptah-extension/lane-routing` | yes (only wave-1 batch touching `tsconfig.base.json`) | CLI lane | Shipping |
| B2 | Migrations 0054, 0055 | B §2; 0054 gains `deliverables_declared_at INTEGER` (SC-1, finding 4), and `lane_outcome_report_receipts` + `lane_outcome_held_reports` with their indexes (SC-10 keys, SC-7 report hold; rev 2 findings 1, 2) | `@ptah-extension/persistence-sqlite` | none | `npx nx test @ptah-extension/persistence-sqlite --parallel=1` | yes | CLI lane | Shipping |
| B3 | Subagent budget-stop registry; Ptah run tag | B §5, plus SC-7 run tag: CREATE `subagent-run-tag.ts` (+ spec), MODIFY `post-tool-use-hook-handler.ts` (+ spec), resolves IA-5 (rev 2 finding 2) | `@ptah-extension/agent-sdk` | none | `J(libs/backend/agent-sdk, <budget-stop registry spec, monitor spec, run-tag spec, post-tool-use-hook-handler spec>)` + `npx nx typecheck @ptah-extension/agent-sdk` | yes | CLI lane | Shipping |
| A3 | Route contracts and ports | A3 row minus `lane-outcome-reader.port.ts` (type comes from shared, SC-2); `ChosenEntry.taskKind` (SC-6); task kinds from `OUTCOME_TASK_KINDS` | `@ptah-extension/lane-routing` | AB1, A2 | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | CLI lane | Shipping |
| B4 | lane-outcomes lib | B §3, plus SC-2 split (`LaneOutcomeQueries`), SC-4 recorder hook, SC-7 schema, SC-9 logger; MODIFY `tsconfig.base.json`; SC-10 write pipeline, `KeyValueLaneOutcomeStore`, `KeyValueOutcomeJournal` (restart, delayed-open, bound, ordering and shutdown specs); rev 2 finding 1: per-op acknowledgement, failure classes and backoff, backlog mode, 5 000-entry journal with durable refusal counter, receipts, dead-letter key, and the replay-failure, restart, recovery, ack-crash, >1 000 pre-open and capacity specs; SC-7 target resolution (`runId` from the run tag, `agentId`) and the report hold with join, expiry and restart specs (rev 2 finding 2) | `@ptah-extension/lane-outcomes` | AB1, B2, B3 | `npx nx test @ptah-extension/lane-outcomes --parallel=1` + `npx nx lint @ptah-extension/lane-outcomes` | yes (only wave-2 batch touching `tsconfig.base.json`) | CLI lane (largest; one lane) | Shipping |
| B8 | Library Agents-tab signals | B §9 | `@ptah-extension/skill-synthesis-ui` | AB1 | `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1` | yes | CLI lane (frontend) | Shipping |
| A1b | Row `family` + spawn routing fields | MODIFY `namespace-builders/agent-namespace.builder.ts`, `mcp-core/mcp-response-formatter.ts` (+ spec), `mcp-core/agent-spawn-args.schema.ts` (+ spec) (SC-6), and the spawn-args → `SpawnAgentRequest` mapping site (IA-1) | `@ptah-extension/vscode-lm-tools` | AB1 | `J(libs/backend/vscode-lm-tools, <formatter, agent-namespace, spawn-args specs>)` + `npx nx typecheck @ptah-extension/vscode-lm-tools` | yes, unless IA-1 puts the mapping in `protocol-dispatcher.ts`; in that case the mapping moves to AB9 | CLI lane | Shipping |
| A4 | Matrix data | A4 row | `@ptah-extension/lane-routing` | A3 | `J(libs/backend/lane-routing, <A4 specs>)` | yes (LR/matrix types) | CLI lane | Shipping |
| A5a | Hard constraints | A5a row | `@ptah-extension/lane-routing` | A3 | `J(..., <A5a specs>)` | yes (LR/ranking constraints) | CLI lane | Shipping |
| A6a | System One wire + payload | A6a row; client marks any live 404/405 `routeMissing: true` with the body's `error` text (finding 6; rev 2 finding 3) | `@ptah-extension/lane-routing` | A3 | `J(..., <A6a specs>)` | yes (LR/decision-model wire) | CLI lane | Shipping |
| A6b | Decision-model settings | A6b row; probe adds the `POST /v1/systemone` capability check and `markUnsupported(base)` (finding 6); rev 2 finding 3: control-path discriminator (ambiguous 404/405 → unsupported), live 404/405 → persisted `unsupported-endpoint` mark under `ptah.decisionModel.unsupported.v1` | `@ptah-extension/lane-routing` | A3 | `J(..., <A6b specs>)` | yes (LR/decision-model settings files) | CLI lane | Shipping |
| A7 | Reasons and confidence | A7 row | `@ptah-extension/lane-routing` | A3 | `J(..., <A7 specs>)` | yes (LR/reasons) | CLI lane | Shipping |
| A10 | Lane model listing adapter | A10 row, plus Ptah CLI provider discovery (part A §9 integration note, finding 2) | `@ptah-extension/rpc-handlers` | A3 | `J(libs/backend/rpc-handlers, <adapter spec>)` + `npx nx typecheck @ptah-extension/rpc-handlers` | yes (only wave-3 batch touching `register-shared-rpc-handlers.ts`) | CLI lane | Shipping |
| B5 | Lane write point, failure class, spawn-field copy | B §4, plus SC-5 family, SC-6 APM copy and notifier mapping, SC-4 input fields; notifier call is an SC-10 enqueue; signal-path specs with a 5 s store write and a throwing store (findings 1, 5) | `@ptah-extension/cli-agent-runtime` | AB1, B4 | `J(libs/backend/cli-agent-runtime, <classifier, auth, notifier specs>)` + `npx nx typecheck @ptah-extension/cli-agent-runtime` | yes | CLI lane | Shipping |
| B6 | Kept skill-synthesis stores (#23) | B §6, incl. recorder dedup by `runId` (finding 3) | `@ptah-extension/skill-synthesis` | B2, B4 | `npx nx test @ptah-extension/skill-synthesis --parallel=1` | yes | CLI lane | Shipping |
| A4b | Matrix store + local derivation | A4b row; reads SC-2 (`isPersistent`, `SUBAGENT_LANE_ID`, `LANE_DEFAULT_MODEL`) | `@ptah-extension/lane-routing` | A4 | `J(..., <A4b specs>)` | yes (LR/matrix store files) | CLI lane | Shipping |
| A5b | Score, spread, rotation | A5b row | `@ptah-extension/lane-routing` | A4, A5a | `J(..., <A5b specs>)` | yes (LR/ranking score/spread files) | CLI lane | Shipping |
| A11 | Decision-model config RPC | A11 row | `@ptah-extension/shared`, `@ptah-extension/rpc-handlers` | A6b, A10 | `J(libs/backend/rpc-handlers, <decision-model spec>)`, then `npx nx typecheck @ptah-extension/shared`, one at a time | yes (`agent-rpc.handlers.ts`, `rpc-agents.types.ts`) | CLI lane | Shipping |
| A13 | Structured-output adapter | A13 row | `@ptah-extension/agent-sdk` | A6b, B3 (same DI files) | `J(libs/backend/agent-sdk, <adapter spec>)` | yes | CLI lane | Shipping |
| B7 | `agent:outcomeSignals` handler | B §7 minus the app guard specs (moved to AB14); keeps `rpc-allowlist.spec.ts` | `@ptah-extension/rpc-handlers` | AB1, B4, A10 (same registration file) | `J(libs/backend/rpc-handlers, <outcome handler spec, rpc-allowlist.spec.ts>)` | yes (new handler + `register-shared-rpc-handlers.ts`; A11 touches neither) | CLI lane | Shipping |
| B10a | Report tool module | CREATE `mcp-core/tools/outcome-report.tool.ts` (+ spec), importing SC-7 from lane-outcomes; no edits to registration files; SC-7 target rules and the repeated/concurrent same-slug sequence spec (finding 4); rev 2 finding 2: `reportId` per call, held deliverables store stat facts only, `held`/`queued` results, the sequence by run tag and by `agentId`, report-before-stop and held-review fixtures; slug cases removed | `@ptah-extension/vscode-lm-tools` | B4, B5 | `J(libs/backend/vscode-lm-tools, <outcome-report spec>)` | yes | CLI lane | Shipping |
| A8 | Route decide pipeline | A8 row (LR service, pipeline, `register.ts`, index); forwards a live `routeMissing` failure to `markUnsupported` (finding 6) | `@ptah-extension/lane-routing` | A4b, A5b, A6a, A6b, A7 | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | in-process subagent (five modules, long fixture set) | Shipping |
| A12 | Decision model settings row | A12 row; check TASK_2026_658 overlap first | `@ptah-extension/chat` | A11 | `J(libs/frontend/chat, <changed specs>)` | yes | CLI lane (frontend) | Shipping |
| A9a | Route tool modules | CREATE `mcp-core/route-tools.ts`, `route-tool-handlers.ts`, `namespace-builders/route-namespace.builder.ts` and their specs (A §8); no edits to registration files | `@ptah-extension/vscode-lm-tools` | A8 | `J(libs/backend/vscode-lm-tools, <route specs, namespace spec>)` | yes | CLI lane | Shipping |
| A16 | Decision-model failure classifier | CREATE `LR/failure-class/decision-model-failure-classifier.ts` (+ spec: unset → zero requests; fake client counts exactly 1; below threshold → null; outside five → null; payload field set pinned); MODIFY `LR/di/register.ts` (+ spec), `src/index.ts` (SC-4) | `@ptah-extension/lane-routing` | A8 (`answer-validation.ts`, register file) | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | CLI lane | Shipping |
| AB9 | MCP registration for both tools | MODIFY `protocol-dispatcher.ts` (route tool always-on after `buildSessionHandoffTool()`; report tool deferred; two `case`s), `tool-result-budget.ts`, `ptah-api-builder.service.ts`, the `PtahAPI` type file, `mcp-http/http-mcp-server.service.ts`, `mcp-stdio/{tool-builders.ts,agent-tool.dispatcher.ts,index.ts}`, `ptah-system-prompt.constant.ts` (two rows); update the tool-name registry specs (A §8 + B §8); dispatch `switch (name)` is at `protocol-dispatcher.ts:1037` (finding 7) | `@ptah-extension/vscode-lm-tools` | A9a, B10a, A1b | `npx nx test @ptah-extension/vscode-lm-tools --parallel=1` | yes | in-process (nine shared files, both tools) | Shipping |
| AB14 | Host wiring and guard specs | MODIFY the three roots (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`): `registerLaneOutcomeServices` before `registerCliAgentRuntimeServices`, `registerLaneRoutingServices` before `registerVsCodeLmToolsServices`, the SC-3 aliases, `startLaneOutcomes` with its disposer; `expected-resolvable.ts`; three `container.smoke.spec.ts` (vscode, electron, `apps/ptah-cli/src/di/`); `rpc-surface.spec.ts`; Electron `surface-composition.spec.ts`; validate-deps allowlist only if the pre-push gate flags a new lib (A §12 + B §10); the `startLaneOutcomes` disposer is awaited on host shutdown (SC-10 flush); the VS Code smoke spec resolves `KeyValueLaneOutcomeStore` over `PLATFORM_TOKENS.STATE_STORAGE` | `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`, `@ptah-extension/cli-engine` | A8, A10, A13, A16, AB9, B4, B5, B6, B7 | one at a time: `J(apps/ptah-extension-vscode, src/di)`, then `npx nx test ptah-electron --parallel=1`, then `npx nx test @ptah-extension/cli-engine --parallel=1`, then `npx nx test ptah-cli --parallel=1` | yes | in-process | Shipping |
| A15 | Orchestration skill integration | A §13 files; Req 8.7 call sites from R3; spawn passes `taskKind`/`routingSource` (`agent-lanes/SKILL.md`); every subagent report uses the Ptah run tag `runId`, else the Agent result `agentId`; `held`/`queued` count as reported; reviews use the kept `runId` (SC-7, rev 2 finding 2; IA-4 optimisation only) | none (docs) | AB9 (tool names and args final) | grep for vendor-to-task tables (Req 6.9) and for both tool names, recorded in the batch report | yes (assets only) | CLI lane | Docs |

## Parallel waves

Within a wave, batches are file-disjoint and may be authored in parallel, up to three lanes at a time.
Verification is serialized: one heavy check at a time.

| Wave | Batches | Shared heavy checks (run once, after the last batch of the group lands) |
| --- | --- | --- |
| 1 | AB1, A2, B2, B3 | none shared |
| 2 | A3, B4, B8, A1b | none shared |
| 3 | A4, A5a, A6a, A6b, A7, A10, B5, B6 | lane-routing ×5: per-batch Jest on its own specs, then one `npx nx test @ptah-extension/lane-routing --parallel=1` for the wave |
| 4 | A4b, A5b, A11, A13, B7, B10a | lane-routing ×2 (as above); rpc-handlers ×2 (A11, B7): Jest per batch, then one `npx nx typecheck @ptah-extension/rpc-handlers` |
| 5 | A8, A12 | none shared |
| 6 | A9a, A16 | none shared |
| 7 | AB9 | vscode-lm-tools full test (also covers A1b, B10a, A9a) |
| 8 | AB14, A15 | AB14 runs four app/engine checks one at a time |

Critical path: A2 → A3 → A4 → A4b → A8 → A9a → AB9 → AB14 (eight waves). Part B work runs entirely inside
waves 1-4, so it never lengthens the critical path.

## Assumptions to check first

The batch that owns an assumption resolves it before writing code and records the result in its report.

| Id | Was | Assumption | Check | Owning batch (and fallback) |
| --- | --- | --- | --- | --- |
| PA-1 | A A1 | `registerSharedRpcHandlers` runs in all three containers, including the CLI one | grep callers in `apps/ptah-extension-vscode/src/di`, `apps/ptah-electron/src/di`, `libs/backend/cli-engine/src/lib/container.ts` | A10 (and B7, which registers there too); if the CLI lacks it, AB14 registers both directly in `container.ts` |
| PA-2 | A A2 | A host-neutral `~/.ptah` home helper exists | grep `'.ptah'` in `libs/backend/platform-core/src` | A4b; if absent, AB14 injects the path string per root |
| PA-3 | A A3 | `InternalQueryService` takes a per-call provider/model override and `outputFormat` | open `internal-query.types.ts:40-80` | A13 (and A12 row text); if absent, structured output is limited to the main provider |
| PA-4 | A A4 | `ptahAPI.agent.listRoles()` returns workspace role names | read the `agent` namespace `listRoles` | A9a (namespace builder) |
| PA-5 | A A5 | The plugin asset skill copy is the harness sync source | grep the harness sync for `assets/plugins/ptah-core/skills` | A15; if false, also edit the synced copies |
| PB-1 | B A1 | `SubagentStopPayload.agentId` is unique per run | read the agent-sdk producer of the payload | B4 and B6; fallback `subagentSessionId` as `run_id` |
| PB-2 | B A2 | The budget monitor can publish the stopped subagent's `agentId` | read `subagent-budget-monitor.ts` stop path (`:36`, `:518`) | B3 |
| PB-3 | B A3 | A nested subagent session's Skill/prompt-expansion events carry a session id the seam can match | one capture test or log line | B6; fallback `skillsLoaded: null` for subagents |
| PB-4 | B A4 | `AgentProcessInfo.role` holds the slug when a lane is spawned with a role file | `agent-process.types.ts:151` + spawn path | B5 (record) and B8 acceptance |
| PB-5 | B A5 | The notifier's deliverable check is a liftable function of `IFileSystemProvider` + paths + spawn time | read `lane-completion-notifier.service.ts:512-520` | B5 (export); consumed by B10a |
| PB-6 | B §5 inline | `CallbackRegistryBase` isolates a throwing listener | read `callback-registry.base.ts` | B3 |
| PB-7 | B §8 inline | vscode-lm-tools already depends on cli-agent-runtime | **Verified** by this pass: `mcp-core/agent-limit.formatter.ts` imports it | closed |
| PB-8 | B §3 inline | No platform-core logger token | **Verified** by this pass (grep of `platform-core/src`); SC-9 applies | closed |
| IA-1 | new | The spawn-args → `SpawnAgentRequest` mapping (where `role`/`effort` are copied today) lives outside `protocol-dispatcher.ts` | grep `effort` along the `ptah_agent_spawn` path in vscode-lm-tools | A1b; if it is in the dispatcher, move that line to AB9 |
| IA-2 | new | For ptah-cli lanes, `AgentProcessInfo.quotaOwner.providerId` equals the row's `providerId`, so the family on records matches the family on routing rows | compare `quotaOwner` assignment in APM with `CliDetectionResult.providerId` source | B5; if they differ, carry `providerId` on `AgentProcessInfo` at spawn |
| IA-4 | rev 1 | The orchestrating model sees the subagent's `agentId` in the Agent tool result text, and it equals the SubagentStop `agent_id` (SDK type `AgentOutput.agentId`, `sdk-tools.d.ts:100-102`) | B10a: one capture in a dev session, comparing the Agent tool result text with the `[SubagentHookHandler] SubagentStop received` debug line (`subagent-hook-handler.ts:420`) | A15 and B10a. Gate 2 revision 2: an optimisation check only, not a correctness dependency. If either point fails, the skill uses the Ptah run tag (SC-7), which IA-5 covers; nothing else changes |
| IA-5 | rev 2 | Ptah's PostToolUse hook fires for a main-thread `Agent`/`Task` result with `tool_use_id` equal to the subagent registry's `toolCallId` (sync and async launches), so the run tag reaches the parent with the tool result | B3: hook spec with a fake registry (sync result, async-launch result, registry miss); one dev capture of the tag line next to the `SubagentStop received` debug line (`subagent-hook-handler.ts:420`), comparing ids. Precedent: the budget monitor already rides a notice on that tool result through this hook (`subagent-budget-monitor.ts:46-51`) | B3. If the registry key differs, the tag comes from `tool_response.agentId` (SDK `AgentOutput`). If PostToolUse does not fire for the result, B3 delivers the tag line through the monitor's withdraw-to-user-turn route (`subagent-budget-monitor.ts:49-51`, `SubagentHandoffDelivery` `:57`) and records it in the batch report |
| IA-3 | new | tsyringe `useToken` aliases resolve correctly when the consumer checks `isRegistered(token, true)` | AB14 smoke spec resolves `LANE_ROUTING_TOKENS.LANE_OUTCOME_READER` and `LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER` in each host | AB14 |

## Handoff to TASK_2026_662_3eea

Part B § Handoff to TASK_2026_662_3eea is the normative keep-list. This pass adds four integration items:

- Keep `lane-outcomes` and `lane-routing`, the shared `lane-outcome.types.ts`, and both composition-root
  aliases (SC-3). They do not depend on skill-synthesis. A 662 deletion can unbind the skill-synthesis seam
  adapter without breaking routing: subagent records then degrade to `telemetryJoin: 'unavailable'`.
- Keep `ptah_outcome_report` and `agent:outcomeSignals`. Use `agent:outcomeSignals` as the before/after check
  for "Enhance now", as part B says.
- Any new RPC method 662 adds must stay clear of the host-source name pattern (SC-8). Otherwise it needs the
  TASK_2026_610 exception.
- The orchestration skill text from A15 calls `ptah_outcome_report`. If 662 edits that skill, it keeps the
  three Req 8.7 call sites (R3).

## Revision log (Gate 2 round 1)

Source: `implementation-plan-review-round1.md` (codex, REVISE). Decisions #12, #13, #18 (as amended by #22) and
#19 are unchanged.

| Finding | Fix | Files / sections changed | Test or fixture added |
| --- | --- | --- | --- |
| 1 (Serious) Req 5.7: VS Code in-memory store; pre-open writes dropped | Durable storage in every host. Desktop/CLI use SQLite. VS Code uses `KeyValueLaneOutcomeStore` over the existing `PLATFORM_TOKENS.STATE_STORAGE` (globalState), bounded to 90 days / 2 000 rows. Ops that arrive before the desktop/CLI DB opens go to a durable `IStateStorage` journal and are replayed in order on `onDidOpen`; replay is idempotent. Decision #34 | this file: new SC-10; SC-2 `isPersistent` comment; SC-3 note; coverage 5.7; B4, AB14 rows. Part B: evidence rows 46-47, architecture decision, §3 responsibilities/failure/files, §10 verification, integration state, resolution row, D2 | B4: VS Code-shape restart (new store over the same `IStateStorage`), SQLite reopen restart, delayed open (journal → replay on `onDidOpen`), restart before open, double replay, validated op before open; AB14: VS Code smoke resolves the KV store |
| 2 (Serious) Req 11.1: Ptah CLI provider discovery omitted | The A10 adapter adds `ProviderModelsService.fetchModels` (the source behind `provider:listModels`) for Ptah CLI rows, merges after `configured` and `tier`, tags `reported`/`fallback`, races discovery per row, and shares one in-flight call per provider. Decision #35 | Part A §9 (responsibilities, verification); this file: coverage 11.1, A10 row | A10: provenance (live, static, configured id kept), timeout isolation (abort at 2000 ms leaves configured/tier and does not affect a CLI row), discovery throw, no key, one call per provider |
| 3 (Serious) Req 5.4: recorder 2 s bucket merges same-slug runs | Subagent events with a `runId` dedup by `subagent-run:${runId}`; every other event keeps the existing key. Decision #36 | Part B §6 (responsibilities, verification); this file: coverage 5.4, B6 row | B6: recorder spec (two runs in one bucket → two writes; same run twice → one; tool-use unchanged); end-to-end trigger → recorder → store → seam with two runs 500 ms apart |
| 4 (Serious) Req 5.5, 8.7: slug target ambiguous after repeated runs | The skill reports each subagent run by the Agent tool result's `agentId` (the SubagentStop `agent_id` and the run key) and each review by the echoed `runId`. The `{subagent}` slug form is a fallback whose open set uses the new `deliverablesDeclaredAt`. Ambiguity is an error, never a guess. Decision #37, assumption IA-4 | this file: SC-1 field, SC-7 target resolution, coverage 5.5/8.7, B2, B4, B10a, A15 rows, IA-4. Part A §13 skill text. Part B §2 (0054 column), §8 target comment and verification | B10a: sequence spec (two concurrent runs of one slug reported in reverse order, a third repeated run, review rounds per `runId`, slug fallback and ambiguity) |
| 5 (Serious) Req 5.9: sync SQLite write on the completion path | Recorder writes are an O(1) enqueue into the SC-10 pipeline (`setImmediate` drain, at most 25 ops per turn, 1 000-op bound, failure isolation, one `SQLITE_BUSY` retry for idempotent ops, 2 000 ms shutdown flush to the journal). This is the same pipeline as finding 1, not a second one. Decision #34 | this file: SC-10; coverage 5.9; B4, B5, AB14 rows. Part B §4 quality and verification | B5: notifier with a 5 s store write and a throwing store delivers the signal without awaiting the store; B4: ordering, queue bound, shutdown deadline |
| 6 (Serious) Req 1.5: probe checks only `/api/version` | The Ollama probe adds `POST /v1/systemone` with `{}` as a route capability check (a non-JSON 404/405 means `unsupported-endpoint`). A live call with the same answer sets `routeMissing`, and A8 calls `markUnsupported(base)`. Decision #38 | Part A §5 (probe, client, verification); this file: coverage 1.1-1.8, A6a, A6b, A8 rows | A6b: version 0.40.0 + plain-text 404 → `unsupported-endpoint`; JSON 404 and 400 → `ready`; old version skips the POST; timeout → `unreachable`. A6a: `routeMissing` flag. A8: `markUnsupported` forwarding |
| 7 (Moderate) stale dispatcher anchor | `switch (name)` is cited at `protocol-dispatcher.ts:1037`; `:1029` is where the handler's parameters begin | Part B §8 verified contracts; this file: AB9 row | none (anchor only) |

No batch was added or split, and no file moved between batches, so the Parallel waves table is unchanged and
still file-disjoint. The new files (SC-10 store, journal, pipeline) are all inside `libs/backend/lane-outcomes`,
which only B4 owns.

## Revision log (Gate 2 round 2)

Source: `implementation-plan-review-round2.md` (codex, REVISE). Decisions #12, #13, #18 (as amended by #22) and
#19 are unchanged. New decisions #40-#42 are recorded in `decisions.md`.

| Finding | Fix | Files / sections changed | Test or fixture added |
| --- | --- | --- | --- |
| 1 (Serious) Req 5.7: the pre-open journal drops its oldest ops at 1 000 and clears after replay even when an insert throws | Per-op acknowledgement: an op leaves the queue or journal only after its store apply returns; the journal is rewritten once per drain turn without the acknowledged entries. Every op has an idempotency key (`run_id`, `subagent:${agentId}`, `reportId` with a receipt table), so a replayed entry that already landed is a no-op, and `revise` counts once. Failures are classed: permanent (validation, CHECK/NOT NULL constraint) → durable dead-letter key with a `warn`; transient → the drain stops, FIFO is kept (desktop/CLI backlog mode appends every later op to the journal tail), retry with backoff and on `onDidOpen`/next start. The oldest-drop rule is gone: the journal holds 5 000 entries, never discards an accepted one, and refuses only the newest op when full, with a durable `droppedAtCapacity` counter and logged warnings (a Req 5.9 write failure; decision #40). The in-memory queue and completion-path enqueue stay. The VS Code KV path shares the drain and the ack rule | this file: SC-10 (`submit` result states, idempotency-key table, per-op acknowledgement, failure classes, backlog mode, report ops in backlog mode, journal capacity, in-memory queue, shutdown, KV store shape, required tests); coverage 5.6, 5.7, 5.9; B2, B4 rows. Part B: §2 failure note, §3 store operations and failure behaviour | B4: replay insert failure (`[L1, S1, L2]`, S1 throws once → journal exactly `[S1, L2]`, then all applied after 250 ms), restart during a failure streak, recovery after open (ops 2-4 in order), ack crash (row and `reviseRounds` not duplicated), permanent failure → dead letter, 1 500 pre-open completions, capacity 5 000 + 1 with the counter surviving restart, VS Code `update` rejection and queue-full, report before open → `queued` |
| 2 (Serious) Req 5.5, 8.7: reporting depends on IA-4; slug fallback rejects repeated/concurrent runs; report racing its stop is not retried | Ptah supplies the correlation itself: its PostToolUse hook (which already returns `additionalContext`, `post-tool-use-hook-handler.ts:151-159`) appends `ptah-run: runId=subagent:<agentId>` to every main-thread `Agent`/`Task` result, resolving the id from the subagent registry by `tool_use_id` (`subagent-registry.service.ts:379`) or the SDK `AgentOutput.agentId`. The skill reports by that `runId`, else by the SDK `agentId` line; IA-4 is now an optimisation and IA-5 covers the tag. The `{ subagent: slug }` form is removed (decision #41). A report whose `subagent:` run has no row yet is held durably (SQLite table / KV `held` array, stat facts only, no paths), joined in the stop insert's transaction, expired after 24 h with a `warn`, capped at 500 holds (newest refused visibly) | this file: SC-7 (schema, run tag, target forms, report hold, acceptance fixtures); SC-10 key table (join on stop); IA-4 row; new IA-5; coverage 5.5, 8.7; B3, B4, B10a, A15 rows. Part A §13 skill text. Part B §3 store operations, §5 files, §8 type comment, failure note and verification | B3: tag for two concurrent and one repeated same-slug run, registry miss → `tool_response.agentId`, mismatch → registry wins, bad id → no tag, subagent-internal call → no tag. B10a: A/B/C sequence by run tag and by `agentId`. B4 + B10a: report before stop on both paths (held, then joined per run), held review → `reviseRounds 1`, unknown id → Req 5.6 error, one applied + one held, expiry and 501st hold, holds across restart |
| 3 (Serious) Req 1.5: any JSON 404/405 with `error` maps to `ready` | The probe sends the same `POST {}` to a control path no server serves (`/v1/systemone-ptah-probe-absent`) in parallel and compares normalised answers (status + body, request path replaced, JSON by value). Equal to the control → `unsupported-endpoint`; a different 2xx/400/422/404/405 → `ready`; a failed control with a System One 404/405 → `unsupported-endpoint`. A live 404/405 sets `routeMissing` with the body's `error` text, and `markUnsupported(base, detail)` is persisted through `IStateStorage` (`ptah.decisionModel.unsupported.v1`) until the selection or base URL changes or a probe returns `ready` (decision #42) | Part A §5 (probe, client, verification); this file: coverage 1.1-1.8; A6b row | A6b probe: recent version + generic JSON 404 on both → unsupported; path-echo 404 on both → unsupported; route-specific `400 {"error":"model is required"}` → ready; route-specific JSON 404 differing from control → ready; catch-all `200 {}` on both → unsupported; control timeout + 404 → unsupported. A6a client: any live 404 → `routeMissing`. Status: mark survives restart, cleared by base change or `ready`. A8: live 404 → `markUnsupported` once, row unsupported |

No batch was added, split or reordered, and no file moved between batches. The new files and edits stay inside
their existing batches: B2 (0054 tables), B3 (`subagent-run-tag.ts`, `post-tool-use-hook-handler.ts`, both in
agent-sdk and touched by no other batch; A13 edits only agent-sdk DI files in wave 4), B4 (lane-outcomes), B10a
(report tool), A6b (lane-routing decision-model files), A15 (skill assets). The Parallel waves table is therefore
unchanged and still file-disjoint.

## Decisions

Integration decisions only. Each one is also recorded in `decisions.md` as rows 26-33. Gate 2 revision 1
decisions are rows 34-38 there, and Gate 2 revision 2 decisions are rows 40-42 (see the revision logs).

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| I1 | The read port `LaneOutcomeReader {recentOutcomes, isPersistent}` and `LaneOutcomeSummary` live in shared. Each lib keeps its own token, and the composition roots join them with `useToken`. The two libs never import each other. | lane-routing imports lane-outcomes; lane-outcomes imports a lane-routing token | `useToken` precedent `phase-2-libraries.ts:214` (vscode), `:302` (electron); lane-outcomes depends on persistence-sqlite and agent-sdk (part B §3) | yes |
| I2 | Part B's record field set is canonical. `laneId` is `'subagent'` for subagents; `model` is `'lane-default'`; `family` is non-null and computed with `laneFamilyOf` at write time | part A's `completedAt`/`deliveryVerdict`/`null` model | Req 5.2 wording | yes |
| I3 | Spawn args and `AgentProcessInfo` carry optional `taskKind` / `routingSource`; route result rows carry `taskKind` | infer the task kind from the role; leave null | Req 5.2 ("null when the run was not routed with one"); neither part carried the fields | yes |
| I4 | Req 10.3: classifier in lane-routing behind the shared `LaneFailureClassifier` port. The recorder calls it fire-and-forget, once per newly inserted lane record with a null class | classify inside lane-outcomes (duplicates the System One client); skip 10.3 | Req 10.3, 12.5; part A §5 owns the client and settings | yes |
| I5 | Batch merges: AB1 (shared), AB9 (all MCP registration edits), AB14 (all host wiring and app guard specs). Order A10 → B7 and B3 → A13 | parallel edits to the same files | file lists of A1/B1, A9a/A9b/B10, A14/B9, A10/B7, A13/B3 | yes |
| I6 | `agent:outcomeSignals` stays a new RPC method; part A D5 stays as decided | ride on `skillSynthesis:listClones` | `host-source-registry.contract.spec.ts:17-21` checks host-source-shaped names only | yes |
| I7 | lane-outcomes takes a structural logger (no new `vscode-core` import); its `OutcomeReportArgsSchema` is the only report-args schema | `TOKENS.LOGGER` from vscode-core; a second schema beside the tool | repo rule on host-neutral libs; part B §3 vs §8 | yes |
| I8 | Req 8.7: the skill reports subagent deliverables and every review verdict through `ptah_outcome_report`, and passes `taskKind`/`routingSource` on lane spawns; it skips silently when the tool is not listed | report at phase end only; report lanes too | Req 8.7 (lane records need no action), part B §8 target forms | yes |

## Clarifications Needed

None. Every integration choice above is reversible and none is user-reserved. No capability is removed
beyond the Agents-tab "Success" figure (user-approved, decision #13). The new RPC method passes the existing
guard, so it needs no exception from another task.
