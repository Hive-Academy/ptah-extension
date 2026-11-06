# Phase A code logic review — TASK_2026_878_5513

## Verdict

**REVISE — 6/10.** The new refusal classification, fixed curator run messages, RPC result, and Settings exclusion follow the specified paths. One Memory curator event producer still sends raw error text to the UI, so the phase's blanket no-raw-error promise is unmet. This is below the 7–8 band because it exposes a real failure payload; it is above the 3–4 band because the new run and refusal paths are coherent and their tests make useful assertions. Confidence: medium. The coordinator owns verification; I ran no tests or builds. `ptah_get_diagnostics` was unavailable after timing out twice, so typecheck status is unknown.

## Findings

1. **Serious — raw tool failure text reaches the Memory diagnostics event feed.** `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:498-505` pushes `snippetOneLine(payload.error, ...)` into a `tool-failure` event's `stats.error`. `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:634-639` forwards `stats` verbatim, and `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts:108-114` renders it. A failing tool can return provider text, a URL, or a credential fragment; truncation and one-line normalization do not make it a fixed user sentence. The existing UI spec at `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.spec.ts:191-198` even asserts the snippet behavior. **Fix:** log the raw tool failure in the backend, send a fixed `curatorRunMessage` sentence and reason code on the event, and remove `stats.error` from the wire-facing event. Add a sentinel assertion against the full diagnostics result and rendered feed.

### Five logic questions

1. **Silent failure:** the new Codex refusal is explicit in `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:313-340`; the unchecked diagnostics compiler result leaves type safety unverified here.
2. **Unexpected user action:** choosing Codex for Memory curator is blocked by `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts:323-330` and `provider-consumer-assignments.component.ts:663-709`. A tool failure still reveals raw text in the event feed (finding 1).
3. **Wrong input answer:** exact-message and provider-id matching at `libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts:45-52` keeps unrelated auth failures outside the unsupported classification.
4. **Dependency failure:** curator exceptions become fixed run messages at `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:467-522`; rebuild failure throws a coded user error at `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:392-407`.
5. **Unspecified case:** the task's broad event privacy promise also covers tool failures, but the batch checks focused on assignments to the event's top-level `error` field. Finding 1 is the resulting gap.

## Acceptance criteria check

- **Batch 1 — Pass by inspection.** The refusal constant and exact predicate are at `libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts:36-52`; the patch also adds exports and the requested predicate cases. No verify run in this lane.
- **Batch 2 — Pass by inspection.** Pinned and inherited resolver catches classify only the predicate at `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:275-350`; the runner stops before model resolution at `:542-562` and classifies a thrown refusal before network handling at `:661-679`. Ordinary auth errors continue through the wrapper. No verify run in this lane.
- **Batch 3 — Pass by inspection.** `CuratorRunReason` and its exhaustive message record are at `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:98-145`. Unsupported stalls update last run and push the sentence at `:313-340`; `recordError` classifies causes and pushes only the sentence at `:467-522`. The sentinel tests assert log presence and event absence at `curator-activity-log.spec.ts:245-275`.
- **Batch 4 — Pass for its named producers; broader event promise fails (finding 1).** The service failure push uses the table at `libs/backend/memory-curator/src/lib/memory-curator.service.ts:323-334`; trigger and boot-scan failure pushes use it at `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:1029-1038,1208-1213`.
- **Batch 5 — Pass by inspection.** `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:99-106` enforces two-way reason assignability; diagnostics forwards outcome, reason, and sentence at `:621-639`; run-now returns a typed fixed-message result at `:747-792`; rebuild throws at `:392-407`. The named leak check finds no `err.message`, `error.message`, or cause assigned to a pushed top-level event `error` or `MemoryRunNowResult.error`. That check does not cover `stats.error` (finding 1). No verify run in this lane.
- **Batch 7 — Pass by inspection.** `excludedProviders` defaults to empty and filters registry and extra options while keeping the selected value labelled at `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:442,472-503`.
- **Batch 8 — Pass by inspection.** The curator-only unsupported list is at `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts:69,251-269`; readiness blocks the choice at `:307-330`, and the assignment component passes the list and refuses save at `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:246-255,659-709`. The fixture uses a supported provider in the patch. No verify run in this lane.

**Exhaustiveness:** The new `CuratorRunReason` message record and two-way wire parity are compile-time exhaustive (`curator-activity-log.ts:127-145`, `memory-rpc.handlers.ts:99-106`). No changed switch over `CuratorStallReason` or `MemoryCuratorEventKind` was found in the Phase A diff. Compiler confirmation remains with the coordinator.

## Style notes

The changed imports use library public entry points across libraries, for example `memory-rpc.handlers.ts:8-82`; the adapter's relative imports stay within `agent-sdk`. The changed code uses `unknown` with narrowing rather than introducing `any`. Names such as `CuratorRunReason`, `curatorRunMessage`, and `unsupportedProviders` match nearby contracts. No separate style revision is requested.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the tool-failure payload as within the no-raw-event promise | Limit review to new top-level `error` assignments; trace every Memory curator event visible to the UI | The objective says every curator event reaching the UI carries fixed user text; `memory-trigger.service.ts:498-505` and `event-feed.component.ts:108-114` show a live raw-text path | Yes |
| Exclude Batch 6 from the verdict | Flag missing diagnostics UI; follow the stated Phase A review scope | The review request explicitly says Batch 6 is not built yet | Yes |
