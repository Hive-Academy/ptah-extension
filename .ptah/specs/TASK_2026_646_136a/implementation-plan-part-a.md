# Implementation Plan, Part A (routing) - TASK_2026_646_136a

Pass A of 2. Covers Requirements 1, 2, 3, 4, 6, 7, 8, 11, 12, 13, the lane `family` field, the
`/v1/systemone` client and DI/guard-spec wiring. Pass B owns Requirements 5, 9, 10, skill
telemetry, `skillsLoaded` and the TASK_2026_662 handoff.

## Inputs and constraints

- Requirements used: `task-description.md` (Scope :66-108; Req 1 :111, 2 :145, 3 :198, 4 :228, 6 :306,
  7 :341, 8 :379, 11 :446, 12 :471, 13 :520; NFR :556; Open questions :605), `decisions.md` (all rows),
  `research-runtime-survey.md` (all), `research-decision-models.md` (grep only: :50-78, :94-99,
  :280-345, :455-481, :540-568), `research-routing-landscape.md:1-30`.
- Corrections applied: `decisions.md` #24 line shifts (main `c57a9a1e7`): verified
  `case 'ptah_agent_list'` at `protocol-dispatcher.ts:1410`, `describeZodIssues` at :732 (was :724).
- Design handoff used: none. Requirement 1 adds one row to an existing component; no new UI surface
  is designed (see Decision D7, matrix as a data file, which avoids a designer phase and Gate 1.7).
- Missing decision-critical input: `research-codebase-survey.md` was not read (context budget); its
  limit-reader facts are covered by the runtime survey §3 and the cited source lines below. No
  decision depends on it.
- User decisions honoured, not reopened: #12 (code ranking always chooses; a model only refines),
  #13, #18 as amended by #22 (no code moves), #19, #20, #24.
- Repository rules that bind this plan: host-neutral libs import no `vscode`/electron; new tokens are
  `Symbol.for`; every new project carries `scope:*` + `type:*` (`eslint.config.mjs:291-292`,
  `:407-427`); do not grow `protocol-dispatcher.ts` beyond one `case` (handler module behind the
  existing facade); verification is per project, `--parallel=1` / `--maxWorkers=2` (CLAUDE.md).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Always-on tools are listed outside every `disabled.has(...)` guard; `ptah_session_handoff` is the latest precedent | `protocol-dispatcher.ts:515-526` | `buildRouteDecideTool()` goes in the same always-on block (Req 2.1 "any host") |
| Session tools dispatch through one handler module: `case SESSION_*: handleSessionToolCall(name, args, ptahAPI.session, logger)` returning `{isError,text}` | `protocol-dispatcher.ts:2322-2337`; `session-tool-handlers.ts:485-516` | Routing gets `route-decide-tool-handler.ts` with the same reply shape; the dispatcher grows by one `case` |
| Inline Zod idiom, issues rendered by `describeZodIssues` | `protocol-dispatcher.ts:732` | Arg errors name the field (Req 2.5) |
| `ptah_agent_list` gathers rows with `ptahAPI.agent.list()`, `lookupAgentLimits(ptahAPI, agents)`, `ptahAPI.agent.listRoles()` | `protocol-dispatcher.ts:1410-1431`, `:254` | The routing candidate source reuses these three calls; no second agent-list service |
| Stdio surface is a separate dispatcher with its own name list and `switch` | `mcp-stdio/agent-tool.dispatcher.ts:238-306`; `mcp-stdio/tool-builders.ts:58-69,77-90,191-204`; `stdio-mcp-server.service.ts:181` | Add `route_decide` to `MCP_MVP_TOOL_NAMES`, `TOOL_NAMES`, the `switch`, and `buildMcpMvpTools` via `rename()` |
| Namespaces resolve optional host services lazily from the container (`isRegistered(token, true)`) | `ptah-api-builder.service.ts:1163-1168`, `:515-519`, `:915-922` | New `route` namespace resolves `LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE` lazily; unregistered host → tool returns the deterministic "no service" reply, never a crash |
| Row type has `cli`, `installed`, `disabled`, `ptahCliId`, `providerId`, `preferredRank`; no family | `libs/shared/src/lib/types/agent-process.types.ts:364-395`; CLI ids `:70-82` | `family` is new; `preferredRank` is the stored preference (Req 2.4) |
| Family is defined in prose: "the lane's `cli` value or ptah-cli provider token, or the in-process model family" | `.claude/skills/agent-lanes/SKILL.md:190-191` | `laneFamilyOf()` codifies exactly that rule; no vendor table |
| Limit states `at-limit`/`near-limit`/`confirmed-room`/`unknown` | `libs/shared/src/lib/utils/plan-limits/lane-state.ts:158-159` | Spread order and the at-limit exclusion use the shared type |
| CLI model listing with provenance: only codex and copilot can be live-`reported`; the rest are fallback | `rpc-handlers/src/lib/services/cli-model-list.service.ts:36-50,52-80`; registered `register-shared-rpc-handlers.ts:55` | Model listing is a port implemented in `rpc-handlers` (it already depends on vscode-lm-tools, so the reverse import would be circular) |
| `listModelsForAll` has no timeout | runtime survey §5 (`cli-detection.service.ts:182-222`) | The routing side wraps each listing in its own deadline (Req 11.5) |
| Ptah CLI full configs (`selectedModel`, `tierMappings`) only via `PtahCliConfigPersistence.loadConfigs()` | runtime survey §5 (`ptah-cli.types.ts:13-34`, token `SDK_PTAH_CLI_CONFIG_PERSISTENCE`) | Ptah CLI rows get provenance `configured` / `tier` from configs |
| Background roles are rows of `ptah-provider-consumer-assignments`, keyed by `BackgroundConsumerId`, saved at global scope | `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:55-77`; `provider-consumer-rows.ts:12,183-198`; summary count `orchestration-settings.component.ts:141-152` | The Decision model row is a seventh consumer row with its own kind picker |
| Ollama base URL: config `provider.<id>.baseUrl`, default `http://127.0.0.1:11434` | `auth-providers/.../ollama-model-discovery.service.ts:271-284`; `libs/shared/src/lib/providers/entries/local-provider-entry.ts:37` | The System One client reads the same key; no second Ollama URL setting |
| Host-neutral ports exist for secrets, config and state | `platform-core/src/interfaces/secret-storage.interface.ts:9-26`, `workspace-provider.interface.ts:9,34,51`, `state-storage.interface.ts:12-23`; tokens `platform-core/src/di/tokens.ts:13,16,22,25` | The new lib depends on `platform-core` only, never on `vscode-core` |
| Tag rules: `scope:extension` may use `scope:shared|extension`; `type:feature` may use feature/data-access/util | `eslint.config.mjs:291-292,407-415` | New lib `lane-routing` tagged `scope:extension`, `type:feature` |
| Spawn already accepts `model` and `modelTier`; no model → lane default | runtime survey §6 (`agent-spawn-args.schema.ts:35-36`; dispatcher log `modelTier ?? 'sonnet'`) | `lane-default` means "omit `model`"; roster model values map 1:1 to spawn args |
| System One request `{model,state,questions}`; `choice` answers carry `choice`, `probabilities`, `confidence`; 1-64 questions, 2-26 options (Ollama), 255 (Jev), 64 KiB body | `research-decision-models.md:50-78,280-345` | One raw-fetch client, configurable base URL (research rec. 5, :563) |
| Structured-output path has a self-reported confidence with no distribution | `research-decision-models.md:455-481` | Structured-output answers carry confidence `null` (Req 1.8) |

## Architecture decision

- Chosen approach: a new host-neutral library `libs/backend/lane-routing` (`@ptah-extension/lane-routing`,
  tags `scope:extension`, `type:feature`) owns everything that decides: candidate eligibility (hard
  constraints), scoring from the capability matrix, the spread rule with persisted rotation, the
  decision pipeline and request budget, the System One client, the decision-model settings reader, and
  the reason/confidence compiler. It depends only on `@ptah-extension/shared`, `@ptah-extension/platform-core`,
  `tsyringe` and `zod`. Inputs it cannot gather itself are ports: `RouteCandidateSource` (rows, limits,
  roles — implemented per call in `vscode-lm-tools` from the existing `ptahAPI.agent` calls),
  `LaneModelListing` (implemented in `rpc-handlers` over `CliModelListService` and Ptah CLI configs),
  `StructuredDecisionCompleter` (implemented in `agent-sdk` over the internal query `outputFormat`),
  and `LaneOutcomeReader` (pass B). The MCP surface is thin: one tool definition, one Zod schema, one
  handler module, one `route` namespace on `PtahAPI`, one `case` in each dispatcher.
- Rationale: Req 2.1/NFR Compatibility need the tool on HTTP and stdio in all three hosts; the
  routing logic must be testable without a host (Req 3, 7, 12, 13 are all fake-clock / fake-model
  tests). Keeping it out of `cli-agent-runtime` avoids deepening that lib's `vscode-core` leak
  (runtime survey, orchestrator note 1); keeping it out of `vscode-lm-tools` keeps the MCP lib a
  transport and avoids growing `protocol-dispatcher.ts`.
- Rejected alternatives:
  - Put the engine in `cli-agent-runtime` beside `LaneLimitLookupService`: it imports `TOKENS`/`Logger`
    from `vscode-core` (runtime survey §1-2), and the engine would inherit that dependency.
  - Put it in `vscode-lm-tools/mcp-core`: the MCP core is a transport; a ~15-file decision engine there
    repeats the god-file problem one directory down, and `rpc-handlers` (which owns the model list)
    already depends on `vscode-lm-tools`, so model listing could not be reached without a cycle.
  - Pure functions in `libs/shared/src/lib/utils` (like `lane-state.ts`): the pure ranking would fit,
    but the client, settings, rotation store and DI service would not; splitting one feature across
    two libs for no reuse loses cohesion. Only `laneFamilyOf()` goes to `shared` because pass B's
    outcome record and the `agent.list` row both need it.
  - The TypeSafe JS SDK: base-URL override undocumented (`research-decision-models.md:540-541`); a
    ~150-line raw-fetch client avoids a dependency (research rec. 5).
- Assumptions (each with the check that resolves it):
  - A1 `registerSharedRpcHandlers` runs in all three containers, including the CLI container used by
    `ptah mcp serve`. Check: grep its callers in `apps/ptah-extension-vscode/src/di`, `apps/ptah-electron/src/di`,
    `libs/backend/cli-engine/src/lib/container.ts`. If the CLI container lacks it, register the
    `LaneModelListing` adapter in `container.ts` directly.
  - A2 There is an existing helper for the Ptah home directory (`~/.ptah`) usable from a host-neutral
    lib. Check: grep `'.ptah'` in `libs/backend/platform-core/src`. If none, the matrix file path is
    injected as a string by each composition root (one line per host).
  - A3 `InternalQueryService` accepts a per-call provider/model override like the curator adapter
    (`sdk-internal-query.curator-llm.ts:214-256`) and `outputFormat` (`internal-query.types.ts:65`).
    Check: open `internal-query.types.ts:40-80`. If no override exists, the structured-output kind is
    limited to the main agent's provider and the settings row says so.
  - A4 `ptahAPI.agent.listRoles()` returns workspace role names (`.claude/agents/*.md`). Check: the
    `agent` namespace builder `listRoles`.
- Effect on existing code: `ptah_agent_list` rows gain a `family` field (shared type + `agent.list`
  + one formatter cell); `protocol-dispatcher.ts` gains one import group, one builder call and one
  `case`; the stdio dispatcher gains one name and one `case`; the Background Model Roles list gains a
  seventh row. Nothing is removed in pass A. The orchestration skill keeps its rule tables (Req 8.6)
  but loses any vendor-to-task table (Req 6.9).

## Routing constants (S, B, T, K, L, P, Q, timeout, threshold, matrix values)

All values live in one file, `lane-routing/src/lib/routing-constants.ts`, as exported `const`s, so
tests import them and a later tuning edits one place. They are not user settings (no requirement
asks for that; adding them would be speculative configuration).

| Name | Value | Why |
| --- | --- | --- |
| S score scale | Integer 0-100, higher is better | Readable in the Gate 0.1 table; maps the three research labels without fractions |
| Neutral score (Req 6.4) | 50 | Midpoint: "no profile" neither attracts nor repels |
| Seed label map (Req 6.2) | strong = 80, good = 65, weak = 35 | Spacing exceeds B, so a strong/good seed difference is outside the band and a weak model is never rotated in beside a strong one |
| B closeness band | 5 points; a difference exactly equal to B is **inside** (`top - score <= B`) | Smaller than any label gap (15), so seeds stay ordered, while neutral rows (all 50) rotate |
| Limit order inside the band | `confirmed-room` > `unknown` > `near-limit`; `at-limit` excluded earlier | `near-limit` is known risk, `unknown` is not evidence of room (`lane-state.ts:158-159`), so it ranks between |
| T tie-break (total) | 1) caller `preferences.prefer` order (listed before unlisted); 2) `preferredRank` ascending, ranked (≥1) before unranked (0/absent); 3) executor kind: lane before subagent; 4) candidate id, ordinal string compare | Deterministic and total (ids are unique per call); stored preference only orders, never overrides a constraint or the band |
| K rotation key | `${phase.id}|${taskKind}` where `taskKind` ∈ plan, implement, review, research, tests, docs | Meets "at least the phase and the task kind"; phase ids are the caller's own |
| L rotation lifetime | Persisted across restarts in global `IStateStorage` under `laneRouting.rotation.v1` (map K → last chosen candidate id, capped at 200 keys, oldest dropped) | Req 7.5 continuation; global so every workspace spreads the same lanes |
| P options per phase | `min(4, providerOptionLimit)`; provider limit 26 (Ollama), 255 (Jev), 8 (structured output) | Small option sets reduce first-option and context-rot effects (`research-decision-models.md:88-92`); never below 2 |
| Q questions per request | 32 | Half the documented 64 (`research-decision-models.md:74`); one question per phase, so 32 phases per request |
| Request timeout (Req 4.1) | 3000 ms per decision-model request; return margin 250 ms | Slowest documented figure is ~1.1 s per record on a mid GPU, Jev median 0.66 s (`research-decision-models.md:96-99`); 3 s covers both with ~3x headroom |
| Model-listing budget (Req 11.2/11.5) | 2000 ms for all rows, each row raced independently | Lists run in parallel; a slow row becomes `lane-default` without delaying others |
| Confidence threshold (Req 4.3) | 0.5, strict: `confidence < 0.5` falls back | Research rec. 4 (`research-decision-models.md:562`) |
| Request-size limit (Req 12.6) | 64 KiB for every kind (Ollama documented; Jev undocumented, use the same) | One rule; shrink options per phase to ≥2, else `payload-too-large` |
| Staleness age (Req 6.2) | 180 days (`stale = now - asOf > 180 d`) | Benchmarks move every few months; every 2026-02 seed is flagged stale today, which is honest |
| Minimum sample count (Req 6.6) | 5 verified runs per family + model + task kind in the window | Below 5, one bad run moves the value by >20 points |
| Outcome window | 90 days (`sinceMs = now - 90 d`) | Long enough to reach 5 runs per cell at current lane volume; pass B's Library window W is its own choice |
| Local value derivation (Req 6.6) | `round(100 * r)` where `r` = delivered rate when only it has ≥5 verified runs, review pass rate when only it has, else the mean of both; `asOf` = newest contributing record | Uses the two Requirement 9.1 rates exactly; a rate with a small denominator does not dilute the other |
| Overall call budget | ≤ 2000 ms gather + ≤ 2 × (3000 + 250) ms requests ≈ 8.5 s worst case | Bounded; no retries (Req 12.5) |

## Component specifications

Paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\`. `LR` = `libs/backend/lane-routing/src/lib/`.

### 1. Lane family

- Purpose: one codified definition of a lane's family for the reviewer-family rule (Req 3.3, 12.4)
  and for pass B's outcome record.
- Integration note (SC-5): the signature is `laneFamilyOf(input: LaneFamilyInput)`, a structural
  `{cli, ptahCliId?, providerId?}`, so part B's notifier can call it. The `lane-routing` tokens file also
  declares `FAILURE_CLASSIFIER` for batch A16 (SC-4).
- Responsibilities: `laneFamilyOf(row)` returns `row.providerId` for `cli === 'ptah-cli'` (falls back
  to `'ptah-cli:' + ptahCliId` when no provider id), otherwise `row.cli`; `SUBAGENT_FAMILY = 'claude'`
  for in-process subagents. `agent.list` sets `family` on every row; `ptah_agent_list` shows it.
- Verified contracts: rule text `agent-lanes/SKILL.md:190-191`; row type `agent-process.types.ts:364-395`;
  `agent.list` source `namespace-builders/agent-namespace.builder.ts:440-497` (runtime survey §4);
  row cells `mcp-response-formatter.ts:1742-1775`.
- Dependencies: `shared` only (type:util). No vendor names in code.
- Integration: `CliDetectionResult.family?: string` (readonly, optional so old fixtures compile);
  set in `agent.list`; formatter adds `family: <x>` to the capabilities cell (no new column, so
  existing column-count specs hold).
- Failure behaviour: a row with neither `providerId` nor `ptahCliId` for `ptah-cli` gets family
  `'ptah-cli'`, never throws.
- Verification seam: unit spec for `laneFamilyOf` (system CLI, ptah-cli with/without provider);
  existing formatter spec extended for the `family` cell.
- Files: CREATE `libs/shared/src/lib/utils/lane-family.ts`, `libs/shared/src/lib/utils/lane-family.spec.ts`;
  MODIFY `libs/shared/src/lib/types/agent-process.types.ts`, `libs/shared/src/index.ts` (or the utils
  barrel it re-exports), `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`,
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (+ its spec).

### 2. `lane-routing` library scaffold and DI

- Purpose: the project, its tokens and its registration function.
- Responsibilities: `project.json` (tags `scope:extension`, `type:feature`, `test` + `lint` +
  `typecheck` targets copied from a sibling backend lib), `jest.config.ts`, `tsconfig*.json`,
  `tsconfig.base.json` path `@ptah-extension/lane-routing`; `LR/di/tokens.ts` with
  `LANE_ROUTING_TOKENS = { ROUTE_DECIDE_SERVICE, DECISION_MODEL_CONFIG, LANE_MODEL_LISTING,
  STRUCTURED_DECISION, LANE_OUTCOME_READER, CAPABILITY_MATRIX_STORE, ROTATION_STORE }`, each
  `Symbol.for('LaneRouting<Name>')`; `LR/di/register.ts` `registerLaneRoutingServices(container)`
  registering the lib-owned services (route service, decision-model config, matrix store, rotation
  store) as singletons. Ports implemented elsewhere (`LANE_MODEL_LISTING`, `STRUCTURED_DECISION`,
  `LANE_OUTCOME_READER`) are injected `{ isOptional: true }`.
- Verified contracts: `Symbol.for` token style `platform-core/src/di/tokens.ts:13-25`; optional
  injection precedent `ptah-api-builder.service.ts:518`; registration-function precedent
  `cli-agent-runtime/src/lib/di/register.ts:53` (runtime survey §2).
- Dependencies: `shared`, `platform-core` (`FILE_SYSTEM_PROVIDER`, `STATE_STORAGE`,
  `SECRET_STORAGE`, `WORKSPACE_PROVIDER`), `tsyringe`, `zod`. Logger: use the platform-core logger
  port if one exists, else a constructor-injected `(msg, meta) => void` sink; never import `vscode-core`.
- Failure behaviour: unregistered optional ports degrade per §Failure behaviour; registration
  itself has no I/O.
- Verification seam: `npx nx test lane-routing --parallel=1`; a `register.spec.ts` resolves every
  lib-owned token from a fresh container with platform fakes.
- Files: CREATE `libs/backend/lane-routing/{project.json,jest.config.ts,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json,eslint.config.mjs,README.md}`,
  `libs/backend/lane-routing/src/index.ts`, `LR/di/tokens.ts`, `LR/di/register.ts`, `LR/di/register.spec.ts`,
  `LR/routing-constants.ts`; MODIFY `tsconfig.base.json`.

### 3. Capability matrix

- Purpose: lane strengths as data with provenance (Req 6).
- Responsibilities:
  - `LR/matrix/matrix.types.ts` + `matrix.schema.ts`: profile key `{ family, model }` with
    `model = '*'` for the family-level profile; per task kind a cell `{ kind:'unknown' } |
    { kind:'value', score, source:'seed'|'user'|'local', asOf, stale, note?, sampleCount? }`.
  - `LR/matrix/seed-matrix.ts`: shipped seed, implement kind only, from `research-routing-landscape.md:15-30`
    rows labelled from source [1]. A row is seeded only when its lane family is stated in the row
    and its model id is written exactly as the lane lists it (checked against the shipped fallback
    lists, `cli-model-list.service.ts` / adapter lists); otherwise omitted. `source` = the SWE-bench
    Verified URL, `asOf` = the row's publication date, `note` = "backend implementation only".
  - `LR/matrix/capability-matrix.store.ts`: loads the user file `~/.ptah/routing/capability-matrix.json`
    (only user cells; Ptah creates an empty template once and never rewrites it), validates it with
    Zod, keeps the last valid copy on a bad edit and reports `matrix-invalid: <entry path>` in
    `reasons` (Req 6.7); derives local cells from `LaneOutcomeReader` (constants table); resolves a
    cell with precedence user > local > seed > unknown, falling back from the model profile to the
    family profile when the model is `lane-default`/`auto` (Req 11.3) or has no profile; writes the
    read-only view `~/.ptah/routing/capability-matrix.view.json` (every cell with value, `source`,
    `asOf`, `stale`, sample count) only when its content changed (Req 6.8).
- Verified contracts: `IFileSystemProvider` token `platform-core/src/di/tokens.ts:13`; staleness and
  derivation values in the constants table; research rows `research-routing-landscape.md:9-30`.
- Dependencies: `LANE_OUTCOME_READER` (optional, pass B), file system port.
- Failure behaviour: missing file → seed only; unreadable/invalid file → last valid (or seed) +
  reason; outcome reader absent/throws → no local cells + reason `outcomes-unavailable`.
- Quality: load ≤ 1 file read per call; view write only on change.
- Verification seam: specs — fresh seed has `unknown` in every non-implement cell (Req 6.3); unseen
  family resolves to neutral "no profile" (6.4); user cell survives a seed change (6.5); 5-sample
  local derivation fixture (6.6); malformed edit rejected with entry name (6.7).
- Files: CREATE `LR/matrix/{matrix.types.ts,matrix.schema.ts,seed-matrix.ts,capability-matrix.store.ts,local-derivation.ts}`
  and a spec per non-type file.

### 4. Ranking engine (constraints, scoring, spread)

- Purpose: the deterministic code ranking of `decisions.md` #12, used with or without a model.
- Responsibilities:
  - `LR/ranking/hard-constraints.ts`: per phase, exclude with a rule: `at-limit`, `disabled`,
    `not-installed`, `never-on-a-lane` (phase kinds `visual-review`, `design` take subagents only,
    `lane-assignment.md:60-73`), `reviewer-family` (review phases, against every implement phase's
    chosen executor family, or `reviews` ids when given). Pins are checked by the same function and
    yield `pin-unavailable` with the broken rule or `not-listed`; a broken pin is never substituted
    (Req 3.6).
  - `LR/ranking/score.ts`: `score(candidate, taskKind, matrix)` → `{ score, provenance }`; per lane
    row the model is chosen first: the listed model whose resolved cell beats the family-level cell
    by more than B, else `configured` model (Ptah CLI `selectedModel`), else `lane-default`.
  - `LR/ranking/spread.ts`: band = eligible with `top - score <= B`; keep the best limit class present
    (`confirmed-room` > `unknown` > `near-limit`); order by T; pick the first member after the K's
    last pick (cyclic); the full ranking is `[pick, rest of band in T order after pick, then others by
    score desc, limit class, T]`. Pure; rotation state passed in and returned.
  - `LR/ranking/rotation.store.ts`: `IStateStorage` persistence of K → last pick, capped at 200 keys.
- Verified contracts: limit states `lane-state.ts:158-159`; `preferredRank`
  `agent-process.types.ts:379-380`; never-on-a-lane list `lane-assignment.md:60-73`; fallback order
  `lane-assignment.md:114-120`.
- Dependencies: matrix store, rotation store; no I/O in `hard-constraints`, `score`, `spread`.
- Failure behaviour: rotation store read fails → empty state, reason `rotation-unavailable`; write
  fails → logged, decision still returned.
- Verification seam: table-driven specs for Req 3.2-3.6, 7.1-7.6 (boundary B-1, B, B+1), and 7.4
  determinism. No mocks of the code under test.
- Files: CREATE `LR/ranking/{candidate.types.ts,hard-constraints.ts,score.ts,spread.ts,rotation.store.ts}`
  plus specs.

### 5. Decision-model settings and clients

- Purpose: the optional "Decision model" role (Req 1) and the calls it makes (Req 12).
- Responsibilities:
  - `LR/decision-model/decision-model.config.ts` (`DECISION_MODEL_CONFIG`): reads/writes
    `agentOrchestration.decisionModel` via `IWorkspaceProvider.getConfiguration/setConfiguration`
    (global), and the Jev key via `ISecretStorage` key `ptah.laneRouting.jevApiKey` (never in
    settings, never returned). Computes locality: Ollama endpoint host is `127.0.0.1`/`localhost`/`::1`
    → `local`, else `remote`; Jev and structured providers other than a local Ollama → `remote`.
    Status probe: Ollama `GET {base}/api/version`, requires ≥ 0.35.0 (0.40.0 when the model id starts
    with `laya`), 1500 ms timeout; Jev: credential present/absent only (no paid call); structured:
    the port's `isReady(providerId)`.
    Integration note (Gate 2 revision 1 finding 6, Req 1.5): a recent version does not prove the route
    exists, so the Ollama probe has a second step, a route capability check. When the version passes, the
    probe sends `POST {base}/v1/systemone` with the body `{}`. That body names no model and no input, so it
    cannot start inference. Both steps share the one 1500 ms budget. Result mapping:
    - HTTP 404 or 405 whose body is not a JSON object with an `error` field (Go's router answers
      `404 page not found` as plain text) → `unsupported-endpoint`, detail
      `endpoint does not serve /v1/systemone`.
    - Any other HTTP answer (400 or 422 for the empty body, or 2xx) → `ready`. This includes a JSON 404
      such as model-not-found, because it shows the route exists.
    - Network error or timeout → `unreachable`.
    The version check still runs first, so an old Ollama reports its version in `detail` and the POST is
    skipped.
    Live calls feed the same state. The System One client (below) marks a failure `routeMissing: true`
    when a call gets the same non-JSON 404/405. The pipeline (§6, A8) then calls
    `DecisionModelStatus.markUnsupported(baseUrl)`. That status stays in the status cache until the
    selection or base URL changes or a later probe passes, so the row shows `unsupported-endpoint` even when
    an earlier probe passed. The Req 12.7 cause of that call stays `provider-error`.
  - `LR/decision-model/system-one.client.ts`: raw `fetch` POST to `{base}/v1/systemone` (Ollama base
    from `provider.ollama.baseUrl`, default `http://127.0.0.1:11434`; Jev base
    `https://api.typesafe.ai`), `Authorization: Bearer` for Jev only, `AbortSignal.timeout(3000)`,
    body size checked before send, response validated with Zod, HTTP 401/403 → `auth`, network error
    → `unreachable`, other non-2xx → `provider-error` (with `routeMissing: true` for a non-JSON 404/405,
    finding 6), schema failure → `bad-output`. No retries.
  - `LR/decision-model/structured-decision.port.ts`: `StructuredDecisionCompleter` interface; the
    pipeline renders each question as an enum property of one JSON schema and maps the answer to
    the same `DecisionAnswer` shape with `confidence: null` (Req 1.8). Any model-supplied text field
    is dropped (Req 13.1).
- Verified contracts: Ollama base URL key `ollama-model-discovery.service.ts:271-284`, default
  `local-provider-entry.ts:37`; System One body `research-decision-models.md:50-58,280-345`; limits
  `:70-78`; secret port `secret-storage.interface.ts:14-26`; config port `workspace-provider.interface.ts:34,51`.
- Dependencies: platform ports; `STRUCTURED_DECISION` optional.
- Failure behaviour: every failure maps to one Req 12.7 cause; nothing throws past the client.
- Quality/security: payload builder emits only request text, option labels (lane id, family, model,
  limit state, score) and aggregated outcome figures; a spec pins the field set (NFR Security).
  The key is redacted from logs.
- Verification seam: client spec with a stub `fetch` (status codes, timeout via fake timers, size
  limit); config spec with in-memory ports (unset sends nothing — Req 1.3). Probe spec (finding 6,
  Req 1.5), stub `fetch`: `/api/version` answers `0.40.0` and `POST /v1/systemone` answers 404
  `404 page not found` (text/plain) → `unsupported-endpoint` with the route detail; same version with
  400 JSON → `ready`; JSON 404 `{"error":"model not found"}` → `ready`; version `0.34.2` → unsupported with
  the version detail and no POST sent; POST past the shared 1500 ms budget (fake timers) → `unreachable`.
  Client spec: plain-text 404 → `provider-error` with `routeMissing: true`; JSON 404 → `routeMissing`
  absent. Status spec: `markUnsupported(base)` after a passing probe → `unsupported-endpoint` until the base
  URL changes. Pipeline spec (A8): a live call with `routeMissing` → `markUnsupported` called once.
- Files: CREATE `LR/decision-model/{decision-model.types.ts,decision-model.config.ts,system-one.client.ts,system-one.schema.ts,structured-decision.port.ts,decision-payload.ts}`
  plus specs.

### 6. Route decide service (pipeline)

- Purpose: run one `pre-flight` or `gate-0.1` call end to end (Req 2, 4, 11, 12).
- Responsibilities: `LR/route-decide.service.ts` `decide(args, source)`: gather (rows, limits,
  roles via `RouteCandidateSource`; models via `LaneModelListing` raced per row against the 2000 ms
  budget; matrix; outcomes) → constrain → score → spread → (no model: return tops) / (model: build
  request 1 for non-review phases with ≥2 candidates, top P options, rotation pick first, ≤Q
  questions in caller order; validate answers against offered options; then re-filter review
  candidates by the families just chosen and send request 2) → apply threshold → compile reasons and
  confidence → persist rotation for the final picks → return. At `pre-flight`: one request with the
  two choice questions (task type over the task contract's types, depth over `Full|Partial|Minimal`),
  or nulls with source `skill-table` when unset/fallback.
- Verified contracts: Req 12.1-12.9 order; spawn arg mapping `agent-spawn-args.schema.ts:35-36`.
- Dependencies: components 3, 4, 5, 7; ports `RouteCandidateSource`, `LaneModelListing`,
  `LaneOutcomeReader`.
- Failure behaviour: see §Failure behaviour; the method never rejects for data or model problems,
  only for programmer errors (caught by the handler and reported as a tool error).
- Verification seam: service specs with fake source, fake listing, fake client and fake clock:
  Req 2.7 fixtures, 3.1 invented ids, 4.1-4.6 cause table, 7.7-7.8 first-option fake, 11.2/11.4/11.5,
  12.3-12.9 (including the 70-phase fixture), zero outbound requests when unset (1.3, 4.4).
- Files: CREATE `LR/route-decide.service.ts`, `LR/route-candidate-source.port.ts`,
  `LR/lane-model-listing.port.ts`, `LR/lane-outcome-reader.port.ts`, `LR/pipeline/{gather.ts,model-refine.ts,answer-validation.ts}`
  plus specs (`route-decide.service.spec.ts` may split into `*.gate.spec.ts` / `*.preflight.spec.ts`).

### 7. Reason and confidence compiler

- Purpose: every reason and confidence from the result's own facts (Req 13).
- Responsibilities: `LR/reasons/compile-reasons.ts` builds each entry's reason from fixed
  templates (executor, model, score, cell provenance, limit state, rotation/preference effect,
  model probability or "no confidence reported", fallback cause; for unavailable: exclusion reason
  and each candidate's rule) and the top-level `reasons` (excluded candidates, missing inputs);
  `LR/reasons/confidence.ts` implements Req 13.5 exactly (min over model-sourced; null if none or
  any null).
- Dependencies: types only.
- Failure behaviour: pure; no I/O.
- Verification seam: the consistency spec of Req 13.4 over every source, cause and exclusion
  reason; the four confidence fixtures of 13.5.
- Files: CREATE `LR/reasons/{compile-reasons.ts,confidence.ts}` plus specs.

### 8. MCP surface (`ptah_route_decide`)

- Purpose: expose the service on HTTP and stdio MCP (Req 2.1).
- Responsibilities:
  - `mcp-core/route-tools.ts`: `ROUTE_DECIDE_TOOL_NAME = 'ptah_route_decide'`, `buildRouteDecideTool()`
    (`MCPToolDefinition`, JSON schema generated from the Zod args schema, `readOnlyHint: false`
    because it updates rotation state).
  - `mcp-core/route-tool-args.schema.ts`: `RouteDecideArgsSchema` (re-exported from `lane-routing`,
    so both dispatchers and the service validate with one schema).
  - `mcp-core/route-tool-handlers.ts`: `handleRouteToolCall(args, ptahAPI.route, logger)` →
    `{ isError, text }`; invalid args → `isError` with `describeZodIssues` text naming the field, and no
    service call (Req 2.5).
  - `namespace-builders/route-namespace.builder.ts`: `route.decide(args)` builds a
    `RouteCandidateSource` from `agent.list()`, `agent.limits(rows)` and `agent.listRoles()` (the
    same calls as `protocol-dispatcher.ts:1410-1431`) and calls the lazily resolved service; no
    service registered → the handler returns the tool error of §Failure behaviour F9.
  - `protocol-dispatcher.ts`: import group, `buildRouteDecideTool()` in the always-on block after
    `buildSessionHandoffTool()` (:526), one `case ROUTE_DECIDE_TOOL_NAME`.
  - stdio: `'route_decide'` in `MCP_MVP_TOOL_NAMES` (`tool-builders.ts:58-69`),
    `buildMcpRouteDecideTool()` via `rename()`, appended in `buildMcpMvpTools`;
    `AgentToolDispatcher.TOOL_NAMES` and `switch` (`agent-tool.dispatcher.ts:238-306`) gain
    `route_decide` → the same `handleRouteToolCall`.
  - `tool-result-budget.ts`: a budget override for `ptah_route_decide` (24 000 chars) so the
    70-phase result is not truncated; `ptah-system-prompt.constant.ts:224-234` gains one tool row.
- Verified contracts: listing block `protocol-dispatcher.ts:507-526`; session dispatch template
  `:2322-2337`; stdio lists above; budget map `tool-result-budget.ts:83-89` (runtime survey §6).
- Dependencies: `@ptah-extension/lane-routing` (vscode-lm-tools → lane-routing, allowed:
  feature → feature, extension → extension).
- Failure behaviour: handler catches any throw and returns a tool error with a redacted message;
  no other path raises a tool error.
- Verification seam: `route-tools.spec.ts` (listed always-on, also when `agent` namespace disabled;
  listed in stdio), `route-tool-handlers.spec.ts` (invalid field named, service not called),
  existing `session-tools.spec.ts`-style tool-name registry spec updated.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/{route-tools.ts,route-tool-handlers.ts,route-tools.spec.ts,route-tool-handlers.spec.ts}`,
  `.../namespace-builders/route-namespace.builder.ts` (+ spec); MODIFY `.../mcp-core/protocol-dispatcher.ts`,
  `.../mcp-core/tool-result-budget.ts`, `.../ptah-api-builder.service.ts`, the `PtahAPI` type file
  (namespace map), `.../mcp-stdio/{tool-builders.ts,agent-tool.dispatcher.ts,index.ts}`,
  `ptah-system-prompt.constant.ts`.

### 9. Lane model listing adapter

- Purpose: Req 11.1 provenance-tagged model lists per row.
- Responsibilities: `rpc-handlers/src/lib/services/lane-model-listing.adapter.ts` implements
  `LaneModelListing.list(rows, signal)`: CLI rows from `CliModelListService.listAll()` +
  `listForClassification()` (`reported` when not `isFallback`, else `fallback`); Ptah CLI rows from
  `PtahCliConfigPersistence.loadConfigs()` → `selectedModel` (`configured`) and `tierMappings`
  values (`tier`), plus the provider's model discovery (integration note, Gate 2 revision 1 finding 2,
  replaces "omitted"):
  - Source: the same call `provider:listModels` makes. `ProviderModelsService.fetchModels(providerId,
    apiKey, false)` (`libs/backend/auth-providers/src/lib/provider-models.service.ts:279-287`, returns
    `{ models: ProviderModelInfo[]; totalCount; isStatic }`), injected with
    `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)`, and the key from
    `IAuthSecretsService.getProviderKey(providerId)` (`@inject(TOKENS.AUTH_SECRETS_SERVICE)`). Both
    injections already exist in this lib (`handlers/provider-rpc.handlers.ts:133-136`). The adapter
    applies the handler's guard: no key and a purely dynamic provider → skip discovery
    (`provider-rpc.handlers.ts:600-612`). It never calls the RPC method itself.
  - Provenance: discovery ids get `reported` when `isStatic === false` (a live provider answer) and
    `fallback` when `isStatic === true` (Ptah's shipped list for that provider).
  - Merge, in this order, unique by id: `selectedModel` (`configured`), then `tierMappings` values
    (`tier`), then discovery ids not already present. A discovered id that equals a configured or tier
    id keeps the configured or tier provenance, so the user's choice is never relabelled.
  - Timeout isolation: the configured and tier entries are built first, with no I/O. Discovery is
    raced against the row's `signal` (the service's per-row 2000 ms race, part A §6). When the signal
    aborts, or discovery throws or returns nothing, the adapter returns the configured and tier entries
    alone and logs one `debug` (`{ ptahCliId, providerId, reason }`). One slow provider affects only its
    own row, because the service races each row separately. Two Ptah CLI rows on the same provider
    share one in-flight discovery promise per `list` burst (keyed by `providerId`, released when it
    settles), so the provider is asked once.
  Registered in `register-shared-rpc-handlers.ts` next to :55 under `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`.
- Verified contracts: `cli-model-list.service.ts:31-50`; registration `register-shared-rpc-handlers.ts:55`;
  Ptah CLI config fields runtime survey §5.
- Failure behaviour: throws are caught per row by the service's race; the adapter itself returns
  what it has.
- Verification seam: adapter spec with fake `CliModelListService`, config persistence,
  `ProviderModelsService` and `IAuthSecretsService`. Required cases (finding 2): live discovery
  (`isStatic: false`) → discovered ids tagged `reported`, configured id `configured`, tier ids `tier`,
  no duplicate ids; static discovery (`isStatic: true`) → `fallback`; a discovered id equal to
  `selectedModel` stays `configured`; discovery that never resolves with the signal aborted at 2000 ms
  (fake timers) → the row still returns its configured and tier entries, and a CLI row listed in the
  same call returns its full list unaffected; discovery throws → configured and tier only, one debug
  log; no key for a purely dynamic provider → `fetchModels` not called; two rows on one provider →
  `fetchModels` called once.
- Files: CREATE `libs/backend/rpc-handlers/src/lib/services/lane-model-listing.adapter.ts` (+ spec);
  MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`.

### 10. Structured-output adapter

- Purpose: the third decision-model kind (Req 1.2) without a vendor client in `lane-routing`.
- Responsibilities: `agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts` implements
  `StructuredDecisionCompleter.complete({ providerId, model, schema, prompt, signal })` through the
  internal query service with `outputFormat` (`internal-query.types.ts:65`), provider resolved like
  the curator adapter (`sdk-internal-query.curator-llm.ts:214-256`), and `isReady(providerId)` via the
  provider auth resolver. Registered where agent-sdk registers its services (one line per host via
  that existing function).
- Failure behaviour: resolver throws → `auth`; network class → `unreachable`; no structured output
  → `bad-output`.
- Verification seam: adapter spec with a fake internal query service.
- Files: CREATE `libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts` (+ spec);
  MODIFY the agent-sdk DI registration file (implementer locates `registerSdkServices` or equivalent).

### 11. Decision model settings row (UI + config RPC)

- Purpose: Req 1 acceptance 1-8 in Settings → Agent Orchestration → Background Model Roles.
- Responsibilities: extend `AgentOrchestrationConfig` (`rpc/rpc-agents.types.ts:105`) with
  `decisionModel: DecisionModelStatusDto` and `AgentSetConfigParams` (`:227`) with
  `decisionModel?: DecisionModelSelectionDto` and write-only `decisionModelJevApiKey?: string`.
  `agent:getConfig` / `agent:setConfig` (existing methods, `rpc.types.ts:1274-1281`) delegate these
  fields to `DECISION_MODEL_CONFIG`; no new RPC method, so `host-source-registry.baseline.ts`
  (which needs a Gate 2 exception to change, its header :1-5), the allowlist and `rpc-surface.spec.ts`
  stay untouched. Frontend: a seventh row in `provider-consumer-rows.ts` (`BackgroundConsumerId`
  gains `'decision'`), a kind picker (Unset | Ollama decision model | TypeSafe Jev | Structured-output
  model), a free-text/suggested model field for Ollama (suggestions from the Ollama model list, not
  a fixed list — Req 1.2), the locality sentence (Req 1.4), the "reports no confidence" sentence for
  structured (Req 1.8), the not-ready state with the existing set-up deep link (Req 1.5); the
  summary list text at `orchestration-settings.component.ts:150-152` gains "decision" and
  `roleCount` becomes 7.
- Verified contracts: as cited; set-up deep link precedent `openProviderSetup` at
  `orchestration-settings.component.ts:164`.
- Failure behaviour: status probe failure shows "not reachable" and never blocks saving; a save
  error uses `SettingsSaveFeedbackService` like the other rows.
- Verification seam: `provider-consumer-rows` spec (seven rows; existing six unchanged — Req 1.7),
  component spec for kind switch and disclosure text; backend spec for `agent:setConfig` storing the
  key in secret storage and never echoing it.
- Files: MODIFY `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  (delegate only), `libs/frontend/chat/src/lib/settings/providers/{provider-consumer-rows.ts,provider-consumer-assignments.component.ts}`
  (+ specs), `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` (+ spec),
  `libs/frontend/core/src/lib/services/providers-settings.types.ts` if the patch type needs the new
  field; CREATE `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts` (+ spec)
  so the assignments component does not grow a second responsibility.

### 12. Host wiring and guard specs

- Purpose: make the service resolvable in every host.
- Responsibilities: call `registerLaneRoutingServices(container)` in
  `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` (beside :216), `apps/ptah-electron/src/di/phase-2-libraries.ts`
  (beside :305) and `libs/backend/cli-engine/src/lib/container.ts` (beside :736), before
  `registerVsCodeLmToolsServices`; add the lib-owned tokens to
  `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`; run `container.smoke.spec.ts` and
  `surface-composition.spec.ts` (Electron) unchanged in shape. `rpc-surface.spec.ts` needs no change
  (no new RPC method). Port tokens (`LANE_MODEL_LISTING`, `STRUCTURED_DECISION`, `LANE_OUTCOME_READER`)
  are listed as optional, not as expected-resolvable, because a host may lack them.
- Verified contracts: call sites runtime survey §2 (vscode :216, electron :305, cli :736), §7.
- Failure behaviour: a host that skips registration gets F9 (routing unavailable), not a crash.
- Verification seam: `npx nx test ptah-extension-vscode --parallel=1` limited to the container
  smoke spec via Jest path (`npx jest -c apps/ptah-extension-vscode/jest.config.ts src/di --maxWorkers=2 --coverage=false`);
  Electron `surface-composition.spec.ts` likewise.
- Files: MODIFY the three composition roots, `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`,
  `apps/ptah-electron/src/di/` surface spec fixture if it enumerates tokens; `apps/ptah-electron/package.json`
  or the validate-deps allowlist only if the pre-push `validate-deps` gate flags the new lib.

### 13. Orchestration skill integration

- Purpose: Req 8 and Req 6.9.
- Responsibilities: in the shipped plugin skills (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md`,
  `.../references/lane-assignment.md`, `.../agent-lanes/SKILL.md`): when `ptah_route_decide` is listed,
  call it once at Pre-flight and once at Gate 0.1; show the phase → executor → model → reason table
  with source and confidence ("—" for null) and the overall line; user override in the turn wins and
  is logged; log every result as a `decisions.md` row (stage, source, confidence, reasons, cause,
  low-confidence proposal); keep `SKILL.md:14-41` and `lane-assignment.md` rule tables for null
  Pre-flight answers and for hosts without the tool; remove any table mapping named vendors to task
  kinds. Report subagent deliverables and review verdicts per Req 8.7 using pass B's tool/contract
  (resolved by implementation-plan.md R3):
  - Lane spawns pass `taskKind` and `routingSource` from the Gate 0.1 row.
  - After each subagent run, read the `agentId` from that run's Agent tool result (integration note, Gate 2
    revision 1 finding 4; integrated SC-7 target rules) and call `ptah_outcome_report` with
    `kind:'deliverables'` and `target:{agentId:<that id>}`, plus paths, `taskKind`, `taskId` and
    `routingSource`. Keep the returned `runId` with that run in the skill's own notes. Do this for every run,
    including a second run of the same agent and runs that ran at the same time; never use the slug when the
    `agentId` is known.
  - Only when the tool result shows no `agentId`, use `target:{subagent:<slug>}`. If the tool answers
    "ambiguous", do not guess: record the run as unreported in the task notes and continue.
  - After each review verdict, call `ptah_outcome_report` with `kind:'review'` and `target:{runId}` (the
    `runId` kept for the reviewed run), or `{agentId}` for a lane run.
  - When the tool is not listed, skip silently.
- Assumption A5: the plugin asset copy is the source the harness syncs to `.claude/`, `.agents/`,
  `.github/`. Check: grep the harness sync for `assets/plugins/ptah-core/skills`.
- Verification seam: a grep check (Req 6.9) recorded in the batch report; skill text review in the
  Gate 2 reviewer pass. No code test.
- Files: MODIFY the three skill files above (and their synced copies only if A5 is false).

## Contracts (TS types and Zod schemas)

These are the boundary contracts; they are new, so they cite the requirement they implement rather
than a source line. Types are `z.infer` of the schemas (one source of truth), exported from
`@ptah-extension/lane-routing`. Field names are binding; internal helper types are the implementer's.

### Tool arguments — `LR/contracts/route-decide-args.schema.ts` (Req 2.2, 2.3, 2.5, 8.2)

```ts
export const PHASE_KINDS = ['plan', 'architecture', 'implement', 'review', 'document-review',
  'research', 'tests', 'docs', 'visual-review', 'design'] as const;
export const DEPTHS = ['Full', 'Partial', 'Minimal'] as const;
// TASK_TYPES: import the task contract's existing list; do not restate it (implementer: grep
// 'SAAS_INIT' in libs/shared/src to find the exported const; if none exists, define it here once).

const PhaseSchema = z.object({
  id: z.string().min(1).max(64),             // caller's phase id, unique per call
  kind: z.enum(PHASE_KINDS),
  role: z.string().min(1).max(64).optional(), // subagent role; default per kind (table below)
  reviews: z.array(z.string()).max(64).optional(), // implement phase ids a review covers
}).strict();

const PinSchema = z.object({
  phaseId: z.string().min(1),
  executor: z.string().min(1),               // cli value, ptahCliId, or 'subagent:<role>'
  model: z.string().min(1).optional(),
}).strict();

export const RouteDecideArgsSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('pre-flight'), request: z.string().min(1).max(8000) }).strict(),
  z.object({
    stage: z.literal('gate-0.1'),
    request: z.string().min(1).max(8000),
    taskType: z.enum(TASK_TYPES),
    depth: z.enum(DEPTHS),
    phases: z.array(PhaseSchema).min(1).max(100),
    pins: z.array(PinSchema).max(100).optional(),
    preferenceSource: z.string().max(200).optional(), // echoed into reasons
    preferences: z.object({ prefer: z.array(z.string()).max(32) }).strict().optional(),
  }).strict(),
]);
```

Refinements: phase ids unique; every `pins[].phaseId` and `reviews[]` id names a phase; violations
are field-named Zod issues (Req 2.5). Matrix task kind per phase kind: plan, architecture → `plan`;
implement → `implement`; review, document-review → `review`; research → `research`; tests →
`tests`; docs, design → `docs`; visual-review → `review`. Default subagent role per kind:
plan → project-manager, architecture → software-architect, implement → backend-developer,
review → code-logic-reviewer, document-review → code-logic-reviewer, research → researcher-expert,
tests → senior-tester, docs → technical-content-writer, visual-review → visual-reviewer,
design → ui-ux-designer; a subagent candidate exists only when its role is in `agent.listRoles()`
or is one of these built-in names (Assumption A4).

### Result — `LR/contracts/route-decide-result.schema.ts` (Req 2.2, 2.3, 3.5, 12.7, 13.5)

```ts
export const FALLBACK_CAUSES = ['timeout', 'unreachable', 'auth', 'provider-error', 'bad-output',
  'low-confidence', 'payload-too-large', 'question-limit'] as const;
export const EXCLUSION_RULES = ['at-limit', 'disabled', 'not-installed', 'never-on-a-lane',
  'reviewer-family', 'pruned', 'not-listed'] as const;
export const PROVENANCE = ['reported', 'fallback', 'configured', 'tier', 'lane-default'] as const;

const Confidence = z.number().min(0).max(1).nullable();
const Cause = z.enum(FALLBACK_CAUSES).nullable();
const Excluded = z.object({ phaseId: z.string(), candidate: z.string(),
  rule: z.enum(EXCLUSION_RULES) }).strict();

const ChosenEntry = z.object({
  phaseId: z.string(), status: z.literal('chosen'),
  executor: z.object({ kind: z.enum(['lane', 'subagent']), id: z.string(),
    cli: z.string().optional(), ptahCliId: z.string().optional(), role: z.string().optional(),
    family: z.string() }).strict()
    .refine((e) => e.id !== 'unavailable'),
  model: z.string(), provenance: z.enum(PROVENANCE),
  score: z.number().int().min(0).max(100),
  source: z.enum(['model', 'ranking', 'pin']),
  taskKind: z.enum(OUTCOME_TASK_KINDS),   // integration SC-6: from the phase-kind table; copied into the spawn
  confidence: Confidence, fallbackCause: Cause,
  modelProposal: z.object({ option: z.string(), confidence: Confidence }).strict().nullable(),
  reason: z.string(),
}).strict();

const UnavailableEntry = z.object({
  phaseId: z.string(), status: z.literal('unavailable'), executor: z.literal('unavailable'),
  exclusionReason: z.enum(['no-eligible-candidate', 'reviewer-family', 'pin-unavailable']),
  excludedBy: z.array(z.object({ candidate: z.string(),
    rule: z.enum(EXCLUSION_RULES) }).strict()),
  pinRule: z.enum(EXCLUSION_RULES).nullable(),   // set only for pin-unavailable
  needsDisclosedFallback: z.boolean(),            // true for reviewer-family
  source: z.enum(['pin', 'ranking']),
  model: z.null(), provenance: z.null(), score: z.null(), confidence: z.null(),
  fallbackCause: z.null(), reason: z.string(),
}).strict();

const Usage = z.object({ requests: z.number().int().min(0).max(2),
  inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable() }).strict();

const Answer = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v.nullable(),
  source: z.enum(['model', 'skill-table']), confidence: Confidence, fallbackCause: Cause,
  modelProposal: z.object({ option: z.string(), confidence: Confidence }).strict().nullable() }).strict();

export const PreflightResultSchema = z.object({ stage: z.literal('pre-flight'),
  taskType: Answer(z.enum(TASK_TYPES)), depth: Answer(z.enum(DEPTHS)),
  overallConfidence: Confidence, reasons: z.array(z.string()), usage: Usage }).strict();

export const GateResultSchema = z.object({ stage: z.literal('gate-0.1'),
  roster: z.array(z.discriminatedUnion('status', [ChosenEntry, UnavailableEntry])),
  overallSource: z.enum(['model', 'ranking', 'mixed']), overallConfidence: Confidence,
  excluded: z.array(Excluded), reasons: z.array(z.string()), usage: Usage }).strict();
```

There is deliberately no batch-size field anywhere (Req 3.5). A superRefine on `GateResultSchema`
asserts one roster entry per requested phase id (checked against the args in the service spec).
`overallSource` counts only `chosen` entries; unavailable entries never enter `overallConfidence`
(Req 2.7).

### Ports — `LR/*.port.ts`

```ts
export interface RouteCandidateSource {           // implemented per call in vscode-lm-tools
  rows(): Promise<readonly CliDetectionResult[]>; // ptahAPI.agent.list()
  limits(rows: readonly CliDetectionResult[]): Promise<ReadonlyMap<string, LaneLimitState> | null>;
  roles(): Promise<readonly string[]>;            // ptahAPI.agent.listRoles(); [] on failure
}
export interface LaneModelEntry { readonly id: string; readonly provenance:
  'reported' | 'fallback' | 'configured' | 'tier'; readonly auto?: boolean }
export interface LaneModelListing {               // LANE_ROUTING_TOKENS.LANE_MODEL_LISTING
  list(row: CliDetectionResult, signal: AbortSignal): Promise<readonly LaneModelEntry[]>;
}
export interface StructuredDecisionCompleter {   // LANE_ROUTING_TOKENS.STRUCTURED_DECISION
  isReady(providerId: string): Promise<boolean>;
  complete(req: { providerId: string; model: string; prompt: string;
    jsonSchema: Record<string, unknown>; signal: AbortSignal }): Promise<unknown>;
}
```

Limit map key = candidate id (`cli` or `ptahCliId`), value from `LaneLimitResult.state`
(`lane-limit-lookup.service.ts:86-91`, runtime survey §3). A `null` map means "limits unavailable":
every lane is `unknown` and `reasons` says so (Req 4.5).

### Decision-model setting — `LR/decision-model/decision-model.types.ts` (Req 1)

```ts
export const DecisionModelSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unset') }).strict(),
  z.object({ kind: z.literal('ollama'), model: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('jev'), model: z.string().min(1).max(64).default('jev-1.13.0') }).strict(),
  z.object({ kind: z.literal('structured'), providerId: z.string().min(1),
    model: z.string().min(1) }).strict(),
]);
export interface DecisionModelStatusDto {
  readonly selection: DecisionModelSelection;
  readonly locality: 'local' | 'remote' | null;     // null when unset
  readonly reportsConfidence: boolean;              // false for 'structured'
  readonly state: 'unset' | 'ready' | 'no-credential' | 'unreachable' | 'unsupported-endpoint';
  readonly detail: string | null;                   // e.g. "Ollama 0.34.2 < 0.35.0"
}
```

Stored at config section `agentOrchestration`, key `decisionModel` (global). The Jev key is
`AgentSetConfigParams.decisionModelJevApiKey` on write only; it goes to `ISecretStorage` and never
appears in `AgentOrchestrationConfig`. `DecisionModelSelection`/`DecisionModelStatusDto` are mirrored
as plain types in `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` (the frontend cannot import a
backend lib); the backend schema is the validator.

### System One wire shape — `LR/decision-model/system-one.schema.ts`

Request: `{ model, state, questions: Record<string, { type: 'choice'; instructions: string;
criteria: Record<string, string> }> }`. Response: `{ model, answers: Record<string, { type:
'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number }>, usage?:
{ input_tokens?: number; output_tokens?: number } }` validated with `.passthrough()` on the outer
object and strict on what is read (`research-decision-models.md:280-345`). Option keys are short
labels `o1..oP` mapped back by code, so a model can only name an offered option; any other key →
`bad-output` (Req 2.6, 11.4).

## Data flow for one `ptah_route_decide` call

`gate-0.1`, decision model set (the unset path stops after step 7):

1. Transport: HTTP `case ROUTE_DECIDE_TOOL_NAME` or stdio `case 'route_decide'` → `handleRouteToolCall`.
2. Boundary validation: `RouteDecideArgsSchema.safeParse(args)`; failure → tool error naming the
   field; no further step runs (Req 2.5).
3. `ptahAPI.route.decide(args)` resolves `ROUTE_DECIDE_SERVICE` lazily and builds the
   `RouteCandidateSource` from `agent.list` / `agent.limits` / `agent.listRoles`.
4. Gather (all parallel, one deadline of 2000 ms for model lists): rows (each with `family` via
   `laneFamilyOf`), limit states, roles, model list per eligible row (each row raced alone; late or
   failed → `lane-default`, reason "models unknown"), matrix (seed + user file + local cells from
   `LaneOutcomeReader.recentOutcomes(..., { sinceMs: now - 90 d })`), rotation state, decision-model
   selection. Missing inputs are recorded for `reasons` (Req 4.5).
5. Candidates per phase: lane rows (id = `cli` or `ptahCliId`) plus one subagent candidate
   (`subagent:<role>`, family `claude`, model tier from the phase kind: plan/architecture/review →
   `opus`, others → `sonnet`, provenance `tier`).
6. Constrain, in this order (Req 12.1): pins (accept, or `pin-unavailable` with rule, never
   substituted) → at-limit / disabled / not-installed → never-on-a-lane. Review phases are deferred
   to step 9.
7. Score and spread per non-review phase → ranking. No decision model: the top of each ranking is
   the entry (source `ranking`); go to step 9 for reviews, then step 11.
8. Request 1: phases with ≥ 2 eligible candidates, in caller order, until Q (32) questions; the rest
   take the ranking top with cause `question-limit`. Each question offers the top P with the
   rotation pick first, labels `o1..oP`; payload size check (shrink to ≥ 2 options, else
   `payload-too-large`). Send with 3000 ms abort. Validate: offered label, known phase, probability
   threshold (`< 0.5` → `low-confidence`, proposal kept); failures map to causes.
9. Review phases: exclude candidates whose family equals the family of any implement phase's final
   executor (or the `reviews` ones), whatever its source (Req 12.4); a review phase with no eligible
   candidate becomes unavailable `reviewer-family` with `needsDisclosedFallback: true`. With a model,
   eligible review phases form request 2 (same rules as step 8), so a same-family option is never
   offered.
10. Merge answers: model answer → source `model`, confidence from provider (null for structured);
    fallback → ranking top with source `ranking` and the cause.
11. Compile reasons and confidences (component 7); compute `overallSource`, `overallConfidence`,
    `usage`; validate the result with `GateResultSchema` (a failure here is a programmer error → tool
    error, and a spec guards it).
12. Persist rotation: for each chosen lane entry, K → chosen candidate id. Return JSON text.

`pre-flight`: steps 1-3; unset → task type and depth `null`, source `skill-table`, zero requests;
set → one request with two choice questions (`task_type`, `depth`); each answer validated and
thresholded independently; return.

## Failure behaviour

| # | Condition | Behaviour | Tool error? |
| --- | --- | --- | --- |
| F1 | Invalid or missing args | Tool error naming the field; no model call | yes |
| F2 | Decision model unset | No request; ranking (gate) / `skill-table` nulls (pre-flight) | no |
| F3 | Request exceeds 3000 ms | Abort; every answer it covered → stage fallback, cause `timeout`; return ≤ 3250 ms after send | no |
| F4 | Connection refused / DNS / TLS | cause `unreachable` | no |
| F5 | HTTP 401/403, missing Jev key, structured resolver auth throw | cause `auth` | no |
| F6 | Other non-2xx or provider exception | cause `provider-error` | no |
| F7 | Response fails schema, names an un-offered option, or an unknown question key | discard the affected answers, cause `bad-output` | no |
| F8 | Body over 64 KiB after shrinking to 2 options | not sent, cause `payload-too-large` | no |
| F9 | `ROUTE_DECIDE_SERVICE` not registered in the host | Tool error "routing is not available in this host; use the skill's rule tables" (the skill treats it as "not listed", Req 8.1) | yes |
| F10 | Rows cannot be listed at all (`agent.list` throws) | Lane candidates empty; subagent candidates still offered; `reasons` names `agent-list-unavailable` | no |
| F11 | Limits, roles, model lists, matrix file, outcome reader, rotation store unavailable | Neutral/unknown values, `lane-default`, seed matrix; each named in `reasons` (Req 4.5) | no |
| F12 | Request 1 fails | Implementer choices are the ranking's; request 2 still filters by their family (Req 12.4) | no |
| F13 | Unexpected throw inside the service | Handler catches, returns a redacted tool error and logs; rotation is not persisted | yes |

No retries anywhere (Req 12.5). The fallback never raises a tool error (Req 4.6). Secrets never
appear in logs or reasons.

## Assumed contract from pass B

> Integration note (implementation-plan.md R1, SC-1 to SC-3): superseded. The port is the shared
> `LaneOutcomeReader { recentOutcomes, isPersistent }`, and its summary is part B's field set: `endedAt`,
> `verdict`, `finalReview`, `laneId 'subagent'`, `model 'lane-default'` and a non-null `family`. Do not create
> `lane-outcome-reader.port.ts`. `LANE_ROUTING_TOKENS.LANE_OUTCOME_READER` stays and is aliased to
> `LANE_OUTCOME_TOKENS.READER` in the roots. The text below is kept for history only.

Pass A depends only on this read port; the integration pass reconciles it with pass B's store.
Token `LANE_ROUTING_TOKENS.LANE_OUTCOME_READER` is declared in `lane-routing` (consumer-owned port);
pass B registers its implementation under it. If pass B prefers to own the token, only the import
path in `capability-matrix.store.ts` changes.

```ts
export interface LaneOutcomeReader {
  recentOutcomes(laneId: string, window: { sinceMs: number }): Promise<readonly LaneOutcomeSummary[]>;
}

/** One finished run, already joined to its review verdict. Read-only to routing. */
export interface LaneOutcomeSummary {
  readonly runId: string;
  readonly laneId: string;            // cli value, ptahCliId, or 'subagent:<role>'
  readonly family: string;            // laneFamilyOf(row) at spawn time (component 1)
  readonly model: string | null;      // model the run used; null = lane default / unknown
  readonly taskKind: 'plan' | 'implement' | 'review' | 'research' | 'tests' | 'docs' | null;
  readonly completedAt: number;       // epoch ms
  /** Delivery verdict, same vocabulary as LaneCompletionVerdict (agent-process.types.ts:538). */
  readonly deliveryVerdict: 'delivered' | 'no-deliverable' | 'failed' | 'unverified' | 'running';
  /** Final review verdict for this run, when one was reported (Req 8.7). */
  readonly reviewVerdict: 'approved' | 'rejected' | null;
}
```

How routing uses it: for each family + model + task kind cell, count runs in the 90-day window;
delivered rate = delivered ÷ (delivered + no-deliverable + failed); review pass rate = approved ÷
(approved + rejected); derive per the constants table when a denominator reaches 5. Routing needs
`laneId` → but the matrix is keyed by family + model, so the store calls `recentOutcomes` once per
distinct lane id among the call's candidates (bounded by the row count) and groups by
`family`/`model`/`taskKind`. Requests to pass B:

- `taskKind` must be recorded at spawn (from the phase or the spawn's role); a `null` kind is
  ignored by routing.
- The reader must not throw for an unknown lane id (return `[]`), and should answer within 200 ms;
  routing races it inside the 2000 ms gather deadline regardless.
- No outcome figure leaves the machine except aggregated rates in the decision payload (NFR Security).

## Architecture-level quality requirements

- Functional: every acceptance criterion of Req 1, 2, 3, 4, 6, 7, 11, 12, 13 has a named spec in
  components 3-8 and 11; Req 8 is verified by the skill grep (6.9) and the Gate 2 text review.
- Performance: unset path makes zero network requests and finishes in the gather time (≤ 2000 ms
  worst case, typically the cost of today's `ptah_agent_list`); set path ≤ 2 requests × 3250 ms on
  top. No timer, poll or observer outlives a call (every `AbortSignal.timeout` is per request).
- Security: decision payload field set pinned by a spec; Jev key in `ISecretStorage` only and
  write-only over RPC; the settings row discloses off-machine destinations (Req 1.4); request text is
  capped at 8000 chars at the boundary; the System One base URL comes from existing provider config,
  never from tool args.
- Maintainability: `lane-routing` imports neither `vscode` nor `vscode-core` nor electron (lint +
  a grep in the batch report); `protocol-dispatcher.ts` grows by ≤ 15 lines; no file in `lane-routing`
  owns two of: I/O, ranking, wire format; all routing constants in one file.
- Testability: pure ranking/constraint/reason modules take plain data; the service takes a clock,
  a fetch, and ports as constructor parameters so every Req 4/7/12 test runs on fakes with no host.

## Open — architect items resolved here (pass A share)

| Open item (`task-description.md:623-633`) | Resolution |
| --- | --- |
| S, B, T, K, L, near-limit/unknown order | Constants table |
| P, Q | P = min(4, provider limit); Q = 32 |
| Timeout and margin | 3000 ms + 250 ms |
| Confidence threshold | 0.5, strict less-than |
| Neutral score, minimum sample count, staleness age, seed-label mapping | 50; 5; 180 days; 80/65/35 |
| Where the matrix is shown and edited | Data files: `~/.ptah/routing/capability-matrix.json` (user edits) and the Ptah-written `capability-matrix.view.json` (every value with `source`, `asOf`, `stale`); no new UI surface, so no designer or Gate 1.7 |
| Decision-model call path | One raw-fetch System One client (Ollama and Jev) plus a structured-output port implemented in `agent-sdk` |
| How a stored preference changes the ranking | `preferredRank` and caller `preferences.prefer` order the T tie-break only: they set the rotation order inside the band and never lift a lane across the band or past a hard constraint; when they change the pick, the reason says "preference changed the choice" |
| Window W (Req 9.1), outcome store location, subagent join key | Pass B |

## Proposed batches (pass A)

Proposal for the team-leader, who owns the final decomposition. Batches are file-disjoint; "Lane?"
means the batch is bounded enough for a CLI lane. CLAUDE.md applies to every batch: verify only the
changed project, `--parallel=1` / `--maxWorkers=2`, one heavy check at a time across all lanes (so
parallel authoring, serialized verification). Jest form: `npx jest -c <lib>/jest.config.ts <specs>
--coverage=false --maxWorkers=2`.

> Integration note: implementation-plan.md § Batches supersedes this table. The changes:
> - A1 is merged into AB1.
> - A9a now creates only the route modules. Every edit to existing registration files moves to AB9, shared
>   with part B's report tool.
> - A9b is dissolved into A9a and AB9.
> - A14 is merged into AB14.
> - A1b also adds the SC-6 spawn fields.
> - New batch A16 adds the Req 10.3 failure classifier.
> - A15 uses the Req 8.7 call sites of R3.

| Batch | Component | Files (CREATE unless marked M) | Nx project | Scoped verify | Depends on | Lane? |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 1 (shared part) | `libs/shared/src/lib/utils/lane-family.ts`, `lane-family.spec.ts`; M `libs/shared/src/lib/types/agent-process.types.ts`, M shared barrel | shared | jest on `lane-family.spec.ts` + `npx nx typecheck shared` | — | yes, parallel |
| A2 | 2 | `libs/backend/lane-routing/*` scaffold (project.json, jest/ts/eslint configs, README, `src/index.ts`), `LR/di/tokens.ts`, `LR/routing-constants.ts`; M `tsconfig.base.json` (scaffold boilerplate exceeds 6 files; one lib) | lane-routing | `npx nx test lane-routing --parallel=1` (passWithNoTests) + `npx nx lint lane-routing` | — | yes, parallel with A1 |
| A3 | contracts | `LR/contracts/route-decide-args.schema.ts`, `route-decide-result.schema.ts`, `contracts.spec.ts` (Req 2.3 branch rejections, 2.7 fixtures shape), `LR/route-candidate-source.port.ts`, `LR/lane-model-listing.port.ts` (outcome reader type from shared, SC-2; `ChosenEntry.taskKind`, SC-6; task kinds from `OUTCOME_TASK_KINDS`) | lane-routing | `npx nx test lane-routing --parallel=1` | A1, A2 | yes |
| A4 | 3 (data) | `LR/matrix/matrix.types.ts`, `matrix.schema.ts`, `seed-matrix.ts`, `seed-matrix.spec.ts` (Req 6.2, 6.3) | lane-routing | same | A3 | yes, parallel with A5a/A6/A7 |
| A5a | 4 (constraints) | `LR/ranking/candidate.types.ts`, `hard-constraints.ts`, `hard-constraints.spec.ts` (Req 3.2-3.6) | lane-routing | same | A3 | yes, parallel |
| A6a | 5 (wire) | `LR/decision-model/system-one.schema.ts`, `system-one.client.ts`, `system-one.client.spec.ts`, `decision-payload.ts`, `decision-payload.spec.ts` (NFR field set) | lane-routing | same | A3 | yes, parallel |
| A7 | 7 | `LR/reasons/compile-reasons.ts`, `confidence.ts`, `compile-reasons.spec.ts`, `confidence.spec.ts` (Req 13.2-13.5) | lane-routing | same | A3 | yes, parallel |
| A4b | 3 (store) | `LR/matrix/capability-matrix.store.ts`, `local-derivation.ts`, `capability-matrix.store.spec.ts`, `local-derivation.spec.ts` (Req 6.4-6.8) | lane-routing | same | A4 | yes |
| A5b | 4 (spread) | `LR/ranking/score.ts`, `spread.ts`, `rotation.store.ts`, `score.spec.ts`, `spread.spec.ts` (Req 7.1-7.6, B boundaries), `rotation.store.spec.ts` | lane-routing | same | A4, A5a | yes |
| A6b | 5 (settings) | `LR/decision-model/decision-model.types.ts`, `decision-model.config.ts`, `decision-model.config.spec.ts` (Req 1.3, 1.4, 1.5 probe), `structured-decision.port.ts` | lane-routing | same | A3 | yes, parallel with A4b/A5b |
| A8 | 6 | `LR/route-decide.service.ts`, `LR/pipeline/gather.ts`, `model-refine.ts`, `answer-validation.ts`, `route-decide.gate.spec.ts`, `route-decide.preflight.spec.ts` (Req 2.7, 3.1, 3.7, 4.1-4.6, 7.7-7.8, 11.2-11.5, 12.3-12.9); M `LR/di/register.ts` + `register.spec.ts` (CREATE), M `src/index.ts` | lane-routing | same | A4b, A5b, A6a, A6b, A7 | subagent recommended (integration of five modules; long fixture set) |
| A9a | 8 (HTTP) | `mcp-core/route-tools.ts`, `route-tool-handlers.ts`, `route-tools.spec.ts`, `route-tool-handlers.spec.ts`; M `protocol-dispatcher.ts`, M `tool-result-budget.ts` | vscode-lm-tools | jest on the two new specs + `npx nx typecheck vscode-lm-tools` | A8 | yes |
| A9b | 8 (namespace + stdio) | `namespace-builders/route-namespace.builder.ts` (+ spec); M `ptah-api-builder.service.ts`, M PtahAPI type file, M `mcp-stdio/tool-builders.ts`, M `mcp-stdio/agent-tool.dispatcher.ts` (+ `mcp-stdio/index.ts`, `ptah-system-prompt.constant.ts`) | vscode-lm-tools | jest on the namespace spec + existing stdio dispatcher/tool-builder specs | A9a | yes, after A9a |
| A1b | 1 (row field) | M `namespace-builders/agent-namespace.builder.ts`, M `mcp-core/mcp-response-formatter.ts` + its spec | vscode-lm-tools | jest on the formatter and agent-namespace specs | A1 | yes, parallel with A3-A8 (disjoint files; serialize its verify with A9) |
| A10 | 9 | `rpc-handlers/src/lib/services/lane-model-listing.adapter.ts` (+ spec); M `register-shared-rpc-handlers.ts` | rpc-handlers | jest on the adapter spec + `npx nx typecheck rpc-handlers` | A3 | yes, parallel |
| A11 | 11 (backend) | M `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`; M `rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (delegate only) + a focused spec `agent-rpc.handlers.decision-model.spec.ts` | shared, rpc-handlers | jest on the new rpc-handlers spec, then `npx nx typecheck shared`, one at a time | A6b, A10 (same lib file set disjoint, but registration order) | yes |
| A12 | 11 (UI) | `decision-model-row.component.ts` (+ spec); M `provider-consumer-rows.ts` (+ spec), M `provider-consumer-assignments.component.ts`, M `orchestration-settings.component.ts` (+ spec) | chat | jest on the changed specs | A11 | yes (frontend lane); check TASK_2026_658 file overlap first (task-description Risks) |
| A13 | 10 | `agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts` (+ spec); M agent-sdk DI registration | agent-sdk | jest on the adapter spec | A6b | yes, parallel |
| A14 | 12 | M `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, M `apps/ptah-electron/src/di/phase-2-libraries.ts`, M `libs/backend/cli-engine/src/lib/container.ts`, M `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` (+ Electron surface spec fixture if it enumerates tokens) | ptah-extension-vscode, ptah-electron, cli-engine | jest on `container.smoke.spec.ts`, then Electron `surface-composition.spec.ts`, then cli-engine container spec, one at a time | A8, A9b, A10, A13 | subagent recommended (three composition roots; pre-push `validate-deps` may need a follow-up) |
| A15 | 13 | M `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md`, M `.../orchestration/references/lane-assignment.md`, M `.../agent-lanes/SKILL.md` | — (docs) | grep check for vendor-to-task tables (Req 6.9) recorded in the report | A9b (tool name final); Req 8.7 call site after pass B reconciliation | yes |

Critical path: A2 → A3 → (A4, A5a, A6a, A6b, A7 in parallel) → (A4b, A5b) → A8 → A9a → A9b → A14.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | New lib `libs/backend/lane-routing` (`scope:extension`, `type:feature`) owns the engine | in `cli-agent-runtime`; in `vscode-lm-tools/mcp-core`; split across `shared` utils | runtime survey orchestrator note 1 (vscode-core leak); `rpc-handlers` → `vscode-lm-tools` dependency (`wizard-generation-rpc.handlers.ts` import) makes model listing unreachable from mcp-core; tags `eslint.config.mjs:291-292,407-415` | yes (move files, change one path alias) |
| D2 | `ptah_route_decide` is always-on (listed outside the `agent` toggle), HTTP and stdio | inside the `agent` group | Req 2.1 "any host"; precedent `protocol-dispatcher.ts:524-526`; with lanes disabled it still returns a subagent roster | yes |
| D3 | Family = `cli` value, ptah-cli `providerId`, or `claude` for in-process; codified in `shared` `laneFamilyOf` and shown on `ptah_agent_list` rows | vendor lookup table; family per model id | `agent-lanes/SKILL.md:190-191` | yes |
| D4 | Model listing is a consumer-owned port implemented in `rpc-handlers` over `CliModelListService` | call `listModelsForAll` directly (loses codex/copilot live provenance) | `cli-model-list.service.ts:36-50`; registration `register-shared-rpc-handlers.ts:55` | yes |
| D5 | Decision-model settings travel on the existing `agent:getConfig` / `agent:setConfig`; no new RPC method | new `agent:*DecisionModel` methods | `host-source-registry.baseline.ts:1-5` (a baseline change needs a Gate 2 exception in TASK_2026_610); `rpc.types.ts:1274-1281` | yes |
| D6 | Jev key in `ISecretStorage`, write-only over RPC | provider-key registry entry for TypeSafe | NFR Security; a registry entry would put a non-Anthropic-compatible provider into every provider picker | yes |
| D7 | Matrix shown and edited as data files (`capability-matrix.json` user edits, `capability-matrix.view.json` Ptah-written view) | settings UI table (adds designer + Gate 1.7) | `task-description.md:629-630`; Req 6.8 satisfied by the view file | yes (a UI can read the same store later) |
| D8 | Constants as in the constants table (S 0-100, B 5 inclusive, P ≤ 4, Q 32, 3000 + 250 ms, 0.5, 50, 5, 180 d, 80/65/35, 90-day window) | other values | `research-decision-models.md:74-78,96-99,562`; `research-routing-landscape.md:9` | yes (one file) |
| D9 | One question per phase whose options are `(executor, model)` pairs fixed by the ranking; the model never picks a model id separately | executor and model as two questions | keeps every model id inside the row's list (Req 11.4) and the question count equal to the phase count (Req 12.9) | yes |
| D10 | Rotation pick is always option 1 | shuffle; reverse order | Req 7.8 (always-first fake must still rotate); Jev first-option bias `research-decision-models.md:91,566` | yes |
| D11 | Structured-output kind via an `agent-sdk` adapter over the internal query `outputFormat`; its answers carry confidence `null` | Ollama `/api/chat` `format` only | Req 1.2 "any configured provider model"; `internal-query.types.ts:65`; `research-decision-models.md:480-481` | yes |
| D12 | Missing routing service in a host → tool error (F9) so the skill uses its rule tables; every other missing input degrades silently with a reason | return an empty roster | Req 4.5 covers data, not a missing component; Req 8.1 fallback path | yes |

## Clarifications Needed

None. Every open item in pass A's scope is settled from the requirements, user decisions #12-#24
and repository evidence; no choice above is user-reserved (no capability removed beyond the
Gate 1-approved Req 6.9 skill tables, no outward-facing action by default — the decision model is
unset unless the user picks one and the row discloses the destination).

## Remaining (pass A)

- Assumptions A1-A5 are for the implementer to resolve with the stated checks; none blocks
  decomposition.
- Not opened in this pass (cited from the runtime survey only): `agent-namespace.builder.ts:440-497`,
  `cli-detection.service.ts:182-222`, `lane-limit-lookup.service.ts:86-91`, `tool-result-budget.ts:83-89`,
  `agent-spawn-args.schema.ts:35-36`. The batches touching them re-verify those lines first.
- Resolved by the integration pass: `LaneOutcomeSummary` (implementation-plan.md R1, SC-1/SC-2) and the
  Req 8.7 call sites for A15 (R3).
