# Test Report - Batch 22 (P4, TASK_2026_437_0778)

**Revision 4** — a refactor and report-correctness pass over revision 3, per
`b22-code-logic-review-delta.md` (APPROVE_WITH_FIXES) and `b22-code-style-review-delta.md`
(NEEDS_REVISION). No perf spec was re-run for this revision (not needed — behavior is unchanged, only
code organization and report wording). Changes:

- **Style (serious)**: the spec file had grown to 1,184 lines by inlining two Page-independent
  diagnostic subsystems (CDP profile classification, per-tile bucketing). Extracted both into
  `apps/ptah-electron-e2e/src/support/perf-diagnostics.ts`, following this project's own precedent
  (`skill-telemetry-db.ts`, `png-pixels.ts`, `git-diff-mock.ts`) — pure extraction, no behavior
  change. See "What was created / changed" below for line counts.
- **Logic (serious)**: this report's "render virtualization: highest-confidence candidate" line
  overstated what one profiled run with ~54-86% of self-time in unattributable/ambiguous buckets
  actually supports. Downgraded to a hypothesis with explicit confirmation steps — see "Fix-class
  sizing" under Verdict.
- **Logic (minor)**: corrected a claim in the per-tile breakdown that contradicted its own adjacent
  data (no TILE_0/TILE_1 bucket in any run exceeds 200 ms — the highest is 164 ms, not "exceeds it
  slightly").
- **Logic (moderate)**: the spec header and this report now state explicitly that the ~16 ms
  rAF-spaced click cadence is a deliberate near-simultaneous stress case, harsher than real user
  pacing — see Disclosure #6.
- **Logic (moderate)**: recorded the single-slot `_canvasSessionRequest` product bug this batch
  discovered as an actionable, out-of-scope follow-up — see "Product bug found while building this
  harness" below — rather than leaving it only in a code comment.

**Revision 3** — fixed the measurement itself: revision 2's own CDP profile showed the harness
(Playwright's injected locator/actionability engine, PLUS a naive `MutationObserver` scan revision 2
added) dominating the sampled renderer CPU during the measured window. Revision 3 removed all of that
from the timed window and re-measured. **Revision 3's numbers are the first ones valid for AC-11 /
Q6** (unchanged by revision 4's report-wording and code-organization fixes). Revisions 1 and 2's
numbers are kept below for the record but are explicitly superseded — see "Old vs new harness" for
why they don't transfer.

Revision 2 addressed `b22-code-logic-review.md` (NEEDS_REVISION) and `b22-code-style-review.md`
(APPROVED) — see "Revision 2: review fixes" below, kept for history.

## Scope

- User request: AC-11 tile-open perf e2e — open 3 tiles of a 2,000-event session; no renderer
  long task > 200 ms; total long-task blocked time ≤ 1,500 ms (implementation-plan.md AC-11 row).
- Criterion tested: AC-11 exactly as written in `implementation-plan.md` (~line 803), measured with
  Playwright + `PerformanceObserver('longtask')` against the real running Electron app, gated
  behind `PTAH_PERF_SPECS=1`.
- Regressions covered: none new; this spec is the end-to-end proof for Batch 19 (C16, O(E+M)
  finalization) and Batch 20 (chunked `chat:resume` replay).
- Review findings covered: every serious/moderate item in `b22-code-logic-review.md` and the serious
  item in `b22-code-style-review.md` (revision 2), plus the coordinator's revision-3 measurement fix
  (this file's "Revision 3" sections).
- Deliberately not tested: AC-11's "≤ 2 × E event visits in finalization (CI)" half is already
  pinned at the unit level by `message-finalization.session-history.spec.ts` (Batch 19).

## Revision 3: the measurement fix

### The problem revision 2's own profile exposed

Revision 2 added a CDP `Profiler` capture (`PTAH_PERF_PROFILE=1`) specifically to attribute the
measured long-task time. It found **≥38.9% of sampled renderer CPU during the "cold 3-tile" window
was Playwright's own injected accessible-name/actionability engine** (`getTextAlternativeInternal`,
`isElementHiddenForAria` — confirmed by grep against `node_modules/playwright-core/lib`), driven by
the spec's own `expect(locator).toBeVisible()` polling and `.filter({ hasText })` calls. Genuinely
app-attributable categories (Angular CD, markdown, finalization) summed to under 1% of sampled time.
`PerformanceObserver('longtask')` cannot tell harness cost from app cost apart — it counts any
main-thread task over 50 ms, whoever owns it. The run-to-run spread (total 4.7 s-15.4 s across
revision-2 runs) is also consistent with harness polling noise, not a stable app-only signal.

### The fix

1. **Resolve, don't poll, before the window.** `resolveButtonHandles` resolves the 3 sidebar row
   `ElementHandle`s with ordinary Playwright locators BEFORE `installLongTaskObserver` runs — the
   only Playwright locator work in the measured tests, and it happens outside the timed window.
2. **Click and wait for completion INSIDE one `page.evaluate` call**, with no further Node↔renderer
   round trips until the window closes. `openTilesWithinPage`:
   - Clicks each button with `HTMLElement.click()` (native DOM, not Playwright's `.click()`, which
     runs its own hit-testing/visibility/animation actionability checks first — that machinery is
     exactly what the profile found).
   - Detects completion via a `MutationObserver`, resolved as one `Promise` returned to
     `page.evaluate`'s caller — no Playwright-side polling loop.
   - Records `performance.now()` at each click for later per-tile bucketing.
3. **A real bug found and fixed while building this**: firing all 3 native clicks synchronously (no
   yield between them) silently dropped 2 of 3 tiles — "open a tile for session X" is a single-slot
   request (`AppStateManager`'s `_canvasSessionRequest` signal, consumed by one `effect()` in
   `OrchestraCanvasComponent`), so 3 synchronous `.set()` calls before Angular's effect ever runs
   left only the LAST request standing. Confirmed directly: a run with the naive synchronous version
   opened exactly 1 tile (TILE_2) and timed out waiting for the other two, visible in that run's
   Playwright page snapshot. Fixed by yielding one `requestAnimationFrame` between clicks — a fixed
   scheduling primitive, not a Playwright-side poll, and ~16 ms/click is negligible next to the
   hundreds of ms this spec measures.
4. **A second, self-inflicted cost found by RE-profiling after fix 1-3**: the first version of
   `openTilesWithinPage`'s `MutationObserver` callback re-scanned `document.body.textContent` — the
   WHOLE accumulated DOM — on every mutation. That cost grows with how much is already inserted, so
   by the time the 3rd tile streams in past what the first two already added, each callback was
   re-serializing a large and growing string. A re-profile found this one function (`scan`) costing
   ~2,026 ms on its own — about 20% of sampled CPU — once Playwright's own engine had already been
   removed from the window. Fixed: the `MutationObserver` callback (`scanMutations`) now inspects
   only the mutation records themselves (`addedNodes` / the mutated `characterData` node's own text),
   which costs O(what changed), not O(everything accumulated so far). The 3 manual per-click checks
   (rare, not a hot path) still use a whole-body scan.
5. **Attribution categories were re-split** after a third profile showed the residual "Playwright"
   bucket was itself measuring the wrong thing: `getAnimations`/`getComputedStyle`/
   `getBoundingClientRect` are standard native DOM/Animation APIs that `@formkit/auto-animate` (a
   real, confirmed production dependency, actively running in the same profile) also calls — a
   blank-source-URL hit on one of these names is ambiguous between "Playwright's actionability
   check" and "the app's own animation library calling a native API." `classifyFrame` now separates
   `PLAYWRIGHT_INJECTED_SCRIPT_UNIQUE_FUNCTIONS` (names confirmed unique to Playwright's source, not
   also a standard native API — `getTextAlternativeInternal`, `elementText`, `processElement`, etc.)
   from `AMBIGUOUS_NATIVE_API_FUNCTIONS` (kept as its own, honestly-labeled bucket rather than
   silently counted as either "Playwright" or "app").

### Verification the fix works

The final clean profile (run Q, below) shows the confirmed-unique Playwright bucket at **0 ms — not
even present in the top-15 functions** (down from ≥38.9% before any fix). The remaining "native
DOM/Animation API (ambiguous)" bucket (15.7%) is very likely mostly `@formkit/auto-animate`'s own
cost (its own `autoAnimate` frame — real app URL — is directly present in the same profile at
comparable magnitude), not test-harness noise — see "Attribution" below for the full breakdown and
the honest residual ambiguity that's left.

## Old vs new harness (same fixture size, same budgets, dev build, idle machine)

| Harness                                                                         | Grand total sampled | Confirmed-unique Playwright share                            | Max long task               | Total blocked               |
| ------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ | --------------------------- | --------------------------- |
| Old (revision 2, Playwright `expect().toBeVisible()` polling in-window)         | 11,832.56 ms        | ≥38.9% (4,607.59 ms, top-15 only — true share likely higher) | 1,084-1,221 ms (3 runs)     | 10,750-15,426 ms (3 runs)   |
| New, before the `scan` fix (native clicks + whole-body `MutationObserver` scan) | 10,220.59 ms        | 9.8% (1,005.32 ms)                                           | 1,693 ms                    | 8,282 ms                    |
| **New, final (native clicks + scoped `MutationObserver` scan)**                 | **5,625.80 ms**     | **0% (not in top-15)**                                       | **1,201-1,864 ms (3 runs)** | **5,404-6,193 ms (3 runs)** |

Two things worth being precise about, since the numbers move in a direction that could look
suspicious at a glance:

- **Grand total SAMPLED CPU roughly halved** (11,832 ms → 5,626 ms) because harness-introduced work
  (Playwright's engine, then the naive whole-DOM scan) was removed from the window — this is the fix
  working as intended.
- **Max long task did NOT shrink, and in most runs got slightly LARGER** (revision 2: 1,084-1,221 ms
  vs revision 3: 1,201-1,864 ms). This is not a regression in the fix — it is direct evidence that
  Playwright's OLD polling (frequent `Runtime.evaluate` calls from Node, roughly every 100 ms) was
  ACCIDENTALLY breaking up what is otherwise one continuous, uninterrupted piece of app-side work
  into several smaller `longtask` entries. A real user's browser has no such external interruption.
  Removing it lets whatever the app is actually doing (dominated by TILE_2's chunked replay +
  finalization + `autoAnimate` reacting to a fast-growing DOM, per "Attribution" below) run as fewer,
  larger blocks — which is the MORE faithful measurement of real single-task blocking, not a worse
  one. **This means the max-single-task budget miss is real, not a harness artifact — if anything the
  old harness was hiding it.**

## Revision 3 runs (dev build, cold 3-tile, idle machine — checked before AND after every run)

| Run | Wall     | Long tasks | Max      | Total    | Verdict                                 |
| --- | -------- | ---------- | -------- | -------- | --------------------------------------- |
| I   | 6,618 ms | 23         | 1,493 ms | 5,404 ms | FAIL (max 7.5×, total 3.6× over budget) |
| J   | 7,565 ms | 28         | 1,705 ms | 6,193 ms | FAIL (max 8.5×, total 4.1× over budget) |
| K   | 5,899 ms | 18         | 1,864 ms | 5,639 ms | FAIL (max 9.3×, total 3.8× over budget) |

Per-tile breakdown (click order — click 0 = "cold start" for this fresh app, clicks 1-2 = steady
state within the same app):

- **Run I**: before-first-click 2/112/165; TILE_0 2/59/113; TILE_1 1/59/59; TILE_2 18/1,493/5,067.
- **Run J**: before-first-click 2/67/128; TILE_0 2/68/127; TILE_1 2/73/136; TILE_2 22/1,705/5,802.
- **Run K**: before-first-click 2/67/127; TILE_0 1/164/164; TILE_1 1/91/91; TILE_2 14/1,864/5,257.

(format: count/max ms/total ms.) Every run agrees on shape: **no TILE_0 or TILE_1 bucket in any of
the 3 runs exceeds the 200 ms single-task budget** — the highest is Run K's TILE_0 at 164 ms, every
other TILE_0/TILE_1 entry is well under 100 ms. **TILE_2 alone accounts for 88-98% of the run's total
blocked time and single-handedly produces the budget-busting max task in every run.** This is a
materially different and more precise finding than revision 2's ("the 3-tile case misses, tile order
isn't even") — the new harness's cleaner signal makes the concurrency-queueing pattern (each tile's
replay queues up behind the previous ones' still-in-flight work) unambiguous, and it is STRONGER
evidence for the concurrency-not-cold-start conclusion than a "some tiles exceed it slightly" reading
would have been: the first two tiles opened don't even brush the single-task budget on their own —
the miss is entirely a property of what happens when a third one queues up behind them.

Diagnostics JSON, all under `D:\projects\ptah-437-backup\`: run I
`ac11-perf-cold-3tile-1789494607287.json`, run J `ac11-perf-cold-3tile-1789494684689.json`, run K
`ac11-perf-cold-3tile-1789494808157.json`.

## Warm-up diagnostics (new harness, dev build, idle machine, not gated)

| Scenario    | Wall      | Long tasks | Max      | Total    |
| ----------- | --------- | ---------- | -------- | -------- |
| Warm 1-tile | 198 ms    | 6          | 119 ms   | 433 ms   |
| Warm 3-tile | 10,323 ms | 44         | 1,394 ms | 7,587 ms |

Per-tile (warm 3-tile): before-first-click 4/130/360; WARM_TILE_0 1/61/61; WARM_TILE_1 1/67/67;
WARM_TILE_2 38/1,394/7,099.

**This changes revision 2's warm-1-tile conclusion.** Under the OLD (polling) harness, warm 1-tile
measured 216 ms max / 1,016 ms total — just over the single-task budget. Under the NEW harness, warm
1-tile measures 119 ms max / 433 ms total — **comfortably within both budgets**. That 216 ms was
itself partly harness noise; a single warm tile of a ~2,000-event session genuinely fits the AC-11
budget. The 3-tile finding is unchanged in direction and, if anything, sharper: warm 3-tile (1,394 ms
max / 7,587 ms total) is not smaller than cold 3-tile, and TILE_2 again carries nearly the whole
cost (7,099 of 7,587 ms). **The miss is a concurrency problem, not a cold-start problem — confirmed,
not just suggested, by the cleaner measurement.**

## Attribution (CDP CPU profile, `PTAH_PERF_PROFILE=1`, new harness, cold 3-tile, dev build, run Q)

Raw profile: `D:\projects\ptah-437-backup\ac11-perf-cold-3tile-1789495399129.cpuprofile` (diagnostics
JSON alongside it: `ac11-perf-cold-3tile-1789495399513.json`). Two earlier profiled runs are also kept
for the record: `ac11-perf-cold-3tile-1789495090590.cpuprofile` (before the `scan` fix — the
"New, before the `scan` fix" row above) and `ac11-perf-cold-3tile-1789495260470.cpuprofile` (after
the `scan` fix, before the native-API reclassification in `classifyFrame`). Self time computed
directly from `samples`/`timeDeltas` — exact, not approximated.

### Self time by category (grand total 5,625.80 ms sampled)

| Category                                                                   | Self time   | Share                  |
| -------------------------------------------------------------------------- | ----------- | ---------------------- |
| other/unclassified                                                         | 2,170.20 ms | 38.6%                  |
| `(program)` (V8/native, no JS frame)                                       | 1,770.70 ms | 31.5%                  |
| native DOM/Animation API (ambiguous: Playwright OR app, e.g. auto-animate) | 882.10 ms   | 15.7%                  |
| no-source-url (uncategorized)                                              | 580.11 ms   | 10.3%                  |
| `(garbage collector)`                                                      | 121.79 ms   | 2.2%                   |
| Angular change detection/rendering                                         | 69.86 ms    | 1.2%                   |
| markdown/DOMPurify/marked                                                  | 17.21 ms    | 0.3%                   |
| `(idle)`                                                                   | 9.11 ms     | 0.2%                   |
| chat-streaming finalization (C16)                                          | 4.18 ms     | 0.1%                   |
| session-history-replayer chunked replay                                    | 0.53 ms     | 0.0%                   |
| **Playwright injected script (confirmed unique name)**                     | **0 ms**    | **0.0% (not present)** |

### Top functions by self time

| Self time   | Function                 | Source                                                                                     |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| 1,770.70 ms | `(program)`              | native/V8, no JS frame                                                                     |
| 870.96 ms   | `getAnimations`          | ambiguous — native Animation API; very likely `@formkit/auto-animate` (see below)          |
| 187.29 ms   | `(anonymous)`            | app, `chunk-EAHQWTN3.js`                                                                   |
| 179.19 ms   | `formatTime`             | app, `chunk-EAHQWTN3.js`                                                                   |
| 161.04 ms   | `autoAnimate`            | app — `@formkit/auto-animate` (confirmed, `chunk-EAHQWTN3.js`, real production dependency) |
| 121.79 ms   | `(garbage collector)`    | native                                                                                     |
| 107.59 ms   | `setAttribute`           | native DOM API                                                                             |
| 78.73 ms    | `_updateContainerHeight` | app, `chunk-DQJ7NW3A.js`                                                                   |
| 77.45 ms    | `(anonymous)`            | app, `chunk-E67AT5XC.js`                                                                   |
| 74.25 ms    | `remove`                 | native DOM API                                                                             |
| 64.26 ms    | `setProperty`            | app, `chunk-E67AT5XC.js`                                                                   |
| 64.11 ms    | `insertBefore`           | native DOM API                                                                             |
| 61.98 ms    | `appendChild`            | native DOM API                                                                             |
| 43.70 ms    | `add`                    | native DOM API (classList/Set, ambiguous caller)                                           |
| 31.14 ms    | `parseFromString`        | native (likely DOMParser, used by markdown rendering)                                      |

### Reading this

- **Playwright's confirmed-unique injected-script functions do not appear at all** in this profile —
  the fix worked. The measurement window now genuinely excludes Playwright's own locator engine.
- **`getAnimations` (870.96 ms) sits right next to `autoAnimate` (161.04 ms) in self time, in the
  SAME profile, with `autoAnimate` confirmed as a real app-bundled function** (`chunk-EAHQWTN3.js`,
  `@formkit/auto-animate` is a listed production dependency in `package.json`). `@formkit/auto-animate`
  is a FLIP-animation library: internally it calls `Element.getAnimations()` on affected elements to
  check for animations already in flight before starting new ones — exactly the pattern that would
  produce a large `getAnimations` self-time figure sitting alongside `autoAnimate`'s own frame. This
  is genuinely app cost (an animation library reacting to ~190 turns' worth of DOM insertions per
  tile), not test-harness cost — but it is reported as "ambiguous" rather than asserted as fact,
  because the profiler cannot show the caller of a native-API call frame, only that it ran.
- **`(program)` at 31.5% and `other/unclassified` at 38.6%** are the two largest buckets and remain
  the least specific. `(program)` is V8's own bucket for time with no JS frame on the stack (parsing,
  compiling, GC-adjacent bookkeeping, and some native callback dispatch). `other/unclassified`
  contains real app-bundled functions that didn't match this classifier's keyword list (`setAttribute`,
  `_updateContainerHeight`, `setProperty`, native DOM mutation calls like `remove`/`insertBefore`/
  `appendChild` triggered by Angular's renderer or by `autoAnimate` itself) — this is genuinely mixed
  app cost, not harness noise, but the classifier cannot separate "Angular's own DOM writes" from
  "autoAnimate's DOM writes" from "other app code" at the granularity this profile offers.
- **Angular change detection (69.86 ms, 1.2%), markdown (17.21 ms, 0.3%), chat-streaming
  finalization (4.18 ms, 0.1%) and session-history-replayer (0.53 ms, ~0%) are all small** relative
  to the 5,625.80 ms sampled — consistent with Batch 19/20's own unit-level evidence that these
  specific mechanisms are already efficient for this fixture size. **They are NOT where the AC-11
  miss's cost lives.** The cost lives in `(program)`, `other/unclassified`, and the
  ambiguous-native-API bucket — i.e., in native DOM mutation/animation/style work triggered by
  inserting a large number of message bubbles quickly, not in the JS algorithms Batch 19/20 already
  optimized.

### PerformanceLongTaskTiming attribution

Every long-task entry across all revision-3 runs reports `attribution: [{ containerType: "window",
containerSrc: "", containerId: "", containerName: "" }]` and `name` is either `"self"` (the task's
culprit is the window's own script) or `"unknown"` (a handful of entries per run). This is the
expected, uninformative value for a same-frame, no-`<iframe>` page (this canvas has none) — Chromium
only enriches `attribution` for cross-frame or cross-origin culprits. It confirms there is no hidden
iframe/webview siphoning blame, but adds no further granularity beyond what the CDP profile already
provides.

## Production-build run (new harness)

Built WITHOUT any `project.json` change (`npx nx run ptah-electron:build-main` — `defaultConfiguration:
production` — then `npx nx run ptah-electron:copy-renderer` — resolves `ptah-extension-webview:build`'s
`defaultConfiguration: production`), then the Playwright test invoked directly, bypassing the `e2e`
Nx target's `build-dev`/`copy-renderer-dev` dependency chain:

```
cd apps/ptah-electron-e2e && PTAH_PERF_SPECS=1 npx playwright test --config=playwright.config.ts \
  src/specs/chat/tile-open-longtask-budget.perf.spec.ts --grep "cold:" --reporter=list
```

**Result (idle machine before and after, production-configured renderer, cold 3-tile, new harness)**:
wall 5,932 ms, 24 long tasks, **max 973 ms**, **total 4,657 ms**. Per-tile: before-first-click
3/72/180; TILE_0 2/71/124; TILE_1 1/52/52; TILE_2 18/973/4,301. Diagnostics:
`D:\projects\ptah-437-backup\ac11-perf-cold-3tile-1789494995984.json`.

**Verdict: still FAILS both budgets** (max 973 ms vs 200 ms, 4.9× over; total 4,657 ms vs 1,500 ms,
3.1× over). Sits at the low end of the 3 dev-build runs (max 1,493-1,864 ms, total 5,404-6,193 ms) —
consistent with a real, modest dev-mode tax, but production alone does not come close to closing the
gap. Same TILE_2-dominant shape as every dev run.

After this run, `dist/apps/ptah-electron` was restored to the dev-build state
(`npx nx run ptah-electron:build-main --configuration=development` +
`npx nx run ptah-electron:copy-renderer-dev`, both served from Nx's local cache).

## Revision 2: review fixes (kept for history — numbers superseded, see above)

From `b22-code-logic-review.md`:

- **Serious — dev-build measurement not disclosed.** Added disclosures + a production-build
  corroboration run (repeated and updated in revision 3 above).
- **Serious — no warm-up / no per-tile breakdown.** Added the two warm-up diagnostic tests and
  `bucketByClick` (both carried into revision 3, now with corrected — much lower — noise floor).
- **Moderate — mock resolver recompiled on every call.** Fixed in `ui-driver.ts`: memoized by source
  text (`__uiCompiledFns` cache). Re-verified in revision 3 not to affect other specs (see
  "Verification" below).
- **Moderate — fixture content is markup-free and short.** Still true in revision 3; not fixed
  (future work, out of scope).
- **Moderate — no long-task attribution.** Added `PTAH_PERF_PROFILE=1` + `summarizeCpuProfile`. This
  attribution mechanism is what SURFACED the need for revision 3's harness rewrite — the first
  profile it produced showed the harness dominating, which is exactly what it was built to catch.
- **Minor — run 2's data gap.** Fixed via `writeDiagnostics(...)` JSON files, confirmed working
  across every revision-3 run.

From `b22-code-style-review.md`:

- **Serious — convention undiscoverable.** Added the "Perf specs" subsection to
  `apps/ptah-electron-e2e/CLAUDE.md`.
- **Minor** items (comment prefix, console verbosity, `makeRand` duplication) — addressed or left
  as-is per the reviewer's own notes; unchanged by revision 3.

## What was created / changed

- CREATE `D:\projects\ptah-437\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`
  — 1,184 lines at revision 3; **923 lines at revision 4** after the `perf-diagnostics.ts` extraction.
- CREATE `D:\projects\ptah-437\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts` (revision 4) —
  323 lines. Holds `LongTaskAttribution`/`LongTaskEntry`/`TileBucket`/`bucketByClick` (per-tile
  long-task bucketing) and `CpuProfileNode`/`CpuProfile`/`CpuProfileSummary`/`classifyFrame`/
  `summarizeCpuProfile` (CDP profile classification) — all pure, `Page`-independent transforms,
  extracted verbatim (no behavior change) from the spec file per `b22-code-style-review-delta.md`.
  `LongTaskEntry`/`LongTaskAttribution` moved along with `bucketByClick` (not explicitly named in the
  delta review's line ranges, but `bucketByClick` and `installLongTaskObserver`/`collectLongTasks`
  both need the same type, so it has to live on one side of the spec/support boundary — moving it to
  `support/` alongside its only other consumer avoids a support-module-importing-from-a-spec
  dependency direction).
- MODIFY `D:\projects\ptah-437\apps\ptah-electron-e2e\src\support\ui-driver.ts` (resolver memoization,
  revision 2; one-line comment addition, revision 4 style minor) — 406 lines.
- MODIFY `D:\projects\ptah-437\apps\ptah-electron-e2e\CLAUDE.md` (Perf specs section, revision 2;
  `PTAH_PERF_PROFILE` mention added, revision 4 style minor).

## Disclosures (still apply in revision 3 unless noted)

1. **Development renderer build** for every run except the one production-build run — see
   "Production-build run" above for the smaller-but-still-failing production numbers.
2. **Fresh app, no warm-up**, for the "cold" scenario. The warm-up diagnostics (above) separate this
   out; the finding (3-tile miss is concurrency-driven, not cold-start-driven) is now CONFIRMED under
   the corrected harness, not just suggested.
3. **Mocked IPC + short, markup-free fixture text** — unchanged, still likely understates real cost.
4. **~6,000 total events, not 2,000** — unchanged; still the only reading `CanvasStore`'s dedup
   behavior makes possible.
5. **SUPERSEDED by revision 3.** Revision 2's disclosure #5 said Playwright's own instrumentation was
   the dominant cost and likely overstated the app's real cost. Revision 3 fixed that: the
   confirmed-unique Playwright share is now 0%. The remaining large buckets (`(program)`,
   `other/unclassified`, ambiguous native APIs) are a mix of genuine app cost (very likely dominated
   by `@formkit/auto-animate` reacting to large DOM insertions, plus native DOM mutation work) that
   this profiling method cannot fully separate at finer granularity — see "Attribution" above.
6. **The ~16 ms click cadence is a deliberate near-simultaneous stress case, not a model of typical
   user pacing.** `openTilesWithinPage` separates its 3 clicks by one `requestAnimationFrame` yield
   each (~16 ms apart) — see the spec's own header comment ("Click cadence is a deliberate stress
   case"). A real user's double/triple click on 3 different sidebar rows is realistically tens to
   hundreds of ms apart, so this is HARSHER than typical pacing, not gentler. AC-11's own wording
   ("open 3 tiles... at once") supports reading this as the near-simultaneous stress case the
   acceptance criterion actually describes — but a reader should not assume the ~16 ms gap models
   ordinary browsing behavior.

## Product bug found while building this harness (not fixed in this batch)

`AppStateManager.requestCanvasSession` (`libs/frontend/core/src/lib/services/app-state.service.ts:255,696-714`)
writes to a single-slot signal, `_canvasSessionRequest`, consumed by exactly ONE `effect()` in
`OrchestraCanvasComponent` (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:293-308`).
Angular effects run on the next change-detection flush, not synchronously per `.set()` call, so two
`.set()` calls issued before that flush runs leave only the SECOND value on the signal — the first is
overwritten with no trace.

**This was discovered directly, not inferred**: the first version of `openTilesWithinPage` fired all
3 native clicks in the same synchronous turn (no yield between them). That run opened exactly 1 tile
(the last one clicked) and timed out waiting for the other two — visible in that run's Playwright
page snapshot, which showed only `TILE_2`'s content rendered. The spec's harness worked around this
with an artificial `requestAnimationFrame` yield between clicks (see Disclosure #6 above) — a valid
test-harness accommodation, but it does nothing for the real application.

**Both real call sites are click-driven**: the sidebar's `onSessionClick`
(`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:564`) and the branch action
in `chat-view.component.ts:994`. A user who double- or triple-clicks 2-3 different sidebar session
rows in quick succession — a plausible interaction, especially on a slower machine where the effect
flush is delayed behind other work — can lose all but the last click's tile open with **no visible
error**: `requestCanvasSession`'s returned promise for the dropped request(s) does eventually resolve
`false`, but only after a 5-second safety timeout (`app-state.service.ts:704`, comment at 692-694),
and the sidebar's call site does not appear to await or surface that `false` to the user.

**This is out of scope for Batch 22 (test-only) and is NOT fixed in this batch.** Recommended
follow-up, to be tracked in `batches.md`/`context.md` rather than left only in this report and the
spec's code comment: queue `canvasSessionRequest`s instead of overwriting (process one per effect
run, re-trigger on completion), or debounce/serialize the sidebar's click handler so a second click
can't land before the first request is consumed.

## Execution

### Idle check before AND after every run (per this revision's instruction)

`powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`
— checked before starting each run and again immediately after it finished. Any run where either
check was non-zero was discarded and re-run once a clean before/after pair was obtained:

- One dev-build cold-3-tile attempt (post-fix-1-3, pre-`scan`-fix) checked idle (0) before starting
  but the app failed with `Test timeout of 60000ms exceeded while setting up "electronApp"` —
  discarded (this was the run that surfaced the click-ordering bug in fix #3 above, via its page
  snapshot showing only 1 of 3 tiles open).
- One dev-build cold-3-tile attempt (post-fix-3, pre-`scan`-fix) checked idle (0) before, but the
  POST-run check found 1 lingering process — discarded per the strict before-AND-after rule, even
  though the miss was small (its numbers, for the record, were an outlier max of 4,464 ms — likely
  itself inflated by the contamination, consistent with every other contaminated run in this task
  measuring worse than clean ones).
- Runs I, J, K (cold 3-tile ×3), the warm-1-tile run, the warm-3-tile run, run Q (CDP-profiled), and
  the production-build run all checked idle (0) both before and after, with no other command started
  during the run. These are the numbers used throughout this report.
- Two earlier idle-poll cycles (documented in revision 2, kept for context) found the machine busy
  with another session's `nx run-many -t test` jest-worker pool (from a
  `.claude-worktrees\task-440-memory-retention` worktree) and were waited out rather than run through.

### Skip proof (no `PTAH_PERF_SPECS`)

Re-run after all revision-3 code changes: `npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list`
(no env var) → Playwright reports **all 3 tests skipped**, target exits 0.

### Lint / typecheck

`npx nx run-many -t lint,typecheck -p ptah-electron-e2e` → 0 errors project-wide, 0 warnings from the
changed files. All 9 warnings in the run belong to pre-existing, untouched files.

### Degradation audit

`npx nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 303 unsuppressed site(s)`, matching
baseline exactly, run after all revision-3 changes.

### Formatting

`npx prettier --write` run on every changed file after each edit; final pass reports all files
"unchanged" (already conformant).

### `ui-driver.ts` memoization — confirmed not to affect other specs

Ran two other `mockRpc`-using specs on an idle machine after the revision-2 `ui-driver.ts` change:
`compaction-duplicate-session.spec.ts` and `task-370-concurrent-session-isolation.spec.ts` — both
**passed** (`2 passed`). Both use only static-object `mockRpc` registrations (no function-source
resolvers), so the memoization cache path they exercise is the "no-op, statics only" branch; the
per-source-text `Function` cache is additive (keyed by source text, `Map`, never cleared mid-test) and
does not change behavior for any caller that never registers a function-string resolver.

## Verdict

- **Criteria proven**: the spec exists, runs the real app, measures the real renderer with a real
  `PerformanceObserver('longtask')`, is gated behind `PTAH_PERF_SPECS=1` (re-confirmed to skip),
  writes per-run JSON evidence, separates cold-start from steady-state cost, and — as of revision 3 —
  excludes Playwright's own instrumentation from the measured window, confirmed by a before/after CDP
  profile comparison (≥38.9% Playwright share → 0%).
- **Criteria NOT proven — AC-11 is NOT met**, in dev build (3 clean runs) OR production build (1
  clean run), under the corrected, harness-noise-free measurement. The smallest miss (production
  build) was still 4.9× over the single-task budget and 3.1× over the total budget.
- **What revision 3 establishes that revisions 1-2 did not**:
  1. The miss is a **concurrency** problem, not a cold-start problem, now CONFIRMED rather than
     suggested: warm 1-tile fits comfortably inside budget (119 ms max / 433 ms total) under the
     clean harness; warm 3-tile does not (1,394 ms max / 7,587 ms total), and is not smaller than
     cold 3-tile.
  2. **TILE_2 (the 3rd tile clicked) alone accounts for 88-98% of every run's total blocked time and
     produces the budget-busting max task every time** — the 3 tiles' chunked replays queue up behind
     each other on the single renderer thread, so the LAST one pays for all the work already queued
     by the first two. This is the sharpest, most actionable finding in this report: a fix does not
     need to help "opening a tile" in general — it needs to help whichever tile ends up LAST when 3
     open close together.
  3. Removing Playwright's own instrumentation did NOT shrink the max single-task duration — if
     anything it grew slightly (1,084-1,221 ms → 1,201-1,864 ms), because the old harness's frequent
     polling was accidentally fragmenting one continuous piece of app work into several smaller
     `longtask` entries. **The single-task budget miss is real, not a measurement artifact — the old
     harness was, if anything, UNDERSTATING it.**
  4. Attribution at the mechanism level: `finalizeSessionHistory` (C16), `SessionHistoryReplayer`
     chunking, and Angular change detection are each under 2% of sampled CPU in the one profiled run
     — consistent with Batch 19/20 already having optimized those specific algorithms. The cost lives
     in native DOM mutation/animation work (very likely dominated by `@formkit/auto-animate` reacting
     to fast, large DOM insertions) and V8-native `(program)` time neither this classifier nor a
     function-name-based approach can fully resolve further.
- **This is evidence for Q6, not a decision on Q6.** What the evidence now supports, with much higher
  confidence than revision 2:
  - The miss is real, reproducible (3 dev runs + 1 production run, all clean, all agree), not
    explained by warm-up, and not a measurement artifact of the test harness — that last point is new
    in revision 3 and directly answers the coordinator's stated concern.
  - The miss is concentrated in whichever tile opens LAST when 3 open together, which argues for a
    fix that either (a) staggers/throttles concurrent tile opens, (b) reduces the per-tile cost so 3
    queued ones still fit budget, or (c) both — rather than a fix that only targets a single tile's
    cold-start path.
  - Given the attribution's signal toward native DOM/animation work rather than the JS-algorithm
    mechanisms Batch 19/20 already optimized, **render virtualization is a HYPOTHESIS worth testing,
    not a confirmed best candidate.** `b22-code-logic-review-delta.md` correctly flagged the original
    wording here ("highest-confidence candidate") as overstating what the evidence supports: the
    bucket it targets (`other/unclassified` at 38.6% plus the ambiguous native-API bucket at 15.7%,
    together ~54.3% of one profiled run's sampled time) is explicitly described two sections above as
    NOT separable further by this method — it mixes native DOM-mutation calls the classifier cannot
    attribute to Angular vs. `autoAnimate` vs. other app code, plus 31.5% more sitting in `(program)`
    with no JS frame at all. Folding a bucket the report itself calls unattributable into a
    confidence-ranked recommendation is exactly the failure mode the delta review named. What
    render virtualization's real ceiling is depends on how much of that ~54-86% (unclassified +
    ambiguous + `(program)`) is actually DOM-insertion-volume-driven versus something virtualization
    wouldn't touch (e.g. `(program)` time from V8 parsing/compiling the chunked-replay code itself,
    which scales with EVENT count, not DOM node count). **What would confirm or rule this out**: (a)
    replicate the CDP profile 2-3 more times to see whether the `other/unclassified`/ambiguous split
    is stable run to run (this report has only one profiled run); (b) a DevTools flame chart with
    source maps, manually reviewed, to attribute `other/unclassified`'s native DOM calls to their
    actual JS caller (Angular's renderer vs. `autoAnimate` vs. elsewhere) instead of inferring it from
    which library is also active in the same profile; (c) a spike that disables `@formkit/auto-animate`
    on the transcript list for one run and compares `(program)`/native-API/other-unclassified time
    before and after — if virtualization/animation-removal is the right lever, that comparison should
    show a large, direct drop in exactly those buckets. Tail-paged session history (Q6's
    originally-proposed fix) would reduce E per tile and could help indirectly (fewer DOM nodes
    inserted overall), but its DIRECT target — the replay/finalization JS cost — is not where this
    profile shows the time going (see below).
  - Fix-class sizing from this profile (order-of-magnitude, one profiled run, ranked by evidence
    strength, not by presumed effectiveness):
    - **Render virtualization / reviewing `@formkit/auto-animate`'s use on fast-growing lists**:
      plausible hypothesis targeting the largest unattributed+ambiguous chunk (native DOM mutation +
      `autoAnimate` reacting to it, roughly 25-45% of sampled time depending on how
      `other/unclassified` splits) — NOT yet a confirmed best candidate; see the confirmation steps
      above before committing engineering effort on the strength of this profile alone.
    - **Throttling/staggering concurrent tile opens**: directly targets the TILE_2-queueing pattern;
      would not reduce total work but would keep any single tile's blocked time under budget by
      avoiding 3-deep queueing on one thread.
    - **Tail-paged session history**: reduces E per tile; profile shows its most direct targets
      (finalization, chunked replay) are already cheap (<2% combined), so its main benefit would be
      indirect (fewer DOM nodes → less native/animation work), not a direct hit on a large measured
      bucket.
    - **Markdown/DOMPurify deferral**: measured only 17.21 ms here with short, markup-free fixture
      text (Disclosure #3) — this profile understates its real-world ceiling; not ruled out, just
      not evidenced by this fixture.
    - **`finalizeSessionHistory`/`SessionHistoryReplayer` further optimization**: profile shows these
      already cheap for this fixture size (combined <2%) — LOW priority relative to the above,
      contrary to what an uncorrected (revision 1/2) reading of "3-6× over budget" might have
      suggested.
- **Risks / caveats a reader should know about**:
  - This is a shared, multi-agent-session machine. Every run used in this report's numbers passed a
    before-AND-after idle check; 2 additional attempts were discarded for failing that bar (one
    outright app-launch timeout, one with a lingering process after a clean start) — see "Execution".
  - The CDP attribution (revision 3) is from ONE profiled run. The underlying finding (Playwright's
    confirmed-unique functions absent) is a clean binary result (present before the fix, absent
    after) rather than a percentage that needs replication to trust; the ambiguous-native-API split
    (15.7%) is a single data point and could vary run to run.
  - `other/unclassified` (38.6%) and `(program)` (31.5%) remain the two largest, least-specific
    buckets — genuinely mixed app cost that this profiling method cannot resolve further without
    either a more detailed classifier (risking false attribution) or a different tool (e.g. Chrome
    DevTools' own flame chart with source maps, manually reviewed).
  - Production-build corroboration is ONE run, for time-budget reasons; it agrees in direction and
    rough magnitude with the 3 dev-build runs.
  - The `requestAnimationFrame` yield between clicks (fix #3) adds ~16 ms × 2 = ~32 ms of harness
    scheduling overhead to the "wall" time reported per run — negligible next to the measured
    multi-second totals, and it is NOT counted as a `longtask` itself (a single rAF yield is well
    under the 50 ms long-task threshold).
