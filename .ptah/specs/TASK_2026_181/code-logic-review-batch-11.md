# Code Logic Review - TASK_2026_181 — Batch 11 (Phase 7a: bulk status, backend half)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 2        |
| Minor Issues        | 2        |
| Failure Modes Found | 5        |

Mutation window opened before the first mutation, closed after a clean,
non-cached confirmation run (`nx test @ptah-extension/rpc-handlers
--skip-nx-cache`: 1598 passed / 31 skipped / 1629 total). Both mutated files
were restored and verified byte-identical by SHA-256 against a pre-mutation
hash taken before the window opened.

## The 5 Paranoid Questions

### 1. How does this fail silently?

Two candidates, both real, both low-probability given today's callers:

- **Case-insensitive duplicate escapes the dedup.** `[...new Set(parsed.taskIds)]`
  (`tasks-rpc.handlers.ts:681`) dedupes on exact string identity. `TaskIdRefSchema`
  (`task-view.types.ts:84-87`, via `isSingleTaskPathSegment`) rejects path
  traversal but never canonicalizes case. On Windows/macOS (case-insensitive
  filesystems), `TASK_2026_181` and `task_2026_181` resolve to the same
  `task.md`, would NOT collapse to one `Set` entry, and would both go through
  the funnel as two "different" tasks — silently violating FR-C4.3's "one entry
  per task" promise with two `ok: true` entries for what is actually one write
  landing twice (second write refreshes `updated` again, first body change is
  overwritten by an identical patch). No test currently exercises this. Today's
  only producer of `taskIds` is board-derived data (`TaskSpecSummary.id`, always
  the canonical folder-cased id), so there is no live path that triggers it —
  but the schema itself does not close the gap, and this batch's `Set` dedup is
  new code that inherited a pre-existing weakness in the shared guard rather
  than widening it.
- **Read-after-write staleness for the duration of the whole bulk call.**
  `deferNotify: true` means the SQLite-derived index is not reparsed until the
  single `applyFolderChange` in the `finally` (`tasks-rpc.handlers.ts:728-729`).
  A concurrent `tasks:board`/`tasks:list` call (or the pre-push webview) issued
  mid-bulk sees the PRE-bulk state for tasks whose bytes have already landed on
  disk. This is the explicit, intended trade of R5 (batch efficiency over
  read-during-write consistency) — not a defect — but it is a real window a
  paranoid caller should know about, and no test pins "board read mid-bulk is
  stale until the rebuild."

### 2. What user action causes unexpected behavior?

Selecting duplicate ids in a way that differs only by case (see above) is the
only user-triggerable path found, and it requires either a hand-crafted RPC
call or a future UI bug that fails to preserve canonical casing — not reachable
through today's board UI.

### 3. What data makes this produce wrong results?

Nothing in-scope produces a _wrong_ result once dedup and the write funnel are
reached; the case-duplicate scenario above produces a _misleading count_ (two
`ok: true` entries for one physical task) rather than corrupted carrier bytes,
because the second write still goes through the same pre-write re-read.

### 4. What happens when dependencies fail?

- `TaskWriterService.updateMetadata` failing per-task: fully handled — every
  typed failure (`TASK_NOT_FOUND`, `TASK_CONFLICT`, `TASK_EXCLUDED`,
  `WRITE_FAILED`, `INVALID_PARAMS`) becomes one result entry, loop continues
  (verified: mutation 4 reproduction below).
- `index.applyFolderChange` (the post-loop rebuild) failing: caught and
  logged, not thrown (`rebuildAfterBulk`, `tasks-rpc.handlers.ts:757-777`) —
  mirrors `TaskWriterService.notify`'s swallow-and-warn, verified by direct
  read of both call sites.
- **An UNEXPECTED throw mid-loop (not a typed `UpdateMetadataResult` failure,
  e.g. `index.ensureStarted` throwing, or a genuine bug) is caught by the outer
  `try/catch`, sanitized, and the WHOLE RPC call rejects.** Any results already
  pushed for earlier-succeeded ids in `results` are discarded — the caller gets
  no per-task information for tasks that already landed on disk, even though
  the architecture's entire stated purpose (D5, the docblock on
  `TasksBulkResultItem`) is "every task gets exactly one entry describing what
  happened to THAT task." The `finally` still rebuilds the index over the
  writes that landed (so the board self-heals on next reload), but the
  synchronous caller of this RPC call learns nothing about which of its N
  tasks succeeded before the crash. In practice this requires a genuine bug or
  infra failure (`ensureStarted`/`getMeta` throwing) since `updateMetadata`
  itself never throws — it catches its own fs errors and returns typed results
  — so likelihood is low, but the failure mode is real and not the same one the
  partial-failure design set out to close.

### 5. What's missing that the requirements didn't mention?

- No test pins the enrichment behavior for `TASK_EXCLUDED`/`WRITE_FAILED`
  (only `TASK_CONFLICT`-enriches and `TASK_NOT_FOUND`-does-not-enrich are
  tested); the ternary gate (`result.error.code === 'TASK_CONFLICT'`) makes
  this a one-line risk, but it's untested for two of the four non-conflict
  codes.
- Writes are issued strictly sequentially inside the loop rather than in
  parallel. This is a performance/latency choice, not a correctness bug (each
  distinct id after dedup is a distinct file, so parallelizing would be safe),
  and nothing in FR-C4 requires either. Noted for completeness, not a finding.

## Failure Mode Analysis

### Failure Mode 1: Case-duplicate dedup gap

- **Trigger**: A `taskIds` array containing the same physical task under two
  different letter-cases (e.g. `['TASK_2026_181', 'task_2026_181']`).
- **Symptoms**: Two `{ ok: true }` result entries for what is actually one
  task; the carrier's `updated` timestamp is bumped twice.
- **Impact**: Misleading result count to the caller (FR-C4.3 says one entry
  per task). No data corruption — the second write still passes through the
  pre-write re-read against its own prior write.
- **Current Handling**: `[...new Set(parsed.taskIds)]` — string-identity dedup
  only. `TaskIdRefSchema` does not canonicalize case.
- **Recommendation**: Non-blocking. If ever exposed to a caller that cannot
  guarantee canonical casing (e.g. a future CLI/MCP entry point that accepts
  free-typed ids), dedupe on a case-normalized key. Not worth blocking this
  batch — no current producer sends non-canonical casing.

### Failure Mode 2: Mid-loop unexpected throw discards already-computed results

- **Trigger**: Anything inside the `try` block throwing something other than
  a typed `UpdateMetadataResult` failure — e.g. `this.index.ensureStarted(root)`
  or a latent bug — after 1+ tasks have already succeeded.
- **Symptoms**: RPC call rejects with a sanitized generic error; caller
  receives zero per-task results despite N writes having landed on disk.
- **Impact**: Contradicts the "every task gets exactly one entry" design
  intent for this one narrow case. The board itself self-heals (the `finally`
  still rebuilds the index over whatever landed), so there is no permanent
  data problem — only a UI/caller information gap for that one response.
- **Current Handling**: Caught, sanitized, rethrown (`tasks-rpc.handlers.ts:
730-736`); `finally` still rebuilds if `written.length > 0`.
- **Recommendation**: Non-blocking. `updateMetadata` is designed to never
  throw (it wraps its own fs errors into typed results), so the trigger
  surface is effectively limited to index/DI-layer bugs. Worth a one-line
  comment acknowledging the residual gap if a future reviewer re-examines this
  path, but not worth restructuring the `try/catch` for a scenario that
  shouldn't be reachable under normal operation.

### Failure Mode 3: Read-during-write staleness window (accepted trade-off)

- **Trigger**: A `tasks:board`/`tasks:list` call, or a `tasks:changed` push
  consumer, racing a bulk call.
- **Symptoms**: Stale pre-bulk data for the duration of the bulk call.
- **Impact**: Cosmetic/UX only, resolves itself at the one `applyFolderChange`.
  This is the explicit and correct trade R5 makes (N rescans collapsed to 1).
- **Current Handling**: Intentional, documented in the handler's docblock.
- **Recommendation**: No fix needed. Documented here because a paranoid caller
  should know the window exists, not because it's a defect.

### Failure Mode 4: Untested enrichment gate for non-conflict, non-not-found codes

- **Trigger**: A bulk task hits `TASK_EXCLUDED` or `WRITE_FAILED`.
- **Symptoms**: None expected (the ternary correctly gates on `'TASK_CONFLICT'`
  only) — but this exact branch combination has no direct test.
- **Impact**: None currently; a future edit to the ternary's condition could
  regress silently for these two codes specifically.
- **Current Handling**: Code is correct by inspection; test coverage is
  partial (`TASK_CONFLICT` enriches — tested; `TASK_NOT_FOUND` does not
  enrich — tested; `TASK_EXCLUDED`/`WRITE_FAILED` not directly tested).
- **Recommendation**: Non-blocking test-coverage note for a future batch.

### Failure Mode 5: No frontend caller yet (scope-correct, not a defect)

- **Trigger**: N/A — this batch is explicitly backend-only ("Phase 7a: bulk
  status, backend half").
- **Symptoms**: `tasks:bulkUpdateStatus` has no production UI caller in this
  diff.
- **Impact**: None for this batch's scope; flagged only so the next batch's
  reviewer knows the RPC method is currently reachable only by direct call.
- **Current Handling**: N/A by design.
- **Recommendation**: None — correctly out of scope here.

## Non-Negotiables — Verified

| #   | Claim                                                                                                                         | Verification                                                                                                                                                                                                                                                                                                                                                                               | Result    |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | "atomic"/"transactional"/"all-or-nothing" absent from new code                                                                | `git diff` grep over all 7 changed files for these three terms — zero hits in added (`+`) lines. Whole-file grep found 4 hits, all confirmed pre-existing (outside the diff hunks, in code/docs untouched by this batch) by cross-referencing line numbers against the diff context.                                                                                                       | CONFIRMED |
| 2   | ≤1 board reload per bulk op, via `deferNotify: true` + one `finally` `applyFolderChange`                                      | Read `registerBulkUpdateStatus` (`tasks-rpc.handlers.ts:667-756`): loop passes `{ deferNotify: true }` on every call (line ~695); `finally` calls `rebuildAfterBulk(root, written[0])` once, only when `written.length > 0`. Confirmed by test + by mutation 5 (see below).                                                                                                                | CONFIRMED |
| 3   | `deferNotify` finally has a production caller (`registerBulkUpdateStatus`) since Batch 4 wired it test-only                   | `grep` for `deferNotify` across `task-specs/src/lib` (non-spec) shows it defined in `task-writer.service.ts` since before this batch (file untouched in this diff); `registerBulkUpdateStatus` is the first production call site passing it. Confirmed.                                                                                                                                    | CONFIRMED |
| 4   | Every write goes through the single funnel; pre-write re-read makes concurrency safe; bulk did not bypass/weaken/duplicate it | Read `TaskWriterService.updateMetadata` → `applyFrontmatterPatch` (`task-writer.service.ts:488-698`): read → parse → patch → pre-write re-read (byte compare) → write → notify-unless-deferred. `registerBulkUpdateStatus` calls `this.writer.updateMetadata(...)` — the same funnel `tasks:updateStatus`/`tasks:updateMetadata` use — once per distinct id, with no alternate write path. | CONFIRMED |

## The Vacuity-Guard Rewiring — Verified

`buildBulkSuite` in `tasks-rpc.handlers.spec.ts` wires the test's `TaskWriterService`
with a REAL `TaskIndexService` as its notifier (not `NoOpTaskIndexNotifier`),
matching production DI (`task-specs/src/lib/di/register.ts:82-84`:
`container.register(TASK_INDEX_NOTIFIER_TOKEN, { useToken: TaskIndexService })`).
The suite's own comment states the reasoning correctly: a `NoOpTaskIndexNotifier`
would make the rebuild count 1 whether or not `deferNotify` is passed, making
the R5 assertion pass against a handler that had silently dropped the flag.
Reproduced directly: with `deferNotify` genuinely dropped (mutation 5),
`applyFolderChange` is called 6 times, not 1 — the spy discriminates correctly
because it is wired to the same index instance production wires it to.

## Mutation Reproduction — All Five Confirmed Exactly As Claimed

Each mutation applied to `tasks-rpc.handlers.ts` (or the spec's harness for #1
only), run via `nx test @ptah-extension/rpc-handlers --testPathPattern=
tasks-rpc.handlers.spec.ts -t bulkUpdateStatus`, then restored and hash-verified
before the next mutation.

| #   | Mutation                                                    | Claimed                                                            | Reproduced                                                                                                                                        |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `armed = interleave` → `armed = false` in the spec harness  | 2 failed, first at `expect(suite.externalWrites()).toBe(1)`        | **Exact match.** `Tests: 2 failed`. First failure: `Expected: 1, Received: 0` at `tasks-rpc.handlers.spec.ts:2282`, the exact vacuity-guard line. |
| 2   | Conflict branch `ok: false` → `ok: true`                    | 2 failed                                                           | **Exact match.** `Tests: 2 failed`.                                                                                                               |
| 3   | Drop the `TASK_CONFLICT` enrichment spread                  | 1 failed                                                           | **Exact match.** `Tests: 1 failed`.                                                                                                               |
| 4   | `break` after pushing a failure result                      | 3 failed, incl. "writes the two tasks that come AFTER the refusal" | **Exact match.** `Tests: 3 failed`, including that named test.                                                                                    |
| 5   | Drop `{ deferNotify: true }` from the `updateMetadata` call | 5 failed, `Expected 1 / Received 6`                                | **Exact match.** `Tests: 5 failed`. `applyFolderChange` — `Expected number of calls: 1, Received number of calls: 6`.                             |

Post-mutation restore verified by SHA-256 for both files against hashes taken
before the window opened:

```
tasks-rpc.handlers.ts:      9da602af1cbd086c6a32731a9cc0f11d98029d7cfe4db254fe6e9453c1b459af
tasks-rpc.handlers.spec.ts: 8b7a1bf9419e7b6932d4d3fa5d20db1e09cae9bededb7bf0646a3d2e53d829e4
```

Both matched after every mutation cycle. Final clean, non-cached run:
`rpc-handlers` 1598 passed / 31 skipped / 1629 total.

## Adjudications

1. **Conflict enrichment reads through `index.getDetail(root, taskId)` rather
   than injecting `IFileSystemProvider` or hand-building a carrier path.**
   SOUND. Read `TaskIndexService.getDetail` (`task-index.service.ts:308-329`):
   it does `fs.exists` → `fs.readFile` → `parseTaskFile` on every call — a
   genuine disk re-read, not a store/cache lookup. `currentStatus` therefore
   reflects what's actually on disk right now, not a stale index snapshot.
   Verified this is NOT the SQLite-backed `store.listByWorkspace` path (which
   would be a genuine staleness risk) — `getDetail` bypasses the store entirely.
   The "don't put a fourth copy of the task.md layout in rpc-handlers"
   reasoning is also correct: `getDetail` already owns exactly that concern.

2. **`BULK_CHUNK_SIZE = 20` in `libs/shared/.../task-view.types.ts`, not
   `private static readonly` inside `TasksStore` per plan §6.2.** CORRECT
   deviation. Verified the schema enforces it server-side
   (`tasks-rpc.schema.ts: taskIds: z.array(taskIdRef).min(1).max(BULK_CHUNK_SIZE)`)
   and the same constant is the one a client-side chunker would import — one
   number, two enforcers, structurally incapable of drifting apart. The plan's
   private-static placement would have required the RPC boundary to either
   duplicate the number (drift risk) or trust the client's chunk size
   unbounded (the "silently unbounded in the other direction" failure the
   developer names). Sound call, correctly overriding the plan.

3. **`noop` declared but has no producer in this batch.** VERIFIED absent:
   grep + full read of `registerBulkUpdateStatus` confirms no code path sets
   `noop: true`; only the status write path exists here, and its docblock on
   `TasksBulkResultItem.noop` (`rpc-tasks.types.ts`) correctly attributes it
   to the future FR-C5.2 labels path and explains why status can't produce it
   without a pre-read that could go stale. Declaring it now (typed, undocumented
   producer) versus adding it later with FR-C5.2: a declared-but-unproduced
   optional field is the right call here specifically because the field is
   `noop?: boolean` (optional) and the type is shared infrastructure two
   features will both use — waiting to add it in Batch 13 would mean widening
   a wire type mid-feature instead of once, and every current consumer already
   treats it as absent-safe (optional). Not a liability as implemented.

4. **Duplicate ids de-duplicated, not rejected.** Verified: `[...new
Set(parsed.taskIds)]`, pinned by the "collapses a repeated id to one entry
   and one write" test. Correct per FR-C4.3 ("one entry per task"). See
   Failure Mode 1 above for the one gap in this dedup (case-sensitivity) —
   non-blocking.

5. **`applyFolderChange` takes one folder name; no consumer reads
   `folderNames`.** VERIFIED. `TaskIndexService.rebuild` (`task-index.service.ts:
407-444`) calls `this.scanner.scan(root)` unconditionally — `folderNames` is
   never used to scope the scan, only threaded into the fired change event.
   Traced the RPC broadcast (`broadcastChanged`, `tasks-rpc.handlers.ts:920-932`)
   and its one frontend consumer (`TasksStore.handleMessage`,
   `tasks-store.service.ts:576-596`): it reads only `payload.workspaceRoot`,
   never `folderNames`. Grepped the entire `libs/` and `apps/` trees for
   `folderNames` outside spec files — the only non-declaration usages are
   internal to `task-index.service.ts` and the one push assembly line in
   `tasks-rpc.handlers.ts`. Claim fully verified.

6. **Rebuild failures in the `finally` are logged and swallowed, mirroring
   `TaskWriterService.notify`.** VERIFIED by direct comparison:
   `TaskWriterService.notify` (`task-writer.service.ts:700-709`) and
   `rebuildAfterBulk` (`tasks-rpc.handlers.ts:757-777`) have the same shape —
   try/catch, `logger.warn`, swallow. Reasoning (writes already landed;
   throwing would replace a complete result list with an exception) is sound
   and consistent with the rest of this file's failure philosophy.

## Totals — Verified By Independent Reproduction, Not Trusted

| Project                                              | Claimed                                     | Reproduced (fresh, non-cached where noted)                                                                                               |
| ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@ptah-extension/shared`                             | 628 passed / 628 total (+0)                 | **628/628** — exact match                                                                                                                |
| `@ptah-extension/task-specs` (`nx test`)             | 357 passed / 23 skipped / 380 total (+6)    | **357/23/380** — exact match                                                                                                             |
| `@ptah-extension/task-specs` (`npm run test:native`) | 380/380, 0 skipped                          | **380/380, 0 skipped** — exact match, run under Electron's ABI-matched Node so the SQLite suites genuinely execute rather than self-skip |
| `@ptah-extension/rpc-handlers`                       | 1598 passed / 31 skipped / 1629 total (+23) | **1598/31/1629** — exact match (both cached and forced `--skip-nx-cache` runs)                                                           |

**On the developer's stated deltas (+6, +23) being arithmetic from its own
additions rather than a measured HEAD baseline diff**: the right call. A true
HEAD-baseline comparison would require either (a) `git stash`, explicitly
forbidden here because a concurrent session is actively staging unrelated
foreign changes into the same shared index and a stash could interact badly
with that staging, or (b) a `git worktree`/checkout of HEAD in a second
location, which is more machinery than the claim warrants. Stating the deltas
as arithmetic and saying so explicitly — rather than presenting them as
measured — is the honest and correct choice given the concurrent-staging
constraint; I found no case where the stated arithmetic was wrong once I
independently ran the actual current-tree totals (which is the number that
matters for gating this batch).

## Requirements Fulfillment

| Requirement                                                  | Status   | Concern                                                                                                                       |
| ------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FR-C4.3 (one entry per task, request order)                  | COMPLETE | Case-sensitivity dedup gap noted (Failure Mode 1), non-blocking, no live trigger today                                        |
| FR-C4.7 (conflict enrichment with current status)            | COMPLETE | Verified genuine disk re-read, not cache                                                                                      |
| FR-C4.9 (chunk cap)                                          | COMPLETE | Single-source `BULK_CHUNK_SIZE`, enforced both ends                                                                           |
| FR-C4.10 / R5 (one rebuild per call)                         | COMPLETE | Verified by direct mutation (5 failed when dropped)                                                                           |
| D5 (no boolean success flag)                                 | COMPLETE | `TasksBulkUpdateStatusResult` has no top-level flag                                                                           |
| BR-1 (no `ALLOWED_METHOD_PREFIXES`/manifest edit)            | COMPLETE | Zero diff to both files; `'tasks:'` prefix and `TasksRpcHandlers.METHODS`-derived manifest entry already cover the new method |
| BR-5 (no `renderFrontmatterBlock` change)                    | COMPLETE | File not in diff                                                                                                              |
| BR-6 (no backfill/normalization)                             | COMPLETE | `adoptFolder`/`registry-generator.service.ts` not in diff                                                                     |
| BR-7 (no forbidden path literals)                            | COMPLETE | Zero hits for `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_` in the diff                                                |
| BR-14 (shared `TaskIdRefSchema`, not the plan's weak sketch) | COMPLETE | `taskIdRef = TaskIdRefSchema` imported from shared, used per-element in the new array schema                                  |

### Implicit Requirements Not Fully Addressed (non-blocking)

1. No test pins "an unexpected mid-loop throw still exposes zero results to
   the caller despite writes having landed" — the behavior is arguably correct
   (fail closed on unexpected error) but undocumented as an explicit contract.
2. No test pins the read-during-write staleness window explicitly (implied by
   the "one rebuild" tests, not directly asserted as "a concurrent board read
   mid-bulk is stale until the rebuild").

## Edge Case Analysis

| Edge Case                                          | Handled                                           | How                                                                   | Concern                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty `taskIds`                                    | YES                                               | `.min(1)` on the array schema → `INVALID_PARAMS`, writer never called | None                                                                                                                                                                           |
| `taskIds.length > BULK_CHUNK_SIZE`                 | YES                                               | `.max(BULK_CHUNK_SIZE)` → `INVALID_PARAMS`                            | None                                                                                                                                                                           |
| One bad id among valid ones                        | YES                                               | Whole-array Zod validation refuses the entire call before any write   | Matches the "no nineteen writes issued around a bad twentieth" design                                                                                                          |
| Exact-string duplicate id                          | YES                                               | `Set` dedup, one entry, one write                                     | None                                                                                                                                                                           |
| Case-varying "duplicate" of the same physical task | NO                                                | `Set` dedup is string-identity only                                   | Failure Mode 1 — non-blocking, no live trigger                                                                                                                                 |
| Conflict on the first id                           | Implied YES (not directly fixtured at position 1) | Same code path as the middle-position fixture                         | Low risk — position-independent logic, but only middle and (via the "leaves the contended carrier exactly..." + not-found tests) edge positions are directly fixtured          |
| Conflict on the last id                            | NO explicit fixture                               | Same code path                                                        | Low risk, same reasoning as above                                                                                                                                              |
| Missing task (`TASK_NOT_FOUND`)                    | YES                                               | Tested directly, no rebuild triggered, no enrichment                  | None                                                                                                                                                                           |
| Zero successful writes in the whole call           | YES                                               | `written.length > 0` gate — `applyFolderChange` not called            | Tested directly                                                                                                                                                                |
| Rebuild throws                                     | YES                                               | Caught, logged, swallowed                                             | Tested via code-parity with `TaskWriterService.notify`; not directly fixtured with a throwing spy in this batch's tests (existing pattern elsewhere in the codebase, low risk) |

## Integration Risk Assessment

| Integration                                              | Failure Probability | Impact                                                                                                  | Mitigation                                                                              |
| -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `TaskWriterService.updateMetadata` (the funnel)          | LOW                 | Contained — typed result per task                                                                       | Pre-write re-read; unchanged from Batch 4, proven by five direct mutation reproductions |
| `TaskIndexService.applyFolderChange` (post-loop rebuild) | LOW                 | Stale index until next successful rebuild                                                               | Swallowed + logged; full rescan self-heals on the next call                             |
| `TaskIndexService.getDetail` (conflict enrichment)       | LOW                 | Missing `currentStatus`, not a wrong one                                                                | Returns `null` → empty enrichment object on any read/parse failure; never guesses       |
| Concurrent bulk calls on overlapping id sets             | LOW                 | Second call's pre-write re-read sees the first call's already-written bytes and reports `TASK_CONFLICT` | No lost-update risk; same mechanism single-task writes already rely on                  |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: The case-insensitive duplicate-id dedup gap (Failure Mode 1) —
real but currently untriggerable by any producer in this codebase, since every
existing `taskIds` source is board-derived canonical-case data.

## What Robust Implementation Would Include (beyond what's here)

- A case-normalized dedup key if/when `bulkUpdateStatus` ever gets a
  free-typed-id caller (CLI/MCP), rather than `Set` over raw strings.
- A documented contract for the mid-loop-throw case: either "results already
  computed are best-effort lost on a genuine exception" stated explicitly next
  to the `catch`, or (bigger change) accumulate-then-throw semantics that
  return whatever was computed alongside the error. Given `updateMetadata`
  itself is designed to never throw, this is a defense-in-depth nicety, not a
  gap that needs closing before shipping this batch.
- Direct fixtures for a conflict landing on the FIRST and LAST id (not just
  the middle), and for `TASK_EXCLUDED`/`WRITE_FAILED` explicitly not
  triggering enrichment — currently covered by code inspection and the
  ternary's obvious correctness, not by dedicated tests.

## Confirmation That the Mutation Window Is Closed

Both mutated files verified byte-identical (SHA-256) against their
pre-mutation hashes after every mutation cycle. Final state confirmed with a
**fresh, non-cached** `nx test @ptah-extension/rpc-handlers --skip-nx-cache`
run: **1598 passed / 31 skipped / 1629 total, 71/71 suites passed.**
**MUTATION WINDOW CLOSED.**
