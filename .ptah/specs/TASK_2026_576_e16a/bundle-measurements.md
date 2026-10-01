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
