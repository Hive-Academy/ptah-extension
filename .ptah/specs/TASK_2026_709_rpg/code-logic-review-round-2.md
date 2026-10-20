# Code logic review — round 2 — TASK_2026_709_rpg (ptah-cli repeat-call guard fix)

Review family: Glm (ptah-cli) reviewing codex
Date: 2026-10-20
Diff under review (uncommitted, branch `fix/ptah-cli-repeat-guard`, revision 1):

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts`

**Score: 9/10 — Verdict: APPROVED**

All four round-1 defects are fixed in the code and pinned by new tests. I found no
new defect: every emission order I could construct (streamed, non-streamed,
assistant-before-stop, double start, error, abort, result-while-pending,
two-turn) produces exactly one `tool-call` segment per call, degraded inputs
stay bounded and guard-distinguishable, and the error segment now follows the
flushed tool lines.

Evidence: full read of `ptah-cli-stream-loop.service.ts` (779 lines) and the
tool-call `describe` block of the spec (`service.spec.ts:294-496`);
`lane-budget-guard.ts:123-164` (`isNewCall`, `callKey`);
`ptah-cli-registry.utils.ts:71-99` (`summarizeToolInput`); round-1 review
findings for the tree-builder pairing
(`agent-monitor-tree-builder.service.ts:383-393`). Allowed test command:
**7 suites, 99 tests, all pass** (matches the revision report's claim; the
worker teardown warning in the output is pre-existing infra noise, not a
failure).

---

## Per-defect status

### Defect 1 (finally flush after error, empty input) — FIXED

`ptah-cli-stream-loop.service.ts`

- **Order:** `this.flushPendingToolCalls()` now opens the catch block at `:638`,
  before the error `emitOutput`/`emitSegment` at `:648-649`. Tool lines precede
  the error. Spec pins it: `service.spec.ts:404-406` asserts the segment order
  `['tool-call', 'error']` for a stream that throws mid-call.
- **Degraded input:** invalid or incomplete fragments become
  `{ __unparsed: fragments.slice(0, 500) }` at `:273` and `:278` — bounded at
  500 characters, and distinct per fragment content in the guard key
  (`lane-budget-guard.ts:155-158` builds the key from
  `normalisedJson(segment.toolInput)`), so aborted calls no longer collide on
  `Tool\x00{}`. `summarizeToolInput` bounds the display side further to 150
  characters (`ptah-cli-registry.utils.ts:93-94`).
- **Empty-input skip:** `:281` (`Object.keys(input).length === 0`) drops the
  segment when neither fragments nor start input carry anything. The entry is
  deleted at `:263` before the check, so a skipped call cannot re-emit from a
  later flush. Spec pins it at `service.spec.ts:415-419` (zero segments for an
  unstopped call with no known input) and the bounded fallback at `:378-393`.

All three halves of the round-1 concrete fix are present and tested.

### Defect 2 (tool-result segments carry no toolCallId) — FIXED

`ptah-cli-stream-loop.service.ts:558` and `:567` — both `tool-result-error` and
`tool-result` now carry `toolCallId: block.tool_use_id`. Spec pins both at
`service.spec.ts:456-470`. The tree builder's id pairing
(`agent-monitor-tree-builder.service.ts:383-385`, read in round 1) can now
match a ptah-cli result to its call instead of falling back to FIFO, which
mis-pairs parallel calls resolved out of order. Both sides of the id link are
complete.

### Defect 3 (no failure-path / multi-turn specs) — FIXED

Both tests the round-1 concrete fix named exist and are meaningful:

- **Error path:** `service.spec.ts:395-413` throws mid-tool-call and asserts
  exit 1, order `['tool-call', 'error']` and the `__unparsed` content. Fails on
  round-0 code on both counts (round-0 flushed after the error with the start
  input).
- **Two turns:** `service.spec.ts:435-454` reuses one id across two turns and
  asserts exactly two segments — the turn-2 call is not suppressed by the
  `emittedToolSegments.clear()` at `service.ts:616`, and neither turn's
  assistant echo duplicates its streamed call.

Residual, recorded as an observation and not counted: the abort variant
(`isAbort` at `:641-642`, no error segment) and the result-while-pending flush
at `:576` still have no dedicated spec. Both run the same tested
`emitPendingToolCall` path; the abort branch differs only by skipping the
error segment.

### Defect 4 (second start at the same index discards the first call) — FIXED

`ptah-cli-stream-loop.service.ts:455` calls
`this.emitPendingToolCall(event.index)` before `pendingToolArgs.set(...)` at
`:456-461`, so the first call is emitted with whatever fragments arrived
rather than discarded. Because `emitPendingToolCall` adds the id to
`emittedToolSegments` at `:294`, the later assistant echo cannot double-emit
it. Spec pins it at `service.spec.ts:421-433` (two segments, both calls, in
order). Fails on round-0 code, which reported only the second call.

---

## New-defect check (requested areas)

- **Exactly-once emission:** holds on every path. All seven emission routes
  (`content_block_stop` `:484`, pre-overwrite `:455`, assistant flush `:490`,
  echo block loop `:499-516`, result flush `:576`, stream end `:635`, catch
  `:638`, finally `:654`) funnel through delete-then-emit at `:263` or through
  the id-guarded echo at `:500`. A skipped emission (`:281`) deletes the entry
  without adding the id, so the assistant echo becomes the single emission for
  an empty-input call — exactly once, at a later point. No double emission
  found.
- **Order tool-call before error:** verified at `:638` vs `:648-649`; the
  `finally` flush at `:654` is idempotent per entry and cannot re-emit.
- **`__unparsed` capped:** 500 characters at `:273`/`:278`; display summary
  capped at 150 (`ptah-cli-registry.utils.ts:93-94`).
- **Empty-input skip:** broader than the round-1 request (it also skips a
  complete-but-empty streamed input at stop). Acceptable — see Decisions.
- **`tool_use_id` on results:** `:558`/`:567`, both result types, tested.
- **Double-start flush:** `:455`, id registration at `:294` prevents an echo
  double-emit.

**New defects: none.**

Observations, not defects: (a) when fragments are invalid, `__unparsed`
overrides a non-empty start input — deliberate, and pinned by
`service.spec.ts:378-393`, which gives the start block a fallback input and
asserts `__unparsed` wins; (b) same-name no-arg calls still collide on the
guard key `Tool\x00{}` via the echo path (`:507-514` emits `toolInput: {}`) —
pre-existing, unchanged by this revision, and inherent: two no-arg calls of one
tool are genuinely indistinguishable.

---

## Decisions

- **Count defect 3 as fixed although two minor variants stay untested.** The
  round-1 concrete fix named two tests; both were delivered and both fail on
  round-0 code. The untested variants share the tested flush path and differ
  only in the one-line `isAbort` branch. Reversible: yes.
- **Accept the broader empty-input skip.** A streamed no-arg call
  (fragments parse to `{}`) is skipped at stop and emitted once by the
  assistant echo, which makes the streamed and non-streamed paths behave
  identically. The only loss window is an abort between stop and echo, which
  hides one call — a guard undercount, the safe direction, and the same
  window already loses the echo-emitted text of any aborted turn.
  Reversible: yes.
- **Keep the same-name no-arg key collision out of the defect list.** It is
  pre-existing, untouched by this revision, and not fixable without metadata
  the protocol does not carry (the calls are identical by content).

## Unknowns

- Whether a real provider ever sends a non-empty `content_block_start` input
  together with `input_json_delta` fragments. No fixture in the repo shows the
  conflict; the `:378` test pins `__unparsed` winning over start input for
  that case.
- Whether an abort between `content_block_stop` and the assistant echo occurs
  in practice (it would hide one skipped empty-input call). No fixture.
- `normalisedJson` was not re-measured this round; round 1 established that it
  stringifies the input object into the guard key, which keeps `__unparsed`
  inputs distinct per fragment content.

## Verification

`npx jest -c libs/backend/cli-agent-runtime/jest.config.ts
libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ --coverage=false
--maxWorkers=2` — **PASS: 7 suites, 99 tests** (allowed command, run this
round).