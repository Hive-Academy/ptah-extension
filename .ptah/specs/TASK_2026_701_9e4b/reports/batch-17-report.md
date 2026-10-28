# Frontend implementation — `TASK_2026_701_9e4b`, batch 17

**Tasks completed**: 17.1 Outcome summary (C9), stale-Library notice (C10), grade expectation (C11),
plus the Batch 12 carry-over (`wizard-analysis-runner.service.ts` `toProgressItem`).

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/`.

- CREATED `components/completion/outcome-summary.component.ts` (+ `.spec.ts`). C9: five counters derived
  from the rows (so the counts always equal the per-file list; Failed is hidden at 0 only when
  `compact`), a per-file list in `<details open>` with a note for each outcome, a per-file failure
  callout, the opened-folder notice for each host, and the diverged callout with "Open the Library".
  Also exports `libraryReachable(isElectron, target)`.
- CREATED `components/completion/library-stale-notice.component.ts` (+ spec). C10: renders only for
  `libraryPass === 'failed'`, using the wizard copy from design-spec section 5.
- CREATED `components/completion/grade-expectation.component.ts` (+ spec). C11: shows the "About grades"
  callout when at least one agent was written, and "Nothing new was written / All N agents were kept or
  already current..." when every row is kept, unchanged or changed-since-preview. Otherwise it renders
  nothing.
- MODIFIED `components/completion.component.ts` (+ spec). Removed the local `AgentOutcomeTile` type (the
  Task 12.1 bridge), the agent tile grid and `formatAgentName`. Rows now come from
  `completionData().agents` (the shared `FileOutcome`) and render through C9. C10 and C11 are gated on
  `libraryReachable(isElectron, result?.target)`. "Open the Library" calls
  `AppStateManager.openSkillsDivergedClones()`. The rejected-sections badge, the output directory, the
  errors list, the header states and the quick start guide are unchanged.
- MODIFIED `components/agent-next-steps.component.ts` (+ spec). At sidebar width it shows C9 (compact),
  C11 and C10 for the bound run's verified `result`. A row's `rejected` status maps to `failed`. A
  `skipped` row has no file outcome and is not listed.
- MODIFIED `services/wizard-analysis-runner.service.ts` (+ spec). `toProgressItem` now treats `kept`
  and `changed-since-preview` as settled (complete), like `written`/`unchanged`. `pending`, `running`
  and `failed` stay pending.
- MODIFIED (D30, approved by the coordinator) `services/setup-wizard-state.types.ts`: added
  `CompletionData.result?: SetupGenerationResultFacts`.
- MODIFIED (D30) `services/setup-wizard/wizard-phase-generation.ts` (+ spec): `handleGenerationComplete`
  copies `payload.result` when it is present. The spec has two new cases: result kept, and result
  absent.

## Stack observed

- Angular standalone, OnPush, `input()`/`output()`, signals and `computed()`. Followed the siblings
  `components/preview-decisions/model-origin-note.component.ts` and the existing
  `completion.component.ts`.
- State is read from the existing root stores (`SetupWizardStateService.completionData`,
  `GenerationWorkflowStore.run`).
- Styling uses Tailwind/DaisyUI classes already in the lib (`alert-*`, `badge-*`, `btn-*`).
- Host detection uses `VSCodeService.isElectron`, as in `agent-selection-list.component.ts:207`.
- Library navigation uses `AppStateManager.openSkillsDivergedClones()` (`libs/frontend/core/src/lib/services/app-state.service.ts:1082`).

## Design fidelity

Built against design-spec 3.9, the section 5 copy table and `prototype/completion.html` sections A–D:

- Outcome labels: "Written", "Kept (your file)", "Already current", "Changed since preview (kept)",
  "Failed".
- Exact copy for the grade sentence, the all-kept statement, the wizard stale notice and the
  opened-folder notice (Electron and VS Code variants).
- Diverged naming appears only for written rows and only in Electron for the harness-root target.

Deviations:

1. Each row's note cannot say "Ptah could not read this file" (the planner example), because
   `GenerationAgentOutcome` carries no reason for a kept file. Every kept row gets the generic note
   "Kept: not regenerated (no content was generated for it)."
2. There is no per-file "Retry" button. Neither completion surface has a retry path. Wizard-view
   completion has no retry API, and the sidebar's retry lives in `agent-generation-progress` (not in
   this batch), which already offers it for checkpoint agents.
3. The prototype's extra primary "Open the Library" next to Done was not added. "Open the Library"
   appears only inside the diverged callout, which matches the spec text: "diverged naming and 'Open
   the Library' (Electron, only if any)".
4. The opened-folder notice in the sidebar names `target.openedFolder`, not the `.claude/agents`
   subfolder, because the sidebar result has no output directory field.

## States covered

- Mixed outcomes, all kept or current, failed write (an `role="alert"` callout with the reason),
  stale Library (`role="alert"`), diverged (`role="status"` plus a button), opened-folder (Electron and
  VS Code), VS Code (no Library, grade or stale copy), and no result facts (no Library copy).
- The counter list uses `role="list"`/`listitem` with an `aria-label`. All buttons are native
  `<button type="button">` with text. The per-file list is a native `<details open>`.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | --- | --- | --- | --- |
| B17-1 | `agent-next-steps` reads `GenerationWorkflowStore.run().result` itself rather than getting a new input | new input (needs `generation-agent-sidebar.component.ts`, not in the batch); inject the root store | The only host is `generation-agent-sidebar.component.ts:173`, outside the file list; the store is `providedIn: 'root'` and already holds the verified result | yes |
| B17-2 | Counters are derived from the rows, not from `writtenCount`/`counts` | payload counts; rows | Quality requirement "counts equal per-file rows"; the backend `buildCompletePayload` derives the counts from the same rows | yes |
| B17-3 | An unknown target (no `result`, or an older host) shows no Library, grade or stale copy | assume harness-root; hide | Coordinator instruction (D30): keep the safe default when `result` is absent | yes |
| B17-4 | A `rejected` result row counts as Failed; a `skipped` row is not listed in the five outcomes | list as-is; map | `wizard-generation-binding.ts:38-45`: `rejected` is a failed agent whose sections were rejected; `skipped` is pending/running and has no file outcome | yes |
| D30 | (coordinator) add `CompletionData.result` and its mapping | A/B | Coordinator answer | yes |

## Verification

Only this batch's specs were run, one foreground run with output filtered (Batch 15 is editing the same
lib in parallel):

```
npm run verify -- -t test -p @ptah-extension/setup-wizard -- --skip-nx-cache --output-style=static \
  --testPathPatterns=outcome-summary --testPathPatterns=library-stale-notice \
  --testPathPatterns=grade-expectation --testPathPatterns=completion.component \
  --testPathPatterns=agent-next-steps --testPathPatterns=wizard-analysis-runner.service \
  --testPathPatterns=wizard-phase-generation
```

Result: `Running target test for project @ptah-extension/setup-wizard`, `Test Suites: 7 passed, 7
total`, `Tests: 94 passed, 94 total`, exit 0.

Note: the single regex form `--testPathPatterns="(a|b|...)\.spec"` matched only 3 of the 7 suites on
this Windows shell, so separate pattern flags were used.

`ptah_get_diagnostics` on the changed files reported 0 errors. Its sibling-file errors were in files
this batch does not touch: `generation-run-event-adapter.spec.ts` and BigInt-target noise in `libs/shared`.

Not run: lint and typecheck. The coordinator runs the combined verify.

## Plan deviations

- Two files outside the original list (`setup-wizard-state.types.ts`, `wizard-phase-generation.ts` and
  its spec) were changed after coordinator approval D30. Without them the wizard-view completion could
  not see `libraryPass`, `libraryDiverged` or `target`.

## Out-of-scope observations / follow-ups

1. Backend gap (D30 follow-up): the `setup-wizard:generation-complete` payload carries `result` (and
   so target, libraryPass and libraryDiverged) only for tab-bound runs:
   `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts:328`
   (`if (request.tabBinding)`) and `wizard-generation-rpc.handlers.ts:919`. Until a backend batch
   attaches those facts to non-tab runs, the wizard-view completion page shows the outcome summary but
   no grade, diverged or stale copy.
2. `components/generation-agent-sidebar.component.ts:110-150` still renders its own raw "Generated
   agents" list (`agent.status` strings, `counts.written/unchanged/failed/...`) above Next steps. It now
   duplicates C9 in `agent-next-steps`. Removing it belongs to whichever batch owns that file.
3. `GenerationAgentOutcome` has no reason for a kept file (chosen vs unreadable), so the prototype's
   planner note ("Ptah could not read this file ...") cannot be shown.
