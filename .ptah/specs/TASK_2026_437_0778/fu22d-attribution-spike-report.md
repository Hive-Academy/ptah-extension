# FU-22d Attribution Spike — TASK_2026_437_0778 (report only, no product code committed)

Worktree `D:\projects\ptah-437`, branch `fix/task-437-main-loop-isolation`, HEAD `510848cf7`
throughout. All raw evidence under `D:\projects\ptah-437-backup\` (never in the repo):
`.cpuprofile`/diagnostics `.json` at the backup root (existing b22 convention), CDP traces and
patch diffs under `D:\projects\ptah-437-backup\fu22d\`.

## Headline finding

The b22 hypothesis ("@formkit/auto-animate is the highest-confidence candidate") is **only
partly right and now measured, not inferred**: disabling auto-animate entirely cuts the cold
3-tile max long task by ~33-39% and total blocked time by ~31-37% — real, but the run still
**fails AC-11 by 4.6-5.1x on max and 2.4-2.6x on total** even with auto-animate completely off.
A CDP `Tracing.*` capture (new in this spike; b22 only had a JS CPU profile) shows the two
largest attributable native buckets — `FireAnimationFrame` (~1.1-1.3 s, ~1,400+ firings) and the
Layout/Paint/GPU family (`UpdateLayoutTree`+`Layout`+`PrePaint`+`Paint`+`GPUTask`+`HitTest`+
`Layerize`, ~2.2 s) — **do not shrink when auto-animate is disabled** (within run-to-run noise).
Auto-animate's real, measured contribution is its own JS self-time (~160-190 ms/run) plus
downstream GC/compile pressure from running that code, not the large ambiguous native-API or
layout buckets the b22 report speculatively attributed to it. The render-volume experiment
(500/1,000/2,000 events/session) shows **total blocked time scales roughly linearly with event
count** (~2.9-3.1 ms/event, flat to mildly sublinear), consistent with DOM-insertion-volume being
the real driver of the largest buckets — not the JS algorithms Batch 19/20 already optimized
(each still <2% of sampled CPU here) and not, primarily, auto-animate.

**Best-supported fix class: reduce DOM-insertion volume per tile-open** (tail-paged history
and/or execution-node-level virtualization for the always-mounted tail), **combined with**
throttling/staggering concurrent tile opens (TILE_2 alone still carries 88-98% of blocked time
purely from queueing, confirmed again in every run this spike collected). Disabling/gating
auto-animate during a tile's initial bulk mount is a real, cheap, worthwhile secondary fix
(~30-35% recovery) but cannot close the gap alone.

## Method

Steps 1-4 exactly as scoped in the task. All commands run from `D:\projects\ptah-437\apps\
ptah-electron-e2e`, dev build (`npx nx run ptah-electron:copy-renderer-dev` when a renderer
patch needed re-bundling; spec-file-only patches need no rebuild — they run in the Playwright/
Node process, not the bundle). The existing `tile-open-longtask-budget.perf.spec.ts` /
`perf-diagnostics.ts` harness (Batch 22, revision 4) was reused unmodified except for the
temporary, reverted patches below — no new harness was built.

### Idle evidence (checked before AND after every run in this spike, per instruction)

`powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`

Every run used in this report's numbers returned `0` on both the before-check and the
after-check. No run was discarded this session (unlike b22, which discarded two contaminated
attempts) — the machine stayed idle for the whole spike. Checks were run immediately before and
after each of: the 2 replication runs, the 2 CDP-trace runs (baseline + auto-animate-off), the 2
auto-animate-disabled assertion runs, the 1 auto-animate-disabled CDP-profile run, the 500-event
run, and the 1,000-event run — 9 checked run-pairs total (18 checks), all `0`.

### Step 1 — Replication (category-share stability)

Two more `PTAH_PERF_PROFILE=1` cold-3-tile runs, compared against b22 revision 4's own "run Q"
(`test-report-b22.md` Attribution section) as the baseline:

| Run              | Grand total sampled | other/unclassified | `(program)` | ambiguous native API | no-source-url | GC   | Angular CD | markdown |
| ---------------- | ------------------- | ------------------ | ----------- | -------------------- | ------------- | ---- | ---------- | -------- |
| Q (b22 baseline) | 5,625.80 ms         | 38.6%              | 31.5%       | 15.7%                | 10.3%         | 2.2% | 1.2%       | 0.3%     |
| R1 (this spike)  | 5,859.39 ms         | 38.3%              | 32.8%       | 15.4%                | 9.4%          | 1.8% | 1.5%       | 0.4%     |
| R2 (this spike)  | 4,790.59 ms         | 39.0%              | 30.6%       | 15.2%                | 10.5%         | 2.4% | 1.7%       | 0.4%     |

**Stable within ~1-2 percentage points across 3 independent runs.** b22's single-profile caveat
("could vary run to run") is resolved for the category split — it doesn't vary meaningfully. This
does NOT resolve what `other/unclassified`/`(program)` individually attribute to (see Step 2).

Long-task numbers for R1/R2 (for context, not the headline number — see Step 3 for the clean
assertion-mode pair): R1 wall=4,892 ms, max=1,165 ms, total=6,292 ms, 18 long tasks; R2
wall=4,362 ms, max=988 ms, total=4,195 ms, 15 long tasks. Both inside/near the b22 revision-3
range (max 1,201-1,864 ms, total 5,404-6,193 ms), confirming this spike started from the same
baseline behaviour, not a drifted one.

### Step 2 — CDP `Tracing.*` attribution (new in this spike)

The existing harness only ever captured a CDP `Profiler` (JS CPU) profile, which cannot see
non-JS engine work (layout, paint, style recalc, GC bookkeeping) except as opaque `(program)`
time. This spike added a temporary, reverted patch to the spec (`Tracing.start` with categories
`devtools.timeline`, `disabled-by-default-devtools.timeline`, `blink.user_timing`, `v8.execute`,
`disabled-by-default-v8.compile`, `sampling-frequency=10000`) bracketing the exact same window as
the existing long-task/CPU-profile capture, summarizing every trace event's own `dur` by `name`.
Diff: `D:\projects\ptah-437-backup\fu22d\all-spec-patches.diff` (section adding `TRACE_ENABLED`
and the `Tracing.*` block); raw traces: `D:\projects\ptah-437-backup\fu22d\
ac11-trace-cold-3tile-*.json`. Reverted after use — see "Worktree state" below.

Baseline (auto-animate ON), cold 3-tile, wall=3,885 ms, max=1,085 ms, total=4,642 ms:

| Event name                                                  | Count | Total ms | Notes                                                                                                    |
| ----------------------------------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------- |
| `RunTask`                                                   | 6,953 | 8,842.57 | Scheduler wrapper; overlaps/nests other rows — not additively comparable to the window total             |
| `RunMicrotasks`                                             | 923   | 1,356.23 | Promise/microtask drain (chunked replay's `yieldToMacrotask`, Angular's own microtask queue)             |
| `FunctionCall`                                              | 3,729 | 1,338.68 | Generic native→JS call boundary marker                                                                   |
| **`FireAnimationFrame`**                                    | 1,421 | 1,110.89 | **See "FireAnimationFrame is not yet attributed" below**                                                 |
| `UpdateLayoutTree`                                          | 101   | 846.83   | Style recalc over the tree                                                                               |
| `GPUTask`                                                   | 217   | 682.31   | Compositor/GPU-process work driven by this window's DOM churn                                            |
| `Layout`                                                    | 57    | 345.02   | Reflow                                                                                                   |
| `V8.GC_MC_BACKGROUND_MARKING`                               | 47    | 338.33   | \} V8 GC + JIT-compile family — sums to ~1,598 ms, a large slice of the CPU profile's `(program)` bucket |
| `V8.TurbofanTask`/`V8.OptimizeBackground`                   | 226   | 555.19   | \}                                                                                                       |
| `V8.MaglevTask`/`Background`/`GraphBuilding`                | 2,659 | 471.11   | \}                                                                                                       |
| `TimerFire`                                                 | 524   | 189.26   |                                                                                                          |
| `PrePaint`                                                  | 186   | 175.99   |                                                                                                          |
| `V8.GC_SCAVENGER_BACKGROUND_SCAVENGE_PARALLEL`              | 47    | 151.25   |                                                                                                          |
| `Paint`                                                     | 706   | 114.56   |                                                                                                          |
| `HitTest` / `Layerize` / `MajorGC` / `V8.GC_MARK_COMPACTOR` | 20    | 179.63   |                                                                                                          |

**Layout/paint/GPU family total (`UpdateLayoutTree`+`GPUTask`+`Layout`+`PrePaint`+`Paint`+
`HitTest`+`Layerize`): ~2,253 ms — roughly 40-48% of the measured window.** This is real,
attributable, engine-level DOM/style/layout work, driven by inserting ~190 turns × 3 tiles of
content quickly — not opaque in the way the CPU profile's `(program)`/`other/unclassified`
buckets are.

### Step 3 — Controlled experiments (all diffs saved, all reverted, worktree confirmed clean)

#### 3a. `@formkit/auto-animate` disabled

Patch: `libs/frontend/chat/src/lib/directives/auto-animate.directive.ts`, `ensureController()`
made an unconditional no-op (`return;` before the existing body). Diff:
`D:\projects\ptah-437-backup\fu22d\experiment-3a-auto-animate-disable.diff`. Required a renderer
rebuild (`npx nx run ptah-electron:copy-renderer-dev`) since this is bundled app code, unlike the
spec-only patches.

| Scenario                            | Runs                          | Max            | Total            | vs baseline (mean of 3 revision-3 runs: max 1,520 ms, total 5,745 ms)      |
| ----------------------------------- | ----------------------------- | -------------- | ---------------- | -------------------------------------------------------------------------- |
| auto-animate disabled               | 2 clean                       | 928 / 1,015 ms | 3,632 / 3,973 ms | max **-33% to -39%**, total **-31% to -37%**                               |
| auto-animate disabled + CDP profile | 1 (profiler overhead present) | 1,449 ms       | 5,048 ms         | elevated by profiler overhead, attribution-only, not a clean assertion run |

**Still FAILS both budgets by a wide margin**: best case max 928 ms is 4.6x over the 200 ms
budget; best case total 3,632 ms is 2.4x over the 1,500 ms budget.

CPU-profile attribution with auto-animate off (from the profiled run above): `autoAnimate` itself
vanishes entirely from the top-15 self-time functions (was 161-188 ms in every auto-animate-ON
profile). But `getAnimations` — the function the b22 report attributed to auto-animate — **barely
moves**: 870.96/874.50/900.73 ms (3 auto-animate-ON profiles) vs 677.93 ms (auto-animate-OFF, one
profile) — a ~22-25% drop, not the ~100% drop you'd expect if auto-animate were its only caller.
`grep -rl "getAnimations" node_modules/@formkit/auto-animate` returns **no matches** — the
installed package's own source does not call `Element.getAnimations()` by that literal name in a
way grep finds (it may be minified/renamed in `index.min.js`, but a repo-wide grep for
`getAnimations` outside `node_modules` also finds zero application call sites). The remaining
~678 ms with auto-animate fully disabled is unexplained by any code this spike could find — most
likely Chromium-internal animation/transition-effect bookkeeping triggered by the sheer number of
elements carrying a CSS `transition-*` utility class (Tailwind's ambient transition classes are
pervasive in this codebase) newly inserted in one burst, but this spike did not confirm that
theory with a further experiment (see "What remains unknown").

The `Tracing.*` capture makes the same point more sharply: **`FireAnimationFrame` and the
Layout/Paint/GPU family are essentially unchanged with auto-animate off**:

| Category (auto-animate ON → OFF)      | ON               | OFF              | Δ                                                                         |
| ------------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------- |
| `FireAnimationFrame` (count/total ms) | 1,421 / 1,110.89 | 1,427 / 1,319.18 | **+0.4% count, +18.8% total (noise-level or slightly worse, not better)** |
| Layout/Paint/GPU family total         | ~2,253 ms        | ~2,224 ms        | **-1.3% (unchanged within noise)**                                        |
| `V8.*` GC+compile family total        | ~1,598 ms        | ~1,783 ms        | +11.6% (single-run noise, not a real regression signal)                   |

**This directly falsifies the "auto-animate causes `FireAnimationFrame`" reading of the b22
report**: with auto-animate's `ensureController()` never called, `FireAnimationFrame` count and
total did not drop — if anything they went up slightly (within the noise of a 1-run comparison).
Auto-animate's real, confirmed cost is its own JS self-time and the GC/compile pressure of
running that code — genuinely worth ~30-35% recovery — but it is not the source of the two
largest attributable native buckets.

#### 3b. Render-volume scaling (500 / 1,000 / 2,000 events/session)

Patch: spec-only `PTAH_PERF_EVENTS` env override of `TARGET_EVENTS_PER_SESSION` (no rebuild
needed — fixture generation runs in the Playwright/Node process). Diff included in
`D:\projects\ptah-437-backup\fu22d\all-spec-patches.diff`. **1 run per size** (time-budgeted, not
replicated 2x like the other experiments — flagged as the weakest-evidenced row in this report;
the 2,000-event row below is the mean of 3 already-replicated runs for comparison, not a 4th new
run at this size).

| Events/session                         | Max       | Total     | Total ÷ events (ms/event) |
| -------------------------------------- | --------- | --------- | ------------------------- |
| 500                                    | 457 ms    | 1,545 ms  | 3.09                      |
| 1,000                                  | 519 ms    | 3,078 ms  | 3.08                      |
| 2,000 (mean of 3, revision-3 baseline) | ~1,520 ms | ~5,745 ms | 2.87                      |

**Total scales roughly linearly with event count** (ms/event flat to mildly sublinear:
3.09 → 3.08 → 2.87) — consistent with an O(E) per-tile DOM/render cost, matching Batch 19/20's
own O(E+M) finalization claim, and consistent with the Layout/Paint/GPU family in Step 2 being
driven by insertion volume rather than a specific algorithm.

**Max does NOT scale linearly** — 500→1,000 events (2x) grew max by only 1.14x, but 1,000→2,000
events (2x) grew max by ~2.9x. This is a discontinuity, not a smooth curve, on a 1-run-per-size
sample. Two explanations this spike could not distinguish: (a) a genuine threshold effect (e.g. a
GC pause or a layout-thrashing point that only triggers past some DOM/heap size), or (b) an
artifact of how the browser coalesces adjacent long tasks into one bigger `longtask` entry once
task density crosses some threshold (the `PerformanceObserver('longtask')` API reports whatever
the browser decides is "one task" at the scheduler level — a genuinely more-fragmented burst at
1,000 events and a genuinely more-continuous one at 2,000 could produce this shape even if the
underlying total work were perfectly linear, which Step 3b's own total-time column suggests it
roughly is). **Worth replicating 2-3x per size before treating the max-side non-linearity as a
real threshold effect** — this report does not have enough runs to settle it.

Notably, the single 500-event total (1,545 ms) is _almost_ inside the 1,500 ms AC-11 total budget
on its own — a rough, single-run signal that a sufficiently aggressive per-tile event/DOM cap
(tail-paging) could get a single tile close to budget, though the max-task budget (200 ms) is
still missed at every size tested (457 ms even at 500 events) and the concurrency/queueing
problem (3c below, and b22's own TILE_2 finding) is a separate, additive problem tail-paging alone
would not fix.

#### 3c. Markdown stub — not run as a separate experiment (justified)

Markdown/DOMPurify/marked self-time was measured directly, not inferred, at 17.21 ms (b22 run Q),
24.5 ms (R1), 18.63 ms (R2) — 0.3-0.4% of sampled CPU across **three independent CDP profiles**,
the most repeatedly-confirmed single mechanism-level number in this whole investigation. A 4th
build-cycle experiment (stub markdown to plain text, rebuild, re-measure) was judged low marginal
value against its cost (a renderer rebuild + 2 clean runs) given how stable and small this number
already is. **This does not size markdown's real-world ceiling** — the fixture's `'ok'` tool
outputs and one-line deltas (`test-report-b22.md` disclosure #3, unchanged) are markup-free, so a
session with real fenced code blocks/long prose would cost more; this spike did not attempt to
quantify that gap.

#### 3d. Targeted experiment on a clear top cost — attempted, inconclusive within budget

`FireAnimationFrame` (~1.1-1.3 s, ~1,400+ firings/run) is the largest attributable native bucket
this spike found that experiment 3a's own evidence rules OUT as auto-animate. Two candidate rAF
call sites in the render path were read and evaluated:

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:73-80`
  (`scheduleFrame`) — a per-execution-node streaming render throttle. **Ruled out**: its
  `effect()` at `execution-node.component.ts:385-404` gates the rAF path behind
  `!this.isNodeStreaming()` (line 391) — for a resumed/finalized session (this fixture's entire
  content), every node takes the `publishNow(content)` branch (line 392), which renders
  synchronously with no rAF at all. This cannot be the source of 1,400+ `FireAnimationFrame`
  events in a cold-open-of-resumed-history scenario.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:534-548,
554-572` (`scheduleStickToBottom`/`restoreScrollOnActivation`) — each schedules at most 2 rAF
  callbacks per call (one to scroll, one nested to clear a flag), and is called at most a handful
  of times per tile-open (not per message/node). **Too few call sites to explain 1,400+ firings.**

No further candidate was identified and no experiment (e.g. disabling `requestAnimationFrame`
globally via `page.addInitScript` and observing what breaks, or re-running the render-volume
scaling experiment WITH `PTAH_PERF_TRACE=1` at 500 vs 2,000 events to see whether
`FireAnimationFrame`'s count scales with event count) was run for this — out of time budget for
this spike. **This is the single largest unresolved attribution gap in this report** — see "What
remains unknown."

### Step 4 — Is the message list rendered unvirtualized?

**No, at the top level — but yes, inside a mounted message.** `TranscriptRenderWindow`
(`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts`) is a
real, already-shipped `IntersectionObserver`-based virtualizer: `RENDER_WINDOW_MARGIN_PX = 2000`
(line 9), `ALWAYS_MOUNTED_TAIL = 6` (line 17), `isMounted(messageId)` (lines 141-146) returns
`true` only for ids currently intersecting the (2,000px-padded) viewport plus the trailing 6 +
any still-streaming ids (`syncMessages`, lines 118-134). It is wired into the template at
`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:15`
(`@if (renderWindow.isMounted(msg.id))`) and driven from
`chat-transcript.component.ts:485-497`. Canvas tiles reach this component through
`libs/frontend/canvas/src/lib/canvas-tile.component.ts` → `ChatViewComponent` →
`ChatTranscriptComponent` — the same virtualized path a real chat tab uses, confirmed by grep (no
separate, unvirtualized canvas-specific transcript renderer exists).

**But**, per `execution-node.component.ts:355-361`'s own doc comment (quoted verbatim): "The
directive installs a `MutationObserver` and measures `getBoundingClientRect()` for every child on
every mutation — a forced synchronous layout per streamed chunk... Disabling it while chunks
arrive (and through the finalize burst, where the whole tree re-lays out at once) keeps the FLIP
animation for the case it was added for." This confirms that **inside one mounted top-level
message**, the recursive execution-node tree (tool calls, nested agent turns) is NOT
virtualized — every child of a mounted message renders and gets measured. Because
`ALWAYS_MOUNTED_TAIL = 6` unconditionally mounts the last 6 messages regardless of scroll
position or viewport, and this fixture's ~150-190 turns/session are spread across many
message-level entries each carrying its own execution-node tree, **the always-mounted tail's
un-virtualized internal trees are a structurally plausible reason total cost still scales with
event count even though top-level message virtualization exists.** This spike did not directly
measure how many DOM nodes the always-mounted tail contains at 2,000 events vs 500 — a concrete,
cheap follow-up (`document.querySelectorAll('[data-testid="canvas-tile"] *').length` before/after
open, at each fixture size) that would directly test this theory.

## Ranked fix classes, with estimated recovery and confidence

| Rank | Fix class                                                                                                                                                                                                | What it targets                                                                                                                                                                                                                      | Estimated recovery                                                                                                                                                                                                                                                                                                                      | Confidence                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Reduce DOM-insertion volume per tile-open** (tail-paged history and/or execution-node-level virtualization for the always-mounted tail)                                                                | Layout/Paint/GPU family (~2.2 s, ~40-48% of window) + likely a share of `(program)`/`other/unclassified`; directly targets the ~linear-with-events scaling found in 3b                                                               | Order-of-magnitude: 500-event total (1,545 ms) is near the 1,500 ms budget on its own; a 4-8x per-tile event/DOM cut (matching Batch 20's own 250-event chunk size) is plausible for a SINGLE tile, but max-task budget (200 ms) still misses even at 500 events (457 ms) — this fix class alone likely does not close the max-task gap | MEDIUM-HIGH — grounded in a real (if 1-run) scaling curve and a real (if partial) virtualization gap found in code, not inferred from an ambiguous CPU bucket |
| 2    | **Throttle/stagger concurrent tile opens**                                                                                                                                                               | The TILE_2-queueing pattern — confirmed again in every run this spike collected (TILE_2 still carries the overwhelming majority of blocked time; e.g. 500-event run: TILE_2 1,220/1,545 ms = 79%; 1,000-event: 2,759/3,078 ms = 90%) | Does not reduce total work, but bounds any single tile's blocked time — directly targets the max-task budget, which fix class #1 alone does not close                                                                                                                                                                                   | HIGH — this pattern has now been confirmed in b22 (3 runs) AND every experiment in this spike (auto-animate-off, 500-event, 1,000-event) without exception    |
| 3    | **Gate `@formkit/auto-animate` off during a tile's initial bulk mount** (extend the existing `[autoAnimateDisabled]` input already used for streaming/finalizing, `execution-node.component.ts:362-364`) | Auto-animate's own JS self-time + downstream GC/compile pressure — NOT the large native/layout buckets                                                                                                                               | Measured directly: **-33% to -39% max, -31% to -37% total** — real, but insufficient alone (still fails by 4.6-5.1x/2.4-2.6x)                                                                                                                                                                                                           | HIGH — this is the one fix class with a full before/after measurement (2 clean runs each side) in this spike, not an inference                                |
| 4    | **Investigate `FireAnimationFrame`'s true source** (not a fix class itself — a prerequisite for sizing whatever fix would target it)                                                                     | ~1.1-1.3 s, ~19-28% of window, confirmed NOT auto-animate, NOT execution-node's streaming throttle, NOT chat-transcript's scroll-stick rAF                                                                                           | Unknown until the source is found                                                                                                                                                                                                                                                                                                       | LOW — genuinely unresolved by this spike; see "What remains unknown"                                                                                          |
| 5    | Markdown/DOMPurify deferral                                                                                                                                                                              | 0.3-0.4% share, 3 stable direct measurements, short markup-free fixture text understates real cost                                                                                                                                   | Not evidenced here either way for real content                                                                                                                                                                                                                                                                                          | LOW priority for THIS fixture; unknown for real content                                                                                                       |
| 6    | `finalizeSessionHistory`/`SessionHistoryReplayer` further optimization                                                                                                                                   | Already <2% combined across every profile in b22 and this spike                                                                                                                                                                      | Minimal — Batch 19/20 already optimized this                                                                                                                                                                                                                                                                                            | LOW — repeatedly confirmed cheap, not where the miss lives                                                                                                    |

## What remains unknown

1. **`FireAnimationFrame`'s true caller.** Ruled out: auto-animate (3a), execution-node's
   streaming-only render throttle (code-read), chat-transcript's scroll-stick rAF (code-read, too
   few call sites). Not yet tried: a repo-wide search restricted to `dist/apps/ptah-electron/
renderer/*.js` (the bundled, minified output) for `requestAnimationFrame(` call sites, cross-
   referenced against source maps; or re-running the `PTAH_PERF_TRACE=1` capture at 500 vs 2,000
   events to see whether `FireAnimationFrame`'s count scales with event count (would implicate a
   per-node/per-mutation caller) or stays flat (would implicate something unrelated to render
   volume, e.g. a compositor/Electron-internal tick).
2. **Whether `getAnimations`'s residual ~678 ms (auto-animate fully disabled) is Chromium-internal
   CSS-transition bookkeeping or an unfound app call site.** The `grep -rl` check against
   `node_modules/@formkit/auto-animate` found no literal match, and a repo-wide grep outside
   `node_modules` found zero application call sites — but `index.min.js` is minified and this
   spike did not de-minify it or set a JS breakpoint on `Element.prototype.getAnimations` to
   confirm the caller directly.
3. **How many DOM nodes the always-mounted tail (`ALWAYS_MOUNTED_TAIL = 6`) actually contains** at
   2,000 vs 500 events — the theory in "Step 4" (un-virtualized execution-node trees inside the
   tail explain the linear-with-events scaling) was not directly measured; a
   `document.querySelectorAll(...).length` count before/after open, at each fixture size, would
   confirm or refute it cheaply.
4. **The max-task non-linearity in 3b (500→1,000→2,000 events)** is a 1-run-per-size sample; not
   replicated, so the threshold-vs-artifact question is open (see 3b's own discussion).
5. **This spike used the same dev build, mocked-IPC, short-markup-free-fixture, ~16 ms rAF-spaced
   click cadence as b22** — all of b22's own disclosures (revision 4, "Disclosures" section) still
   apply unchanged here; this spike did not re-verify any of them independently.

## Worktree state — confirmed back to start

- Every product-code patch (auto-animate directive no-op) and every spec-file patch (CDP
  `Tracing.*` capture, `PTAH_PERF_EVENTS` override) was reverted by restoring the pre-patch backup
  copy (`D:\projects\ptah-437-backup\fu22d\*.orig`) and diffed against the restored file to
  confirm byte-for-byte equality (empty diff both times — see the two "IDENTICAL" confirmations in
  this session's command history).
- The renderer bundle was rebuilt after the auto-animate revert
  (`npx nx run ptah-electron:copy-renderer-dev`); Nx reported 4/4 tasks served from cache,
  confirming the rebuilt output is bit-for-bit the same as a previously cached (pre-patch) build,
  not merely visually similar.
- `git status --short` in `D:\projects\ptah-437` at the end of this spike: **empty** (no tracked
  file differs from HEAD `510848cf7`), matching the start state exactly, except for this new,
  untracked report file (`fu22d-attribution-spike-report.md`) and the pre-existing untracked
  `D:\projects\ptah-437-backup\` evidence directory (outside the repo).
- No `git add`/`stash`/`checkout` of committed files was used at any point; no commit was made; no
  `nx reset` was run; `node_modules` (the junction to `D:\projects\ptah-extension\node_modules`,
  per `handoff.md` section 1) was never touched.
- AC-11 remains **NOT MET**; this report does not change that verdict. It narrows and re-orders
  the fix-class ranking b22 revision 4 already flagged as needing more evidence
  (`b22-code-logic-review-delta.md`'s "Serious issue" on overstated confidence) with direct,
  reproduced, before/after measurements rather than a single ambiguous CPU-profile bucket.
