# Batch 4 report — Setup-wizard recovery actions and outcome presentation

Executor: frontend-developer. Date: 2026-08-31.
Status: **IMPLEMENTED, verified green. Not committed** (orchestrator commits).

## 0. Pre-start state (as instructed, measured before any edit)

`npx nx run-many -t typecheck -p @ptah-extension/setup-wizard --skip-nx-cache`
failed with exactly one error, confirming the known breakage:

```
src/lib/services/setup-wizard/wizard-phase-generation.ts:93:31 - error TS2339:
Property 'generatedCount' does not exist on type 'GenerationCompletePayload'.
```

Stale `generatedCount` fixtures existed in `wizard-phase-generation.spec.ts:175`,
`setup-wizard-state.service.spec.ts:421,447,675,697,717`, and
`completion.component.spec.ts:211,225` (spec files typecheck under the test
target, so the lib target showed only the one production error).

## 1. Files changed

All paths relative to `libs/frontend/setup-wizard/src/lib/`. Every changed file
is in the Batch 4 ownership list; `git status` shows no edits outside it.

### Created

| file                                            | why                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/analysis-results.component.spec.ts` | New spec (batch CREATE item): skeleton/phase-card rendering, failed-phase error display, continue-to-selection, and the resume-generation offer (hidden without a checkpoint, visible with one, delegates to the runner, renders even before an analysis result is stored). |

### Modified

| file                                                    | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/setup-wizard-state.types.ts`                  | `CompletionData` loses `generatedCount` and gains the payload-mirroring fields: `outputDirectory`, `writtenCount`, `unchangedCount`, `failedCount`, `rejectedSections`, `tailoredSections`, `agents: GenerationAgentOutcome[]` (lines 101–128).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `services/setup-wizard/wizard-phase-generation.ts`      | The breakage fix and the outcome mapping. `handleGenerationComplete` (line 94) copies every payload field into `CompletionData` and calls `applyAgentOutcomes` (line 122): `written`/`unchanged` → item `complete`, `failed` → item `error` with the outcome's error (`toTerminalItem`, line 160); an outcome with no pre-seeded item (resumed run) becomes a new item (line 145). The `phase === 'complete'` blanket-complete branch in `handleGenerationProgress` is REMOVED (comment at line 60) — a final progress event never marks an item complete.                                                                                                                                                                                                                                                                                                            |
| `services/wizard-rpc.service.ts`                        | `deepAnalyze(options?: { resume?: boolean })` forwards `resume: true` (line 178). New `getResumableRun()` (line 201) calls `wizard:get-resumable-run`, best-effort: any failure returns `{ analysis: null, generation: null }` with a warn. New `resumeGeneration()` (line 231) sends `wizard:submit-selection` with `{ selectedAgentIds: [], resume: true }` — the persisted checkpoint is the source of truth.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `services/wizard-analysis-runner.service.ts`            | Startup resume discovery. First `ensureStarted()` awaits one `wizard:get-resumable-run` query (`discoverResumableRun`, line 190, one-shot). An incomplete analysis sets `resumableAnalysis` (line 84) and the runner HOLDS — no delete, no restart. A completed analysis is adopted via `setMultiPhaseResult`; a generation checkpoint sets `resumableGeneration` (line 86). `resumeAnalysis()` (113) / `startFreshAnalysis()` (119) run with `deepAnalyze({ resume })`. `resumeGeneration()` (131) seeds item progress from the checkpoint agents (`toProgressItem`, line 35: written/unchanged → complete, everything else → pending), moves to the `generation` step, then calls the RPC; on RPC failure the still-pending items become `error` so the UI reports the truth. A token capture around discovery (line 176–181) keeps cancel/reset semantics correct. |
| `components/scan-progress.component.ts`                 | Resume-hold UI (`data-testid="resume-analysis-card"`, line 121) with "Resume Analysis" / "Start Fresh" buttons calling the runner (lines 546, 551). Shown instead of the progress area while `resumableAnalysis()` holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `components/analysis-results.component.ts`              | Resume-generation banner (`data-testid="resume-generation-banner"`, line 60) with agent count and a "Resume Generation" button → `runner.resumeGeneration()` (line 354). Rendered in both the result and the skeleton branch, so it survives a restart with no stored frontend result. The `ngx-markdown` path is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `components/completion.component.ts`                    | Outcome-driven presentation. `agentTiles` (line 411) derives one card per explicit outcome (streamed items only as fallback when no payload ever arrived); counts come from the payload aggregates (`written-count`/`unchanged-count`/`failed-count` testids, lines 118–131); output directory shown (line 139); `unchanged` labeled "Already current" (line 184); failed tiles show the outcome error; payload `errors` listed (line 204); header switches to "Setup Finished With Errors" via `hasFailures` (line 444) while written tiles stay visible.                                                                                                                                                                                                                                                                                                            |
| `services/setup-wizard/wizard-phase-generation.spec.ts` | Fixture rebuilt on the real payload shape; new specs: mixed written/unchanged/failed mapping (non-agent items untouched), item creation for an unmatched outcome, and a failed outcome staying `error` even after a `phase: 'complete'` progress event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `services/setup-wizard-state.service.spec.ts`           | All five `generatedCount` fixtures replaced by a `generationComplete()` payload factory; new message-path spec proves a failed outcome lands in `skillGenerationProgress` as `error`. Unused `CompletionData` import removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `components/completion.component.spec.ts`               | Fixtures on the new `CompletionData`; new "Explicit outcome presentation" block: tiles from outcomes not streamed items, "Already current" label, failed tile + error, payload counts, output directory, error header, errors list with earlier writes retained, success header for written+unchanged, streamed-item fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `services/wizard-rpc.service.spec.ts`                   | New specs: `deepAnalyze` default has no resume flag / passes `resume: true`; `getResumableRun` happy path, error-result and thrown-transport fallbacks; `resumeGeneration` exact `{ selectedAgentIds: [], resume: true }` payload and failure throw.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `services/wizard-analysis-runner.service.spec.ts`       | Mocks gain `getResumableRun`/`resumeGeneration`/`setSkillGenerationProgress`. New blocks: hold-on-unfinished-analysis (deepAnalyze NOT called), one discovery per session, resume/fresh flag forwarding, completed-analysis adoption + checkpoint surfacing, checkpoint-seeded resume with step transition, no-op without checkpoint, RPC-failure marks pending items failed. One pre-existing test re-ordered around a task flush (deepAnalyze now starts after the awaited discovery).                                                                                                                                                                                                                                                                                                                                                                              |
| `components/scan-progress.component.spec.ts`            | Mock RPC gains the two new methods. Three pre-existing synchronous assertions now flush the (new, async) discovery step first. New "Resume analysis offer" block: card rendered instead of a restart, resume button → `deepAnalyze({ resume: true })`, start-fresh → `deepAnalyze({ resume: false })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### In the ownership list but NOT modified

- `services/setup-wizard-state.service.ts` — no change needed: it re-exports
  `CompletionData` from the types file and already exposes
  `setSkillGenerationProgress`/`setCurrentStep`, which the runner uses.
- `services/setup-wizard/wizard-internal-state.ts` — no change needed: it
  already imports `CompletionData` by name from the types file.

## 2. Acceptance criteria → evidence

| criterion                                                                                                                                                               | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root-scoped runner queries `wizard:get-resumable-run` at startup and stores a resumable signal without deleting/restarting the prior run                                | `wizard-analysis-runner.service.ts:104` (`ensureStarted` → `launchAfterDiscovery`), `:190` (`discoverResumableRun`, one-shot), `:183-186` (hold — `run()` is not called). Specs: `wizard-analysis-runner.service.spec.ts` "holds on an unfinished analysis instead of restarting it", "queries wizard:get-resumable-run only once per session".                                                                                          |
| `WizardRpcService` calls the typed `resume: true` paths                                                                                                                 | `wizard-rpc.service.ts:178` (`deepAnalyze({ resume: true })` → `wizard:deep-analyze`), `:234` (`wizard:submit-selection` with `{ selectedAgentIds: [], resume: true }`). Specs: `wizard-rpc.service.spec.ts` deepAnalyze/resumeGeneration blocks.                                                                                                                                                                                        |
| `ScanProgressComponent` offers analysis resume                                                                                                                          | `scan-progress.component.ts:121` (card), `:546` (`onResumeAnalysis` → runner). Specs: `scan-progress.component.spec.ts` "Resume analysis offer" (three tests, including `deepAnalyze` called with `{ resume: true }` and NOT called before the choice).                                                                                                                                                                                  |
| `AnalysisResultsComponent` offers generation resume from persisted backend state and moves to the generation step                                                       | `analysis-results.component.ts:60` (banner), `:354` (`onResumeGeneration`); the runner seeds items from `checkpoint.agents` (`wizard-analysis-runner.service.ts:137-140`) and calls `setCurrentStep('generation')` (`:140`). Specs: `analysis-results.component.spec.ts` "Resume generation offer"; `wizard-analysis-runner.service.spec.ts` "seeds items from the persisted checkpoint and moves to generation".                        |
| `WizardPhaseGeneration` maps explicit outcomes into completion data and item progress; never infers success from a final progress event                                 | `wizard-phase-generation.ts:94-118` (payload → `CompletionData`), `:122-158` (`applyAgentOutcomes`), `:160-172` (`toTerminalItem`), `:58-61` (blanket-complete branch removed). Specs: `wizard-phase-generation.spec.ts` "maps mixed outcomes…", "creates an item for an outcome with no pre-seeded item", "a failed outcome stays an error even after a final progress event".                                                          |
| Completion UI shows output directory, all outcome/count categories, unchanged as already current, partial failures with earlier writes retained — derived from outcomes | `completion.component.ts:411` (`agentTiles` from `data.agents`), `:118-131` (payload counts), `:139` (output directory), `:184` ("Already current"), `:187-194` (failed tile error), `:204` (errors list), `:444` (`hasFailures` header switch). Specs: `completion.component.spec.ts` "Explicit outcome presentation" (9 tests, including "lists payload errors and keeps earlier writes visible").                                     |
| Components standalone, OnPush, signal-driven; ngx-markdown path unchanged; no raw HTML binding                                                                          | All three touched components keep `ChangeDetectionStrategy.OnPush` (grep count 1 each); no `[innerHTML]` anywhere in the diff; `analysis-results` markdown rendering untouched; no `BehaviorSubject`, no Zone-dependent code — new async state is signals + promises.                                                                                                                                                                    |
| Specs prove restart discovery, both resume flags/actions, mixed/timed-out outcome mapping, explicit labels/counts/path, state transitions                               | Discovery: runner + scan-progress specs above. Flags: rpc-service + runner + scan-progress specs. Outcome mapping incl. timed-out-style errors: phase-generation specs ("not generated because the run timed out") + state-service message-path spec. Labels/counts/path: completion specs. Transitions: runner spec (`setCurrentStep('generation')`, `'analysis'`), state-service auto-transition spec (kept green on the new payload). |
| Batch verification: OnPush retained, all RPC behind `WizardRpcService`                                                                                                  | Components call only the runner or `WizardRpcService`; the runner's only I/O is `WizardRpcService`; no `libs/backend/**` import was added (the lib's imports remain `core`/`shared`/`chat-*` + Angular/lucide/ngx-markdown).                                                                                                                                                                                                             |

## 3. Verification output (verbatim, `--skip-nx-cache`)

Command: `npx nx run-many -t typecheck,lint -p @ptah-extension/setup-wizard`

```
 NX   Running targets typecheck, lint for project @ptah-extension/setup-wizard:
- @ptah-extension/setup-wizard
> nx run @ptah-extension/setup-wizard:lint
Linting "@ptah-extension/setup-wizard"...
D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
  867:1  warning  File has too many lines (768). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts
  362:31  warning  Unexpected empty method 'onAlertOk'  @typescript-eslint/no-empty-function
✖ 2 problems (0 errors, 2 warnings)
> nx run @ptah-extension/setup-wizard:typecheck
> npx ngc --noEmit --project libs/frontend/setup-wizard/tsconfig.lib.json
 NX   Successfully ran targets typecheck, lint for project @ptah-extension/setup-wizard
```

Both warnings are pre-existing: the `agent-selection.component.ts` max-lines
overage and the empty `onAlertOk` (present before this batch; my banner edit
shifted its line number only).

Command: `npx nx run-many -t test -p @ptah-extension/setup-wizard`

```
 NX   Running target test for project @ptah-extension/setup-wizard:
- @ptah-extension/setup-wizard
> nx run @ptah-extension/setup-wizard:test
Test Suites: 12 passed, 12 total
Tests:       319 passed, 319 total
Snapshots:   0 total
Time:        7.044 s
Ran all test suites.
 NX   Successfully ran target test for project @ptah-extension/setup-wizard
```

(319 tests; the suite had 297 before this batch — 22 new tests net, all listed
in §1.)

## 4. Deviations and judgment calls

1. **The `phase === 'complete'` blanket-complete branch in
   `handleGenerationProgress` was removed**, not just bypassed. It marked every
   pending/in-progress item complete on the final progress event — exactly the
   inference the criterion forbids. Terminal item state now has one source:
   `applyAgentOutcomes`. A dedicated spec pins the behavior.
2. **`resumeGeneration` sends `selectedAgentIds: []`** alongside `resume: true`.
   The shared `WizardSubmitSelectionParams` type requires the field (Batch 1
   kept it required on the wire type; only the Zod schema made it optional), and
   the Batch 3 schema documents "empty or absent is allowed only together with
   `resume: true`". No model override is sent — persisted inputs win.
3. **A completed analysis returned by discovery is adopted via
   `setMultiPhaseResult`** instead of being offered for "resume". A completed
   run is not resumable; adopting it lets the user land on the analysis step
   after a restart, where the resume-generation banner is visible. Nothing on
   disk is touched.
4. **Resume-RPC failure marks still-pending items as `error`.** The wizard has
   no component-visible error-state setter, and a client-side RPC failure
   produces no backend broadcast; without this the generation step would hang
   silently. Already-terminal items keep their state (spec-pinned).
5. **A latent cancel race was introduced and fixed inside this batch**: `run()`
   now starts after the awaited discovery, so a `cancel()` during discovery no
   longer preceded the run's token capture. `launchAfterDiscovery` captures the
   token before the await and aborts if it moved
   (`wizard-analysis-runner.service.ts:176-181`); the pre-existing
   "drops the result of a run the user cancelled" spec catches it and passes.
6. **Two ownership-listed files were intentionally not modified** (see §1) —
   their existing re-exports already carry the new types.
7. Three pre-existing scan-progress specs and one runner spec asserted
   synchronously on state that is now one microtask later (discovery). They
   were updated with a task flush; their assertions are unchanged.

## 5. Criteria not met

None. Every criterion in §2 has code and a passing spec behind it. One limit
worth stating: no spec drives the full wizard-view step routing across a
restart (welcome → scan → hold → resume) end-to-end; the flow is covered at
the runner/component seams listed above.
