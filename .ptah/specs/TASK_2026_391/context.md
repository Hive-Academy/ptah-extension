# TASK_2026_391 — curator extract: prose or truncated JSON is not an empty extraction

## Origin

Filed 2026-09-08 from the TASK_2026_376 independent gate review
(`.ptah/specs/TASK_2026_376/codex-review.md`, Blocker 1, and the
`runtime-gate.md` lane that recorded the gate). The gate confirmed the chain
end to end and demoted it from "block 376" to "file its own task" because the
behaviour predates 376 and is pinned by an older spec as intended.

## The defect chain (every line verified in the tree at `a008d9841`)

1. `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:315`
   — `extract()`'s fall-through arm:

   ```ts
   return { status: 'extracted', drafts: this.parseDrafts(outcome.text) };
   ```

   This arm is reached for every run whose last assistant message contained
   text (`runQuery` returns `{ kind: 'text', ... }` at `:461-462`).

2. `sdk-internal-query.curator-llm.ts:477-481` — `parseDrafts` returns `[]`
   in BOTH of these cases:
   - `extractJsonObject(text)` finds no balanced JSON object (`:479`);
   - `ExtractedResponseSchema.safeParse(json)` fails (`:481`).

   A parse failure is therefore byte-identical to the honest reply
   `{"memories": []}`.

3. `libs/backend/memory-curator/src/lib/memory-curator.service.ts:583-599`
   — the `drafts.length === 0` arm builds `outcome: 'ran', extracted: 0` and
   returns it. The `'no-output'` arm immediately above it (`:579-581`) is the
   input-preserving path TASK_2026_376 R1 added; the prose case never
   reaches it.

4. `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:814-825`
   — only `stats.outcome === 'stalled'` returns before
   `this.observationQueue.markProcessed(ids)`. A `'ran'` with zero drafts
   consumes every drained observation row for the session.

## Pinned as intended

`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts:695-706`
— `it('returns an EXTRACTED status with no drafts when model output is
non-JSON garbage')` asserts exactly `{ status: 'extracted', drafts: [] }` for
the input `'not json at all'`. Both the arm and the spec come from commit
`5dfedc09c` (2026-08-23). This is a deliberate pre-existing design, not a
376 regression.

## Failure scenario

The curator spends four of its six turns reading memory through the Ptah MCP
and closes with:

> I reviewed the transcript and found nothing worth storing.

`extractJsonObject` finds no object, `drafts: []`, `outcome: 'ran'`, the
session's queued observations are marked processed, and that session can never
be curated again. The same outcome for a JSON object the model truncated at
the output limit or wrapped in prose that breaks the balanced-brace scan.

## Why it is now more likely

`CURATOR_MAX_TURNS = 6` (`sdk-internal-query.curator-llm.ts:186`, TASK_2026_376
F8, previously `maxTurns: 1`). A single-turn model either emits the JSON or
emits nothing; a six-turn model that has just finished a run of tool calls is
far more likely to close with a natural-language wrap-up. R1 closed the
`tools-only` and `silent` arms as `no-output` for exactly this reason
(`libs/backend/memory-contracts/src/lib/curator-llm.port.ts:66-84` documents
the argument) and left the third way a run can end without JSON open.

## Required fix

- Treat "text present but no parseable JSON" as `no-output`, not as
  `extracted: []`. Either widen the existing `no-output` variant of
  `CuratorExtraction` (`curator-llm.port.ts:96-101`) with a reason such as
  `'unparseable-text'` alongside `usedTools` / `toolNames`, or add a fourth
  arm; the caller mapping in `memory-curator.service.ts:579-581`
  (`recordCuratorNoOutput`) already preserves the input, so the consumer side
  should need no new branch.
- `parseDrafts` (or a sibling) must distinguish "no JSON object found" and
  "schema rejected" from "valid envelope with an empty `memories` array".
  An honest `{"memories": []}` stays `extracted` with zero drafts and
  continues to consume the observations — that is a correct empty result.
- Flip `sdk-internal-query.curator-llm.spec.ts:695` to assert `no-output`
  for `'not json at all'`, and add cases for a truncated JSON object
  (`'{"memories": [{"content": "x"'`) and for prose that wraps a valid
  object (which should still parse). Each new spec must fail before the
  change and pass after it.
- Log the arm at `info` with the first ~200 characters of the text so the
  next live session can tell a prose wrap-up from a malformed envelope.

## Acceptance criteria

1. A final assistant message with no balanced JSON object yields
   `status: 'no-output'` and `MemoryTriggerService` does NOT call
   `markProcessed` for that session.
2. A final assistant message whose JSON fails `ExtractedResponseSchema`
   yields `status: 'no-output'` with the same consequence.
3. `{"memories": []}` still yields `status: 'extracted', drafts: []` and the
   observations are consumed.
4. The `:695` spec is flipped, not deleted; the truncated-JSON case is
   added; `npx nx run-many -t test -p @ptah-extension/agent-sdk
   @ptah-extension/memory-curator` is green.

## Related, optional scope (gate observation O1)

Two other curator paths return a success-shaped `'ran'` and consume input:

- `memory-curator.service.ts:950-960` — `recordCuratorError` returns
  `outcome: 'ran'` for a dispatched-and-failed call. The comment at
  `:952-958` records this as a deliberate carry-over ("whether a FAILED pass
  should also preserve its input is a separate question"). Decide it here
  or file it separately; do not leave it undecided a third time.
- `memory-curator.service.ts:705-742` — every per-draft persist can fall into
  `skipped` (`:713`) and the aggregate still reports `'ran'` (`:722`), so a
  run whose persistence failed entirely consumes its input.

Both are the same data-loss class as this task; neither is required to close
it.
