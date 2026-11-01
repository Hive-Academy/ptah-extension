# Code Logic Review — B5b A5 parity (P17-P19, P22)

Score: 7/10. Verdict: REVISE (no blocking defects; two major gaps to close or record as decisions).

Scope: `analyze-done.page.ts` (+spec), `setup-wizard/src/index.ts`, deleted `completion.component.ts` (+spec, read from HEAD), `onboarding-generate.fixtures.ts`, `onboarding-generate-visual.e2e.spec.ts`. Read-only; no checks run.

## Walk of the deleted completion.component.ts

| Old behavior | New home | Status |
| --- | --- | --- |
| P17 `ptah-outcome-summary` rows/diverged/target/outputDirectory/openLibrary | `analyze-done.page.ts:120-127` | OK |
| P18 grade expectation, P19 stale notice, gated by `libraryReachable` | `:128-131` | OK |
| `SETUP_WIZARD_COMPLETE` close (`onCloseWizard`) | `openChat()` `:271` (also via `tribunal()`) | OK, matches L7 |
| Open Library -> `openSkillsDivergedClones` | `:274` | OK |
| Row mapping (`filePath` basename, fallback `<id>.md`, error passthrough) | `:193-207` | OK; `rejected` -> `failed`, `skipped` dropped |
| Safe copy: raw `error` never rendered | `OutcomeSummary.failureText` -> `safeFailureCopy`; spec asserts the secret is absent | OK |
| Failure header ("Setup Finished With Errors") and success header | counts line `:83-97` only | Partial, see F2 |
| `rejectedSections` badge (`rejected-sections-count`) | none | Gap, F3 |
| Generation `errors` list (raw strings) | none (intentional under safe copy) | OK, record it |
| Enhanced badge, quick-start/`/orchestrate` guide | none | Not in P17-P22; record as intentionally dropped (F3) |
| `warnings`, `enhancedPromptsStatusLabel` computeds | were never rendered | OK |

Index: the removed exports (`WizardView`, `WizardLanding`, `WorkflowCard`, `AgentSelectionList`, `GenerationWorkflowShell`, `AgentRunCard`, `AgentGenerationProgress`, `Welcome`, `ScanProgress`, `AnalysisResults`, `AgentSelection`, `PromptEnhancement`, `GenerationProgress`, `Completion`, `AnalysisStatsDashboard`, `provideSetupWizardFocusRouter`) have no importers in `apps/` or `libs/`. The same-named `WorkflowCard`/`WelcomeComponent` hits in `libs/frontend/chat` are separate classes. The eager `src/app.ts` entry is untouched and exports only four services, so it stays light. The new `OutcomeSummary`, `GradeExpectation` and `LibraryStaleNotice` exports sit in the main barrel only.

## Findings

### F1 (Major): "skipped or unavailable" shows while loading and for non-terminal or failed lookups
- Evidence: `analyze-done.page.ts:112-116` (else branch of `@if (agents())`); `loadFact` `:236-262`, which sets the signal only for terminal statuses and swallows RPC errors. `ngOnInit` loads gen, then tab, then enhanced-prompt status in sequence (`:222-233`).
- Scenario: the page renders `agents() === null` first, so "Agent generation was skipped or is unavailable" appears and then swaps to the real result after the first RPC. The same text appears for a `running` run, a lookup error, a mismatched tab, and a late result. On the Library-stale path the notice and grade copy pop in late.
- Fix: add a `loading`/`loaded` signal (or a tri-state `null | 'missing' | run`) and show a neutral "Loading results" line until `loadFact` settles. Use distinct copy for "not finished" versus "no run". Run the gen and tab lookups in parallel with `Promise.all`.
- Spec gap: no test for result missing, partial, or late.

### F2 (Major): header and counts line disagree with the outcome summary
- Evidence: `:85, :89, :98` key "needs attention" and the Review link on `result.counts.failed` only; `outcomeRows` (`:193-207`) turns `rejected` outcomes into `failed` rows. `:94` prints "N written, N unchanged, N failed" and omits kept and changed-since-preview. The summary below uses different labels (Already current, Kept (your file), ...).
- Scenario: a result with `counts.failed === 0` but a `rejected` outcome (or `counts` absent) shows a calm "completed" line, no Review link, and a red Failed alert in the summary. Kept and changed files are missing from the sentence, so the two blocks give different totals.
- Fix: derive `hasFailures` from `outcomeRows()` (failed rows > 0) OR `counts.failed > 0`. Drop the duplicate counts sentence when `agentOutcomes` renders. Otherwise show it with all five numbers and the same labels.

### F3 (Moderate): old completion facts with no recorded home
- Evidence: old `completion.component.ts:116-124` (`rejected-sections-count`), `:106-111` (Enhanced badge), the `/orchestrate` quick-start section, and the failure/success header. A grep of `parity-inventory.pr832.md` and `implementation-plan.addendum-pr832.md` finds none of them.
- Impact: `result.rejectedSections` and `tailoredSections` exist in `rpc-setup.types.ts:104-105`, but the user no longer learns that sections were rejected.
- Fix: either render a one-line "N sections rejected" from `result.rejectedSections` (in the summary section, `data-testid="done-rejected-sections"`), or list them under `## Decisions` as intentionally dropped.

### F4 (Moderate): spec coverage is thinner than its titles
- Evidence: `analyze-done.page.spec.ts:204-306`. There is no case for the opened-folder notice (`target.chosen === 'opened-folder'`, which also tests `outputDirectory()` `:211-217`), none for non-Electron with a harness-root target (Library copy must be hidden), none for a missing `target` (no grade/stale), and none for `agentOutcomes: []` ("Nothing new was written"). The `summary.querySelector('button')` click relies on the first button being Open Library. The stale-notice test re-calls `ngOnInit()` without awaiting it (`:292`) and so re-fires `markCompleted`.
- Fix: add those four cases and select the Library button by test id. Await `ngOnInit()` and set up the second state in a fresh fixture.

### F5 (Minor): capture does not guarantee the key element is in the shot
- Evidence: `onboarding-generate-visual.e2e.spec.ts:369-372` scrolls the `done-agent-outcomes` top into view, but `captureOnboarding` takes a viewport screenshot (`onboarding-ready-capture.ts:131`, no `fullPage`). On the small viewports the stale notice sits at the bottom of that block and can fall below the fold, while the test asserts it is visible.
- Fix: scroll `library-stale-notice` into view, or the block's bottom edge, before `shoot`. Also assert the safe copy: `outcome-failure` does not contain `EACCES`.

### F6 (Minor): fixture notes
- `doneAgentRun()` is realistic: three mixed outcomes (written, kept, failed), `counts.kept: 1`, a harness-root target, `libraryPass: 'failed'`, and a raw `EACCES` error that is only classified. Its `counts` leaves `total` 3 with written 1, kept 1, failed 1, so it is consistent. It never exercises changed-since-preview or an opened-folder target. Acceptable for the capture, but add one case if the opened-folder notice is meant to be visually verified.
- `doneAgentRun` is imported out of alphabetical order (`:29`); the file also carries large prettier-only reformatting that hides the real change in the diff.

## Answers to the review checks
- Data binding when the result is missing: no crash. All reads use `?.`/`??`, the summary is skipped without `agentOutcomes`, and Library copy is skipped without `target`. The user-facing copy is wrong, see F1.
- Partial result (`counts` only, no outcomes): counts line shows; no per-file list or Library notice. No error.
- Late result: signals update under OnPush and `destroyed` guards stop post-destroy writes. A `Promise.all` plus a loading state would fix the flash.
- Safe copy: no raw text reaches the DOM. The page passes `error` to the summary, which only classifies it.
- Host close message: present at `openChat()`. `tribunal()` posts it through `openChat()`. Command center and Run again do not, which is consistent with the addendum.

## Verdict
REVISE. Fix F1 and F2 (user-visible wrong or misleading state on the happy and partial paths). Resolve F3 by implementing or recording it as a decision. F4-F6 are cleanup.

## Round 2

Reviewer: in-process Claude (opus). Implementer family: codex. Score: 8/10. Verdict: APPROVE (no blocking or serious defects; two moderate gaps and minors, none gating).

Scope: `analyze-done.page.ts` (whole file) and its spec titles, the deleted `completion.component.ts` (HEAD), `onboarding-generate-visual.e2e.spec.ts:355-385`, the fix report. Scoped `npm run verify -t test -p @ptah-extension/onboarding` was started; the fix report records 8/8 tasks green. Capture was not run (out of scope).

### Round-1 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| F1 loading/skipped confusion | FIXED | `FactState` (`:44-50`) with distinct loading/running/failed-lookup/mismatched/missing copy (`:90-117`); lookups parallel via `Promise.all` (`:353-366`); each `loadFact` writes only its own signal pair, so no cross-race. Destroy guard after each await (`:410,:422`). |
| F2 header/count disagreement | FIXED | `hasFailures` (`:325-331`) covers counts.failed, failed/rejected rows, `success === false`, run `failed`. Counts sentence only when `agentOutcomes` is absent (`:136-144`), with all five numbers. |
| F3 old behaviors | MOSTLY FIXED | Header (`:121-132`), rejected badge (`:162-168`), Enhanced (`:182-188`), `/orchestrate` (`:233-251`) are ported. See R2-1 and R2-2 for what is still unrecorded. |
| F4 spec coverage | FIXED | opened-folder, non-Electron, no target, empty outcomes, rejected-with-zero-count, late result, lookup states all have named tests (`spec:309-533`). |
| F5 capture | FIXED | Scrolls `library-stale-notice` into view and asserts `outcome-failure` lacks `EACCES` (`e2e.spec:355-372`). |
| F6 fixture | FIXED | Fixture now has changed-since-preview and an opened-folder target (report); not re-read in depth. |

### Findings

1. R2-1 (Moderate) Cancelled or timed-out runs read as success. `hasFailures` (`analyze-done.page.ts:325-331`) ignores run status `cancelled` and `timed-out`, although `loadFact` accepts them as terminal (`:413-417`). Result: "Setup Complete!" with "Agents: cancelled" (`:123-135`), no warning badge and no Review link. Fix: treat `cancelled`/`timed-out` as needing attention (or use distinct header copy).
2. R2-2 (Moderate) Old-page content dropped without a recorded decision. The report says "Proposed Removals: None" and its Decisions note covers only the raw error list, Enhanced source and empty message. Not ported or recorded: the "Generated Agents (N)" count (old `agentCount`), the workflow-types grid, Pro Tips, the three extra example commands and "Continue Existing Tasks" block, and the top-level `result.errors` text for failures that have no per-agent row. `decisions.md` has no entry for any of these (greps for quick start, orchestrate, rejected sections, raw error find only unrelated lines). Fix: add one `decisions.md` line approving the trimmed quick start and the count removal, or restore them.
3. R2-3 (Minor) A failed run with no `agentOutcomes` and no `counts` gives "Setup Finished With Errors" and a Review link but no reason or detail (`:127-159`, gate at `:169`). Raw errors were intentionally dropped, but a generic classified line for run-level failure would help. Same gate also hides the Enhanced badge, output-directory and opened-folder notice when `agentOutcomes` is undefined (`:169-182`).
4. R2-4 (Minor) Page-level header copy contradicts the failure state: the `h1` and subtitle still say "You're ready to work / Your workspace setup is complete" (`:76-81`) above "Setup Finished With Errors" (`:124`). Cosmetic but visible in the failed capture.
5. R2-5 (Minor) All outcomes `skipped` yields `agentOutcomes.length > 0` but empty `outcomeRows()` (`:299-300`), so neither the "Nothing new was written" message (`:171`) nor any row appears. Base the empty message on `outcomeRows().length === 0`.
6. R2-6 (Minor) `ngOnInit` reads route query params once (`:388`); if the router reuses the component with new `gen`/`tab` params the facts go stale. Unchanged from the earlier design; deferred-minor class.
7. R2-7 (Minor) Enhanced badge keys off `enhancedPromptsUsed`, the old template keyed off wizard `enhancedPromptsStatus === 'complete'` ("generated"). Different meaning; the report documents the choice. Accept.

### Checks on the lookups
- Parallel race: independent signals, `destroyed` checked after each await; the late enhanced-status call is sequenced after both (`:367-380`) and falls back to run status, so only a disabled-guidance case flickers on to off. No stale-write hazard found.
- Lookup errors map to `failed-lookup`, not to "skipped"; RPC null maps to `missing`; mismatched tab is reported before any RPC.

### Verdict
APPROVE at 8/10. Close R2-1 and record R2-2 in `decisions.md` as follow-ups; R2-3 to R2-7 are optional.

## Round 3 (final)

Reviewer: in-process Claude (opus). Implementer family: codex. Score: 8.5/10. Verdict: APPROVE (no blocking or serious defects; three minor items, none gating). Scope: `analyze-done.page.ts` whole file, spec `:556-784`, old `completion.component.ts` at HEAD, `safeFailureCopy`, fix report. Tests were not re-run; the report records exit 0 for onboarding and the two host typechecks.

### R2 status

| Finding | Status | Evidence |
| --- | --- | --- |
| R2-1 cancelled/timed-out as success | FIXED | `hasFailures` includes failed/cancelled/timed-out (`:~380`); distinct `outcomeHeading` and notes, warning badge, "Review agent run" link (`:132-176`). Spec `:560-588`. |
| R2-2 dropped content | FIXED | Agent count (`:201-207`, same as old `outcomeRows().length`, falls back to `counts.total` without outcomes), workflow grid (six types, same labels), Pro Tips (both tips), three example commands plus Continue Existing Tasks (`:319-389`) all match old `:208-320`. Error list restored (`:229-242`). Only the mockup-code styling and step badges differ (cosmetic). |
| R2-3 failed run without detail | FIXED | Generic reason `:257-269`; Enhanced, output directory and errors now key off `result`, not `agentOutcomes`. |
| R2-4 header contradiction | FIXED for loaded runs (see R3-1 for the unloaded states). |
| R2-5 all-skipped empty state | FIXED | `:187` uses `outcomeRows().length === 0`; spec `:715-741` also asserts count `(0)`. |
| R2-6 stale query params | FIXED | See checks below. |

### Checks

- Subscription: `queryParamMap` with explicit `takeUntilDestroyed(destroyRef)`; BehaviorSubject emits synchronously, so there is exactly one initial load and no double load. No leak.
- Version guard: `++lookupVersion` before any await; every post-await write (`loadFact` success, catch, enhanced-status call) checks `destroyed` and version. Sync early returns (`missing`, `mismatched-tab`) run inside the current version. A stale lookup cannot overwrite newer state, and state is reset to `loading` and the signals cleared at the start of each reload (not at the wrong time). Spec `:742-783` proves it for the stale-resolves-last case.
- Error safety: bound `errors` is read as `unknown`, array-checked, filtered to strings and mapped through `safeFailureCopy` (unknown kind returns fixed fallback, known kind returns fixed copy), so raw text never reaches the template. The completion fallback is also mapped. Specs `:612-657` assert no path and no `EACCES`. Per-row `error` goes to `ptah-outcome-summary`, which was already covered in Round 1/2 (not re-read).

### Findings

1. R3-1 (Minor) `analyze-done.page.ts:~465-480` `pageHeading`/`pageSubtitle` fall to "Review workspace setup / Review the agent run" whenever `agents()` is null, i.e. while loading (brief flip to the ready heading after load), when agent generation was legitimately skipped (`missing`), and for `running`/`failed-lookup`/`mismatched-tab`. A user who skipped agents never sees "You're ready to work", and the subtitle tells them to review a run that does not exist. Fix: only use the review copy when `agents()` is non-null and needs attention; use the ready copy for `missing` and a neutral one for loading.
2. R3-2 (Minor) `:132-145` a cancelled or timed-out run with `result.success === false` shows the "Some agents were not generated" note beneath a "Setup Cancelled" header because the failed branch is tested first. Order the status checks `cancelled`/`timed-out` before `success === false`.
3. R3-3 (Minor) `:~495-523` the completion-payload fallback matches on status, counts and outcome ids only, with no run identity. Two runs of identical shape could cross-supply errors. Impact is limited to generic safe copy, so it is accepted; a run id on `CompletionData` would close it. Also `generationErrors` has no cap on length.
4. R3-4 (Info) `:132` no behaviour change needed: the guidance run status does not influence the header; matches the old page.

### Verdict
APPROVE at 8.5/10. R3-1 and R3-2 are optional polish; no round 4 needed.

## Bounded correction review

Reviewer: in-process Claude (same family as author; weaker evidence). Scope: `analyze-done.page.ts` `:467-483`, template `:120-147`, `loadFact` `:611-654`, spec `:577-602`, `setup-wizard-tour.scene.ts` against `setup-wizard-tour.json`. Tests not re-run (author reports 3/3 pass).

Verdict: APPROVE

1. R3-1 / R3-2 resolved. `setupReady` (`:467-472`) requires no failures and (status completed or agentState missing). Cancelled and timed-out notes now precede the `success === false` note (`:132-147`), and the spec asserts the failure note is absent (`:577`). `hasFailures` (`:492-500`) already treats failed, cancelled, timed-out and `success === false` as failures, so `completed` with `success === false` is correctly not ready.
2. Question on 'missing' (Minor, accepted). `loadFact` sets 'missing' in three cases: no `gen` query param (`:618-621`), no workspace path (`:624-627`), and a bound lookup returning null (`:640-641`). The first and third fit "skipped". The no-workspace-path case is really "unknown", and "ready to work" is a slight overstatement there. It is unlikely, because the page is only reached from an open workspace. The body copy "skipped or is unavailable" (`:122`) still covers it, so nothing contradicts. An optional tightening is to use a separate state for the no-workspace case.
3. No regression in the other states. Loading, running, failed-lookup and mismatched-tab all give `setupReady` false, so the heading is "Review workspace setup". The subtitle is the neutral "Review the setup steps below" (`:480-482`), because `agents()` is null. The conservative direction is right: an unverified run is never called ready.
4. Cosmetic (Minor, pre-existing). During loading the heading reads "Review workspace setup". On `missing` or `completed` it flips to "You're ready to work" after the lookup. Because `agentState` starts as 'loading', the flip is a single change after the lookup and not a flicker. Accepted.
5. Tour scene: PASS. Both files have 13 lines (0-12), and each `say(i)` matches line i. Targets: 1 Setup Home -> home, 3 analyze -> analyze path, 4 and 5 new project -> new-project path, 6 proposal workspace -> new-project path, 7 team builder -> team-builder path, 8-11 "Setup Home"/"return" -> home, 0, 2 and 12 have no target. The target ids are the three `onboarding-path-*` test ids.
6. Test coverage gap (Minor). The new spec `:590-602` covers `missing` -> ready. No spec was seen for `running` or `failed-lookup` asserting that the ready heading stays absent. The logic is straightforward, so this is optional.
