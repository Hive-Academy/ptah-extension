# TASK_2026_576_e16a — Bundle and TTI measurements

Tool: `node apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs [--report-only]`
(Nx: `npx nx run ptah-extension-webview:verify-eager-bundle -- --report-only`).
Eager closure = `polyfills.js` and `main.js` (module scripts of `dist/apps/ptah-extension-webview/browser/index.html`) plus every file they reach by static import. Dynamic `import()` is not followed.

## Batch 20 — baseline (base commit, before Batch 21)

Build: `NX_DAEMON=false npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache -- --report-only` (production configuration).

| Measure                    | Raw (B)   | Gzip (B) | Gzip (KB) |
| -------------------------- | --------- | -------- | --------- |
| `main.js`                  | 1,641,475 | 401,859  | 392.4     |
| Eager closure (12 files)   | 3,171,771 | 817,705  | 798.5     |

Assertion mode on the base build: exit 1, as expected (git-ui is eager). Offenders: `main.js` contains `ptah-git-` and `ptah-diff-view`.

Note: the research baseline was 383.9 KB gz for `main.js` (research-report.md evidence row 3). The measured base is 392.4 KB gz, which is the figure later batches must not exceed (`main.js` gz <= 401,859 B).

### TTI baseline (`apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`)

Run directly from `apps/ptah-electron-e2e`: `npx playwright test --config=playwright.config.ts specs/perf/startup-tti.spec.ts --reporter=list`. The first run (via `nx run ptah-electron-e2e:e2e`) failed and was not recorded; two clean passes followed.

| Run                | first-paint (ms) | first-contentful-paint (ms) | second boot reload -> canvas interactive (ms) |
| ------------------ | ---------------- | --------------------------- | --------------------------------------------- |
| Pass 1             | 184              | 536                         | 12,792                                        |
| Pass 2 (baseline)  | 276              | 608                         | **14,557**                                    |

TTI baseline (second boot, pass 2): 14,557 ms. The renderer under test is the one copied by `ptah-electron:copy-renderer-dev`, not the production bundle measured above. The spec records numbers only; it asserts no budget, and the run-to-run spread is about 14%.

## Batch 21 — `@ptah-extension/git-ui/services` narrow entry

Build: `NX_DAEMON=false npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` (assert mode, production configuration). Exit 0: "no forbidden markers in the eager closure".

| Measure                    | Raw (B)   | Gzip (B) | Gzip (KB) | Delta gzip vs Batch 20 (B) |
| -------------------------- | --------- | -------- | --------- | -------------------------- |
| `main.js`                  | 1,480,803 | 362,218  | 353.7     | -39,641                    |
| Eager closure (12 files)   | 3,011,139 | 778,076  | 759.8     | -39,629                    |

`main.js` gz 362,218 B <= 401,859 B budget. The Angular build still warns that the initial bundle (3.33 MB) exceeds the 2.50 MB `budgets` maximum; that is a warning, not an error.

## Batch 23 — `@ptah-extension/git-ui/diff-renderer` secondary entry and `TextDiffViewComponent`

Eager bundle: `NX_DAEMON=false npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` (assert mode, production configuration). Exit 0: "no forbidden markers in the eager closure".

| Measure                    | Raw (B)   | Gzip (B) | Gzip (KB) | Delta gzip vs Batch 21 (B) |
| -------------------------- | --------- | -------- | --------- | -------------------------- |
| `main.js`                  | 1,480,803 | 362,218  | 353.7     | 0                          |
| Eager closure (12 files)   | 3,011,139 | 778,076  | 759.8     | 0                          |

`main.js` gz 362,218 B <= 401,859 B budget. Pierre is NOT in the eager closure.

### Lazy chunk measurement (throwaway build)

Method: esbuild browser ESM bundle of `libs/frontend/git-ui/src/diff-renderer.ts` with code splitting, minification, target `es2022`, and externalized `@angular/*` and `@ptah-extension/shared`. Throwaway artifacts built in `D:/tmp/batch23-out`.

| Chunk / Scenario                             | Raw (B) | Gzip (B) | Gzip (KB) | Budget limit (KB gz) | Status |
| -------------------------------------------- | ------- | -------- | --------- | -------------------- | ------ |
| `diff-renderer.js` (entry chunk)             | 472,887 | 136,984  | 133.8     | —                    | —      |
| Entry closure (`diff-renderer.js` + helper)  | 473,172 | 137,212  | 134.0     | —                    | —      |
| `typescript` language grammar chunk          | 181,106 | 16,067   | 15.7      | —                    | —      |
| **First realistic diff** (closure + TS lang) | 654,278 | 153,279  | **149.7** | **≤ 217.0**          | **PASS** |

The first realistic diff loads ~149.7 KB gz (153,279 B), well within the ≤ 217 KB gz bar (research baseline 189 KB × 1.15 ≈ 217 KB). Pierre and its grammars are completely isolated in lazy chunks.


## Batch 60 - A9 re-measure (review canvas, Electron e2e)

Spec: `apps/ptah-electron-e2e/src/specs/git/review-canvas-large.spec.ts` (single spec, own user-data dir; run with
`npx playwright test --config=playwright.config.ts src/specs/git/review-canvas-large.spec.ts`).

- Fixture: 200 changed files (`src/pkgNN/fileNNN.ts`, 120 lines each, lines 11-60 rewritten) = 10,000 modified lines
  (+10,000 / -10,000), served through a path-keyed mocked `git:diffFile`; split layout; production renderer build
  from d9702a514 with the Pierre worker pool wired. Real list height after measuring: ~266,000-271,000 px.
- Sweep: in-page requestAnimationFrame loop, time-based `scrollTop` at 3,000 px/s from top to bottom (~90 s);
  fps = frames / elapsed from rAF timestamps; long tasks from a `PerformanceObserver('longtask')`. An idle rAF
  baseline is taken first (`idleFps`) to prove the window was not throttled.
- Budgets: >= 50 fps, no long task > 200 ms (Requirement 6.2).

| Run | Sweep speed | idle fps | Sweep fps | Worst frame | Long tasks (>50 ms) | Max long task | Result |
| --- | ----------- | -------- | --------- | ----------- | ------------------- | ------------- | ------ |
| 1 | 48 px/frame (~2,900 px/s), cut at 1,800 frames | n/a | 47.1 | 1,059.6 ms | 38 | 858 ms | fps FAIL, long task FAIL |
| 2 | 20 px/frame (~1,200 px/s), cut at 1,800 frames | n/a | 50.0 | 183.4 ms | 77 | 104 ms | borderline |
| 3 | 1,800 px/s | 59.5 | 48.1 | 183.3 ms | 269 | 117 ms | fps FAIL, long task pass |
| 4 | 3,000 px/s | 59.5 | 49.7 | 149.9 ms | 62 | 124 ms | fps FAIL (0.3 short), long task pass |
| 5 | 3,000 px/s (background throttling off) | 60.0 | 41.4 | 1,016.4 ms | 175 | 242 ms | fps FAIL, long task FAIL |
| (discarded) | 3,000 px/s | 1.0 | 1.0 | - | - | - | window occluded, rAF throttled to 1 fps; the spec now disables background throttling and asserts idle fps > 30 |

Verdict: NOT proven on this machine. Typical sweep is 48-50 fps with the longest task 104-124 ms (inside the
200 ms budget) but two of the five valid runs show frames/tasks far beyond budget (858 ms and 242 ms), so the
200 ms ceiling is not reliably held either. The A9 spike's 54 fps / 0 long tasks (headless Chromium 1280x800,
unloaded) was not reproduced.

Machine note: Windows 11 laptop with the user's own Ptah desktop app running alongside, and other agents running
builds and unit tests in the same period; CPU contention is the likely cause of the run-to-run spread (41-50 fps,
242 ms vs 124 ms max task) and the numbers above are an upper bound on cost, not a clean-room figure. Re-run on an
idle machine before treating the miss as a product regression; the spec stays red until then (thresholds are
unchanged).

### After d2d1928f5 (canvas scroll restore), same spec, thresholds unchanged

Load note: the user's Ptah desktop app was running alongside; other agents were active on the machine.

| Run | Sweep speed | idle fps | Sweep fps | Worst frame | Long tasks (>50 ms) | Max long task | Result |
| --- | ----------- | -------- | --------- | ----------- | ------------------- | ------------- | ------ |
| 6 | 3,000 px/s | 60.0 | 51.3 | 116.5 ms | 25 | 78 ms | PASS |
| 7 | 3,000 px/s | 60.0 | 51.5 | 100.0 ms | 20 | 84 ms | PASS |

Both runs meet >= 50 fps and no long task > 200 ms (full 271,000 px sweep, 200 files / 10,000 modified lines).

Related single-file e2e numbers from the same batch: `perf-m1-diff-redisplay.spec.ts` (Changes -> Task -> Changes,
500-line file): median 129.7 ms, max 191.7 ms over 10 round trips.
