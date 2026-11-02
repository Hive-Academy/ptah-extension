# B3b onboarding visual capture spec

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-generate-visual.e2e.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-generate.fixtures.ts`
- `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/.ptah/specs/TASK_2026_ONBOARDING/b3b-capture-report.md`

**Exact Playwright grep name:** `onboarding-generate-visual`

All names below are captured at 1280×800 and 464×800 (`narrow-` prefix), in `ptah-glass`, `ptah-glass-light`, `anubis`, and `anubis-light`. The spec uses the B3a capture helper and writes PNG and axe JSON files to `.ptah/specs/TASK_2026_ONBOARDING/screenshots/generate/`.

| Capture view | State |
| --- | --- |
| `generate-running` | A3 running, checkpoint agent rows and progress meter |
| `generate-completed` | A3 completed, three agent cards, file names, and outcome facts |
| `generate-failed` | A3 failed with Retry |
| `generate-mismatch` | A3 stale run recovery panel |
| `generate-lookup-exhausted` | A3 exhausted state lookup with Retry |
| `guidance-idle` | A4 standalone guidance, idle with Start guidance |
| `guidance-running` | A4 analyze guidance, running with detected stack |
| `guidance-completed` | A4 completed after a terminal push, four summary rows |
| `guidance-lookup-error` | A4 standalone initial lookup error with Retry |
| `guidance-owner-conflict` | A4 standalone blocked start with owner conflict banner |
| `done-facts` | A5 terminal facts and four next step links |

## Verification and limits

- Scoped `npm run verify -- -t lint,typecheck -p @ptah-extension/webview-e2e-harness` was started, but the machine-wide verify lock stayed full (two slots occupied; this job at queue position 2). It was interrupted while waiting and left the queue cleanly. **NX summary line: none; Nx never started.**
- TypeScript `transpileModule` reported zero syntax errors for both new files. Ptah scoped diagnostics were unavailable because their compiler check exceeded its 45-second response window. The spec was not executed, as requested; screenshots and visual inspection remain for the coordinator's capture run.
- A3's `generate-countdown` is not asserted or captured. That panel is shown only when `GenerationHandoffStore.schedule()` runs after an accepted agent run launched with the `analysis-result-continue` origin. Restoring a completed run through the A3 RPC fixture does not create that in-memory handoff. This requirement needs an in-session combined-flow capture.
- The requested `angular-frontend-patterns` skill could not be loaded: no invokable skill mechanism was exposed to this lane, and Ptah skill search returned no matching installed skill. The work is limited to Playwright harness files.
