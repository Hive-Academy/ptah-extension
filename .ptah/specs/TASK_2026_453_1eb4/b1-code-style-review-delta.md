# Code Style Review — Delta — `TASK_2026_453_1eb4` Batch 1 (after Revise round 1)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 8/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 0                                     |
| Minor issues    | 2                                     |
| Files reviewed  | 5 (spec + 4 support files, delta only)|

Scope: re-read `tile-open-longtask-budget.perf.spec.ts` (602 lines), `perf-page-capture.ts`
(384 lines), `perf-session-fixture.ts` (259 lines), `perf-diagnostics.ts` (416 lines, unchanged
in this round per `git status --short`), and the new `perf-measurement-report.ts` (186 lines).
Cross-checked against `b1-code-style-review.md`'s Serious issue and three Minors, and against
the "Revise round 1" section of `b1-codex-report.md`. `git status --short` confirms only the
same seven Batch 1 artifacts changed (`perf-diagnostics.ts` modified, `perf-page-capture.ts` /
`perf-session-fixture.ts` / `perf-measurement-report.ts` new/untracked, spec + `CLAUDE.md` +
`test-report-b22.md` modified) plus the three review/report docs — no scope creep.

## Findings on the base review's open items

### Base Serious — spec over 700 lines: CLOSED

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (602 lines,
  confirmed by `wc -l`).
- The four functions the base review named for extraction (`summarizeMeasurement`,
  `logMeasurementBuckets`, `assertScrollSanity`, `assertUsableMeasurement`) plus
  `captureOptionalDiagnostics`, `writeDiagnostics`, `writeCpuProfile`, and
  `resolvePerfOutputDirectory` moved to `perf-measurement-report.ts:1-186`. Fixture/handle setup
  (`resolveButtonHandles`, `sessionRowButton`, `waitForTileMarker`, `prepareCanvasWithSessions`)
  joined `perf-session-fixture.ts`, now 259 lines. The spec itself is 602 lines — below the
  700-line soft ceiling, and no fragment under ~150 lines was created (smallest new file is 186).
- Base Minor 3 (`perf-session-fixture.ts` at 146 lines, "one line under the ~150 line guardrail")
  is moot: the file grew to 259 lines carrying real additional content, not padding.

### Base Minor — `PageContext`/`CDPSession` duplicated: CLOSED

- `perf-page-capture.ts:8-9` is now the sole definition (`export type PageContext = ...`,
  `export type CDPSession = ...`). The spec imports `CDPSession` at
  `tile-open-longtask-budget.perf.spec.ts:13` and uses it at line 233
  (`let cdpSession: CDPSession | null = null;`). Grepped the working tree; no second copy exists.
  This matches the treatment the base review already found correct for `LongTaskEntry`/
  `TraceEvent`/`RafAttributionRow` — the outlier is gone.

### Base Minor — restated single-slot doc comment in `openTilesWithinPage`: CLOSED

- `perf-page-capture.ts:175-179` now reads: "Clicks are separated by one `requestAnimationFrame`
  yield because the product currently consumes tile-open requests through a single-slot signal.
  The spec header is the canonical incident write-up; keep this capture helper focused on the
  scheduling contract it must implement." That is a pointer to the spec's own write-up
  (`tile-open-longtask-budget.perf.spec.ts:153-170`), not a second prose copy of the incident.
  One source of truth remains; the inline one-liner at the old `:335` location is now folded into
  this same short note (`perf-page-capture.ts:328` `// Disclosed FU-22a stress cadence; retained
  until the product queue lands.` — a pointer, not a restatement).

## New surface: `perf-measurement-report.ts`

- **Nameability test**: passes the letter of the rule (not `helpers`/`utils`/`common`/`misc`),
  but the file gathers four related-but-distinct jobs under one name: diagnostics I/O
  (`writeDiagnostics:43-62`, `writeCpuProfile:64-82`, `resolvePerfOutputDirectory:37-41`),
  measurement summarization (`summarizeMeasurement:84-119`, `logMeasurementBuckets:121-137`),
  usability/functional gating (`assertUsableMeasurement:139-151`, `assertScrollSanity:153-166`),
  and optional-diagnostics orchestration (`captureOptionalDiagnostics:168-186`). `assertScrollSanity`
  in particular checks tile ownership and scroll position — a functional correctness gate, not a
  measurement-report concern — and sits awkwardly next to `writeCpuProfile`, which is pure I/O.
  This is a real Minor (see below), not a Serious: every function here still exists only to turn
  the raw signals from `perf-page-capture.ts`/`perf-diagnostics.ts` into the one thing the spec
  needs per scenario — a validated, logged, persisted measurement — so the unifying idea ("build
  and gate the AC-11 report for one run") is defensible even though it spans I/O, assertion, and
  summarization.
- **One concern vs. grab-bag**: not a grab-bag in the sense the guardrail is aimed at (no
  unrelated features bolted on for convenience) — every export is reachable from, and only from,
  the four test bodies in the spec, and each is single-purpose internally. But it is the broadest
  of the four support files by function count (8 exports vs. 2-6 in the siblings), which is the
  cost of consolidating four sub-concerns instead of the base review's suggested single
  `perf-measurement-summary.ts` scoped to summarization only.

## Dependency direction

- Traced imports: `perf-diagnostics.ts` has no local imports (base layer). `perf-page-capture.ts`
  imports types only from `perf-diagnostics.ts` (`perf-page-capture.ts:2-6`).
  `perf-session-fixture.ts` imports only from `./fixtures` and `./ui-driver` — no perf-support
  imports at all. `perf-measurement-report.ts` imports from `perf-diagnostics.ts`,
  `perf-page-capture.ts`, and type-only from `perf-session-fixture.ts` (`perf-measurement-report.ts:5-21`).
  The spec imports from all four support files and from none of them is there a reverse import
  back into `specs/`.
- Grepped `apps/ptah-electron-e2e/src/support/**` for any `from '.*specs` import: no matches. The
  spec-imports-from-support, never-reverse rule holds.
- No cycle: the chain is strictly `perf-diagnostics` → `perf-page-capture` → `perf-measurement-report`,
  with `perf-session-fixture` independent until `perf-measurement-report` pulls in its
  `SessionFixture` type. Acyclic.

## Type export duplication

- Confirmed single source for every cross-file type: `PageContext`/`CDPSession`
  (`perf-page-capture.ts:8-9`), `LongTaskEntry`/`TraceEvent`/`LongTaskAttribution`
  (`perf-diagnostics.ts`), `OpenTilesResult`/`RafAttributionRow`/`TraceCapture`
  (`perf-page-capture.ts:16-38`), `SessionFixture`/`GeneratedEvent` (`perf-session-fixture.ts:6-31`),
  `MeasurementSummary`/`OptionalDiagnostics` (`perf-measurement-report.ts:23-35`). No type is
  declared twice.

## Scope creep

- None found. `git status --short` lists exactly the same six Batch 1 artifacts as the base
  review's scope, unchanged in identity: `test-report-b22.md`, `CLAUDE.md`, the spec, and
  `perf-diagnostics.ts` modified; `perf-page-capture.ts`, `perf-session-fixture.ts`,
  `perf-measurement-report.ts` new. `perf-diagnostics.ts` is listed as modified by git but its
  content (416 lines) matches the base review's already-approved 9/10 file; the revise round did
  not touch it (the codex report's "Revise round 1" section does not name it, and the line count
  matches the base review's figure exactly) — likely a working-tree touch with no net diff, not a
  logic change; not re-scored here since nothing changed to review.

## Minor issues

1. `perf-measurement-report.ts` bundles diagnostics I/O, measurement summarization, functional
   scroll-sanity gating, and optional-diagnostics orchestration under one name (see "New surface"
   above). Not a grab-bag by the guardrail's letter, but the next time this file is touched, favor
   splitting `assertScrollSanity` out (it is a functional/DOM check, not a measurement-report
   concern) before adding a ninth export here.
2. `perf-diagnostics.ts` shows as modified in `git status` with a line count identical to the
   version the base review already scored 9/10, and the "Revise round 1" section of
   `b1-codex-report.md` does not mention touching it. Confirm before merge that this is a
   no-op diff (formatting/whitespace) and not an unreported content change outside this delta's
   verification.

## Pattern compliance

| Repository rule or nearby convention                                              | Status | Evidence                                                                                   |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| File-size soft ceiling 700 lines                                                    | PASS   | Spec now 602 lines (was 855); all support files ≤416 lines                                   |
| No file under ~150 lines created just to satisfy the cap                            | PASS   | Smallest new file (`perf-measurement-report.ts`) is 186 lines                                 |
| Extracted file passes nameability test, no `helpers`/`utils`/`common`/`misc`        | PASS (weak on breadth) | `perf-measurement-report.ts` is named for a purpose, but spans 4 sub-concerns (see Minor 1) |
| Shared types centralized once, imported by consumers                                | PASS   | `PageContext`/`CDPSession` now sole-sourced at `perf-page-capture.ts:8-9`                     |
| Support modules as plain exported functions (sibling: `perf-diagnostics.ts`)         | PASS   | `perf-measurement-report.ts` exports plain functions/interfaces only, no class                |
| Dependency direction: spec imports support, never reverse                           | PASS   | No `from '.*specs` match anywhere under `support/`                                            |
| No import cycle among the four support files                                        | PASS   | Acyclic chain traced above                                                                    |
| Scope: only Batch 1's listed files changed                                          | PASS   | `git status --short` matches the prior 6-file scope plus review docs                          |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `perf-measurement-report.ts` is the broadest of the four support files and folds
  a functional assertion (`assertScrollSanity`) into what is otherwise a measurement-summarization-
  and-I/O module; this is a Minor, not a blocker, since every export is still single-purpose and
  reachable only from the spec it serves.
- What a 10/10 version would do differently: split `assertScrollSanity` (and, if it grows,
  `assertUsableMeasurement`) into a small `perf-measurement-assertions.ts` so
  `perf-measurement-report.ts` is strictly "summarize, log, and persist," matching the base
  review's original single-concern suggestion more precisely than the four-in-one shape landed
  here.
