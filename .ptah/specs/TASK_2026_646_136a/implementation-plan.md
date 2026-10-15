# Implementation Plan - TASK_2026_646_136a (integrated)

Status: integration pass. `implementation-plan-part-a.md` (routing) and `implementation-plan-part-b.md`
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
  /** false in VS Code (in-memory store) or when the DB is not open → routing adds the Req 4.5 "no outcome
   *  history" reason and uses seed/neutral scores. */
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
the in-memory store, so routing reads `isPersistent() === false`.

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
  z.object({ subagent: z.string().min(1).max(100) }).strict(),
]);
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

## Reconciliation log

| # | Conflict | Resolution | Part edited |
| --- | --- | --- | --- |
| R1 | **Reader contract.** Part A assumed `LaneOutcomeSummary {completedAt, deliveryVerdict, reviewVerdict, family: string, model: string \| null, laneId 'subagent:<role>'}` with a port file and token in lane-routing. Part B defined `{endedAt, verdict, finalReview, family: string \| null, model 'lane-default', laneId 'subagent'}` plus a four-method reader in lane-outcomes with its own token. | Part B's field set wins because it is the record (SC-1). `family` is non-null and `laneId` is `'subagent'` (Req 5.2 wording). `model` uses `'lane-default'`, which routing treats as its own key. The port is `LaneOutcomeReader {recentOutcomes, isPersistent}` in shared (SC-2). Part B's extra methods move to `LaneOutcomeQueries extends LaneOutcomeReader`. Both tokens stay, joined by a `useToken` alias in the roots (SC-3). Rejected: lane-routing importing lane-outcomes, which would pull persistence-sqlite and agent-sdk into the decision engine's graph. Also rejected: lane-outcomes importing lane-routing, which would make the record depend on routing. | A § Assumed contract (replaced by a pointer), A3 row; B §1, §3 |
| R2 | **Dispatcher files.** A9a and A9b (route tool) and B10 (report tool) all edit `protocol-dispatcher.ts`, `mcp-stdio/tool-builders.ts`, `mcp-stdio/agent-tool.dispatcher.ts` and `ptah-system-prompt.constant.ts`. A9b also edits `ptah-api-builder.service.ts`; B10 also edits `http-mcp-server.service.ts`. | Split by file kind. **A9a** creates only the route modules (tool definition, handler, namespace builder and their specs). **B10a** creates only the report tool module and its spec. **AB9** is one batch that makes every edit to an existing registration file for both tools. Order: A9a ‖ B10a → AB9. | A batch table (A9a/A9b → A9a + AB9); B batch table (B10 → B10a + AB9) |
| R3 | **Req 8.7 call site.** Part A §13 deferred it; part B named `ptah_outcome_report` but left the skill text out of scope. | A15 writes three call sites. (1) Lane spawns pass `taskKind` and `routingSource` from the Gate 0.1 row (SC-6). Lane records need no report (Req 5.1). (2) After each subagent run: `ptah_outcome_report {kind:'deliverables', target:{subagent:<slug>}, paths, taskKind, taskId, routingSource}`. The skill keeps the returned `runId`. (3) After each review verdict: `{kind:'review', target:{runId}}`, or `{agentId}` for a lane run, plus the verdict. When the tool is not listed, the skill skips the report silently. Budget-stopped subagents need no skill action: the B3 registry records them. | A §13, A15 row |
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
| 1.1-1.8 decision-model setting | A6a (client), A6b (1.3-1.5 settings, probe), A11 (config RPC), A12 (row UI, 1.4 disclosure), A13 (1.2 structured output, 1.8 confidence null) |
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
| 5.4 subagent one-to-one join | B2 (0055), B4, B6 |
| 5.5 declared deliverables | B5 (helper export), B10a, AB9, A15 |
| 5.6 review attach | B4, B10a, AB9, A15 |
| 5.7 persists, routing reads | B2, B4, A4b, AB14 (alias) |
| 5.8 no text | B4 (row schema), SC-4 input shape (A16, B4) |
| 5.9 write failure non-blocking | B5 |
| 6.1-6.3 seed matrix | A4 |
| 6.4-6.8 user edits, local derivation, view file | A4b |
| 6.9 no vendor-to-task tables | A15 |
| 7.1-7.6 spread | A5b |
| 7.7-7.8 | A8 |
| 8.1-8.6 skill at Pre-flight/Gate 0.1 | A15 |
| 8.7 outcome reports | A15 (call sites R3), needs AB9 |
| 9.1-9.5 Agents-tab signals (9.4 scorecard kept; decision #13 replacement) | B4 (`computeAgentSignals`), B7, B8 |
| 10.1-10.2 failure class | B5 (lanes), B3 + B4 (subagents) |
| 10.3 decision-model classification | A16, B4 (hook), AB14 (alias) |
| 11.1-11.5 model discovery | A10, A8 (11.2-11.5 deadlines) |
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
| B2 | Migrations 0054, 0055 | B §2 | `@ptah-extension/persistence-sqlite` | none | `npx nx test @ptah-extension/persistence-sqlite --parallel=1` | yes | CLI lane | Shipping |
| B3 | Subagent budget-stop registry | B §5 | `@ptah-extension/agent-sdk` | none | `J(libs/backend/agent-sdk, <budget-stop registry spec, monitor spec>)` + `npx nx typecheck @ptah-extension/agent-sdk` | yes | CLI lane | Shipping |
| A3 | Route contracts and ports | A3 row minus `lane-outcome-reader.port.ts` (type comes from shared, SC-2); `ChosenEntry.taskKind` (SC-6); task kinds from `OUTCOME_TASK_KINDS` | `@ptah-extension/lane-routing` | AB1, A2 | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | CLI lane | Shipping |
| B4 | lane-outcomes lib | B §3, plus SC-2 split (`LaneOutcomeQueries`), SC-4 recorder hook, SC-7 schema, SC-9 logger; MODIFY `tsconfig.base.json` | `@ptah-extension/lane-outcomes` | AB1, B2, B3 | `npx nx test @ptah-extension/lane-outcomes --parallel=1` + `npx nx lint @ptah-extension/lane-outcomes` | yes (only wave-2 batch touching `tsconfig.base.json`) | CLI lane (largest; one lane) | Shipping |
| B8 | Library Agents-tab signals | B §9 | `@ptah-extension/skill-synthesis-ui` | AB1 | `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1` | yes | CLI lane (frontend) | Shipping |
| A1b | Row `family` + spawn routing fields | MODIFY `namespace-builders/agent-namespace.builder.ts`, `mcp-core/mcp-response-formatter.ts` (+ spec), `mcp-core/agent-spawn-args.schema.ts` (+ spec) (SC-6), and the spawn-args → `SpawnAgentRequest` mapping site (IA-1) | `@ptah-extension/vscode-lm-tools` | AB1 | `J(libs/backend/vscode-lm-tools, <formatter, agent-namespace, spawn-args specs>)` + `npx nx typecheck @ptah-extension/vscode-lm-tools` | yes, unless IA-1 puts the mapping in `protocol-dispatcher.ts`; in that case the mapping moves to AB9 | CLI lane | Shipping |
| A4 | Matrix data | A4 row | `@ptah-extension/lane-routing` | A3 | `J(libs/backend/lane-routing, <A4 specs>)` | yes (LR/matrix types) | CLI lane | Shipping |
| A5a | Hard constraints | A5a row | `@ptah-extension/lane-routing` | A3 | `J(..., <A5a specs>)` | yes (LR/ranking constraints) | CLI lane | Shipping |
| A6a | System One wire + payload | A6a row | `@ptah-extension/lane-routing` | A3 | `J(..., <A6a specs>)` | yes (LR/decision-model wire) | CLI lane | Shipping |
| A6b | Decision-model settings | A6b row | `@ptah-extension/lane-routing` | A3 | `J(..., <A6b specs>)` | yes (LR/decision-model settings files) | CLI lane | Shipping |
| A7 | Reasons and confidence | A7 row | `@ptah-extension/lane-routing` | A3 | `J(..., <A7 specs>)` | yes (LR/reasons) | CLI lane | Shipping |
| A10 | Lane model listing adapter | A10 row | `@ptah-extension/rpc-handlers` | A3 | `J(libs/backend/rpc-handlers, <adapter spec>)` + `npx nx typecheck @ptah-extension/rpc-handlers` | yes (only wave-3 batch touching `register-shared-rpc-handlers.ts`) | CLI lane | Shipping |
| B5 | Lane write point, failure class, spawn-field copy | B §4, plus SC-5 family, SC-6 APM copy and notifier mapping, SC-4 input fields | `@ptah-extension/cli-agent-runtime` | AB1, B4 | `J(libs/backend/cli-agent-runtime, <classifier, auth, notifier specs>)` + `npx nx typecheck @ptah-extension/cli-agent-runtime` | yes | CLI lane | Shipping |
| B6 | Kept skill-synthesis stores (#23) | B §6 | `@ptah-extension/skill-synthesis` | B2, B4 | `npx nx test @ptah-extension/skill-synthesis --parallel=1` | yes | CLI lane | Shipping |
| A4b | Matrix store + local derivation | A4b row; reads SC-2 (`isPersistent`, `SUBAGENT_LANE_ID`, `LANE_DEFAULT_MODEL`) | `@ptah-extension/lane-routing` | A4 | `J(..., <A4b specs>)` | yes (LR/matrix store files) | CLI lane | Shipping |
| A5b | Score, spread, rotation | A5b row | `@ptah-extension/lane-routing` | A4, A5a | `J(..., <A5b specs>)` | yes (LR/ranking score/spread files) | CLI lane | Shipping |
| A11 | Decision-model config RPC | A11 row | `@ptah-extension/shared`, `@ptah-extension/rpc-handlers` | A6b, A10 | `J(libs/backend/rpc-handlers, <decision-model spec>)`, then `npx nx typecheck @ptah-extension/shared`, one at a time | yes (`agent-rpc.handlers.ts`, `rpc-agents.types.ts`) | CLI lane | Shipping |
| A13 | Structured-output adapter | A13 row | `@ptah-extension/agent-sdk` | A6b, B3 (same DI files) | `J(libs/backend/agent-sdk, <adapter spec>)` | yes | CLI lane | Shipping |
| B7 | `agent:outcomeSignals` handler | B §7 minus the app guard specs (moved to AB14); keeps `rpc-allowlist.spec.ts` | `@ptah-extension/rpc-handlers` | AB1, B4, A10 (same registration file) | `J(libs/backend/rpc-handlers, <outcome handler spec, rpc-allowlist.spec.ts>)` | yes (new handler + `register-shared-rpc-handlers.ts`; A11 touches neither) | CLI lane | Shipping |
| B10a | Report tool module | CREATE `mcp-core/tools/outcome-report.tool.ts` (+ spec), importing SC-7 from lane-outcomes; no edits to registration files | `@ptah-extension/vscode-lm-tools` | B4, B5 | `J(libs/backend/vscode-lm-tools, <outcome-report spec>)` | yes | CLI lane | Shipping |
| A8 | Route decide pipeline | A8 row (LR service, pipeline, `register.ts`, index) | `@ptah-extension/lane-routing` | A4b, A5b, A6a, A6b, A7 | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | in-process subagent (five modules, long fixture set) | Shipping |
| A12 | Decision model settings row | A12 row; check TASK_2026_658 overlap first | `@ptah-extension/chat` | A11 | `J(libs/frontend/chat, <changed specs>)` | yes | CLI lane (frontend) | Shipping |
| A9a | Route tool modules | CREATE `mcp-core/route-tools.ts`, `route-tool-handlers.ts`, `namespace-builders/route-namespace.builder.ts` and their specs (A §8); no edits to registration files | `@ptah-extension/vscode-lm-tools` | A8 | `J(libs/backend/vscode-lm-tools, <route specs, namespace spec>)` | yes | CLI lane | Shipping |
| A16 | Decision-model failure classifier | CREATE `LR/failure-class/decision-model-failure-classifier.ts` (+ spec: unset → zero requests; fake client counts exactly 1; below threshold → null; outside five → null; payload field set pinned); MODIFY `LR/di/register.ts` (+ spec), `src/index.ts` (SC-4) | `@ptah-extension/lane-routing` | A8 (`answer-validation.ts`, register file) | `npx nx test @ptah-extension/lane-routing --parallel=1` | yes | CLI lane | Shipping |
| AB9 | MCP registration for both tools | MODIFY `protocol-dispatcher.ts` (route tool always-on after `buildSessionHandoffTool()`; report tool deferred; two `case`s), `tool-result-budget.ts`, `ptah-api-builder.service.ts`, the `PtahAPI` type file, `mcp-http/http-mcp-server.service.ts`, `mcp-stdio/{tool-builders.ts,agent-tool.dispatcher.ts,index.ts}`, `ptah-system-prompt.constant.ts` (two rows); update the tool-name registry specs (A §8 + B §8) | `@ptah-extension/vscode-lm-tools` | A9a, B10a, A1b | `npx nx test @ptah-extension/vscode-lm-tools --parallel=1` | yes | in-process (nine shared files, both tools) | Shipping |
| AB14 | Host wiring and guard specs | MODIFY the three roots (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`): `registerLaneOutcomeServices` before `registerCliAgentRuntimeServices`, `registerLaneRoutingServices` before `registerVsCodeLmToolsServices`, the SC-3 aliases, `startLaneOutcomes` with its disposer; `expected-resolvable.ts`; three `container.smoke.spec.ts` (vscode, electron, `apps/ptah-cli/src/di/`); `rpc-surface.spec.ts`; Electron `surface-composition.spec.ts`; validate-deps allowlist only if the pre-push gate flags a new lib (A §12 + B §10) | `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`, `@ptah-extension/cli-engine` | A8, A10, A13, A16, AB9, B4, B5, B6, B7 | one at a time: `J(apps/ptah-extension-vscode, src/di)`, then `npx nx test ptah-electron --parallel=1`, then `npx nx test @ptah-extension/cli-engine --parallel=1`, then `npx nx test ptah-cli --parallel=1` | yes | in-process | Shipping |
| A15 | Orchestration skill integration | A §13 files; Req 8.7 call sites from R3; spawn passes `taskKind`/`routingSource` (`agent-lanes/SKILL.md`) | none (docs) | AB9 (tool names and args final) | grep for vendor-to-task tables (Req 6.9) and for both tool names, recorded in the batch report | yes (assets only) | CLI lane | Docs |

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

## Decisions

Integration decisions only. Each one is also recorded in `decisions.md` as rows 26-33.

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
