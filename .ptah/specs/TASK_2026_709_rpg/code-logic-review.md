# Code logic review — TASK_2026_709_rpg (ptah-cli repeat-call guard fix)

Review family: Glm (ptah-cli) reviewing codex
Date: 2026-10-20
Diff under review (uncommitted, branch `fix/ptah-cli-repeat-guard`):

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts`

**Score: 7/10 — Verdict: REVISE** (equivalent: NEEDS_REVISION)

The fix is correct on every verified happy path and the de-duplication design is
sound. The streamed `tool-call` segment now carries parsed `toolInput`,
`toolCallId` and `toolArgs`, so `LaneBudgetGuard.callKey`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts:155-163`)
keys distinct calls distinctly — the reported `repeat-call` false positive is
gone on the normal path. What keeps this out of the 8-9 band: the new
failure-path flush is untested and emits degraded data (defect 1), the id link
was completed on only one side of the tool pair (defect 2), and the one
behaviour that regressed on malformed input is unconfirmed (defect 4).

Evidence: full read of both changed files; full read of `lane-budget-guard.ts`;
`agent-process-manager.service.ts` guard wiring (`:926-941`, `:1035-1050`,
`:1134-1146`); `agent-monitor-tree-builder.service.ts:345-418`;
`agent-output-retention.ts:195-214`; `agent-spawn-environment.service.ts:42-45`;
`summarizeToolInput` in `ptah-cli-registry.utils.ts:71-91`. Test run (allowed
command): 7 suites, 94 tests, all pass.

---

## Defects

### 1. MODERATE — the `finally` flush emits empty-input `tool-call` segments after an error or abort, and after the error segment

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:644-650`
(the `finally` flush), with the fallback at `:265-276`.

When the stream throws or is aborted while a tool block is pending (no
`content_block_stop`), `flushPendingToolCalls()` emits the call with
`toolInput` = the start block's input. In streaming, that input is `{}` — the
exact empty payload the fix was made to remove. Consequences, all reachable on
the failure path only:

- **Guard key collision.** Every degraded call of one tool name produces the key
  `Tool\x00{}` in `LaneBudgetGuard.callKey`
  (`lane-budget-guard.ts:155-163`) — the same shape as the original bug. A
  parallel block of same-name tool calls cut mid-input flushes N colliding
  segments at once. With the default `repeatAt: 20`
  (`agent-spawn-environment.service.ts:45`) this is not reachable; with a
  configured low threshold (5 in the tested range,
  `agent-spawn-environment.service.spec.ts:141-146`) a single aborted parallel
  group can ask for a `repeat-call` stop the lane did not earn. `reset()` per
  turn bounds the accumulation to one turn.
- **Order inversion.** The catch at `:629-643` emits `[Error: ...]` (output and
  error segment) before `finally` flushes, so the tile shows the error first and
  the tool line after it. `tool-call` is a landmark type preserved on cap
  (`agent-output-retention.ts:206-214`), so the inversion persists in the card.
- **Stuck tree node.** The late segment reaches
  `agent-monitor-tree-builder.service.ts:348-372`, which creates a
  `status: 'streaming'` tool node. The tool never executed (the model was still
  streaming its input), no `tool-result` will ever pair with it, and the node
  stays `streaming` in a stopped lane's tree.

Concrete fix: (a) call `flushPendingToolCalls()` at the top of the catch block
(`:630`, before the error `emitOutput`/`emitSegment`) so tool lines precede the
error; (b) when the joined fragments fail to parse, emit
`toolInput: { __unparsed: <joined fragments, length-capped> }` instead of the
start input, so degraded calls keep distinct guard keys; skip the segment
entirely when both fragments and start input are empty — a segment with no
arguments carries no information the guard can distinguish.

### 2. MODERATE — `tool-result` segments still carry no `toolCallId`, so the new ids pair nothing for ptah-cli

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:549-561`.

The user-message branch emits `tool-result` / `tool-result-error` segments
without `toolCallId` (the SDK `tool_result` block carries `tool_use_id`, which
the handler ignores). The tree builder's id pairing
(`agent-monitor-tree-builder.service.ts:383-385`) can therefore never match a
ptah-cli result to the call the fix now tags (`:369-371`); pairing stays on the
FIFO fallback (`:386-393`), which mis-pairs when a lane resolves parallel calls
out of order. The fix completed one side of the id link only. This is a
pre-existing gap, but the fix's stated purpose — make each call distinguishable
downstream — is half done.

Concrete fix: pass `block.tool_use_id` (and the tool name where the stream
carries it) into the result segments at `:549-561`.

### 3. MODERATE (test gap) — no spec exercises the failure/abort flush, the riskiest new behaviour

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts:294-419`
(the new `describe` block).

The five new tests cover the streamed happy path, the invalid-JSON fallback at
`content_block_stop`, the unstopped block at stream end, and the non-streamed
assistant call. None covers: the catch path (error segment vs flushed
tool-call order), the abort path (no error segment, flush still emits), the
result-path flush at `:568`, or the multi-turn clear of `emittedToolSegments`
at `:608`. Defect 1 lives exactly in the untested path.

Concrete fix: add a test that throws mid-tool-call and asserts segment order and
content; add a two-turn test asserting a turn-2 call with a turn-1 id is not
suppressed (the `:608` clear) and that a turn-1 id cannot re-emit after a
result.

### 4. Failure mode (low) — a second `content_block_start` at the same index silently discards the first pending call

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:450-455`.

`pendingToolArgs.set(event.index, ...)` overwrites any unflushed entry at that
index. The old code emitted a segment at the first start, so even a malformed
stream reported both calls; the new code reports only the second (guard
undercount, lane activity hidden). Per-message indices and the
assistant/result flushes make the realistic window small — this needs a
protocol-violating stream. Unconfirmed reachable; recorded as a failure mode,
not a counted defect.

Concrete fix: in the start branch, if an unflushed entry exists for the index,
emit it before overwriting.

---

## Answers to the requested checks

### Q1 — is every tool call emitted exactly once?

Verified yes on all normal orders; one degraded single emission on an abnormal
order:

- **Streamed** (`content_block_stop` emits, assistant message follows):
  `emitPendingToolCall` deletes the map entry at `:263` before emitting, so the
  assistant-message flush at `:484` finds an empty map, and the block loop at
  `:494` skips the id already in `emittedToolSegments`. Spec proves it
  (`service.spec.ts:326-352`).
- **Non-streamed** (assistant message only): emits at `:493-510`, adds the id.
- **Assistant before `content_block_stop`** (abnormal order): the flush at
  `:484` emits once with whatever fragments arrived; the later stop is a no-op
  (entry deleted), later deltas drop silently (`:470-473`). Single emission,
  degraded arguments — acceptable, not double.
- **Multiple tool blocks per message**: the map is keyed by block index;
  spec `:355-366` covers two calls in one message.
- **Multiple turns**: `emittedToolSegments.clear()` at `:608` runs per result;
  tool ids are unique per call, so the clear cannot enable a re-emit and only
  bounds memory. No spec covers this (defect 3).
- **Error/abort through `finally`**: no double emission — `:263`'s delete makes
  the stream-end flush at `:627`, the result flush at `:568` and the `finally`
  flush at `:645` idempotent per entry. Emission after the lane stopped is
  possible and is defect 1's ordering half.

### Q2 — does anything rely on the old timing or the old `receivedTextDeltas` gate?

- **`LaneBudgetGuard.isNewCall`** (`lane-budget-guard.ts:123-134`) returns true
  for every `tool-call` segment and remembers ids only for `command` segments.
  The fix's `emittedToolSegments` set is therefore the only double-count guard,
  and Q1 verifies it holds. The budget count per call shifts from
  `content_block_start` to `content_block_stop` — a delay of one input-JSON
  delta burst; no consumer keys on the old start timing.
- **`receivedTextDeltas`**: still gates text blocks (`:489`), correctly. Its old
  use for tool blocks was itself wrong in both directions: a streamed tool call
  with no text in the same message re-emitted at the assistant message (the
  pre-fix double count), and a message with text deltas but unstreamed tool
  blocks suppressed real calls (guard undercount). The id set fixes both.
- **Stream events**: `tool_start` events from the transformer and their
  `emittedToolCallIds` de-dup (`:354-357`, `:390-397`) are untouched by the
  diff; the transformer chain (`:343-372`) runs before the segment chain
  (`:445-482`) for each message, so segment/event ordering is preserved.
- **Frontend**: the tree builder marks the tool node `streaming` on segment
  arrival (`agent-monitor-tree-builder.service.ts:357-372`) — at
  `content_block_stop` the tool has not executed yet, so the status stays
  accurate. Retention classifies by segment type only
  (`agent-output-retention.ts:206-214`). `recordRequestContext`
  (`agent-process-manager.service.ts:1134-1146`) reads only `usage`.
  No consumer of the old gate or timing was found in
  `libs/backend/cli-agent-runtime` or `libs/frontend/chat-streaming`.

### Q3 — can `flushPendingToolCalls()` in `finally` emit after the lane stopped, or double-emit?

Double-emit: no (per-entry delete at `:263`; verified in Q1). After the lane
stopped: yes — emission happens on the abort and error paths, and on a
guard-initiated stop the aborting iterable lands in the same `finally`. Budget
effect: none. `applyLaneGuard` returns early for a non-running lane
(`agent-process-manager.service.ts:1038`), and a guard that already asked to
stop ignores every later segment (`stopped` flag, `lane-budget-guard.ts:83`).
The remaining effect is UI-facing only and is defect 1.

### Q4 — are the specs meaningful?

Yes. Checked against the pre-diff code (`git diff` minus the additions):

- `service.spec.ts:326-352` — old code emitted two segments (start with empty
  input, assistant with full input); the exact single-segment assertion fails.
- `:355-366` — old code emitted both calls with no `toolInput`/`toolCallId`;
  `objectContaining` fails. This is the bug's own regression test.
- `:369-381` — new fallback behaviour; old code never parsed fragments.
- `:384-391` — old code dropped the unstopped block in `finally`
  (`pendingToolArgs.clear()`); zero segments, fails.
- `:395-407` — old code's segment had no `toolCallId`/`toolInput`; fails.

All five would fail on the old code. The gap is the failure path (defect 3).

---

## Five logic questions (condensed)

1. **Silent failure**: the `finally` flush emits a success-shaped `tool-call`
   segment after the stream failed, with `{}` input where fragments held the
   real arguments (defect 1).
2. **Unexpected user action**: a lane turn that aborts or errors mid-tool-call
   produces the degraded segment; with a low configured `repeatAt`, one aborted
   parallel group can trigger a `repeat-call` stop (defect 1).
3. **Wrong answer, not an error**: unparseable fragments silently fall back to
   the start input (`:272-275`); arrays/null parse results are rejected the same
   way. On the happy path this never fires.
4. **Dependency failure**: transformer throws are caught and pending calls
   survive to a later flush (`:362-372`, `:408-419`); an iterable throw lands in
   defect 1's path.
5. **Missing**: result-side ids (defect 2) and failure-path specs (defect 3).
   Noted, pre-existing and unchanged: the segment path has no
   `parent_tool_use_id` filter (`:445-482`), so nested subagent tool calls also
   count toward the lane's budget — accepted guard design, not this diff's
   regression.

## Decisions

- **Count defect 2 against this fix even though the gap is pre-existing.**
  Options: pre-existing-only (exclude) or half-completed-intent (include).
  Evidence: the fix's stated purpose is distinguishable tool calls downstream;
   tagging only the call side leaves the tree builder's id pairing permanently
   unused for ptah-cli. Reversible: yes.
- **Treat the `finally` flush as a defect, not accepted degradation.** The
  implementation report records the fallback as a deliberate decision, but the
  decision covers `content_block_stop` with invalid JSON — not the abort path,
  where the segment also lands after the error segment and after the lane
  stopped. Reversible: yes.

## Unknowns

- Whether any real ptah-cli stream sends two `content_block_start` events at
  one index without an intervening stop (defect 4). No fixture in the repo
  shows it; recorded as a failure mode for that reason.
- Whether lanes run with non-default low `repeatAt` in production. The env
  override exists (`agent-spawn-environment.service.spec.ts:141-146`); the
  deployed values are not in the repo.
- `libs/frontend/chat` was outside the named consumer scope but the tree builder
  there is the one consumer that reads `segment.toolCallId`; it was read
  directly (defect 2). The `chat-streaming` files matched only on stream-event
  `toolCallId` use, not on CLI segment fields.