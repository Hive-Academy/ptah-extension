# Code Logic Review (Delta) — `TASK_2026_437_0778` Batch 22 (AC-11 tile-open perf e2e)

Scope: delta over `b22-code-logic-review.md` (base, NEEDS_REVISION), re-reviewing the current
uncommitted state in `D:\projects\ptah-437` only: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
(new, 1185 lines, full read), `apps/ptah-electron-e2e/src/support/ui-driver.ts` (full read; diff is
the `chat:resume` resolver memoization), `apps/ptah-electron-e2e/CLAUDE.md` (diff only — new "Perf
specs" subsection), `test-report-b22.md` (revision 3, full read), cross-checked against
`implementation-plan.md` AC-11/Q6 and `libs/frontend/core/src/lib/services/app-state.service.ts` +
`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` for the claimed single-slot-signal bug.
No test/e2e/perf runs were executed for this delta (read-only per instruction); conclusions rest on
static reading of the spec, the harness, the report's own numbers, and the product code the report
cites.

## Summary

| Metric                   | Value                                               |
| ------------------------ | --------------------------------------------------- |
| Overall score            | 8/10                                                |
| Verdict                  | APPROVE_WITH_FIXES                                  |
| Confidence               | MEDIUM-HIGH                                         |
| Base findings closed     | 5 of 5 (2 serious, 3 moderate/minor) — see below    |
| Base findings still open | 1 (fixture content, explicitly deferred, unchanged) |
| New findings             | 4 (0 blocking, 1 serious, 2 moderate, 1 minor)      |

Revision 3 is a real, substantive fix, not a cosmetic patch: it correctly diagnosed and removed a
harness-introduced confound (Playwright's own locator engine dominating the measured window at
≥38.9% of sampled CPU), re-verified the fix with a second CDP profile showing that share at 0%, and
used the freed signal to produce a materially sharper finding (TILE_2 concentration) than revision 2
had. That is the core measurement-validity question the coordinator asked about, and the answer is:
**yes, the revision-3 numbers are valid evidence that AC-11 misses by a wide margin under concurrent
open**, with caveats below on how far the causal attribution (auto-animate) can be pushed.

## Base findings — closed / open

| Base finding                                           | Status             | Evidence                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serious: dev-build measurement not disclosed           | CLOSED             | `test-report-b22.md:311-315` (Disclosures §1) + a full production-build run (`:250-274`), restored to dev-build state afterward (`:272-274`)                                                                                                                                |
| Serious: no warm-up / no per-tile breakdown            | CLOSED             | `spec.ts` warm-1-tile (1059-1114) and warm-3-tile (1116-1183) tests, `bucketByClick`/`summarizeBucket` (613-670), per-tile tables in `test-report-b22.md:119-163`                                                                                                           |
| Moderate: `chat:resume` resolver recompiled every call | CLOSED             | `ui-driver.ts:66-72,109-120` — memoized by source text in `__uiCompiledFns` Map, re-verified against 2 other `mockRpc`-using specs (`test-report-b22.md:370-377`)                                                                                                           |
| Moderate: no long-task attribution                     | CLOSED             | `PTAH_PERF_PROFILE=1` CDP `Profiler` capture + `summarizeCpuProfile`/`classifyFrame` (spec.ts:686-900), full attribution section in the report (119-248)                                                                                                                    |
| Minor: run 2 data gap                                  | CLOSED             | `writeDiagnostics` JSON per run (spec.ts:672-684), confirmed present for every revision-3 run                                                                                                                                                                               |
| Moderate: fixture content markup-free/short            | OPEN (as designed) | Still `'ok'` outputs, one-line deltas (spec.ts:263,245); explicitly re-disclosed as unfixed, out of scope (`test-report-b22.md:316`, disclosure §3) — acceptable since it biases toward _understating_ the miss that's already failing by 3-9×, not toward a false positive |

The base review's own "Serious: mock resolver recompile likely spreads out replies" mechanism is
fixed as a side effect of the memoization; the report correctly folds this into disclosure #3 rather
than claiming it now proves tighter concurrency (it doesn't — memoizing the _compile_ step doesn't
change that `chat:resume` still returns synchronously with no real IPC/SQLite latency).

## Five logic questions

### 1. How does this fail silently?

- The report's "Fix-class sizing" section (`test-report-b22.md:429-446`) recommends render
  virtualization as the "highest-confidence candidate" partly by summing the ambiguous
  native-API bucket (15.7%) with a _portion_ of `other/unclassified` (38.6%) into a stated "roughly
  25-45% of sampled time" (`:431-432`). `other/unclassified` is explicitly described two paragraphs
  earlier as containing native DOM-mutation calls (`setAttribute`, `remove`, `insertBefore`,
  `appendChild`) that "the classifier cannot separate... Angular's own DOM writes... from
  autoAnimate's DOM writes... from other app code" (`:227-230`). Folding an admittedly-unseparated
  bucket into a confidence-ranked fix recommendation is the closest thing to a silent failure here:
  the report's own hedge ("depending on how `other/unclassified` splits") is present, but the
  headline framing ("highest-confidence candidate given the profile") reads as stronger than one
  profiled run with ~80% of self-time in `(program)` (31.5%) + `other/unclassified` (38.6%) +
  no-source-url (10.3%) — none of which is attributed to anything specific — actually licenses. A
  reader skimming the Verdict section, not the Attribution detail, would not see this qualifier.
- `test-report-b22.md:135` ("tiles 0 and 1 stay comfortably within budget on their own... and the
  ones that exceed it do so only slightly") is not supported by the per-tile data the same report
  lists two lines above it. Every TILE_0/TILE_1/WARM_TILE_0/WARM_TILE_1 bucket across all 5 shown
  runs (`:130-132,153`) tops out at 164 ms (Run K, TILE_0) — none reaches, let alone exceeds, the
  200 ms single-task budget. The sentence describes a scenario ("some exceed it slightly") that
  doesn't occur in the data presented. This is a minor, self-correcting inaccuracy (the actual
  numbers are right there and the overall conclusion — TILE_2 dominates — is unaffected), but a
  report whose explicit mandate is "report the measured numbers and FAIL, don't loosen" should not
  contain a claim contradicted by its own adjacent table.

### 2. What user action produces unexpected behaviour?

**Yes — a real product bug, not just a test-harness quirk.** `AppStateManager.requestCanvasSession`
(`libs/frontend/core/src/lib/services/app-state.service.ts:696-714`) writes to a single-slot signal,
`_canvasSessionRequest` (`app-state.service.ts:255`), consumed by exactly one `effect()` in
`OrchestraCanvasComponent` (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:293-308`).
Angular effects run on the next change-detection flush, not synchronously per `.set()` call — so two
`.set()` calls issued before that flush runs leave only the second value on the signal; the first is
gone with no trace. Both real call sites are click-driven: the sidebar's `onSessionClick`
(`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:564`) and the branch action
in `chat-view.component.ts:994`. A user who double- or triple-clicks two or three different sidebar
session rows in quick succession — a plausible, not contrived, interaction, especially on a slower
machine where the effect flush is delayed behind other work — can lose all but the last click's tile
open with **no visible error**: `requestCanvasSession`'s returned promise for the dropped request(s)
does eventually resolve `false`, but only after 5 seconds via the safety timeout
(`app-state.service.ts:704`, comment at 692-694), and nothing in `app-shell.component.ts`'s call site
appears to await or surface that `false` to the user (fire-and-forget per the method's own doc
comment at 690). The failure mode is exactly what the spec's own code comment discovered accidentally
while building the harness (spec.ts:513-523, test-report-b22.md:55-63) — the spec worked around it
with an artificial `requestAnimationFrame` yield between clicks, which is a valid test-harness
accommodation but does nothing for the actual application.
**Recommendation**: open a follow-up task to either (a) queue `canvasSessionRequest`s instead of
overwriting (process one per effect run, re-trigger on completion), or (b) debounce/serialize the
click handler in `app-shell.component.ts` so a second click can't land before the first request is
consumed. This is out of scope for Batch 22 (test-only), but it is real production risk this batch
surfaced and should not be lost — flag it in `batches.md`/`context.md` rather than only in this
review.

### 3. What input data produces a wrong answer?

- Confirmed as in the base review: `'ok'` tool outputs and one-line text deltas (spec.ts:263, 245)
  under-represent real markdown/fenced-code payloads that route through `libs/frontend/markdown`.
  Still open, still disclosed, still biases toward understating the miss — not toward a false
  positive on a budget that's already failing by 3-9×. Acceptable as scoped.
- The rAF-spaced click pattern (~16 ms between clicks, `openTilesWithinPage`, spec.ts:598-605) is
  **harsher than a typical human double/triple-click** (which is realistically tens to hundreds of ms
  apart, well beyond typical single-frame timing), not gentler. That pushes the "3-tile" scenario
  toward a near-worst-case simultaneous-open rather than "a user browsing 3 sessions moderately
  quickly." Given AC-11's own wording ("open 3 tiles... at once") this reading is defensible and the
  report should be read as measuring the stress case the acceptance criterion actually describes —
  but neither the spec's header comment nor the report states explicitly that 16 ms-apart clicks are
  a deliberate near-simultaneous stress case rather than an attempt to model typical realistic
  pacing. Worth one sentence so a reader doesn't assume the gap models "normal" user behavior.
- Numbers cross-checked against the report's own tables: TILE_2's share of total blocked time
  computes to 93.8% (Run I), 93.7% (Run J), 93.2% (Run K), 93.6% (warm-3-tile), 92.4% (production) —
  all inside the claimed "88-98%" range; internally consistent, no arithmetic error found.

### 4. What happens when a dependency fails?

- `ui-driver.ts:112-120`: the compiled-function cache (`__uiCompiledFns`, keyed by exact resolver
  source text) is global to the Electron main process and never evicted. Since `fixtures.ts` launches
  a **fresh** `ElectronApplication` per test (confirmed by the base review and unchanged here), the
  global resets every test — so there is no cross-test staleness risk, and the memoization key
  (source text, which embeds each test's own `randomUUID()`-generated session ids) cannot collide
  between fixtures with different content. Within a single test, a method registered twice with
  different source text simply adds a second Map entry (current lookup always uses whatever source is
  currently in `g.__uiMockFns[method]`, so correctness is preserved) — the only cost is unbounded Map
  growth for the lifetime of one test's app process, which is negligible at this scale. No staleness
  bug found; the fix is correct for its stated purpose.
- If the app never reaches `domcontentloaded` or a marker never appears, `openTilesWithinPage`'s own
  30s `timeoutMs` (spec.ts:528) fires `finish(false, true)`, and the caller throws a specific,
  diagnosable error naming `timedOut` (spec.ts:997-1002) rather than falling through to a generic
  Playwright timeout — an improvement over the base review's §4 finding about fixture-level hangs
  being indistinguishable from perf regressions (that finding was about `fixtures.ts`/`ui.prepare()`,
  still unchanged and still true, but the tile-open-specific path now has its own clear failure
  message).

### 5. What is missing that the requirements never mentioned?

- A named, explicit statement that the click cadence is an intentional concurrency stress case (see
  §3). Cheap to add, currently implicit only in the AC-11 wording.
- Any corroboration of the `other/unclassified`/`(program)` split beyond one profiled run — the report
  already flags this as a caveat (`test-report-b22.md:455-458`), so this is not a gap so much as an
  already-acknowledged limit; noted here because it directly bears on how much weight the "render
  virtualization" recommendation should carry (§1).
- A recorded follow-up for the single-slot canvas-session-request signal (§2) — this was discovered
  as a byproduct of building the perf harness and is currently documented only inside a code comment
  and the test-report's "revision 3" narrative, not as an actionable item a future batch would find.

## Failure modes

### Render-virtualization recommendation overweights an unseparated CPU bucket

- Trigger: a reader treats `test-report-b22.md`'s "Fix-class sizing" ranking as decisive rather than
  one-profiled-run-indicative.
- Symptom: Q6/the fix-selection decision anchors on render virtualization as the top candidate on the
  strength of a bucket (`other/unclassified` + ambiguous native API) that the report itself says
  cannot be attributed further by this method.
- Evidence: `test-report-b22.md:225-230` (bucket honestly described as unattributable) vs `:429-433`
  (same bucket folded into a "highest-confidence" ranking).
- Current handling: the report hedges in the detail section but not in the headline ranking.
- Recommendation: either replicate the profile 2-3 more times to see if the `other/unclassified` split
  is stable, or soften "highest-confidence candidate" to "best-supported candidate pending a second
  profiled run," matching the caveats already written elsewhere in the same document.

### Sidebar rapid-click silently drops a tile open (product code, not this batch's scope)

- Trigger: a user clicks 2-3 different session rows in the sidebar before Angular's `effect()` flush
  consumes the first `_canvasSessionRequest` (single-slot signal).
- Symptom: only the last-clicked session's tile opens; the earlier click(s) produce no tile and no
  visible error for up to 5 seconds (the safety-timeout window), and the caller
  (`app-shell.component.ts:564`) does not appear to surface even that eventual `false`.
- Evidence: `app-state.service.ts:255,696-714`; `orchestra-canvas.component.ts:293-308`;
  `app-shell.component.ts:564`; confirmed reproducible by the perf spec's own build history
  (`test-report-b22.md:55-63`).
- Current handling: worked around in the test harness with a `requestAnimationFrame` yield between
  clicks; not addressed in product code.
- Recommendation: file a follow-up task — queue or serialize `canvasSessionRequest`s, or debounce the
  sidebar click handler.

### Unsupported "exceeds slightly" claim in the per-tile narrative

- Trigger: none at runtime — this is a documentation accuracy issue, not a code defect.
- Symptom: a reader of `test-report-b22.md:134-135` expects to find a TILE_0/TILE_1 bucket over 200 ms
  somewhere in the adjacent data and won't — the highest is 164 ms.
- Evidence: `test-report-b22.md:130-132,153` vs `:134-135`.
- Current handling: none; stands as written.
- Recommendation: correct the sentence to state that TILE_0/TILE_1 stayed within budget in every shown
  run (stronger evidence for the concurrency-not-cold-start conclusion, if anything).

## Blocking issues

None. The measurement methodology (locator resolution outside the window, native click + in-page
`MutationObserver` completion detection, idle-machine checks before/after every run, dev-build
disclosure + production corroboration, before/after CDP profile proving the Playwright-confound
removal) is sound and matches what the spec's own extensive header comments claim it does.

## Serious issues

### Fix-recommendation confidence overstated relative to attribution granularity

- File: `test-report-b22.md:429-433` (Fix-class sizing, render virtualization ranked "highest-confidence").
- Scenario: a decision-maker picks a fix direction based on this ranking alone.
- Impact: engineering effort could be steered toward render virtualization on the strength of a bucket
  the report elsewhere admits it cannot attribute past "native DOM mutation and/or autoAnimate and/or
  other app code."
- Fix: soften the ranking language, or add one more profiled run to check stability of the split
  before treating it as decisive.

## Moderate and minor issues

- Moderate: single-slot `_canvasSessionRequest` signal can silently drop a tile open under rapid
  multi-click (see Failure modes) — not a defect in this batch's files, but discovered by this batch
  and not yet tracked anywhere actionable.
- Moderate: click cadence (~16 ms apart) is not explicitly labeled as an intentional near-simultaneous
  stress case versus a model of "typical" concurrent usage; AC-11's own wording supports the stress
  reading but the doc comment doesn't say so outright (spec.ts:511-523).
- Minor: `test-report-b22.md:134-135`'s "exceed it only slightly" claim is not backed by the adjacent
  per-tile data (see Failure modes).

## Data flow

1. Fresh Electron app launched per test (dev build unless the one manual production run) — OK,
   unchanged from base review, now explicitly disclosed and corroborated.
2. `mockSessions` registers `session:list`/`chat:resume`/`session:validate`; `chat:resume` resolver
   now compiled once per distinct source text (`ui-driver.ts:109-120`) — OK, base finding closed.
3. Canvas opened, sidebar rows confirmed visible pre-instrumentation (spec.ts:924, 370-392) — OK,
   excludes bootstrap cost.
4. `resolveButtonHandles` resolves 3 `ElementHandle`s with ordinary locators BEFORE the observer
   installs (spec.ts:929, 476-491) — OK, the one place Playwright locator work is allowed to run, and
   it's outside the window as claimed.
5. `installLongTaskObserver` installed (spec.ts:936, 429-456) — OK, correct frame (no iframe/webview
   per canvas source), `buffered: true` catches anything already queued.
6. `openTilesWithinPage` runs entirely inside one `page.evaluate`: native `HTMLElement.click()` +
   rAF yield + in-page `MutationObserver` scoped to mutation records only (spec.ts:524-611, fixed from
   a whole-body-per-mutation scan that cost ~2s on its own per the report) — OK, verified by a
   before/after CDP profile showing the confirmed-unique Playwright bucket go from ≥38.9% to 0%
   (test-report-b22.md:85-100, 188).
7. Long tasks collected, handles disposed, THEN sanity-check locator assertions run
   (spec.ts:991-1010) — OK, read-then-verify ordering keeps the sanity checks from polluting the
   already-captured entries.
8. Max/total computed, bucketed per-tile by nearest-preceding click (spec.ts:1012-1018, 626-658) — OK,
   correct nearest-earlier-click assignment logic, arithmetic cross-checked in §3 above.
9. Diagnostics written to `D:\projects\ptah-437-backup\`, never the repo (spec.ts:672-684, 966-973) —
   OK, matches the task's existing convention.
10. Hard assertions against the stated budgets, unconditionally (spec.ts:1055-1056) — OK, matches the
    "must not loosen the gate" instruction; all 3 dev runs and the 1 production run FAIL as reported,
    no attempt to soften.
11. Report synthesizes fix-candidate ranking from the CPU attribution (test-report-b22.md:429-446) —
    gap: ranking confidence outruns what one profiled run with ~80% unattributed/ambiguous self-time
    supports (Serious issue above).

## Requirements fulfilment

| Requirement                                                                                            | Status   | Gap                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measure with real `PerformanceObserver('longtask')` against the real app, no locator/polling in-window | COMPLETE | none — verified by before/after CDP profile                                                                                                                                                                                                                                                                 |
| Gated behind `PTAH_PERF_SPECS=1`, skip proven                                                          | COMPLETE | none                                                                                                                                                                                                                                                                                                        |
| No loosening the budget on a miss                                                                      | COMPLETE | none — all runs report FAIL honestly                                                                                                                                                                                                                                                                        |
| Dev-build disclosure + production corroboration                                                        | COMPLETE | none                                                                                                                                                                                                                                                                                                        |
| Warm-up / per-tile breakdown of already-collected data                                                 | COMPLETE | none                                                                                                                                                                                                                                                                                                        |
| Mock resolver memoization, verified not to break other specs                                           | COMPLETE | none                                                                                                                                                                                                                                                                                                        |
| Attribution sufficient to tell Q6 _where_ to target a fix                                              | PARTIAL  | mechanism-level attribution (finalization/replay/CD all <2%) is solid; source-level attribution beyond that (render work vs. autoAnimate vs. unclassified) is one profiled run, ~80% unattributed/ambiguous, and the report's fix-ranking states more confidence in that split than the data alone supports |
| Idle-machine measurement discipline                                                                    | COMPLETE | explicit before/after checks, 2 contaminated runs correctly discarded                                                                                                                                                                                                                                       |

Implicit requirements not addressed: tracking the single-slot canvas-session-request signal bug this
batch discovered as an actionable follow-up item outside this report.

## Edge cases

| Case                                                             | Handled    | How                                                                                                            | Concern                                                                                            |
| ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Playwright locator/actionability cost inside the measured window | YES        | resolved outside window, native click + in-page MutationObserver inside, verified via before/after CDP profile | none                                                                                               |
| Node↔renderer round trips inside the window                      | YES        | none found; profiler start/stop brackets the window, doesn't interrupt it                                      | none                                                                                               |
| Rapid multi-click dropping tiles (harness)                       | YES        | rAF yield between clicks                                                                                       | product code has the same latent issue, unaddressed (see Failure modes)                            |
| Mock resolver cache staleness across tests                       | YES (safe) | fresh app per test resets the global Map; keyed by exact source text                                           | unbounded growth within one test process if a method's source changes repeatedly — negligible here |
| Skip without the flag                                            | YES        | `test.skip(!PERF_ENABLED, ...)`, re-confirmed 3 skipped                                                        | none                                                                                               |
| Teardown / cleanup on failure                                    | YES        | handle disposal, observer disconnect before read, app close in fixture `finally`                               | none new found                                                                                     |
| Dev-build state restored after the manual production run         | YES        | explicit restore commands logged (`test-report-b22.md:272-274`)                                                | none                                                                                               |
| Idle-machine contamination                                       | YES        | before/after CimInstance check per run; 2 contaminated runs discarded                                          | none                                                                                               |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: MEDIUM-HIGH
- Top risk: a reader takes the "render virtualization: highest-confidence candidate" line at face
  value and commits engineering time to it before a second profiled run confirms the
  `other/unclassified` split is stable — the direction of the AC-11 miss itself (real, wide,
  concurrency-driven, TILE_2-dominant) is solid and well-evidenced; the _specific fix ranking_ is
  where the evidence thins out.
- What a robust version would add: (1) soften the render-virtualization ranking language or add one
  more profiled run before treating it as decisive; (2) correct the "TILE_0/TILE_1 exceed it only
  slightly" sentence to match the adjacent data; (3) one sentence stating the ~16 ms click cadence is
  a deliberate near-simultaneous stress case, not a model of typical pacing; (4) open a follow-up task
  for the single-slot `_canvasSessionRequest` signal found while building this harness — it is a real,
  if narrow, product bug this batch surfaced and should not be lost in a code comment.
