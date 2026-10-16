# Code Style Review: TASK_2026_646_136a, phase P6 (MCP + host integration)

Reviewer family: Anthropic (decision #95). Implementers: grok/xAI and codex/OpenAI.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`, branch `feat/decision-model-routing`.

No check was executed. No Nx, Jest, tsc, lint, build, di-lint or `ptah_get_diagnostics` run. All claims below come from reading the commits and the current files. Pass/fail claims in the batch reports (test counts, lint 0 errors, di-lint OK) are quoted, not re-verified.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 3              |
| Moderate issues | 5              |
| Minor issues    | 7              |
| Files reviewed  | 41 (source and spec, across the four scoped commits) |

Score reasoning: the architecture is sound. The dependency graph is acyclic, tags and public aliases are correct, DI stays in composition roots, tool definitions are single-sourced and no `any` or `@ts-ignore` appears. It does not reach 7-8 because the outcome-report glue was copy-pasted into both transports (and a third helper copy), the lane-outcomes disposer protocol is an untyped raw `Symbol.for` literal repeated across five files with three copies of the start block, and the Electron shutdown edit diverges from that file's own conventions and corrupts a load-bearing comment. Every fix is mechanical and local. Nothing needs a redesign.

Scope note: the brief gives the dispatcher path as `mcp-handlers/protocol-dispatcher.ts`. That directory is a backward-compat shim (`code-execution/mcp-handlers/index.ts`). The real file is `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (4298 lines). Line references below use that path.

## Five style questions

### 1. What breaks in six months?

- Any change to the outcome-report error contract or its fallback dependencies must be made in three places: `protocol-dispatcher.ts:2825-2880` (HTTP), `mcp-stdio/agent-tool.dispatcher.ts:215-266` and `:402-416` (stdio), and the logger adapter again in `ptah-api-builder.service.ts:1201-1225`. The copies already differ: HTTP formats Zod issues through `describeZodIssues` (`protocol-dispatcher.ts:761`), stdio inlines the same expression (`agent-tool.dispatcher.ts:219-221`), and `route-tool-handlers.ts:43-53` carries a third formatter.
- A renamed or mistyped `'PtahLaneOutcomesDisposer'` in any one of five files (`phase-2-libraries.ts` VS Code `:238`, Electron `:426`, `main.ts:202`, `shutdown.ts:8`, `shutdown-host-runtime.ts:159`, plus `lane-outcomes-wiring.ts:10`) compiles, passes `isRegistered` guards and silently skips disposal. Nothing is typed against the registration.
- The next Electron service that needs a drain before `SQLite close` will copy the inline `2000` and the static-singleton lookup in `shutdown.ts:258-268`, not the documented `*_BUDGET_MS` pattern.

### 2. What would a new team member misread?

- `shutdown.ts:238-243`: the doc now ends "Nothing in here may run before stopMessagingGateway has SETTLED, The lane-outcomes drain and gateway writes finish before `SQLite close`." The sentence fragment is broken, and the original invariant ("`SQLite close` is the first statement") is gone while the function now has a different first statement (`:258`).
- `shutdown.ts:33` still says a deferred quit has "exactly one thing" to wait for (`GatewayService.stop()`), but `requiresDeferredDisposal` (`:424`) now also defers on the lane-outcomes disposer.
- `route-namespace.builder.ts:5` says "Hosts do not call `registerLaneRoutingServices` until Batch 30". Batch 30a registered it in all three roots, so the stated reason for using a locator is false.
- `ptah-api-builder.service.ts:670` assigns `builtAgent` from inside an object literal (`agent: (builtAgent = ...)`) so that `route:` at `:785` can read it. The "ORDERING CONTRACT" comment is the only guard.

### 3. What does this cost to maintain?

Mostly the copies in Q1, plus ~130 added lines in a 4298-line dispatcher (`git show f08e93af5`: 141 lines changed in that file) and 63 added lines in a 1251-line `ptah-api-builder.service.ts`. The batches.md note says "~55 lines (`:2790-2843`)". The measured adapter block is `:2790-2880`, ~90 lines, of which the 20-line `unavailableOutcomeFileSystem` stub (`:2858-2877`) exists only to satisfy a required field on an early-return path. The stdio dispatcher gained another ~55 lines for the same thing.

### 4. Where is this inconsistent with the rest of the repository?

- Sibling tools put argument parsing, error text and the reply shape in a handler module and keep the dispatcher case to one line: `session-tool-handlers.ts`, `surface-tool-handlers.ts` and (in this very batch) `route-tool-handlers.ts` returning `RouteToolReply`. The outcome-report tool skipped that step (`tools/outcome-report.tool.ts` exports `runOutcomeReport` only) and the dispatchers wrap it themselves.
- `shutdown.ts` keeps services on `BootRefs`/deps (`refs.messagingGateway`, `refs.agentProcessManager`, `deps.disposeVoiceWorker`) and gives every wait an exported, documented `*_BUDGET_MS` (`:49-111`). The new code imports the static `ElectronDIContainer` and inlines `2000`.
- `shutdown-host-runtime.ts` funnels every teardown through `disposeSubsystem` with documented token constants (`:34-44`). The new block (`:157-170`) re-implements the guard/try/stderr skeleton with a bare literal.

### 5. What would I have done differently?

1. Add `handleOutcomeReportCall(args, deps): Promise<{ isError; text; invalid }>` beside `runOutcomeReport`, mirroring `RouteToolReply`. Make `PtahAPIBuilder.outcomeReportDependencies()` always return a value (the "no container" fallback and the stub filesystem move inside it, behind one shared logger adapter). Both dispatchers shrink to the `routeDecideResponse` shape (~10 lines each) and the two `typeof ... === 'function'` guards go away.
2. Add `LANE_OUTCOME_TOKENS.DISPOSER` in `libs/backend/lane-outcomes/src/lib/di/tokens.ts` and let hosts import it. Better, let `startLaneOutcomes` register the disposer, removing the three try/register/catch copies.
3. In Electron, hold the disposer on `BootRefs` like the gateway and export a `LANE_OUTCOMES_DRAIN_BUDGET_MS`.

Reason: each removes a copy that is already drifting, at no loss of behaviour.

## Blocking issues

None. Checked and clear: no `eslint-disable` of `@nx/enforce-module-boundaries`, no `any`, no `@ts-ignore`, no `console.*`, no deep relative import into another lib's `src/`, no new `vscode` leak into an agnostic lib.

## Serious issues

### S1. Outcome-report glue copy-pasted into both transports, plus a third logger adapter, in the god file

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2803-2880`; `mcp-stdio/agent-tool.dispatcher.ts:215-266, 402-416`; `ptah-api-builder.service.ts:1201-1225`; `route-tool-handlers.ts:43-53`.
- Problem: `outcomeReportErrorText`, `unavailableOutcomeFileSystem` (13 stub methods) and the four-line `debug/info/warn/error` logger adapter exist verbatim in the HTTP dispatcher and the stdio dispatcher. The adapter appears a third time inside `outcomeReportDependencies()`. `describeZodIssues` is re-implemented in `route-tool-handlers.ts` ("Same shape as the dispatcher", `:42`) and inlined in the stdio copy. The comment on the stub says "Never read on the early return", so it is dead weight whose only purpose is a required field.
- Tradeoff: the tool definition itself is correctly single-sourced (`mcp-stdio/tool-builders.ts` renames `buildRouteDecideTool()` and `buildOutcomeReportTool()`), so the HTTP/stdio duplication is only in the call-side glue. That makes the fix cheap, and the batches.md "~55 lines in a god file" concern is real and understated (~90 lines in `protocol-dispatcher.ts`, ~55 in the stdio dispatcher). Extending a 4298-line file by repeating a pattern that `session-tool-handlers.ts` and `route-tool-handlers.ts` already solve is the cost.
- Recommendation: see Q5 item 1. Put the reply-shaping function in `mcp-core/tools/outcome-report.tool.ts` (or a sibling `outcome-report-handler.ts`), keep transport-specific code limited to mapping `{isError, invalid}` to `toolErrorResponse` or `toolError(..., 'mcp_invalid_tool_args')`. Reuse one `describeZodIssues` (export it from a small `zod-issues.ts`). The route tool's `RouteToolReply` is the model.

### S2. Lane-outcomes disposer is an untyped raw `Symbol.for` literal repeated across the hosts, with the start block copied

- File: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:236-246`; `apps/ptah-electron/src/di/phase-2-libraries.ts:424-434`; `apps/ptah-extension-vscode/src/main.ts:202`; `apps/ptah-electron/src/activation/shutdown.ts:8`; `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:159`; `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:10`.
- Problem: six literals of `'PtahLaneOutcomesDisposer'`. The CLI exports `LANE_OUTCOMES_DISPOSER` from `lane-outcomes-wiring.ts:10`, yet `shutdown-host-runtime.ts` in the same lib does not import it. The repo convention is tokens as `Symbol.for(...)` constants grouped in a token object; the lib already has `LANE_OUTCOME_TOKENS` (`libs/backend/lane-outcomes/src/lib/di/tokens.ts`) with the same `Symbol.for('PtahLaneOutcome...')` naming. The try/`startLaneOutcomes`/register/warn block is copied in VS Code and Electron roots (differing only in log prefix); the CLI put it in a helper.
- Tradeoff: this is the "inline disposer token" note in batches.md. It is not a boundary breach, but a typo produces silent no-op disposal (guarded by `isRegistered`), which is the worst failure mode for a drain that protects pending writes.
- Recommendation: add `DISPOSER` to `LANE_OUTCOME_TOKENS` and import it at all six sites. Preferably let `startLaneOutcomes` register the disposer itself so the roots reduce to one call. Registering a `{ dispose }` object instead of a bare function would also let `shutdown-host-runtime.ts` reuse `disposeSubsystem` (see M1).

### S3. Electron `shutdown.ts` diverges from the file's own conventions and corrupts a load-bearing comment

- File: `apps/ptah-electron/src/activation/shutdown.ts:5-8, 238-243, 255-268, 424`.
- Problem: (a) The lookup goes through the static `ElectronDIContainer` import (`:5`), where every other disposed service is reached through `BootRefs`/`DisposalDeps`; the spec now needs `jest.mock('../di/container')` to compensate (`shutdown.spec.ts` diff). (b) The wait uses a literal `2000` (`:265`), while every other bounded wait is an exported, rationale-documented constant (`BOOT_DRAIN_BUDGET_MS`, `GATEWAY_STOP_BUDGET_MS`, `AGENT_REAP_BUDGET_MS`, `METADATA_FLUSH_BUDGET_MS`, `RUN_CHECK_KILL_BUDGET_MS`). (c) The sentence stating the invariant ("`SQLite close` is the first statement and the gateway's drain writes to the database it closes") was overwritten by a fragment (`:241-242`). (d) The `:33` description ("exactly one thing, `GatewayService.stop()`") is now stale.
- Tradeoff: decision #97 authorised "minimal changes" to these files. This is minimal in lines, but not minimal in convention drift, and the comment loss removes the TASK_2026_347 rationale that stops the next editor reordering the chain.
- Recommendation: restore the original sentence and add one for the drain; add `LANE_OUTCOMES_DRAIN_BUDGET_MS` with a two-line rationale; populate a `refs.laneOutcomesDisposer` (or take the disposer through `DisposalDeps`) in the boot coordinator; update `:33`.

## Moderate issues

### M1. `shutdown-host-runtime.ts` bypasses its own helper and leaves the header stale

- File: `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:157-170`, header `:4`, `:144-150`.
- Problem: every other step calls `disposeSubsystem(container, TOKEN, label[, verb])`. The new block re-implements the isRegistered/try/stderr skeleton because the disposer is a bare function, not a `{ disposeAll | dispose }` object. The module comment still says "Three subsystems" and the `shutdownHostRuntime` doc still lists agents, proxies, watcher. The file's stated reason for `Symbol.for` constants ("keep this module dependency-light", `:34-39`) does not apply: the same package already imports `@ptah-extension/lane-outcomes` (`lane-outcomes-wiring.ts:4-8`). There is also no named `shutdownLaneOutcomes` export, unlike the three siblings.
- Recommendation: after S2, register `{ dispose }`, add `shutdownLaneOutcomes` using `disposeSubsystem(..., 'lane outcomes', 'dispose')`, update the header and order doc.

### M2. `let builtAgent` assignment-in-literal in `PtahAPIBuilder.build()`

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:554, 670, 785-792`.
- Problem: correct but fragile (depends on property evaluation order and on `buildNamespaceSafe` running its factory synchronously, per the comment at `:551-553`). The file is 1251 lines and the builder already has an "ORDERING CONTRACT".
- Recommendation: build `agent` into a `const` before the literal, or construct `route` with a lazy `() => this.ptahApi.agent` getter, or move `route` after the literal with a single assignment.

### M3. `route-namespace.builder.ts` duplicates a lane-routing rule and carries a stale rationale

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/route-namespace.builder.ts:5-6, 70-77`.
- Problem: `limitKey` re-implements `laneCandidateId` because "that helper is not on the public barrel" (comment `:70-72`). If the rule changes in lane-routing, limit lookups silently miss. The header comment (`:5`) is stale after Batch 30a.
- Recommendation: export `laneCandidateId` from `@ptah-extension/lane-routing`'s barrel and delete `limitKey`. Fix the header.

### M4. Test-double guards in production wiring

- File: `mcp-http/http-mcp-server.service.ts:406-408`; `mcp-stdio/stdio-mcp-server.service.ts:472-474`.
- Problem: `typeof this.apiBuilder.outcomeReportDependencies === 'function' ? ... : undefined` guards a method that always exists on the class. It shapes production code around partial mocks, and is duplicated twice. It disappears with S1 (builder always returns a value, specs get a full stub).

### M5. Guard specs: the "resolves aliases" tests exercise a copy of the wiring, and the alias block is copied six times

- File: `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:398-425`; `apps/ptah-electron/src/di/container.smoke.spec.ts:427-455`; `apps/ptah-cli/src/di/container.smoke.spec.ts:394`; production copies at VS Code `phase-2-libraries.ts:133-138`, Electron `:317-323`, CLI `lane-outcomes-wiring.ts:16-21`.
- Problem: the "resolves both aliases" cases call `c.register(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER, ...)` themselves, so they pass whether or not the roots do. Only the order test (source text `indexOf` over `phase-2-libraries.ts`) guards the real wiring. That `readFileSync`/`indexOf` pattern is established in these specs (pre-existing at `3ce35ddb9~1`), so it is accepted here, but it checks text, not behaviour. Batch 30a added `DECISION_MODEL_CONFIG_TOKEN` to all three `expected-resolvable.ts`; Batch 30 added no analogue for the outcome tokens, so the two batches treat the guard files differently.
- Recommendation: the CLI already has `wireLaneOutcomes`. The two Symbol-heavy roots cannot import cli-engine, so keep three copies if the plan's SC-3 forbids a shared home, but make the specs call the production function (CLI) and the order test cover the alias lines (already does). Record the choice in `decisions.md` so the six-copy shape is deliberate.

## Minor issues

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:36-68`: another bespoke shape-based secret redactor (`sanitizeErrorMessage` in `cli-agent-runtime/.../ptah-cli-registry.utils.ts:113`, `sanitizeDiagnostic` in `output-styles/.../sanitize-diagnostic.ts:30` already exist). None is exported for reuse, so this is not Serious. A shared helper would be the third real use, which the simplicity rule allows.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (spawn tool, `routingSource` enum `['model','ranking','pin']`) duplicates `agent-spawn-args.schema.ts:50` while `taskKind` in the same block uses the shared `OUTCOME_TASK_KINDS`. `libs/shared/src/lib/types/lane-outcome.types.ts:34` has `OUTCOME_ROUTING_SOURCES`; derive from it minus `'not-routed'`.
- Unrelated formatter churn inside feature diffs in `f08e93af5`: the spawn-refusal `logger.info` block in `protocol-dispatcher.ts` (~`:1227-1235`), the `limits` ternary in `agent-tool.dispatcher.ts:~592`, `finish({...})` in `stdio-mcp-server.service.spec.ts`. In `e082c0cbe`, `libs/backend/cli-engine/src/lib/container.ts:~108-117` merges the agent-generation imports and drops a `PluginLoaderService` import line. Harmless, but it enlarges the review surface.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:1201-1225`: `workspaceRoot: ... ?? ''` uses an empty-string sentinel for "no workspace" where an optional field would say it.
- `mcp-stdio/stdio-mcp-server.service.ts:~468-474`: `AgentToolDispatcher` is now built with seven positional arguments, the last three being anonymous closures (`() => Date.now()`, `() => process.cwd()`, the outcome resolver).
- `as unknown as Logger` / `as unknown as PtahAPI` in `mcp-stdio/agent-tool.dispatcher.spec.ts` (batch 29 diff) and `as unknown as DependencyContainer` in `apps/ptah-cli/src/di/container.smoke.spec.ts`: spec-only, matches sibling specs.
- `DECISION_MODEL_CONFIG_TOKEN` is declared three times (`apps/*/src/di/expected-resolvable.ts`) and only asserted equal to the lib token. Follows the pre-existing `LANE_MODEL_LISTING_TOKEN` and `STRUCTURED_DECISION_TOKEN` pattern; importing `LANE_ROUTING_TOKENS` in the smoke spec (already imported) would do.

## File-by-file

### `mcp-core/route-tools.ts`
Score 8/10, 0 B, 0 S, 0 M. Builds the schema from `RouteDecideArgsSchema` with `z.toJSONSchema` exactly as `session-tools.ts:48` and `surface-tools.ts:55` do. The extra `flattenStageUnion` (`:49-90`) is justified by the MCP `type: object` requirement and is typed without `any`. 124 lines, within limits.

### `mcp-core/route-tool-handlers.ts`
Score 7/10, 0 B, 0 S, 0 M, 2 minor. Clean `RouteToolReply` seam, injected `RouteToolLogger` (no `console`), validation before the service. Duplicates `describeZodIssues` and adds a local redactor (see S1, Minor).

### `namespace-builders/route-namespace.builder.ts`
Score 7/10, 0 B, 0 S, 1 M. Good locator interface (`RouteServiceLocator`) and F9 error. `limitKey` duplication and stale header (M3).

### `mcp-core/protocol-dispatcher.ts` (Batch 29 part)
Score 5/10, 0 B, 1 S, 1 minor. Registration is correct and follows `buildSessionHandoffTool()`: the route tool sits beside it with a documented always-on, not-eager decision (`:444-449, 544-552, 664-669`); budget and content hint entries are added in `tool-result-budget.ts`. The cost is the ~90-line adapter block (S1) in a file already past 4000 lines.

### `mcp-stdio/agent-tool.dispatcher.ts`, `stdio-mcp-server.service.ts`, `tool-builders.ts`, `index.ts`
Score 6/10, 0 B, 1 S (shared S1), 1 M (M4), 1 minor. Tool definitions are reused through `rename(...)`, not copied. Catalog count comments updated (12 tools). Call-side glue duplicated.

### `mcp-http/http-mcp-server.service.ts`, `ptah-api-builder.service.ts`, `types.ts`
Score 6/10, 0 B, 0 S, 2 M (M2, M4), 2 minor. Route namespace is wired through `buildNamespaceSafe` like the others and the `PtahAPI` type documents it as non-optional. `let builtAgent` pattern and the empty-string sentinel.

### `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`, `lane-outcomes-wiring.ts`
Score 8/10, 0 B, 0 S (S2 applies to the disposer block), 1 M (M5). Placement is right: routing and outcomes registered in phase 2 before `registerCliAgentRuntimeServices` / `registerVsCodeLmToolsServices` and `registerRpcSurface`, start after `registerSdkServices` (VS Code `:179` then `:236`), and after SQLite registration in Electron (`:395` then `:424`). DI calls appear only in composition roots; the lane libs are not imported by each other. CLI uses a helper so the container root does not grow, which is better than the copy in the other two roots. `lane-outcomes-wiring.ts` has no role suffix beyond `-wiring`, acceptable beside `container.ts`.

### `apps/ptah-extension-vscode/src/main.ts`
Score 8/10, 0 B, 0 S, 0 M. Disposal in `deactivate` is awaited, failure logged through the injected logger and non-fatal. Literal token (S2).

### `apps/ptah-electron/src/activation/shutdown.ts`
Score 5/10, 0 B, 1 S (S3), 0 M. See S3.

### `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts`
Score 6/10, 0 B, 0 S, 1 M (M1).

### Guard specs (`container.smoke.spec.ts` x3, `expected-resolvable.ts` x3, `shutdown.spec.ts`, `deactivate-order.spec.ts`, `shutdown-host-runtime.spec.ts`, `mcp-serve.spec.ts`)
Score 7/10, 0 B, 0 S, 1 M (M5). Consistent across the three hosts; each guards single registration, order and aliases. `rpc-surface.spec.ts` and `surface-composition.spec.ts` in `apps/ptah-extension-vscode/src/di/` were not touched by `3ce35ddb9` or `e082c0cbe`; by reading, neither references the lane tokens, but I did not run them, so "consistent update" for those two files is unverified.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Projects carry `scope:*` and `type:*` tags | PASS | `libs/backend/lane-routing/project.json:6`, `lane-outcomes/project.json:6` (`scope:extension`, `type:feature`) |
| No `eslint-disable` of `@nx/enforce-module-boundaries` in production | PASS | none added in the four commits |
| Cross-lib imports use `@ptah-extension/*` barrel aliases | PASS | `tsconfig.base.json:159-163`; no relative cross-lib import in the scoped files |
| lane-routing depends only on shared and platform-core | PASS | non-spec imports: `shared` x23, `platform-core` x4 |
| lane-outcomes depends only on shared, platform-core, persistence-sqlite, agent-sdk | PASS | non-spec imports: `agent-sdk` x2, `persistence-sqlite` x3, `platform-core` x5, `shared` x13 |
| Neither lib imports vscode-core or the other | PASS | grep of both `src` trees |
| Acyclic graph | PASS | `agent-sdk` -> `lane-routing` (`structured-decision.adapter.ts:25`), `lane-outcomes` -> `agent-sdk` (`di/start.ts:6`), `lane-routing` does not import `agent-sdk` (`structured-decision.adapter.ts:4` comment) |
| DI only in composition roots | PASS with note | roots: VS Code/Electron phase-2, `cli-engine/container.ts`; `PtahAPIBuilder` and `route-namespace.builder.ts` resolve via a container locator, an existing pattern in that builder (`ptah-api-builder.service.ts:524`), not a new `@inject` |
| Phased DI placement | PASS | routing/outcomes in phase 2, ahead of `registerVsCodeLmToolsServices` and `registerRpcSurface` |
| `expected-resolvable` / smoke guards updated | PASS (partial) | 30a updated all three; 30 added smoke cases but no `expected-resolvable` entries for outcome tokens (M5); `rpc-surface` / `surface-composition` unverified |
| HTTP vs stdio tool definitions single-sourced | PASS | `mcp-stdio/tool-builders.ts` `buildMcpRouteDecideTool`, `buildMcpOutcomeReportTool` use `rename(...)` |
| HTTP vs stdio call glue not duplicated | FAIL | S1 |
| Tokens are `Symbol.for` constants in a token object | FAIL | S2 (inline literals) |
| Injected Logger, no `console.*` | PASS | no `console.*` added; the one `process.stderr.write` follows the documented sibling rationale (`shutdown-host-runtime.ts:79-85`) |
| No `as any` / `@ts-ignore` / `as unknown as` in production | PASS | the only `as unknown as` are in specs |
| Kebab-case files with role suffix | PASS | `route-tools.ts`, `route-tool-handlers.ts`, `route-namespace.builder.ts`, `lane-outcomes-wiring.ts` |
| File-size limits for new code | PASS for new files | new files 108-124 lines; growth is in existing god files (S1, M2) |
| Sibling handler-module pattern (`session-tool-handlers`, `surface-tool-handlers`) | PARTIAL | followed for route, not for outcome report (S1) |
| Sibling shutdown conventions (`BootRefs`, `*_BUDGET_MS`, `disposeSubsystem`) | FAIL | S3, M1 |
| Webview-to-host RPC contract (`rpc.types.ts`) | NOT_APPLICABLE | no webview RPC added in scope |
| Commit scopes in `.commitlintrc.json` | NOT_VERIFIED | subjects use `vscode-lm-tools`, `vscode`, `electron`, `cli`, `cli-engine`, `task-specs`; I did not read the enum |

## Maintenance debt

- Introduced: three copies of outcome-report glue, a raw disposer symbol in six files and a start block in three, an unbudgeted/undocumented drain in Electron shutdown, one `let`-assignment ordering trick, one duplicated routing-key rule.
- Retired: the `ptah_route_decide` / `ptah_outcome_report` per-call implementations are single-sourced behind the shared `MCP_MVP_TOOL_NAMES` catalog and namespace builder; the TL-59 boot failure (missing `DECISION_MODEL_CONFIG`) is closed.
- Net: slightly negative. Roughly 250 lines of fixes would return it to neutral.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1, S2, S3 (all read directly); MEDIUM on spec consistency, since no test was run.
- Key concern: the outcome-report glue and the lane-outcomes disposer protocol are copied instead of placed once in the lib that owns them, and the Electron shutdown edit drops the invariant comment it sits under.
- What a 10/10 version would do differently:
  1. Put `handleOutcomeReportCall` (reply shape, error text, invalid flag) next to `runOutcomeReport` and make both dispatchers one-liners like `routeDecideResponse`; make `outcomeReportDependencies()` total so the stub filesystem and the `typeof` guards disappear.
  2. Add `LANE_OUTCOME_TOKENS.DISPOSER` (or have `startLaneOutcomes` register the disposer) and import it everywhere; register a `{ dispose }` object so `shutdown-host-runtime.ts` can reuse `disposeSubsystem` with a named `shutdownLaneOutcomes`.
  3. In Electron, carry the disposer on `BootRefs`, add `LANE_OUTCOMES_DRAIN_BUDGET_MS`, restore the `SQLite close` invariant sentence and fix the `:33` text.
  4. Export `laneCandidateId` from the lane-routing barrel and drop `limitKey`; fix the stale Batch-30 comment.
  5. Construct `agent` before the `PtahAPI` literal instead of assigning it inside.
  6. Keep reformatting out of feature commits.

## Decisions

- Reviewed the real dispatcher path (`mcp-core/`), not the `mcp-handlers/` shim named in the brief. Reversible: none needed.
- Rated the duplicated shape-based redactor Minor, not Serious, because no shared exported helper exists to reuse. Reversible: yes.
- Did not re-open decisions #12, #13, #18/#22, #19, #96 or LT-P2-*, LT-P3-*, P2c, P3c. The `lane-outcomes` esbuild `external` issue in decision #98 (LT-P2-19) is not assessed here.
- Runtime failure modes (for example `requiresDeferredDisposal` now true on every Electron quit, shutdown ordering relative to `flushSessionMetadataStores` in `main.ts`) are left to the code-logic reviewer.
