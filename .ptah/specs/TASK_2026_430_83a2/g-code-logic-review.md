# Code Logic Review — `TASK_2026_430_83a2`, Batch G

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | PASS (APPROVED)                      |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 3                                    |
| Failure modes found | 4 (all handled correctly; see below) |

Scope reviewed: every uncommitted file under Batch G (commit-store, worker-loop,
worker.ts bootstrap, value-store, array-split, worker-runtime, worker-protocol,
worker-host, electron-state-storage.ts facade, the platform-core maintenance
interface, the `SESSION_METADATA_MIGRATION` literal edit in
`session-metadata-store.ts` — confirmed via `git diff` to be _only_ that
literal, 7 lines, nothing else in that file), plus the B0 regression specs and
every new/modified spec in the group. Read in full, not by diff hunks. This is
a genuinely large, structurally careful piece of work; the finding count below
is short because the design is sound and the tests actually exercise the fault
paths they claim to, not because the review was shallow — see the file:line
evidence trail through commit-store, runtime, protocol and host below.

## Five logic questions

### 1. How does this fail silently?

Nothing found that fails silently while looking like success. Specifically
checked and ruled out:

- A commit that durably lands but whose confirming reply is lost never reports
  `success` to the original caller — `commitChanges` (`electron-state-storage-worker-runtime.ts:514-537`)
  only calls `this.adopt(manifest)` on the happy path; every catch path
  throws through `reconcile` (`:539-572`), and even the `landed: true` branch
  returns an `ElectronStateWorkerOperationError('commit-failed', {landed:true})`
  — still an error to the caller, never a masked success.
- The host's `requireCommitted` (`electron-state-storage-worker-host.ts:674-683`)
  refreshes the touched cache keys _before_ throwing for every code in
  `UNCERTAIN_COMMIT_CODES`, so a caller who catches the error and then reads
  the key back gets the durable truth, not a stale cache entry papering over
  the failure.
- `ElectronStateStorage`'s write wrappers (`update`, `replaceJsonSequence`,
  `splitArrayValue`) now re-sync `this.data = workerHost.getCache()` inside a
  `finally`, not only on the success path (`electron-state-storage.ts:146-166,232-244,252-259`).
  The `git diff` (checked directly) confirms this is a **real fix in this
  batch**: on `main` the re-sync ran unconditionally _after_ the `await`,
  which never executed on a throw, so a failed write used to leave `this.data`
  silently stale for every subsequent synchronous `get()`/`keys()` call. This
  batch closes that gap.

### 2. What user action produces unexpected behaviour?

- A `read-scalar-page` continuation sent with a **different or absent**
  projection than the initial `get` is rejected as `cursor-stale`
  (`worker-runtime.ts:634-644`), not silently served with the wrong shape.
  Verified against a live fixture in `electron-state-storage-worker-runtime.error-paths.spec.ts:1114-1142`
  and end-to-end through `ElectronStateStorage` in
  `electron-state-storage-projected-read.spec.ts:195-236`, which further
  proves it fails closed as `StateStorageCursorStaleError` after exactly one
  silent restart attempt (`failures` length is asserted to be exactly 2, i.e.
  one restart, not an infinite loop and not more than one).
- A resumed `read-json-sequence` whose underlying value was rewritten between
  pages (different `blob.generation`) is rejected as `cursor-stale`
  (`worker-runtime.ts:730-738`), covered by
  `electron-state-storage-worker-runtime.error-paths.spec.ts:258-287`.

### 3. What input data produces a wrong answer?

- Traced the "28 fat references + 1 no-destination + 1 no-id" fixture through
  `computeElectronStateArraySplit`
  (`electron-state-storage-array-split.ts:233-341`). The counting logic is
  correct per-reference (one increment per reference, matching R3-3's fix),
  and `mergeTaggedSequence` correctly converts an **object-shaped** legacy
  destination to an array before comparing lengths
  (`electron-state-storage-array-split.ts:136-158`), so the "object-shaped
  legacy agent output" fixture case is handled, not just detected.
- One genuine edge case worth naming (not a bug, an observability nuance —
  see Moderate #3 below): when two `cliSessions` references across the same
  split batch share one `agentId`, and the first is processed while the
  destination is still empty, it gets the text fallback and increments
  `stdoutFallbackCount`; if a **later** reference for the same `agentId` in
  the same batch supplies real segments, `mergeTaggedSequence`'s
  "prefer-longer-arrays" policy (`array-split.ts:151-157`) correctly lets the
  real content win and the synthetic fallback item is discarded from the
  final durable value. The counter still recorded the earlier event. This is
  the _correct_ end state (real content beats a placeholder), but the receipt
  counter no longer guarantees that fallback item survived into the
  committed value — worth a one-line note in the release material so nobody
  audits `stdoutFallbackCount` as "N fallback items exist in the store today."

### 4. What happens when a dependency fails?

- Filesystem fault at every one of the 12 durable steps, both same-instance
  and after-restart: exhaustively driven by
  `electron-state-storage-commit-store.spec.ts` (`it.each(DURABLE_STEPS)` at
  `:163,193,219`, and `it.each(PRE_POINTER_STEPS)` for N2 at `:348,384`). Read
  this suite in full — it is not a happy-path suite with a couple of
  sad-path decorations; every step, every direction (same-instance and
  post-restart), is asserted against the actual generation number and actual
  durable value, not just "it throws."
- A worker crash mid-request: `onWorkerFailure`
  (`electron-state-storage-worker-host.ts:774-787`) rejects every pending
  request with `ElectronStateWorkerCrashedError`, and `withRestart`
  (`:818-844`) retries exactly once, only for that specific error type — a
  typed failure (`cursor-stale`, `value-too-large`, `commit-failed`, etc.) is
  never mistaken for a crash and never retried. Confirmed by reading both the
  crash branch and the typed-failure branch of `throwTypedFailure`
  (`:798-816`).
- A post-message failure inside the worker loop itself (the port throwing on
  `postMessage`, e.g. a `DataCloneError`) is swallowed with a
  `degradation-audit` marker and does not stop the chain
  (`electron-state-storage-worker-loop.ts:48-61`), verified by
  `electron-state-storage-worker-loop.spec.ts:163-196` including the "second
  post also fails" case with `unhandledRejection` asserted empty.

### 5. What is missing that the requirements never mentioned?

- The plan's guarantee 3 ("index cache O(sessions)... not bounded by a
  constant") is honestly reflected in code: `readSnapshotPage`
  (`worker-runtime.ts:686-723`) does **not** apply the 1 MiB projected
  ceiling to cached-key snapshot reads, only `readScalar`/`readScalarPage` do.
  This is the plan's own accepted risk, correctly implemented rather than
  silently narrowed or silently widened.
- Not required by the plan, but worth naming: `readSequencePage`
  (`worker-runtime.ts:725-812`) answers a **wholly absent key** with an empty,
  `done:true` page rather than a distinguishable not-found signal
  (`value = blob ? await values.get(key) : undefined; const sequence = value ?? []`
  at `:740,744`). For an agent-output key this is almost certainly the right
  behaviour (no output = empty sequence), but it means a caller can never
  tell "this agent never existed" from "this agent produced nothing" through
  this call alone. Flagging for B3's awareness, not a G defect.

## Failure modes

### Fault at any pre-publication durable step

- Trigger: process crash / disk fault after a blob or manifest write but
  before `CURRENT` is renamed.
- Symptom (if mishandled): a retry could reuse the same generation number and
  either collide or silently overwrite an orphaned-but-readable blob.
- Evidence: `electron-state-storage-commit-store.ts:408-423` sets
  `highestOccupiedGeneration = generation` **before** any write, and
  `scanOccupiedGenerations` (`:338-370`) rescans both `manifests/` and
  `values/` filenames (excluding `.tmp`) on every fresh instance, so a
  post-restart retry always allocates strictly past every occupied
  generation, in-process or not.
- Current handling: correct. `commit-store.spec.ts:348-478` drives this at
  every step, same-instance and after-restart, plus the orphan-manifest and
  orphan-blob variants.
- Recommendation: none; this is the strongest part of the batch.

### Fault at or after the `CURRENT` rename attempt

- Trigger: crash during or immediately after the atomic `CURRENT` rename.
- Symptom (if mishandled): the runtime's in-memory manifest and the durable
  `CURRENT` pointer disagree, and every subsequent read/write from that
  runtime instance is silently wrong.
- Evidence: `commitChanges`/`reconcile`
  (`electron-state-storage-worker-runtime.ts:514-572`) reads `CURRENT`
  directly rather than trusting in-process state, classifies
  `landed:false` (nothing published), `landed:true` (adopts the verified
  manifest), or retires with a recovery reason for anything else (including
  an unreadable or unexpected pointer generation).
- Current handling: correct, and the four branches are each independently
  driven with real fault injection in
  `electron-state-storage-worker-runtime.error-paths.spec.ts:970-1069`
  (nothing-published, adopted-landed for both `current-renamed` and
  `current-verified`, unreadable-`CURRENT` retirement, and
  unexpected-generation `commit-uncertain` retirement).
- Recommendation: none.

### Internal protocol-state violation misclassified as `io-failed`

- Trigger: an internal programming/ordering bug — e.g.
  `requireSequenceWrite`/`requireScalarWrite` finding an unknown id
  (`worker-runtime.ts:820-830`), `append-json-sequence-item-ops` receiving an
  out-of-order `itemIndex` (`:313-315`), or a live (non-boot) `split-array-value`
  request whose source value is neither an array nor a matching index
  (`computeElectronStateArraySplit` throwing `'Split source is not an array'`
  at `electron-state-storage-array-split.ts:307`, reached un-wrapped for
  `commitKind === 'mutation'` at `worker-runtime.ts:494-497`, unlike the
  boot-time `'migration'` path which wraps the same failure as
  `StateStorageRecoveryRequiredError('migration-failed')` via
  `computeMigration`, `:477-487`).
- Symptom: `failureFor`'s catch-all (`worker-runtime.ts:379-396`) reports
  these as generic `io-failed`, which is a member of the host's
  `UNCERTAIN_COMMIT_CODES` set (`electron-state-storage-worker-host.ts:96-100`).
  For any request routed through `requireCommitted`, this triggers the full
  uncertain-commit cache-refresh dance, and — if that refresh itself fails —
  sets the store's **sticky** `recovery-required` state
  (`refreshAfterUncertainCommit`, `:685-710`), for what is actually a
  protocol/programming error with no durability question attached at all.
- Evidence this is deliberate, not accidental: exactly this path is asserted
  in `electron-state-storage-worker-runtime.error-paths.spec.ts:663-673`
  (`expect(failureCode(await split(driver))).toBe('io-failed')`), so it is a
  tested design choice, not an oversight.
- Current handling: functionally safe (a refresh of unchanged state is
  wasteful, not wrong), but conflates "the write may or may not have landed
  on disk" with "the caller sent something the worker could not make sense
  of." A confused/buggy caller could, in the worst case, trip the sticky
  `recovery-required` state (if the refresh snapshot read also happens to
  fail for an unrelated reason) for a bug that never touched durable state.
- Recommendation: give programming/ordering violations their own code (or at
  minimum route them through `internal-error` rather than the ambiguous,
  commit-adjacent `io-failed`), so `UNCERTAIN_COMMIT_CODES` stays reserved for
  genuine I/O ambiguity. Not a blocker for this release.

### A stateless read cursor becomes stale between pages

- Trigger: LRU eviction, a projection mismatch, or a concurrent write between
  two pages of the same scalar/sequence/snapshot read.
- Symptom (if mishandled): wrong or incomplete data silently assembled from
  two different generations or two different projections.
- Evidence: `readScalarPage`/`readSequencePage`/`readSnapshotPage`
  (`worker-runtime.ts:631-660,725-812,686-723`) all re-validate the encoded
  generation (and, for scalar, the projection hash) against the current
  manifest/blob on every continuation, independent of what is or is not in
  the LRU.
- Current handling: correct, and specifically proven against LRU eviction (a
  1-byte cache forces a `readValue` on every single page and still produces
  an identical assembled result —
  `electron-state-storage-projected-read.spec.ts:175-193`).
- Recommendation: none.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. **`io-failed` conflates protocol-state bugs with genuine I/O uncertainty**
   (see failure mode above). `worker-runtime.ts:379-396`,
   `electron-state-storage-worker-host.ts:96-100`. Low likelihood (requires
   an internal ordering bug or a live mis-shaped split plan), tested, not a
   data-integrity risk, but worth a dedicated code before it surprises a
   future debugger who reads `io-failed` and assumes a disk problem.

2. **Receipt counters describe per-reference merge events, not guaranteed
   final content** — see question 3 above.
   `electron-state-storage-array-split.ts:136-158,240-263`. No data is lost;
   the _correct_ value (real segments over a synthetic fallback) wins. Only
   the counter's implied meaning ("N fallback items now exist") can drift
   from the committed value when the same `agentId` is referenced more than
   once within one split batch. Worth one line in the release note the plan
   already requires, not a code change.

3. **`readSequencePage` cannot distinguish "no such key" from "empty
   sequence"** — see question 5 above.
   `electron-state-storage-worker-runtime.ts:740,744`. Plausibly intentional
   for agent output; flagging for B3 to confirm it matches
   `getAgentOutputPage`'s expected semantics, since that component consumes
   this exact response shape.

## Data flow

1. Worker boot (`ElectronStateWorkerRuntime.initialize`,
   `worker-runtime.ts:398-429`) → `ElectronStateCommitStore.initialize`
   (`commit-store.ts:135-148`): verify-only load (streaming hash, no value
   parse) for a `current` store, or a **non-committing** legacy read for a
   `legacy` store. OK — matches "boot heap does not depend on blob contents"
   and the "commit once, after the split" contract.
2. Legacy boot only: `initializeFromLegacy` (`worker-runtime.ts:431-453`)
   runs the split **in memory** against the legacy record, then
   `commitInitial` **once**. OK — the fat v1 array is never itself written as
   a blob; verified by the perf spec's write-amplification measurement in
   `g-report.md` (671,636 bytes for one detail + index update, not
   megabytes).
3. Every read (`get`, `read-scalar-page`, `read-json-sequence`,
   `read-snapshot-page`) is served through `ElectronStateValueStore`
   (`value-store.ts`), which re-verifies membership against the _current_
   manifest on every `blobFor`/`get` call and drops entries whose
   `relativePath` no longer matches the live manifest on `setManifest`. OK —
   no stale-generation read path found.
4. Every commit (`commitChanges`, `worker-runtime.ts:514-537`) evicts
   changed keys from the LRU **before** attempting reconcile, so a partially
   failed commit can never leave a stale value cached under its old
   generation. OK.
5. Every response leaves the worker through `createElectronStateWorkerMessageLoop`
   (`worker-loop.ts`), which measures the response against the 262,144-byte
   estimator budget **before** `postMessage`, in the same `try` that also
   guards the Zod re-parse and the `postMessage` call itself. OK — no path
   found where an oversized or malformed response reaches
   `postMessage` unmeasured.
6. On the main thread, `ElectronStateStorageWorkerHost.send`
   (`worker-host.ts:722-743`) re-validates and re-measures the outbound
   request before `postMessage`, so the 262,144-byte bound is enforced in
   both directions, not just worker→host. OK.
7. `ElectronStateStorage`'s facade (`electron-state-storage.ts`) re-syncs its
   synchronous `data` snapshot from the host's live cache in a `finally`
   after every write, closing the pre-existing (confirmed via `git diff`)
   gap where a thrown write left `data` stale. OK.

No step in this chain was found to lose, duplicate, or silently stale-read a
value.

## Requirements fulfilment

| Requirement                                                        | Status   | Gap                                                                                                                 |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Fault isolation (worker loop)                                      | COMPLETE | None found; loop tests genuinely fault-inject at every stage.                                                       |
| Fresh-generation allocation past occupied manifests and blobs (N2) | COMPLETE | None.                                                                                                               |
| Publication-phase classification                                   | COMPLETE | Classified "once the rename is attempted," matching the plan's own wording, not "once completed."                   |
| Reconcile-or-retire correctness                                    | COMPLETE | All four branches independently tested.                                                                             |
| No overwrite of a published generation                             | COMPLETE | None found.                                                                                                         |
| Host cache refresh/fail-closed after uncertain commit (N8)         | COMPLETE | None.                                                                                                               |
| Stateless, projection-bound cursors (R3-1)                         | COMPLETE | Multi-page equality, LRU-eviction identity, and both changed/missing-projection rejection all independently tested. |
| Bounded messages in both directions (N10)                          | COMPLETE | Enforced worker-side and host-side; zero-content-on-refusal proven by test.                                         |
| v1 → v2 split counting units (R3-3)                                | COMPLETE | Per-reference counting confirmed correct; see Moderate #2 for a documentation nuance, not a counting bug.           |
| Dev-store `not-a-sequence` accepted limitation                     | COMPLETE | Implemented as documented, not silently expanded into a compatibility shim.                                         |
| `session-metadata-store.ts` scope limited to the literal           | COMPLETE | Confirmed via `git diff`: 7 lines, the literal only.                                                                |

Implicit requirements not addressed: none found beyond the three Moderate
items above, which are observability/classification nuances rather than
missing behaviour.

## Edge cases

| Case                                             | Handled         | How                                                               | Concern                                                                                                       |
| ------------------------------------------------ | --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Object-shaped legacy agent output at split       | YES             | `mergeTaggedSequence` converts via `taggedItems` before comparing | None                                                                                                          |
| Session item with no usable `sessionId`          | YES             | `skippedItemCount`, migration continues                           | None                                                                                                          |
| Reference with no usable `agentId` carrying bulk | YES             | `droppedBulkWithoutIdCount`, once per reference                   | None                                                                                                          |
| Reference with `stdout` and empty destination    | YES             | Single text-segment fallback, `stdoutFallbackCount`               | Counter can outlive the fallback item if a later same-`agentId` reference supplies real content (Moderate #2) |
| Projection hash mismatch on continuation         | YES             | `cursor-stale`, restart-once at host                              | None                                                                                                          |
| Missing projection on continuation               | YES             | `cursor-stale`, restart-once at host                              | None                                                                                                          |
| LRU eviction between scalar pages                | YES             | Deterministic operation regeneration from the immutable blob      | None                                                                                                          |
| Sequence rewritten between pages                 | YES             | `cursor-stale` via blob-generation mismatch                       | None                                                                                                          |
| Orphan blob / orphan manifest at N+1             | YES             | Forces next commit to N+2                                         | None                                                                                                          |
| CURRENT unreadable after failed commit           | YES             | Retires with `current-pointer-invalid`                            | None                                                                                                          |
| CURRENT names an unexpected generation           | YES             | Retires as `commit-uncertain`                                     | None                                                                                                          |
| 1.5 MiB non-output metadata                      | YES             | `StateStorageValueTooLargeError`, zero content bytes to main      | None                                                                                                          |
| Live (non-boot) split on a malformed source      | YES, but coarse | `io-failed`                                                       | Conflated with I/O uncertainty (Moderate #1)                                                                  |
| Wholly absent sequence key                       | YES, but coarse | Empty `done:true` page                                            | Not distinguishable from "empty"; flag for B3                                                                 |

## Verdict

- Recommendation: APPROVE (PASS)
- Confidence: HIGH — every claim above is backed by reading the actual
  implementation file:line and, where a specific behaviour was at stake, the
  specific spec assertion that exercises it, not just the spec's existence.
- Top risk: none rises to Serious or Blocking. If forced to name the single
  most consequential item to fix before it compounds, it is Moderate #1 (the
  `io-failed` conflation), because it is the one place a benign client bug
  could reach the store's sticky `recovery-required` state through a code
  path never intended to represent durability risk.
- What a robust implementation would add: a dedicated failure code (or at
  minimum `internal-error`, already defined and unused for this case) for
  protocol/ordering violations so `UNCERTAIN_COMMIT_CODES` stays reserved for
  genuine durability ambiguity; a one-line release-note caveat that the split
  receipt's `stdoutFallbackCount` reports a per-reference event rather than a
  guarantee about the final committed value when one `agentId` is referenced
  more than once in a single split batch.
