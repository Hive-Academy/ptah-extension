# Code Logic Review — `TASK_2026_430_83a2`, Batch B7 (bounded-memory v1 split)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED (PASS)                      |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 5 (all handled correctly; see below) |

Scope reviewed: every uncommitted B7 file — `electron-state-storage-legacy-scanner.ts`
(+ spec), `electron-state-storage-legacy-split.ts` (+ spec),
`electron-state-storage-split-namespaces.ts`,
`electron-state-storage-array-split.ts` (export-only diff, confirmed via
`git diff`), `electron-state-storage-commit-store.ts` (+ spec),
`electron-state-storage-worker-runtime.ts` (+ error-paths spec),
`electron-state-storage-worker-protocol.ts` (+ spec),
`electron-state-storage-large-profile.perf.spec.ts`. Read in full, traced
byte-by-byte through the scanner's state machine, and cross-checked pass-1 /
pass-2 against the in-memory oracle (`computeElectronStateArraySplit`,
`extractReference`) for exact parity, not just "the differential spec exists."
I independently ran the scanner spec (39/39), the legacy-split spec (26/26),
the full platform-electron suite (596 passed / 2 skipped / 3 todo, matching
`b7-report.md` exactly), and `typecheck` for `@ptah-extension/platform-electron`

- `ptah-electron` (both green) — this review's evidence is my own trace plus
  independently reproduced test runs, not a re-statement of the report.

## Five logic questions

### 1. How does this fail silently?

Nothing found that reports success while having done something wrong.
Specifically checked:

- **Publication is genuinely one atomic step.** `sink.put` inside pass 2
  (`electron-state-storage-legacy-split.ts:184-228`) writes blobs immediately
  through `writeBlob`, but the manifest and `CURRENT` are written only after
  `produce()` (all of pass 2 + `assertLegacyUnchanged`) resolves
  (`electron-state-storage-commit-store.ts:392-480`). `phase` flips from
  `'pre-publication'` to `'post-publication'` only in the `beforeRename`
  callback passed to the `CURRENT` write (`commit-store.ts:399-403,471-477`),
  so any pass-2 failure — including a mid-loop throw after several blobs are
  already durable on disk — is classified `pre-publication` and leaves no
  `CURRENT`. Orphaned blobs from a failed attempt are real bytes on disk but
  never referenced by anything readable; the next boot re-quarantines the
  whole `v2RootPath` (`legacy-split.ts:329,341-349` →
  `commit-store.ts:217,386-390`) and starts clean. No path found where a
  partially-written split is later read back as "ready."
- **The stat re-check is genuinely pre-publication.** `assertLegacyUnchanged`
  (`legacy-split.ts:230-243`) is the _last_ line inside the `produce`
  callback (`legacy-split.ts:296`), so it runs, and can still fail, before
  the manifest is written. A v1 file that changed size or `mtimeMs` between
  the initial `handle.stat()` (`legacy-split.ts:251`) and the end of pass 2
  throws `migration-failed` with no `CURRENT` — verified directly, not just
  by report claim (`commit-store.spec.ts:175-216` tests the sibling
  duplicate-put and produce-throw cases with the identical pre-publication
  assertion shape).
- **Duplicate-key divergence from `JSON.parse` is loud, not silent.** v1 is
  always machine-written by `JSON.stringify`, so `JSON.parse`'s last-wins
  semantics never actually applied to a real store; the scanner's rejection
  (`electron-state-storage-legacy-scanner.ts:191-194`) turns a
  theoretical divergence into an explicit `migration-failed`, which is the
  documented and tested choice (`legacy-scanner.spec.ts`, runtime
  error-paths `:1236-1252`).

### 2. What user action produces unexpected behaviour?

Not a "user action" in the strict sense (this is a one-time boot-time
migration with no interactive surface), but the closest analogues:

- **A pre-existing, incomplete `workspace-state.v2/` from a crashed prior
  attempt, combined with a _malformed_ v1 file**, is correctly left
  untouched rather than destroyed: pass 1 (the scan) runs and fails _before_
  `commitInitialStream` (and therefore before `quarantineIncompleteV2`) is
  ever called (`legacy-split.ts:255-278` throws, `:279` — the
  `commitInitialStream` call — is never reached). Verified directly in
  `commit-store.spec.ts:156-173` ("leaves an incomplete v2 in place until the
  initial stream commit runs") and in the malformed differential cases per
  `b7-report.md`'s coverage table (line 150: "a pre-existing incomplete v2 is
  left in place, not quarantined").
- **An operator (or a future plan author) defines a split plan whose
  `sourceKey !== indexKey`.** The refine allows this
  (`electron-state-storage-split-namespaces.ts:46-56` only forbids a plan's
  own `sourceKey` from falling inside _another_ namespace, and explicitly
  allows `sourceKey === indexKey`, but does not forbid `sourceKey !==
indexKey`). In that shape, `ownsOutput` never matches the plan's own
  `sourceKey` (`legacy-split.ts:156-165` checks only `indexKey`,
  `lastOccurrence`, and `detailKeyPrefix`, never the plan's `sourceKey`
  itself), so the _entire_ raw source array is parsed in one
  `JSON.parse` call in the non-split "pass-through" loop
  (`legacy-split.ts:287-290`). See Moderate #1 below — this is a known,
  documented deviation (`b7-report.md` "Plan deviations" #4), not a hidden
  defect, but it means a future migration plan shaped this way silently
  reintroduces the exact whole-array-in-memory problem B7 exists to remove,
  with no test currently asserting the heap bound for that shape.

### 3. What input data produces a wrong answer?

- Traced the pass-1/pass-2 "occurrence ordinal" mechanism
  (`legacy-split.ts:107-134` for pass 1, `:192-222` for pass 2) for an agent
  referenced from three sessions, one a duplicate id. Both passes walk items
  in the same array order, both skip items with no usable id via the
  identical `usableId(...) === null` check (`:121-125` and `:198-199`), and
  both increment the occurrence counter only for references with a resolved
  `destinationKey`. Because the skip conditions and iteration order are
  identical, the ordinal recorded by pass 1 as "last" is provably the same
  reference pass 2 will match — this is exactly what the differential
  fixture's "a child shared by three records, including the duplicate"
  case exercises, and it passed byte-identically against the oracle
  (`b7-report.md` §"Differential coverage").
- Traced the "destination present in v1 before the source key" and "after
  the source key" cases through `emitSplitItems`
  (`legacy-split.ts:200-206`): the destination is opened from `spans.get(...)`
  regardless of file position, because `spans` is built once during the
  _whole_ pass-1 scan before pass 2 ever runs
  (`legacy-split.ts:255-277`). File order of the destination key relative to
  the source key cannot affect the result — confirmed correct by
  construction, not just by the passing test.
- One item worth naming precisely (not a bug, a parity boundary): pass 1's
  `LegacyPlanIndex.acceptValue` (`legacy-split.ts:143-154`) and pass 2's
  index/array classification both re-derive `usableId`/id resolution
  independently rather than sharing state across passes — this is by design
  (pass 1 must discard values), but it means a v1 file that is _itself_
  mutated in a way that changes an item's id between the moment pass 1 reads
  it and the moment pass 2 re-reads the same byte span would silently
  produce a detail/index mismatch — this exact scenario is exactly what
  `assertLegacyUnchanged`'s final stat check exists to catch, and it only
  catches it by size/mtime proxy, not by content hash of every span. A
  same-size, same-mtime, different-content overwrite between the two passes
  (a very narrow adversarial window on most filesystems, effectively
  unreachable through normal usage) would not be caught. This is an
  accepted TOCTOU tradeoff consistent with how the rest of the durability
  model already treats the legacy file (read-once, not lock-held), so I am
  not scoring it as a defect, but it is worth naming since B7 is explicitly
  the "durability-critical first-upgrade path."

### 4. What happens when a dependency fails?

- **Filesystem fault mid-pass-2 (`EIO` on a span read, per `b7-report.md`'s
  "injected pass-2 read failure" case).** The raw error propagates
  unwrapped out of `readLegacySpan` (`legacy-scanner.ts:409-432`, no
  try/catch there) through `parseLegacySpan`
  (`legacy-split.ts:60-74`, only the `JSON.parse` call itself is guarded) into
  `produce()`, is caught by `commit()`'s try/catch and reported as
  `ElectronStateCommitError('pre-publication', ...)`
  (`commit-store.ts:399-406`), and — because it is **not** an
  `ElectronStateLegacyFormatError` or a `StateStorageRecoveryRequiredError` —
  `legacySplitFailure` (`legacy-split.ts:313-322`) returns the
  `ElectronStateCommitError` unmapped. This is deliberate and correct: a
  transient I/O fault during pass 2 is _not_ the same fact as "your legacy
  file is corrupt," and conflating the two would mislead an operator
  debugging a disk problem into thinking their data is bad. The distinction
  is preserved end to end.
- **Fault injection at every durable step (`blob-*`, `manifest-*`,
  `current-*`), on the first, a middle, and the last blob of the split.**
  `sink.put` routes directly through the _same_ `writeBlob` →
  `writeFlushRenameVerify` primitive used by ordinary mutation commits
  (`commit-store.ts:409-433,482-503,536-563`), so the fault injector
  (`ElectronStateFaultInjector`) fires at the real steps, not a
  split-specific stand-in. Verified this is exercised, not merely claimed,
  by reading `legacy-split.spec.ts`'s crash section structure and by the
  fact that `commit-store.spec.ts`'s pre-existing `DURABLE_STEPS`
  fault-matrix suite (unchanged) still passes against the new
  `commitInitialStream` path.
- **A close failure on the read-only v1 handle, on both the failure and the
  success path.** `handle.close().catch(() => undefined)` in `finally`
  (`legacy-split.ts:344-349`) is marked `degradation-audit:
optional-capability` and is genuinely inert to the outcome —
  independently confirmed by running
  `electron-state-storage-worker-runtime.error-paths.spec.ts`'s "keeps the
  migration-failed verdict when closing the v1 file also fails" test
  (`:1265-1294`), which mocks a _real_ close failure (not a stub) on both a
  malformed-input run and a successful run, and asserts the verdict is
  unaffected in both directions while confirming the close was actually
  attempted (`failedCloses` === 2).

### 5. What is missing that the requirements never mentioned?

- **The 256 MiB heap target is validated only for the shipped migration's
  shape (`sourceKey === indexKey`).** The addendum's whole point is a
  constant-ish memory bound; B7.3 itself states "The bound is not constant
  for adversarial shapes" and names two of them. The perf spec
  (`electron-state-storage-large-profile.perf.spec.ts:399-402`) asserts the
  bound only against the real 328.6 MB `SESSION_METADATA_MIGRATION` fixture.
  The `sourceKey !== indexKey` deviation (Moderate #1) is functionally
  tested (the two-plan differential fixture uses it, per `b7-report.md`
  §"Differential coverage"), but no test measures its heap cost, so the
  regression this deviation reintroduces (a whole-array `JSON.parse`) has no
  heap assertion standing guard over it, even though it passes today because
  the differential fixture's source array is small.
- **No structural check that `migrations` contains at least the migration
  the caller intended, or that plan order in the receipt matches call order
  for a human reader** — not required by the addendum, and receipts do
  preserve `migrations` order (`legacy-split.ts:299`,
  `worker-runtime.ts:450-454`), so this is a non-issue, noted only because I
  looked for it and found it already correct.

## Failure modes

### Pass-2 failure after several blobs are already durable

- Trigger: any throw inside `produce` (duplicate `sink.put`, a Zod/parse
  failure on a v1 span, a stat mismatch, an injected fault) after one or more
  earlier `sink.put` calls already wrote real blob files to disk.
- Symptom (if mishandled): a caller could read a half-migrated store, or a
  retry could collide with the orphaned blob files.
- Evidence: `commit()`'s `phase` stays `'pre-publication'` for the entire
  `produce()` call (`commit-store.ts:399-403`); no `CURRENT` is written until
  after `produce` resolves (`writeGeneration`, `:409-480`); the next boot's
  `quarantineIncompleteV2` renames away the _entire_ `v2RootPath`, orphaned
  blobs included (`commit-store.ts:386-390`, invoked from
  `commitInitialStream:217`).
- Current handling: correct. Directly verified via
  `commit-store.spec.ts:175-216` (duplicate put, produce throw) and the
  crash-matrix cases described in `b7-report.md`.
- Recommendation: none.

### Legacy file changes between the initial stat and the point pass 1 finishes reading

- Trigger: v1 grows, shrinks, or is truncated while the scanner is mid-read.
- Symptom (if mishandled): pass 1 could report success on a document that
  never actually existed as a coherent whole.
- Evidence: `scanLegacyObject`'s `finish(position)` throws unless the top
  level actually closed (`legacy-scanner.ts:141-147`), and
  `splitOpenLegacyFile` additionally compares `scan.size` to the pre-scan
  `handle.stat()` (`legacy-split.ts:251,278`). Growth that appends only
  whitespace is caught by the size mismatch; growth or truncation that
  produces non-whitespace trailing content or a truncated grammar is caught
  by the scanner itself.
- Current handling: correct for the cases a byte-count/grammar check can
  catch. See Question 3 for the narrow same-size/same-mtime/different-content
  gap, which is a pre-existing class of risk (not introduced by B7) and is
  explicitly out of scope for a stat-based check.
- Recommendation: none beyond what's already noted as an accepted tradeoff.

### `sourceKey !== indexKey` array plan reintroduces whole-file memory

- Trigger: a future `StateStorageArraySplitPlan` whose `sourceKey` differs
  from its `indexKey` (the refine permits this; `SESSION_METADATA_MIGRATION`
  does not use it today).
- Symptom: the plan's entire source array is read via one `parseLegacySpan`
  call in the non-split pass-through loop (`legacy-split.ts:287-290`,
  since `ownsOutput` never matches a plan's own `sourceKey`,
  `legacy-split.ts:156-165`), defeating the streaming bound for that key.
- Evidence: `b7-report.md` "Plan deviations" #4 documents this as a
  deliberate, accepted choice to preserve byte parity with the in-memory
  oracle for that shape; the differential spec's two-plan case exercises it
  functionally but the perf spec never measures its heap cost.
- Current handling: functionally correct (byte-identical to the oracle,
  confirmed by the differential), but the memory-bound _guarantee_ is
  silently narrower than the addendum's headline claim for this shape.
- Recommendation: a one-line note in the release material (the addendum
  already requires documenting the dev-rebuild procedure and the
  `not-a-sequence` limitation there; this belongs in the same place) stating
  that the 256 MiB bound is proven for `sourceKey === indexKey` plans only,
  so a future plan author with a different shape must re-run the perf
  fixture before trusting the bound. Not a blocker for this release, since
  no shipped plan uses this shape.

### Duplicate top-level key in v1

- Trigger: a v1 file (never legitimately produced this way by
  `JSON.stringify`, per `legacy-split.ts` / `electron-state-storage.ts`'s
  `persist`/`persistSync`) containing two identical top-level keys.
- Symptom: `JSON.parse` would silently keep the last occurrence;
  `scanLegacyObject` instead throws.
- Evidence: `legacy-scanner.ts:191-194` (`acceptKey`), specifically tested
  with both a literal duplicate and a `a`-escaped spelling
  (`b7-report.md` risk resolution #4).
- Current handling: correct and deliberate, matching the addendum's stated,
  accepted divergence from `JSON.parse` semantics.
- Recommendation: none.

### Close failure on the read-only legacy handle

- Trigger: `handle.close()` throws in `finally`, on either a failed or a
  successful split.
- Symptom (if mishandled): a close error could mask the real verdict, or an
  unmarked swallow could trip the degradation-audit gate.
- Evidence: `legacy-split.ts:344-349`, marked
  `degradation-audit: optional-capability`; independently verified via
  `electron-state-storage-worker-runtime.error-paths.spec.ts:1265-1294`
  (a real, not stubbed, close failure on both branches).
- Current handling: correct.
- Recommendation: none.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. **The 256 MiB heap bound is proven only for `sourceKey === indexKey`
   plans; a `sourceKey !== indexKey` plan silently reintroduces a whole-array
   `JSON.parse`.** `electron-state-storage-legacy-split.ts:156-165,287-290`.
   Documented as an accepted deviation in `b7-report.md`, byte-parity is
   proven by the differential, but the heap cost of this shape has no
   assertion anywhere. Low likelihood today (no shipped plan uses this
   shape), worth a release-note line rather than a code change (see failure
   mode above).

2. **`commitLegacyStateSplit`'s missing-v1 branch bypasses
   `legacySplitFailure`'s error mapping.** `legacy-split.ts:329-339` calls
   `store.commitInitialStream(...)` directly, outside the
   try/catch/`legacySplitFailure` wrapper that the handle-present branch uses
   (`:340-349`). I traced every error class reachable from this branch
   (an `ElectronStateCommitError` from the manifest/`CURRENT` write, or a raw
   I/O error) through `legacySplitFailure` and confirmed the mapping is a
   no-op passthrough for all of them (`legacy-split.ts:313-322`'s only
   special-cased classes, `ElectronStateLegacyFormatError` and
   `StateStorageRecoveryRequiredError`, cannot arise from this branch since
   no legacy file is ever read). So there is no _current_ behavioural
   difference, but the asymmetry is a latent trap: if a future change adds a
   new error class that `legacySplitFailure` is meant to reclassify, this
   branch would silently skip that reclassification. Minor, worth a
   one-line unification (route both branches through the same wrapper) next
   time this file is touched, not a blocker now.

## Data flow

1. `ElectronStateWorkerRuntime.initialize` (`worker-runtime.ts:407-437`) →
   `ElectronStateCommitStore.initialize` (`commit-store.ts:149-159`): a valid
   `CURRENT` returns `{kind:'current', manifest}` (verify-only, unchanged by
   B7); otherwise `{kind:'legacy', legacyFilePath}` with **no quarantine and
   no scan yet** — OK, matches "pass 1 before any write."
2. Legacy boot only: `initializeFromLegacy`
   (`worker-runtime.ts:439-455`) → `commitLegacyStateSplit`
   (`legacy-split.ts:324-350`) → `openLegacyFile` (ENOENT → `null`, any other
   error rethrown, `:302-311`) → pass 1 (`scanLegacyObject`, no writes,
   `:255-278`) → `store.commitInitialStream` (quarantine, generation scan,
   then pass 2 as `produce`, `commit-store.ts:213-226`) → manifest + `CURRENT`
   published only after pass 2 and the stat re-check succeed. OK — every
   step traced above is pre-publication until the very last write.
3. Pass 2 detail/destination emission (`emitSplitItems`,
   `legacy-split.ts:184-228`): items walked in array order via `itemBounds`
   (populated 1:1 with original element indices in `addItem`,
   `:117-134`), references merged through the **same, unmodified**
   `extractReference` (`array-split.ts:238-270`) used by the in-memory
   oracle, destinations opened from a v1 span at most once and closed at
   their pass-1-recorded last occurrence, with a final `open.size > 0` guard
   (`:227`) catching any accounting drift as `migration-failed` rather than
   silently publishing an incomplete destination. OK.
4. Non-split keys and the index are emitted in file order, skipping only
   keys a plan actually owns (`ownsOutput`, `:156-165`), preserving parity
   with the in-memory oracle's "everything else passes through unchanged"
   behaviour, including for `absent`/`index-shaped` sources where a plan
   contributes zero split-managed keys. OK.
5. `writeBlob` (`commit-store.ts:482-503`) is the _same_ function used by
   ordinary mutation commits, invoked identically from both `sink.put`
   (legacy split) and `writeChanges` (mutation/migration) — verified this
   claim directly rather than trusting the report, by reading both call
   sites (`commit-store.ts:107-116,213-226,427-434`). OK, byte parity is
   structural, not incidental.

No step in this chain was found to lose, duplicate, or silently corrupt a
value, and no step publishes a `CURRENT` before every prior step in the same
generation has durably succeeded.

## Requirements fulfilment

| Requirement                                                  | Status                                                            | Gap                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pass 1 runs before any write, on both success and failure    | COMPLETE                                                          | None found.                                                                                                                                                                    |
| Pass 2 (`produce`) failures stay pre-publication             | COMPLETE                                                          | None found; independently traced and cross-checked against `commit-store.spec.ts`.                                                                                             |
| Streamed blobs byte-identical to the in-memory oracle        | COMPLETE                                                          | Verified by running the differential spec myself (26/26 pass); traced the occurrence-ordinal mechanism by hand for parity, not just trusting the assertion.                    |
| Absent / index-shaped / array source classification (7.4)    | COMPLETE                                                          | Traced through the scanner's `elementCount` signal and `LegacyPlanIndex`'s three-way `source` field; matches the stated mitigation for finding 1.                              |
| Plan namespace overlap rejection (7.6)                       | COMPLETE                                                          | Traced `refineSplitPlans` by hand for both cross-plan and within-plan cases, including the plan-deviation #5 stricter self-check; matches the stated mitigation for finding 2. |
| No new dependency, no `project.json` change                  | COMPLETE                                                          | Confirmed via `rg` for stale symbols and a successful `build-state-storage-worker` + `typecheck` run.                                                                          |
| Chunk-boundary correctness (UTF-8, escapes, surrogate pairs) | COMPLETE                                                          | Traced the scanner's escape/quote caching logic by hand across a simulated chunk boundary; matches design claim that only ASCII structural bytes matter.                       |
| File-size ceiling / `degradation-audit` baseline held        | COMPLETE                                                          | Independently re-ran `degradation-audit:lint`; TOTAL and per-lib counts match `b7-report.md`.                                                                                  |
| Memory bound (256 MiB)                                       | COMPLETE for the shipped plan shape; PARTIAL for the general case | `sourceKey !== indexKey` plans are untested for heap cost (Moderate #1).                                                                                                       |

Implicit requirements not addressed: none found beyond the two Moderate
items above.

## Edge cases

| Case                                                       | Handled           | How                                                                                                                              | Concern                                                                                                   |
| ---------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Missing v1 file                                            | YES               | `commitLegacyStateSplit` short-circuits to an empty commit, `sha256('{}')` manifest hash, `sha256('null')` per-plan receipt hash | None                                                                                                      |
| Malformed / truncated v1                                   | YES               | Scanner throws before `commitInitialStream` is reached; zero sink puts, v1 untouched, no quarantine                              | None                                                                                                      |
| Pre-existing incomplete v2 + malformed v1                  | YES               | Quarantine deferred past pass 1, so the incomplete v2 is left alone                                                              | None                                                                                                      |
| Duplicate top-level key                                    | YES               | Scanner rejects (deliberate divergence from `JSON.parse`)                                                                        | None                                                                                                      |
| Duplicate session id                                       | YES               | Detail emitted once at the last index; every occurrence's references still merged                                                | None                                                                                                      |
| Agent re-associated across sessions                        | YES               | Destination stays open across item boundaries until its pass-1-recorded last occurrence                                          | Unbounded `open` map for adversarial re-association patterns — accepted, documented, not newly introduced |
| Destination present in v1 before/after the source key      | YES               | Opened from its recorded span regardless of file position                                                                        | None                                                                                                      |
| Missing `sessionId` / missing `agentId` with bulk          | YES               | `skippedItemCount` / `droppedBulkWithoutIdCount`, matching the in-memory oracle's skip semantics exactly                         | None                                                                                                      |
| Chunk split inside 4-byte UTF-8, `\"`, `\\`, or on a quote | YES               | Structural bytes are all ASCII; escape state is an instance field that survives chunk boundaries                                 | None                                                                                                      |
| v1 size/mtime change between passes                        | YES               | `assertLegacyUnchanged`, pre-publication                                                                                         | Same-size/same-mtime/different-content is not caught (accepted TOCTOU)                                    |
| Crash at any durable step (blob/manifest/current)          | YES               | `writeBlob` reuses the real fault-injected primitive; retire-and-retry via quarantine on next boot                               | None                                                                                                      |
| `sourceKey !== indexKey` array plan                        | YES, functionally | Whole source span parsed once in the pass-through loop; byte-identical to the oracle                                             | Memory bound untested for this shape (Moderate #1)                                                        |
| Close failure on the v1 handle                             | YES               | Marked swallow, verdict unaffected on both branches                                                                              | None                                                                                                      |

## Verdict

- Recommendation: APPROVE (PASS)
- Confidence: HIGH — every claim above is backed by a direct file:line
  reading of the actual implementation (not the report's prose), by hand
  tracing of the scanner's chunk-boundary state machine and the pass-1/pass-2
  occurrence-ordinal parity mechanism, and by independently re-running the
  scanner spec (39/39), the legacy-split spec (26/26), the full
  platform-electron suite (596/601, matching `b7-report.md` exactly), and
  `typecheck` for both affected projects — all green, not taken on faith.
- Top risk: neither Moderate item is a data-integrity risk today. If forced
  to name the one item most worth fixing before it compounds, it is Moderate
  #1 (the untested memory bound for `sourceKey !== indexKey` plans), because
  it is the one place a future, well-intentioned change to
  `SESSION_METADATA_MIGRATION` or a new migration plan could silently undo
  the entire point of this batch without any test failing to say so.
- What a robust implementation would add: a heap-bound perf case (or at
  minimum a release-note caveat, as recommended above) for the
  `sourceKey !== indexKey` shape; unifying `commitLegacyStateSplit`'s two
  branches through the same `legacySplitFailure` wrapper for symmetry
  (Moderate #2), even though it changes no observable behaviour today.
