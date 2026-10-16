# Implementation plan review — round 2

Reviewer: codex (CLI lane). Author: in-process Claude architects.

## Verdict: REVISE

## Round 1 findings

| # | Status | Evidence (plan file:line) | Note |
| --- | --- | --- | --- |
| 1 | PARTIAL | `implementation-plan.md:318-379,385-401`; `implementation-plan-part-b.md:301-318` | VS Code has a durable store and desktop/CLI have a pre-open journal and restart fixtures. The journal can discard unapplied records at its 1,000-op cap, and replay failure handling does not preserve the failed entry (new finding 1). |
| 2 | FIXED | `implementation-plan-part-a.md:386-426`; `implementation-plan.md:503` | Ptah CLI rows now use the existing provider discovery service, retain configured/tier IDs, label provenance, and specify timeout-isolation fixtures. |
| 3 | FIXED | `implementation-plan-part-b.md:398-410`; `implementation-plan.md:505,586` | Subagent events with a run ID deduplicate by that ID; the existing bucket remains for other events. Same-bucket distinct-run and duplicate-run fixtures are specified. |
| 4 | PARTIAL | `implementation-plan.md:280-299,560`; `implementation-plan-part-a.md:508-516` | Exact `agentId` targeting is sound if the Ptah tool result exposes the hook's ID. IA-4 remains unverified there; the only fallback can be ambiguous for repeated or concurrent runs, and the plan permits recording that gap (new finding 2). |
| 5 | FIXED | `implementation-plan.md:350-360,377-405`; `implementation-plan-part-b.md:301-305` | Completion performs an in-memory enqueue; store I/O runs in a scheduled drain. A delayed/throwing-store signal fixture and shutdown fixture are specified. |
| 6 | PARTIAL | `implementation-plan-part-a.md:259-275,294-302` | The second probe reaches the route, but its JSON-404 rule mistakes a generic missing-route response for route support (new finding 3). |
| 7 | FIXED | `implementation-plan-part-b.md:505`; `implementation-plan.md:516,590` | The dispatcher switch anchor is corrected to line 1037. |

## New findings

1. **Serious — the pre-open journal can lose records during replay or overflow.** `implementation-plan.md:361-379,391-401` says the journal drops its oldest ops at 1,000 entries, replays the journal and then clears it, while a store throw is logged and non-busy failures are not retried. A failed replayed insert can therefore be removed without reaching SQLite; an unopened DB can also discard earlier completed runs. Both defeat the promised persistence of those runs (`task-description.md:277-300`). **Required fix:** specify per-op acknowledgement: remove an entry only after its SQLite insert/upsert succeeds, keep failed entries durably for a later replay, and preserve FIFO order across retries. Replace the lossy pre-open overflow rule with a durable overflow strategy or an explicit, requirement-consistent failure policy; test an insert failure during replay, restart, recovery, and more than 1,000 pre-open completions. The bounded in-memory queue and completion-path handoff can remain.

2. **Serious — the subagent reporting fallback still cannot meet repeated/concurrent-run reporting.** `implementation-plan.md:280-299,560` and `implementation-plan-part-a.md:508-516` depend on the Agent tool result exposing the same `agentId` as SubagentStop. Decision `decisions.md:43` confirms that only for a Claude Code observation, not the Ptah chat runtime or ID equality. If IA-4 fails, the plan switches to a slug lookup that correctly rejects two open runs as ambiguous, then merely records the gap. It also says a missing run after an `agentId` report is not retried. Req 5.5 and 8.7 require a report after each run (`task-description.md:293-295,400-402`). **Required fix:** make B10a/A15 supply an exact correlation mechanism in the Ptah runtime if either IA-4 check fails, and retry or reconcile a report that races its stop insert. Specify acceptance fixtures for repeated and concurrent runs under the fallback path; a documented gap is not a passing outcome.

3. **Serious — a generic JSON 404 hides an unsupported System One route.** `implementation-plan-part-a.md:259-268,294-302` maps every JSON object with an `error` field on HTTP 404/405 to `ready`. An endpoint may answer `/api/version` with a recent version and answer an unknown route with `{"error":"not found"}`; this plan would show `ready` although `/v1/systemone` is absent, contrary to Req 1.5 (`task-description.md:134-137`). **Required fix:** distinguish a route-specific validation/model error from a generic missing-route error, or treat ambiguous 404/405 responses as unsupported until a route-specific response is observed. Add a recent-version plus generic JSON-404 fixture to the probe and live-call status tests.

## Anchors checked

| Cited anchor | Actual | Status |
| --- | --- | --- |
| `skill-invocation-recorder.ts:8,39-43` (part B:402-409) | `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts:8,35-43` uses a 2-second slug/session bucket today. | OK |
| `provider-models.service.ts:279-287` (part A:393-395) | `libs/backend/auth-providers/src/lib/provider-models.service.ts:279-287` exposes `fetchModels(providerId, apiKey, toolUseOnly)` with `models` and `isStatic`. | OK |
| `provider-rpc.handlers.ts:600-617` (part A:397-400) | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:600-618` gets the key, skips a keyless dynamic provider, then calls `fetchModels`. | OK |
| `platform-vscode/src/registration.ts:63-65` (SC-10:325-330) | `libs/backend/platform-vscode/src/registration.ts:63-65` binds `STATE_STORAGE` to `VscodeStateStorage(context.globalState)`. Its adapter's `update` awaits `Memento.update` (`implementations/vscode-state-storage.ts:13-23`); it has no built-in size cap. The proposed 90-day/2,000-row cap is therefore the new store's responsibility. | OK |
| `sqlite-connection.service.ts:450,479-486` (SC-10:331-332) | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:450-452,468-485` exposes `isOpen` and `onDidOpen`, with reopen notification and no immediate callback for already-open connections. | OK |
| `protocol-dispatcher.ts:1037` (part B:505) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1037` is `switch (name)`; line 1029 begins parameters. | OK |
| `subagent-hook-handler.ts:520-524` (SC-7:286-288) | `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:520-524` forwards hook `input.agent_id` to `SubagentStopPayload.agentId`. | OK |

## Decisions

| Judgement | Options | Evidence |
| --- | --- | --- |
| REVISE | Approve with open items; revise | New findings 1-3 leave Serious durability/correlation/unsupported-route defects. |
| Keep the changed dependency graph and waves | Merge/split batches; retain the integrated decomposition | `implementation-plan.md:488-534` keeps B4's new store/journal/pipeline files together, sequences the shared registration edits, and has no identified same-wave file overlap or dependency inversion. Host-neutral `lane-outcomes` uses the `platform-core` port and structural logger (`implementation-plan-part-b.md:292-298`), with no proposed `vscode`/`electron` import. This is a plan boundary; the new source does not exist yet. |
| Accept scoped verification commands | Demand broader commands; use changed-project checks | `implementation-plan.md:476-483,488-534` scopes Nx/Jest checks, sets `--parallel=1` or `--maxWorkers=2`, serializes heavy checks, and bars build/serve/e2e. No test, build, lint, typecheck, or e2e command was run for this review. |
| No new capability removal found | Seek new approval; retain existing approval | The revision diff adds storage/discovery/reporting rules; `decisions.md:16` already approves the Agents-tab Success replacement. |

