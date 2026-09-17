# Code Style Review — Delta — `TASK_2026_437_0778` Batch 22 (AC-11 tile-open perf e2e)

Base: `b22-code-style-review.md` (APPROVED, 7/10, 0 blocking / 1 serious / 3 minor), written against
the **378-line, revision-2** state of `tile-open-longtask-budget.perf.spec.ts`. This delta reviews
what changed since: `apps/ptah-electron-e2e/CLAUDE.md` (+4 lines, "Perf specs" section),
`apps/ptah-electron-e2e/src/support/ui-driver.ts` (+19/-4, resolver memoization), and the spec file
itself, which grew from 378 to **1,184 lines** in revision 3 (CDP profiling, per-tile bucketing, the
in-page `MutationObserver` rewrite, and a much longer header comment). `eslint`/`prettier --check`
on all three changed files: clean, no findings.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 1              |
| Minor issues    | 3              |
| Files reviewed  | 3 (delta only) |

## Base findings — closed / open

- **Serious — "third naming/location shape for Playwright perf specs, CLAUDE.md silent" — CLOSED.**
  `apps/ptah-electron-e2e/CLAUDE.md` now carries a "Perf specs" subsection (added between the
  "Specs" and "Build & Run" sections) naming `*.perf.spec.ts` + `PTAH_PERF_SPECS=1` as the convention,
  citing this file as the example, and explicitly stating that `startup-tti.spec.ts` and
  `perf-m1-diff-redisplay.spec.ts` predate it and are not being retrofitted. That is exactly the fix
  the base review's Serious issue and Q5 asked for — a one-line doc addition recording which shape is
  now canonical, not a rewrite or a retroactive rename. Closed cleanly.
- **Minor — `TARGET_EVENTS_PER_SESSION` missing the "AC-11:" comment prefix — CLOSED.** Now reads
  `/** AC-11: the literal per-session event count the acceptance criterion names. */`
  (`tile-open-longtask-budget.perf.spec.ts:129-130`), matching the two budget constants' prefix style.
- **Minor — per-entry `console.log` verbosity in the loop — OPEN, as expected.** Still present at
  `tile-open-longtask-budget.perf.spec.ts:1025-1029` (and a second copy for the CDP top-function dump
  at `:984-988`). The base review already scored this a non-blocking minor since the spec only runs
  under `PTAH_PERF_SPECS=1`; test-report-b22.md's "Revision 2: review fixes" section correctly records
  it as "left as-is per the reviewer's own notes" rather than silently dropping it. No new cost from
  revision 3 beyond one additional similar log block for the CPU-profile summary, same shape.
- **Minor — `makeRand` LCG duplication against `largeFixture`'s `rand` in
  `message-finalization.session-history.spec.ts` — OPEN, as expected.** Unchanged, still documented as
  deliberate cross-project-boundary independence in the header comment
  (`tile-open-longtask-budget.perf.spec.ts:55-66`). No new information changes this call.

## New findings (revision 3 content the base review never saw)

### File size crossed the soft ceiling by a wide margin, and the growth is concentrated in code with no test/page dependency

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (1,184 lines
  total; base review's own pattern-compliance table recorded "378 lines" and marked the file-size rule
  PASS against that number, which is now stale).
- Problem: root `CLAUDE.md`'s file-size rule sets a 700-line soft ceiling and says "past 1000 means a
  deliberate look, not an alarm... line count alone is not the signal." This file is 1,184 lines and
  the growth since revision 2 is not test logic — it is two self-contained diagnostic subsystems added
  inline:
  - CDP CPU-profile summarization: `CpuProfileNode`/`CpuProfile`/`CpuProfileSummary` interfaces,
    `PLAYWRIGHT_INJECTED_SCRIPT_UNIQUE_FUNCTIONS`/`AMBIGUOUS_NATIVE_API_FUNCTIONS` constant sets,
    `classifyFrame`, and `summarizeCpuProfile` (`:688-900`, ~215 lines). None of these functions touch
    `Page`, `test`, or any Playwright type — they are a pure transform from a `CpuProfile` object to a
    summary, callable and testable with zero e2e harness involvement.
  - Per-tile bucketing: `TileBucket`, `bucketByClick`, `summarizeBucket` (`:613-670`, ~58 lines) — also
    a pure function over `LongTaskEntry[]` + click timestamps, no `Page` dependency.
  - `writeDiagnostics` (`:672-684`, ~13 lines) — a small, generic "write JSON to `BACKUP_DIR`" helper,
    reused 3 times across the file's tests.
    Together these are ~290 lines (about a quarter of the file) of diagnostics-shaped code that is
    structurally identical in kind to helpers this project already keeps in `src/support/` rather than
    inline in a spec — e.g. `skill-telemetry-db.ts` (159 lines, DB-diagnostics helper used by
    `thoth/skill-telemetry.spec.ts`), `png-pixels.ts` (190 lines, pixel-diffing helper), `git-diff-mock.ts`
    (168 lines, mock-construction helper). None of those three project conventions puts this shape of
    code inside the spec file that consumes it.
- Impact: the spec file now mixes three concerns at very different altitudes — "drive the browser and
  assert AC-11" (the actual test), "classify V8 CPU profile samples into named buckets" (a
  general-purpose profiling utility that has nothing to do with tile-opening specifically), and "bucket
  long tasks by click ownership" (a second general-purpose utility). A reader who opens this file to
  understand or modify the AC-11 assertion has to scroll past ~290 lines of profiling-classifier logic
  that only activates under a second, rarer env flag (`PTAH_PERF_PROFILE=1`) to get there. The
  `PLAYWRIGHT_INJECTED_SCRIPT_UNIQUE_FUNCTIONS` / `AMBIGUOUS_NATIVE_API_FUNCTIONS` sets in particular
  are a maintenance liability specific to Playwright's own internals (confirmed by grepping
  `node_modules/playwright-core`, per the file's own comment at `:708-719`) — the kind of fact that
  needs re-verifying against Playwright upgrades, and is easier to find and revisit as its own named
  file than buried mid-spec.
- Fix: extract the CDP-profiling trio (`classifyFrame`, `summarizeCpuProfile`, the two constant sets,
  and the `CpuProfile*` interfaces) into `src/support/cpu-profile-summary.ts`, and `bucketByClick`/
  `TileBucket`/`summarizeBucket` either into the same file or alongside it — both pass the repo's
  nameability test (`cpu-profile-summary`, not `perf-helpers`/`utils`), both clear the ~150-line
  floor comfortably on their own (215 and 58 lines respectively, and the guardrail favors fewer,
  larger collaborators over fragments, so grouping the two into one `perf-diagnostics.ts` support
  module is preferable to two separate files). This is a pure-function extraction — no behavior
  change, no facade needed since nothing external currently calls into `tile-open-longtask-budget.perf.spec.ts`
  for these functions. It would bring the spec file itself down to roughly 900 lines: still long, but
  the remainder is uniformly test-and-fixture code (3 tests, the fixture builder, the header comment),
  not test code plus two unrelated utility libraries.

## Minor issues

- `apps/ptah-electron-e2e/src/support/ui-driver.ts:59-72`: the new `__uiCompiledFns` cache is a plain
  `Map` attached to `globalThis` alongside the pre-existing `__uiMockStatics`/`__uiMockFns` pattern,
  correctly typed (`Map<string, (params: unknown) => unknown>`) and consistent with how the other two
  maps are lazily initialized (`g.__uiCompiledFns = g.__uiCompiledFns ?? new Map()`, mirroring the
  `?? {}` idiom already used for the sibling fields two lines above). No cost beyond the memory of one
  compiled `Function` per distinct resolver source string for the lifetime of the page — acceptable for
  an e2e harness. One nit: the cache is keyed by raw source text and never bounded or cleared between
  tests within the same page lifetime; harmless today (`fixtures.ts` launches a fresh app per test, so
  the cache's lifetime is bounded by the test itself) but worth a one-line comment if a future spec
  ever reuses a page across tests within this fixture.
- `tile-open-longtask-budget.perf.spec.ts:930-946`: `PROFILE_ENABLED` (CDP profiling) is documented in
  the header comment (`:91-95`) and in the new CLAUDE.md-adjacent test-report, but
  `apps/ptah-electron-e2e/CLAUDE.md`'s new "Perf specs" section documents only `PTAH_PERF_SPECS`, not
  `PTAH_PERF_PROFILE` — a reader who finds the CLAUDE.md section and wants the CDP profile has to go
  back to the spec's own header comment to learn the second flag exists. Not a blocker (the flag is a
  diagnostic aid, not part of AC-11's gate), but the doc section that now exists is the natural place
  to also name it in one clause.
- `tile-open-longtask-budget.perf.spec.ts:1176-1183`: the "diagnostic: warm 3 tiles" test duplicates
  the cold test's log-formatting, bucket-summarization, and diagnostics-write call sequence almost
  verbatim (compare `:1163-1183` against `:1020-1053`), differing only in scenario name and the absence
  of the hard budget assertion. This is the same kind of "copied behaviour, not yet diverged" the base
  review already accepted for `makeRand`; flagged here only because the CDP-diagnostics extraction
  above is a natural place to also pull a shared `logAndWriteBucketDiagnostics(scenario, ...)` helper
  out of, if the file is being touched for the extraction anyway — not a separate ask.

## Pattern compliance (delta)

| Repository rule or nearby convention                                    | Status                                          | Evidence                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| File-size soft ceiling (~700 lines; 1000+ warrants a deliberate look)   | FAIL (was PASS against stale 378-line count)    | `tile-open-longtask-budget.perf.spec.ts` now 1,184 lines                                          |
| Diagnostic/infra helpers live in `src/support/`, not inline in a spec   | FAIL for the new CDP-profiling + bucketing code | `:613-670`, `:688-900` vs. `skill-telemetry-db.ts`, `png-pixels.ts`, `git-diff-mock.ts` precedent |
| Extraction candidate passes the nameability test (no `helpers`/`utils`) | N/A (not yet extracted)                         | Proposed name `cpu-profile-summary.ts` / `perf-diagnostics.ts` clears the bar                     |
| No file under ~150 lines created just to satisfy the cap                | N/A (not yet extracted)                         | Both candidate groupings clear 150 lines individually                                             |
| CLAUDE.md "Perf specs" convention note added and accurate               | PASS                                            | `apps/ptah-electron-e2e/CLAUDE.md` diff, cross-checked against spec's `PERF_ENABLED`/skip message |
| `catch (error: unknown)` / type safety                                  | PASS                                            | `writeDiagnostics`'s catch (`:678-683`) narrows with `instanceof Error`                           |
| `ui-driver.ts` change minimal, precisely typed                          | PASS                                            | `Map<string, (params: unknown) => unknown>`, no `any`                                             |
| eslint / prettier clean on changed files                                | PASS                                            | both ran clean this session                                                                       |

## Maintenance debt

- Introduced since the base review: a working, correctly-gated CDP profiling and per-tile-bucketing
  diagnostic capability that materially improved the investigation (confirmed Playwright's own
  instrumentation was polluting the measurement, per `test-report-b22.md` "Old vs new harness") — real
  value, not churn. Alongside it, ~290 lines of general-purpose profiling-classification code now lives
  inside a single spec file rather than a reusable support module.
- Retired: nothing.
- Net: positive for AC-11/Q6 evidence quality; negative for this one file's shape — it now carries two
  concerns (drive-and-assert, and CPU-profile classification) that this project's own `src/support/`
  convention keeps separate everywhere else.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the base review's Serious issue is genuinely closed, but revision 3 introduced a new,
  larger structural cost the base review never had the chance to see — ~290 lines of pure,
  Page-independent CPU-profile-classification and bucketing logic sitting inside a 1,184-line spec file
  instead of `src/support/`, where this project's own precedent (`skill-telemetry-db.ts`,
  `png-pixels.ts`, `git-diff-mock.ts`) puts diagnostics helpers of this shape.
- What a 10/10 version would do differently: extract `classifyFrame`/`summarizeCpuProfile`/the two
  Playwright-function-name sets/`CpuProfile*` interfaces and `bucketByClick`/`TileBucket`/
  `summarizeBucket` into one new `src/support/perf-diagnostics.ts` (or two files if a later reviewer
  prefers, though one collaborator is favored over fragmentation per the facade-rule guardrails); add
  `PTAH_PERF_PROFILE` to the CLAUDE.md "Perf specs" section alongside `PTAH_PERF_SPECS`; optionally
  factor the near-duplicate bucket-log-and-write sequence in the two diagnostic tests into one shared
  helper while the file is open for the larger extraction anyway.
