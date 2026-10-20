# Implementation plan review

Verdict: REVISE

Score: 5/10. The plan traces the present duration and routing bugs and identifies workable entry points, but its proposed restore and merge algorithms lose required content. This is above a 3–4 because the live routing and persistence seams are concrete; below a 7–8 because the two loss cases affect the central Phase B promise.

## Claim checks

| Plan claim | Result | Code evidence |
| --- | --- | --- |
| CLI lane uses the flat agent card (56) | VERIFIED | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:107-112` |
| Subagent lane reads a node in the main tree (57–58) | VERIFIED | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:144-171,245-257` |
| Builder currently excludes child messages as roots (59) | VERIFIED | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:314-322` |
| A separate accumulator state can use `onStateChanged` (62) | VERIFIED | `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:63-85` |
| The backend publishes events before the turn-complete gate (64–65) | VERIFIED | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:262-296` |
| The existing broadcaster gate is reset by any message start (65) | VERIFIED | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:269-284` |
| The existing history replay produces structured text and tool events (67) | VERIFIED | `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:518-580` |
| Existing replay preserves all structured blocks, including thinking, for the new reader (30–37, 340–363) | WRONG | `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:528-581` only emits text and tool-use blocks; thinking has no branch. |
| SDK subagent file discovery searches the nested directory, then legacy flat files (67–68) | VERIFIED | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:813-847` |
| Workflow agent logs have a separate locator (68) | VERIFIED | `libs/backend/agent-sdk/src/lib/helpers/workflow-transcript-reader.ts:45-79` |
| Restored CLI agents lack a stored end time and can tick as lane age (75) | VERIFIED | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1708-1736`; `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:157-164` |
| The CLI process has an ISO `completedAt`, but the reference lacks it (76–77) | VERIFIED | `libs/shared/src/lib/types/agent-process.types.ts:124-133,502-533`; `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:422-441` |
| Existing reference restore passes an additive end-time field (77) | VERIFIED | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:381-397` spreads retained fields. |
| Subagent roster currently has no timestamps (74) | VERIFIED | `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:130-148` |
| A new `subagent:` RPC fits the prefix allowlist (87) | VERIFIED | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:85`; current registration is `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:83-119`. |
| The generated baseline guard examines only host-source-shaped names (89) | VERIFIED | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-55` |
| Proposed batches are file-disjoint (659) | WRONG | The plan itself assigns `agent-card.component.ts` and `session-agent-roster.ts` to both A1 and A3 (193,196,280,283,675–676), and `agent-monitor.store.ts` to A1 and B7 (198,573,672). Sequential execution avoids a simultaneous conflict but does not make the batches file-disjoint. |

## Coverage

| Requirement / observed defect | Plan coverage | Assessment |
| --- | --- | --- |
| 685: one header, one action place, no unapproved information loss | 223–320, 546–576 | Covered in the lane design; P1/P2 remain user-reserved. |
| 685: consistent status word and duration in lane, chip, hover, inspector | 149–187, 223–278 | Covered; the proposed duration rule correctly returns no lane age for a finished run with no end. |
| 685: persist real CLI end time after restart | 200–221 | Covered end to end: `AgentProcessInfo.completedAt` → `CliSessionReference.completedAt` in the exit writer → metadata `cliSessions` → `loadCliSessions` epoch mapping → card/roster/inspector readers. Existing writer and reader: `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:201-213,422-441,475-476`; `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:381-397`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1695-1736`. The new field needs a terminal-write regression with an older reference. |
| 685: dark/light before/after at 1440 and 760 | 664–672, 747–748 | Covered as handoff, not yet verified by this read-only review. |
| 633: pending identity and correct toolCallId/agentId | 394–402, 421–447 | Partly covered; missing agentId finishes in an empty state even when an SDK log exists (finding 4). |
| 633: text, tools, results after parent result/new turn | 324–336, 394–415, 470–488 | Covered in live path; root-only broadcaster gate is necessary. |
| 633: bounded session-scoped retention, truncation, distinct error/wait/empty | 407–423, 445–462, 499–502 | Mostly covered; a pinned/running-entry count bound and abort behavior are unspecified (finding 5). |
| 633: history backfill and snapshot/live order/repeated deltas | 338–386, 421–431 | Incomplete: overlap can lose a message prefix (finding 2). |
| 633: tray chip opens/focuses execution | 43–45, 82, 513–517 | Existing chip is said to have been replaced; inspector AGENTS row/lane tabs are covered, but the original tray-chip acceptance needs an explicit disposition. |
| Visual proof: 74h restored CLI age; subagent 3ms/0ms | 149–221 | Covered by finished-run rule and subagent timestamps. Capture evidence: `screenshots/capture-report.md` defects 1–2 in the visual-proof worktree. |
| Visual proof: duplicate badges/headers/usage/parent and transcript workarounds | 223–320, 532–576 | Covered by parity inventory and approved removals. |
| Visual proof: light code block, 760 navigation clipping, stale restored running | 766–781 | Recorded as separate defects, outside the stated 685/633 scope. Stale restored running can still mislabel a header. |

## Findings

1. **Serious — historical trees omit thinking blocks.** Plan 30–37 and 356–363 say the SDK JSONL is already a full structured source and that the new method reuses `processAgentMessages`; plan 107 and 496–517 promise the same execution renderer for restored agents. The existing converter only branches on `text` and `tool_use` (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:528-581`). A restored subagent that produced thinking renders a plausible but incomplete tree with no error. **Fix:** explicitly convert supported thinking blocks and their order, and test a JSONL fixture containing thinking, text, tool call and result against the restored tree.

2. **Serious — snapshot/live merge drops the start of an in-flight message.** Plan 424–428 chooses either the whole snapshot message or the whole live message and uses a timestamp cut when IDs differ; plan 775–776 acknowledges that a message spanning subscription can be dropped. Live message IDs can remain synthesized even after the SDK reports the real ID (`libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:204-216`); live timestamps are stamped with `Date.now()` (`:181-190`), while existing replay invents timestamps near the parent message (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:513-529`). Thus an agent already writing when a lane opens can lose its prefix or appear twice, violating 633's snapshot/live acceptance. **Fix:** define a per-message reconciliation using stable SDK identity plus block/event offsets or a complete-message replacement rule that preserves the pre-subscription prefix; test an ID mismatch and a stream started before the first history page returns.

3. **Serious — “whole messages under maxBytes” has no oversized-message path.** Plan 364–375 requires each page to contain whole messages while also imposing a 256 KB response cap. The converter emits a single text block from the entire JSONL text block (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:531-542`); the reader accepts files up to 50 MB (`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:113-118`). A single message above 256 KB cannot fit any page, so the plan leaves the cursor stuck, drops content, or breaks its cap. **Fix:** specify chunking within a message with stable continuation/cursor semantics, or an explicit capped/truncated event that advances the cursor; test a single oversized text/tool-result message.

4. **Moderate — a missing agent ID is presented as “No output recorded.”** Plan 421–423, 445–447 requires `record.agentId` for history and maps a finished record without it to an empty display. The record intentionally allows `agentId?` and documents that only `agent_start` supplies it (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:531-545`). An agent whose start was missed can have a valid saved log but looks empty after restart. **Fix:** retain an unresolved-identity state distinct from true empty; add a correlation/retry path from Task tool ID to SDK agent ID where possible.

5. **Moderate — retention and cancellation are underspecified.** Plan 416–423 allows all running and mounted entries to remain pinned, and plan 450–456 calls the store bounded. The existing state cap only limits `events` within one state (`libs/frontend/chat-types/src/lib/chat-types.ts:259-303`); it does not bound the number of states. Plan 432 and 480–482 clear sessions but do not specify how an in-flight `ensureHistory` is prevented from committing after a clear, eviction or view close. **Fix:** specify a count/byte policy for pinned and abandoned running entries, plus a generation token or cancellation check before every page/merge commit.

6. **Moderate — the batch handoff contradicts its file-disjoint promise.** Plan 659 and 675–676 acknowledge shared A1/A3 files despite calling the batches file-disjoint; `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:157-164` and `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:130-148` are the shared implementation points. Plan 681–682 also assigns the restore mapping to A1 but says A2 acceptance includes that mapping. **Fix:** assign each physical file to one batch or explicitly call these serial edits with handoff ownership, and align each batch's acceptance with its file list.

7. **Minor — verification handoff omits one named DI guard and leaves Electron conditional.** Plan 736–743 names VS Code `rpc-surface`, `surface-composition`, `container.smoke`, then says Electron `rpc-surface` only “if present.” The current method is registered in `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:83-119`, and the allowed prefix is host-wide (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:85`). **Fix:** enumerate the four required DI guard specs by exact path after checking the app trees; run them only in the affected hosts. No checks were run here by instruction.

### Failure-mode answers

1. **Silent failure:** missing historical thinking (finding 1) and a finished record with no agent ID (finding 4) both look like ordinary output/empty output.
2. **User action:** opening a subagent lane during an active message starts history backfill and triggers the overlap defect (finding 2).
3. **Wrong answer from valid data:** a JSONL message with thinking or a mid-message snapshot/live overlap yields a believable but incomplete transcript (findings 1–2).
4. **Dependency failure/shape:** a missing JSONL file is intentionally empty (plan 370–373); parse/read errors are distinct, but an oversized single message has no defined page result (finding 3).
5. **Missing requirement:** count and cancellation bounds for multiple active/pinned agents, and a recovery path for an absent agent ID (findings 4–5).

## Removals and clarifications

| Item | Inventory support and recommendation |
| --- | --- |
| P1 / clarification 1 | Supported: the walker recurses through agent children (`libs/frontend/chat/src/lib/utils/message-summary.utils.ts:83-104`), so moving children changes turn counts. Recommend parent-only counts, as the plan does, provided the lane shows subagent counts. This is a user-facing semantic choice, not decided here. |
| P2 / clarification 2 | Supported: the bubble immediately stamps `node().children` (`libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:450-464`). Recommend explicit “Load agent output” to preserve memory, with an accessible loading/error state and a clear note that the visible output is incomplete until loaded. Do not treat it as approved. |
| P3 / clarification 3 | Supported: the parallel summary path remains distinct from the transcript path (plan 85, 589); keeping it is the safer recommendation until Phase B proves parity. It must not create duplicate visible text after the tree is mounted. |
| P4 | Supported: the generated baseline contains `subagent:transcript` (`libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:357-361`) while the guard filters only host-source names (`libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-55`). Recommend leaving it for a separately authorized baseline regeneration and documenting the stale line. |

## Lane-introduced constraints

- The plan chooses a 30 px header, exact label grammar, extra metadata inputs and a single projected action slot (223–249); the tasks ask for one structure, not these exact API or pixel choices.
- It imposes 2,000 live events, 20 finished trees, 4,000 owner IDs, five history pages and 256 KB pages (364–375, 407–420). Those limits need tests and a visible truncation contract; 633 only asks for bounded retention.
- It requires restored main-chat bubbles to load output on click and forbids per-item observers/timers (507–520); P2 remains user-reserved.
- It preserves `agent:summary-chunk` and leaves the generated baseline stale (589–590, 764–765); neither task required those implementation constraints.
- It makes “no file” equivalent to an empty successful history response (370–373); this conflates missing retained data with a genuinely empty agent unless the view labels it explicitly.

## Decisions

- **Review verdict: REVISE.** Options were approve or revise; findings 1–3 affect required history fidelity and 633's race guarantee. Reversible: yes, by revising the plan before implementation.
- **Duration path is acceptable as planned.** Options were preserve lane-age behavior or persist the terminal ISO end and share one rule. The existing writer, metadata pass-through and restored reader support the latter (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:201-213,422-441`; `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:381-397`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1695-1736`). Reversible: yes.
- **User-reserved P1–P3 and P4 were not decided.** Recommendations above are review advice only.

Review method: targeted plan/task/context/visual-proof reads and code inspection. No source edits, git operation, tests, typecheck, lint, build, serve or e2e. The `ptah_code_search_symbols` index returned zero symbols with unknown coverage, so the cited source checks used targeted reads and one native search fallback. Remaining uncertainty: no runtime proof of the proposed algorithms or cross-host guard results.
