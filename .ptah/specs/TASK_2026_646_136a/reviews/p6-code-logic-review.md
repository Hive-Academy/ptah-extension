# Code Logic Review — `TASK_2026_646_136a`, phase P6 (MCP + host integration)

Reviewer family: Anthropic (decision #95). Implementers: grok/xAI (Batches 26, 30a), codex/OpenAI (Batches 29, 30).
No check was executed: no Nx, Jest, tsc, build, `ptah_get_diagnostics` or any other heavy check was run (another heavy check is in flight on this machine, CLAUDE.md "one heavy check at a time"). Every claim below comes from reading source and `git show`/`git diff`. Spec files were read only where named; claims about test coverage mean "I found no spec asserting this", not "I ran the specs".

Scope read in full: `mcp-core/route-tools.ts`, `route-tool-handlers.ts`, `namespace-builders/route-namespace.builder.ts`, `mcp-core/tools/outcome-report.tool.ts` (for transport parity only), the Batch 29 dispatcher adapters (`protocol-dispatcher.ts:2790-2870`, listing `:519-560`, eager list `:671`, case arms `:2374-2378`), `mcp-stdio/agent-tool.dispatcher.ts` (route/outcome arms), `stdio-mcp-server.service.ts` (dispatcher construction and `handleToolsCall`), `tool-builders.ts`, `http-mcp-server.service.ts:385-415`, `ptah-api-builder.service.ts` (`route` namespace and `outcomeReportDependencies`), `agent-namespace.builder.ts:222-405`, `lane-outcomes/src/lib/di/{register,start}.ts`, the three host phase-2 roots, and the four shutdown paths (`main.ts:119-238`, `shutdown.ts`, `shutdown-host-runtime.ts`, `with-engine.ts`).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 4              |
| Moderate issues     | 4              |
| Failure modes found | 9              |

Score rationale. 7-8 would need every transport parity and shutdown claim in the brief to hold. They mostly do: both tools validate with the same Zod schemas on HTTP and stdio, F9 degrades cleanly, registration order is right in all three hosts, nothing registers twice, and every disposer failure is caught. It falls to 6 because four defects lose data silently or hand the caller a success-looking result: routing metadata dropped for Ptah CLI lanes, a result cap that is probably too small for the case it was sized for, deliverables stat'ed against the process cwd when no workspace resolves, and shutdown ordering that differs on each host. None is data loss on a common path or a security issue, so none is Blocking. Not 5: the registration, F9, validation and no-crash-on-disposer-failure requirements are met with evidence below.

## Five logic questions

### 1. How does this fail silently?

- Ptah CLI lanes lose `taskKind` and `routingSource`. `agent-namespace.builder.ts:257-355`: the `if (request.ptahCliId)` branch builds the `spawnFromSdkHandle` meta by hand (`:325-352`) and omits both fields, though `spawnFromSdkHandle` accepts them (`agent-process-manager.service.ts:752-753`). The tool schema advertises them (`tool-description.builder.ts:739-745`), both transports parse and forward them (`protocol-dispatcher.ts:1260-1261`, `agent-tool.dispatcher.ts:563-564`), and the call succeeds. The outcome row is then `taskKind: null`, `routingSource: 'not-routed'` (`lane-completion-outcome.ts:39,56`). Only the `request.cli` branch survives, through `...requestFields` (`agent-namespace.builder.ts:393-404`).
- `ptah_outcome_report` with no resolvable workspace root. `ptah-api-builder.service.ts:1216` passes `''`; `outcome-report.tool.ts:101` does `resolve('')`, which is `process.cwd()`. See Serious 3.
- A truncated roster is returned as a success. See Serious 2.
- Electron: ops enqueued after the lane-outcomes disposer ran are dropped without a log (`outcome-write-pipeline.ts:215`, `if (this.closing || this.disposed) return;`). See Serious 4.
- `http-mcp-server.service.ts:406` and `stdio-mcp-server.service.ts:472` guard with `typeof this.apiBuilder.outcomeReportDependencies === 'function'`. If the builder ever lacks the method, the tool answers `{ recorded: false, reason: 'outcome store unavailable' }` forever instead of failing loudly. With the real class it is dead defensiveness, but it hides a wiring regression.

### 2. What user action produces unexpected behaviour?

- Turning off the `agent` MCP namespace leaves `ptah_route_decide` listed (by design, `protocol-dispatcher.ts:549`, outside the `disabled.has('agent')` guard). Its answer is built from `agent.list/limits/listRoles` (`route-namespace.builder.ts:79-99`), which still work, but the system-prompt row is added in the "agent orchestration tools" section (`ptah-system-prompt.constant.ts`), so a user who disabled that group gets a listed tool with no prose. Minor.
- A model that calls `ptah_outcome_report` with a bad `taskKind` sees the schema type `string` with no enum (`outcome-report.tool.ts:53-57`) and learns the valid values only from the Zod error. `ptah_route_decide` generates its schema from Zod, so this is inconsistent.
- Quitting Electron while lanes are running: the lane-outcomes disposer runs before the agents are reaped. See Serious 4.

### 3. What input data produces a wrong answer rather than an error?

- `paths: ['']` is blocked by Zod (`min(1)`), but `paths: ['.']` resolves to the workspace root itself, which exists, so it is recorded as an existing deliverable (`outcome-report.tool.ts:103-118`). Moderate/Minor, P5 scope.
- A gate request with 70 to 100 phases. See Serious 2.
- Workspace-less outcome call. See Serious 3.
- A caller-declared root: `resolveSessionWorkspaceRoot` tier 1 is the root the MCP caller put in its URL (`workspace-root-resolver.ts`). `outcomeReportDependencies` therefore stats files under a caller-chosen directory and returns existence and size through the recorded outcome. Minor existence oracle on a localhost, authenticated server.

### 4. What happens when a dependency fails?

- Routing not registered (F9): handled. `resolveRouteDecideService` uses `isRegistered(token, true)` (`route-namespace.builder.ts:65`), a missing container also returns `undefined`, and `buildRouteNamespace.decide` throws `RoutingUnavailableError` before any agent I/O (`:105-109`). `routeFailureText` returns the sentence verbatim (`route-tool-handlers.ts:73`). No crash, no `ptah_route_decide failed:` prefix.
- The `agent` namespace failing to build: `ptah.route` is built through `buildNamespaceSafe` and throws "requires ptah.agent" (`ptah-api-builder.service.ts:784-794`). The Proxy's `decide()` throws synchronously, but `handleRouteToolCall` calls it inside its `try` (`route-tool-handlers.ts:99-101`), so it becomes a redacted tool error. OK.
- Routing registered but a hard dependency is missing (for example `STATE_STORAGE` for the rotation store): the factory throws at first call, which becomes `ptah_route_decide failed: ...`, not the F9 sentence. The skill treats only F9 as "not listed". Minor.
- The outcome store factory throwing: on HTTP caught (`protocol-dispatcher.ts:2814-2819`), on stdio uncaught. See Moderate 2.
- Disposer failure: caught on all three hosts. See the data-flow table.

### 5. What is missing that the requirements never mentioned?

- A parity test that feeds one 70-phase gate through the whole HTTP and stdio path and asserts the serialised size is under the cap (the only 70-phase spec, `route-decide.gate.spec.ts:567-578`, asserts roster length only).
- A cross-host ordering test for "lane-outcomes disposer vs agent reap vs SQLite close". The smoke specs guard registration order, not shutdown order.
- One owner for the disposer token. The literal `Symbol.for('PtahLaneOutcomesDisposer')` appears in four places (`main.ts:202`, `shutdown.ts:8`, `phase-2-libraries.ts` x2, `shutdown-host-runtime.ts`, plus the exported constant in `lane-outcomes-wiring.ts:10` that nothing imports). A rename in one place makes `isRegistered` false and the flush is skipped with no log.
- Error-code parity: see Moderate 1.

## Failure modes

### Ptah CLI lane loses routing metadata

- Trigger: `ptah_agent_spawn` / `agent_spawn` with `ptahCliId` plus `taskKind` and/or `routingSource`.
- Symptom: spawn succeeds; the outcome row says `not-routed`, `taskKind: null`; routed Ptah CLI lanes never feed the capability matrix.
- Evidence: `agent-namespace.builder.ts:325-352` (meta has `task, cli, workingDirectory, taskFolder, deliverables, parentSessionId, ptahCliName, ptahCliId, timeout, resumeSessionId, agentId` only); accepted by `agent-process-manager.service.ts:752-753`.
- Current handling: none; the non-Ptah-CLI branch forwards them.
- Recommendation: add `taskKind: request.taskKind, routingSource: request.routingSource` to that meta object, plus a spec on the `ptahCliId` branch.

### Over-cap route result becomes malformed JSON reported as success

- Trigger: a `gate-0.1` call with many phases. The schema allows 100 (`route-decide-args.schema.ts`, `phases ... .max(100)`); the budget is 24,000 chars (`tool-result-budget.ts:90`), sized for 70.
- Symptom: `createToolSuccessResponse` cuts the text to a prefix, spools the rest and appends a trailer. The skill receives unparseable JSON with `isError: false`. The rotation state was already advanced by the call, so a retry advances it again.
- Evidence: a chosen entry is about 270 chars of fixed keys plus a `reason` of 8+ semicolon-joined clauses (`compile-reasons.ts:360-367`), so roughly 400-550 chars per entry; 70 entries is about 28-38k before `result.reasons`. This is an estimate: I did not run it.
- Current handling: `TOOL_CONTENT_HINTS` marks it `preformatted` (prefix cut), nothing validates size.
- Recommendation: measure the real 70-phase and 100-phase serialisations, set the budget from the measurement, and either lower the schema `max` or compact `reason`. Fail with a tool error naming the limit rather than truncating.

### Deliverables checked against the process cwd

- Trigger: `ptah_outcome_report` with `kind: 'deliverables'` when `resolveSessionWorkspaceRoot()` is `undefined` (no caller root, no session, no open folder).
- Symptom: paths resolve under `process.cwd()` (the app install dir in Electron), nothing exists, the report records `exists: false` for every path, and the lane gets a negative deliverables fact.
- Evidence: `ptah-api-builder.service.ts:1216` (`?? ''`), `outcome-report.tool.ts:101`; the doc comment on `outcomeReportDependencies` says "never `$HOME`" but `''` is not guarded.
- Current handling: none.
- Recommendation: when `workspaceRoot` is empty, return `{ recorded: false, reason: 'workspace unavailable' }` before any stat.

### Shutdown ordering differs on each host

- Trigger: quitting or deactivating with running or just-finished lanes.
- Symptom: VS Code flushes after the reap and the metadata flush (`main.ts:175-211`): reap-produced writes are included. Electron disposes before `SQLite close` and before `reapAgents` (`shutdown.ts:258-270, 289`): anything the reap emits hits a pipeline that is already `disposed` and is dropped silently (`outcome-write-pipeline.ts:215`). CLI runs `disposeThoth` (closes SQLite, `thoth-runtime.ts:221`, called at `with-engine.ts:434`) before `shutdownHostRuntime` (`with-engine.ts:451`), so the disposer flushes against a closed database: `drain` returns at the `isOpen()` check and the ops stay in the KV journal for the next start.
- Evidence: lines above; `OutcomeWritePipeline.dispose` `pipeline.ts:711-736`.
- Current handling: the journal covers CLI; Electron's late writes are lost; whether a lane killed at host shutdown should be recorded at all is not specified in the plan.
- Recommendation: pick one rule (flush after agent reap and before the SQLite close, as the plan's "shutdown path" intends), apply it to all three hosts, and add one ordering spec per host. If shutdown-killed lanes must not be recorded, make that explicit rather than an accident of ordering.

### Stdio outcome-report dependency resolution can escape as JSON-RPC error

- Trigger: `container.resolve(LANE_OUTCOME_TOKENS.STORE)` throws (for example `STATE_STORAGE` missing when the KV store is chosen).
- Symptom: HTTP returns a tool error (`protocol-dispatcher.ts:2814-2819`, the resolve is inside the `try`); stdio rejects out of `dispatch` (`agent-tool.dispatcher.ts:401` is outside the `try` at `:403`), so `handleToolsCall` (`stdio-mcp-server.service.ts:268`) propagates and the JSON-RPC layer collapses it to `-32603`.
- Recommendation: move `this.resolveOutcomeReport?.()` inside the `try`.

### Invalid route arguments carry the wrong stdio error code

- Trigger: `route_decide` with invalid arguments on stdio.
- Symptom: `structuredContent.ptah_code = 'mcp_tool_failed'` (`agent-tool.dispatcher.ts:391`). Every other stdio tool and `outcome_report` use `mcp_invalid_tool_args` for bad arguments (`:415`, `:503`, `:644`...). Hosts that route on `ptah_code` cannot tell bad arguments from "routing unavailable". HTTP sets no code on either transport arm, which matches the other HTTP tools.
- Recommendation: have `handleRouteToolCall` return a `kind: 'invalid-args' | 'unavailable' | 'failed'` and map it in the stdio arm.

### Partial `startLaneOutcomes` failure leaks subscriptions and leaves no disposer

- Trigger: `startLaneOutcomes` throws after its first `registry.register(...)` (for example the second registry resolve).
- Symptom: hosts log "Lane outcomes start failed (non-fatal)" and register no disposer; the first subscription stays attached, and the pipeline (still registered, still serving `ptah_outcome_report`) is never flushed at shutdown.
- Evidence: `start.ts:27-48` (unsubscribes only inside the returned closure); host catches at `phase-2-libraries.ts` (VS Code, Electron) and `lane-outcomes-wiring.ts:30-37`.
- Recommendation: collect `unsubs` and release them in a `catch` inside `startLaneOutcomes`; register a flush-only disposer when the pipeline exists.

### Electron disposer budget equals the pipeline's inner deadline

- Trigger: slow journal or store at quit.
- Symptom: `withBudget(..., 2000, ...)` (`shutdown.ts:262-269`) and `DISPOSE_DEADLINE_MS = 2000` (`outcome-write-pipeline.ts:99`) expire together, then `dispose` still awaits `journal.update` after its race (`:726-731`), unbounded, while `SQLite close` proceeds. The VS Code path has no outer budget at all (`main.ts:204-211`).
- Recommendation: outer budget strictly larger than the inner deadline, a named constant like the neighbouring budgets, and the same bound in VS Code.

### Disposer token drift is silent

- See question 5. `isRegistered(...) === false` skips the flush with no log on all three hosts.

### Route and outcome errors are redacted differently

- `route-tool-handlers.ts:36-68` redacts and caps at 500 chars; `outcomeReportErrorText` on both transports returns `error.message.trim()` raw and uncapped (`protocol-dispatcher.ts:2841`, `agent-tool.dispatcher.ts:222`). Today the thrown messages are fixed strings ("deliverable path escapes workspace") or Zod text, so no leak is demonstrable. Not a finding yet, but the first thrown filesystem error would put an absolute path in a tool result.

## Blocking issues

None found. Basis: no data corruption, no security bypass, and no misleading success on a common path was demonstrated. Residual uncertainty: Serious 2 could be Blocking-adjacent if the real 70-phase size is far over the cap; I could not measure it.

## Serious issues

### Serious 1 — Ptah CLI lanes drop `taskKind` and `routingSource`

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:325-352`
- Scenario: the orchestrator follows the skill: `ptah_route_decide` picks a Ptah CLI lane, then `ptah_agent_spawn { ptahCliId, taskKind, routingSource }`.
- Impact: Batch 29's stated outcome ("spawn requests now carry taskKind and routingSource on both transports") holds only for system-CLI lanes. For Ptah CLI lanes, the outcome row records `not-routed` / `taskKind null`, so the learning loop never sees routed Ptah CLI runs. No error is shown.
- Fix: pass both fields in the `spawnFromSdkHandle` meta; add a spec for the `ptahCliId` branch.

### Serious 2 — Route result cap unverified for the case it was sized for

- File: `mcp-core/tool-result-budget.ts:90`; schema `lane-routing/.../route-decide-args.schema.ts` (`phases.max(100)`); `mcp-core/route-tool-handlers.ts:101`
- Scenario: gate-0.1 with a large phase list.
- Impact: truncated JSON returned with `isError: false`; rotation already advanced. The plan's own failure table (F1-F13) has no row for "result too large".
- Fix: measure, set the budget from the measurement, and return a tool error when the serialised result exceeds the cap (or lower `phases.max`). Add a spec that serialises a real 70-phase and 100-phase result.

### Serious 3 — Deliverables resolved against `process.cwd()` when no workspace resolves

- File: `ptah-api-builder.service.ts:1216`, `mcp-core/tools/outcome-report.tool.ts:101`
- Scenario: Electron with no folder open, or a stdio host whose provider returns no root, receives an outcome report for deliverables.
- Impact: a false "missing deliverable" fact is stored for the lane. Silent, and it feeds the ranking.
- Fix: refuse with `recorded: false, reason: 'workspace unavailable'` when the root is empty.

### Serious 4 — Lane-outcomes disposer ordering is inconsistent across hosts

- File: `apps/ptah-electron/src/activation/shutdown.ts:258-270`; `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:434,451`; `apps/ptah-extension-vscode/src/main.ts:200-211`
- Scenario: see the failure mode above.
- Impact: Electron silently drops outcome writes produced by the agent reap; CLI cannot flush to SQLite and relies on the journal; only VS Code matches the plan's intent. The brief's check "awaited on every host shutdown path" passes literally (it is awaited, and a throwing or hung disposer does not block shutdown on any host), but the SC-10 flush guarantee is not uniform.
- Fix: one ordering rule on all hosts, with a spec per host that asserts disposer-after-reap and disposer-before-SQLite-close.

## Moderate and minor issues

Moderate:

1. `agent-tool.dispatcher.ts:385-395`: stdio `route_decide` invalid-arguments and F9 both use `mcp_tool_failed`; other tools and `outcome_report` use `mcp_invalid_tool_args` for bad arguments.
2. `agent-tool.dispatcher.ts:401`: `resolveOutcomeReport` called outside the `try`; HTTP calls it inside (`protocol-dispatcher.ts:2815`). Behaviour differs between transports for the same fault.
3. `lane-outcomes/src/lib/di/start.ts:27-48` plus the three host catch blocks: a partial start leaks subscriptions and registers no disposer.
4. `outcome-report.tool.ts:40-61`: hand-written input schema has no enums for `taskKind` and `routingSource` and no length bounds; the Zod schema (`lane-outcome.schema.ts:13-30`) is the only enforcement, and the two can drift.

Minor:

- `http-mcp-server.service.ts:406`, `stdio-mcp-server.service.ts:472`: `typeof ... === 'function'` guard converts a missing method into a permanent soft "unavailable".
- `route-tool-handlers.ts:36-40`: redaction patterns miss unprefixed keys shorter than 40 chars (for example a 32-char hex key). The invalid-arguments reply (`:78-85`) is not redacted; Zod `unrecognized_keys` echoes caller-chosen key names.
- `shutdown.ts:262`: literal 2000 instead of a named budget; unlike its neighbours it cannot be overridden in `QuitSequenceDeps` for tests.
- Disposer token literal duplicated, exported constant unused (`lane-outcomes-wiring.ts:10`).
- `ptah-api-builder.service.ts:1216`: caller-declared (URL) workspace root is accepted as the stat root.
- `main.ts:204`: the VS Code disposer has no outer time budget, unlike Electron.

## Data flow

`ptah_route_decide` over HTTP
1. `tools/list`: listed outside every namespace guard, not in `ALWAYS_EAGER_TOOLS` (deferred) — OK, matches part-a D2 and the brief.
2. `tools/call` -> `case ROUTE_DECIDE_TOOL_NAME` -> `routeDecideResponse` -> `handleRouteToolCall` — OK.
3. `RouteDecideArgsSchema.safeParse(args)` — OK; invalid input becomes a tool error naming the field, service not called.
4. `route.decide` -> locator -> F9 or service — OK.
5. `JSON.stringify(result)` -> `createToolSuccessResponse` (24,000 cap) — GAP: truncation yields invalid JSON as success (Serious 2).
6. Failure -> redacted text, `logger.warn` with error name and redacted text only — OK, no raw provider body.

`ptah_route_decide` over stdio: same steps through `AgentToolDispatcher.handleRouteDecide`, same schema and handler, budget by `ptah_route_decide` — OK; error code differs (Moderate 1).

`ptah_outcome_report`
1. HTTP and stdio both call `runOutcomeReport` with the same Zod parse — OK.
2. Dependency resolution — GAP on stdio (Moderate 2); workspace `''` (Serious 3).
3. No pipeline or store -> `{ recorded: false, reason }` with args still parsed — OK.
4. Pipeline submit failure -> logged by code name only, soft result — OK.

Host registration
- VS Code: routing `phase-2-libraries.ts:131`, outcomes `:132`, lm-tools `:139`, sdk `:179`, cli-agent-runtime `:235`, start `:237` — OK. KV store (no SQLite) — OK.
- Electron: routing `:316`, outcomes `:317`, aliases `:318-323`, cli-agent-runtime `:324`, SQLite `:395`, start `:425` after SQLite — OK.
- CLI: routing `container.ts:737`, `wireLaneOutcomes` `:738`, cli-agent-runtime `:739`, thoth/SQLite `:767`, start `:768` — OK.
- Single registration per host: `registerLaneRoutingServices`, `registerLaneOutcomeServices`, `startLaneOutcomes` each have one call site per host; `startLaneOutcomes` re-registers only if `RECORDER` is absent (`start.ts:18-19`) — OK.
- Host without lane-routing: F9 string, no crash — OK.

Shutdown
- VS Code `deactivate`: disposer awaited after reap and metadata flush, in `try/catch` — OK.
- Electron `will-quit`: `requiresDeferredDisposal` includes the disposer (`shutdown.ts:424`), awaited under `withBudget` (catches throw and hang) — OK, ordering GAP (Serious 4).
- CLI `shutdownHostRuntime`: awaited in `try/catch`, reached from `withEngine`'s `finally`, the bootstrap-failure path (`with-engine.ts:345`) and the signal path (`container.ts:373`) — OK, ordering GAP (Serious 4).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Both tools on HTTP and stdio, same args validation | COMPLETE | Error code differs on stdio route (Moderate 1) |
| `ptah_route_decide` always listed, outside namespace toggles | COMPLETE | None |
| `ptah_outcome_report` deferred, not eager | COMPLETE | None |
| F9 "routing unavailable", not a crash | COMPLETE | Different text when a hard dependency is missing (Minor) |
| Errors surfaced, not swallowed | PARTIAL | Truncated result as success (Serious 2); stdio outcome resolve escapes as -32603 (Moderate 2) |
| Spawn carries `taskKind` / `routingSource` on both transports | PARTIAL | Dropped for `ptahCliId` lanes (Serious 1) |
| Registration order in three hosts, no double registration | COMPLETE | None |
| Disposer awaited on every host shutdown path (SC-10) | PARTIAL | Awaited everywhere; ordering differs (Serious 4) |
| Disposer failure does not block shutdown | COMPLETE | None |
| No raw secret or provider body in logs | COMPLETE | Redaction patterns incomplete (Minor) |
| 24,000-char cap holds a 70-phase result | UNVERIFIED | No measurement (Serious 2) |

Implicit requirements not addressed: parity spec for error codes; ordering spec for shutdown; a single owner for the disposer token; empty-workspace handling in the outcome tool.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Invalid route args | YES | Zod, field-named error, service not called | Stdio code |
| No `arguments` object (stdio) | YES | `safeParse(undefined)` -> invalid args | None |
| Routing unregistered | YES | `isRegistered(token, true)` -> F9 | None |
| Container absent | YES | `resolveRouteDecideService` returns `undefined` | None |
| `agent` namespace failed to build | YES | Proxy throws inside `try` | None |
| Over-cap result | NO | Prefix cut + trailer | Serious 2 |
| Outcome store/pipeline unregistered | YES | `recorded: false` after parse | None |
| Outcome with no workspace | NO | `resolve('')` = cwd | Serious 3 |
| Path escaping the workspace | YES | `isAbsolute` and `..` check | None |
| Disposer throws | YES | try/catch or `withBudget` on all hosts | None |
| Disposer hangs | PARTIAL | Electron bounded; pipeline inner 2 s; VS Code and CLI no outer bound | Minor |
| Second shutdown call (signal then `finally`) | YES | Pipeline `dispose` tolerates repeat calls (`closing`/`disposed` flags) | Not run |
| Partial `startLaneOutcomes` | NO | Leaks, no disposer | Moderate 3 |
| Ptah CLI lane with routing metadata | NO | Dropped | Serious 1 |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (HIGH on Serious 1 and 3, which are visible in the code; MEDIUM on Serious 2 and 4, which depend on sizes and runtime behaviour I did not execute)
- Top risk: routed Ptah CLI lanes are recorded as unrouted, so the outcome loop that this task builds learns nothing from them, with no error shown.
- What a robust implementation would add: the two-field forward in the Ptah CLI spawn branch with a spec; a measured size gate (spec plus a tool error) for `ptah_route_decide`; an empty-workspace refusal in `ptah_outcome_report`; one shutdown ordering rule with per-host specs; `resolveOutcomeReport` inside the `try` on stdio; a `kind` on the route reply so stdio emits `mcp_invalid_tool_args`; an exception-safe `startLaneOutcomes`; one exported disposer token imported by all four shutdown sites.

## Decisions

- Scope reading of "Batch 26" excluded the outcome-report tool body (Batch 28, P5), but its transport adapters are Batch 29 and were reviewed for parity.
- Serious 1 is filed against P6 although the fix is in `agent-namespace.builder.ts`, a file no P6 commit touched: Batch 29's acceptance claim ("both transports") depends on it. Reversible: the team-leader may re-file it to the owning batch.
- Out-of-scope items not re-opened: #12, #13, #18/#22, #19, #96 and LT-P2-*, LT-P3-*, P2c, P3c.
