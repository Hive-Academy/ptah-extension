# Agent accounting investigation

MEASURED: This is a read-only source investigation of the external CLI agent path and pricing infrastructure on 2026-09-21. `context.md` and root `CLAUDE.md` were read first. No source, tests, configuration, dependencies, or runtime sessions were changed; no builds or tests were run. Frontend tracing belongs to the parent investigation and was not independently performed here. File citations below are relative to `D:\projects\ptah-extension`.

## Spawn-scoped identity and parent linkage

| Claim | Source |
| --- | --- |
| MEASURED: `ptah_agent_spawn` validates its arguments, then invokes `ptahAPI.agent.spawn`; the child's model is `spawnArgs.model`, and its parent session is `request._callerSessionId`. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:729`, `:759`, `:767`, `:770` |
| MEASURED: The agent namespace resolves a requested parent or falls back to the active session; it passes the resolved parent as `parentSessionId` to `AgentProcessManager.spawn`. | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:175`, `:178`, `:180`, `:290`, `:293`, `:299` |
| MEASURED: Explicit request model wins; otherwise the `ptah.agentOrchestration` configuration selects the CLI-specific model. Codex's configuration key is `codexModel`. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:37`, `:39`, `:165`, `:169`, `:173`, `:178` |
| MEASURED: The manager writes the resolved child model to `AgentProcessInfo.model`; it independently records `parentSessionId`, `cli`, and `startedAt`. The same resolved model is passed into the native CLI adapter. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:284`, `:293`, `:295`, `:300`, `:301`, `:303`, `:325`, `:330` |
| MEASURED: The record is stored in the manager's `agents` map keyed by `agentId`; the manager emits `agent:spawned` carrying that record. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:476`, `:496`, `:582` |
| MEASURED: The wiring broadcasts that record as `AGENT_MONITOR_SPAWNED`. | `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:167`, `:169` |

MEASURED: This record's model is scoped to the child agent. The frontend chain belongs to the consolidated report; this lane's backend evidence does not connect the record to the header badge.

## Native Codex usage transport

| Claim | Source |
| --- | --- |
| MEASURED: A successful Codex `turn.completed` emits a textual `info` segment of the form `Usage: N input, M output tokens`, from `event.usage.input_tokens` and `.output_tokens`. This function does not compute or emit a dollar cost. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:1104`, `:1111`, `:1113` |
| MEASURED: The manager registers an `onSegment` callback and puts segments into the output buffer for the same `agentId`. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:512`, `:513`, `:514` |
| MEASURED: The buffer emits `AgentOutputDelta` keyed by `agentId`, with stdout, stderr, timestamp, segments, and optional stream events. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:189`, `:217`, `:218`, `:221`, `:222` |
| MEASURED: The manager emits `agent:output`; wiring broadcasts it as `AGENT_MONITOR_OUTPUT`. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1369`; `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:185`, `:187` |

MEASURED: The measured native Codex transport is per agent. It supplies input/output counts but omits cached-input detail in the text segment (`codex-cli.adapter.ts:1111`). Whether the header sums these values is a frontend question.

## Persistence does not roll up external agent usage

MEASURED: Spawn and exit wiring call `persistCliSessionReference` (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:180`, `:206`). That function requires `info.parentSessionId` (`:312`), saves output separately (`:428`), and links a `CliSessionReference` to the parent (`:438`). The reference includes child session/agent identity, task, start time, status, optional output, and optional Ptah CLI identity; it has no model, token count, or cost (`:394` through `:409`).

MEASURED: `SessionMetadataStore.addCliSession` loads the parent by `sessionId` and updates only `lastActiveAt` and `cliSessions`; its spread preserves existing parent metadata (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:965`, `:970`, `:1009` through `:1013`). The child reference persistence path is therefore not an operation that adds child usage to `metadata.totalCost` or `.totalTokens`.

MEASURED: There is no backend rollup in the measured external-agent path. `addCliSession` does not overwrite the parent's model or totals. The consolidated report owns the separate frontend trace.

## Pricing infrastructure

MEASURED: Shared `calculateMessageCost(modelId, tokens, pricing?)` uses an explicitly supplied pricing object when present, otherwise `findModelPricing(modelId)`. It sums input, output, cache-read, and cache-creation contributions, returning a six-decimal rounded USD amount or `null` if unpriced (`libs/shared/src/lib/utils/pricing.utils.ts:331` through `:347`).

MEASURED: The shared runtime map starts with `DEFAULT_MODEL_PRICING` and supports additive provider registration (`libs/shared/src/lib/utils/pricing.utils.ts:64`, `:122`, `:135`, `:152`). The bundled table contains older GPT models and local/cloud zero-cost entries, with neither Opus nor `gpt-5.6-sol` (`:64` through `:109`). Subscription-covered models deliberately share published usage rates; the subscription distinction is a display concern (`:54` through `:59`).

MEASURED: Lookup uses normalized exact keys, provider-prefix-stripped exact keys, then a longest-prefix match limited to date suffixes. A generic GPT prefix does not match a distinct `gpt-5.6-sol` family variant (`libs/shared/src/lib/utils/pricing.utils.ts:266` through `:301`).

MEASURED: `OpenRouterPricingService` fetches the OpenRouter public model catalog URL, builds full and stripped model keys, and registers entries in the shared map (`libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:9`, `:93`, `:100`, `:103`, `:105`, `:111`, `:154`, `:169`). `getPricing` also uses exact/case-normalized/prefix-stripped matching (`:49` through `:62`).

INFERRED: A wrong display model does not by itself prove a wrong cost rate. Each actual cost caller's `modelId` argument or supplied pricing must be traced separately. The native Codex agent transport above does not invoke this price table.

## Product intent evidence and limits

MEASURED: The documentation calls the header a running session total and says the per-message footer includes all subagents spawned in that turn (`apps/ptah-docs/src/content/docs/chat/cost-and-tokens.md:18`, `:19`). It also promises session-summary subagent cost (`:49` through `:51`).

MEASURED: Those docs have conflicting pricing statements: Copilot is described as `$0` (`apps/ptah-docs/src/content/docs/chat/cost-and-tokens.md:27`), but shared code explicitly excludes subscription-model zero seeding and says published rates apply (`libs/shared/src/lib/utils/pricing.utils.ts:54` through `:59`).

INFERRED: The documentation is broad evidence for subagent-inclusive spending as a product idea, but it is insufficient to settle whether an Orchestra orchestrator tile must include external `ptah_agent_spawn` CLI lanes. It neither distinguishes native SDK subagents from external lanes nor pins the present header implementation. Preserve aggregation pending the product decision unless stronger frontend/spec evidence exists.

MEASURED: Searches of `.ptah/specs`, `docs`, `apps/ptah-docs`, and `PRODUCT.md` for rollup/agent-cost intent found the documentation above but no precise external-lane header contract. This reports the search result, not a proof no such document exists.

## Unverified

- MEASURED: The actual reported session was not inspected. This lane has no evidence connecting its child record to the header model or totals.
- MEASURED: No frontend files were inspected by this lane; the exact renderer and selector chain belongs to the consolidated report.
- MEASURED: No running Electron reproduction was attempted. The no-spawn case and exact observed numeric totals remain unverified by this lane.
- MEASURED: Runtime pricing-map contents and original provider response payloads were not captured, so no claim of the actual charged rate or exact observed dollars is supported.
