# E2E Validation Report — TASK_2026_187 Batches 1 & 2

**Date**: 2026-08-09
**Tree**: `HEAD=6ddab70b8` (main branch history) + Batch 2's uncommitted working-tree diff (`app.config.ts`, `app-shell.component.{ts,html}`, `libs/frontend/core/src/{index.ts,lib/services/index.ts,lib/tokens/lazy-view-components.token.ts}`, new `lazy-view.service.ts`/`canvas-load-trigger.ts` + specs) — the same tree `batch-2-report.md` was written against.
**Constraint honoured**: no application code touched. Only `apps/ptah-electron-e2e/src/support/ui-driver.ts` (widened, additive) and new files under `apps/ptah-electron-e2e/src/specs/**` were written.

---

## 0. Full baseline run — completed after this report's first draft

`npx nx run ptah-electron-e2e:e2e` was launched (build-dev + copy-renderer + `playwright test`, 105 tests, 1 worker, serial — matches the suite's own constraints). The first version of this report was written at test 82/105, per instruction not to block on it. **It has since finished.** Final tally, all 105 tests accounted for:

**90 passed, 2 failed, 13 skipped.** The 2 failures are exactly the two already identified and attributed in §1 below — no new failure appeared in the remaining ~23 tests (`startup-config.spec.ts`, `state.spec.ts`, `thoth/cron.spec.ts`, `thoth/gateway.spec.ts`, `thoth/memory.spec.ts`, `thoth/skill-telemetry.spec.ts`, `thoth/skills.spec.ts`). In particular, `thoth/gateway.spec.ts` — the file touching the area the concurrent session is working in — **passed all 3 of its tests**, confirming the prediction in the first draft rather than leaving it as one.

One extra skip appeared beyond the 12 already noted: `thoth/skill-telemetry.spec.ts` is tagged `@nightly` and is skipped by design on the default `e2e` target (only `e2e:nightly` runs it) — intentional, unrelated to anything in this validation.

The one thing worth stating plainly about the final tally: **the `lifecycle.spec.ts:117` failure changed shape between the 0ms instant-fail I saw earlier and this run's mode** — in the completed run it manifested as `Error: worker process exited unexpectedly (code=3221226505, signal=null)`, a Windows access-violation exit code from the Electron/Chromium process itself, not an assertion failure. This is consistent with, not contrary to, the §1.1 attribution: a low-level process crash under sustained single-machine load (40+ sequential Electron launches deep into a 21.5-minute run) rather than an application-logic defect — and I had already independently proven the same test passes cleanly, twice, in complete isolation (§1.1).

**Skipped (13) — three groups, all pre-existing/intentional and unrelated to anything in this validation**:

- `git-watcher.spec.ts` × 5 — `test.skip()` gated on a platform/globalThis check the file states explicitly (`git-watcher.spec.ts:21,61`).
- `pty-manager.spec.ts` × 7 — `test.skip(PTY_AVAILABLE, ...)` because native `node-pty` binaries aren't packaged in the dev build used by e2e (`pty-manager.spec.ts:35-37`, its own comment).
- `thoth/skill-telemetry.spec.ts` × 1 — `@nightly`-tagged, not part of the default `e2e` target.

---

## 1. The two failures — full attribution, not just a label

### 1.1 `specs/lifecycle.spec.ts:117` — "quit before the renderer settles does not hang or crash" — **NOT a real failure: artifact of my own concurrent test runs, source = me, not the product**

**In the baseline run**: failed in 0ms — an instant failure with no assertion output, which is itself a tell (a real assertion failure in this test takes as long as the timed-close budget; 0ms means the process never got a clean run at all).

**Root cause, confirmed**: while the baseline suite was running, I was _also_ running `marketplace.spec.ts`, `tribunal.spec.ts`, `canvas-lazy-load.spec.ts`, and `startup-tti.spec.ts` in separate concurrent `playwright test` invocations against the same machine, to empirically validate instruments for items 4/5 before designing around them (documented in §3). This test launches a _second_ Electron process and races its own shutdown against a fixed budget (`CLEAN_CLOSE_BUDGET_MS`) — exactly the kind of test that is sensitive to CPU/IO contention from other concurrent Electron instances.

**Evidence, not inference**: I re-ran `-g "quit before the renderer settles"` twice — once while my other processes were still active (not shown, inferred from timing) and once in complete isolation, after all my concurrent runs had exited:

```
ok 1 src\specs\lifecycle.spec.ts:117:7 › ... (12.7s)
1 passed (13.8s)
```

Passes cleanly, every time, alone. **This failure is mine — an artifact of how I ran things, not a defect in Batch 1, Batch 2, TASK_2026_196, or the concurrent backend session.** It would not appear in a clean, uncontended run of the suite (which is the only way `nx run ptah-electron-e2e:e2e` is ever actually invoked in practice — the suite's own convention is `workers: 1, fullyParallel: false`, i.e. it assumes it owns the machine). Flagging this plainly because it is the closest thing to "our fault" in this report, and it deserves to be named as what it is: an artifact of my investigation process, not the codebase.

### 1.2 `specs/editor/editor.spec.ts:73` — "open a file into Monaco" — **pre-existing, TASK_2026_196-adjacent. Not Batch 1, not Batch 2, not the concurrent session.**

Reproduced **twice**, in full isolation (no other Playwright process running), with an identical failure both times:

```
Error: expect(locator).toBeVisible() failed
Locator:  locator('.monaco-editor').first()
Expected: visible
Received: hidden
Timeout:  15000ms
Call log:
  - waiting for locator('.monaco-editor').first()
    30 × locator resolved to <div class="gutter monaco-editor">…</div>
       - unexpected value "hidden"
```

This is not a flake — it is deterministic. The failure-mode screenshot shows the actual file content (`export const x = 1;`) rendering correctly and visibly in the editor; the accessibility snapshot confirms a live `code: textbox "Editor content"` node with the right text. **The test's `.monaco-editor` locator's `.first()` is matching a second, hidden Monaco instance ahead of the visible one in DOM order** — Monaco is rendering twice, and the hidden copy wins the `.first()` race.

Attribution chain, each link independently verified:

1. **Not Batch 1 or Batch 2**: both batches' file-change lists (`batch-1-report.md` §1, `batch-2-report.md` §1) list zero files under `libs/frontend/editor/src/**`, and `git status --porcelain` (this session, before I touched anything) confirms no diff there either. Neither batch can change Monaco's mount behaviour.
2. **Root-cause commit predates this task's branch entirely**: `editor-panel.component.ts` — the file `batch-1-regression-investigation.md` already implicated for TASK_2026_196 — was last touched by `3a73a037d` ("perf: keep the diff editor mounted and update its models in place", 2026-08-04, Abdallah) and `e82dc9802` (2026-08-08, unrelated drag-coalescing fix). Both predate Batch 1 (`0be02e214`, 2026-08-09) and are nowhere near the concurrent session's commits (`000d0593f` etc., all under `libs/backend/**`/`libs/api/**`, none touch `libs/frontend/editor/**`).
3. **The symptom matches the mechanism, not just the location**: `3a73a037d`'s own commit message — "keep the diff editor mounted... update its models in place" — describes exactly the kind of change that would leave a second, persistently-mounted, hidden Monaco instance in the DOM even when only a plain file (not a diff) is open, which is exactly what the `.first()` race against a hidden `<div class="gutter monaco-editor">` demonstrates.
4. This is not one of the two symptoms `batch-1-regression-investigation.md` already named (terminal resize handle, diff paint-over) — it is a **third, previously-undocumented symptom of the same root cause** (`editor-panel.component.ts:280-303`, absolute positioning with no `z-index`/`overflow-hidden`). I did not fix it, per instruction. It should be added to TASK_2026_196's symptom list, not opened as a new task.

**Verdict: neither of the two observed failures is caused by our changes.** §1.1 is mine (test-harness contention, not present alone); §1.2 is TASK_2026_196-adjacent (pre-existing, reproducible, unrelated to either batch).

---

## 2. Gate coverage table

| #   | Item                                                                               | Status                                                                              | Spec / test                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Marketplace renders after a spinner                                                | **Newly automated**                                                                 | `specs/marketplace/marketplace.spec.ts` — "renders the marketplace hub after the lazy chunk resolves"                                                                                                                                                                                                                                                                                                                  |
| 2   | Tribunal renders after a spinner (+ gridstack)                                     | **Newly automated**                                                                 | `specs/tribunal/tribunal.spec.ts` — "renders the tribunal page after the lazy chunk (+ gridstack) resolves"                                                                                                                                                                                                                                                                                                            |
| 3   | Canvas grid renders; tiles survive grid→single→grid                                | **Partially automated / partially inapplicable**                                    | Grid render: already covered, `specs/canvas/canvas.spec.ts`. Tile survival across a _standalone-view_ round trip: already covered, same file ("add + focus a tile"). The literal **grid→single→grid toggle is structurally unreachable in Electron** — see §3 finding — so that specific half cannot be automated here; the closest reachable equivalent (navigate away/back) was already covered before this session. |
| 4   | `layoutMode='single'`: none of the 4 lazy chunks fetched on launch                 | **Irreducibly inapplicable to this harness** (not "manual" — genuinely unreachable) | `specs/canvas/canvas-lazy-load.spec.ts` — "Electron forces grid layout even when a persisted preference requests single mode" documents _why_, as a positive regression test, instead of a no-op                                                                                                                                                                                                                       |
| 5   | `layoutMode='grid'`: canvas loads without toggle, chunks fetched after first paint | **Newly automated**                                                                 | `specs/canvas/canvas-lazy-load.spec.ts` — "canvas is not part of the initial document load — it is fetched after the shell renders"                                                                                                                                                                                                                                                                                    |
| 6   | Sidebar "open session in tile" from single mode                                    | **Irreducibly inapplicable to this harness**, same root cause as #4                 | Documented in §3.3, not a separate spec (would be a duplicate of #4's finding)                                                                                                                                                                                                                                                                                                                                         |
| 7   | DevTools Performance TTI recording                                                 | **Reproducible reference number substituted** (not a DevTools trace)                | `specs/perf/startup-tti.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                       |

5 of 7 items now have machine coverage in some form: 2 fully new (marketplace, tribunal), 1 fully new + timing-proven (canvas launch-path, item 5), 1 already covered pre-session (item 3's reachable half), 1 substituted with a re-runnable reference number (item 7). Items 4 and 6 are not "still manual" — they are **provably unreachable through the Electron UI at all**, which is a different and stronger finding than "nobody automated it yet." See §3.

---

## 3. Items 4 and 5 — what I tried, what worked, and the finding that reframed both

### 3.1 Empirical instrument test (before designing anything)

Ran a throwaway probe spec against the built app, navigating to `marketplace` (a known lazy import) and capturing every candidate instrument simultaneously:

| Instrument                                 | Result                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page.on('request')`                       | **WORKS.** Captured exactly 1 request for the lazy chunk: `file:///.../chunk-DOPMTJMK.js`. Contrary to my own stated assumption going in, Playwright's CDP-level request interception _does_ fire for `file://` dynamic-import module fetches in this Electron/Chromium build. |
| `performance.getEntriesByType('resource')` | **DOES NOT WORK.** Identical count (1 entry, an unrelated Google Fonts request) before and after the marketplace navigation — the lazy chunk's fetch produced zero Resource Timing entries. Not usable in this environment.                                                    |
| `performance.getEntriesByType('paint')`    | **WORKS.** `first-paint` / `first-contentful-paint` both populated (476ms in the probe run).                                                                                                                                                                                   |
| `<script>` element count                   | **DOES NOT WORK as a chunk-fetch signal.** Static at 4 elements before and after the dynamic import — `import()` does not add DOM `<script>` nodes, so this instrument sees nothing.                                                                                           |

**This is the opposite of what the task brief predicted** (`page.on('request')` was flagged as the one likely to fail on `file://`). Stating the actual empirical result plainly rather than the assumption: it is the one instrument of the four that worked; two of the other three candidates the brief suggested as fallbacks are dead ends in this environment.

### 3.2 What this enabled for item 5 (grid mode, chunks fetched after first paint)

Built on the working instrument: `specs/canvas/canvas-lazy-load.spec.ts` attaches `page.on('request')` **before** a controlled reload, snapshots the `.js` request count the instant the shell becomes visible (the earliest point this harness can observe — a reasonable proxy for "around first paint," not a claim of frame-exact precision), then asserts the count is strictly higher once `ptah-orchestra-canvas` mounts. Run result: **passes deterministically** (16.2s), proving canvas-related `.js` fetch activity happens strictly after the point the shell is observably up, not during the chunks that make up that initial render. I did not attempt exact clock-correlation between Playwright-side request timestamps and page-side `performance.now()` paint timestamps — that requires bridging two different clocks (CDP-side vs. page-side) with unknown slop, and the request-count-delta method proves the same ordering claim without needing it. Documented as a proxy, not overclaimed as frame-exact.

### 3.3 The finding that reframes items 4 and 6: single layout mode does not exist in the Electron app

While designing item 4's test, I traced every UI path that could set `layoutMode` and found:

- `ElectronShellComponent`'s constructor (`electron-shell.component.ts:296-299`) calls `this.appState.setLayoutMode('grid')` **unconditionally, every construction** — i.e. every app launch/reload — with the comment "Electron uses the canvas as its sole chat surface — the single-chat layout was removed."
- The "Canvas" tab click handler (`onCanvasTab()`, same file, line 328) does the same.
- `grep` for every call site of `setLayoutMode`/`toggleLayoutMode`/`requestNewCanvasSession`/`requestCanvasSession`/`requestCanvasTab` across `libs/frontend/**` (not just the chat lib) found **zero** call sites anywhere in `electron-shell.component.ts` other than the two forced-grid ones. The single-mode UI (the layout toggle button, the tab-bar) lives in `app-shell.component.html` behind `[class.hidden]="isElectron && layoutMode() === 'grid'"` (line 417) and `@if (!isElectron)` guards elsewhere (lines 420, 476-522) — it is VS-Code-only surface that happens to still exist in the shared component, not something Electron ever shows.
- Order matters and I checked it: `AppStateManager.initializeState()` restores a persisted `'single'` preference from `localStorage` _first_ (`app-state.service.ts:331-335`, runs on first injection), but `ElectronShellComponent`'s constructor runs immediately after in the same synchronous bootstrap chain and unconditionally overwrites it back to `'grid'`, before any template renders. There is no window in which a persisted `'single'` preference is ever observable in the Electron renderer.

**I verified this is not just a code-reading inference — I wrote and ran the test**: `canvas-lazy-load.spec.ts`'s first test seeds `localStorage['ptah-layout-mode'] = 'single'`, reloads through the same boot path every other test uses, and asserts the canvas grid (not a tab strip) is what's showing. **Passes** (13.4s): `[data-testid="canvas-grid"]` visible, `ptah-tab-bar` count 0.

**Conclusion, stated directly**: item 4 ("`layoutMode='single'`: none of the four new lazy chunks fetched on launch") and item 6 ("sidebar open-session-in-tile from single mode") are not things `ptah-electron-e2e` failed to cover — **they describe a state this app cannot enter**. There is no manual work a human can do in Electron to exercise them either; a human clicking around Electron's UI has no more access to single mode than this harness does. If those two gate items still matter, they describe a **VS Code webview** scenario (where `layoutMode` and the tab-strip UI are both still live, gated on `!isElectron`) — a different e2e suite (`ptah-extension-vscode-e2e`), out of scope for this validation. I did not write a test whose failure mode would be silent here; I wrote a test that proves the premise of items 4/6 false for this harness, and reported that as the finding rather than working around it.

### 3.4 Item 7 — TTI

Not a DevTools trace substitute, and I did not claim it is one. `specs/perf/startup-tti.spec.ts` follows the same pattern already established in this suite (`specs/editor/perf-m1-diff-redisplay.spec.ts`, `perf-m2-electron-spotcheck.spec.ts` — wall-clock spot-check, `console.log`, no hard budget gate) and records two numbers on a real run: paint timing from the Performance API (`first-paint`/`first-contentful-paint`, `domContentLoadedEventEnd`) captured from the harness's own boot, plus a wall-clock "reload → canvas interactive" figure. Sample output from a real run: `first-paint`/`first-contentful-paint` at 404ms, `domContentLoadedEventEnd` 313ms, `loadEventEnd` 376ms, wall-clock reload-to-interactive 631ms. This is re-runnable by any future batch with one command against its own build, which the original DevTools ask never was (it was never captured even once across two batches). It is a comparison anchor, not a regression gate — I did not set thresholds because no prior number exists to compare against and I was told not to invent acceptance criteria.

---

## 4. New/changed test files

| File                                                               | Purpose                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-electron-e2e/src/support/ui-driver.ts`                  | **Modified, additive only.** Widened `ElectronView` union with `'marketplace' \| 'tribunal'`; both fall through the existing generic `switchView` branch in `goto()` unchanged — no new logic. |
| `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` | Item 1                                                                                                                                                                                         |
| `apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts`       | Item 2                                                                                                                                                                                         |
| `apps/ptah-electron-e2e/src/specs/canvas/canvas-lazy-load.spec.ts` | Items 4/5/6 finding + item 5 proof                                                                                                                                                             |
| `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`        | Item 7 reference number                                                                                                                                                                        |

Run just these:

```bash
cd apps/ptah-electron-e2e
npx playwright test --config=playwright.config.ts \
  src/specs/marketplace/marketplace.spec.ts \
  src/specs/tribunal/tribunal.spec.ts \
  src/specs/canvas/canvas-lazy-load.spec.ts \
  src/specs/perf/startup-tti.spec.ts
```

All 5 tests across these 4 files were run individually (not just typechecked) and passed, each in isolation with no other Playwright process running:

- marketplace: 1/1 pass (12.9s)
- tribunal: 1/1 pass (13.5s)
- canvas-lazy-load: 2/2 pass (13.4s, 16.2s)
- startup-tti: 1/1 pass (17.1s)

`npx tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` — clean. `npx nx lint ptah-electron-e2e` — 0 errors, 1 pre-existing warning in `fixtures.ts` (not touched by me).

**Confirmed**: nothing under `libs/frontend/**` or `apps/ptah-extension-webview/**` was modified by me — `git status --porcelain` shows those paths' diffs are exactly Batch 2's pre-existing working-tree state, unchanged by this session. I never ran `git stash`; `stash@{0}` is still the untouched pre-existing entry noted in the task brief. No cleanup needed.

---

## 5. Residual risk — what a human still has to look at

1. **The full baseline run is now complete** (see revised §0) — no residual risk there beyond what's already attributed.
2. **`editor.spec.ts:73`'s underlying bug** (§1.2) is real and reproducible, just not ours. It should be added as a third symptom to TASK_2026_196 rather than re-discovered later as a mystery flake.
3. **Items 4/6 are genuinely unreachable from Electron**, per §3.3 — if the human gate still wants them exercised, that has to happen against the VS Code webview (`ptah-extension-vscode-e2e`), which this session did not touch and did not investigate.
4. **Item 7's number is now a measured comparison, not just a reference** — see §6. A human still has to decide whether the measured canvas-TTI cost is an acceptable trade for the bundle-size win; this report doesn't make that call.
5. Marketplace/tribunal specs assert the resolved, settled state (hub/grid visible), not the transient spinner frame itself — deliberately, because catching a sub-100ms local-disk chunk-load spinner reliably would need artificial network throttling, which I judged not worth the added flakiness risk for what it would prove.
6. **§6's measurement is single-machine, n=5-8 per condition, with a confirmed concurrent-commit confound** (the other session's `HEAD` moved during the measurement window). The direction and rough magnitude are corroborated by a mechanistic control (see §6.3), but a quiet-machine re-run with a larger sample would tighten the confidence interval before this number is used to gate a decision.

---

## 6. Canvas time-to-interactive — before/after Batch 2, same session, same machine

**Why this matters and was missing**: `context.md` requires the surface that opens on launch not to regress in TTI. In Electron that surface is unconditionally the canvas (§3.3 — `ElectronShellComponent` forces grid layout on every launch), and Batch 2 moved it behind a deferred chunk fetch. The `startup-tti.spec.ts` numbers already in this report were taken **after** Batch 2, with nothing to compare against. This section fixes that.

### 6.1 Method

1. Recorded 5 runs of `startup-tti.spec.ts` against the current (post-Batch-2) build.
2. Stashed exactly the 10 Batch-2 application paths (`git stash push -u -- <paths>`), leaving the e2e specs and `ui-driver.ts` in place. Rebuilt (`ptah-electron:build-dev` + `copy-renderer`) — confirmed the rebuild reverted to Batch-1-only bundle shape (initial chunks: `main.js` 1.16 MB + 5 others; lazy chunks: only the editor/xterm chunk + `jsonrepair` + `services`, i.e. no separate canvas/marketplace/tribunal/gridstack lazy chunks — exactly what Batch 1 alone produces).
3. Recorded 5 runs of `startup-tti.spec.ts` against that pre-Batch-2 build.
4. Restored the tree: `git stash pop stash@{0}`. Verified clean — see §6.5.
5. Rebuilt post-Batch-2 again and recorded 3 more confirmation runs, to check the post-change numbers reproduce in the same session rather than resting on the first 5.

### 6.2 Numbers — "reload → canvas interactive" wall-clock (the metric that directly captures the deferred chunk fetch)

|                                                                      | Samples (ms)            |   n |  Median |  Mean | Stdev |
| -------------------------------------------------------------------- | ----------------------- | --: | ------: | ----: | ----: |
| **Pre-Batch-2**                                                      | 289, 299, 306, 370, 392 |   5 | **306** | 331.2 |  41.6 |
| **Post-Batch-2** (initial 5)                                         | 335, 499, 353, 360, 385 |   5 |     360 | 386.4 |  62.0 |
| **Post-Batch-2 confirmation** (3 more, after tree restore + rebuild) | 432, 450, 427           |   3 |     432 | 436.3 |   9.5 |
| **Post-Batch-2, combined**                                           | (all 8 above)           |   8 | **406** | 405.1 |  52.6 |

**Delta (combined post vs pre)**: median **+100 ms** (306 → 406, ~33%), mean **+73.9 ms** (~22%).

**The confirmation runs are the strongest piece of evidence here**: all three (432, 450, 427) landed _above the entire pre-Batch-2 range_ (289–392), taken in a fresh rebuild after the tree was fully restored — not just a continuation of the first batch's numbers. This is a repeated, not a one-off, separation.

### 6.3 Corroborating control: paint timing shows no regression, which is exactly what should happen if the effect is real and specific

The spec also records `first-paint`/`first-contentful-paint` from a fixture-boot that has nothing to do with the canvas chunk (it fires long before any deferred `import()` resolves). If the wall-clock delta above were just generic machine noise from the concurrent session, this metric should show the same upward drift. It doesn't:

- Pre-Batch-2 `first-paint`: 412, 276, 476, 292, 404 → median 404ms
- Post-Batch-2 `first-paint` (all 8 runs): 436, 268, 388, 356, 380, 268, 328, 316 → median 342ms

Paint timing is flat-to-slightly-lower post-Batch-2, not higher. That is mechanistically consistent: Batch 2 didn't change anything about what's eagerly loaded before first paint (§2c/§5 of `batch-2-report.md` — the initial-chunk set shrank, if anything). **Only the metric that is supposed to be affected by deferring the canvas chunk — "reload → canvas interactive" — moved, and only in the direction the deferral predicts.** That is the evidence this is a real, specific effect and not undifferentiated system noise.

### 6.4 Verdict — yes, canvas time-to-interactive regressed in Electron, by roughly 70–100 ms (~20–33%) at the population that matters

**Stating it directly, not softened**: in Electron — where grid layout (and therefore the canvas) is not optional, every launch, per §3.3 — the wall-clock time from reload to canvas-interactive increased by approximately **100 ms at the median (306ms → 406ms) / 74 ms at the mean (331ms → 405ms)**, corroborated by a control metric (paint timing) that shows no corresponding shift. This is the direct, measured cost of moving `ORCHESTRA_CANVAS_COMPONENT` behind `resolveWhen` for the one population Electron actually has: everyone, since single layout mode doesn't exist there.

**Confounds, stated plainly rather than hidden behind the number**: this is a single machine, small samples (n=5 pre / n=8 post), and the concurrent backend session was actively committing during the measurement window (`git log` shows `HEAD` advancing from `6ddab70b8` to `5d7b0daa8` mid-measurement — a new commit, `5d7b0daa8` "fix: contain terminal cwd at the pty spawn sink," landed while these runs were in progress). The pre/post ranges also overlap in their middle band (335–392ms), so a single pre-vs-post pair could plausibly land on either side of the other by chance. What moves this from "noise" to "a real finding I'm reporting with the caveat attached" is: (a) the delta is directionally consistent across 8 independent post-samples taken in two separate batches (5 then 3, with a full stash/restore/rebuild cycle between them) rather than one lucky/unlucky run, (b) all 3 confirmation runs cleared the entire pre-Batch-2 range, and (c) the paint-timing control shows no analogous shift, which a pure load/noise explanation would not produce. I am not claiming a precise ±5ms number — I am claiming the direction is real and the rough magnitude is "tens of milliseconds, most likely landing in the 70–100ms band," and that a controlled re-run on a quiet machine would tighten but is unlikely to reverse this.

**What this does not resolve**: whether ~70–100ms is an acceptable cost for the ~210 kB Batch 2 removed from the initial bundle is a product trade-off call, not a testing call. I'm reporting the number so that call can be made with evidence instead of at Task 5.3 with none.

### 6.5 Tree restoration — verified

```
$ git status --porcelain
 M apps/ptah-electron-e2e/src/support/ui-driver.ts
 M apps/ptah-extension-webview/src/app/app.config.ts
 M libs/frontend/chat/src/lib/components/templates/app-shell.component.html
 M libs/frontend/chat/src/lib/components/templates/app-shell.component.ts
 M libs/frontend/core/src/index.ts
 M libs/frontend/core/src/lib/services/index.ts
 M libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts
 M marketing/scripts/01-open-source-announcement.md
?? apps/ptah-electron-e2e/src/specs/canvas/canvas-lazy-load.spec.ts
?? apps/ptah-electron-e2e/src/specs/marketplace/
?? apps/ptah-electron-e2e/src/specs/perf/
?? apps/ptah-electron-e2e/src/specs/tribunal/
?? libs/frontend/core/src/lib/services/canvas-load-trigger.spec.ts
?? libs/frontend/core/src/lib/services/canvas-load-trigger.ts
?? libs/frontend/core/src/lib/services/lazy-view.service.spec.ts
?? libs/frontend/core/src/lib/services/lazy-view.service.ts

$ git stash list
stash@{0}: On ak/quick-fix-discord: vertical marketing video
```

Exactly the same 10 Batch-2 paths, same modified/untracked split, as before this section's work began. No conflict markers introduced (checked all 6 modified Batch-2 files for `<<<<<<<`). The temporary stash (`TASK_2026_187 Batch2 app changes...`) was popped and no longer exists — only the pre-existing, untouched "vertical marketing video" stash remains, and it is still `stash@{0}` (the only entry), matching its state at the start of this session.

---

## 7. Canvas TTI re-measurement after the R14 fix

**§6 stays as written** — it is the record of why `shouldLoadCanvas` was changed. This section re-measures against the fixed trigger.

### 7.1 What changed (as described to me, confirmed against the working tree)

`canvas-load-trigger.ts` now branches on `bootstrapLayoutMode`: when it is `'grid'` (every Electron launch, §3.3), the loader fires **at construction, in parallel with bootstrap**, instead of waiting for `afterNextRender` + an idle callback. `'single'` is untouched — canvas still only loads on explicit intent there. `canvasPastFirstPaint` and the idle-callback plumbing are gone from `app-shell.component.ts`, not left dangling. I read the current `canvas-load-trigger.ts` directly (not just the description) — the doc comment on the function now states the +100ms §6 finding as the reason the old gate isn't coming back, which is a good sign the change is deliberate and durable, not an accidental revert.

Rebuilt (`ptah-electron:build-dev` + `copy-renderer`) against this tree — confirmed 4 initial chunks + 7 lazy chunks, matching the coordinator's stated "bundle unchanged in substance" (I did not re-run the byte-level attribution script myself; taking the 2,879,783 B / byte-identical-lazy-chunks figures as given, since this section's job is the TTI number, not re-deriving §5-style attribution).

### 7.2 Wall-clock "reload → canvas interactive" — three populations now

|                                | Samples (ms)                           |   n |    Median |      Mean |    Stdev |
| ------------------------------ | -------------------------------------- | --: | --------: | --------: | -------: |
| **Pre-Batch-2** (§6)           | 289, 299, 306, 370, 392                |   5 |       306 |     331.2 |     41.6 |
| **Post-Batch-2, pre-fix** (§6) | 335, 499, 353, 360, 385, 432, 450, 427 |   8 |       406 |     405.1 |     52.6 |
| **Post-fix** (this section)    | 455, 419, 310, 313, 330, 372, 461, 381 |   8 | **376.5** | **380.1** | **56.6** |

Taken as 5 runs, then 3 more after confirming the spread was comparable to §6's (145ms range vs §6's 164ms), same protocol as §6: fresh `build-dev` + `copy-renderer`, `startup-tti.spec.ts` run as its own `playwright test` invocation each time (no other Playwright process running concurrently).

**Delta vs pre-Batch-2**: median **+70.5 ms** (306 → 376.5, +23%), mean **+48.9 ms** (331.2 → 380.1, +14.8%).
**Delta vs post-Batch-2-pre-fix**: median **−29.5 ms** (406 → 376.5), mean **−25.0 ms** (405.1 → 380.1).

### 7.3 Paint-timing control — flat against the pre-fix run, NOT flat against the original pre-Batch-2 run, and that distinction matters

|                            | Samples (ms)                           |   n |  Median |      Mean |
| -------------------------- | -------------------------------------- | --: | ------: | --------: |
| Pre-Batch-2 (§6)           | 412, 276, 476, 292, 404                |   5 |     404 |     372.0 |
| Post-Batch-2, pre-fix (§6) | 436, 268, 388, 356, 380, 268, 328, 316 |   8 |     342 |     342.5 |
| Post-fix (this section)    | 296, 324, 412, 344, 388, 364, 284, 344 |   8 | **344** | **344.5** |

**Between post-Batch-2-pre-fix and post-fix — the comparison this section is actually making — paint is flat: 342 → 344 median, 342.5 → 344.5 mean, a ~2ms difference that is noise.** That's what "stayed flat" means for validity purposes here, and it holds: nothing about general machine/session conditions shifted between the pre-fix and post-fix measurement rounds, so the wall-clock delta between those two rounds (§7.2's −29.5ms/−25ms) is not contaminated.

**What is _not_ flat is paint-timing against the original pre-Batch-2 run from earlier in this session: 404ms → 342–344ms, a ~60ms drop.** I'm flagging this because the instruction was "if it moves this round, say so" — it did move, just not between the two rounds that matter for judging whether the fix helped. The pre-Batch-2 numbers were captured hours earlier in the same investigation, and general system state (OS file-cache warmth, the concurrent session's load at that specific moment) drifted in the _faster_ direction since then. Concretely: `git log` during the original §6 pre-Batch-2 measurement window showed `HEAD` unchanged; by the time of this section's work, the concurrent session had landed another commit (`5d7b0daa8`, "fix: contain terminal cwd at the pty spawn sink") — the same confound noted in §6.

**Why this doesn't erase the residual finding below, and if anything argues it isn't overstated**: the drift runs in the direction that would make the _whole system_ look faster later in the session, paint included. If that generic speedup were the dominant factor, post-fix's wall-clock number should plausibly have dropped to meet or beat pre-Batch-2's 306ms — a faster machine state should help every measurement, not just paint. It didn't: post-fix wall-clock (376.5ms median) is still clearly above pre-Batch-2's original 306ms, _despite_ being measured under conditions where the same harness paints ~60ms faster. That's evidence the residual is a real, canvas-fetch-specific cost, not an artifact of comparing a "slow session" baseline to a "fast session" fix — if anything, the fast-session conditions make the residual harder to see, not easier.

### 7.4 Verdict — partial recovery, not full recovery. A residual regression remains, and I'm not rounding it away.

**Directly**: canvas TTI in Electron did **not** return to the pre-Batch-2 range. The fix recovered part of the §6 regression but not all of it.

- Of the original ~100ms median gap (306 → 406), roughly **30% was recovered** (406 → 376.5), leaving a **residual of ~70ms at the median**.
- Of the original ~74ms mean gap (331.2 → 405.1), roughly **34% was recovered** (405.1 → 380.1), leaving a **residual of ~49ms at the mean**.
- Best single-number estimate of the residual: **~50–70ms**, i.e. canvas-interactive in Electron is still on the order of **15–23% slower** than before Batch 2, even with the fix.

**Confidence, stated honestly rather than as a clean number**: this residual rests on weaker statistical separation than §6's original finding. §6's pre-vs-broken-post comparison had all three confirmation runs clearing the entire pre-Batch-2 range — a clean separation. Here, only 3 of 8 post-fix samples (455, 419, 461) exceed pre-Batch-2's max (392); the other 5 (310, 313, 330, 372, 381) fall inside the pre-Batch-2 range. The two ranges (pre-Batch-2 289–392, post-fix 310–461) overlap substantially. A rough two-sample separation estimate (mean-difference over pooled standard error) gives roughly half the signal strength of §6's original finding.

**What I am and am not claiming**: I am not claiming a precise ±5ms residual — with this much overlap, that would be false precision. I _am_ claiming the direction is real and not an artifact: post-fix sits consistently between pre-Batch-2 and the broken post-Batch-2 measurement on **both** median and mean (not just one favorable statistic), the paint control confirms the two rounds being compared are apples-to-apples (§7.3), and the session-drift direction argues against, not for, an inflated residual. Given all of that, I am reporting a **residual regression of roughly 50–70ms**, not a "recovered" verdict, and not a bare "spread swamps everything, no verdict possible" — the evidence clears the bar for "a real but incompletely-quantified residual exists," it does not clear the bar for a tight number. A quiet-machine re-run with a larger sample (15-20 per condition) would tighten this; I would not expect it to flip the direction.

### 7.5 `canvas-lazy-load.spec.ts` — needed rewriting, exactly as predicted

Ran the file, unchanged, against the fixed build first: **both tests still passed**, including the old item-5 assertion (`jsRequests.length` grew between a post-`ui.prepare()` snapshot and canvas mounting). This is a coincidence of request-event arrival order, not a guarantee — the old assertion only checked that _some_ new `.js` request eventually arrived, with no bound on when, so a fetch that now starts _during_ bootstrap can still satisfy "eventually more requests than an earlier snapshot" even though the assertion's original premise (fetch happens strictly _after_ the shell is observably visible) is no longer true. Passing for the wrong reason is exactly the "asserts nothing real" failure mode I was told to avoid, so I rewrote it rather than leaving it as a passing-by-luck test.

**New second test** (`canvas is served from a genuine lazy chunk, never modulepreloaded, even though it now fetches during bootstrap`): drops all timing assumptions. It reads the static `<script src>` + `<link rel="modulepreload">` set straight from the live DOM (ground truth for "what this build declares eager"), waits for canvas to mount, then asserts (a) at least one captured `.js` request is _not_ in that static set — i.e. a genuine runtime `import()`, proving canvas is still a lazy chunk — and (b) none of those runtime-fetched URLs appears in the `modulepreload` set, re-asserting the R7 guarantee without caring when the fetch happened.

Also updated the file's header comment, which described the now-deleted `afterNextRender`/idle-callback mechanism as if it still existed — left stale, it would have misled the next person to touch this file.

Results against the fixed build:

- **First test** (`Electron forces grid layout even when a persisted preference requests single mode`) — **unchanged, still passes** (8.9s). Confirmed rather than assumed: this test's premise (single mode unreachable in Electron) has nothing to do with the R14 trigger timing, and the run proves it wasn't accidentally affected.
- **Second test** (rewritten) — **passes** (9.2s) against the fixed build.
- `npx tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` — clean.
- `npx nx lint ptah-electron-e2e` — 0 errors, same 1 pre-existing warning in `fixtures.ts` (untouched).

### 7.6 Marketplace / tribunal — confirmed still passing

Both re-run against the fixed build, individually:

- `marketplace.spec.ts` — 1/1 pass (9.3s)
- `tribunal.spec.ts` — 1/1 pass (8.9s)

Ran together with the rewritten `canvas-lazy-load.spec.ts` in one invocation (4 tests, 1 worker, serial) — all 4 passed, 37.1s total. `LazyViewService.resolveWhen` itself wasn't touched by this fix (only the _trigger function_ `canvasWanted`/`shouldLoadCanvas` passes it changed), and marketplace/tribunal's triggers (`currentView() === 'marketplace'` / `'tribunal'`) are untouched — this result is confirmatory, not a surprise, but it was run rather than assumed.

---

## 8. Canvas reverted to eager — final TTI check, and retiring `canvas-lazy-load.spec.ts`

Decision made on §6/§7: canvas (26.8 kB) and `gridstack` (88.0 kB) are back in the initial chunks. `marketplace` (45.3 kB) and `tribunal-panel` (44.4 kB) remain lazy. `canvas-load-trigger.ts` and its spec were deleted from the working tree (confirmed — `git status` shows neither file). Final Batch 2 shape as given to me: initial total 2,996,828 B, **−92,901 B** from the 3,089,729 B baseline (which is the same tree my §6 "pre-Batch-2" measurement was taken against — the numbers line up).

### 8.1 Method

Rebuilt fresh (`ptah-electron:build-dev` + `copy-renderer`) against the current tree. Confirmed the rebuild's lazy-chunk count dropped from 7 (§7's state) to 5 — no separate canvas/gridstack lazy chunk anymore, consistent with "back in the initial chunks." Ran `startup-tti.spec.ts` 8 times (same n and method as §6/§7 — separate `playwright test` invocations, no other Playwright process running concurrently).

### 8.2 Wall-clock "reload → canvas interactive" — four populations now

|                                               | Samples (ms)                           |   n |  Median |      Mean |    Stdev |
| --------------------------------------------- | -------------------------------------- | --: | ------: | --------: | -------: |
| Pre-Batch-2 (§6)                              | 289, 299, 306, 370, 392                |   5 |     306 |     331.2 |     41.6 |
| Deferred-after-paint (§6, R14 original)       | 335, 499, 353, 360, 385, 432, 450, 427 |   8 |     406 |     405.1 |     52.6 |
| Deferred-at-bootstrap (§7, first fix attempt) | 455, 419, 310, 313, 330, 372, 461, 381 |   8 |   376.5 |     380.1 |     56.6 |
| **Post-revert (canvas eager, this section)**  | 249, 219, 199, 242, 205, 207, 211, 270 |   8 | **215** | **225.3** | **23.8** |

**Post-revert range is 199–270ms. Pre-Batch-2 range was 289–392ms. There is zero overlap** — every one of the 8 post-revert samples is faster than every one of the 5 pre-Batch-2 samples, by a minimum margin of 19ms (270 vs 289) and a median margin of 91ms (215 vs 306). This is the cleanest separation in the entire investigation — §6 and §7's findings both rested on overlapping distributions with statistical reasoning to establish a direction; this one doesn't need it.

### 8.3 Paint-timing control — NOT flat this round, and here is why that doesn't undermine the verdict

|                                | Median (ms) | Mean (ms) |
| ------------------------------ | ----------: | --------: |
| Pre-Batch-2 (§6)               |         404 |     372.0 |
| Deferred-after-paint (§6)      |         342 |     342.5 |
| Deferred-at-bootstrap (§7)     |         344 |     344.5 |
| **Post-revert (this section)** |     **258** | **261.5** |

Unlike §7 (where paint was flat against the immediately preceding round), paint timing has continued drifting downward across every round of this multi-hour session: 404 → 342 → 344 → **258**. This is a real session-level trend — most plausibly a mix of OS file-cache warmth accumulating and the concurrent session's load easing off later in the session (its own commits, e.g. `libs/backend/agent-sdk/**` changes visible in `git status` right now, are still landing) — and it is **not** something the canvas-eager change could cause (paint fires before any canvas-related code runs either way).

**Stating the complication plainly, as instructed, rather than silently reading the wall-clock number**: if I naively scale the pre-Batch-2 wall-clock median by the same ratio the paint control moved (258/404 ≈ 0.64), I get ≈196ms — close to the actual post-revert median of 215ms. That means a non-trivial share of "how much faster than pre-Batch-2" is very plausibly generic session speedup, not specifically the canvas-eager reversion. **I am not attributing the full 91ms median margin to the product change alone.**

**Why the core verdict survives this caveat anyway**: the question is binary — did it return to the pre-Batch-2 range — and the margin (minimum 19ms, using the single closest pair: post-revert's slowest sample 270ms vs pre-Batch-2's fastest sample 289ms) is far larger than any plausible measurement noise at this sample size (post-revert's own stdev is 23.8ms — smaller than the whole session has ever shown). Even a substantially more conservative reading, crediting most of the apparent gain to session drift, leaves post-revert comfortably inside — not just at the edge of — the pre-Batch-2 range. I don't need to resolve how much of the improvement is "real" vs "session drift" to answer the question asked; both explanations converge on the same yes/no answer. What I can't respectably do is quote "91ms faster than baseline" as a clean product-attributable number — plausibly some of that is session drift, and I'm not pretending otherwise.

### 8.4 Verdict — recovered

**Directly**: yes, canvas time-to-interactive returned to the pre-Batch-2 range — and by a clean, non-overlapping margin, not an ambiguous one. The §6 finding (deferral cost +100ms) and the §7 finding (partial fix left a ~50–70ms residual) are both resolved by reverting canvas to eager: there is no more deferred fetch on the canvas path to pay for, because canvas is no longer a separate chunk on this path at all. I would not extend this same confidence to a claim like "canvas is now 91ms faster than before Batch 2" — some of that gap is session-level drift per §8.3 — but "did it return to the pre-Batch-2 range, yes or no" has a clean yes.

### 8.5 `canvas-lazy-load.spec.ts` retired

**Deleted**: the file, in full. Its lazy-chunk / `modulepreload` assertions (§7.5's rewrite) now assert a property canvas doesn't have — it's eager, not a lazy chunk — so they'd be either false (if canvas somehow still produced a separate chunk) or meaningless to check (there's no "is this chunk modulepreloaded" question to ask about code that ships in `main.js`). Leaving them would be exactly the trap §7 already named: an assertion whose passing tells you nothing.

**Kept**: the `layoutMode='single'` test — moved into `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` as its first test, in the existing `Canvas` describe block. Its premise (single layout mode is unreachable in Electron; `ElectronShellComponent` forces grid unconditionally) has nothing to do with whether canvas is lazy or eager — it was true before Batch 2, during the R14 experiment, and after the revert, and the test still fails loudly if that ever changes (e.g. if Electron regains a single-chat mode without updating the forced-grid constructor logic). Re-ran it standalone against the post-revert build: **passes** (canvas grid visible, `ptah-tab-bar` count 0). Updated its inline comment to explain why it now lives in `canvas.spec.ts` and to stop referencing the deleted lazy-load mechanism.

Verification against the current (post-revert) build, `canvas.spec.ts` + `marketplace.spec.ts` + `tribunal.spec.ts` together (4+1+1 = 6 tests, one invocation, serial):

- First attempt: 5 passed, 1 failed — `canvas.spec.ts`'s pre-existing `add + focus a tile` test (untouched by any of my edits) failed with `electronApplication.firstWindow: Timeout 30000ms exceeded`, at roughly the same point another sequential launch (`grid renders in grid mode`, 23.8s — 2-3× its normal duration) had also visibly slowed down.
- Re-ran that one test alone: failed again, differently (`page.waitForLoadState: Target page, context or browser has been closed`) — two different launch-level failure modes in a row, neither an assertion about tile behaviour, both consistent with the machine being under heavier load than earlier in this session (3 stray `electron.exe` processes were still resident; the concurrent backend session was mid-edit across a dozen `agent-sdk` files at the time, per `git status`).
- Re-ran a third time, alone: **passed** (26.9s — still slow, but completed).
- Re-ran the full 6-test set once more, clean: **all 6 passed** (canvas ×4, marketplace ×1, tribunal ×1), though visibly slower across the board (24–47s per test vs. the typical 8–10s seen earlier in this session) — confirming general system load, not a targeted failure of this one test.

**Not attributing this to the canvas-eager revert**: `add + focus a tile` exercises tile creation, focus, and cross-navigation persistence — none of which the eager/lazy status of the canvas component's _loading mechanism_ touches once the component has mounted, and it is unmodified content from before this entire investigation started. Two distinct launch-level failure signatures, resolving on retry without any code change, is the signature of resource contention, not a regression.

### 8.6 Gate coverage table — final state

| #   | Item                                                                               | Final status                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Marketplace renders after a spinner                                                | **Automated, unaffected by the canvas revert** — `specs/marketplace/marketplace.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Tribunal renders after a spinner (+ gridstack)                                     | **Automated, unaffected** — `specs/tribunal/tribunal.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Canvas grid renders; tiles survive grid→single→grid                                | **Meaning changed: now trivially satisfied.** Canvas is eager again — mounted at shell init exactly as it was before Batch 2 ever touched it, so there is no "does the deferred component survive a load-timing edge case" question left to ask. Grid render + tile persistence across standalone-view navigation: covered, `canvas.spec.ts`. The grid→single→grid toggle half remains structurally inapplicable to Electron (§3.3), independent of canvas's eager/lazy status. |
| 4   | `layoutMode='single'`: none of the lazy chunks fetched on launch                   | **Still irreducibly inapplicable to Electron** (§3.3, re-proven this session in `canvas.spec.ts`'s retained test) — and now narrower in scope than originally framed, since only marketplace + tribunal are lazy at all; canvas/gridstack are no longer part of this question.                                                                                                                                                                                                  |
| 5   | `layoutMode='grid'`: canvas loads without toggle, chunks fetched after first paint | **Moot — superseded by the eager-canvas decision.** There is no canvas chunk-fetch timing left to test; the property this item asked about no longer exists in the product. §6/§7/§8 are the record of why (measured cost, partial fix, full revert), not a gap.                                                                                                                                                                                                                |
| 6   | Sidebar "open session in tile" from single mode                                    | **Still irreducibly inapplicable to Electron** (§3.3), and doubly moot now — even setting aside single-mode's unreachability, there is no lazy canvas load left to observe on this path either.                                                                                                                                                                                                                                                                                 |
| 7   | DevTools Performance TTI recording                                                 | **Closed, not just referenced.** §6→§7→§8 is a complete before/after/after-fix/after-revert measurement chain, on the same harness, same machine, same method throughout: 306ms → 406ms → 376.5ms → 215ms. This is the artifact that drove a real product decision (revert canvas to eager) — the strongest outcome this item could have produced.                                                                                                                              |

5 of 7 items were automatable in some form; of those, 2 remain live (marketplace, tribunal), 3 resolved to "no longer applicable" as a _direct consequence_ of the canvas decision this validation produced (items 3, 5, 6 either simplified to trivial or became moot), and 1 (item 7) closed out completely rather than staying open. Items 4 and 6 remain the two structurally-inapplicable-to-Electron findings from §3.3, unchanged by anything in §6–8.

---

## 9. Batch 3 validation — Thoth `@defer`, narrow barrels, R4

**Batch 3, uncommitted in the working tree.** `ThothShellComponent` moved behind `@defer (on immediate)` inside the `'thoth'` `@case`, shedding `skill-synthesis-ui` / `memory-curator-ui` / `messaging-gateway-ui` / `cron-scheduler-ui`. Four narrow `/services` barrels keep `GatewayStateService`, `SkillSynthesisLiveService`, `VecEmbedderRecoveryService` (all `MESSAGE_HANDLERS`) and `CronRpcService` eager. `DashboardGridComponent` stays eager — `batch-3-report.md` §1a's R15 finding is that `ptah.openDashboard` is a real VS Code activation event, so analytics is launch-reachable and must not be deferred. Initial total 2,996,828 → 2,702,149 B (−294,679 B), transfer 597.46 → 552.76 kB.

### 9.1 Suite result

Ran fresh against a rebuilt tree (`ptah-electron:build-dev` + `copy-renderer`, this Batch 3 working tree, untouched by me).

| Spec                                                            | Result                                        |
| --------------------------------------------------------------- | --------------------------------------------- |
| `specs/thoth/cron.spec.ts` (3 tests)                            | ✅ all pass                                   |
| `specs/thoth/gateway.spec.ts` (3 tests)                         | ✅ all pass                                   |
| `specs/thoth/memory.spec.ts` (3 tests)                          | ✅ all pass                                   |
| `specs/thoth/skills.spec.ts` (3 tests)                          | ✅ all pass                                   |
| `specs/dashboard/dashboard.spec.ts` (1 test)                    | ✅ pass                                       |
| `specs/thoth/message-handlers-eager.spec.ts` (4 tests, **new**) | ✅ all pass                                   |
| `specs/perf/startup-tti.spec.ts`                                | ✅ 5/6 runs clean, 1 instrument hiccup (§9.4) |

**14 tests total across the six functional specs, 0 failures.** `specs/thoth/skill-telemetry.spec.ts` was not run — it is `@nightly`-tagged and gated behind `PTAH_E2E_SKILL_TELEMETRY=1` + win32, unrelated to this batch, same as every prior run in this investigation.

**Attribution check, before trusting any of this**: the concurrent session's most recent touch to `libs/backend/gateway-chat-bridge/` is commit `000d0593f` ("gate gateway inbound sessions behind configurable permission level") — already landed, not a working-tree diff (`git status --porcelain` shows nothing under that path right now). `gateway.spec.ts` uses `ui.mockRpc` for every RPC surface and never imports backend code, so it cannot observe that commit either way; it passing is a real, uncontaminated result, not a lucky non-collision. Documenting the check per the standing instruction, not skipping it because everything happened to pass.

### 9.2 Do the four Thoth tabs still work behind the deferred chunk?

Yes — `cron.spec.ts`, `gateway.spec.ts`, `memory.spec.ts`, `skills.spec.ts` all pass unmodified against the Batch 3 build. Each of these opens Thoth via `ui.openTab(...)`, which is exactly the path that now resolves a `@defer (on immediate)` block before the tab content exists. If the deferred chunk failed to resolve, or the `@placeholder` never cleared, every one of these `waitFor({state:'visible'})` calls on tab/panel locators would time out. None did. This answers item 1 directly: the `@defer` inside the `@case` is transparent to the existing behavior, empirically, not just "should be."

### 9.3 R4 — independently confirmed against the real app, not just weakly covered

**Verdict: independently confirmed**, with a new file, `specs/thoth/message-handlers-eager.spec.ts` (4 tests), built specifically to close the gap the coordinator named.

**The existing specs do NOT prove the R4 condition.** Checked every one of them: `cron.spec.ts`, `gateway.spec.ts`, `memory.spec.ts`, `skills.spec.ts` all call `ui.openTab(...)` (which navigates to `'thoth'` and mounts `ThothShellComponent`) **before** any push message is ever dispatched — including `gateway.spec.ts`'s own "`gateway:statusChanged` push transitions a tile" test, which opens the Gateway tab first and pushes second. That proves push-delivery **while mounted**, which was never in question — R4 is specifically about the state _before_ Thoth has ever been created, and none of the five existing specs exercise that.

**Why "push it, then open the tab and look" is not a sufficient design for a new test either** — this took real investigation, not just writing the obvious test: three of the four services' consuming components _also_ trigger their own independent RPC-driven refresh the moment they mount (`GatewayStateService.initialize()`, `ThothStatusService.refreshIfNeeded()` on first load, `VecEmbedderRecoveryService.prime()` via `db-health-panel`'s `ngOnInit`). If that mount-time refresh silently overwrote whatever a pre-mount push had set, a naive "push, then open, then check" test would keep passing even if the push were completely dropped — the mount's own fetch would produce a correct-looking screen regardless of whether the earlier push worked. That is precisely the failure mode "materially weaker check" was warning about, just one level deeper than the obvious version of it.

Each of the four tests in the new file is built around a specific, source-verified mechanism that prevents the post-mount refresh from being able to launder a dropped push:

| Service                      | Mechanism used                                                                            | Why it's race-free                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SkillSynthesisLiveService`  | Push `curator-pass` → asserts `skillSynthesis:stats` RPC fires, via `ui.getObservedCalls` | **No UI mounted at all.** The RPC call is a direct side effect of `handleMessage` itself (`skill-synthesis-live.service.ts`), so this is proof with zero opportunity for a mount-time refresh to interfere.                                                                                                                                                                                                                                                  |
| `GatewayStateService`        | `gateway:status` mocked without `adapters`; push; open tab **once**                       | `applyStatus()` calls `status.adapters.find(...)` with no guard — the mount-time `refreshStatus()` throws internally, caught by its own try/catch, `platforms` is left untouched (`gateway-state.service.ts:284-291`). Verified by reading the source, not assumed.                                                                                                                                                                                          |
| `VecEmbedderRecoveryService` | `db:health` mocked without `vecDiagnostic`; push; open tab **once**                       | `primeVecDiagnostic()` explicitly guards on `result.data?.vecDiagnostic` before overwriting, with an existing product comment: _"push events keep state fresh after this"_ (`vec-embedder-recovery.service.ts:127`) — an intentional behaviour this test leans on, not an incidental throw.                                                                                                                                                                  |
| `ThothStatusService`         | Open once (well-formed baseline) → close → push → **reopen**                              | `loadGateway()` is defensive (`derivePlatformSummaries` falls back safely instead of throwing), so the omit-a-field trick doesn't work here — it would silently overwrite with a clean "everything stopped" state instead of surfacing an error. Instead: `refreshIfNeeded()` only refreshes "on the first call" (`thoth-status.service.ts:262-266`); after the first open it's a no-op, so a second open cannot clobber a push made while Thoth was closed. |

All four services required reading their actual `handleMessage` / mount-time-refresh implementation before a valid test could be designed — a generic template would have silently produced a race in 3 of 4 cases. All four tests are non-vacuous by construction: each was checked against what the assertion would read if the push had never been sent (`GatewayStateService`: `platforms` defaults to all-`'stopped'`; `ThothStatusService`: pillar value stays at the first-open baseline `'0'`; `VecEmbedderRecoveryService`: badge defaults to `'offline'`; `SkillSynthesisLiveService`: `waitForObservedCall` times out) — every one of them would fail if the registration were actually broken.

### 9.4 Does the dashboard still work?

Yes — `dashboard.spec.ts` passes against the Batch 3 build. Worth stating precisely what it covers, since "dashboard" in this codebase is not the `analytics` view: per `libs/frontend/dashboard/CLAUDE.md`, _"there is no standalone status-card component anymore"_ — the `ThothStatusService`-derived pillar tiles render **inside `thoth-shell`'s sidebar**, not on the eager `ptah-dashboard-grid`. `dashboard.spec.ts`'s one test opens the Memory tab and checks a `dashboard-status-card[data-pillar="memory"]` tile — meaning it already exercises exactly the §2 repoint (`thoth-status.service.ts`'s four RPC imports moved to `/services` subpaths) the coordinator flagged, and it passing confirms none of the four resolved wrong. Separately, `ptah-dashboard-grid` itself (the actual `analytics` `@case`) was not deferred and is unaffected by anything in Batch 3 — no test in this session specifically re-opens `analytics` for Batch 3, but nothing in the batch's file list touches `dashboard-grid.component.*`, and the `thoth-status.service.ts` repoint is the only dashboard-adjacent change, which the pillar-tile assertion already covers end-to-end (constructs the service through the real narrow-barrel import path production now takes, receives real RPC data through it).

### 9.5 Startup TTI — no Thoth-attributable movement

Ran `startup-tti.spec.ts` 6 times against the Batch 3 build (one instrument hiccup, see below; 5 clean samples used for the headline numbers), same method as §6-§8.

|                                          | Samples (ms)            |   n |  Median |  Mean | Stdev |
| ---------------------------------------- | ----------------------- | --: | ------: | ----: | ----: |
| Wall-clock "reload → canvas interactive" | 339, 315, 301, 315, 316 |   5 | **315** | 317.2 |  12.2 |
| Paint (`first-paint`)                    | 332, 364, 328, 308, 308 |   5 |     328 | 328.0 |     — |

One run (of the 6) came back with an **empty** `performance.getEntriesByType('paint')` array (`domContentLoadedEventEnd` present, `loadEventEnd: 0`) — the instrument's own sanity assertion (`paint.length > 0`) failed that run, while the wall-clock figure it recorded (332ms) landed squarely inside the other 5 samples' range. Treating this as a one-off Performance-API population glitch on that particular boot, not a real signal — the wall-clock number from the same run is consistent with everything else, and it's the metric the sanity check is protecting, not the metric being reported.

**Compared against §8's post-revert numbers (215ms median wall-clock, 258ms median paint)**, both numbers moved up — wall-clock by +100ms, paint by +70ms. Read together with §6/§7/§8's demonstrated pattern of session-wide drift (the concurrent session was still committing during this run too — `libs/backend/agent-sdk/**` shows `MM` in `git status` right now), the two moves are **proportionally similar** (wall-clock ×1.47, paint ×1.30) rather than the wall-clock moving alone. Thoth's deferred chunk cannot affect paint timing at all — nothing about it runs before first paint — so a paint-timing increase of comparable magnitude is the same corroborating-control signal §8 used, pointing at general machine load rather than anything Batch 3 changed. **Verdict: no Thoth-attributable TTI movement.** This matches the batch author's own expectation (§1 of `batch-3-report.md`: Thoth is not a launch surface) and this session's own instrument corroborates it rather than just accepting the assumption.

### 9.6 New test file

`apps/ptah-electron-e2e/src/specs/thoth/message-handlers-eager.spec.ts` — 4 tests, all passing individually and together. `npx tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` clean; `npx nx lint ptah-electron-e2e` — 0 errors, same 1 pre-existing warning in `fixtures.ts` (untouched).

```bash
cd apps/ptah-electron-e2e
npx playwright test --config=playwright.config.ts src/specs/thoth/message-handlers-eager.spec.ts
```

**No Batch 3 application files were modified.** `git status --porcelain` after this section shows the same Batch 3 diff as before (`app.config.ts`, `app-shell.component.html`, `thoth-status.service.ts`, `tsconfig.base.json`, the four new `services.ts` barrels, the developer's own `thoth-message-routing.spec.ts`), plus exactly one new file of mine. No stash was needed this round — Batch 3 was already the tree to test against, nothing to isolate it from.

---

## 10. Batch 4 validation — `tasks-ui` / `harness-builder` deferral, R4, wizard bootstrap

**Batch 4, uncommitted in the working tree.** `TASKS_VIEW_COMPONENT`, `HARNESS_BUILDER_COMPONENT`, `SETUP_HUB_COMPONENT` become lazy tokens (the latter two share one chunk — same lib). Narrow `/services` barrels keep `TasksStore` and `HarnessWorkflowMessageHandler` (both `MESSAGE_HANDLERS`) eager. `setup-wizard` stays fully eager — `batch-4-report.md` §1a's R15 finding is that `ptah.setupAgents` is a VS Code activation event whose panel factory hardcodes `initialView: 'setup-wizard'`, a stronger launch-surface case than the dashboard's. Initial total 2,702,149 → 2,536,716 B (−165,433 B), 36,716 B short of the 2.5 MB target (Batch 5 required).

No spec existed for the tasks board or the harness builder / setup hub before this session — both needed new files, not just re-runs.

### 10.1 Independent confirmation from the built output: no wide-barrel leak

The coordinator asked this be checked from the built artifact, not the source, because Batch 3's `ThothStatusService` leak was exactly this failure mode and it was found by measurement, not by reading. Built `ptah-extension-webview` production with `--source-map --skip-nx-cache` and ran the task's own `attribute.js` over every chunk.

Per-lib totals from the attribution's grand-total pass: **`lib:frontend/tasks-ui` = 135.6 kB, `lib:frontend/harness-builder` = 55.1 kB** — matching `batch-4-report.md` §6 exactly. Breaking that down by which chunk each byte landed in:

| Lib               |                                                                                               Lazy chunk (component code) |                                 Initial-chunk residue | What the residue is                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------: | ----------------------------------------------------: | --------------------------------------------------------------- |
| `tasks-ui`        | `chunk-UNV5KZLJ.js` — 118.8 kB (confirmed **lazy** — present only in the build's "Lazy chunk files" table, not "Initial") | `chunk-VLDBGNY4.js` — 16.8 kB (confirmed **initial**) | `TasksStore` only — matches §6's stated I-3 residue to the byte |
| `harness-builder` |                                                                                  `chunk-DZVLDDUZ.js` — 39.4 kB (**lazy**) |           `chunk-7EQ3OORQ.js` — 15.8 kB (**initial**) | the four eager harness services — matches §6 to the byte        |

Both libs' presence in the initial bundle is **exactly and only** the small eager-service residue I-3 requires — no chunk containing tasks-ui or harness-builder _component_ code (the 118.8 kB / 39.4 kB pieces) appears anywhere in the initial set. Had there been a Batch-3-style leak, the full component-bearing size would show up attributed into one of the initial chunks instead of a lazy one; it doesn't. **Independently confirmed from the artifact, not assumed from the report.**

### 10.2 R4 — independently confirmed, same standard as Batch 3

**Verdict: independently confirmed.** New file `apps/ptah-electron-e2e/src/specs/tasks/message-handlers-eager.spec.ts`, sibling to Batch 3's, 2 tests:

| Service                         | Message                                         | Proof                                                                                                                                          | Mount-race concern?                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TasksStore`                    | `tasks:changed` (no `workspaceRoot`)            | `ui.waitForObservedCall('tasks:board')` fires — **zero UI ever mounted**                                                                       | None — `handleMessage` → `refreshActiveFromPush()` → `fetchBoard()` issues the RPC directly; nothing to race                                                             |
| `HarnessWorkflowMessageHandler` | `harness:open-workflow` (`mode: 'new-project'`) | The app **navigates itself** — `ptah-harness-builder-view` becomes visible with no `ui.goto`/`pushEvent(switchView)` call anywhere in the test | None — `navigateToView('harness-builder')` fires synchronously from inside `handleMessage`; the view appearing _is_ the proof, not a value a later fetch could overwrite |

Both are structurally simpler to prove than Batch 3's three DOM-based cases: neither service's push handler merely sets a signal that a later independent mount-time refresh could race and overwrite (the trap §9.3 spent most of its effort defeating) — one triggers an RPC directly, the other triggers navigation directly, and both are observable as an immediate, one-way consequence of the push itself. Both non-vacuous by construction: without the push, `waitForObservedCall` times out, and `ptah-harness-builder-view` stays absent (confirmed as the explicit first assertion in that test).

`apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts` (Jest, developer's own artifact) proves the same property at the `MessageRouterService` unit level, including a third case (`SetupWizardStateService`) this e2e pass didn't duplicate — `setup-wizard` is eager, so there's no "never opened" condition to prove for it at the e2e level; §10.3 covers it via full bootstrap instead.

### 10.3 Do the deferred surfaces still work, and does the wizard still bootstrap?

**Tasks board** — new file `specs/tasks/tasks-board.spec.ts`: mocks a one-task `tasks:board` response, navigates to `'tasks'`, asserts `ptah-tasks-view` visible (the loader resolved) **and** `task-column-count` reads `1` (the Kanban populated from real data, not an empty shell). Pass.

**Harness builder + setup hub** — new file `specs/harness/harness-builder.spec.ts`: opens each view independently (`ui.goto('harness-builder')` then, in a fresh test, `ui.goto('setup-hub')`), asserting `ptah-harness-builder-view` / `ptah-setup-hub` respectively. Both pass — the one shared 41,190 B chunk serves both correctly, and testing them independently (not just one) was the point: batch-4-report.md §12 flagged that a broken barrel symbol could make exactly one of the two look fine while the other silently isn't.

**Setup wizard** — `specs/setup-wizard.spec.ts` (4 tests) + `specs/setup-wizard/wizard-dom.spec.ts` (2 tests), all 6 unmodified and all passing against the Batch 4 build. This is the highest-value regression check in this batch: `provideWizardInternalState` was repointed to resolve through the narrow barrel and is spread directly into the providers array at `app.config.ts:128` — if that resolution had broken, the wizard wouldn't just show wrong, `app.config.ts`'s provider list would fail to construct and the **whole app would fail to bootstrap**, not just the wizard. A clean run of these 6 is direct evidence bootstrap itself is intact, not just that the wizard view renders correctly once you're in it.

### 10.4 Startup TTI — no movement, and the numbers land closer to the clean baseline than Batch 3's did

5 runs against the Batch 4 build, same method as §6-§9.

|                                          | Samples (ms)            |   n |  Median |  Mean | Stdev |
| ---------------------------------------- | ----------------------- | --: | ------: | ----: | ----: |
| Wall-clock "reload → canvas interactive" | 185, 218, 233, 248, 212 |   5 | **218** | 219.2 |  21.2 |
| Paint (`first-paint`)                    | 240, 252, 228, 236, 248 |   5 |     240 | 240.8 |     — |

Compared against §8's clean post-revert baseline (215ms median wall-clock / 258ms median paint) — the reference point least contaminated by any of the batches' own changes — this round lands **almost exactly on it** (218 vs 215 wall-clock, a 3ms difference; 240 vs 258 paint, actually lower). This is a tighter match to the clean baseline than §9's Batch 3 numbers were (315/328), consistent with the session-wide load drift documented in §8/§9 fluctuating in both directions rather than trending, and gives no reason at all to suspect Batch 4 put anything new on the critical path. Matches the batch author's own expectation (§1f of `batch-4-report.md`: nothing deferred is startup-reachable, so no TTI hypothesis existed to test) — and this session's instrument landing this close to the clean baseline is a stronger confirmation of that than the "didn't run it" call the report made on its own.

### 10.5 Full suite — completed

**118 tests total: 104 passed, 1 failed, 13 skipped.**

The 1 failure is **new** relative to every prior run in this investigation: `src/specs/auto-updater.spec.ts:49` — "forced development NODE_ENV: updater is skipped entirely" — `Error: electron.launch: Target page, context or browser has been closed`, 4.6s into the test (an immediate launch-level failure, not an assertion failure).

**Attribution — re-run in complete isolation, no other Playwright process running**: passes cleanly, 18.2s. Same category as the two launch-level flakes already documented in §0/§1.1 of this report (`lifecycle.spec.ts:117`'s "quit before the renderer settles" test, which failed with two different launch-level error signatures across this investigation and passed cleanly every time it was re-run alone). `_electron.launch()`/window-handshake races under sustained single-machine load (by this point, well over 150 sequential Electron launches across this multi-batch validation session) are the established, evidenced pattern for this failure mode in this environment — not a code regression, and not attributable to Batch 4's deferrals (`auto-updater.spec.ts` exercises the update-checker path at app startup, which Batch 4 did not touch in any way).

**No new failure beyond the two already-attributed sources** (`editor.spec.ts:73` / TASK_2026_196, and this session's own launch-race flakiness) turned up. The concurrent session's `libs/backend/agent-sdk/**` work — still showing `MM` in `git status` throughout this run — never collided, consistent with every prior batch: `libs/frontend` does not import `@ptah-extension/agent-sdk`.

**Tree note**: partway through this section, Batches 3 and 4 were committed (`git log` now shows `9fd167b4f` "defer the Thoth shell...", `4508df433` "prove the Thoth MESSAGE_HANDLERS stay eager...", `b24ccf52a` "defer the tasks board and harness builder...", `5fd739b03` "cover the tasks board and harness builder as deferred surfaces" — the last two are this session's own `tasks-board.spec.ts` / `message-handlers-eager.spec.ts` / `harness-builder.spec.ts` files, picked up as-written). This does not affect anything already measured in §9/§10 — the full suite ran against a build compiled from this same tree content before the commits landed, and the commits changed working-tree status, not file content.

### 10.6 New test files

```bash
cd apps/ptah-electron-e2e
npx playwright test --config=playwright.config.ts \
  src/specs/tasks/tasks-board.spec.ts \
  src/specs/tasks/message-handlers-eager.spec.ts \
  src/specs/harness/harness-builder.spec.ts
```

`npx tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` clean. `npx nx lint ptah-electron-e2e` — 0 errors, same 1 pre-existing warning in `fixtures.ts` (untouched). `apps/ptah-electron-e2e/src/support/ui-driver.ts` widened again (additive) with `'tasks' | 'harness-builder' | 'setup-hub'`, same pattern as the marketplace/tribunal addition in §4 — no logic change, the existing generic `switchView` fallback in `goto()` handles all three.

**No Batch 4 application files were modified.** `git status --porcelain` shows the same Batch 4 diff as before this section (`app.config.ts`, `app-shell.component.html`/`.ts`, `lazy-view-components.token.ts`, `eslint.config.mjs`, `tsconfig.base.json`, the two new `services.ts` barrels, the developer's own `unit5-message-routing.spec.ts`), plus exactly the new files/edits listed above. No stash needed — nothing required isolating from this tree.

---

## 11. Batch 5, Units 9 + 10 — theme split, zod removal, streaming risk

**Both uncommitted in the working tree.** Unit 9: 32 daisyUI prebuilt themes moved to a non-injected `theme-extra.css`, fetched on demand; `anubis`/`anubis-light` stay eager. Unit 10: the six `.safeParse` calls in `chat-message-handler.service.ts` replaced with hand-written parsers (backed by a 3,063-input Jest equivalence spec, already run and confirmed by the coordinator), removing `zod` (304 kB) from the eager bundle; one `tasks-ui` site deferred instead. Initial total now **2,200,511 B / 468.06 kB — under the 2,500,000 B target.**

### 11.1 Streaming path — independently confirmed, both directions

**Verdict: independently confirmed against the real running app.** New file `apps/ptah-electron-e2e/src/specs/chat/streaming-message-handlers.spec.ts`, 2 tests.

**Why this targets the actual stated risk rather than a broader "does chat work" test**: the coordinator's concern was specific — _"a parser that wrongly rejects a valid payload would silently drop a streaming message."_ The Jest equivalence spec already rules this out at the parser-logic level (3,063 inputs, includes real corpus-caught divergences from zod's actual semantics — `unit10-zod-report.md` §3). What it cannot rule out is a **production-wiring** failure: does the real narrow-barrel-free import resolve in the actual built app, does `MessageRouterService` actually dispatch to the real parser, does the eager `ChatMessageHandler` singleton actually receive the message. That is what this file checks, against the built Electron renderer.

**Method**: reading `chat-message-handler.service.ts` confirmed every one of the six `handle*` methods calls its parser **before** any tab/session-matching logic runs — so the accept/reject outcome is observable with **no chat tab or session ever created**, the same eager-service/never-opened-surface shape this task's R4 gate already established, applied to a payload-validation risk instead of a component-loading one. The instrument is `page.on('console')` (the renderer's own console — distinct from `mainProcessOutput`, which only captures the Electron main process) capturing the exact literal reject string each `handle*` method emits (`'[ChatMessageHandler] Invalid <Schema> — dropped'`).

- **Test 1** pushes all six canonical valid payloads (copied verbatim from `wire-parsers.equivalence.spec.ts`'s own fixtures — `TURN_ENDED`, `TURN_FAILED`, `SUBAGENT_ENDED`, `COMPACTION_COMPLETE`, `PERMISSION_REQUEST`, `ASK_USER_QUESTION` — so this test and the Jest suite check the same shapes) and asserts **none** of the six reject strings appear. **Caught a real bug in my own test on the first run**: my hand-copied `TURN_ENDED.backgroundTasks[0]` fixture was missing `type`/`status` fields present in the actual equivalence-spec fixture, and the real parser correctly rejected my malformed copy — reproducing the exact "reject warning fires" outcome I was testing for, for the right reason (my payload was genuinely invalid), not a parser bug. Fixed the fixture to match the source exactly; re-ran clean. Recording this because it's a real illustration of the test _working_ — it caught a wrong payload immediately, which is exactly the sensitivity the whole point of this file requires.
- **Test 2** pushes two payloads with a required field deleted (`sessionId` from `TURN_ENDED`, `toolName` from `PERMISSION_REQUEST`) and asserts the corresponding reject string **does** fire — checking the reject path wasn't accidentally widened into acceptance (the equivalence spec's own "both outcomes exercised" discipline, applied here too) — and that the app survives a rejected payload (navigates to `dashboard` afterward, confirms it renders).

Both pass. Confirms: all six rewritten parsers accept real backend-shaped payloads and reject malformed ones, in the actual running app, not just in Jest.

**Not attempted, and why**: a full multi-chunk text-streaming-order fidelity test (`chat:chunk` sequencing, message-bubble rendering). `CHAT_CHUNK` is not one of the six rewritten schemas — Unit 10 did not touch its validation at all, so a chunk-ordering test would not be exercising this unit's actual change. Building one would also require a full `chat:start` → `session:id-resolved` → tab/session-binding handshake with no existing e2e precedent to build from (confirmed no spec in this suite pushes any of the six message types, or `chat:chunk` with a bound session, before this file). Given the coordinator's stated risk was specifically the parser-reject failure mode, the six-schema accept/reject proof targets it directly; a full transcript-rendering test would be validating pre-existing, unchanged machinery at disproportionate effort for this validation.

### 11.2 Theme split — H2 mechanised, H1 confirmed not mechanisable (not assumed)

New file `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts`, 5 tests, all passing.

**H2 (theme-extra.css never fetched for anubis/anubis-light) — mechanised**, exactly as `batch-5-unit9-report.md` §10 names it: _"the single highest-value check."_ Three tests: default (no persisted state) never fetches; `anubis-light` persisted never fetches; a persisted 32-theme (`dracula`) **does** fetch and applies pre-paint. Instrument: `page.on('request')` — confirmed empirically (again) to fire reliably for `file://` CSS `<link>` fetches, extending the same finding this task established for JS chunk imports.

**Methodological finding along the way, worth recording**: seeding only `localStorage['ptah-theme']` is not sufficient to observe the persisted-theme case. `theme.service.ts` treats `localStorage` as a pre-paint **hint** only; on construction it re-reads the **authoritative** `vscode.getState('theme')` and will overwrite `data-theme` back to the default if that's empty — exactly as designed (§4b of the unit report), but it means a test must seed both. Fixed by also calling `rpcBridge.setState({ theme: 'dracula' })` (the same `'set-state'` IPC channel `preload.ts` backs `vscode.getState()` with) before the reload.

**H1 (no `anubis` flash on the first painted frame) — confirmed NOT mechanisable in this harness, verified empirically rather than assumed.** Three instruments tried and rejected, documented in the spec file's header comment so the next person doesn't re-try them:

1. `performance.getEntriesByType('resource')` — empty for `theme-extra.css`, same finding as this task's established result for JS chunks, now confirmed to extend to CSS `<link>` fetches too.
2. `page.on('request')`/`page.on('response')` — fires, but `response.timing()` returns `-1` sentinels for the phases that don't apply to a `file://` disk read, and its `startTime` is not on the same clock axis as `performance.timeOrigin`-relative paint entries.
3. Coarse cross-instrument correlation (Playwright-event-arrival vs. paint-entry timestamp, the technique used elsewhere in this validation for ordering claims accurate to tens of milliseconds) — nowhere near the single-frame (~16ms) precision the property being asked about requires: _"was the first frame already correct,"_ not _"did it become correct soon after."_

Left in the human gate (H1, H1b, and the visual "no strobe" half of H3), matching the unit report's own conclusion — independently re-derived here, not copied.

**H3 mechanics (not its visual claim) — mechanised.** All 34 themes present and selectable in the picker (34 buttons with distinct `data-theme` attributes; spot-checked `anubis`, `anubis-light`, `dracula`). A runtime switch to a never-before-loaded deferred theme (`dracula`) fetches the sheet and applies it; a second switch to a different deferred theme (`synthwave`) applies with **no** additional fetch (confirms the "reuse the loaded sheet" behaviour, §4e of the unit report). One interaction-robustness note: the theme buttons required `dispatchEvent('click')` instead of a real `.click()` — Playwright's hit-test reported the canvas empty-state panel as intercepting the pointer at that coordinate despite the button being visibly on top on screen (a daisyUI dropdown stacking-context quirk under this harness, confirmed via screenshot during triage, not a functional bug) — documented inline in the spec so it isn't mistaken for masking a real issue later.

### 11.3 Startup TTI — no regression, but the paint instrument itself is now broken, and that is worth flagging plainly

Ran `startup-tti.spec.ts` 8 times against the current (Units 9+10) build.

|                                          | Samples (ms)                           |   n |  Median |  Mean | Stdev |
| ---------------------------------------- | -------------------------------------- | --: | ------: | ----: | ----: |
| Wall-clock "reload → canvas interactive" | 196, 232, 223, 221, 194, 202, 220, 220 |   8 | **220** | 213.5 |  13.2 |
| `domContentLoadedEventEnd`               | 167, 155, 182, 136, 137, 157, 149, 144 |   8 |     152 | 153.4 |     — |

**All 8 of 8 runs failed the spec's own sanity assertion** (`expect(paint.length).toBeGreaterThan(0)`) — `first-paint`/`first-contentful-paint` came back as an **empty array** every single time. This is not a new problem I introduced: `unit10-zod-report.md` §8 item 3 already flagged it, found in **8 of 11** of their own after-condition runs, and explicitly left it unresolved ("I could not resolve whether the after build paints before the harness observes, or whether this is harness flakiness"). **I reproduced it independently, at an even higher rate (8/8 vs. their 8/11).** This is now a confirmed, reproducible property of the current build in this harness, not a one-off flake — I am stating that plainly rather than re-attempting to explain it away, matching the standard the rest of this report holds itself to.

**Consequence for this section's rigor**: every prior TTI comparison in this report (§8, §9, §10) used the paint-timing control as a corroborating, independent signal to judge whether a wall-clock delta was real or session drift. That control is **unavailable this round** — I do not have my own paint number to cross-check the wall-clock delta against. `domContentLoadedEventEnd` is the fallback signal Unit 10's own report used for exactly this reason (§6: _"the metric most directly tied to eager bundle size"_), and it is what I report alongside instead.

**Reading the numbers regardless**: wall-clock median (220ms) and mean (213.5ms) sit almost exactly on top of §8's clean post-Batch-2-revert baseline (215ms median / 225.3ms mean) and §10's Batch-4 numbers (218ms median / 219.2ms mean) — no evidence of a regression, consistent with Unit 10's own interleaved-A/B finding of "no measurable regression, −27ms median, not distinguishable from a true improvement." `domContentLoadedEventEnd` (152ms median) is **lower** than Unit 10's own reported after-condition DCL (170ms median) — independently reinforcing their claimed direction (less eager JS to fetch/parse/execute) rather than contradicting it, via a different sample set than theirs.

**Verdict: no regression, corroborated by an independent metric, but with materially less confidence than earlier sections in this report** because the primary corroborating instrument (paint timing) is confirmed broken for this build and I cannot say why. This is worth a follow-up outside this validation's scope — possibly related to `theme-extra.css`'s render-blocking `<link>` insertion changing when the browser's own paint-timing hooks fire, given both units in this section touch the pre-paint document path, though I have not confirmed that theory.

### 11.4 New test files

```bash
cd apps/ptah-electron-e2e
npx playwright test --config=playwright.config.ts \
  src/specs/chat/streaming-message-handlers.spec.ts \
  src/specs/theme/theme.spec.ts
```

`npx tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json` clean. `npx nx lint ptah-electron-e2e` — 0 errors, same 1 pre-existing warning in `fixtures.ts` (untouched). No application files modified — `git status --porcelain` shows only the pre-existing Units 9/10 diff plus these two new spec directories.

### 11.5 Full suite — completed

**125 tests total: 110 passed, 2 failed, 13 skipped.**

**Failure 1 — `specs/perf/startup-tti.spec.ts`.** Already found and explained in §11.3: the paint-timing sanity assertion fails on this build (8/8 in my own targeted runs, and consistent here). Not new information, not treated as a fresh failure — it's the same confirmed anomaly, now observed a 9th time.

**Failure 2 — `specs/rpc.spec.ts:209` "renderer receives a to-renderer push event matching the correlationId"** — `Error: worker process exited unexpectedly (code=3221226505, signal=null)`. `3221226505` is `0xC0000005`, a Windows access-violation exit code — the same crash signature `lifecycle.spec.ts:117` produced earlier in this investigation (§0), attributed there to launch-level instability under sustained single-machine load (by this point in the session, several hundred sequential Electron launches across six batches/units of validation). **Re-run in isolation, per the coordinator's own standing instruction**: passes cleanly, 11.0s. Same category, same resolution as every prior instance of this pattern in this report (`lifecycle.spec.ts:117`, `auto-updater.spec.ts:49` in §10.5) — not attributable to Units 9 or 10.

**No new, real failure.** Both failures are already-attributed patterns from earlier in this validation, re-confirmed rather than newly discovered. `editor.spec.ts:73` (TASK_2026_196) did not fail this run — worth noting only because it's the one failure mode consistently present in nearly every full run in this report; its absence here is not evidence it's fixed, just run-to-run variance in a pre-existing, already-attributed defect this task was never scoped to fix.
