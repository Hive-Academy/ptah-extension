# Batch 37b — lane-routing correction (TASK_2026_646_136a)

HEAD at start: `8d29af556` (`feat/decision-model-routing`). No git write. Scope: `libs/backend/lane-routing` source and specs only. M-1 and M-2 were not touched.

## 1. S-1 rest — provider text stays out of logs and transport detail

`libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts`

- Success debug log (`:195-198`) records `this.options.model` (the model we requested) and the answer count. It no longer reads `validated.data.model`.
- Transport rejection (`:208-223`) still treats an aborted signal as `timeout` with the fixed timeout sentence. Every other rejection is `unreachable` with detail `transport error (<name>)`, or `transport error (Error)` when the rejection is not an `Error` or `name` is empty. `error.message` is not copied into the detail. `logged()` warns that same detail, so the message cannot reach any logger level.

Spec: `system-one.client.spec.ts:288-303` expects `detail: 'transport error (TypeError)'`. `system-one.client.spec.ts:453-501` rejects `TypeError('connect SECRET-PROMPT')` and a 200 body whose `model` is `echo-SECRET-PROMPT`. The failure detail is the fixed TypeError text, the success payload may still carry the provider model, and neither `SECRET-PROMPT` appears in debug/info/warn/error entries. The requested model `nimble` is what the success log contains.

## 2. S-3 rest — a held mark write cannot be the last persisted value

`libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`

- One chain per instance: `markChain` (`:103`), `enqueueMark` (`:622-629`).
- `markUnsupported` (`:306-337`) still returns immediately when the key is already stale. Otherwise the write runs on the chain. Inside the chain the key is checked again (`:317-319`). If it is no longer current, the slot writes a clear (`storage.update(key, undefined)`) and does not assign `this.mark`. If it is current, `this.mark` is set and then `persistMark` writes the mark (`:327-335`).
- `clearMark` (`:672-678`) still clears `this.mark` and logs before it waits, then enqueues the clear on the same chain, so a clear requested while a mark update is in flight runs after that update.
- `persistMark` (`:631-644`) keeps the previous warn texts (`was not persisted` / `was not cleared in storage`) and logs `errorMessage(error)` only.
- `applyProbe` re-checks `currentProbeKey()` after `markUnsupported` (`:465-467`) and after `clearMark` (`:478-480`). A mismatch returns `currentRowWithoutProbe()` and does not return the probe's original row.

Spec: `decision-model.config.spec.ts:805-848`. Selection A is marked, the first `storage.update` is held, selection switches to B (the clear log is observed before the hold is released), then A's write is released. `isMarkedUnsupported()` is false, the storage key is absent, and the last value passed to `update` is `undefined`.

## 3. Moderate — `getStatus` retries a stale probe at most once

`decision-model.config.ts:248-282` and `:444-456`.

- `getStatus` calls `statusForCurrent(true)`.
- When the probe's key is no longer current and `allowRetry` is true, `applyProbe` calls `statusForCurrent(false)` once.
- A second mismatch returns `currentRowWithoutProbe()` (`:650-670`). Unmarked Ollama is `unreachable` with `detail: null`. A current in-memory mark is `unsupported-endpoint` with that mark's detail. `unset` / `jev` / `structured` use the existing non-probe status paths. No new `DecisionModelState` was added.
- `recheckAfterLiveNotFound` passes `allowRetry: false` (`:373-379`), so a stale recheck does not start another probe.
- A key change after the mark or clear await also uses `currentRowWithoutProbe()` and does not spend another probe.

Spec: `decision-model.config.spec.ts:850-898`. Two selection changes while version probes are held produce exactly two `/api/version` waits. `getStatus` resolves to selection `gamma`, state `unreachable`, detail `null`.

## 4. Style Serious 1 rest — barrel

Consumer search, re-run this batch (vscode-lm-tools is being edited by another lane):

`rg -n "@ptah-extension/lane-routing" apps libs -g "*.ts" -g "!libs/backend/lane-routing/**"`

18 import sites. Each multi-line block was read. Names actually imported:

- `LANE_ROUTING_TOKENS`, `registerLaneRoutingServices` — `apps/ptah-cli`, `apps/ptah-electron`, `apps/ptah-extension-vscode` container smokes and phase-2; `libs/backend/cli-engine/src/lib/container.ts`; `libs/backend/agent-sdk/src/lib/di/register.ts`; `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- `StructuredDecisionCompleter`, `StructuredDecisionRequest` — `libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts` (spec imports `StructuredDecisionRequest`)
- `RouteCandidateSource`, `RouteDecideArgs`, `RouteDecideResult`, `RouteDecideService` — `libs/backend/vscode-lm-tools/.../route-namespace.builder.ts` and its spec
- `RouteDecideArgsSchema`, `RouteDecideResult` — `route-tool-handlers.ts` (spec imports `RouteDecideResult`; `route-tools.ts` and its spec import `RouteDecideArgsSchema`)
- `DecisionModelConfig` — `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- `DecisionModelSelection`, `DecisionModelStatusDto` — `agent-rpc.handlers.decision-model.spec.ts`

No consumer imports the probe constants, the storage key, the mark schema, the control path, the probe result types, or the mark type. Those names stay exported from `decision-model.types.ts` for in-library use.

Removed from `src/index.ts` (the old `:20-29`, `:32-33`, `:38` block). The DTO export that remains is `src/index.ts:19-26`:

Removed: `DECISION_MODEL_CONFIG_KEY`, `DECISION_MODEL_CONFIG_SECTION`, `DECISION_MODEL_JEV_SECRET_KEY`, `DECISION_MODEL_PROBE_TIMEOUT_MS`, `DECISION_MODEL_RECHECK_WINDOW_MS`, `DECISION_MODEL_UNSUPPORTED_STORAGE_KEY`, `DecisionModelSelectionSchema`, `DecisionModelUnsupportedMarkSchema`, `JEV_BASE_URL`, `SYSTEM_ONE_CONTROL_PATH`, `DecisionModelProbeOutcome`, `DecisionModelProbeResult`, `DecisionModelUnsupportedMark`.

Kept on the barrel, including every consumer name above: `DecisionModelKind`, `DecisionModelLocality`, `DecisionModelSelection`, `DecisionModelSelectionInput`, `DecisionModelState`, `DecisionModelStatusDto`, plus the tokens, logger types, `DecisionModelConfig`, `SystemOneTarget`, structured port, `registerLaneRoutingServices`, route-decide service and schemas, and `RouteCandidateSource`.

## Line counts

eslint `max-lines` is 700 with comments and blank lines skipped. Specs are ignored by that rule.

| File | Physical | Counted (comments and blanks skipped) |
| --- | ---: | ---: |
| `src/index.ts` | 59 | 50 |
| `system-one.client.ts` | 246 | 185 |
| `decision-model.config.ts` | 712 | 578 |
| `system-one.client.spec.ts` | 503 | n/a (spec) |
| `decision-model.config.spec.ts` | 900 | n/a (spec) |

`decision-model.config.ts` is over 700 physical lines because the new comments are counted in the physical total. The eslint counted total is 578, and eslint reported no `max-lines` warning.

## Checks

Jest, Nx, build, serve, e2e, and package were not run (decision #53).

- eslint on the five files: exit 0, no findings.
- prettier `--write` then `--check`: exit 0, `All matched files use Prettier code style!`
- `npx tsc -p libs/backend/lane-routing/tsconfig.lib.json --noEmit`: exit 0, no `error TS` lines.
- degradation audit `--max-warnings=-1`: exit 0, `TOTAL 296`, no `FAIL` line. Baseline was not raised.
- di-lint: exit 0, `di-lint OK: 1846 @inject sites all resolve to a registered token (815 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`.

## Decisions

1. Success log uses the requested model (`this.options.model`). The parsed success payload still includes the provider `model`. Options were to drop that field from the result, or to keep it and only stop logging it. The task forbids the provider model in detail and in logs. Reversible.
2. Transport detail is `transport error (<error.name>)`, or `transport error (Error)` when there is no name. Timeout vs unreachable is still the abort signal. Options were a fixed string with no name, or the name as specified. Reversible.
3. Mark writes share one promise chain (same `.then(work, work)` shape as rotation). The in-memory mark is assigned only after the in-chain key check passes, and it is not restored after the storage await. `clearMark` nulls memory immediately and queues the clear behind any in-flight mark write. A stale chain slot writes a clear. A call whose key is already stale returns before enqueue, so it cannot clear a newer mark that has already committed. Options were a generation counter that drops the stale write without a following clear, or this chain plus an ordered clear. The task requires the chain and a clear when the key is no longer current. Reversible.
4. An unprobed current Ollama row uses existing state `unreachable` with `detail: null`, or `unsupported-endpoint` when the in-memory mark matches. No new DTO state (decision #46). Options were a new pending state, or `unreachable`. Reversible.
5. Only the caller-facing `getStatus` may retry, and only once (`statusForCurrent(false)`). A second key change, a key change after the mark/clear await, and `recheckAfterLiveNotFound` return the current row without another probe. Options were to let recheck call `getStatus()` (one extra probe) or to pass `allowRetry: false`. The moderate finding is the unbounded `getStatus` retry. Reversible.

## Clarifications Needed

None.

## Not done

- Jest was not run. The new specs are `system-one.client.spec.ts:453` and `decision-model.config.spec.ts:805` and `:850`. The orchestrator runs tests.
- No commit, push, or PR (this batch forbids git writes).
- `ptah_agent_report` was not available on this session's MCP client (`search_tool` for `ptah_agent_report` returned no tools).
