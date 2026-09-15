# Code Logic Review — `TASK_2026_437_0778` Batch 22 (AC-11 tile-open perf e2e)

Scope reviewed: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (full
file, 378 lines), `test-report-b22.md` (full file, 174 lines), cross-checked against
`implementation-plan.md` AC-11 (~803) and Q6 (~873-875), `batches.md` Batch 22 / Batch 19 / Batch 20
/ Batch 21 outcomes, `apps/ptah-electron-e2e/project.json`, `apps/ptah-electron/project.json`,
`apps/ptah-electron-e2e/src/support/fixtures.ts`, `apps/ptah-electron-e2e/src/support/ui-driver.ts`,
and `libs/frontend/canvas/src/lib/canvas.store.ts` (dedup behaviour cited by the report). This is a
test-authoring batch (no production code changed); the object under review is whether the
measurement is valid enough to retire Q6 on.

## Summary

| Metric              | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| Overall score       | 6/10                                                        |
| Assessment          | NEEDS_REVISION (report only, not the spec's core mechanism) |
| Blocking issues     | 0                                                           |
| Serious issues      | 2                                                           |
| Moderate issues     | 3                                                           |
| Failure modes found | 3                                                           |

## Five logic questions

### 1. How does this fail silently?

- `test-report-b22.md:149-153` uses the measured numbers to declare Q6 "decided" without ever
  disclosing that every run was taken against a **development** renderer build. `apps/ptah-electron-e2e/project.json:11-14`
  makes the `e2e` target `dependsOn` `build-dev` + `copy-renderer-dev` on `ptah-electron`, and
  `apps/ptah-electron/project.json:324` shows `copy-renderer-dev` runs
  `nx build ptah-extension-webview --configuration=development` — unminified, no AOT prod
  optimizations, Angular dev-mode checks active. A reader of the report has no way to know the
  1,500 ms budget was missed against a build mode nobody ships. That is a silent generalization: the
  report reads as "the shipped app misses AC-11 by 3-6×" when what was actually measured is "the dev
  build misses it by 3-6×." The direction is very likely the same in production (see Verdict), but
  the report states the conclusion with a confidence the evidence doesn't fully license, and never
  says so.
- `fixtures.ts:19,45-51` launches a **fresh** `ElectronApplication` per test with no warm-up test
  preceding the measured one. `finalizeSessionHistory`, `SessionHistoryReplayer`, the canvas tile
  component and its markdown-rendering path may pay a one-time module-evaluation / JIT-warm-up cost
  the very first time a tile is populated. The observer is installed after the canvas/sidebar
  settle (spec.ts:306-309), which correctly excludes canvas _bootstrap_, but nothing in the spec or
  report excludes or measures whether the first of the 3 tile-open long tasks is inflated by
  first-render/first-compile cost relative to the second and third. The per-task list in the report
  (test-report-b22.md:105-108) is presented undifferentiated; no analysis was done on whether the
  distribution is flat or front-loaded, which would have answered this for free from data already
  collected.

### 2. What user action produces unexpected behaviour?

Not applicable in the usual sense (this is a test artifact, not application logic) — but the
closest analogue: a team member reading `test-report-b22.md:149-153` alone, without opening this
review or the spec file, will treat "Q6 is decided" as a production fact. That is the "user action"
this artifact invites, and it is not fully supported without the caveats above.

### 3. What input data produces a wrong answer?

- The synthetic fixture's tool outputs are the two-character literal `'ok'`
  (`tile-open-longtask-budget.perf.spec.ts:185`) and its text deltas are one-line strings
  (`:150,167`). Real assistant turns in this codebase commonly carry multi-paragraph markdown,
  fenced code blocks and larger tool outputs, all of which route through the markdown-rendering
  chokepoint (`libs/frontend/markdown`) per repo convention. Rendering 2,000 short, uniform, no-markup
  events per session is very likely **cheaper** per event than a real 2,000-event session, on top of
  the mocked-IPC understatement the report already names (test-report-b22.md:155-159). This is a
  second, distinct understatement mechanism the report doesn't separate out from the IPC one.
- The 3-distinct-sessions reading (report's own justification, test-report-b22.md:34-39, backed by
  `canvas.store.ts:157`'s dedup) is the only reading `CanvasStore.addTileFromSession` makes possible
  and is fairly argued. It does mean the harness measures 6,000 total events, not "3 tiles of a
  [single] 2,000-event session" read literally — that ambiguity in AC-11's own wording is real, but
  the report's resolution of it is defensible and correctly documented as a deliberate choice, not
  smuggled in silently.

### 4. What happens when a dependency fails?

- `ui-driver.ts:102-106`: the `chat:resume` mock resolver is **recompiled via `new Function` on
  every inbound `'rpc'` IPC message**, not once at registration. Because the spec embeds all 3
  sessions' full event arrays in one JSON literal inside the function body
  (`resumePayloadBySession`, spec.ts:239-254, ~6,000 events), every one of the 3 concurrent
  `chat:resume` calls re-parses and re-JIT-compiles that entire ~multi-hundred-KB source string in
  the Electron **main** process before replying. This runs on the main process, so it is invisible
  to the renderer's `PerformanceObserver('longtask')` and does not directly inflate the reported
  numbers — but it does mean the 3 "concurrent" resumes are serialized behind a single-threaded main
  process doing non-trivial parse/compile work between them, which likely **spreads out** the arrival
  of the 3 replies at the renderer compared to a real `chat:resume` handler (which streams from
  SQLite without re-JIT-compiling a growing literal each call). Spread-out replies reduce
  simultaneous renderer contention versus what production's faster IPC path would produce. This
  reinforces the report's own "mocked RPC likely understates real cost" note
  (test-report-b22.md:155-159) with a second, more specific mechanism than the one named there — and
  suggests a cheap fix (memoize the compiled resolver once outside the per-message handler, or key
  the mock by session id instead of embedding all 3 payloads in every compiled function) that would
  make future runs of this same spec measure the _more_ concurrent, worse-case scenario.
- If the Electron app process fails to launch or the mainWindow never reaches
  `domcontentloaded`, `fixtures.ts:81-84`'s `mainWindow` fixture and `ui.prepare()`
  (`ui-driver.ts:145-157`) will hang on their `waitFor`/`waitForLoadState` calls until Playwright's
  own test timeout fires; there is no bespoke timeout or diagnostic message layered on top, so a
  fixture-level failure and a genuine perf regression would both eventually show up as a Playwright
  timeout with the same generic message. Minor, since this is shared harness behavior across every
  spec in this suite, not something Batch 22 introduced.

### 5. What is missing that the requirements never mentioned?

- **Long-task attribution.** The observer callback only records `startTime`/`duration`
  (spec.ts:203-206, 310-323); `PerformanceObserver` longtask entries also expose `name` and an
  `attribution` array (containerType/containerName/src) in Chromium, and nothing here reads them.
  Correlating attribution (or, cheaper, `performance.mark()`s already loggable from
  `SessionHistoryReplayer`'s per-chunk yield and `finalizeSessionHistory`'s two passes) against the
  recorded long-task timestamps would tell whether the ~500-700 ms outlier tasks are chunked-replay
  work, `finalizeSessionHistory`, or Angular's own change detection/DOM update for 3 tiles at once —
  exactly the breakdown Q6 needs to decide _where_ to page (transcript fetch vs. render). The report
  recommends nothing here; this is the cheapest next measurement available (add a handful of
  `performance.mark`/`measure` calls around the three phases already named in the Batch 19/20 design
  notes, re-run once) and it is missing.
- **Distribution-over-time analysis of the already-collected per-task list.** The report has the raw
  per-task durations for run 1 (test-report-b22.md:105-108) but never checks whether the largest
  tasks (500-700 ms) cluster near the start (first tile / cold path) or are spread evenly across all
  3 tiles — free evidence for the warm-up question in §1 that was collected but not used.
- **Production-build corroboration.** Given the report will retire Q6 (a product decision), one
  production-configuration run (`nx build` instead of `build-dev`, even manually once) would
  meaningfully raise confidence that the 2.9-3.7× miss survives outside dev mode. Not done, not
  flagged as a limitation.

## Failure modes

### Dev-build renderer cost folded into a "shipped app" conclusion

- Trigger: any reader of `test-report-b22.md:149-153` treating the AC-11 miss as measured against
  the app users run.
- Symptom: Q6 (tail-paged history) gets decided, or deferred, on numbers that include Angular
  dev-mode overhead nobody ships.
- Evidence: `apps/ptah-electron-e2e/project.json:11-14`, `apps/ptah-electron/project.json:324`.
- Current handling: report is silent on build mode entirely.
- Recommendation: add one sentence to `test-report-b22.md`'s "Risks / caveats" naming the dev build,
  and — if cheap — one production-configuration run to bound how much of the 2.9-3.7× is dev-mode
  tax versus real algorithmic cost.

### Cold-start / first-render cost uncounted

- Trigger: the first of the 3 tiles opened pays one-time module-eval/JIT cost the 2nd and 3rd don't.
- Symptom: reported `max`/`total` may skew high in a way a warmed-up production session wouldn't
  reproduce on tile 2 and 3 alone; no way to tell from the report as written.
- Evidence: `fixtures.ts:19,45-51` (fresh app per test, no warm-up run); spec.ts:306-333 (observer
  installed once, all 3 clicks fired into the same window with no per-tile breakout in the
  aggregation at spec.ts:361-362).
- Current handling: none; `max`/`total` are reported as flat aggregates.
- Recommendation: bucket long tasks by which tile-open window they fall in (using the wallStart
  timestamp and each tile's own marker-visible timestamp) and report per-tile max/total, or add one
  throwaway warm-up tile-open before the measured 3, discarding its long tasks.

### Report's own gap in run 2 is disclosed but not neutral

- Trigger: run 2's wall/count/per-task data lost to terminal scrollback truncation.
- Symptom: only 2 of 3 runs are independently reproducible from evidence in the report; run 2
  contributes only its final assertion line (678 ms max).
- Evidence: `test-report-b22.md:100,110-114,160-163` (self-disclosed).
- Current handling: honestly reported as a documentation gap, not treated as invalidating; the
  report correctly declines to paper over it with a 4th run it says wasn't necessary given the other
  two runs' margin. This is the right call given the wide, consistent miss on runs 1 and 3 — no
  further action needed, but noting it here since the task explicitly asked "why was run 2 not fully
  captured."

## Blocking issues

None. Nothing found makes the artifact actively misleading in the direction of its conclusion — the
gaps found affect _confidence in magnitude and generalizability_, not the reported _direction_
(AC-11 misses by a wide margin).

## Serious issues

### Dev-build measurement not disclosed as a limitation

- File: `test-report-b22.md` (whole "Risks / caveats" section, 154-174) — dev build is absent from
  the list of caveats despite being the single largest lever on absolute renderer timing numbers.
- Scenario: report is read in isolation to decide Q6.
- Impact: a decision-maker overweights the exact multipliers (2.9-3.7×) as production fact.
- Fix: add the caveat; optionally corroborate with one production-configuration run.

### No warm-up / no per-tile breakdown of already-collected data

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:306-362`.
- Scenario: first-tile cold-render cost is indistinguishable from steady-state cost in the reported
  aggregate.
- Impact: report cannot tell (and doesn't try to tell) whether the budget would still miss on tile 2
  and 3 alone, which matters for scoping Q6's fix (does it need to help cold start, or steady-state
  replay, or both).
- Fix: bucket long tasks per tile-open window using already-available timestamps, or add a discarded
  warm-up open.

## Moderate and minor issues

- Moderate: `ui-driver.ts:102-106` recompiles the `chat:resume` mock resolver from a large embedded
  JSON literal on every call, which likely spreads out (understates) true renderer-side concurrency
  versus a real, faster `chat:resume` path — refines, rather than contradicts, the report's existing
  "mocked RPC understates cost" note. Cheap fix: memoize the compiled function once.
- Moderate: fixture content (`'ok'` tool outputs, one-line text deltas, spec.ts:150,167,185) is
  markup-free and short; real sessions with fenced code / long markdown through
  `libs/frontend/markdown` are plausibly heavier per event. Not fatal to the "miss" conclusion since
  it points the same direction (understatement), but worth a line in the report.
- Moderate: no long-task `attribution`/`name` capture (spec.ts:310-323) — cheapest available next
  measurement for Q6 (see §5) is left undone.
- Minor: `mainWindow`/`ui.prepare()` fixture waits (`fixtures.ts:81-84`, `ui-driver.ts:145-157`) have
  no bespoke diagnostic on timeout; shared harness behavior, not introduced by this batch.
- Minor: the report's per-task duration list (test-report-b22.md:105-108) is only given for run 1;
  runs with the full list for at least one more run would strengthen the "recurring 500-700ms task"
  claim, though runs 1 and 3 already agree on shape.

## Data flow

1. Test launches a fresh, dev-build Electron app (`fixtures.ts:45-51`, dev build per
   `project.json` deps) — OK for correctness, gap for representativeness (Serious above).
2. `ui.mockRpc` registers 3 session fixtures + resolvers; `session:metadataChanged` pushed to force a
   sidebar re-fetch against the now-registered mock (`spec.ts:256-286`) — OK, avoids reaching into
   sidebar internals.
3. Canvas navigated to, sidebar rows confirmed visible before instrumentation starts
   (`spec.ts:277-304`) — OK, correctly excludes bootstrap cost from the measured window.
4. `PerformanceObserver('longtask')` installed in the same top-level page the tiles render into (no
   `<iframe>`/`<webview>` per tile found in `libs/frontend/canvas/src`) — OK, correct frame.
5. All 3 sidebar rows clicked back-to-back with no per-click wait (`spec.ts:331-333`) — OK, matches
   AC-11's concurrent-open intent; real IPC replies are throttled by the main-process resolver
   recompilation noted above, an artifact of the mock, not the app.
6. Each tile awaited to its own marker bubble (`spec.ts:342-348`) before reading back the observer —
   OK, ensures all 3 resumes + chunked replay + finalization actually completed before the read.
7. `max`/`total` computed as flat aggregates over all long tasks in the window (`spec.ts:361-362`) —
   gap: no per-tile bucketing, no attribution (Serious/Moderate above).
8. Observer disconnected, app closed in `finally` (`spec.ts:357`, `fixtures.ts:49-51`) — OK, no
   resource leak.
9. Assertions run unconditionally against the stated budgets, not loosened on miss
   (`spec.ts:375-376`) — OK, matches the batch instruction not to loosen the gate.

## Requirements fulfilment

| Requirement                                                                                     | Status                                    | Gap                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AC-11 perf half: measure with Playwright `PerformanceObserver('longtask')` against the real app | COMPLETE                                  | dev build only, not disclosed                                                                                                  |
| Gated behind `PTAH_PERF_SPECS=1`, skip proven                                                   | COMPLETE                                  | none                                                                                                                           |
| Exercises Batch 19/20/21 code paths                                                             | COMPLETE                                  | real renderer services used via mocked-transport-only IPC; confirmed by design cross-reference                                 |
| Report a miss honestly rather than loosen the budget                                            | COMPLETE                                  | none                                                                                                                           |
| AC-11's "≤2×E event visits" CI half                                                             | COMPLETE (deferred to Batch 19 unit test) | explicitly and correctly scoped out, not this batch's job                                                                      |
| Evidence sufficient to retire Q6                                                                | PARTIAL                                   | direction is solid; magnitude/generalizability caveats (dev build, warm-up, mock-serialization, fixture content) not disclosed |

Implicit requirements not addressed: long-task attribution/phase breakdown to inform _where_ Q6's
fix should target; production-build corroboration for a report that decides a product question.

## Edge cases

| Case                                          | Handled | How                                                                         | Concern                                                                        |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Re-requesting the same session (dedup)        | YES     | interpreted as 3 distinct sessions per `canvas.store.ts:157`                | correctly documented, only reading possible                                    |
| No `PTAH_PERF_SPECS` env var                  | YES     | `test.skip`, proven `1 skipped` twice                                       | none                                                                           |
| Cleanup on failure                            | YES     | `app.close().catch(() => {})` in `finally`, observer disconnect before read | none                                                                           |
| Cold start vs steady state                    | NO      | not measured or bucketed                                                    | see Serious issue above                                                        |
| Long-task source attribution                  | NO      | only `startTime`/`duration` captured                                        | see Moderate issue above                                                       |
| Concurrent-open realism vs mock serialization | PARTIAL | clicks fired back-to-back                                                   | main-process resolver recompile likely spreads replies out; see Moderate issue |
| Run reproducibility                           | PARTIAL | 3 runs attempted                                                            | run 2 partially lost to scrollback, honestly disclosed                         |

## Verdict

- Recommendation: REVISE (of the report only — no change needed to the spec's core mechanism,
  gating, or cleanup, which are sound)
- Confidence: MEDIUM
- Top risk: `test-report-b22.md` will be read as "the shipped app misses AC-11 by 3-6×" and used to
  lock in Q6, when what was actually measured is "a dev-mode build, on a cold-launched app, with a
  mock that likely both understates (no real IPC/markup) and slightly desynchronizes (main-process
  resolver recompile) real concurrent load, misses AC-11 by a wide margin." The direction is very
  likely unchanged in production — a 3-6× miss is unlikely to fully close from build-mode
  optimization alone — but the report should say so explicitly rather than let the reader assume
  parity with production.
- What a robust version would add: (1) one caveat sentence naming the dev build in
  `test-report-b22.md`; (2) per-tile bucketing of the long-task list already collected, to separate
  cold-start from steady-state cost; (3) `performance.mark`/`measure` around
  `SessionHistoryReplayer` chunk yields and `finalizeSessionHistory`'s two passes, correlated against
  long-task timestamps, as the cheapest next measurement to tell Q6 _where_ to page; (4) optionally,
  one production-configuration run for corroboration before treating Q6 as fully decided.
