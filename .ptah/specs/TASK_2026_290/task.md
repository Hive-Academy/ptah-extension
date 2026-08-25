---
id: TASK_2026_290
status: done
type: bugfix
title: >-
  Setup wizard lost a finished workspace analysis whenever the user navigated
  away mid-run
description: >-
  The app shell renders one view at a time through `@switch`
  (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:81`),
  so leaving Setup destroyed `ScanProgressComponent` mid-analysis. That
  component owned the run, and every `await` in its `startAnalysis()` was
  guarded by an `isDestroyed` flag — so when `wizard:deep-analyze` resolved
  after the view was gone, the guard returned before
  `wizardState.setMultiPhaseResult()`. The backend had completed the whole
  agentic analysis (up to a 61-minute RPC budget) and nothing stored it:
  `setMultiPhaseResult` had exactly one production caller, that line. Returning
  to Setup re-entered `ngOnInit`, found `multiPhaseResult()` still null, and
  re-ran the full analysis from zero. The root-scoped
  `SetupWizardStateService` was never the problem — the result simply never
  reached it. Fixed by moving the run into a new root-scoped
  `WizardAnalysisRunner`: `ensureStarted()` is idempotent, a remounting view
  joins the in-flight promise instead of forking a second run, and staleness is
  decided by a run token bumped on cancel/reset rather than by component
  lifetime. `harness-builder` was checked and already followed this pattern.
---

# Wizard analysis run outlives the view that shows it

Machine-owned metadata carrier. Prose lives in `./context.md`.
