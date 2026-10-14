# Code Logic Review — `TASK_2026_656_reviews` (PR #722, e7c9a2fd0)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

The changed path settles earlier text without changing its turn-level streaming input (`execution-node.component.ts:375-384`, `:499-503`). This resolves the prior Mermaid remount: the host remains gated by turn completion and the finalization hold (`execution-node.component.ts:626-633`; `chat-transcript.component.ts:777-794`). A late update is displayed immediately (`execution-node.component.ts:543-558`, `:582-591`), although repeated nonconforming late updates can still cause full markdown renders. The 7–8 band fits because the intended path and previously reported visible defect are covered, while the absence of a block-stop contract and a real Mermaid transition test keep this below 9–10. The 5–6 band would require an established likely user-visible failure, which this trace did not find.

## Five logic questions

### 1. How does this fail silently?

No silent incorrect-content result was established. A late update to a text child already marked closed is published to `<markdown>` on the same change-detection cycle (`execution-node.component.ts:543-558`, `:582-590`, `:252-255`). Repeated such updates can silently cost a full render each time, but the Responses translator closes an existing text block before starting a tool block and allocates a new index for subsequent text (`responses-stream-translator.ts:422-439`, `:570-579`, `:625-640`). This is a residual cost for abnormal or replayed ordering, not an observed normal-path defect.

### 2. What user action produces unexpected behaviour?

No likely action in the reviewed path now does. Watching Mermaid text followed by another child leaves the Mermaid host off while `isStreaming` remains true; it can mount only after the turn and finalization hold end (`execution-node.component.ts:379-381`, `:488-489`, `:626-633`; `chat-transcript.component.ts:777-794`). The prior visible mount–unmount–mount transition is removed.

### 3. What input data produces a wrong answer rather than an error?

None established. The tree can append a delta to an earlier block because the accumulator keys by block index (`accumulator-core.service.ts:297-324`, `:833-840`), and the new spec confirms the revised content reaches `renderedContent` (`execution-node.streaming-dom.spec.ts:268-274`). The spec uses a markdown stub, so it proves propagation and branch choice, not rendered HTML accuracy (`execution-node.streaming-dom.spec.ts:10-29`).

### 4. What happens when a dependency fails, times out, or returns a wrong shape?

The revised closed-text branch uses the existing `<markdown>` component (`execution-node.component.ts:252-255`). Its lazy Mermaid and ptah-ui branches retain markdown placeholders and error fallbacks (`execution-node.component.ts:177-225`). The incremental renderer catches parse/sanitize exceptions, reports repeated failure, and leaves a plain-text tail (`streaming-markdown-renderer.ts:45-80`, `:83-92`; `execution-node.component.ts:593-609`). The new input adds no external dependency or asynchronous operation.

### 5. What is missing that the requirements never mentioned?

An authoritative text-block closure signal is still absent: SDK `content_block_stop` is discarded, and tree text nodes are created with `complete` status regardless of future deltas (`stream-event.transformer.ts:96-97`; `message-node.fn.ts:144-152`). A full turn-end transition test, including the real Mermaid host, would increase confidence beyond the current static streaming assertion (`execution-node.streaming-dom.spec.ts:261-266`). Neither omission causes a demonstrated failure in this fix.

## Failure modes

No material failure mode found in this revision. The normal text/tool sequence is bounded by block closure in the Responses translator (`responses-stream-translator.ts:570-579`, `:625-640`); the SDK transformer and accumulator could accept an out-of-order late delta (`stream-event.transformer.ts:461-477`; `accumulator-core.service.ts:311-324`). In that unusual case the display remains current, but each changed value takes the full `<markdown>` path (`execution-node.component.ts:252-255`, `:543-558`, `:582-590`). This conditional performance risk was the previous moderate finding; the new test addresses correctness, not render frequency (`execution-node.streaming-dom.spec.ts:268-274`).

## Blocking issues

None found in the changed rendering path (`execution-node.component.ts:237-255`, `:375-384`, `:488-504`, `:543-633`).

## Serious issues

The earlier Mermaid churn is resolved: `isStreaming` remains true on the child while the turn runs, and `mermaidHost` also waits for `!isFinalizing()` (`execution-node.component.ts:379-381`, `:626-633`). No new serious issue found.

## Moderate and minor issues

No material moderate issue established. The late-delta test does not measure repeated render work or actual HTML (`execution-node.streaming-dom.spec.ts:10-29`, `:268-274`); this limits confidence but does not demonstrate a normal-path regression. The residual full-render cost is recorded above.

## Data flow

1. SDK text deltas retain block index; stop events do not enter the execution tree (`stream-event.transformer.ts:461-477`, `:96-97`). **OK for normal ordering; residual closure ambiguity.**
2. The accumulator appends by message and block index, and the builder sorts text, thinking, and tool children (`accumulator-core.service.ts:311-324`; `message-node.fn.ts:79-89`, `:144-152`). **OK: a late update remains visible.**
3. The message passes turn-level `isStreaming` unchanged and marks only non-last text as `textClosed` (`execution-node.component.ts:375-384`). **OK: host timing stays turn-based.**
4. Closed text publishes its exact current content immediately to `<markdown>` while open text still uses the incremental path (`execution-node.component.ts:237-255`, `:499-503`, `:543-570`, `:582-609`). **OK for the callout; conditional full-render cost on late deltas.**
5. Mermaid waits for streaming and finalization to end; lazy host errors fall back to markdown (`execution-node.component.ts:207-225`, `:626-633`). **OK: prior remount path removed.**

## Requirements fulfilment

| Requirement | Status | Evidence / limit |
| --- | --- | --- |
| Earlier text with a later sibling uses settled markdown | COMPLETE | `execution-node.component.ts:237-255`, `:375-384`; `execution-node.streaming-dom.spec.ts:251-259`. |
| Keep Mermaid and ptah-ui on turn-level timing | COMPLETE | `execution-node.component.ts:379-381`, `:617-633`; Mermaid streaming assertion at `execution-node.streaming-dom.spec.ts:261-266`. |
| Preserve a late update's content | COMPLETE | `execution-node.component.ts:543-558`, `:582-590`; `execution-node.streaming-dom.spec.ts:268-274`. |
| Bound render work for malformed late deltas | PARTIAL | Full immediate publish remains at `execution-node.component.ts:554-558`; ordinary producer closes the block at `responses-stream-translator.ts:625-640`. |

Implicit requirement still worth recording: authoritative block closure or an explicit bound on abnormal interleaving (`stream-event.transformer.ts:96-97`; `message-node.fn.ts:144-152`).

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Empty/null text | YES | Normalized to `''` at `execution-node.component.ts:543-545`. |
| Later sibling while turn streams | YES | Closed branch selected at `execution-node.component.ts:237-255`, `:375-384`. |
| Late delta to earlier text | YES for content | Immediate publish at `execution-node.component.ts:554-558`; repeated abnormal updates incur full renders. |
| Mermaid followed by another child | YES | Host gated at `execution-node.component.ts:626-633`. |
| Hidden surface/cancellation | YES | Pending frame is cancelled and generation advanced at `execution-node.component.ts:546-551`, `:574-579`. |
| Renderer parse failure | YES for incremental branch | Plain tail and warning at `streaming-markdown-renderer.ts:45-92`; `execution-node.component.ts:593-609`. |

## Verification and limits

Read both changed files in full, their commit diff, the previous review, root instructions, the streaming renderer, message builder, accumulator and transformer paths, the Responses translator, and the finalization signal. No task/context/plan/style review files were present in the review folder beyond the previous logic review. Scoped Jest passed: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/execution/execution-node.streaming-dom.spec.ts --coverage=false --maxWorkers=2` (10 tests). Scoped diagnostics reported no errors in either changed file; unrelated sibling-file errors remain. No build or workspace-wide check was run. The Mermaid test checks only the streaming half of its transition (`execution-node.streaming-dom.spec.ts:261-266`), so the final mount behavior is inferred from the host gate (`execution-node.component.ts:626-633`).

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH
- Top risk: Repeated out-of-order late deltas to a closed text child trigger full markdown work (`execution-node.component.ts:252-255`, `:554-558`).
- What a robust follow-up would add: preserve block-stop state in the tree and test the full Mermaid turn-end transition (`stream-event.transformer.ts:96-97`; `execution-node.streaming-dom.spec.ts:261-266`).
