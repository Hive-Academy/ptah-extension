# Code Logic Review — `TASK_2026_453_1eb4` Batch 9

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score       | 8/10                                  |
| Assessment          | APPROVED                              |
| Blocking issues     | 0                                     |
| Serious issues      | 0                                     |
| Moderate issues     | 2                                     |
| Failure modes found | 2                                     |

Scope reviewed: uncommitted diff under `libs/shared` (worktree
`D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`, HEAD `d4da63212`):
`libs/shared/src/lib/utils/history-page.utils.ts` (new),
`libs/shared/src/lib/utils/history-page.utils.spec.ts` (new),
`libs/shared/src/lib/utils/index.ts`,
`libs/shared/src/lib/types/rpc/rpc-chat.types.ts`,
`libs/shared/src/lib/types/rpc/rpc-session.types.ts`,
`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`,
`libs/shared/CLAUDE.md`. Cross-checked against `implementation-plan.md` "(ii).3 Contract" /
"(ii).6 C6", `batches.md` Batch 9 / Stage 2 validation table (V1-V9, D10-D15), and
`b9-codex-report.md`.

## Five logic questions

### 1. How does this fail silently?

`selectHistoryPage` has no guard on `options.maxEvents` being non-finite. If a caller ever
passes `NaN` (e.g. a future direct caller that skips the Zod boundary the plan assigns to
Task 10.2), the overshoot check `endIndex - index > options.maxEvents`
(`history-page.utils.ts:110`) is always `false` for `NaN` (`x > NaN` is always false in JS), so
the backward scan never breaks and silently walks all the way to the earliest turn, returning the
*entire* history as "one page" instead of throwing or clamping. No error is raised; the caller
gets a success-shaped, oversized result. This is currently inert because the only intended
caller path validates `maxEvents` with `z.number().int().min(1).max(HISTORY_PAGE_MAX_EVENTS)`
before calling in (per the plan, Task 10.2), so it is a latent rather than an active defect in
this diff, but this file is a shared, exported barrel utility (`utils/index.ts:12-24`) that other
libs can call directly without going through that RPC boundary.

### 2. What user action produces unexpected behaviour?

None directly — this batch ships no RPC handler, no UI. The nearest user-visible path (clicking
"load earlier") is Batch 12/10's job. Within this batch's own surface, no user action is wired
yet (correctly deferred per V4/D10).

### 3. What input data produces a wrong answer?

- Non-finite/negative `maxEvents` as above (question 1).
- A `messageId` containing characters outside `[A-Za-z0-9_-]` would make `encodeHistoryCursor`
  produce a cursor that `decodeHistoryCursor` cannot parse, breaking the round trip for that
  turn's older-page cursor. The plan treats the charset match as an already-verified upstream
  invariant (V9, `batches.md:1174`: fixture and real ids are `uuid` / `user-<ts>` / `task_<id>`
  shaped), so this is not a new risk this batch introduces, but the utility itself does not assert
  or defend the invariant it depends on — a future message-id format change would fail this
  contract without warning at the `history-page.utils.ts` layer specifically.

### 4. What happens when a dependency fails?

This batch has no runtime dependency (pure functions, no I/O, no Node APIs — confirmed by reading
the whole file: only `FlatStreamEventUnion` type import). N/A.

### 5. What is missing that the requirements never mentioned?

- No boundary test at the cursor length limits (`{1,512}`): the spec tests reject 513 chars but
  never assert that exactly 512 chars (or 1 char) is accepted. Not a defect, but a gap versus "id
  charset/length" in the review brief.
- The wire types encode "olderCursor present only when historyPage was requested and success is
  true" purely as documentation (`rpc-chat.types.ts:249-251`), not as a discriminated union. That
  is consistent with the plan's own proposed shape (`(ii).3`, `ChatResumeResult.historyPage?`), so
  it is not a deviation, but it means nothing in the type system stops Task 10.2 (or any future
  caller) from setting `historyPage` on a failed/legacy response — the guarantee is textual only.

## Failure modes

### Non-finite/negative maxEvents silently returns the whole history

- Trigger: `selectHistoryPage(events, { endIndex, maxEvents: NaN })` (or any value that makes
  every `>` comparison false, e.g. `Infinity` is the opposite failure — see below) called directly,
  bypassing the RPC Zod boundary the plan places in Task 10.2.
- Symptom: caller expecting a bounded page gets the full history back with no error, no clamp, no
  log.
- Evidence: `history-page.utils.ts:99-118` (the overshoot check at line 110 is the only guard, and
  it evaluates to `false` for `NaN`).
- Current handling: none — the function trusts `maxEvents` unconditionally.
- Recommendation: either document this as "undefined behaviour, validate before calling" in the
  function's TSDoc (cheapest fix, matches the "pure primitive, validation lives at the boundary"
  design already chosen for the cursor decode), or add a defensive
  `Number.isFinite(maxEvents) && maxEvents > 0` guard that throws/returns empty rather than
  silently over-delivering. Given this is a shared, exported utility (not handler-private), the
  cheap TSDoc fix is the minimum acceptable bar; the guard is the more robust one.

### maxEvents = Infinity or very large clamps to full history without signalling "unbounded" was requested

- Trigger: caller passes `maxEvents: Infinity` (or a value far past `HISTORY_PAGE_MAX_EVENTS`,
  which this function does not itself enforce — clamping to 2000 is also a Task 10.2/boundary
  responsibility per the plan).
- Symptom: `selectHistoryPage` happily returns the entire transcript as "one page" with
  `olderCursor: null`; no error, matches the "empty transcript" success shape exactly, so a caller
  cannot distinguish "small history" from "budget request was ignored."
- Evidence: `history-page.utils.ts:110,116` — no upper bound check against
  `HISTORY_PAGE_MAX_EVENTS` inside the selection function itself, even though that constant is
  defined in the same file (`:10`).
- Current handling: none in this file; deferred entirely to the Zod schema in Task 10.2's out-of-
  batch scope, which is a defensible split but leaves this pure function with no self-defense.
- Recommendation: no change required for this batch to pass (matches plan's explicit design), but
  the Batch 10 reviewer should verify the Zod schema (`z.number().int().min(1).max(HISTORY_PAGE_MAX_EVENTS)`)
  is applied before any call into `selectHistoryPage`/`resolveHistoryCursorEndIndex`.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: `selectHistoryPage` has no internal guard against non-finite/out-of-range
  `maxEvents` (see failure modes above) — `history-page.utils.ts:110`.
- Moderate: no test exercises the cursor length boundary (512 chars exactly, or a single-char id)
  — `history-page.utils.spec.ts:238-245` only tests one char over the limit.
- Minor: `ChatHistoryPageResult.resumableSubagents` uses an inline
  `import('../subagent-registry.types').SubagentRecord[]` type reference instead of a top-level
  import (`rpc-chat.types.ts:350`) — a style nit, out of this review's scope
  (code-style-reviewer's territory), noted only so it is not silently missed by both reviews.

## Data flow

1. `selectHistoryPage(events, { endIndex, maxEvents })` receives a full (already
   compaction-filtered) replayable event array and an exclusive end index — OK, matches C1-C5's
   guarantee that `events` never crosses a compaction boundary (verified upstream, not
   re-verified here since out of this batch's file scope).
2. `endIndex` is clamped to `events.length`; `events.length === 0 || endIndex <= 0` short-circuits
   to the empty-page terminal state — OK, matches the "fully loaded" contract used by the
   older-page walk test.
3. Backward scan from `endIndex - 1` to `1` finds root user turn starts
   (`isRootUserTurnStart`, `:42-48`) and greedily extends `startIndex` backward while
   `endIndex - index <= maxEvents` — OK; monotonic distance means the `break` on first violation
   is correct and does not need to inspect earlier turns (verified by trace of every spec case).
4. Post-loop override forces `startIndex = 0` when no turn was found before `endIndex` or when the
   whole remaining segment already fits the budget — OK; verified this override cannot mask a
   legitimate mid-history boundary, because any case where index 0 would satisfy the budget also
   satisfies `endIndex <= maxEvents` by construction.
5. `olderCursor` is `null` only when `startIndex === 0` — OK, matches "fully loaded" semantics;
   confirmed by the page-chain spec that concatenation reconstructs the full input with no gaps or
   duplicates.
6. `encodeHistoryCursor` / `decodeHistoryCursor` / `resolveHistoryCursorEndIndex` round-trip only
   root-user `message_start` ids — OK; nested (`parentToolUseId` present) ids are provably
   unresolvable (dedicated test), addressing "no page anchor via a subtree message."
7. Wire types (`rpc-chat.types.ts`, `rpc-session.types.ts`, `rpc-error-codes.types.ts`) are
   additive-only optional fields / a new union member — OK for backward compatibility; the
   compile-time guard spec (`rpc-chat.types.spec.ts`) is confirmed unedited and still applicable.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Constants `HISTORY_TAIL_PAGE_EVENTS`/`HISTORY_PAGE_DEFAULT_EVENTS`/`HISTORY_PAGE_MAX_EVENTS` | COMPLETE | none |
| `selectHistoryPage` never splits turn/tool-pair/subagent | COMPLETE | verified by trace + tests |
| Exactly-N vs whole-turn overshoot rule | COMPLETE | verified by trace (exact-fit and oversize-turn tests) |
| Cursor codec `h1:<id>`, invalid vs stale distinction | COMPLETE | none |
| Root-user-only cursor resolution / nested anchors rejected | COMPLETE | dedicated test |
| `ChatResumeParams/Result.historyPage` additive, backward compatible | COMPLETE | none |
| `ChatHistoryPageParams/Result` wire shapes | COMPLETE | registry/entries correctly deferred to Task 10.2 (V4) |
| `HISTORY_CURSOR_STALE` error code | COMPLETE | none |
| `MessageAnchorHint.occurrenceFromEnd` | COMPLETE | resolution logic correctly deferred to Task 10.1/10.2 |
| Zod schemas at the external boundary | N/A here | plan explicitly assigns this to Task 10.2 (no executable boundary in this batch) |
| Spec non-vacuous, covers stated edge cases | COMPLETE | minor gap: exact-512-char cursor boundary untested |
| `libs/shared/CLAUDE.md` bullet updated | COMPLETE | none |

Implicit requirements not addressed: internal defense of `selectHistoryPage` against
non-finite/negative `maxEvents` (see Moderate finding); this is a reasonable split of
responsibility given the plan's explicit boundary design, but it is a real gap if any future
caller reaches this function without going through the Zod-validated RPC path.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Empty history | YES | early return `{ events: [], olderCursor: null }` | none |
| Tool pair inside the tail turn | YES | `isRootUserTurnStart` excludes `tool_start`/`tool_result` | none |
| Nested agent subtree (`parentToolUseId`) | YES | excluded from turn-start detection and cursor resolution | none |
| Oversize single turn (> maxEvents) | YES | returned whole, tested at maxEvents=2 | generalization to 250 relies on the same monotonic-distance property, not independently re-tested at 250 |
| Exact `maxEvents` fit | YES | dedicated test | none |
| Assistant-first transcript (no leading user turn) | YES | index 0 treated as implicit start | none |
| Malformed cursor (empty, wrong prefix, bad charset, over-length) | YES | `HistoryCursorInvalidError`, four cases tested | 512-char exact boundary and 1-char minimum untested |
| Valid-format cursor, anchor not found (stale) | YES | `HistoryCursorStaleError` | none |
| Cursor pointing at a nested (non-root) message id | YES | rejected as stale | none |
| Non-finite / negative `maxEvents` | NO | no guard | see Moderate finding; relies entirely on an out-of-batch Zod boundary |
| Older-page chain reaching the start | YES | walked to `olderCursor: null`, disjoint, reconstructs input | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: `selectHistoryPage`/`resolveHistoryCursorEndIndex` are exported as general shared
  utilities with no self-defense against malformed numeric input; today's only caller path is
  Zod-validated, so the risk is latent, not active, but it should be tracked so Task 10.2's
  reviewer confirms the boundary is actually wired before this risk is closed for good.
- What a robust implementation would add: (1) a `Number.isFinite(maxEvents) && maxEvents > 0`
  guard or explicit TSDoc contract note on `selectHistoryPage`/`HistoryPageSelectionOptions`; (2)
  a boundary test for the exact 512-char and 1-char cursor id lengths; (3) a short assertion in
  the spec (or a plan cross-reference note) that `HISTORY_PAGE_MAX_EVENTS` clamping is enforced
  by the Task 10.2 Zod schema, not silently assumed.
