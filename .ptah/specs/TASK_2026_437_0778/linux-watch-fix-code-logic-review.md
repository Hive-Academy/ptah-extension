# Code Logic Review — `TASK_2026_437_0778` Linux watch fix (PR #510 CI follow-up)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 4              |
| Failure modes found | 3              |

Scope read in full: `libs/backend/platform-core/src/workspace-watch/created-directory-reconciler{,.spec}.ts`
(new), `workspace-watch-host-core{,.spec}.ts`, `workspace-watch-host-boot.ts`,
`workspace-watch-protocol.ts`, `src/interfaces/workspace-watcher.interface.ts`, `src/index.ts`,
`libs/backend/platform-core/CLAUDE.md`; `libs/backend/platform-electron/src/workspace-watch/{workspace-watch-host.entry,in-process-workspace-watch-host}.ts`,
`workspace-watch-host.entry.spec.ts`, `libs/backend/platform-electron/CLAUDE.md`;
`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts`,
`libs/backend/platform-cli/CLAUDE.md`; `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`. Read
`implementation-plan.md`, `batches.md` status line, and `b11-code-logic-review.md` (consumer-side
overflow handling) for context Batch 11 already established.

## Verification

Ran the two allowed spec files from `D:\projects\ptah-437`:

- `npx jest -c libs/backend/platform-core/jest.config.ts created-directory-reconciler.spec.ts --maxWorkers=2` → 10/10 passed.
- `npx jest -c libs/backend/platform-core/jest.config.ts workspace-watch-host-core.spec.ts --maxWorkers=2` → 35/35 passed.

Both match the executor's claims. No nx run, no other spec executed.

## Five logic questions

### 1. How does this fail silently?

The fix's stated purpose is to close a silent-loss window on Linux. It closes the "the engine
never reports the child" half, but reopens a **timing** silent window on the "the consumer is
told something is wrong" half, and this is airtight from the tests, not speculation:

- `created-directory-reconciler.ts:405-418` (`confirm()`) is the only place that positively
  detects a lost watch, and it reports it via `onIncomplete` (`:430-436`, `giveUp`).
- `workspace-watch-host-core.ts:432-433` wires `onIncomplete` straight to `requestRebuild`.
  `requestRebuild` (`:636-657`) only sets `root.overflowOnSettle = true` **inside the debounced
  timer body** (`:650`), which fires after `rebuildDebounceMs` (1 s) and is held further by
  `rebuildMinGapMs` (10 s) if the root rebuilt recently (`:640-643`). Nothing in the
  `onIncomplete`/`requestRebuild` path calls `signalOverflow` or `lostEvents` synchronously.
- Contrast with a native error: `onEngineEvents`'s error branch (`:581-593`) and
  `onNativeSubscribeFailed` (`:556-568`) both call `this.lostEvents(root)` **synchronously**
  (`:587`, `:564`), which calls `subscriber.coalescer.signalOverflow()` for every subscriber
  immediately (`lostEvents`, `:660-666`) — in addition to the same `overflowOnSettle` used for
  the post-rebuild one. This is pinned by the spec itself:
  `workspace-watch-host-core.spec.ts:415-466` — `batches(1)` already contains
  `{ overflow: true }` right after `clock.advance(250)`, **before** the 1 s rebuild fires
  (`:425-431`), then a second overflow after the rebuild settles (`:449-456`). Two overflows,
  the first immediate.
- The reconciler-driven paths get only the second one. `workspace-watch-host-core.spec.ts:666-697`
  ("a subdirectory still unreported after the confirm window is a lost watch: full rebuild, then
  overflow") advances the clock through the confirm window (`CONFIRM`) and the rebuild debounce
  with **no batch assertion in between**, then asserts `overflow: true` only after
  `h.clock.advance(250)` **following** the rebuild (`:692-695`). The same shape repeats for
  `limit-exceeded` (`:740-765`) and for a storm that leaves unreconciled creates (`:793-822`).
- Net effect: a directory whose watch the host has _already, positively confirmed lost_ (the
  confirm timer fired, `unconfirmed` still non-empty) gives the consumer **zero signal** for the
  entire `rebuildDebounceMs` + (up to) `rebuildMinGapMs` window — up to ~11 s, and the port doc
  itself documents "about 2 s... or up to 10 s" (`workspace-watcher.interface.ts` diff, new
  bullet). During that window a consumer that reads current state (git status, a file-tree
  query) gets a stale answer with nothing telling it the answer might be stale. This is not a
  storm-scale event either — the reconciler's own confirm mechanism is exactly for the
  **non-storm** case (a single subdirectory racing the watch), so the coalescer's independent
  rate-based storm breaker (`workspace-change-coalescer.ts`) will not have fired its own overflow
  either. This is evidenced in the failure modes section below.

### 2. What user action produces unexpected behaviour?

None found that crashes or misbehaves visibly. The behaviour above is a **correctness-under-load**
gap, not a crash: an agent's Bash command that does `mkdir -p a/b/c && touch a/b/c/first.txt`
right after workspace-watch-relevant load (a git worktree add/remove, `npm ci`, a build) can leave
the git/file-index view of the workspace stale for up to ~11 s with no observable indicator to the
user other than "the file doesn't show up yet."

### 3. What input data produces a wrong answer, not an error?

A **slow** (non-storm-rate) sequence of creates under a directory whose watch was genuinely lost
reproduces the Q1 gap deterministically — this is exactly what
`workspace-watch-host-core.spec.ts:666-697` constructs (one directory, one subdirectory, no
storm). It is not an edge case reachable only under extreme load; it is the reconciler's primary
job.

### 4. What happens when a dependency fails?

- Native engine load failure (`bootWorkspaceWatchHost`, `workspace-watch-host-boot.ts:96-110`):
  reported `fatal`, host stays up idle, supervisor restarts/degrades — unchanged by this diff,
  correct.
- `listDirectory` failure (ENOTDIR, ENOENT, EACCES, or anything else):
  `created-directory-reconciler.ts:331-343` treats **every** rejection identically as "nothing to
  reconcile here" and drops the tracked path. This is well-reasoned for ENOTDIR/ENOENT (documented
  in the comment) but EACCES is folded in by the same generic `catch`, on the unverified
  assumption that a directory Node cannot `readdir` is also one the native inotify watch could not
  cover. That assumption is plausible but not checked against the real backend in this diff or its
  tests — see Moderate issues.
- Rebuild-time native subscribe failure while a rebuild is already awaiting a release: handled —
  `subscribeNative` (`:496-507`) re-checks `isCurrent(root)` after the awaited unsubscribe, and
  `onNativeSubscribeFailed`/`onNativeSubscribed` both guard on `isCurrent` and on `pendingToken ===
token`, so a root torn down mid-rebuild does not leak the new subscription (verified by reading,
  not by a new test in this diff — the existing `dispose while a rebuild awaits the release never
subscribes again` spec, `:912-941`, already pins this).

### 5. What is missing that the requirements never mentioned?

- An immediate overflow on `lost-watch`/`limit-exceeded`/storm-end-with-unreconciled-creates,
  symmetric with the native-error path's immediate `lostEvents()` call. The judge brief asks this
  exact question; the code's answer today is "no," and nothing in the docs or commit history
  argues this asymmetry is intentional rather than an oversight of generalizing the native-error
  path's original immediate-overflow behaviour to the new reconciler paths.
- A trace, in this task's own evidence, connecting the third stress run's misses (34 first files /
  174 dir creates / 2+1 later writes) to the timestamp of the overflow that eventually arrived.
  The task prompt itself records this as not done ("executor did not trace missed paths against
  overflow timestamps"). Given Q1's finding, this is not a minor gap: it is the one measurement
  that would show whether "one rebuild held by the 10 s gap" left some of those misses
  **uncovered** by any overflow before a consumer could have acted on stale state.

## Failure modes

### Lost-watch detection produces no immediate consumer signal

- Trigger: a directory created under an inotify-backed root whose native watch is lost (the
  documented inotify gap this reconciler exists to close), confirmed by the reconciler's own
  1 s `confirmMs` timer.
- Symptom: subscribers receive nothing until the debounced (1 s), gap-limited (10 s) rebuild
  completes and its native subscription goes live — up to ~11 s of a consumer believing its view
  is current when it is not.
- Evidence: `created-directory-reconciler.ts:405-418` (detection) →
  `workspace-watch-host-core.ts:432-433` → `requestRebuild` (`:636-657`, `overflowOnSettle` only
  set at `:650`, inside the timer). Pinned negatively by
  `workspace-watch-host-core.spec.ts:666-697` (no overflow assertion until after the rebuild).
  Contrast positively pinned at `:415-466` (native error: immediate + delayed).
- Current handling: none — the consumer simply waits out the debounce/gap.
- Recommendation: call `this.lostEvents(root)` (or an equivalent immediate `signalOverflow`) from
  the `onIncomplete` handler in `createRoot` (`:432-433`) and from
  `resumeReconciliationIfCalm`'s rebuild branch (`:624-629`), the same way
  `onNativeSubscribeFailed`/`onEngineEvents`'s error branch already do, so a positively-confirmed
  lost watch is signalled the moment it is known, not only after the rebuild. This shrinks the
  silent window from ~2-11 s to ~0 for the one failure mode this task was scoped to fix.

### `limit-exceeded` during a large, non-storming burst also delays the overflow

- Trigger: more than `maxTrackedPaths` (2 000) creates or `maxEntriesPerPass` (5 000) listed
  entries in one reconciliation pass, without the event rate ever crossing the coalescer's
  independent storm threshold (e.g. a wide, shallow `npm ci` extraction spread over several
  seconds).
- Symptom: same as above — `giveUp('limit-exceeded', …)` (`created-directory-reconciler.ts:361-366`,
  `:430-436`) routes through the same `requestRebuild`, so the same debounce/gap delay applies
  with no immediate signal.
- Evidence: `workspace-watch-host-core.spec.ts:740-765` ("too many created paths at once is an
  overflow and a rebuild, with no listing") — same "no batch until after rebuild" shape.
- Current handling: none.
- Recommendation: same fix as above; both `onIncomplete` reasons should get the immediate signal.

### Real-load verification of "no silent loss" is incomplete

- Trigger: the task's own paced 800-directory burst, third run (34 missed first files, 174 missed
  directory creates, 2+1 later writes).
- Symptom: the task record states "overflow delivered (second rebuild held by 10 s gap; executor
  did not trace missed paths against overflow timestamps)" — i.e., the claim "no silent loss" for
  this run is asserted, not measured against the actual timestamps.
- Evidence: task prompt background section (this review's brief), consistent with the Q1 code
  reading above (a rebuild held by the 10 s minimum gap has no immediate overflow to cover the
  interim).
- Current handling: the fix's evidence write-up records the gap as an open question rather than a
  closed one.
- Recommendation: before calling P2/Linux closed, re-run that reproduction and assert
  programmatically that every miss's file mtime precedes the overflow message's receipt time (or
  fix the immediate-signal gap above, which makes the ordering trivially true).

## Blocking issues

None. The reconciler correctly closes the "never reported at all" half of the inotify gap for
every scenario tested (bursts, nested creation, ignored children, deletes mid-confirm, dispose
mid-pass, symlinks structurally excluded via `Dirent.isDirectory()`), and the host-core rebuild
machinery is careful about subscriber join/leave, teardown-during-rebuild and double-unsubscribe
races (traced through `unsubscribe` → `teardownRoot` → the in-flight `subscribeNative` promise's
own `isCurrent` guard, `:384-400`, `:496-507`, `:791-808`). The residual gap is a **latency of the
loss signal**, not data that is dropped forever.

## Serious issues

### 1. Asymmetric immediate-overflow signalling between native-error and reconciler-driven rebuilds

See "Lost-watch detection produces no immediate consumer signal" above
(`workspace-watch-host-core.ts:432-433,556-568,581-593,636-657,660-666`). This is the single most
consequential finding: it directly answers the judge's Q1/Q2 and shows the fix does not fully
deliver the "no silent loss" guarantee it exists to provide, though the loss is bounded and
eventually resolved rather than permanent.

### 2. The load-test evidence for "no silent loss" is unproven for the one run that stressed it

See "Real-load verification of 'no silent loss' is incomplete" above. Given finding 1 explains
exactly why a rebuild held by the 10 s gap has no interim signal, this is not a coincidental
observation — it is the predicted consequence of finding 1, seen in practice and not yet
reconciled with timestamps.

## Moderate and minor issues

- Moderate: `created-directory-reconciler.ts:336-342` folds EACCES into the same "nothing to
  reconcile" branch as ENOTDIR/ENOENT, on an unverified assumption that a directory Node cannot
  read is also one the native inotify watch could not establish. Plausible, undocumented as an
  explicit assumption beyond the one-line comment, and untested (no spec constructs an EACCES
  case distinct from the generic ENOTDIR one used throughout `created-directory-reconciler.spec.ts`).
- Moderate: a discovered child can be reported twice to the same subscriber's coalescer — once
  synthetically via `onDiscovered` (`workspace-watch-host-core.ts:606-612`) when the reconciler's
  100 ms settle fires first, and again later via the normal `onEngineEvents` push
  (`:595-604`) if the native engine's own (delayed) report for the same path arrives afterward.
  Within one coalescer batch window these merge (`pending` keyed by path); across two batch
  windows they do not, and the consumer sees two `create` events for the same path. Batch 11's
  review records the file index and git watcher as idempotent for repeated creates in the overflow
  case, but that was checked against overflow/rescan duplication, not this new duplicate-immediate-create
  source — worth a one-line confirmation, not a re-audit.
- Moderate: `created-directory-reconciler.ts:359-366` (the `maxTrackedPaths` cap reached while
  recursively queuing an unreported child **discovered during a listing pass**, as opposed to a
  raw engine `create` event hitting the cap in `observe()` at `:200-207`) has no dedicated spec.
  `workspace-watch-host-core.spec.ts:740-765` only exercises the `observe()`-side cap. Same code
  path (`giveUp`), lower risk, but an unexercised branch in code whose entire job is bounding
  worst-case cost.
- Minor: the `ignoreMatcher` in `created-directory-reconciler.ts:444-476` re-implements
  `@parcel/watcher`'s ignore-matching decision (absolute-path-as-subtree, picomatch `dot: true`
  glob) rather than sharing code with it, and is — like several other pieces of this task's
  evidence — unverified against the real native binary in this sandboxed environment (ABI
  mismatch noted elsewhere in this task's own reviews). A subtle divergence would misclassify a
  child as "lost" (spurious rebuild, cheap) or as "ignored, not lost" (a genuine miss silently
  treated as expected) — the second direction is the one worth a follow-up native-binary check.
- Minor: the Electron/CLI entry guard string ("must be run as a worker (no Electron parentPort and
  no IPC channel)") still says "worker" despite the surrounding prose explicitly stating there is
  no `worker_threads` transport. Harmless — it is pinned byte-for-byte between
  `workspace-watch-host.entry.ts:44-45` and `esm-bundle-gate.spec.ts:332-333` — but confusing
  terminology for a guard whose entire point is "not a Worker."

## Data flow

1. Engine reports a `create` for a directory → `onEngineEvents` pushes it to every subscriber's
   coalescer, then to `root.reconciler?.observe(events)` (`workspace-watch-host-core.ts:595-604`) —
   OK, coalescer sees it as a normal change regardless of reconciliation outcome.
2. `observe()` tracks the path (two-pass: queue new creates, then record parent/child relations
   and deletes) — OK, matches the documented "two passes per batch."
3. After `settleMs` (100 ms), `runPass()` lists each queued path once, 4 at a time — OK, bounded,
   drops on ENOTDIR/ENOENT/anything (Moderate: EACCES folded in, see above).
4. Unreported children go to `onDiscovered` → pushed into every subscriber's coalescer as a
   `create` — OK for delivery; possible duplicate with a later native report (Moderate, above).
5. An unreported child **directory** is tracked recursively and also watched via its own
   `confirmMs` (1 s) timer — OK, this is what proves a truly lost watch rather than a merely slow
   report.
6. Confirm timeout with a still-unreported child → `onIncomplete('lost-watch', …)` →
   `requestRebuild` — **GAP**: no immediate signal, only the debounced/gapped one (Serious finding
   1).
7. `requestRebuild`'s timer fires (after debounce and any minimum-gap wait) → releases the live
   native subscription, awaits it, subscribes again, then signals `overflow` once the new
   subscription is live and acks any pending subscribers — OK, careful about concurrent
   subscribe/unsubscribe/dispose races (traced above).
8. Consumer receives `overflow`, does a full rescan, which (once it runs) sees every change made
   during the entire lost-watch-to-rebuild-complete window, including the ones the reconciler
   itself never got to report — OK, eventual consistency holds; the gap is purely the delay before
   the consumer is told to rescan (steps 6-7).

## Requirements fulfilment

| Requirement                                                                                                           | Status                                                         | Gap                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Reconcile directories the inotify backend never lists, on Linux only, via injected `listDirectory`                    | COMPLETE                                                       | none found — thorough unit coverage, correct platform gating (`workspaceWatchListDirectoryFor`)                        |
| Full rebuild (not overlapping re-subscribe) for lost watches, native errors and refused subscribes                    | COMPLETE                                                       | matches the orchestrator decision; overlapping re-subscribe correctly reserved for nested-root ignore changes only     |
| `overflow` signalled once the new subscription is live                                                                | COMPLETE per the orchestrator's own (already-revised) decision | this decision itself leaves the Q1 gap for reconciler-driven rebuilds — see Serious 1                                  |
| Two overflows for native error (immediate + post-rebuild)                                                             | COMPLETE                                                       | pinned by spec; not extended to reconciler-driven rebuilds (asymmetry, Serious 1)                                      |
| Remove the `worker_threads` transport; entry transport detection: Electron `parentPort` → `child_process` IPC → throw | COMPLETE                                                       | no residual `worker_threads` code in the workspace-watch entries; guard strings consistent between entry and gate spec |
| Port doc / CLAUDE.md updates accurate and consistent with the implementation                                          | COMPLETE                                                       | verified line-by-line against the code; doc even discloses the "about 2 s ... up to 10 s" delay honestly               |
| Spec determinism (fake clock, fake `listDirectory`)                                                                   | COMPLETE                                                       | `ManualClock` in both spec files, no real timers, no real filesystem in the unit specs                                 |

Implicit requirements not addressed: an immediate signal for a _positively confirmed_ lost watch
(as opposed to a merely-suspected one covered by the debounce), symmetric with the existing
native-error immediate signal.

## Edge cases

| Case                                                                      | Handled               | How                                                                                         | Concern                                                                                                                |
| ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Burst of creates in one directory, one listing pass                       | YES                   | `created-directory-reconciler.spec.ts:99-117`                                               | none                                                                                                                   |
| Native-ignored children (absolute path + glob)                            | YES                   | `:119-135` (reconciler), `workspace-watch-host-core.spec.ts:720-738` (host)                 | none                                                                                                                   |
| Nested unreported subdirectory recursion                                  | YES                   | `created-directory-reconciler.spec.ts:137-159`                                              | none                                                                                                                   |
| Delete of a tracked directory mid-flight                                  | YES                   | `:161-172`                                                                                  | none                                                                                                                   |
| Child deleted inside the confirm window (not a lost watch)                | YES                   | `:174-183`, host `workspace-watch-host-core.spec.ts:699-718`                                | none                                                                                                                   |
| `maxEntriesPerPass` exceeded                                              | YES                   | `created-directory-reconciler.spec.ts:185-198`                                              | reconcile()-side `maxTrackedPaths` growth path untested (Moderate)                                                     |
| Suspend/resume around a storm                                             | YES                   | `:200-230`                                                                                  | none                                                                                                                   |
| Symlinked directory cycle                                                 | YES (by construction) | `Dirent.isDirectory()` false for symlinks, `workspace-watch-host-boot.ts:69-71`             | not explicitly spec'd with a real symlink, but the mechanism (native `fs.readdir` type flag) rules it out structurally |
| Dispose mid-settle / mid-listing / mid-rebuild-release                    | YES                   | `created-directory-reconciler.spec.ts:240-262`, `workspace-watch-host-core.spec.ts:871-941` | none                                                                                                                   |
| EACCES on a created directory                                             | PARTIAL               | folded into the generic catch, same as ENOTDIR/ENOENT                                       | unverified assumption that the OS watch also failed (Moderate)                                                         |
| Lost watch → consumer told before the rebuild completes                   | NO                    | none — signalled only after rebuild settles                                                 | Serious 1                                                                                                              |
| Duplicate `create` for the same path (reconciler + delayed engine report) | PARTIAL               | consumers assumed idempotent per Batch 11 review, not re-verified for this specific source  | Moderate                                                                                                               |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the reconciler correctly _detects_ every lost watch this task set out to catch, but the
  path from "detected" to "consumer told" for that specific failure mode has no immediate signal —
  only the native-error path was given one. Under real load (the task's own third stress run) this
  produces exactly the outcome the fix exists to prevent: a stretch of time, up to ~11 s, where a
  consumer's view can be wrong with no indication, for the one scenario (a slow, non-storming lost
  watch) that will not trip any other safety net in this system.
- What a robust implementation would add: (1) call the existing `lostEvents(root)` (or equivalent)
  synchronously from `onIncomplete` and from `resumeReconciliationIfCalm`'s rebuild branch, giving
  every rebuild reason the same immediate-plus-post-rebuild overflow shape native errors already
  get; (2) re-run the 800-directory paced burst and assert the miss-to-overflow ordering
  programmatically instead of recording it as an open question; (3) a spec for the reconcile()-side
  `maxTrackedPaths` growth path and an EACCES-specific case; (4) a one-line note confirming file
  index / git watcher idempotency covers reconciler-sourced duplicate creates, not only
  overflow-sourced ones.

---

## Delta review (review fixes)

Scope: the six follow-up changes under `libs/backend/platform-core/` addressing the base review's
two Serious findings — `workspace-watch-host-core{,.spec}.ts`
(`onWatchesLost` at `:646-650`, its wiring at `:337`/`:431`/`:629`, doc at `:34-49`),
`created-directory-reconciler{,.spec}.ts` (EACCES/EPERM via `list`/`reportUnreadable` at
`:344-375`, the new tracked-limit-via-discovery spec, the ignore-matcher verification note at
`:470-484`), `workspace-watch-protocol.ts` (`directory-unreadable` notice code), the new
`native-ignore-set-planner{,.spec}.ts`, `workspace-watcher.interface.ts` and the three
`CLAUDE.md` files. Read every file in full at its current state (not a diff against my prior
pass). Batch 16 files excluded per the coordinator's instruction were not touched by this delta
and were not re-read.

### Verification

`npx jest -c libs/backend/platform-core/jest.config.ts workspace-watch-host-core.spec.ts
created-directory-reconciler.spec.ts native-ignore-set-planner.spec.ts --maxWorkers=2` from
`D:\projects\ptah-437`: 3 suites, 51/51 passed. No nx run.

### (a) Is "followed by an overflow" the right invariant, and can the immediate overflow ever precede the loss it's meant to cover?

Confirmed correct, traced through `workspace-watch-host-core.spec.ts:644-682` ("overflow at once,
full rebuild, overflow again"). The immediate overflow fires at `onIncomplete` time — i.e. at the
confirm-timeout instant the reconciler positively proves the watch is lost
(`created-directory-reconciler.ts:437-450`) — which is strictly _after_ the miss that triggered
detection already happened (the child was created before the confirm window even started
counting), so a consumer rescan triggered by that first overflow does see it. The genuinely open
question was whether writes made _after_ detection but _before_ the rebuild completes (the
release→resubscribe gap, up to `rebuildDebounceMs` + `rebuildMinGapMs`) are covered — and they
are, by design: `onNativeSubscribed`'s `overflowOnSettle` branch (`:545-552`) fires the second
overflow only once the _new_ subscription is live, so a rescan triggered by _that_ one sees
everything up to the moment watching resumed, closing exactly the window the first overflow
could not. The two-signal shape is the correct invariant, not "one overflow, eventually": each
overflow is proven, by its trigger point, to be temporally _after_ everything it needs to cover.
This closes the base review's Serious 1 (asymmetric immediate-overflow gap) as designed and
tested.

### (b) Overflow load reaching MAIN, and consumer coalescing

Confirmed 2 overflows per incident (`lostEvents` immediate + `overflowOnSettle` post-rebuild),
collapsing to 1 merged + 1 for a storm-end incident (`onWatchesLost`'s doc comment at `:636-645`,
pinned by `workspace-watch-host-core.spec.ts:812-850`: exactly 2 `overflows(1)` entries total, the
first two calls merged into one). This matches the load-test's own count (2 incidents × 2 = 4 for
the non-storm run, 1 storm incident × 2 = 2 for the default-breaker run).

Consumers do not coalesce the two into one refresh — each is treated as an independent trigger,
which is required (see (a)): `workspace-file-index.service.ts:958-1001` queues a second overflow's
rebuild (`rebuildQueued = true`) only when one is _already staging_, and always runs it after the
in-flight one finishes rather than dropping it; `git-watcher.service.ts:621-629`
(`onWorkspaceOverflow`) calls `fetchAndPush()` unconditionally on every overflow and relies on
`GitInfoService`'s single-flight-plus-trailing-rerun (Batch 4) to fold two nearly-simultaneous
calls without dropping either. Neither path can turn "2 overflows" into "1 rescan" — both
architectures guarantee a rescan per overflow, immediate or queued.

### (c) `limit-exceeded` replacing a truncated batch with overflow

Correct, and a strict improvement, not a behaviour change to watch for regressions in: an
`overflow` batch is a strictly stronger signal ("assume incomplete, rescan everything") than a
`truncated` batch of only the creates that happened to fit before the cap was hit, so replacing the
latter with the former loses nothing a consumer depended on — a `truncated` batch was already
"the paths are incomplete," per the port doc's own pre-existing language. Pinned by
`workspace-watch-host-core.spec.ts:725-756` ("too many created paths at once is an overflow at
once and a rebuild, with no listing" — `h.batches(1)` shows only `{ overflow: true, changes: [] }`,
never a partial list of the `d0..dN` paths). `signalOverflow`'s non-storming branch
(`workspace-change-coalescer.ts`, unchanged by this delta) already clears `pending` when folding
in an overflow, which is exactly this replace-not-append semantics.

### (d) `directory-unreadable` rate-limit memory

No leak, and nothing to clean up beyond what already happens: `unreadableReportedAt`
(`created-directory-reconciler.ts:168`, `:365-375`) is a single scalar field on the
`CreatedDirectoryReconciler` instance, not a map keyed by path or by root. One reconciler exists
per root (`workspace-watch-host-core.ts:422-435`, `createRoot`), so the 60 s throttle is naturally
per-root, and the whole instance (throttle state included) is discarded on `root.reconciler?.dispose()`
during `teardownRoot` (`:791-808`, unchanged) — no map to sweep, no stale root keys to accumulate.
One residual, not a defect: `clear()` (used by both `suspend()` and a rebuild reset) does not reset
`unreadableReportedAt`, so the throttle window survives a rebuild — reasonable, since a permission
problem is not expected to resolve itself just because the native subscription restarted, and
resetting it would make a broken permission noisy on every rebuild.

### (e) `native-ignore-set-planner.ts` — behaviour-identical move

Confirmed line-by-line: `planNativeIgnoreSet` (`native-ignore-set-planner.ts:50-109`) is the same
algorithm as the pre-delta `computeNativeIgnore` method reviewed in the base pass — same
dir-name/segment-rule/glob/nested-root intersection logic, same `.git`-name exclusion, same sorted
output. The call site (`workspace-watch-host-core.ts:461-465`) passes `root.key`,
`[...root.subscribers.values()]` (each a `HostSubscription`, which structurally satisfies
`NativeIgnoreSubscriber` — extra fields `id`/`coalescer`/`acked` are simply unused by the planner)
and `root.detectedNestedRoots`. The other original use of subscriber-nested-repo-detection gating,
`allSubscribersDetectNestedRepos` (used by `onNestedRepoRoot`'s resubscribe gate,
`:709-711`,`:730-736`), was correctly left as a host-core private method — it is a different call
site (gating a resubscribe decision, not building the ignore list) and was not part of what moved.
No behavioural drift found.

### Residual, from the base review

- The ignore-matcher's 46/46 agreement with the real `@parcel/watcher` 2.5.6 binary on Linux
  (`created-directory-reconciler.ts:470-484`) and the load test's "all followed by an overflow"
  claim for the 519-miss and 6,160-miss runs are both self-reported by the executor's WSL
  environment; neither is independently re-verifiable from this Windows sandbox (no native Linux
  binary, no WSL access here). Nothing in the code contradicts either claim, and the mechanism
  supporting the load-test claim (the two-overflow shape confirmed correct under (a)) makes the
  "all followed" outcome the expected one, not a coincidence — but this review did not re-run the
  trace itself.
- The reconcile()-side `maxTrackedPaths` growth path and the EACCES/EPERM path are now both
  spec-covered (`created-directory-reconciler.spec.ts:161-173`, `:175-209`), closing those two
  Moderate findings from the base review.
- The duplicate-`create` behaviour is now explicitly contracted in the port doc
  (`workspace-watcher.interface.ts:169-172`, "the same `create` may be delivered twice... Consumers
  treat `create` as 'this path may now exist'") rather than left implicit, and file-index
  idempotency was re-confirmed by reading (`workspace-file-index.service.ts:866`, dedup against
  live `files`/`directories` state before adding). This closes that Moderate finding as
  documented-and-verified rather than merely assumed.
- Not re-litigated: the Minor finding about the entry guard string still saying "worker" — out of
  scope for this delta, untouched by these six changes.

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Both Serious findings from the base review are fixed as described, each pinned by a test that
  fails without the fix (the "overflow at once" assertions did not exist before, and the base
  review's own reading of the pre-delta code confirmed their absence). No new defect was found in
  the six changes; the two residual items above are reporting/verification gaps in an environment
  this review cannot reach (a real Linux binary), not logic defects in the diff.
- Updated overall assessment for the fix as a whole: **APPROVED**. The one Blocking-adjacent
  concern the base review raised — a positively-confirmed lost watch producing no consumer signal
  for up to ~11 s — is closed by `onWatchesLost` calling `lostEvents(root)` synchronously before
  `requestRebuild`, matching the native-error path's existing shape and removing the asymmetry
  that was the base review's central finding.
