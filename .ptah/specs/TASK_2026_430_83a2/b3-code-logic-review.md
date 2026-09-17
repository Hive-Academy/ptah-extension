# Code Logic Review — `TASK_2026_430_83a2`, Batch B3

## Fix round re-review

Scope: only the delta in `## B3 fix round` (`b3-report.md`) — the three
changes addressing this review's original Moderate #1–#3. Re-read
`session-metadata-store.ts`'s two changed spots (`isNonEmptyBulk` /
`countReferencesWithBulk`, the new `logTruncatedItems` and its two call
sites) and all 107 new lines of
`libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts`
(`readSyncSequencePage` + the `readJsonSequence` sync branch) in full, not by
diff hunk. Independently re-ran both affected suites rather than trusting the
report:

```
npx nx test @ptah-extension/vscode-core --testPathPatterns=workspace-aware-state-storage
  Test Suites: 1 passed | Tests: 12 passed
npx nx test @ptah-extension/agent-sdk --testPathPatterns=session-metadata-store
  Test Suites: 1 passed | Tests: 69 passed
```

### Moderate #1 — `countReferencesWithBulk` now uses the non-empty rule

`isNonEmptyBulk` (`session-metadata-store.ts:295-301`): `undefined`/`null` →
false; string/array → `length > 0`; anything else → true. This matches G's
own convention exactly (`g-report.md` deviation 8: "non-empty string/array,
or any other non-null value"). `countReferencesWithBulk` (`:303-307`) uses it
in place of the old `!== undefined` check. Verified against the new spec
(`session-metadata-store.spec.ts:752-773`): an `addCliSession` whose only
reference has `stdout: ''`/`segments: []` logs nothing; a `save` mixing one
all-empty reference with one real (`segments: [x]`) reference logs
`strippedBulkRefCount: 1`, not 2. Correct, and it is the exact fix the
original finding asked for — no residual imprecision.

### Moderate #2 — sync oversized-item shrink is now logged

New shared private method `logTruncatedItems(agentId, truncatedItems)`
(`:804-817`), called from both `readSequenceOutputPage` (async,
`:791`, unchanged page-relative payload from the worker) and
`readRecordOutputPage` (sync, `:859`, now passing
`[{ index: 0, originalJsonBytes }]` — synchronously, immediately before the
shrunk item is pushed, so there is no window where a truncation is logged but
not applied or vice versa). Same message string, same payload shape
(`{ truncatedItems: [{ pageIndex, originalJsonBytes }] }`), counts only — no
item content in either branch (confirmed by reading both call sites; neither
passes `item` or `shrunk`, only the two numeric fields). Verified against the
new/extended spec at `session-metadata-store.spec.ts:1048-1080`, which
asserts the exact log shape including `originalJsonBytes` computed
independently via `Buffer.byteLength(JSON.stringify(...))` — a real
cross-check, not a tautology against the production code's own arithmetic.
Correct.

### Moderate #3 — `WorkspaceAwareStateStorage.readJsonSequence` now honours options for sync delegates

**The new logic is correct.** Traced `readSyncSequencePage`
(`workspace-aware-state-storage.ts:74-146`) line by line against
`ElectronStateWorkerRuntime.readSequencePage`
(`platform-electron/.../electron-state-storage-worker-runtime.ts:733-812+`),
which this batch's own G review already approved as the reference semantics:

- **Cursor encoding/validation and staleness.** `s<fingerprint>.<index>`
  where `fingerprint` is the first 16 hex characters of a SHA-256 over
  `JSON.stringify(sequence)` — the content-hash analog of the worker's
  `blob.generation`, since a sync delegate has no generation counter. A
  cursor is rejected as `StateStorageCursorStaleError` when the regex
  doesn't match, the fingerprint doesn't match the CURRENT value's
  fingerprint, the index isn't a safe integer, or `index > sequence.length`
  — the same four-way check shape as the worker's generation/index guard
  (`:739-746,753`). Verified live: the dedicated spec
  (`workspace-aware-state-storage.spec.ts:404-432`) exercises a malformed
  cursor, an out-of-range index on an otherwise-valid fingerprint, a
  genuinely rewritten value (appended item — different fingerprint), and a
  deleted key, all four correctly rejected as stale, plus the deleted-key/no
  cursor case correctly resolving to an empty `done:true` page — exact parity
  with the worker's absent-blob behaviour.
- **Absent-key vs empty.** `value === undefined` → `fingerprint = null`,
  `sequence = []`. With no cursor: loop doesn't run, `done: true`, `items:
[]` — matches G's `readSequencePage` "no blob, no cursor → empty final
  page." With a cursor: `match[1] !== null` is always true for a real
  16-hex-char cursor, so it is correctly rejected as stale — matches "no
  blob, cursor present → cursor-stale" (`worker-runtime.ts:743`). Confirmed
  by the same spec block, not merely inferred.
- **Every page within both budgets, envelope and shrink suffix.** The
  packing loop (`:108-137`) enforces three inequalities per item before
  admitting it: `pageBytes + separator + itemJson ≤ maxBytes`, `jsonBytes +
separator + itemJson ≤ maxJsonBytes`, `itemJson ≤ maxItemBytes` — the same
  three-way AND the worker's loop uses (`:782-786`), substituting
  `jsonUtf8Bytes` throughout in place of the worker's dual
  estimator/UTF-8 pair, which is the correct simplification for a domain
  with no true byte-estimator (already an accepted deviation from B3's first
  round). `jsonBytes` starts at `options?.jsonEnvelopeBytes ?? 2` — the
  caller's real envelope size when supplied — so the suffix and envelope
  really do count toward `maxJsonBytes`, not just the bare items. Verified
  directly in the first spec (`:319-358`): the assertion re-derives
  `jsonEnvelopeBytes - 2 + Buffer.byteLength(JSON.stringify(page.items))` and
  checks it against `maxJsonBytes` independently of the production
  arithmetic — a real cross-check.
  - **One asymmetry worth recording (Minor, not a regression):** `pageBytes`
    (the `maxBytes` accumulator) starts at a flat `2`, unlike the worker's
    `baseEstimator`, which is computed by actually `measure()`-ing the real
    envelope shape, and unlike this same file's `jsonBytes` accumulator,
    which correctly starts at the caller-supplied `jsonEnvelopeBytes`. This
    means `maxBytes` alone (without `maxJsonBytes`) under-accounts for
    envelope overhead by construction. It is provably harmless **today**:
    the only caller, `SessionMetadataStore.readSequenceOutputPage`
    (`session-metadata-store.ts:766-774`), always sets `maxBytes ===
maxJsonBytes === budget.rpcBytes` and always supplies
    `jsonEnvelopeBytes`, so `jsonBytes`'s stricter, envelope-aware check is
    always the one that actually binds, and the assembled page's true size
    is still correctly bounded. It would only become a real gap if a future
    caller invoked `readJsonSequence` with `maxBytes` set but `maxJsonBytes`
    omitted (defaulting to `Infinity`), expecting `maxBytes` alone to be
    envelope-aware the way the Electron worker's is.
- **A lone oversized item shrinks or fails typed, never silently
  dropped/looped.** Same shape as the worker: on the first item that cannot
  fit even alone (`items.length === 0`), `shrinkJsonStringLeaves` is called
  with `maxEstimatorBytes: maxBytes - pageBytes` and `maxJsonBytes:
min(maxJsonBytes - jsonBytes, maxItemBytes)` (`:124-128`) — structurally
  identical to the worker's call (`:794-799`), correctly substituting the
  single `jsonUtf8Bytes` estimator. `null` → `StateStorageValueTooLargeError`
  (`:130`, never silently returns a truncated-to-nothing item or an empty
  page in its place). Success → the shrunk item is pushed, `truncatedItem`
  recorded, `index++`, and the loop **breaks** (`:132-136`) rather than
  continuing to pack more items onto the same page — matching the worker's
  "one oversized item per page" contract. Verified by
  `workspace-aware-state-storage.spec.ts:360-392` (shrink, page-relative
  `truncatedItems`, byte-bound respected, then a clean continuation to the
  next item) and `:394-402` (an item with nothing shrinkable — all-numeric
  leaves — correctly throws typed rather than looping or admitting an
  oversized page).
- **No infinite loop on zero-progress pages.** Every iteration of the inner
  `while` either pushes an item and increments `index` (continue), or hits
  the single-item branch, which either throws (terminates via exception) or
  pushes a shrunk item, increments `index`, and breaks. There is no path
  where the loop re-evaluates the same `index` without having thrown. The
  outer `do…while` in `readJsonSequence` (`:280-291`) therefore always makes
  progress per page, and terminates once `page.nextCursor` is `null`
  (`done`). No fixture reduces this to a formal proof, but the code shape
  rules out the failure class by construction, and the multi-page spec
  (`:319-358`, `pages > 1`, full drain equals the source) exercises several
  real iterations without hanging.
- **No budget logic duplicated from platform-core.** `jsonUtf8Bytes` and
  `shrinkJsonStringLeaves` are imported, not reimplemented
  (`workspace-aware-state-storage.ts:28,30`). The only new arithmetic is the
  three-inequality packing loop and the cursor fingerprint/regex, neither of
  which exists in platform-core (the worker's version is
  platform-electron-specific and uses a different estimator by design).
- **No content logged.** Nothing in the new code calls a logger at all —
  `readSyncSequencePage` is pure, and its caller in `session-metadata-store.ts`
  is the one that logs, correctly counts-only (see Moderate #2 above).
- **`readJsonSequence`'s sync branch vs. the pre-existing async branch.**
  `WorkspaceAwareStateStorage.readJsonSequence` (`:271-291`) still checks
  `isAsyncStateStorage(storage)` first and delegates unchanged when true
  (Electron, and CLI/TUI's own `IAsyncStateStorage`-satisfying delegate, if
  ever one is registered) — the new sync branch is strictly additive for the
  `false` case. No change to the async path.

**Correction to the report's framing (not a logic defect, worth recording for
the batch record).** `b3-report.md`'s original "Out-of-scope observations"
and this round's summary both describe the fixed gap as "VS Code and CLI."
Tracing the actual DI wiring: `apps/ptah-cli`/`apps/ptah-tui` go through
`libs/backend/cli-engine/src/lib/container.ts:413-420`, which explicitly
constructs `new WorkspaceAwareStateStorage(..., () => new CliStateStorage(...))`
and registers _that_ as `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` — so the fix
genuinely applies there, confirmed. `apps/ptah-electron` does the same with
`ElectronStateStorage` (`phase-1-infra.ts:132-147`) — its delegate already
satisfies `IAsyncStateStorage` directly, so the sync branch is inert there,
as expected. **The standalone VS Code extension (`apps/ptah-extension-vscode`)
never constructs a `WorkspaceAwareStateStorage` at all** — grep across
`apps/ptah-extension-vscode` for the class name returns nothing, and
`libs/backend/platform-vscode/src/registration.ts:65-70` registers a raw
`VscodeDiskStateStorage` (which implements only `IStateStorage`, not the
async interface) directly as `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`. So
`SessionMetadataStore.isAsyncStateStorage(this.storage)` is `false` on the
real VS Code extension host, and `getAgentOutputPage` there runs its own
long-standing `readRecordOutputPage` sync branch inside
`session-metadata-store.ts` (dual-budget-aware since B3's _first_ round,
independent of this fix). The practical effect: this round's fix is real and
correctly implemented, but its actual beneficiary is `ptah-cli`/`ptah-tui`
(via `cli-engine`), not the VS Code extension, which was never exposed to the
broken one-shot-ignoring-cursor proxy behaviour in the first place (it has
its own, separately-verified sync page reader). This does not change the
verdict — the code is correct and well-tested for the host it actually
serves — but the batch record's "VS Code and CLI" phrasing overstates where
the bug lived and where this fix matters.

### Verdict on the delta

- Recommendation: APPROVE — all three moderates are correctly and
  completely addressed, with real (non-tautological) test coverage for each,
  and no new defect was found in the ~107 new lines.
- One Minor item carried forward, not blocking: the `maxBytes`/`pageBytes`
  envelope-accounting asymmetry noted above — harmless under every current
  caller, worth a one-line comment or fix only if `readJsonSequence` ever
  gets a second caller that omits `maxJsonBytes`.
- One record correction, not a defect: the fix's real beneficiary is CLI/TUI
  (`cli-engine`), not the standalone VS Code extension, which was already
  unaffected by the original gap through its own pre-existing sync path.

## Summary

| Metric              | Value           |
| ------------------- | --------------- |
| Overall score       | 8/10            |
| Assessment          | PASS (APPROVED) |
| Blocking issues     | 0               |
| Serious issues      | 0               |
| Moderate issues     | 3               |
| Failure modes found | 4               |

Scope reviewed: the six uncommitted B3 files — `libs/backend/agent-sdk/src/index.ts`,
`libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (+ spec),
`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` (+ spec),
`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts`.
Read in full, not by diff hunk (`session-metadata-store.ts` all 1,333 lines,
`agent-events.ts` all 494 lines). Cross-checked against
`implementation-plan.md` revision 3 components 5–6, `batches.md` Batch B3,
`b3-report.md`'s five deviations, `g-report.md`/`g-code-logic-review.md` for
the contracts B3 consumes from G (dual-budget fields, page-relative
`truncatedItems`, the absent-key/`done:true` semantics), and
`agent-process-manager.service.ts` (`restoreAgents`, `readOutputForPersistence`,
`MAX_STDOUT_PERSISTENCE_SIZE`) to verify the restore-spec assertions describe
real production behaviour rather than a change to that file (which B3 does
not touch).

Independently re-ran both test suites, not just trusted the report:

```
npx nx test @ptah-extension/agent-sdk --testPathPatterns=session-metadata-store
  Test Suites: 1 passed | Tests: 68 passed
npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns="agent-events|agent-process-manager.restore"
  Test Suites: 2 passed | Tests: 24 passed
```

Also verified via `git log`/`grep` that `AgentProcessManager.steer` was removed
by a prior, already-merged commit (`d02e355b2`, TASK_2026_402,
`sendToAgent` replacing it) — confirming `b3-report.md` deviation 3's claim
that `agent-process-manager.restore.spec.ts:303`'s `.steer(...)` call was a
genuine pre-existing compile break on `main`, not something B3 masked or
caused. `git diff` on that file shows exactly the two hunks the report
claims: the stdout-empty assertion (in scope for 3.2) and the
`steer`→`sendToAgent` line (the unrelated fix), nothing else.

## Five logic questions

### 1. How does this fail silently?

- `_saveInternal` (`session-metadata-store.ts:446-496`) only strips bulk and
  logs when `countReferencesWithBulk(merged) > 0`
  (`session-metadata-store.ts:294-298,464-474`). That predicate is
  `ref[field] !== undefined`, not "non-empty", which is the convention G's
  array-split module deliberately adopted for the equivalent question
  (`g-report.md` deviation 8: "carries bulk" = a non-empty value). A
  reference already lean except for an explicit `stdout: ''` or
  `segments: []` therefore still counts as "1 stripped reference", still
  triggers an `omitJsonPaths` clone, and still logs
  `strippedBulkRefCount: 1` even though nothing meaningful was removed. This
  does not lose data or mislead about correctness (the field really is
  removed from the written detail either way), but it makes the counter the
  plan asked writers to log (R3-3, "the count is one per reference") report a
  false positive for a case that is already lean. See Moderate #1.
- Nothing else in the reviewed files masks a failure as success. In
  particular: `_saveInternal`'s async path writes the detail durably
  (`:479`) before staging the index (`:483-485`), so a crash between the two
  leaves an orphaned detail rather than a lying index entry — this is
  pre-existing, unmodified-by-B3 ordering, and the correct direction of
  failure (an invisible session, not a phantom one).

### 2. What user action produces unexpected behaviour?

- Expanding a large sub-agent's output card on a **VS Code or CLI** host
  (not Electron) can throw `'Agent output page exceeds RPC budget'`
  (`session-metadata-store.ts:754-756`) for any output whose total JSON
  exceeds the RPC budget. The `getAgentOutputPage` async path
  (`isAsyncStateStorage(this.storage)` is true for `WorkspaceAwareStateStorage`
  even though its VS Code delegate is a sync `CliStateStorage`) calls
  `storage.readJsonSequence(...)`, and `WorkspaceAwareStateStorage`'s sync
  branch returns the **whole stored array in one page**, ignoring `cursor`,
  `maxBytes`, `maxJsonBytes` and `maxItemBytes`
  (`libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts:182-198`,
  confirmed by reading that file directly). `getAgentOutputPage`'s final
  guard (`:754`) then throws instead of paging. A continuation cursor, if
  the first page somehow fit, would silently re-serve from index 0.
  **This is not a B3 regression** — `b3-report.md`'s out-of-scope note
  states the deleted widen/narrow search hit the same proxy behaviour, and I
  confirmed this by reading the current `workspace-aware-state-storage.ts`,
  which B3 does not touch — but it is a real, user-visible failure mode
  reachable through the exact contract component 5 now relies on
  exclusively for VS Code/CLI output paging (there is no more inline
  `segments` fallback on the reference to fall back to, see question 5).
  See Moderate #3.
- On the sync (`readRecordOutputPage`) path, a single item that exceeds the
  page budget alone is shrunk with `shrinkJsonStringLeaves` and served with
  no signal to the caller or a log entry
  (`session-metadata-store.ts:833-844`), whereas the async path logs
  `truncatedItems` at `info` (`:781-791`). A VS Code/CLI user reading a
  truncated item sees truncated content with no way to know it happened.
  See Moderate #2.

### 3. What input data produces a wrong answer?

- None found in the reviewed write/read paths that produces a **wrong**
  answer (as opposed to a thrown error or an accepted, documented
  limitation). Traced the budget arithmetic in `getAgentOutputPage`
  (`:723-758`) against the async spec's exact expected call
  (`session-metadata-store.spec.ts:1096-1105`): `rpcBytes = min(maxBytes, 256
KiB)`, `jsonEnvelopeBytes = rpcOutputPageBytes([], '0'.repeat(32), false)`,
  `maxItemBytes = rpcBytes - jsonEnvelopeBytes`. `b3-report.md` deviation 2
  claims this is mathematically equivalent to the plan's literal
  `maxItemBytes = rpcBytes`, because the worker's own packing check is
  `jsonEnvelopeBytes + item ≤ maxJsonBytes` (also `rpcBytes`) — so an item
  bounded by `rpcBytes` alone is already bounded by `rpcBytes -
jsonEnvelopeBytes` through that check. Verified: the two constraints are
  equivalent whenever `jsonEnvelopeBytes ≥ 0`, which it always is. No
  discrepancy.
- `saveAgentOutput`'s fallback/drop classification
  (`:670-679`) was traced against every one of its five spec cases
  (`:825-885`) and each produces the documented outcome:
  `stdout` only → fallback segment; `stdout` + `streamEvents` → drop,
  `streamEvents` kept; `segments` only → neither flag, debug log; empty
  everything → no write at all. No case was found where a segment or
  stream event a caller supplied is lost — only `stdout` is ever discarded,
  and only when something else already exists to replace it (by design).
- `readOutputForPersistence` (`agent-process-manager.service.ts:1079-1103`)
  returns the **full current accumulator snapshot** on every call, not a
  delta (`segments: [...tracked.accumulatedSegments]`,
  `streamEvents: [...capStreamEvents(tracked.accumulatedStreamEvents...)]`).
  Combined with `saveAgentOutput`'s async write being a full
  `replaceJsonSequence` (`:681-694`, not an append), a second
  `saveAgentOutput` call for the same `agentId` (e.g. the sdk-callbacks
  re-persist pass documented at `agent-events.ts:303-304`, or a
  `retryWithBackoff` retry) overwrites the whole sequence with what is, by
  construction, a monotonically-growing snapshot of the same agent's
  lifetime output — never a smaller or different set. Checked specifically
  for a scenario where this would NOT hold (a restored agent re-triggering
  a save): `restoreAgents` sets `restored: true`, and neither
  `agent:spawned` nor `agent:exited` — the only two triggers for
  `persistCliSessionReference` — ever fires for a restored record
  (`agent-process-manager.service.ts:849`, confirmed by the restore spec's
  "never emits a persisting lifecycle event" case, `restore.spec.ts:278-318`,
  which is unmodified by B3 and still green). No overwrite-with-stale-data
  path found.

### 4. What happens when a dependency fails?

- `StateStorageCursorStaleError` from `readJsonSequence` is caught and
  re-thrown as `AgentOutputCursorStaleError(agentId)`
  (`session-metadata-store.ts:793-797`), with the iterator closed in
  `finally` (`:798-800`) regardless of which branch is taken — verified by
  the "closes the page iterator rather than abandoning it" spec
  (`:1199-1228`), which asserts `closed === true` after an error path.
- `StateStorageValueTooLargeError` and any other error from
  `readJsonSequence` pass through unchanged (`:793,797`), verified by
  "passes value-too-large through unchanged" (`:1160-1174`) using
  `.rejects.toBe(tooLarge)` — the exact object, not a copy, so no detail is
  lost in translation.
- `metadataStore.saveAgentOutput` failing inside `persistBulkThenReference`
  (`agent-events.ts:422-435`) prevents `addCliSession` from ever running in
  that attempt — bulk is durable-or-nothing before the reference exists,
  confirmed by "does not write the reference until the bulk write succeeds"
  and "never writes the reference when the bulk write keeps failing"
  (`agent-events.spec.ts:307-401`, both green). The inverse failure (bulk
  succeeds, then `addCliSession` fails on `'Parent session not found'` and
  the retry budget is exhausted) leaves a durable `ptah.agentOutput:<agentId>`
  key with no reference ever pointing at it — a leaked, ungarbage-collected
  key. This is the same trade-off TASK_2026_324 already made deliberately
  (the alternative, reference-before-bulk, risks a durable reference to
  content that was never written, which is worse — see the comment at
  `agent-events.ts:410-421`) and is not something B3 introduces or changes;
  I confirmed the ordering and the comment both predate this diff's context
  by checking the surrounding unchanged lines.
- The VS Code async-proxy dependency shape (question 2) is the one place a
  dependency's response violates its own contract (ignoring cursor/budget
  parameters) and the caller has no way to detect or route around it. That
  it is handled by _throwing_ rather than silently truncating is the right
  failure direction, but it is still a failure a user can hit.

### 5. What is missing that the requirements never mentioned?

- The plan's stated reason `stdout` can be safely dropped when other output
  exists is that, in production, structured output (`segments`) is already
  the fuller signal. Before B3, the reference itself carried `segments`
  inline specifically so a restored card could "render without a second
  read" (deleted comment at old `agent-events.ts:399-405`, visible in the
  diff). B3 correctly removes that inline copy (architecture requires it),
  but this shifts VS Code/CLI users' _only_ path to output review onto the
  async paging contract discussed in question 2, which was already broken
  there. Nothing in the plan or `b3-report.md` claims this was fixed for
  VS Code — it is explicitly named as an out-of-scope observation, correctly
  attributed — but it is worth stating plainly here: after B3, a restored
  or completed sub-agent card on VS Code has a real chance of failing to
  page its output at all for outputs above the RPC budget, where before
  this whole redesign an inline `segments` tail was at least available for
  the shorter ones. This is a consequence of the architecture (component 8's
  job, tracked as a candidate for `future-enhancements.md` per the
  executor), not a B3 defect, but it is the most concrete instance of
  "missing" in this batch's blast radius.
- No production code in `agent-process-manager.service.ts` needed to
  change (plan says so explicitly, and I confirmed no diff exists there);
  the restore-time contract ("a restored reference with no `stdout` yields
  an empty buffer") already followed from `ref.stdout ?? ''` at
  `restoreAgents:812`, which B3's spec update alone now correctly documents.

## Failure modes

### Retry exhausts before `addCliSession` durably lands (orphaned output key)

- Trigger: `saveAgentOutput` succeeds, then every `addCliSession` retry in
  `persistBulkThenReference` fails for a reason other than
  `'Parent session not found'` (which defers rather than retries away), or
  the parent session genuinely never resolves within 3 retries.
- Symptom: `ptah.agentOutput:<agentId>` is durable and correct, but no
  `CliSessionReference` ever points at it — the agent's output becomes
  permanently unreachable through any UI path (nothing enumerates
  `ptah.agentOutput:*` directly).
- Evidence: `agent-events.ts:422-462` (retry wraps the whole
  `persistBulkThenReference`, catch-all logs `error` after exhausting
  retries with no cleanup of the already-written bulk key).
- Current handling: pre-existing (TASK_2026_324), unmodified by B3.
  Accepted trade-off, documented in the surrounding comment
  (`:410-421`): the reverse ordering risks a durable, dangling reference
  instead, which is considered worse because it actively misleads a reader
  into believing output exists.
- Recommendation: none required of B3. If ever revisited, a bounded sweep
  of `ptah.agentOutput:*` keys with no owning reference would need a new
  enumeration capability this store does not have.

### Sync-storage oversized item shrink is unobserved

- Trigger: an agent's persisted output (sync storage: VS Code/CLI) contains
  one JSON item too large to fit `budget.itemBytes` even alone.
- Symptom: the item is served shrunk and suffixed (`shrinkJsonStringLeaves`,
  `session-metadata-store.ts:834-838`) with no log entry, unlike the async
  path's `info`-level `truncatedItems` log (`:781-791`).
- Evidence: `readRecordOutputPage` (`:803-852`), specifically the shrink
  branch at `:834-844`, has no `this.logger.*` call anywhere in that
  function.
- Current handling: functionally correct (the page still fits the budget,
  the caller gets valid JSON), just unobserved.
- Recommendation: add an `info` log mirroring the async path's shape when
  the sync shrink branch is taken, for VS Code/CLI diagnostic parity.

### VS Code/CLI async-shaped proxy ignores sequence read options

- Trigger: `getAgentOutputPage` on a VS Code or CLI host reads an agent's
  output sequence through `WorkspaceAwareStateStorage`, whose sync-backed
  `readJsonSequence` returns the entire stored array as one page regardless
  of `cursor`/`maxBytes`/`maxJsonBytes`/`maxItemBytes`.
- Symptom: any output whose total JSON exceeds the RPC page budget throws
  `'Agent output page exceeds RPC budget'` (`:754-756`) instead of paging;
  a continuation cursor supplied on a request that _did_ fit would silently
  re-serve page 1.
- Evidence: `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts:182-198`
  (read directly, not from the report) — the sync branch of
  `readJsonSequence` slices the whole array into one yielded page with no
  reference to the options parameter's budgets.
- Current handling: B3 does not touch this file, and per `b3-report.md` the
  pre-B3 widen/narrow search hit the identical proxy behaviour, so this is
  not a regression. It is, however, the sole read path for CLI-agent output
  on non-Electron hosts now that no inline fallback exists on the
  reference.
- Recommendation (already made by the executor, worth repeating with
  reviewer endorsement): fix `WorkspaceAwareStateStorage`'s sync branch to
  honour `cursor` and the dual budgets. File under
  `future-enhancements.md`, as already planned; not a B3 blocker.

### `strippedBulkRefCount` over-counts on an explicit-but-empty bulk field

- Trigger: a reference carries `stdout: ''`, `segments: []`, or
  `streamEvents: []` (explicitly present, zero-length) rather than the
  field being absent.
- Symptom: `_saveInternal` treats the reference as "had bulk, now
  stripped", clones the whole detail through `omitJsonPaths` unnecessarily,
  and logs `strippedBulkRefCount` counting it — even though no meaningful
  content is removed.
- Evidence: `countReferencesWithBulk`
  (`session-metadata-store.ts:294-298`) uses `ref[field] !== undefined`,
  not the "non-empty value" rule G's array-split module uses for the
  conceptually equivalent question (`g-report.md` deviation 8).
- Current handling: harmless in outcome (the field really is gone from the
  write either way), imprecise only in the logged count.
- Recommendation: align `countReferencesWithBulk`'s predicate with G's
  "non-empty" convention so `strippedBulkRefCount` reports the same kind of
  event the split's counters do, per R3-3's intent that these counters be a
  meaningful operational signal.

## Blocking issues

None found.

## Serious issues

None found. (The VS Code/CLI async-proxy gap discussed above is real and
user-visible, but it is inherited, unmodified-by-B3 code outside this
batch's file list, already correctly identified and slated for
`future-enhancements.md` by the executor — see Moderate #3 rather than
Serious, since nothing in B3 makes it worse and nothing in B3's scope can
fix it.)

## Moderate and minor issues

1. **`countReferencesWithBulk` counts `!== undefined`, not "non-empty".**
   `session-metadata-store.ts:294-298`. Inconsistent with G's own
   "non-empty" rule for the same conceptual question. Causes a benign
   over-count of `strippedBulkRefCount` and an avoidable clone. Not data
   loss. See failure mode above.
2. **Sync-storage oversized-item shrink is silent** (no log), unlike the
   async path's `truncatedItems` log. `session-metadata-store.ts:833-844`
   vs `:781-791`. Diagnostic parity gap for VS Code/CLI hosts.
3. **VS Code/CLI async-proxy ignores sequence read options**, so
   `getAgentOutputPage` either throws for large output or mis-serves a
   continuation. Pre-existing, outside B3's file list
   (`workspace-aware-state-storage.ts:182-198`), correctly flagged by the
   executor for `future-enhancements.md`. Recorded here because it is the
   exact contract component 5 now depends on exclusively for VS Code/CLI
   output review.
4. **Minor:** the sync cursor freshness token (`s<savedAt>.<index>`,
   `session-metadata-store.ts:249-266`) keys on millisecond-resolution
   `Date.now()`. Two `saveAgentOutput` calls for the same agent landing in
   the same millisecond (only plausible under a mocked clock or a
   pathological double-fire) would make a cursor computed against the
   first appear valid against the second's content. Sync storage is
   single-process (VS Code/CLI), so the practical exposure is very low;
   noted for completeness, not a recommended change.

## Data flow

1. **Agent exit → durable output → durable reference.**
   `agent-events.ts:422-435` calls `saveAgentOutput` (bulk) before
   `addCliSession` (reference), both inside one `retryWithBackoff`. OK —
   matches "Agent exit: 1. saveAgentOutput writes the sequence... 2.
   addCliSession writes a lean reference" (`implementation-plan.md:461-463`).
   Verified by `agent-events.spec.ts` gating tests, independently re-run
   green.
2. **`saveAgentOutput` → per-agent sequence key, never the blob.**
   `session-metadata-store.ts:661-721`. Async uses `replaceJsonSequence`
   (full replace of a monotonically-growing snapshot, verified safe under
   question 3); sync uses a whole-record `PersistedAgentOutput`. Neither
   ever touches `ptah.sessionMetadata` or `ptah.session:<id>`. OK.
3. **`_saveInternal` → lean detail, lean index.** `:446-496`. Bulk stripped
   from every reference via `omitJsonPaths` before either storage kind
   writes. Detail written before the index is staged (async), so a crash
   mid-write orphans a detail rather than lying in the index — the correct
   failure direction, and unmodified by B3. OK, with the minor over-count
   caveat (Moderate #1).
4. **`get()` / `getCliSessionsForRestore` → always projected.** `:561-573,
864-869`. Verified by the source-level spec
   (`session-metadata-store.spec.ts:780-808`) that every `sessionDetailKey(`
   read in the file is a `getAsync<…>(…, DETAIL_READ_OPTIONS)` call and the
   array-fallback branch applies `omitJsonPaths`. OK — no detail read
   anywhere in this file skips the projection.
5. **`getAgentOutputPage` → exactly one `readJsonSequence` call (async).**
   `:760-801`. Verified by two dedicated specs asserting call count and
   exact options. Iterator always closed in `finally`. OK.
6. **`getAgentOutputPage` → bounded scan with shrink-or-fail (sync).**
   `:803-852`. Cursor validated against `savedAt` before any read; an
   oversized lone item is shrunk or the read fails typed
   (`StateStorageValueTooLargeError`), never silently truncated to nothing.
   OK, modulo the missing log (Moderate #2).
7. **Both paths → one final RPC-budget assertion.** `:754-756`. Runs
   unconditionally on the assembled page before it reaches the caller. OK
   as a backstop, though it is the mechanism by which the VS Code proxy gap
   (Moderate #3) surfaces as a thrown error rather than silently over-budget
   data.

No step in the files this batch owns was found to lose, duplicate, or
silently stale-read a value.

## Requirements fulfilment

| Requirement                                                                                                         | Status   | Gap                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `DETAIL_PROJECTION` omits `stdout`/`segments`/`streamEvents` on every detail read, both storage kinds               | COMPLETE | None                                                                           |
| `_saveInternal` strips bulk from every reference before writing, both storage kinds                                 | COMPLETE | Counting predicate imprecise (Moderate #1), not the removal itself             |
| `strippedBulkRefCount` logged once per reference at `info` when > 0                                                 | COMPLETE | Over-counts explicit-empty fields                                              |
| `saveAgentOutput` writes segments then streamEvents, or the single text fallback only when both are empty           | COMPLETE | None                                                                           |
| `stdoutDropped`/`stdoutFallback` logged at `info`, debug otherwise                                                  | COMPLETE | None                                                                           |
| `getAgentOutputPage` async: exactly one `readJsonSequence` call with the dual-budget options                        | COMPLETE | None                                                                           |
| `AgentOutputCursorStaleError` replaces `StateStorageCursorStaleError` on the async path                             | COMPLETE | None                                                                           |
| Widen/narrow search deleted                                                                                         | COMPLETE | Confirmed via acceptance grep and direct read — no trace remains               |
| Sync `getAgentOutputPage`: cursor `s<savedAt>.<index>`, dual-budget shrink                                          | COMPLETE | Shrink event unobserved (Moderate #2)                                          |
| Deleted: `leanCliSessions`, `migrateRefOutput`, `leanCliSessionRef`, `getAgentOutput`, `MAX_PERSISTED_REF_SEGMENTS` | COMPLETE | Confirmed absent via grep and direct read                                      |
| Component 6: reference omits bulk when `saveAgentOutput` exists; `saveAgentOutput` receives `stdout`                | COMPLETE | None                                                                           |
| Component 6: `AgentProcessManager` production code unchanged                                                        | COMPLETE | Confirmed via `git diff` — zero changes to that file                           |
| Barrel exports `AgentOutputCursorStaleError`                                                                        | COMPLETE | None                                                                           |
| File shrinks (deletions exceed additions)                                                                           | COMPLETE | 1,484 → 1,332 lines per `b3-report.md`, consistent with the diff stat observed |

Implicit requirements not addressed: VS Code/CLI async-proxy sequence
paging correctness (Moderate #3) — explicitly out of scope for B3's file
list, already flagged for `future-enhancements.md`.

## Edge cases

| Case                                                                  | Handled              | How                                                                                                         | Concern                                             |
| --------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Reference with explicit empty bulk field (`stdout: ''`)               | YES, but imprecisely | Stripped and counted as if non-empty                                                                        | Counter over-reports (Moderate #1)                  |
| `saveAgentOutput` called twice for the same agent (retry, re-persist) | YES                  | Full-replace of a monotonically-growing snapshot; verified non-destructive                                  | None                                                |
| `saveAgentOutput` with no output at all                               | YES                  | Early return, no write, no log                                                                              | None                                                |
| Restored agent's `ptah_agent_read`                                    | YES                  | `ref.stdout ?? ''` in unmodified production code; restore spec updated to match                             | None — matches the plan's accepted behaviour change |
| Restored agent never re-triggers a persist                            | YES                  | No lifecycle event fires for a restored record                                                              | None                                                |
| Old store without `saveAgentOutput`                                   | YES                  | `bulkInline` gate keeps the pre-B3 inline behaviour, `streamEvents` still dropped (pre-existing, unchanged) | None new                                            |
| Async cursor-stale                                                    | YES                  | Mapped to `AgentOutputCursorStaleError`, iterator closed, no retry inside the store                         | None                                                |
| Async value-too-large                                                 | YES                  | Passed through unchanged                                                                                    | None                                                |
| Sync cursor from a deleted/re-saved record                            | YES                  | `savedAt` mismatch → `AgentOutputCursorStaleError`                                                          | None                                                |
| Absent output key/record, no cursor                                   | YES                  | Empty `done:true` page (matches G's confirmed semantics)                                                    | None                                                |
| Single oversized item, async                                          | YES                  | Worker shrinks, `truncatedItems` logged page-relative                                                       | None                                                |
| Single oversized item, sync                                           | YES, unobserved      | Shrunk with no log                                                                                          | Diagnostic gap (Moderate #2)                        |
| Item that cannot be shrunk at all                                     | YES                  | `StateStorageValueTooLargeError`                                                                            | None                                                |
| Large output on VS Code/CLI                                           | NO (throws)          | Async proxy ignores budgets, final guard throws                                                             | Pre-existing, out of B3 scope (Moderate #3)         |
| `addCliSession` retries exhausted after `saveAgentOutput` succeeded   | Accepted leak        | Pre-existing TASK_2026_324 trade-off, unmodified                                                            | None new                                            |

## Verdict

- Recommendation: APPROVE (PASS)
- Confidence: HIGH — every claim above is backed by a direct read of the file
  and line named, an independently re-run passing test where one exists, or
  a `git diff`/`git log` check where the claim was about what changed versus
  what predates this batch.
- Top risk: none rises to Blocking or Serious for B3 itself. If forced to
  name the single item most worth carrying forward, it is the VS Code/CLI
  async-proxy sequence-paging gap (Moderate #3) — not because B3 caused it,
  but because B3's architecture now makes correct output paging the _only_
  route to a sub-agent's output on those hosts, with no inline fallback
  left to soften the gap the way there was before.
- What a robust implementation would add: align `countReferencesWithBulk`
  with the "non-empty value" convention G already established (Moderate
  #1); log the sync shrink path the way the async path already does
  (Moderate #2); and — outside this batch, in `workspace-aware-state-storage.ts`
  — honour `cursor`/dual budgets in the sync-backed `readJsonSequence`
  branch before VS Code/CLI users hit the RPC-budget exception on a
  real-sized sub-agent output (Moderate #3, already tracked for
  `future-enhancements.md`).
