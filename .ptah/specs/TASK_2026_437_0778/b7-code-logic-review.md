# Code Logic Review — `TASK_2026_437_0778` Batch 7

Scope: `IWorkspaceWatcher` port, `WorkspaceChangeCoalescer` (+ spec), the
workspace-watcher contract suite (+ self-spec), and the small token/index/
CLAUDE.md/`rpc-degradation.types.ts` wiring changes (Task 7.1–7.3).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 7/10                                 |
| Assessment           | APPROVE_WITH_FIXES                   |
| Blocking issues      | 0                                    |
| Serious issues       | 0                                    |
| Moderate issues      | 3                                    |
| Failure modes found  | 2                                    |

Tests: `npx nx test @ptah-extension/platform-core` (35 suites, 631 passed, 4
todo) — green, including `workspace-change-coalescer.spec.ts` and
`run-workspace-watcher-contract.self.spec.ts`. One unrelated flaky timeout in
`file-settings-manager.bench.spec.ts` (pre-existing perf spec, not a Batch 7
file; passed on the narrower re-run). `@ptah-extension/shared` not
independently re-verified in this pass (only the two-file
`rpc-degradation.types.ts` addition is in scope there and is trivially
correct — see below).

## Five logic questions

### 1. How does this fail silently?

- `signalOverflow()` racing an already-active storm (or a storm starting
  while an overflow is owed) can silently produce **two** `overflow` batches
  instead of the one the port's own guarantee promises ("an adapter failure
  surfaces as one `overflow` batch"). See Failure mode 1. Nothing is lost —
  consumers rescan twice instead of once — but it is a quiet deviation from
  the documented contract that no test catches.
- A consumer that feeds `WATCH_IGNORED_DIRS` names into `excludeSegmentRules`
  as one-element rules (the natural way to pass a `Set<string>` through this
  port) silently gets **case-insensitive** matching where today's behaviour
  (`isExcludedWorkspacePath` + `dirs.has(segment)`,
  `workspace-scan.constants.ts:177`) is case-sensitive. A real, differently
  cased directory (`Dist/`, `Node_Modules/`) would stop being watched with no
  error, no log line, and no test anywhere pinning the divergence. See
  Moderate-1.

### 2. What user action produces unexpected behaviour?

Renaming or copying a git checkout so that a subtree's name differs from an
excluded name only by case (e.g. `Node_Modules` created by a Windows tool,
or an agent-generated directory literally named `.Claude-Worktrees`) is
already handled correctly for `NESTED_WORKSPACE_PATH_RULES` (multi-segment,
intentionally case-insensitive) but would, once Batch 11 wires
`WATCH_IGNORED_DIRS` through this port's `excludeSegmentRules`, silently stop
watching any tracked directory sharing a case-folded name with `dist`,
`coverage`, `tmp`, `node_modules`, etc. — a change nobody asked for and this
batch does not flag.

### 3. What input data produces a wrong answer?

- A path containing the substring `.git` anywhere that is *not* an actual
  `.git` entry (`.gitignore`, `.gitattributes`, `.gitmodules`, anything under
  `.github/`) trips the `absolutePath.includes(GIT_MARKER)` guard
  (`workspace-change-coalescer.ts:172`) and calls `detectNestedRoot` on every
  such event outside a storm. `detectNestedRoot`'s own `segments.indexOf('.git')`
  exact-match check discards these harmlessly, so the *answer* stays correct,
  but the coalescer pays for a `split('/')` + `indexOf` on every commit's
  worth of `.gitignore`/`.github` churn it did not need to. Minor, not a
  wrong-answer bug — noted under Minor issues.
- No wrong-answer case was found in the batching/merge/truncation/overflow
  state machine itself; the unit spec exercises kind-merging (create→update
  stays create, create→delete becomes delete, delete→create becomes create),
  the cap, and Windows path folding thoroughly and the assertions match the
  implementation.

### 4. What happens when a dependency fails?

- A throwing listener is caught and reported via `onListenerError`
  (`workspace-change-coalescer.ts:330-334`); the coalescer keeps delivering
  afterward (pinned by spec). Good — this is the seam the port's own
  docstring calls out as required.
- `picomatch([...excludeGlobs], { dot: true })` is constructed once in the
  constructor with no try/catch; a caller-supplied glob so malformed that
  picomatch itself throws during compilation (not matching, compiling) would
  throw out of the `WorkspaceChangeCoalescer` constructor with no listener to
  report to yet. Every caller in this batch passes literal, already-known-
  good globs, so this is not reachable today, but the constructor gives the
  adapter no seam to convert a bad `excludeGlobs` entry into a typed error —
  worth a one-line doc note when Batch 8/9 start taking `excludeGlobs` from
  less-trusted call sites.

### 5. What is missing that the requirements never mentioned?

- No drift test between this coalescer's segment matcher and
  `isExcludedWorkspacePath` in `libs/shared`. `platform-core` cannot import
  `shared` (by design, confirmed: no `@ptah-extension/platform-core` import
  exists in `libs/shared/src`, and the reverse boundary is documented), but a
  lib that already imports both — `workspace-intelligence`, which already
  carries the Batch 2 `workspace-default-excludes.spec.ts` drift test — could
  carry a case-sensitivity parity test. Nothing in Batch 7 or the batch plan
  currently assigns this test to anyone; recommend adding it explicitly to
  Batch 11 (consumer migration) before `WATCH_IGNORED_DIRS` is wired through
  this port.
- No test for a UNC root (`\\server\share\...`). The coalescer has
  purpose-built regex handling for it (`WINDOWS_ABSOLUTE_PATH` matches
  `\\\\` and `//`; the `(?<!^)` lookbehind in `normalizeAbsolute` /
  `relativize` specifically preserves a leading double separator while still
  collapsing interior doubles). Read carefully the logic looks correct, but
  "read carefully and it looks right" is exactly the class of path-handling
  code this task's own root-cause review (implementation-plan.md C1) says
  needs a table test, and none exists for this specific case. See
  Moderate-3.

## Failure modes

### 1. Double overflow when a storm and an explicit `signalOverflow()` overlap

- Trigger: an adapter calls `signalOverflow()` (native watcher error) while
  the coalescer's own `EventStormBreaker` is already storming, or a storm
  enters while an overflow is still owed (not yet flushed).
- Symptom: consumers receive two `overflow: true` batches for one underlying
  loss-of-events incident instead of one.
- Evidence: `workspace-change-coalescer.ts:216-220` (`signalOverflow` sets
  `overflowOwed` and calls `scheduleFlush` unconditionally, regardless of
  `breaker.isStorming`); `:243-256` (`enterStorm` only cancels the pending
  flush when `!this.overflowOwed`, so an overflow flush scheduled before the
  storm entry survives and fires independently of the storm's own exit path
  at `:268-282`); `flush()` at `:304-335` resets `overflowOwed = false`
  unconditionally on every emission, including while `breaker.isStorming` is
  still true, so the storm's later `onStormTimer` → `poll() === 'exited'` →
  `foldPendingIntoOverflow()` re-arms `overflowOwed` and schedules a second,
  independent overflow batch.
- Current handling: none; not covered by
  `workspace-change-coalescer.spec.ts` (its storm tests and its
  `signalOverflow` tests are exercised separately, never overlapping) or by
  the contract suite (the contract's `triggerOverflow` test does not run
  concurrently with a synthetic storm).
- Recommendation: either (a) make `signalOverflow()` a no-op while
  `breaker.isStorming` is true (the storm's own exit already owes a rescan,
  so the signal is redundant), or (b) have `enterStorm()` unconditionally
  absorb an already-scheduled overflow flush into the storm's own exit path.
  Either fix is a few lines; add a spec covering the overlap.

### 2. Case-insensitive single-segment matching diverges from `WATCH_IGNORED_DIRS`

- Trigger: a consumer (Batch 11) passes `WATCH_IGNORED_DIRS` entries as
  one-element `excludeSegmentRules` (the only shape the port offers for a
  bare directory-name set, since `excludeSegmentRules` is typed
  `readonly (readonly string[])[]`, matching D5).
- Symptom: a directory whose name differs from an excluded name only by
  ASCII case (`Dist/`, `Node_Modules/`, `Coverage/`) is silently excluded
  from watching, where today's `isExcludedWorkspacePath` +
  `WATCH_IGNORED_DIRS.has(segment)` would have kept watching it (exact
  string match, case-sensitive by design per
  `workspace-scan.constants.ts:130`: *"`WATCH_IGNORED_DIRS` name matching
  stays case-sensitive (unchanged)"*).
- Evidence: `workspace-change-coalescer.ts:386-403` (`matchesSegmentRule`
  calls `equalsIgnoringAsciiCase` for every rule regardless of rule length);
  contrast `workspace-scan.constants.ts:166-184` (`isExcludedWorkspacePath`
  uses `dirs.has(segment)` — exact, case-sensitive — for the single-segment
  set, and only routes through `ruleMatchesAt`'s case-insensitive compare for
  the *named* `NESTED_WORKSPACE_PATH_RULES`). The port's own interface doc
  (`workspace-watcher.interface.ts:94-98`) documents the coalescer's
  behaviour accurately ("Names match ASCII case-insensitively on every
  platform") but does not flag that this is a deliberate widening relative to
  `WATCH_IGNORED_DIRS`.
- Current handling: none; this is a latent contract mismatch, not yet
  triggered because no consumer in this batch feeds `WATCH_IGNORED_DIRS`
  through the port yet.
- Recommendation: document the divergence explicitly in this batch (one line
  in the coalescer's module doc, since the interface doc already states the
  behaviour) and require Batch 11 to either (a) accept the widened
  case-insensitive match for `WATCH_IGNORED_DIRS` too as an intentional,
  reviewed choice, or (b) add a parity/drift spec (candidate location:
  `workspace-intelligence`, which already imports both `platform-core` and
  `shared`) before wiring `WATCH_IGNORED_DIRS` through `excludeSegmentRules`.

## Blocking issues

None found.

## Serious issues

None found. (Per-event allocation ahead of the storm breaker, considered for
Serious, is downgraded to Moderate below: the coalescer instance itself runs
inside the P2 watch host process, not the Electron main thread, so the
allocations do not reproduce the 09-14 main-thread mechanism this task
exists to fix — see Moderate-2.)

## Moderate and minor issues

- **Moderate-1** — Case-insensitive segment-rule drift. See Failure mode 2.
- **Moderate-2** — Redundant, avoidable per-event allocation ahead of the
  storm breaker. `push()` calls `relativize(absolutePath)`
  (`workspace-change-coalescer.ts:341-355`, which itself allocates via
  `replace`/`slice`/`split`/`filter`/`join`), then `isExcluded(relative)`
  (`:365-374`) independently re-splits the same string
  (`relative.split('/')` at `:366`) before `breaker.record()` is ever
  reached at `:179`. This ordering is required by the "exclusion never
  counts toward a storm" contract (both the batch plan and the interface doc
  demand it), so it cannot be eliminated by reordering, but the second split
  is free to avoid — thread `relativize`'s segments through to `isExcluded`
  instead of recomputing them. Every non-excluded event, storming or not,
  currently pays two array allocations instead of one.
- **Moderate-3** — No UNC-root test. See "What is missing" §5. The regex
  handling looks correct on inspection; add
  `D:\\ws` and `\\\\server\\share\\ws` (or `//server/share/ws`) cases to
  `workspace-change-coalescer.spec.ts`'s Windows-roots describe block to
  convert "looks right" into "is pinned."
- **Minor-1** — `absolutePath.includes(GIT_MARKER)` at
  `workspace-change-coalescer.ts:172` is a raw substring check, so
  `.gitignore`, `.gitattributes`, `.gitmodules` and anything under `.github/`
  trip `detectNestedRoot` unnecessarily on every normal (non-storming) event
  when `nestedRepoDetection` is on. Harmless (the exact-segment check inside
  `detectNestedRoot` discards these), but an easy tighten: check the last
  path segment or a `/.git` / leading `.git` boundary instead of a bare
  substring.
- **Minor-2** — `picomatch(...)` in the constructor
  (`workspace-change-coalescer.ts:133-136`) has no try/catch around glob
  compilation; every current caller passes literal, known-good globs so this
  is unreachable today, but there is no seam for a future less-trusted
  `excludeGlobs` source to fail gracefully. Worth a doc note for Batch 8/9.
- **Observation, not a Batch 7 defect** — `libs/backend/platform-core/CLAUDE.md`'s
  working-tree diff against `HEAD` also carries an unrelated `EDITOR_LAUNCHER`
  addition and a `PTY_HOST` removal from another batch sharing this worktree
  (confirmed: `PTY_HOST` is absent from `tokens.ts` while `EDITOR_LAUNCHER`
  is present, and neither term appears in this task's `batches.md`, so
  neither belongs to C7/Task 7.1). This is expected shared-worktree noise per
  the review brief, not a Batch 7 logic issue, but it means the eventual
  Batch 7 commit must be diffed carefully against only Batch 7's file list
  before committing, not taken as "this file's full working-tree diff."

## Data flow

1. Adapter observes a raw OS/engine event → calls
   `coalescer.push(absolutePath, kind)`. OK.
2. `relativize` drops events outside the root (including the root itself and
   any `..`-escaping spelling). OK, covered by spec.
3. If `nestedRepoDetection` is on and the coalescer is not currently
   storming, a path containing `.git` is checked for a new nested-repo root;
   detection is skipped once excluded. OK — matches the mandated per-event
   order (outside-root → nested-repo detection skipped during storm →
   exclusion → breaker → merge). Minor extra cost noted (Minor-1).
4. `isExcluded` checks nested roots, then segment rules, then globs. Segment
   rules are case-insensitive across the board — a documented but, for
   `WATCH_IGNORED_DIRS`-shaped single-name rules, unverified-against-drift
   choice (Moderate-1).
5. `breaker.record(now)` classifies the event as `normal` / `entered` /
   `storming`. Excluded events never reach this step, so they never count
   toward a storm — correct per the contract.
6. Non-storming, non-excluded events merge into `pending` with kind-merge
   rules verified against the spec table, capped at `maxPathsPerBatch` with
   `truncated`/`droppedCount` bookkeeping. OK.
7. `scheduleFlush` arms exactly one timer per subscription, honouring the
   `minBatchIntervalMs` floor (clamped, INV-1). OK, never synchronous.
8. `flush()` emits either the overflow shape (no paths) or the normal batch,
   resets bookkeeping, and reports listener throws via `onListenerError`
   without losing subsequent delivery. OK, except the overlap case in
   Failure mode 1.
9. `dispose()` cancels both timers and clears `pending`; guarded everywhere
   by `this.disposed`. OK, pinned by spec (idempotent, no post-dispose
   calls, including from inside the listener).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Options clamp to ≥250 ms interval and ≤500 paths | COMPLETE | — |
| Batch shape `{root, changes[{path,kind}], truncated, overflow, droppedCount}` | COMPLETE | — |
| Overflow = no paths, rescan | COMPLETE | — |
| Listener never sync, never after dispose | COMPLETE | pinned by spec |
| Per-event order (outside-root → nested-repo → exclusion → breaker → merge) | COMPLETE | Minor-1 extra cost, not an order violation |
| Storm emits nothing then exactly one overflow | PARTIAL | Failure mode 1: overlap with `signalOverflow` can double-emit |
| `signalOverflow()` | COMPLETE | — |
| Required `onListenerError` | COMPLETE | — |
| Segment matcher duplicated from shared (no import) | COMPLETE | duplication itself is correct/required; behavioural parity with `WATCH_IGNORED_DIRS` is not verified (Moderate-1) |
| Contract suite strength | PARTIAL | passes a coalescer-backed adapter; no UNC coverage; no storm/overflow-overlap coverage (both inherited from the underlying spec gaps) |

Implicit requirements not addressed: a drift/parity test between this
coalescer's matcher and `isExcludedWorkspacePath` (none exists yet in any
importable lib); documentation of the case-insensitivity widening relative
to `WATCH_IGNORED_DIRS`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| create→update merge | YES | stays `create` | — |
| create→delete merge | YES | becomes `delete` | matches test; semantically a flicker path reports a delete for a path that, net, never existed pre-window — safe/idempotent, not wrong |
| delete→create merge | YES | becomes `create` | — |
| Windows mixed separators / case folding | YES | `normalizeAbsolute` + case-folded pending keys | — |
| UNC root | UNVERIFIED | regex has explicit `\\\\`/`//` handling | no test (Moderate-3) |
| Storm that never quiets | YES | `maxStormMs` forces periodic overflow | — |
| Storm + explicit `signalOverflow` overlap | NO | — | Failure mode 1 |
| Nested `.git` FILE vs DIR | YES | `absolutePath.includes('.git')` then exact segment check | extra false-positive trigger cost (Minor-1) |
| Timer leak on dispose | YES | both timers cleared, pending cleared | pinned by spec |
| Listener exception | YES | caught, reported, delivery continues | pinned by spec |
| Root with trailing slash | YES | `rootSpelling`/`rootPrefix` strip trailing separators | — |
| `excludeSegmentRules` single-name case sensitivity parity with `WATCH_IGNORED_DIRS` | NO | uniformly case-insensitive | Moderate-1 |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: the case-insensitive single-segment matcher (Moderate-1) is not
  wrong in isolation, but it is a silent behavioural widening relative to
  `WATCH_IGNORED_DIRS` that nothing in this batch or the plan currently
  tests for, and it will activate the moment Batch 11 wires
  `WATCH_IGNORED_DIRS` through this port — exactly the kind of quiet drift
  this task's own root-cause analysis (C7 evidence, "single source of truth
  must feed BOTH lists") was written to prevent.
- What a robust implementation would add: (1) a fix or test for the
  storm/`signalOverflow` overlap (Failure mode 1); (2) a documented decision
  plus a parity/drift test for the case-sensitivity divergence before Batch
  11 consumes it (Moderate-1); (3) dedupe the double path-split in
  `push`/`isExcluded` (Moderate-2); (4) a UNC-root test (Moderate-3).

## Delta review (review fixes)

Scope: only the six fixes listed for this pass, re-reading the current
working-tree state of `workspace-change-coalescer.ts` (+ spec),
`workspace-watcher.interface.ts`, `run-workspace-watcher-contract.ts` (+
self-spec), `platform-core/CLAUDE.md`, and the new
`workspace-exclusion-drift.spec.ts`. Not a re-review of anything outside this
list; findings above that this pass does not touch (Minor-1's `.git`
substring check) still stand as before.

### 1. Double overflow (Failure mode 1) — FIXED

`signalOverflow()` now branches on `breaker.isStorming`
(`workspace-change-coalescer.ts:265-275`): while storming it only drops the
pending count and returns — it no longer sets `overflowOwed` or calls
`scheduleFlush`, so it can no longer race the storm's own exit overflow.
Outside a storm it still folds into `overflowOwed` via
`foldPendingIntoOverflow(false)` and schedules a flush as before.

`enterStorm()` (`:298-312`) cancels a pending flush timer only when
`!this.overflowIsForcedStormRefresh` — but critically it never clears
`overflowOwed` itself, so an overflow flag set before storm entry survives
storm entry even though its timer is cancelled. The storm's own exit
(`onStormTimer` → `'exited'` → `foldPendingIntoOverflow`, `:330-336`)
unconditionally sets `overflowOwed = true` again and calls `scheduleFlush()`;
since `flushTimer` was cleared to `undefined` by `enterStorm`, this is the
only timer that gets (re)armed, and `flush()` clears both `overflowOwed` and
`overflowIsForcedStormRefresh` atomically on the one delivery
(`:366-391`). I traced all three orderings by hand (overflow-then-storm,
storm-then-overflow, forced-refresh-then-re-entry) and in each the state
machine converges on exactly one `flushTimer` handle and one `flush()` call
per incident — never zero, never two. This matches the two new spec cases
that pin it directly: `workspace-change-coalescer.spec.ts:536-554`
("signalOverflow during a storm yields exactly one overflow") and `:556-570`
("a storm starting while a signalled overflow is pending yields exactly one
overflow"), plus the untouched forced-refresh case at `:462-475`. The forced
refresh's own re-entry survival (`overflowIsForcedStormRefresh` guarding the
timer cancellation) is the one asymmetry, and it is the documented,
intentional one — "only a forced `maxStormMs` refresh survives re-entry"
(`:152-157`) — not a leftover of the old bug.

No path to a lost overflow: `dispose()` is the only place an owed overflow
does not flush, and that is correct — "after `dispose()` the listener is
never called again" is a stated guarantee (`workspace-watcher.interface.ts:150-151`),
pinned by the existing dispose specs (`:582-605`). Timer bookkeeping is clean:
every `clock.setTimer` call site (`armStormTimer`, `scheduleFlush`) is paired
with a prior `clearTimer` where a stale handle could otherwise leak, and
`dispose()` clears both handles unconditionally.

### 2. `excludeDirNames` vs `excludeSegmentRules` semantics — FIXED

`excludeDirNames` is now required (`workspace-watcher.interface.ts:97`, no
`?`) and matched with `dirNames.has(segment)` — exact, case-sensitive
(`workspace-change-coalescer.ts:482`) — while `excludeSegmentRules` still
folds ASCII case via `equalsIgnoringAsciiCase` in `ruleMatchesAt`
(`:503-511`). This is byte-for-byte the semantics of shared's
`isExcludedWorkspacePath`/`ruleMatchesAt`
(`workspace-scan.constants.ts:166-211`), closing the base review's
Moderate-1/Failure-mode-2. No existing caller breaks: this port has no
adapter yet (Batches 8-9 per `batches.md`), and the contract runner's own
`options()` helper already always supplies `excludeDirNames: []`
(`run-workspace-watcher-contract.ts:148`), so the new required field is not a
silent break for anything in this batch.

### 3. `isExcludedBySegmentRules` routes through the real decision path — CONFIRMED, single path

`isExcludedBySegmentRules` (`workspace-change-coalescer.ts:116-127`) and the
coalescer's own `isExcluded()` (`:428-436`) both call the same module-private
`matchesExcludedSegments` (`:474-488`) — there is no second implementation;
the exported predicate is not a parallel copy, it is the production decision
function with a friendlier entry point (splitting a raw string) for a
same-input test. The drift spec
(`workspace-intelligence/.../workspace-exclusion-drift.spec.ts`) therefore
tests the actual runtime path, not a stand-in. Table has 44 rows as
described, covering worktree rules, exact-case dir names, `.git`/`.gitignore`
negatives, UNC/absolute shapes, degenerate input, and non-BMP characters,
plus a second `it` fuzzing caller-supplied edge rules (empty rule, empty
name, repeated segments). `equalsIgnoringAsciiCase` is now `codePointAt` in
both copies (`workspace-change-coalescer.ts:536-547` vs
`workspace-scan.constants.ts:222-233`), textually identical modulo comments —
closing the style review's "already diverged" Serious-1 finding for this
specific function (the two copies of `matchesExcludedSegments`/
`isExcludedWorkspacePath` and `ruleMatchesAt` themselves remain independent
implementations by architectural necessity, as the style review already
accepted; the drift spec is exactly the differential test the style review
recommended as the mitigation).

### 4. Excluded-only churn extending a storm indefinitely — bounded, acceptable, but worth a one-line note

Confirmed in `event-storm-breaker.ts`: `record()` while `storming` updates
`lastEventAt = now` on every call (`:156-159`) with no exclusion check ahead
of it (by design — INV-1 says a storming event costs one counter and nothing
else, `workspace-change-coalescer.ts:214-221`). So yes: a sustained run of
excluded-only events (further worktree deletes right after a real storm
starts) keeps pushing `lastEventAt` forward and prevents the `quietMs` exit
from ever firing. It is bounded, though: `poll()`'s second branch fires on
`stormStartedAt`, not `lastEventAt` — `now - this.stormStartedAt >=
this.maxStormMs` (`event-storm-breaker.ts:186-189`) — so no run of
events, excluded or not, can push the forced exit past `maxStormMs` (default
30 s) from the *original* storm entry. This is directly exercised by
`workspace-change-coalescer.spec.ts:462-475` ("a storm that never quiets
still yields one overflow per `maxStormMs`"), though that spec's storm is
made of normal (non-excluded) pushes, not excluded ones — no test in this
batch pins the specific "excluded pushes alone extend a storm and the
extension is still capped by `maxStormMs`" scenario, only its non-excluded
sibling and the general worktree-deletion-can't-start-a-storm case
(`:391-408`). Given INV-1's explicit invariant is about `maxStormMs`, not
`quietMs`, as the bound, and the behaviour matches that invariant exactly,
this is acceptable as implemented — I would not block on it. Recommend (not
blocking): a one-line addition to the storm/coalescer doc comment stating
explicitly that excluded events extend but never indefinitely delay a storm
exit, and optionally a spec case built the same way as the existing
`maxStormMs` test but fed exclusively `node_modules`-shaped pushes, since
the current suite's storm-duration case and its exclusion case are
otherwise disjoint and a future change to either could silently break this
specific interaction without any test noticing.

### 5. UNC root tests and exact `.git` segment detection — FIXED

`workspace-change-coalescer.spec.ts:277-302` adds a UNC-root describe block
(containment, doubled separators via `\\server\share\repo\\src\\c.ts`, ASCII
case folding via `//SERVER/Share/...`, sibling-share rejection
`\\server\share2\...` and `\\other\share\...`, nested-repo detection under a
UNC root) — this converts the base review's "looks right, not pinned"
(Moderate-3) into a tested case. The drift table separately pins three more
UNC/absolute rows (`workspace-exclusion-drift.spec.ts:59-64`). The `.git`
exact-segment table (`workspace-change-coalescer.spec.ts:334-356`) has
exactly 7 negative rows as described (`.gitignore`, `.gitattributes`,
`.gitmodules`, `.github/...`, `.git-blame-ignore-revs`, `my.git/x`,
`.GIT/HEAD`) and asserts both that no nested root is detected and that the
paths themselves still pass through undropped — correctly distinguishing
"not a nested-repo marker" from "excluded."

### 6. Contract runner `(name, setup, teardown?)` — FIXED

`run-workspace-watcher-contract.ts:129-133` now takes `teardown` as its own
trailing parameter, matching the family shape the style review cited
(`run-file-system-contract.ts:145-155`). The self-spec
(`run-workspace-watcher-contract.self.spec.ts:70-87`) calls it with the new
three-argument shape and uses the trailing `teardown` to assert
`listenerErrors` is empty — closing the style review's Serious-1 contract-
runner finding.

### Other observations from this pass

- **Moderate-2 (double path-split) also resolved, unprompted.** `push()`
  now threads the single `toRelativeSegments()` result through to
  `isExcluded(segments, relative)` (`workspace-change-coalescer.ts:223-235`),
  and `isExcluded`/`matchesExcludedSegments` consume those segments directly
  with no second `split` (`:428-436`, `:474-488`) — confirmed by the spec's
  own `String.prototype.split` spy assertion
  (`workspace-change-coalescer.spec.ts:503-534`, `expect(splitCalls).toBe(0)`
  while storming, and by inspection exactly one split per non-storming
  event). Not one of the six requested fixes, but it removes a finding the
  base review carried forward.
- **Minor-2 (picomatch constructor throw) now has the doc note the base
  review asked for.** `workspace-change-coalescer.ts:163-167` documents the
  throw-before-any-listener-exists behaviour and tells a future caller to
  convert it to a typed error at the adapter boundary. Still uncaught by
  design — every caller in this batch passes literal globs, so this remains
  acceptable, matching the review brief's own framing ("acceptable for a
  trusted-constant input").
- **CLAUDE.md** now documents the `excludeDirNames`/`excludeSegmentRules`
  split and cross-references the drift spec (`platform-core/CLAUDE.md:46-56`),
  closing the style review's cross-reference-gap minor finding. The
  unrelated `EDITOR_LAUNCHER`/`PTY_HOST` shared-worktree diff noise flagged
  in the base review is still present and still not a Batch 7 concern —
  confirmed unchanged.
- Minor-1 (`.git` substring pre-check cost) is untouched, as expected — it
  was not one of the six fixes in scope, and remains harmless per the
  original analysis.
- Test evidence: verification here is by direct code and spec inspection
  (traced every relevant branch by hand against the new spec assertions,
  which match the code's actual behaviour line-for-line), now corroborated by
  a completed run: `npx nx run-many -t test -p @ptah-extension/platform-core
  @ptah-extension/workspace-intelligence` — `platform-core` 34 suites passed
  / 1 failed (35 total), 641 passed / 4 todo / 1 failed (646 total);
  `workspace-intelligence` 42 suites passed, 1075 passed (all green,
  including `workspace-exclusion-drift.spec.ts`). The one `platform-core`
  failure is `src/file-settings-manager.bench.spec.ts` ("keeps per-write cost
  flat across 1000 sequential set() calls" timing out at 30 s) — the same
  pre-existing, unrelated perf-bench flake the base review already noted as
  not a Batch 7 file; `workspace-change-coalescer.spec.ts` and
  `run-workspace-watcher-contract.self.spec.ts` are both green in this run.

### Delta verdict

- Recommendation: **APPROVE**
- Confidence: HIGH on fixes 1, 2, 3, 5, 6 (verified by direct state-machine
  tracing and matching spec assertions); MEDIUM on fix 4 (the bound is real
  and correctly implemented, but untested in its excluded-only-churn form
  specifically — recommendation, not a blocker).
- Blocking: 0. Serious: 0. Moderate: 0 new (the one open item is a
  test-coverage recommendation under §4, Moderate-leaning at most).
- Residual/carried-forward, not part of this delta's scope: Minor-1 (`.git`
  substring pre-check) from the base review still stands, unchanged and
  still non-blocking.
