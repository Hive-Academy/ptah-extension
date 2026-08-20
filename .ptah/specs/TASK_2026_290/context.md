# Context

## The report

> "when i open any workflow from our setup and move away from the page
> (specially the workspace analysis i lose everything?) why is that?"

Reported against the Setup Hub. Open Workspace Analysis, switch to any other
top-level tab, come back — the wizard is at Welcome again and the analysis
starts over. The Setup Hub card still reads `0% Complete / Setup required`.

## Why it happened

Three facts had to line up.

1. **The shell destroys the view.** `AppShellComponent` renders exactly one
   view via `@switch`
   (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:81`).
   There is no keep-alive. Navigation is signal-based — the webview has no
   Angular Router — so leaving Setup unmounts the whole wizard subtree.

2. **The component owned the run.** `ScanProgressComponent.startAnalysis()`
   called `wizardRpc.deepAnalyze()` and `recommendAgents()` directly, and
   guarded each continuation with an `isDestroyed` flag set from
   `destroyRef.onDestroy()`. That guard is right for writing a _component_
   signal and wrong for writing a _service_ signal — but it was applied to
   both.

3. **Nothing else wrote the result.** `setMultiPhaseResult` had one production
   caller: the line immediately after the guard. The push-event path
   (`WizardMessageDispatcher`) carries phase progress and streaming transcript,
   never the final `MultiPhaseAnalysisResponse`.

So: analysis runs (`DEEP_ANALYSIS_MS: 3_660_000` — the user can be away a long
time and still be inside the budget), user switches tabs, RPC resolves, guard
returns, result is garbage-collected. `SetupWizardStateService` is
`providedIn: 'root'` and survived the whole time — it just had nothing in it.
Re-entering Setup re-ran `ngOnInit` → `startAnalysis()` → cache miss → full
re-analysis.

The user's phrasing ("any workflow") was checked against the neighbours:
`harness-builder` already owns its run in root services
(`harness-workflow.service.ts:93`, carrying an explicit "never from a
component's `ngOnDestroy`" comment) and streams through a registered push
handler, so AI Team Builder and New Project already survived navigation. The
setup wizard was the single outlier. A repo-wide grep for `isDestroyed` in
`libs/frontend` now returns only `ui/.../floating-ui.service.ts`, where the
flag is correct (don't reposition a popover after teardown).

## What was done

**New** `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts`
(`providedIn: 'root'`):

- `ensureStarted()` — idempotent. Holds the in-flight promise, so a view that
  remounts during a run joins it; a view that mounts after one completes reads
  the stored result. Never forks a second `deepAnalyze()`.
- Result writes go to `SetupWizardStateService` unconditionally.
- Staleness is a **run token**, incremented by `cancel()` and `reset()`. A run
  whose token no longer matches writes nothing. Component teardown is not a
  staleness signal and never was — that conflation was the bug.
- Owns `isRunning` / `statusText` / `errorMessage` / `isCanceling`, so the
  progress text survives navigation along with the result.

**Changed** `scan-progress.component.ts` — deleted `startAnalysis()`,
`DestroyRef`, `isDestroyed` and the `WizardRpcService` injection. `ngOnInit`
calls `ensureStarted()`; the buttons call `retry()` / `cancel()` / `reset()`;
the template reads runner signals under the same protected names, so no
template edits were needed.

**Tests** — `wizard-analysis-runner.service.spec.ts`, 8 cases. The two that
pin the regression: a result resolving _after_ the view is gone still reaches
the state service, and a result resolving after `cancel()` does not.

## Verification

- `nx test @ptah-extension/setup-wizard` — 11 suites, 279 tests, green. The
  pre-existing `scan-progress.component.spec.ts` passes unmodified; the runner
  picks up the same `SetupWizardStateService` / `WizardRpcService` mocks
  through DI.
- `nx run-many -t typecheck lint -p @ptah-extension/setup-wizard` — clean
  (two pre-existing warnings in files this task did not touch).

## The rule worth keeping

Long-running work in a webview feature belongs to a root-scoped service, not to
the component that displays it. The shell can destroy any view at any moment,
so a component that owns an `await` chain will eventually be asked to throw
away a finished, expensive result. Reject stale work by an explicit token tied
to a user action (cancel, restart), never by component lifetime.

Recorded in `libs/frontend/setup-wizard/CLAUDE.md` under Guidelines.
