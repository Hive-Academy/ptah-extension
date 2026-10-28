# CI bundle budget fix 3 — `TASK_2026_701_9e4b`

## Verdict

Root cause found and fixed. The app imported `@ptah-extension/setup-wizard` from eager code
through the wide barrel, and that barrel re-exports every component that rounds 1 and 2 had put
behind `@defer`. With code splitting, esbuild keeps a module in the initial bundle when an
initial module statically imports it, even through an unused re-export. That cancelled the
deferral: 208,355 B of minified setup-wizard code stayed initial.

The app now imports a narrow `@ptah-extension/setup-wizard/app` entry instead. Estimated new
initial total: **about 3.82 MB**, against a 4.00 MB budget and a 3.98 MB target. This is
estimated from the metafile; there was no third build, so CI will confirm.

## Builds run (two in total: D36 and D37)

1. D36: `nx run ptah-extension-webview:build --stats-json --skip-nx-cache`, under the verify lock.
   It failed on the budget error (`Budget 4.00 MB was not met by 30.30 kB with a total of
   4.03 MB`). A failed Angular build writes no output, so there was no `stats.json`.
2. D37: a production build with the budget removed in memory only.
   `T\tmp\stats-build.mjs` reads `apps/ptah-extension-webview/project.json`, deletes
   `configurations.production.budgets` from that in-memory copy, and runs
   `@angular/build:application` through `@angular-devkit/architect` with a synthesized
   in-memory workspace. Output went to `%LOCALAPPDATA%\Temp\ptah-wv-stats`, outside the source
   tree. No tracked file was edited. Command:
   `node scripts/verify.mjs --exec --task webview-stats-build -- node T/tmp/stats-build.mjs <tmp>`.
   Result: `BUILD success=true`, with exactly the same sizes as the Nx/CI build
   (`main.js` 601.06 kB, initial total 4.03 MB).

## Measured initial bundle (D37 metafile)

The initial bundle is `main.js` plus everything it imports statically:

- JS: 3,537,256 B in total.
- Plus `styles.css` 408.96 kB, `scripts.js` 48.20 kB and `polyfills.js` 35.88 kB.
- Sum: about 4,030,300 B, matching the reported 4.03 MB (30.30 kB over 4,000,000).

Of that, `libs/frontend/setup-wizard` accounts for 343,059 B.

## Eager modules that are meant to be deferred (top 15, bytes in initial output)

Every row has the same pair of edges. One is `dynamic-import` from `wizard-view.component.ts`
(steps) or `generation-agent-sidebar.component.ts` (list and next steps), which shows the
`@defer` compiled correctly. The other is an `import-statement` from
`libs/frontend/setup-wizard/src/index.ts`, and the index itself is imported by
`apps/ptah-extension-webview/src/app/app.routes.ts` and `app.config.ts`. I confirmed this with
`analyze-meta.mjs why` for `agent-selection`, `scan-progress`, `agent-selection-list` and
`completion`.

| Bytes | Module (`libs/frontend/setup-wizard/src/lib/...`) | Kept eager by |
| --- | --- | --- |
| 30,601 | components/agent-selection.component.ts | index.ts re-export |
| 15,775 | components/scan-progress.component.ts | index.ts re-export |
| 14,070 | components/generation-progress.component.ts | index.ts re-export |
| 13,722 | components/agent-selection-list.component.ts | index.ts re-export |
| 13,606 | components/agent-preview-dialog.component.ts | index.ts re-export |
| 12,135 | components/completion.component.ts | index.ts re-export |
| 11,090 | components/analysis-results.component.ts | index.ts re-export |
| 9,626 | components/community-packs-panel.component.ts | index.ts re-export |
| 9,088 | components/prompt-enhancement.component.ts | index.ts re-export |
| 6,860 | components/preview-decisions/target-root-choice.component.ts | agent-preview-dialog (above) |
| 6,599 | components/agent-next-steps.component.ts | index.ts re-export |
| 5,983 | components/analysis-stats-dashboard.component.ts | index.ts re-export |
| 5,331 | components/preview-decisions/keep-replace-control.component.ts | preview-decisions rows (above) |
| 5,240 | services/wizard-analysis-runner.service.ts | scan/analysis steps (above) |
| 4,885 | components/analysis-transcript.component.ts | index.ts re-export |

Another 17 modules move with them, 32 in total. Among them are `preview-decisions.state`,
`generation-preview.store`, `pack-install.store`, `pack-install-result`, `safe-failure-copy`,
`outcome-rows`, `tool-output-formatter.service` and `error-handling`. Most of this branch's
eager growth is in this set (agent-selection, the list, the preview dialog, community packs,
preview-decisions, the two stores).

The `"sideEffects": false` theory was not the cause. The modules were not kept because esbuild
judged them side-effectful. They were kept by the static re-export edge from an initial module.
A narrow entry removes that edge outright. Adding `sideEffects` would not have helped once a
module is also a dynamic-import target.

## Changes

1. `libs/frontend/setup-wizard/src/app.ts:19-25` (new): the narrow composition-root entry. It
   re-exports only `WizardViewComponent`, `GenerationWorkflowShellComponent`,
   `SetupWizardStateService`, `SetupGenerationOpenHandler`, `GenerationRunEventAdapter`,
   `provideWizardInternalState` and `provideSetupWizardFocusRouter`. None of these sits inside
   `@defer`.
2. `tsconfig.base.json` (after the `@ptah-extension/setup-wizard` path): new path
   `@ptah-extension/setup-wizard/app` → `./libs/frontend/setup-wizard/src/app.ts`. This is the
   same pattern as `marketplace/services` and `harness-builder/services`.
3. `apps/ptah-extension-webview/src/app/app.config.ts:90-101`: the setup-wizard import now comes
   from `/app`. The old comment said "a narrow barrel would move zero bytes". That was true
   before the steps were deferred and is no longer true, so I replaced it with the reason.
4. `apps/ptah-extension-webview/src/app/app.routes.ts:12`: import from
   `@ptah-extension/setup-wizard/app`. The routing is unchanged: still a static `component:`
   and not lazy, per D34.
5. `apps/ptah-extension-webview/src/app/setup-wizard-entry.spec.ts` (new): pins that
   `app.config.ts` and `app.routes.ts` import setup-wizard only through `/app`, and that `app.ts`
   re-exports only the 7 allowed files. Lint can't see this boundary.

The wide barrel `libs/frontend/setup-wizard/src/index.ts` is unchanged. It still exports
`AgentNextStepsComponent` and `CommunityPacksPanelComponent` (D34). Specs and the wide-barrel
import in `unit5-message-routing.spec.ts` keep working. No D34 file, selector, input or output
changed, and there is no behavior change. The `@defer` wrappers from f2a312631 and 9e25520c2
stay: this fix is what makes them pay off.

## Bytes moved and estimated total

`T\tmp\simulate.mjs` recomputes the static closure from `main.ts` over the metafile's
`import-statement` edges, with the barrel's edges replaced by the 7 narrow-entry modules.

- Moved out of the initial closure: **208,355 B** across 32 modules. All of them are in
  `libs/frontend/setup-wizard`, and all of their bytes are in initial outputs today.
- No other module leaves, because chat, core and the rest stay reachable from other eager code.
- Estimated new initial total: 4,030,300 − 208,355 ≈ **3.82 MB**, about 178 kB under the
  budget.
- Caveat: chunk boundaries and cross-chunk glue shift slightly, so expect a few kB either way.

## Verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`: 6 tasks, 4
  succeeded, 2 failed.
  - `ptah-extension-webview:lint` failed, which is the accepted pre-existing failure: one
    error, `app.routes.ts:224` circular dependency with `@ptah-extension/command-center`, not
    in my lines.
  - `ptah-extension-webview:test` had 1 failure in the new spec: it matched the usage example
    inside the `app.ts` doc comment. I fixed it to strip comments before matching.
  - setup-wizard lint, test and typecheck passed, and webview typecheck passed.
- Rerun of the fixed spec: `npm run verify -- -t test -p ptah-extension-webview --
  --testPathPatterns=setup-wizard-entry` gave `1 task: 1 succeeded`, `Tests: 3 passed, 3 total`.
  The other 663 webview tests passed in the full run.
- No third build was run. The bundle total is an estimate until CI.

## Changed files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\setup-wizard\src\app.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-extension-webview\src\app\setup-wizard-entry.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\tsconfig.base.json`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-extension-webview\src\app\app.config.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\apps\ptah-extension-webview\src\app\app.routes.ts`

The scripts in `T\tmp\` (kept, all small): `analyze-meta.mjs`, `simulate.mjs`,
`stats-build.mjs`, `sw-graph.mjs`. The build output and its 4.5 MB metafile are in
`%LOCALAPPDATA%\Temp\ptah-wv-stats`, outside the source tree. I left them as evidence; delete
that folder at will.

## Decisions

- **Narrow entry vs editing the wide barrel.**
  - Options: (a) drop the deferred components from `index.ts`; (b) add an `/app` entry.
  - Evidence: D34 requires `AgentNextStepsComponent` and `CommunityPacksPanelComponent` to stay
    in `index.ts`, and the repo already has narrow-entry precedents (`marketplace/services`,
    `harness-builder/services`, `mcp-apps-page/focus`).
  - Chose (b). Reversible.
- **No eslint `checkDynamicDependenciesExceptions` entry.** setup-wizard is imported statically
  everywhere and lazily nowhere, so the rule doesn't apply. Lint confirmed no new error.
