# Implementation plan review — round 1

Reviewer: codex (CLI lane). Author: in-process Claude architects.

## Verdict: REVISE

## Findings

1. **Serious — outcome persistence conflicts with Req 5.7.** `implementation-plan-part-b.md:45-47,55-64` and `implementation-plan.md:176-177,326-334` deliberately use an in-memory outcome store in VS Code. That loses every VS Code lane and subagent record on restart, while `task-description.md:300` requires outcome records to persist across application restarts. The plan also says writes before the desktop/CLI database opens are dropped (`implementation-plan-part-b.md:47`), so those runs likewise do not persist. **Required fix:** specify durable storage and recovery for every host, including VS Code and the database-not-yet-open path, while preserving the host-neutral dependency graph; add restart and delayed-open acceptance fixtures.

2. **Serious — Ptah CLI provider model discovery is expressly omitted.** `implementation-plan-part-a.md:359-373` says the Ptah CLI adapter will read configured `selectedModel` and `tierMappings` but omit provider discovery. `task-description.md:454-459` explicitly requires the Ptah CLI row's provider model discovery at call time, with provenance. Configured IDs alone do not meet that criterion. **Required fix:** add the provider discovery source to the listing port/adapter, merge its live IDs with configured IDs and tiers, and test provenance plus timeout isolation for a Ptah CLI row.

3. **Serious — the proposed run key can be lost before the one-to-one telemetry join.** `implementation-plan-part-b.md:390-393,421-424` adds `runId` to the subagent invocation path, but does not change the recorder's existing dedup key. `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts:39-43` deduplicates by slug, session and a two-second bucket. Two distinct runs of the same agent in one session within that bucket leave only one `skill_invocation_events` row even if each has a different `run_id`. This breaks Req 5.4 (`task-description.md:287-292`). **Required fix:** use the exact run ID for subagent deduplication, retain the existing dedup behavior for other sources as appropriate, and test two same-slug, same-session runs within two seconds end to end.

4. **Serious — the skill's subagent report target becomes ambiguous.** `implementation-plan-part-a.md:455-458` tells the skill to report a subagent by slug and keep the returned `runId`. `implementation-plan-part-b.md:462-477` resolves a slug only when it has one open, unreviewed run in 24 hours. A deliverables report does not close a run; after another run of the same slug, the next report has two open runs and fails as ambiguous. Req 8.7 and 5.5 require reporting after each run (`task-description.md:293-295,400-402`). **Required fix:** define how the skill obtains and uses the exact subagent `runId` or `agentId` for every report, including repeated and concurrent runs, and test that sequence.

5. **Serious — SQLite writes sit on the lane completion path.** `implementation-plan-part-b.md:333-353` calls `recordLaneCompletion` before the notifier's parent checks and specifies a synchronous `better-sqlite3` write. A `try/catch` handles failure but does not prevent a busy or slow database write from delaying the completion signal. This conflicts with the review's non-blocking outcome-write criterion and the rationale of Req 5.9 (`task-description.md:303-304`). **Required fix:** move persistence off the signal path with a bounded, failure-isolated queue or equivalent asynchronous handoff; document ordering, deduplication, and shutdown behavior, and test delayed/failing writes while the signal is delivered promptly.

6. **Serious — the Ollama setting cannot detect an unsupported System One route.** `implementation-plan-part-a.md:251-263` probes only `GET /api/version` and marks a sufficiently recent version ready. A configured endpoint can serve that path while lacking `/v1/systemone`; Req 1.5 (`task-description.md:134-137`) requires the row to show the unsupported-endpoint state. **Required fix:** include a capability check for the actual System One route, or persist and surface an unsupported response from that route, and test a recent-version endpoint that returns 404 for `/v1/systemone`.

7. **Moderate — one dispatcher anchor is stale.** `implementation-plan-part-b.md:478-483` cites `protocol-dispatcher.ts:1029` as the HTTP dispatch `switch`. At `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1029` the function parameters begin; the `switch (name)` is at line 1037. **Required fix:** correct the anchor before assigning AB9.

## Anchors checked

| Cited anchor (plan location) | Actual worktree location and observation | Status |
| --- | --- | --- |
| `protocol-dispatcher.ts:515-526` (part A:31) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:515-526` — always-on block and session handoff tool | OK |
| `protocol-dispatcher.ts:2322-2337` (part A:32) | Same file `:2322-2337` — session handler dispatch | OK |
| `protocol-dispatcher.ts:732` (part A:33) | Same file `:732-735` — `describeZodIssues` | OK |
| `protocol-dispatcher.ts:1410-1431` (part A:34) | Same file `:1410-1431` — agent rows, limits and roles | OK |
| `mcp-stdio/agent-tool.dispatcher.ts:238-306` (part A:35) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:238-306` — tool names and switch | OK |
| `mcp-stdio/tool-builders.ts:58-69,77-90,191-204` (part A:35) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/tool-builders.ts:58-69,77-90,191-204` — MVP names, rename, builder list | OK |
| `phase-2-libraries.ts:214` (integrated:168) | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:213-215` — `useToken` alias | OK |
| `phase-2-libraries.ts:302` (integrated:169) | `apps/ptah-electron/src/di/phase-2-libraries.ts:301-303` — `useToken` alias | OK |
| `rpc.types.ts:1274-1281` (part A:398) | `libs/shared/src/lib/types/rpc.types.ts:1274-1281` — agent config methods | OK |
| `cli-agent-runtime/di/register.ts:91` (decisions #24; part B host wiring) | `libs/backend/cli-agent-runtime/src/lib/di/register.ts:84-92` — registration order comment and notifier registration | OK |
| `skill-trigger.service.ts:711-739` (part B:68) | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:711-739` — async metrics extraction, then event record | OK |
| `skill-trigger.service.ts:425-481` (part B:39) | Same file `:425-481` — harvest behind turn-complete and master gates | OK |
| `cli-engine/container.ts:736` (part B:543) | `libs/backend/cli-engine/src/lib/container.ts:736` — runtime registration | OK |
| `protocol-dispatcher.ts:1029` switch (part B:480) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1037` — actual `switch (name)` | WRONG |
| `migrations/index.ts:388-391` (part B:44) | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:388-391` — version 53 | OK |

## Coverage gaps

Req 1.5, 5.4, 5.5, 5.7, 8.7 and 11.1 have batches on the coverage table, but the specified behavior in findings 1-4 and 6 does not satisfy them. Req 5.9's non-blocking intent remains open under finding 5. The other Req 1-13 criteria and all four decision #23 items map to concrete batches in `implementation-plan.md:314-354`; no additional gap was established by this review.

## Decisions

| Judgement | Options considered | Evidence |
| --- | --- | --- |
| REVISE | Approve with open items; revise the plan | Findings 1-6 are likely requirement defects, so each is Serious under the requested verdict rule. |
| Keep the integrated plan authoritative | Resolve discrepancies using either part alone; use the integrated reconciliation | `implementation-plan.md:3-5,293-312` explicitly supersedes the parts where they disagree. The findings above remain after applying those reconciliations. |
| Treat only the Agents-tab Success replacement as an approved removal | Flag that replacement as unapproved; accept decision #13 | `decisions.md:16` records final user approval. No other planned capability removal was found. |
| Accept the graph and parallel waves provisionally | Flag a cycle or file collision; accept the stated decomposition | `implementation-plan.md:20-33,298-305,373-419` makes the two new libraries independent and sequences shared registration files. The new libs are specified with extension/feature tags and `Symbol.for` tokens; AB9 contains the shared dispatcher edits. No cycle or same-wave file collision was established. |
| Scoped verification is adequate for a plan | Require full workspace checks; keep scoped checks | `implementation-plan.md:361-368,373-419` uses project tests or targeted Jest with `--parallel=1`/`--maxWorkers=2` and one heavy check at a time. No build, serve or e2e command is prescribed. No tests or builds were run for this review. |
