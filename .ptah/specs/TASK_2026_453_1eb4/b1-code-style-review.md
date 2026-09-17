# Code Style Review — `TASK_2026_453_1eb4` Batch 1

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 3                                     |
| Files reviewed  | 6 (4 modified, 2 created)             |

Scope read in full: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (855
lines), `apps/ptah-electron-e2e/src/support/perf-diagnostics.ts` (416 lines), `perf-session-fixture.ts`
(146 lines, new), `perf-page-capture.ts` (391 lines, new), `apps/ptah-electron-e2e/CLAUDE.md`, and
`.ptah/specs/TASK_2026_437_0778/test-report-b22.md`. Compared against the three named siblings
(`skill-telemetry-db.ts`, `png-pixels.ts`, `git-diff-mock.ts`) and `ui-driver.ts`. `git status --short`
confirms only these 6 files plus `b1-codex-report.md` changed — no scope creep.

## Five style questions

### 1. What breaks in six months?

Nothing structural. The one real risk is the duplicated `PageContext`/`CDPSession` type-alias pair at
`tile-open-longtask-budget.perf.spec.ts:34-36` and `perf-page-capture.ts:8-9`. If Playwright's
`newCDPSession` return type shape changes, only one copy is likely to be touched, and the two files'
CDP-session-typed values (spec's `PROFILE_ENABLED` block at :500-508, `perf-page-capture.ts`'s
`startTraceCapture`) will silently diverge until a `tsc` error appears somewhere unrelated.

### 2. What would a new team member misread?

The FU-22a "single-slot" doc comments now exist in three places with overlapping but not identical
scope: `tile-open-longtask-budget.perf.spec.ts:157-174` (the full incident writeup, left untouched per
Task 3.1's explicit deferral), `perf-page-capture.ts:176-186` (a new, shorter restatement inside
`openTilesWithinPage`'s doc comment, written by this batch), and `perf-page-capture.ts:335` (a one-line
inline comment). A reader who edits the spec's writeup without noticing the newly created echo in
`perf-page-capture.ts` would leave the two out of sync — this was created by the extraction, not
inherited from Batch 22.

### 3. What does this cost to maintain?

Low. The two new support files each own one concern (fixture generation vs. page/CDP capture) and
read the way their siblings read — plain exported functions and interfaces, no class, matching
`perf-diagnostics.ts`'s own shape. The main added cost is the type-alias duplication (Q1) and the
spec file still sitting at 855 lines against the repo's 700-line soft ceiling (`CLAUDE.md` "File
size") — see Serious Issue below.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally. `perf-session-fixture.ts` and `perf-page-capture.ts` both use `kebab-case`
filenames matching the sibling `support/` files, export plain functions rather than classes (same
shape as `perf-diagnostics.ts`), and neither introduces a new dependency. The one inconsistency is
the CDP-session type alias not being centralized the way `LongTaskEntry`/`TraceEvent` already are in
`perf-diagnostics.ts` and imported by both consumers (`perf-page-capture.ts:1-6` does this correctly
for those types, then does not extend the same treatment to `PageContext`/`CDPSession`).

### 5. What would you have done differently, and why is that better rather than merely other?

Export `PageContext`/`CDPSession` once from `perf-page-capture.ts` (which already owns all other
CDP-facing types: `TraceCapture`, `RafAttributionRow`) and import them into the spec for the
`PROFILE_ENABLED` block, the same way the spec already imports `LongTaskEntry`/`CpuProfile` from
`perf-diagnostics.ts`. That is better than the current shape because it is the pattern this batch
itself already established for every other shared CDP/trace type — the duplication is the outlier,
not a second convention.

## Blocking issues

None.

## Serious issues

### Spec file stays well above the 700-line soft ceiling after the split

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (855 lines)
- Problem: Task 1.1's acceptance criterion 1 only required the spec to end "shorter than 923 lines"
  (satisfied: 855). But the repository's own file-size rule (`CLAUDE.md` "Coding Standards" → File
  size) sets a 700-line soft ceiling and treats 1,000+ as "a deliberate look, not an alarm" — 855
  sits in the gap the facade rule is meant to resolve, and the batch's own extraction target
  (FU-22b, cited in `perf-diagnostics.ts:8-9`) was explicitly "the spec file shrinks instead of
  growing," not "shrinks below 923." The net effect: fixture (146 lines) and page-capture (391
  lines) logic moved out, but the spec absorbed nearly as much new inline logic (settle assertions,
  `summarizeMeasurement`, `logMeasurementBuckets`, `assertScrollSanity`, `captureOptionalDiagnostics`,
  a fourth diagnostic test) to net only a 68-line reduction.
- Tradeoff: none of the extracted pieces individually fail the facade rule's nameability test — both
  new files are honestly named for one capability apiece, and neither is a `helpers`/`utils` dump.
  The problem is that the spec itself keeps growing at close to the same rate as material is carved
  out of it, so the ceiling this task was supposed to make progress against is still exceeded by 22%
  six months from the last time someone looked at this number.
- Recommendation: not a blocker for this batch (the plan's literal AC is met), but the team-leader or
  a future task should extract the four `MeasurementSummary`/diagnostics helper functions
  (`summarizeMeasurement`, `logMeasurementBuckets`, `assertScrollSanity`,
  `assertUsableMeasurement`, `captureOptionalDiagnostics`, `writeDiagnostics`) into a third support
  module (e.g. `perf-measurement-summary.ts`) the next time this file is touched, since they are
  already pure and Playwright-`Page`-light (only `assertScrollSanity`/`captureOptionalDiagnostics`
  take a `Page`).

## Minor issues

- `tile-open-longtask-budget.perf.spec.ts:34-36` and `perf-page-capture.ts:8-9`: `PageContext` /
  `CDPSession` type aliases duplicated verbatim instead of exported once from `perf-page-capture.ts`
  and imported into the spec, unlike every other shared type in this batch
  (`LongTaskEntry`/`TraceEvent`/`RafAttributionRow`, all correctly centralized). Low cost today (two
  lines, structurally identical), but see Q1/Q5 above for why it is worth fixing on the next touch.
- `perf-page-capture.ts:176-186`: the restated "single-slot" doc comment inside
  `openTilesWithinPage` is new prose written by this batch (not moved verbatim from the spec), so it
  is a second, shorter source of truth for the same incident the spec's own header already documents
  at length (:157-174). Task 3.1 rewrites the spec's copy; this one should be checked for the same
  update when C3 lands, since nothing currently points from one to the other.
- `perf-session-fixture.ts` is 146 lines — one line under the repo's informal "no file under ~150
  lines created just to satisfy the cap" guardrail. Not a violation in spirit (the file was
  extracted for a genuine, nameable concern per Task 1.1 AC1, not to dodge the ceiling), but worth
  noting as the numeric edge case that guardrail exists to catch.

## File-by-file

### `tile-open-longtask-budget.perf.spec.ts`

Score 7/10 — 0 blocking, 1 serious (shared with the file-size finding above), 1 minor (type-alias
duplication). Every CodeRabbit fix (buffered pre-window exclusion, true-final-turn marker,
timestamp-before-dispatch) lands exactly where the plan cited it, and the FU-22a doc comments were
left untouched as instructed. The settle-inclusive window, per-marker buckets, and scroll-sanity gate
are wired through cleanly. The one real cost is size: this file absorbed nearly as much new logic as
it shed.

### `perf-diagnostics.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `bucketByTime` correctly de-duplicates what would
otherwise be two copies of the same loop (`bucketByClick`/`bucketByMarker` are now one-line
delegates, satisfying Task 1.2 AC3 exactly). `findRendererMainThread` and `summarizeTraceEvents` read
as pure, well-documented, single-purpose functions consistent with the file's existing
`classifyFrame`/`summarizeCpuProfile` style. Module header (:1-22) updated to describe all three
concerns without duplicating the per-function doc comments.

### `perf-session-fixture.ts` (new)

Score 8/10 — 0 blocking, 0 serious, 1 minor (line-count edge case noted above). Faithful, unmodified
move of `makeRand`/`buildLargeSessionEvents`/`SessionFixture`/`makeSessionFixture`/`GeneratedEvent`
from the spec, plus the CodeRabbit-2 fix (`turnSize`/`isFinalTurn` computed before emission,
preserving the original `rand()` call order per the file's own comment at :69-70). Reads as a single,
nameable concern; no `V2`/`Legacy` residue.

### `perf-page-capture.ts` (new)

Score 7/10 — 0 blocking, 0 serious, 2 minor (type-alias duplication; restated single-slot comment).
Owns exactly the page/CDP capture concern (long-task observer, rAF attribution, trace capture, the
settle-inclusive `openTilesWithinPage`, and post-window scroll sanity) with no stray helper names. The
in-page `scanMutations` vs. `scanWholeBody` split, and their shared `afterMarkerScan`/`recordMarkers`
helpers, are legible and match the file's own documented rationale for avoiding
O(everything-so-far) rescans (:290-299).

### `apps/ptah-electron-e2e/CLAUDE.md`

Score 8/10 — 0 blocking, 0 serious, 0 minor. The "Perf specs" paragraph is edited in place, not
duplicated; every new flag (`PTAH_PERF_RAF_ATTRIBUTION`, `PTAH_PERF_TRACE`, diagnostic-only
`PTAH_PERF_EVENTS`, `PTAH_PERF_OUT_DIR` with its `os.tmpdir()` default) is documented, along with the
settle-inclusive window, the 10 s unusable cap, and the post-window scroll/marker check. `PTAH_PERF_PROFILE`
(pre-existing) is retained rather than dropped, so the paragraph stays a single source of truth for
every flag this spec understands.

### `.ptah/specs/TASK_2026_437_0778/test-report-b22.md`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Both edits are additive notes prefixed with
"**Superseded by the FU-22d attribution spike**"; the original bullets and the confirmed-unique
Playwright-bucket paragraph at line 101/114-115/139 are untouched. This is exactly the "mark
superseded, do not rewrite history" instruction from Task 1.4 AC1 — no measurement record was
altered.

## Pattern compliance

| Repository rule or nearby convention                                              | Status | Evidence                                                                                   |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `kebab-case.ts` file naming                                                         | PASS   | `perf-session-fixture.ts`, `perf-page-capture.ts`                                            |
| Support modules as plain exported functions (sibling: `perf-diagnostics.ts`)         | PASS   | Both new files export functions/interfaces only, no class                                    |
| `catch (error: unknown)` + `instanceof Error` narrowing                             | PASS   | `perf-page-capture.ts` has no catch; spec's `writeDiagnostics` :339, `.cpuprofile` guard :540 |
| No new `catch { return <literal> }` / empty `.catch` (degradation-audit)             | PASS   | Both catches log and continue, matching `writeDiagnostics`'s existing pattern                |
| File-size soft ceiling 700 lines, facade rule on split                              | FAIL   | Spec at 855 lines; see Serious issue                                                         |
| Extracted file passes nameability test, no `helpers`/`utils`/`common`/`misc`         | PASS   | `perf-session-fixture.ts`, `perf-page-capture.ts` both name a single capability               |
| Shared types centralized once, imported by consumers (sibling: `perf-diagnostics.ts` types) | FAIL   | `PageContext`/`CDPSession` duplicated instead of exported once                        |
| Common-rules: no `V2`/`Legacy` copies, replace in place                             | PASS   | Old `BACKUP_DIR`, `markerPlaced` latch, single-call bucket loops all removed, not duplicated  |
| Common-rules: FU-22a doc comments left for Task 3.1                                | PASS   | `grep` confirms `single-slot`/`canvasSessionRequest` text intact, only relocated              |
| `apps/ptah-electron-e2e/CLAUDE.md` documents every new env flag                      | PASS   | All four new flags + settle window + scroll check documented in one paragraph                |
| `test-report-b22.md`: mark superseded, do not rewrite history                       | PASS   | Both edits are additive notes; original bullets untouched                                    |
| Scope: only Batch 1's listed files changed                                          | PASS   | `git status --short` matches the 6-file list plus the new report                             |

## Maintenance debt

- Introduced: two new, single-purpose support modules; a shared `bucketByTime` implementation
  replacing what would have been two divergent loops; one duplicated type-alias pair.
- Retired: the hard-coded `BACKUP_DIR`, the CodeRabbit-flagged buffered-entry/marker-timing/click-timestamp
  bugs, and the redundant `markerPlaced` latch.
- Net: positive. The duplication introduced (2 lines) is far smaller than the duplication removed
  (a second bucketing loop that would otherwise have been written for `bucketByMarker`), and the
  spec's remaining size is a pre-existing debt this batch reduced but did not clear.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the spec file's size reduction (68 of 923 lines) is real but modest relative to how
  much new logic this batch also added to it; the 700-line soft ceiling is still exceeded by more
  than 150 lines, and nothing in this batch's scope was going to close that gap given the amount of
  new settle/attribution logic the plan asked for.
- What a 10/10 version would do differently: centralize `PageContext`/`CDPSession` in
  `perf-page-capture.ts` instead of duplicating them, and extract the `MeasurementSummary`/diagnostics
  helper cluster (`summarizeMeasurement`, `logMeasurementBuckets`, `assertScrollSanity`,
  `assertUsableMeasurement`, `captureOptionalDiagnostics`, `writeDiagnostics`) into a third support
  module so the spec itself approaches the 700-line ceiling rather than sitting 22% above it.
