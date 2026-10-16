# Implementation plan review — round 3

Reviewer: codex (CLI lane). Author: in-process Claude architects.

## Verdict: REVISE

## Prior findings

| Id | Status | Evidence (plan file:line) | Note |
| --- | --- | --- | --- |
| R2-1 | FIXED | `implementation-plan.md:429-484,514-530`; `implementation-plan-part-b.md:305-308` | Per-op acknowledgement, transactional receipts, FIFO retry, dead letters, and durable capacity refusal replace lossy replay. The specified failure, restart, crash, and 1,500-op fixtures cover the reported cases. |
| R2-2 | FIXED | `implementation-plan.md:279-366,694-695`; `implementation-plan-part-a.md:537-548` | The Ptah run tag supplies an exact ID through PostToolUse `additionalContext`; registry lookup and SDK-result fallback are specified. Reports racing a stop are held and joined. Same-slug concurrent and repeated fixtures cover both tag and `agentId` paths. The required IA-5 runtime capture remains an implementation gate. |
| R2-3 | FIXED | `implementation-plan-part-a.md:263-295,315-331`; `implementation-plan.md:740` | The probe compares the System One response with an absent control route; equal generic JSON 404 responses are unsupported. Live 404/405 state persists and the requested fixtures are specified. |
| R1-1 | FIXED | `implementation-plan.md:383-491,500-531` | Accepted journal entries survive failed replay; direct-mode failures enter backlog, and VS Code acknowledges only a successful KV update. Capacity refusal is explicit, counted, logged, and covered as a Req 5.9 write failure. |
| R1-4 | FIXED | `implementation-plan.md:282-366,694-695`; `implementation-plan-part-a.md:534-548` | Exact run tags remove the slug ambiguity; IA-4 is optional. A report before stop is durably held, then joined by run ID. |
| R1-6 | FIXED | `implementation-plan-part-a.md:260-295,315-331` | The control-route discriminator rejects generic JSON 404/405; the live call marks unsupported state and the row restores it after restart. |

## New findings

1. **Serious — backlog reports silently lose the required unknown-run error.** `implementation-plan.md:470-475` makes `submit` return `{ ok: true, state: 'queued' }` before target validation when the desktop/CLI store is unavailable. If the run ID is unknown, replay only logs a warning and acknowledges the op. Req 5.6 requires an error naming that ID and no write (`task-description.md:296-299`); `implementation-plan-part-b.md:513-520` also promises that behavior. The caller cannot receive the error after its tool call has returned. **Required fix:** validate queued report targets against known rows and pending insert/hold IDs before returning success, or return an error naming the ID when validation cannot be completed. Specify a backlog unknown-ID fixture that checks the tool result as well as the store; retain the explicit report-before-stop hold for subagent runs.

2. **Moderate — a model-not-found live 404 is labeled as a missing endpoint.** `implementation-plan-part-a.md:287-295` says a live 404/405 can mean the named model is unavailable, yet unconditionally persists `unsupported-endpoint`, even when the control probe established that `/v1/systemone` exists. This can leave a misleading row until the next successful probe. **Required fix:** use the route discriminator before marking the endpoint unsupported, or keep a distinct model/provider failure state for route-specific 404/405 answers. Add a live model-not-found fixture.

## Anchors checked

| Cited anchor | Actual | Status |
| --- | --- | --- |
| `post-tool-use-hook-handler.ts:86,151-159` (SC-7) | `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:82-88,124-160` distinguishes main-thread calls and returns `additionalContext`; it can also return `updatedToolOutput`. The proposed tag can reach the model through the former. | OK |
| `subagent-hook-handler.ts:259-267,438-455,520-524` (SC-7) | `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:259-268` registers the callback tool-use ID with `agentId`; `:438-455` reverse-resolves it on stop; `:520-524` publishes the stop ID. | OK |
| `subagent-registry.service.ts:379,749` (SC-7) | `libs/backend/vscode-core/src/services/subagent-registry.service.ts:379-390` gets a record by tool call ID; `:749-760` finds a tool call by agent ID. | OK |
| `subagent-budget-monitor.ts:46-51,184` (SC-7) | `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:46-55` documents a PostToolUse notice reaching the spawning result and a user-turn fallback; `:184` names Agent and Task. | OK |
| `sqlite-connection.service.ts:450,479-486` (SC-10) | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:450,479` exposes `isOpen` and `onDidOpen`; the comment at `:474` says callers must check already-open state. | OK |
| `protocol-dispatcher.ts:1037` (AB9) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1037` is `switch (name)`. | OK |

## Decisions

| Judgement | Options | Evidence |
| --- | --- | --- |
| REVISE | Approve; revise | New finding 1 leaves Req 5.6 unmet in backlog mode (`implementation-plan.md:470-475`; `task-description.md:296-299`). |
| Accept the six prior fixes at plan level | Keep partial; mark fixed | The revised SC-7, SC-10, IA-5, and System One probe have concrete mechanisms and fixtures at the cited locations. The SDK declaration under `node_modules` was absent in this worktree, so I could not inspect its type or run the required IA-5 capture; the repo's hook and budget-monitor precedent support the mechanism. |
| Retain waves and scoped checks | Repartition; retain | `implementation-plan.md:610-668` keeps changed files disjoint within each wave and sequences B4 after B3, A13 after B3, AB9 after B10a, and AB14 after its wiring inputs. Checks target named Nx projects or Jest specs, use `--parallel=1` / `--maxWorkers=2`, and forbid workspace-wide, build, serve, and e2e runs. No verification command was run for this review. |
| No new shipped-capability removal | Request approval; rely on existing approval | Decision #41 removes only the plan's slug fallback (`decisions.md:45`); the shipped Agents-tab Success replacement already has user approval (`decisions.md:16`). Decisions #12, #13, #18 as amended by #22, and #19 remain final. |

