# Code style and structure review — TASK_2026_376

**Commit:** `eca2c155b`

**Score:** 7.5/10

**Verdict:** **APPROVE WITH FIXES** — the changes respect the monorepo's architectural walls and mostly follow its naming, facade, typing, and documentation conventions, but the new wire field bypasses the canonical Zod contract and one SDK-stream change discards type precision that the same library already provides.

## Findings

### 1. High — `toolCallId` bypasses the source-of-truth wire schema

**Evidence:**

- `libs/shared/src/lib/types/sdk-hook.types.ts:135` adds `toolCallId?: string` to `SdkSubagentEndedPayload` (`:158`).
- `libs/shared/src/lib/types/sdk-hook.schemas.ts:88`–`:97` still defines `SdkSubagentEndedPayloadSchema` without that field.
- `libs/shared/src/lib/types/sdk-hook.parsers.ts:5`–`:18` says the frontend parser is an exact runtime twin of the schema, that the schema is the source of truth, and that both must change together. The new implementation then documents a deliberate divergence at `:197`–`:208` and accepts/rejects `toolCallId` itself at `:231`–`:241`.
- `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:164`–`:189` validates with the incomplete schema, lets Zod strip `toolCallId`, and manually reattaches the field afterward.

This leaves three definitions of one external contract with different behaviour. In particular, the Zod schema accepts any unknown `toolCallId` value by stripping it, while the frontend parser rejects a present blank or non-string value. It also means this field is the only part of the outbound payload not validated by the repository's canonical boundary schema. A future schema-based producer, consumer, generated type, or equivalence corpus can silently drop the correlation id even while TypeScript says the payload supports it.

Model the field once in `SdkSubagentEndedPayloadSchema` as the same optional, non-empty string represented by the type and parser, extend the equivalence corpus, and let `SessionLifecycleNotifier` broadcast `parsed.data` like its sibling handlers. The rest of the optionality handling is consistent: `SubagentStopHookHandler` emits the key only for a non-empty string (`libs/backend/agent-sdk/src/lib/helpers/subagent-stop-hook-handler.ts:88`–`:103`), and the frontend parser rejects `''` rather than treating it as an id.

### 2. Medium — the curator duplicates SDK message narrowing with `unknown` casts

**Evidence:**

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:395`–`:423` narrows the SDK stream by checking string discriminants, then casts assistant messages and result messages through `unknown` into locally invented partial shapes.
- The same library already exposes the authoritative guards `isAssistantMessage`, `isResultMessage`, and `isErrorResult` at `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:340`–`:349` and `:384`–`:387`, plus `isTextBlock` and `isToolUseBlock` at `:480`–`:497`.
- The other author touching content blocks in this commit uses those shared guards in `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:108`–`:146` and `:148` onward.

The handwritten shapes create a second, weaker interpretation of `SDKMessage`: compiler checks no longer tell this collector when the installed SDK changes a content block or result subtype, and future maintainers must remember that the curator does not use the library's normal narrowing path. Reusing the existing guards would make the two blind-authored batches structurally consistent and remove the new `as unknown as` seams without introducing another abstraction.

### 3. Low — the load-bearing event order is pinned only by a test

**Evidence:**

- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:276`–`:313` now emits `background_agent_started` before the matching `tool_result`, but the production code does not say that this order is an invariant.
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts:624`–`:660` is the only local explanation that the ordering matters.

The new layout can look like incidental construction order to someone tidying the branch, even though reversing it recreates the cross-library timing problem this task repaired. One short WHY comment beside the first push, with `TASK_2026_376 F2`, would make the maintenance constraint visible where a refactor would occur.

### 4. Low — a production comment records a temporary batch boundary

**Evidence:** `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:280`–`:286` explains the public outcome collapse in terms of what “this batch owns” and points readers to `b5-report.md`.

Batch ownership ceased to constrain the code once the four batches were integrated into one commit. Keeping that process note in production makes it unclear whether the two-arm `CuratorExtraction` contract is a durable design choice or deferred work forced by the implementation workflow. Retain the useful architectural reason in the code, but move the historical ownership detail to the task report (where it already exists) or replace it with a durable task-id/follow-up reference.

## Checked and found consistent

- **Layer and import boundaries:** no changed production file crosses a hard wall. Backend code imports shared contracts, `memory-contracts`, `vscode-core`, and `platform-core`, never a concrete platform adapter. Frontend code imports only shared/frontend libraries. `memory-curator` avoids an illegal dependency back to `agent-sdk` by recognising the timeout through the error name and bounded `cause` walk (`libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts:12`–`:45`).
- **Nx/project boundaries:** no new project or library was introduced, so no tags or path aliases needed updating. The existing projects retain both required tag axes. No app-local `*RpcHandlers` class or composition-root registration was added.
- **Wire absence model:** apart from the missing Zod field, `toolCallId` is optional end to end and `''` is never published as an id. The producer, parser, and consumer all preserve absence instead of inventing an empty sentinel.
- **Naming:** `adoptRealAgentId`, `CURATOR_MAX_TURNS`, `curator-job-queue.ts`, and `queue-slot-timeout.ts` describe their responsibilities at their call sites. New files are kebab-case; no vague `helpers`/`utils`/`common`/`misc` fragment was added. No new port or DI token was needed, so the `I`-prefix and `UPPER_SNAKE` token rules were not implicated.
- **Facade and file structure:** `MemoryCuratorService` keeps its public class, DI token, and method signatures while delegating window execution and pass serialization to named collaborators (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:109`–`:153`, `:265`–`:306`). The 73-line queue and 87-line timeout module are small but cohesive domain mechanisms with direct focused specs, not arbitrary cap-driven shards. The service remains above the 700-line warning threshold but below the roughly 1000-line deliberate-review threshold; this commit moves the new queue and timeout mechanics out rather than growing another undifferentiated block. The long service spec was also reviewed: the additions are integration coverage for the facade, while the two extracted mechanisms have their own specs.
- **Type hygiene:** no changed TypeScript file adds `@ts-ignore`, `@ts-expect-error`, or an unsafe type-only re-export. New `catch` clauses that inspect errors use `unknown` and narrow with `instanceof Error`. Type-only imports use `import type` or inline `type` consistently, except for the narrowing issue called out above.
- **Angular conventions:** the changes add no components, templates, Zone assumptions, RxJS state facades, or HTML rendering. `BackgroundAgentStore` remains a root injectable signal store, and `TurnEndHandlerService` continues to use `inject()`.
- **Comments and evidence:** most new comments meet the repository's unusually high WHY standard. In particular, the `CURATOR_MAX_TURNS` rationale records SDK semantics, the measured bound, and the coupling to queue latency (`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:138`–`:179`); the queue and timeout modules record the observed failure, non-cycle rationale, and task id (`libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:1`–`:44`; `queue-slot-timeout.ts:1`–`:29`).
- **Cross-batch consistency:** the background-agent batches use the same `agentId`/`toolCallId` vocabulary from hook producer through wire payload to store reconciliation. The curator shares one `QueueSlotRetryBudget` across extract windows and resolve (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:454`–`:466`), avoiding independent counters. No duplicate queue helper was added inside the four touched libraries.
- **Public API discipline:** no new internal curator helper was exported from a library barrel. The unrelated `isTerminalTurnPhase` addition lives in `libs/shared`, the permitted frontend/backend bridge, and is exposed through the existing shared type barrel rather than a new secondary entry point.

## Review scope

This was a static style/structure review of commit `eca2c155b` against the repository guidance and task context. I did not rerun Nx targets because the task permits writing only this review file and Nx/Jest can update workspace caches or coverage artifacts; `.ptah/specs/TASK_2026_376/context.md` records the orchestrator's successful six-project test and typecheck runs.
