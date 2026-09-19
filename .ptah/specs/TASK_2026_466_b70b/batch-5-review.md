# Batch 5 Review — Backend Render Causes (Defects 3 and 5)

Reviewed by `code-logic-reviewer`. Scope: `agent-report-router.service.ts`, `agent-output-buffer.service.ts`, `agent-process-manager-helpers.ts`, and their specs in `libs/backend/cli-agent-runtime/src/lib/cli-agents/`.

## Verdict

`accept with fixes` — the turn-bucketing buffer architecture and envelope deduplication are sound and well-tested, but `markTurnBoundary` is not yet wired into `AgentProcessManager.continueConversation` (leaving the live defect open), and envelope deduplication does not handle trivial punctuation or casing differences.

## Findings

1. **`markTurnBoundary` is unwired at runtime; turn fusion remains unmitigated on live execution paths.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:122`, with the needed caller at `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1106`.
   - Failure scenario: When an agent continuation runs via `continueConversation` (e.g. On the ptah-cli mailbox lane or queued continuation), `sdkHandle.continue(message)` streams tokens into the same process without clearing the buffer. Because neither `AgentProcessManager.continueConversation` nor any other runtime service invokes `outputBuffer.markTurnBoundary(agentId)`, all segments continue to be pushed into the first and only bucket `pending.segmentTurns[0]`. When turn 1's tail tokens and turn 2's head tokens arrive within the same 200 ms flush window, `takeDelta` merges them into a single text segment. The live defect (`STEP2: doneQUEUED_ACK: codex received the queued message`) therefore still occurs until the caller is wired.
   - Severity: **medium**.
   - Fix: In `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1106`, call `this.outputBuffer.markTurnBoundary(agentId);` immediately before `outcome = await sdkHandle.continue(message);`. (Additionally consider stamping before `handle.steer(message)` at `agent-message-router.service.ts:133` if steered continuations should not fuse).

2. **Envelope deduplication compares trimmed exact strings, leaking near-duplicate text when summary differs only by trailing punctuation or casing.**
   - Location: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:348-352`.
   - Failure scenario: An agent reports back via `agent_report` with `summary: "Step 2: done."` and `message: "Step 2: done"` (or `summary: "Task complete..."` vs `message: "Task complete"`, or `summary: "STEP2: done"` vs `message: "Step 2: done"`). Because `trimmedSummary !== message.trim()` evaluates to `true`, `buildEnvelope` constructs the body as `trimmedSummary + "\n\n" + message`. The envelope `<agent-report>` contains near-identical text twice separated by a blank line, causing both the parent chat and the parent's LLM to receive redundant text.
   - Severity: **low**.
   - Fix: Normalize minor differences during redundancy checking (e.g. comparing after case-folding and stripping trailing punctuation such as `.`, `...`, `!`), while preserving the original `trimmedSummary` when a genuine difference exists.

## Claims I verified

- **The per-token merge still works within a turn.** In `AgentOutputBuffer.takeDelta`, each bucket in `pending.segmentTurns` is individually mapped through `mergeConsecutiveTextSegments(turn)`. When an agent streams token deltas within one turn without boundary stamps, all segments accumulate in `pending.segmentTurns[0]` and collapse into single text/thinking segments. This prevents 1-token-per-line markdown explosions. Verified by unit tests in `agent-output-buffer.service.spec.ts`.
- **Turn boundary mechanism separates turns without leaking synthetic markers.** `markTurnBoundary(agentId)` creates a bucket edge in `PendingDelta.segmentTurns: CliOutputSegment[][]` rather than injecting a sentinel segment into the stream. Downstream consumers (`delta.segments`, `tracked.accumulatedSegments`, and persistent storage) receive clean domain segments without synthetic artifacts.
- **Defensive bucket management prevents phantom turns.** `markTurnBoundary` guards against empty turns (`if (!current || current.length === 0) return;`), so double-stamping or stamping on a fresh buffer is a safe no-op. `takeDelta` resets `pending.segmentTurns` to `[[]]`, maintaining the invariant that at least one bucket always exists.
- **Ordering and exit flushing.** In `AgentProcessManager.handleExit`, `flushDelta(agentId)` is invoked before `outputBuffer.discard(agentId)`. `flushDelta` invokes `takeDelta`, which merges all pending buckets per-turn and emits them via `agent:output`. Nothing is dropped on the exit path. Synchronous boundary stamping before `sdkHandle.continue` guarantees boundary markers cannot arrive out of order with respect to turn segments.
- **Redundant summary suppression in `AgentReportRouter.buildEnvelope`.** When `summary` equals `message` (or differs only by leading/trailing whitespace), `summaryAddsInformation` evaluates to `false` and only `message` is rendered inside the `<agent-report>` XML envelope. This stops the double-rendering defect when callers pass identical summary and message.
- **Blast radius is strictly contained.** `mergeConsecutiveTextSegments` in `agent-process-manager-helpers.ts` is only referenced within `agent-output-buffer.service.ts:208`. It is not exported in the library barrel `src/index.ts` and no other backend caller was affected. The frontend uses its own decoupled implementation in `agent-card.utils.ts`.

## Claims I could not verify

- **Live end-to-end multi-turn separation on real CLI processes.** Because `markTurnBoundary` is not yet called by `AgentProcessManager.continueConversation`, live multi-turn execution on real CLI lanes could not be verified on this branch.
- **Turn boundary semantics under mid-turn steering.** Under `AgentMessageRouter.select`, steering calls `handle.steer(message)` without passing through `continueConversation`. Whether mid-turn steer should start a new turn boundary or continue fusing with in-flight output depends on product intent and was not verified.
