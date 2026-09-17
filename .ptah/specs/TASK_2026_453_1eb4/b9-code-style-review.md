# Code Style Review — `TASK_2026_453_1eb4` (Batch 9 / Task 9.1, C6 `libs/shared`)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 6 (2 created, 4 modified)            |

Scope: the uncommitted diff under `libs/shared` for Batch 9 only —
`libs/shared/src/lib/utils/history-page.utils.ts` (created),
`.../utils/history-page.utils.spec.ts` (created), `.../utils/index.ts`,
`.../types/rpc/rpc-chat.types.ts`, `.../types/rpc/rpc-session.types.ts`,
`.../types/rpc/rpc-error-codes.types.ts`, `libs/shared/CLAUDE.md`. RPC
registry/entries (`rpc.types.ts`) are correctly out of scope per D10/V4 and
untouched (`git diff --name-only -- libs/shared/src/lib/types/rpc.types.ts`
confirms no change).

## Five style questions

### 1. What breaks in six months?

Nothing structural. The one soft spot is `selectHistoryPage`'s dual-role
boundary rule — a root user `message_start` is a start, AND index 0 is always
treated as a start even when it is not one — encoded only as an `if` at
`history-page.utils.ts:116-118` with no comment. A future change to the
selection algorithm (e.g., adding a third boundary condition, such as a
compaction marker) that does not re-derive this from the doc comment at
`history-page.utils.ts:83-86` (which does not mention the index-0 rule at all)
risks silently breaking the assistant-first-transcript case, whose only
protection today is `history-page.utils.spec.ts:201-227`.

### 2. What would a new team member misread?

The loop variable `foundLastTurn` (`history-page.utils.ts:97`) reads as "we
reached the end of history" but actually means "we found the start of the
newest turn walked so far in this backward scan." A reader tracing the
oversize-turn branch (`history-page.utils.ts:104-108`) without the test file
open could misattribute the early `continue` to iteration order rather than to
"the first root-user start found while scanning backwards from `endIndex` is
always kept, regardless of budget" (which is the actual rule, and is what the
oversize-turn test at `history-page.utils.spec.ts:151-176` pins).

### 3. What does this cost to maintain?

Low. The util is 125 lines, pure, and has no runtime dependents yet (C7-C14
integrate against it in later batches), so a design correction here is cheap.
The wire-type additions are additive-only (`historyPage?`) so no existing
caller needed touching, matching the "backwards compatibility" contract in
`implementation-plan.md:857-863`.

### 4. Where is this inconsistent with the rest of the repository?

- `ChatHistoryPageResult.events` (`rpc-chat.types.ts:349`) is typed
  `FlatStreamEventUnion[]`, not `readonly FlatStreamEventUnion[]`, while the
  plan's own cited precedent for this "paged read" shape,
  `SessionCliOutputPageResult.items` (`rpc-session.types.ts:174`), is
  `readonly SessionCliOutputPageItem[]` — readonly on both the property and
  the element type. The new interface only readonly-qualifies the property.
  This matches this file's own existing convention for `ChatResumeResult.events`
  (`rpc-chat.types.ts:247`, plain `FlatStreamEventUnion[]`), so it is not an
  invented inconsistency, but it does mean the new type is stricter than its
  neighbour in the same file and looser than the pattern the plan pointed at
  in the same breath (`implementation-plan.md:837`, "cli-output-page style").
- Everywhere else — file naming (`history-page.utils.ts`, matching
  `session-id.utils.ts`, `git.utils.ts`), barrel export shape (named
  `export {...}` with inline `type` modifiers, matching the newest sibling
  entries in `utils/index.ts:10-31`), error-class naming and construction
  (`this.name = '...'` in the constructor, matching
  `AgentOutputCursorStaleError` in `agent-sdk/src/lib/session-metadata-store.ts:238-243`)
  — the batch is consistent with its cited siblings.

### 5. What would you have done differently, and why is that better rather than merely other?

Add one doc-comment line to `selectHistoryPage` stating the index-0 rule
explicitly ("index 0 is always treated as a turn start, even when the event at
0 is not a root user `message_start`, so the oldest partial turn is still
reachable as a page") and rename `foundLastTurn` to something like
`sawNewestTurnStart`. Neither is a functional change; both remove the one
place in this batch where the code's literal reading and its actual behaviour
diverge without the spec file open.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `history-page.utils.ts:97-118` — `foundLastTurn` is a misleading name for
  "found the start of the most-recently-scanned turn"; a reader could confuse
  it with "reached the end of the transcript." Low cost, self-contained
  rename.
- `history-page.utils.ts:83-86` — the JSDoc for `selectHistoryPage` does not
  mention that index 0 is always treated as an implicit turn start
  (`:116-118`), even though this is a named requirement in
  `implementation-plan.md:810` and `batches.md` Task 9.1 AC 2. The behaviour
  is correctly tested (`history-page.utils.spec.ts:201-227`) but not
  documented at the definition site.
- `rpc-chat.types.ts:349,351` — `events`/`resumableSubagents` on
  `ChatHistoryPageResult` are non-readonly arrays, one level short of the
  `readonly X[]` double-qualification the plan's cited "cli-output-page"
  precedent uses (`rpc-session.types.ts:174`). Matches this file's existing
  convention for `ChatResumeResult`, so not a fresh inconsistency, just short
  of the stricter precedent the plan pointed at.

## File-by-file

### `libs/shared/src/lib/utils/history-page.utils.ts`

Score 8/10 — 0 blocking, 0 serious, 2 minor. Pure, deterministic, O(events),
no Node/browser APIs, matches the `session-id.utils.ts` "small pure util"
pattern the plan cites. Constants, cursor codec, and two distinct `Error`
subclasses are all present exactly as specified (`:4-10`, `:27-40`,
`:51-81`). The only friction is the naming/documentation gap on the
selection loop noted above.

### `libs/shared/src/lib/utils/history-page.utils.spec.ts`

Score 9/10 — 0/0/0. Covers every case batches.md Task 9.1 AC 7 lists: empty
input, tail snap, tool-pair integrity, nested-agent integrity, oversize turn,
exact-fit, assistant-first (index-0), cursor round trip (UUID and `u-12`
charsets), malformed cursor, missing anchor, nested-anchor rejection, and the
disjoint-pages-reconstruct-input chain walk. Structure (`describe` block,
one `it` per case, small local fixture builders) matches sibling spec files
in the same directory (e.g. `git.utils.spec.ts`, `pricing.utils.spec.ts`).

### `libs/shared/src/lib/utils/index.ts`

Score 9/10 — 0/0/0. New block (`:12-24`) follows the explicit-named-export
style used by the other recent additions in this barrel
(`pick-primary-model.ts`, `codex-token-freshness.ts`, `agents-region.utils.ts`)
rather than the older `export *` style used for pre-existing entries —
correctly matches the newest convention, not the oldest one.

### `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`

Score 8/10 — 0/0/1 (readonly-array minor above). `ChatResumeParams.historyPage`
and `ChatResumeResult.historyPage` are additive and documented as such
(`:230-233`, `:243-247`, `:254-257`); doc comments accurately describe the
tail-page semantics. `ChatHistoryPageParams`/`Result` (`:338-352`) match the
plan's field list exactly, including the `import('../subagent-registry.types')`
inline-type reference, which mirrors the pre-existing pattern at `:173` and
`:297` in the same file rather than introducing a new idiom.

### `libs/shared/src/lib/types/rpc/rpc-session.types.ts`

Score 10/10 — 0/0/0. `occurrenceFromEnd?` (`:293-297`) is additive, documented,
and placed directly beside the existing `occurrence` field it complements.

### `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`

Score 10/10 — 0/0/0. One-line append to the union (`:20-21`), the single
source of truth this file is documented to be (`libs/shared/CLAUDE.md:27`).

### `libs/shared/CLAUDE.md`

Score 9/10 — 0/0/0. The `chat:resume` bullet update is minimal and accurate:
it adds the tail-page / `chat:history-page` sentence and the "unchanged when
absent" clause without touching the surrounding TASK_2026_437 C15 sentences it
did not need to revise.

## Pattern compliance

| Repository rule or nearby convention                                              | Status | Evidence                                                                                   |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Utils are pure, no Node/browser/framework APIs (`libs/shared/CLAUDE.md` Guideline 3) | PASS   | `history-page.utils.ts` uses only `Array`/`RegExp`/`Error`; no `Buffer`/`btoa`               |
| `kebab-case.ts` file naming + `.utils.ts` suffix for utils                          | PASS   | `history-page.utils.ts`, matches `session-id.utils.ts`, `git.utils.ts`                       |
| Barrel exports named, `type` modifier for type-only re-exports                     | PASS   | `utils/index.ts:12-24`, inline `type HistoryPageSelection` / `type HistoryPageSelectionOptions` |
| `rpc-error-codes.types.ts` is the single source of truth for error codes            | PASS   | `rpc-error-codes.types.ts:20-21`, no duplicate code defined elsewhere in this diff            |
| RPC namespace addition requires BOTH compile-time registry AND runtime allowlist    | N/A (deferred) | `chat:history-page` correctly not registered here; V4/D10 defers to Task 10.2; `rpc.types.ts` and `rpc-handler.ts` untouched (report "Diff Safeguards") |
| No `TODO`/`FIXME`/stub/placeholder/V2 copies                                        | PASS   | No matches in changed files; old API left in place, additive only                            |
| File size soft ceiling 700 lines                                                    | PASS   | New file 125 lines; `rpc-chat.types.ts` 352 lines                                             |
| Zod validation at external boundaries (deferred here per plan)                      | N/A (deferred) | `implementation-plan.md:847-853` assigns schema work to Task 10.2; this batch adds no executable boundary |
| Readonly-array double-qualification on "paged read" wire types (P11 precedent)      | MINOR FAIL | `rpc-chat.types.ts:349,351` vs `rpc-session.types.ts:174`                                    |

## Maintenance debt

- Introduced: one pure util module + spec (125 + 289 lines), three additive
  wire-type members, one error code, one doc-comment update. No new
  dependency, no new DI wiring (foundation layer, correctly "Dependencies:
  none" per the plan).
- Retired: nothing. This batch is purely additive, as required for backwards
  compatibility with callers that omit `historyPage`.
- Net: small, well-isolated addition. The two naming/documentation minors are
  the only things a future reader would trip on; both are fixable without
  touching the public shape.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking — the `foundLastTurn` naming and the missing
  index-0 doc line are the only places a newcomer would need the test file
  open to fully trust the code's behaviour.
- What a 10/10 version would do differently: rename `foundLastTurn` to
  something that names what was found (e.g. `sawNewestTurnStart`), add the
  index-0 invariant to the `selectHistoryPage` doc comment, and mark
  `ChatHistoryPageResult.events` / `.resumableSubagents` as `readonly X[]` to
  match the `SessionCliOutputPageResult` precedent the plan itself cites.
