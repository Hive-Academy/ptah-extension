## DevOps change — `TASK_2026_610`, batch A6

**Scope**: Production-webview eager-closure bundle gate.

**Files**:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\eager-closure-gate.js` — CommonJS static-import-closure gate, forbidden-input checks, base-growth check, and CLI.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\config\eager-closure-gate.spec.ts` — Four synthetic gate cases and a fail-closed real-build artifact case.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\package.json` — Adds `gate:eager-closure` for the webview stats artifact.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\batch-A6-report.md` — Batch A6 implementation and verification record.

**Surface observed**: The root `package.json` defines repository scripts; `apps/ptah-extension-webview/project.json` defines the production Angular build with `statsJson: true`; `apps/ptah-electron/jest.config.ts` defines the focused Electron Jest target. `CONTRIBUTING.md` requires quality gates and focused tests for new functionality. No CI/release workflow or publish trigger was changed.

**Triggers affected**: None. This adds the manually invoked local command `npm run gate:eager-closure` only.

**Verification**:

- `node --check scripts/eager-closure-gate.js` — passed.
- `git diff --check -- scripts/eager-closure-gate.js apps/ptah-electron/src/config/eager-closure-gate.spec.ts package.json` — passed.
- `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json` — failed before generating `stats.json`: the existing webview target could not resolve `node_modules/prismjs/themes/prism-tomorrow.css`, `node_modules/daisyui/dist/themes.css`, and `node_modules/prismjs/prism.js`.
- `npm run gate:eager-closure` — failed closed as designed because `dist/apps/ptah-extension-webview/stats.json` is absent after the failed build.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts` — 4 synthetic tests passed; 1 real-build gate test failed closed because that same `stats.json` is absent. The run also emitted existing ts-jest warnings when requiring CommonJS scripts without `allowJs`.
- `ptah_get_diagnostics` — unavailable after 45 seconds; its scoped TypeScript check continued in the background and returned no diagnostic result during this task.

**PR A baseline**: Not available. The required build did not produce `dist/apps/ptah-extension-webview/stats.json`, so the gate could not report the eager input count or initial chunk bytes. Once the documented build resolves its existing PrismJS/DaisyUI inputs, run `npm run gate:eager-closure`; its one-line output records both values.

**PR A baseline (recorded by the orchestrator, 2026-10-04 17:13)**: root cause of the build failure was the
worktree `node_modules` being a real folder holding only `.cache`, not the junction other worktrees use; Angular's
literal `node_modules/...` paths failed. Replaced with a junction to `D:\projects\ptah-extension\node_modules`. Then
`npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json` succeeded (Angular:
initial total 3.21 MB, over the 2.50 MB warning budget, pre-existing) and `npm run gate:eager-closure` passed:
`[eager-closure-gate] eager inputs: 714; initial chunk bytes: 2841104`.

**Rollback**: Revert the `gate:eager-closure` package script and remove the two A6 source/spec files.

**Secrets or variables required**: None. `PTAH_ALLOW_SKIP_UNBUILT=1` remains the existing local-only escape hatch for the real-build Jest suite; no value was written.

**Out-of-scope observations**: The webview build has unresolved PrismJS and DaisyUI module paths, preventing the planned artifact generation. No application code, dependency configuration, or build configuration outside A6 was changed.

**Deviation from plan**: None in implementation. The requested real-build baseline and a passing real-artifact test could not be obtained because the prerequisite production build failed for the out-of-scope unresolved module paths above.
