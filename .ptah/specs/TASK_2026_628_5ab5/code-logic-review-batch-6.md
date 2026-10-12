# Code Logic Review — `TASK_2026_628_5ab5`, Batch 6

## Verdict

CHANGES REQUESTED (`NEEDS_REVISION`). One serious memory retention defect remains in the new module-level caches.

## Score

6/10. The event pass and bounded selection preserve the prior item identities, last-event timestamps and `(timestamp, id)` ordering (`compact-session-summary.ts:173-183,186-203,211-242`); the full-input redaction check prevents stale text (`compact-session-summary-cache.ts:52-63`). The score stays below 7 because a long-lived renderer can retain arbitrarily large old session data despite the 256-entry limit (`compact-session-summary-cache.ts:13-25,37-44,62,99`). It stays above 5 because I found no changed-path error that produces a wrong summary item.

## Defects

1. **Serious — the cache is bounded by entries, not retained bytes.** `compact-session-summary-cache.ts:13-25,37-44,62,99`. A user streams a long assistant block containing an absolute path, then closes that session. `redactBlock` retains both the entire raw block and its redacted copy in a module-level map; a large streamed tool input similarly retains its full raw JSON and parsed object. Neither map removes entries on session close, and eviction needs 256 *other keys*. A series of long sessions can therefore leave hundreds of large blocks or inputs live in the renderer after their `StreamingState` objects are gone, defeating the task's memory ceiling. The upstream accumulator appends without a size cap (`chat-streaming/src/lib/accumulator-core.service.ts:833-840`). Add a retained-byte budget or per-entry size cap, and release entries for a session when it ends; keep the full-text equality condition for entries that remain cached.

## Five logic questions

1. **Silent failure:** Memory retention has no result signal: summaries still look correct while old raw and redacted text remain strongly reachable (`compact-session-summary-cache.ts:24-25,62,99`).
2. **User action:** Closing several sessions after long outputs does not release those cached strings or parsed inputs (`compact-session-summary-cache.ts:24-25,37-44`).
3. **Wrong-answer input:** I found none in the changed path. Full raw text and workspace path are compared before redaction reuse (`compact-session-summary-cache.ts:57-63`), and the tool parse cache compares full raw JSON (`compact-session-summary-cache.ts:86-100`).
4. **Dependency failure or bad shape:** A partial or non-object tool input returns the existing name fallback; a later changed raw input is parsed again (`compact-session-summary-cache.ts:75-100`). There is no external dependency in this path. The existing malformed-input test checks fallback (`compact-session-summary.spec.ts:793-815`), though it does not check malformed-to-valid recovery.
5. **Missing requirement:** The 256-entry target did not specify a byte limit or cache lifecycle, but renderer memory is the task's stated objective (`compact-session-summary-cache.ts:11,24-25,37-44`).

## Failure modes

### Old session text remains pinned

- Trigger: A large block or tool JSON is summarized, then its session is closed.
- Symptom: Memory remains in use after the session state is released; repeated large sessions can cross the renderer budget.
- Evidence: `compact-session-summary-cache.ts:13-25,37-44,62,99`; upstream accumulation is uncapped at `chat-streaming/src/lib/accumulator-core.service.ts:833-840`.
- Current handling: Eviction occurs only after more than 256 distinct keys per map.
- Recommendation: Bound retained bytes and dispose session entries, while retaining exact raw-input comparisons.

## Data flow

1. `summarizeLive` takes a state or null (`compact-session-summary.ts:124-132`). Null yields no live items and is covered by the failure-state test (`compact-session-summary.spec.ts:443-460`).
2. `liveItems` walks events once, retains the last event per semantic ID, and selects at most 48 (`compact-session-summary.ts:169-183,186-203,221-242`). This matches the old Map overwrite and sort/slice path in `batch6.diff:439-459`.
3. Selected text blocks use the accumulator or delta fallback and the full-input redaction cache (`compact-session-summary.ts:250-264`; `compact-session-summary-cache.ts:52-63`). Correct output, but the retained raw and redacted values create the defect above.
4. Selected tools get input from their start event or accumulator; malformed JSON falls back to tool name (`compact-session-summary.ts:266-323,371-380`; `compact-session-summary-cache.ts:70-100`). The parsed input cache has the same byte-retention issue.
5. `buildSummary` receives at most 48 live items, derives marks/content/status, and returns the summary (`compact-session-summary.ts:506-587`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Linear in events, at most 48 built, no full event sort | COMPLETE | `compact-session-summary.ts:173-183,221-242`; the 48-slot array makes selection work linear in event count. |
| Previous output ordering and redaction | COMPLETE for reviewed cases | `compact-session-summary.ts:186-203,211-242,250-323`; parity/tie tests at `compact-session-summary.spec.ts:891-954,1021-1049`. |
| No stale redaction after changed content | COMPLETE | Exact raw and workspace comparison at `compact-session-summary-cache.ts:57-63`; changed-text tests at `compact-session-summary.spec.ts:956-1019`. |
| Public signatures unchanged | COMPLETE | `compact-session-summary.ts:124-137`; diff changes begin inside `liveItems` (`batch6.diff:426-459`). |
| Bounded caches and no relevant cross-session leakage | PARTIAL | Entry count capped at `compact-session-summary-cache.ts:37-44`, but retained bytes and session lifetime are unbounded. No incorrect cross-session output was found because full inputs are checked. |
| Tests cover behaviour | PARTIAL | Tests cover parity, redaction, top-K, eviction and parse reuse (`compact-session-summary.spec.ts:891-1115`); no large-value retention test or malformed-to-valid recovery test. Existing malformed fallback is at `:793-815`. |

## Edge cases

| Case | Handled | Evidence / limit |
| --- | --- | --- |
| 0 events or null | YES | Empty list path at `compact-session-summary.ts:128-131,173-183`; null failure test at `compact-session-summary.spec.ts:443-460`. |
| Fewer than or exactly 48 items | YES by selection logic | `compact-session-summary.ts:225-241`; no exact-48 test. |
| More than 48 and equal timestamps | YES | `compact-session-summary.ts:211-242`; 60-item tie test at `compact-session-summary.spec.ts:1021-1049`. |
| Repeated block ID with changed text/workspace | YES | `compact-session-summary-cache.ts:57-63`; tests at `compact-session-summary.spec.ts:956-1019`. |
| Tool input fails to parse | YES fallback | `compact-session-summary-cache.ts:75-100`; test at `compact-session-summary.spec.ts:793-815`. |
| Very large block or tool JSON, then session close | NO | `compact-session-summary-cache.ts:24-25,37-44,62,99`; retained bytes can grow with each value. |

## Notes

The developer notes report the scoped Jest suite passing (59/59), plus changed-project typecheck and lint (`batch-6-notes.md`, Checks section). I did not rerun Jest. No `ptah_*` tools were listed in this environment, so I used native read/search and could not request `ptah_get_diagnostics` or call `ptah_agent_report`. There is no `task-description.md` or `code-style-review.md` in the discovered task folders. I reviewed the complete three changed files, the diff, the Batch 6 plan, notes, context and root instructions. This is a read-only logic review; no source or git state was changed.
