# Code Logic Review — `TASK_2026_656_reviews` (PR #722)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The sibling heuristic fixes the stated callout case for a normally ordered, completed text block. The adjacent 7–8 band would require stable rendering through finalization and an explicit answer for late deltas; the adjacent 3–4 band would require a likely wrong-content or data-loss path, which this review did not find.

## Five logic questions

### 1. How does this fail silently?

An earlier Mermaid text child becomes eligible at `execution-node.component.ts:379` and `:612-618` without any error, then silently falls back to ordinary markdown when `isFinalizing` becomes true (`:207-225`, `:616`). A late delta to an earlier block silently takes the full `<markdown>` path for every update (`:539-543`, `:253-255`).

### 2. What user action produces unexpected behaviour?

Watch an answer containing a Mermaid fence followed by a tool or other child, then wait for the turn to finish. The diagram can appear, disappear for the finalization hold, and reappear (`execution-node.component.ts:379-380`, `:612-618`; `chat-transcript.component.ts:777-794`).

### 3. What input data produces a wrong answer?

No lasting wrong markdown content was established. A text delta addressed to an earlier block after a later child exists is accepted by the transformer and accumulator (`stream-event.transformer.ts:461-477`; `accumulator-core.service.ts:297-324`) and is displayed by a full parse, but the intermediate Mermaid/ptah-ui representation may be treated as finalized before that delta arrives (`execution-node.component.ts:602-618`).

### 4. What happens when a dependency fails?

The incremental renderer catches parse/sanitize failures and eventually reports `failed` (`streaming-markdown-renderer.ts:45-80`, `:83-92`); the execution node logs once and keeps a raw tail (`execution-node.component.ts:578-594`). The early settled path bypasses that incremental fallback and hands the value to `<markdown>` (`:253-255`). Lazy ptah-ui and Mermaid load errors fall back to `<markdown>` (`:197-225`). This change adds no new dependency failure handling.

### 5. What is missing that the requirements never mentioned?

The rule needs a stable block-completion signal or an explicit contract that no earlier block receives deltas after a sibling appears. The tree's text status is always `complete` (`message-node.fn.ts:144-152`), the accumulator still appends by block index (`accumulator-core.service.ts:311-322`, `:833-840`), and the SDK's `content_block_stop` is discarded (`stream-event.transformer.ts:96-97`). It also needs a Mermaid finalization transition check; the new test only checks a static pair of synthetic children (`execution-node.streaming-dom.spec.ts:215-253`).

## Failure modes

### Mermaid diagram churn at turn completion — Serious

- Trigger: A non-last text child contains a Mermaid fence while the message streams.
- Symptom: The diagram mounts before the turn ends, is replaced by markdown during the 300 ms finalization hold, then mounts again. This produces visible flicker and repeats diagram setup.
- Evidence: `execution-node.component.ts:379-380`, `:207-225`, `:612-618`; `chat-transcript.component.ts:777-794`.
- Current handling: `mermaidHost` requires `!isNodeStreaming()` and `!isFinalizing()`. The new sibling condition satisfies the first requirement early, while the finalization signal later reverses the second.
- Recommendation: Preserve a mounted Mermaid host through the finalization handoff, or defer Mermaid activation until that handoff finishes while still rendering completed ordinary markdown.

### Late deltas cause repeated full parses — Moderate

- Trigger: A `text_delta` for block N arrives after a later sibling has been inserted or sorted after it, including an interleaved or replayed event sequence.
- Symptom: The child stays on `<markdown>` and reparses/sanitizes the whole accumulated block on each delta; a long block growing one small delta at a time has quadratic aggregate parse work and can visibly replace its DOM. The text itself remains current.
- Evidence: `message-node.fn.ts:79-89`, `:144-152`; `stream-event.transformer.ts:461-477`; `accumulator-core.service.ts:311-324`, `:833-840`; `execution-node.component.ts:379`, `:487-489`, `:539-543`, `:253-255`, `:491-501`.
- Current handling: A later sibling is used as the sole completion proxy. The builder never changes a text node's status from streaming to complete because it creates text nodes as `complete` from the outset; the accumulator does not reject a late delta.
- Recommendation: Preserve the frame-throttled incremental path while content can grow, using explicit block-stop state where available or a bounded fallback for streams without it; add a test that appends to the earlier child after the sibling appears.

## Blocking issues

None found in the changed files and traced paths.

## Serious issues

- Mermaid diagram churn during finalization: `execution-node.component.ts:612-618` and `:379-380`; visible flicker for users receiving Mermaid followed by another child. Fix as described above.

## Moderate and minor issues

- Conditional repeated full markdown work on late deltas: `execution-node.component.ts:539-543`, `:253-255`, `:379`; impacts long interleaved blocks. The new spec does not update its first child after insertion (`execution-node.streaming-dom.spec.ts:215-253`).

## Data flow

1. SDK content-block deltas retain their block index (`stream-event.transformer.ts:461-477`); block-stop is discarded (`:96-97`). **Gap:** no authoritative completion state survives.
2. The accumulator appends text per message and block index (`accumulator-core.service.ts:311-324`, `:833-840`). **OK:** later deltas can update an existing block.
3. The tree builder reads the current accumulator, marks each text node `complete`, and sorts it with thinking and tools by start time (`message-node.fn.ts:79-89`, `:144-152`). **Gap:** child position and status do not prove content closure.
4. The message template suppresses `isStreaming` for non-last text (`execution-node.component.ts:375-383`); `isNodeStreaming` ORs that input with node status (`:487-489`). **Gap:** it can settle early.
5. The settled branch renders full `<markdown>` or activates ptah-ui/Mermaid (`execution-node.component.ts:177-255`, `:602-618`). **Gap:** late updates incur full work and Mermaid can toggle during finalization.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Earlier text with a later sibling renders through settled markdown | COMPLETE for plain markdown | The new DOM spec checks this static case (`execution-node.streaming-dom.spec.ts:215-253`). |
| Keep growing text responsive and avoid repeated full parses | PARTIAL | Sibling position is not a closure guarantee (`message-node.fn.ts:144-152`; `accumulator-core.service.ts:311-322`). |
| Keep finalization visually stable | PARTIAL | Mermaid host can toggle across the hold (`execution-node.component.ts:612-618`; `chat-transcript.component.ts:777-794`). |

Implicit requirements not addressed: explicit handling of late deltas, a Mermaid transition test, and a builder-produced test fixture rather than only cast literals (`execution-node.streaming-dom.spec.ts:216-237`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty or null text | YES | `content ?? ''` in the render effect (`execution-node.component.ts:529-530`). | None found. |
| Later sibling with no further delta | YES | Earlier text switches to settled rendering (`execution-node.component.ts:379`, `:253-255`). | Intended callout case. |
| Late delta to earlier text | PARTIAL | Accumulator and rendered content update (`accumulator-core.service.ts:311-322`; `execution-node.component.ts:539-543`). | Full parse per update. |
| Mermaid followed by another child | NO | Early activation, then finalization gate (`execution-node.component.ts:612-618`). | Flicker/remount. |
| Restore/replay | PARTIAL | A settled node publishes immediately (`execution-node.component.ts:539-543`). | No new replay-specific failure established; no regression test for altered child order. |
| Parse failure | YES for incremental path | Raw tail and one log after repeated failure (`streaming-markdown-renderer.ts:58-80`; `execution-node.component.ts:581-594`). | Early settled path uses the existing `<markdown>` dependency. |

## Verification and limits

Read the complete two-file PR diff and both changed files, plus the message/tool builders, index, accumulator, SDK transformer, streaming renderer, ptah-ui and Mermaid hosts, and the finalization signal. The scoped Jest command `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/execution/execution-node.streaming-dom.spec.ts --coverage=false --maxWorkers=2` passed (8 tests). Scoped diagnostics reported no errors in either changed file, with unrelated sibling-file errors. The passing test demonstrates the static callout branch only; no test in that suite exercises post-sibling deltas or Mermaid finalization (`execution-node.streaming-dom.spec.ts:215-253`). No build or workspace-wide check was run.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for Mermaid churn, MEDIUM for the frequency of late deltas
- Top risk: Early Mermaid activation is undone by the existing finalization gate, creating an avoidable visible remount (`execution-node.component.ts:612-618`; `chat-transcript.component.ts:777-794`).
- What a robust implementation would add: a stable block-completion contract where possible, a safe path for late deltas, and a transition test covering Mermaid plus a later sibling.
