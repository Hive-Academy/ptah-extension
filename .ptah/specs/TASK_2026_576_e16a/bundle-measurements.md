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

## Batch 67 — end of task

Measured on branch `feat/task-2026-576-cutover` after Batch 66. Same methods as Batch 20 unless noted.

### Eager bundle (production build)

Build: `NX_DAEMON=false npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` (assert mode). Exit 0: "no forbidden markers in the eager closure".

| Measure                    | Raw (B)   | Gzip (B) | Gzip (KB) | Batch 20 baseline gzip (B) | Delta (B) | Result |
| -------------------------- | --------- | -------- | --------- | -------------------------- | --------- | ------ |
| `main.js`                  | 1,374,724 | 338,714  | 330.8     | 401,859                    | -63,145   | PASS (<= baseline; matches the guard's 338,714) |
| Eager closure (24 files)   | 3,002,681 | 782,442  | 764.1     | 817,705                    | -35,263   | PASS (informational; file count grew 12 -> 24 as code was split into more eager chunks, total gzip still lower) |

The Angular `budgets` warning for the initial bundle size remains (warning only).

### TTI, second boot (`apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`)

Command (from `apps/ptah-electron-e2e`, single spec): `npx playwright test --config=playwright.config.ts specs/perf/startup-tti.spec.ts --reporter=list --workers=1`.

| Run     | first-paint (ms) | first-contentful-paint (ms) | second boot reload -> canvas interactive (ms) |
| ------- | ---------------- | --------------------------- | --------------------------------------------- |
| Run 1   | 376              | 376                         | 690                                           |
| Run 2   | 116              | 400                         | 706                                           |
| Run 3   | 164              | 412                         | 977                                           |
| Batch 20 baseline | 276    | 608                         | 14,557                                        |

Second boot 690-977 ms vs baseline 14,557 ms: PASS (<= baseline). Caveat: the spec ran against whatever renderer was in `dist/apps/ptah-electron/renderer` (built 22:05 by another agent in this session; `main.js` 722 KB, i.e. the dev `copy-renderer-dev` output, the same kind of renderer Batch 20 used, not the production bundle). The ~20x gap versus the baseline is far larger than the baseline's ~14% run spread and is most likely dominated by the baseline having been taken under heavier machine load/older renderer state; treat the result as "not slower", not as a 20x speedup claim. The spec asserts no budget.

### VSIX (webview payload)

Method: production webview build above, then `node scripts/copy-webview.js` (the `project.json` copy step; prints "Skipped 126 Electron-only chunks for the VSIX"). A full extension `nx build`/`package` was not run (it would rebuild/clean the shared renderer dist during another agent's e2e run). Instead a real `.vsix` was packed offline with `npx --no-install @vscode/vsce package --allow-missing-repository --allow-star-activation --no-dependencies` from a staging dir `D:/tmp/b67-vsix` containing the copied `webview/`, the source `package.json` (icon field removed, icon asset is not in source), `.vscodeignore`, `assets/`, and a stub `main.mjs`. The numbers below are therefore the webview's contribution plus a stub host, not the full shipped `.vsix` size.

| Check                                              | Value                          | Result |
| -------------------------------------------------- | ------------------------------ | ------ |
| `.vsix` (stub host + webview)                      | 5,367,207 B (5.12 MB), 478 files; unpacked 19,008,847 B | recorded |
| Webview copy (`dist/apps/ptah-extension-vscode/webview`) | 18,982,434 B, 471 files in `browser/` (591 built chunks - 126 Electron-only) | recorded |
| `@codemirror` / CodeMirror / Lezer files or content in copy and in `unzip -l` | 0 | PASS |
| `assets/monaco` / any `monaco` path in copy and `.vsix` | 0                            | PASS |
| Pierre chunks present                              | 319 chunks (10,833,948 B raw) with `@pierre` inputs, all present in the copy | PASS |

### R12 — Skills diff drawer in VS Code

- The VS Code e2e runner (`apps/ptah-extension-vscode-e2e`, suites `index.cjs` and `review-commands.cjs`) drives extension-host commands (multi-diff, `ptah-git-head:`), not the webview; there is no e2e that opens the Skills clone diff drawer, and the VS Code binary download was not attempted. No e2e evidence for R12.
- Unit evidence: `NX_DAEMON=false npx nx test skill-synthesis-ui --testFile=lazy-diff-view --skip-nx-cache`: 1 suite, 6 passed, 0 failed (`lazy-diff-view.component.spec.ts`).
- Chunk trace: `LazyDiffViewComponent` does `await import('@ptah-extension/git-ui/diff-renderer')`. In `stats.json` the diff-renderer/lazy-diff inputs land in `chunk-Bjcc0XY0.js` and `chunk-CbXxrUTr2.js`; both are in the VSIX copy and in the packed `.vsix`. Every relative `./chunk-*.js` import (static and dynamic) in all 471 copied JS files resolves to a file in the copy (0 unresolved). The 127 build outputs absent from the copy (126 Electron-only chunks + the inlined `lazy-diff-view.component.css`) are all outside the diff-renderer's import closure.
- Verdict R12: PASS on unit + packaging evidence; NOT proven by a live VS Code run (no applicable e2e exists).

### Notes and caveats

- Another agent rebuilt `dist/apps/ptah-extension-webview` (dev config, no `stats.json`) between my first build and the copy, so the production build was run twice; both gave identical sizes.
- Batch 66 noted a pre-existing missing static import `chunk-5JJ6SBZ6.js`; this build has no unresolved relative imports in the copy.
