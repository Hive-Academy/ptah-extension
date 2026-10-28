# Implementation Plan Addendum — PR #832 (TASK_2026_ONBOARDING)

This addendum amends `implementation-plan.md` (approved at Gate 2, codex APPROVED r2) for draft
PR #832 (`feat/wizard-library-alignment`, head `65499f2c`, ref `refs/remotes/pr/832`), which lands
on `main` before this task is implemented (`context.md` "Plan gate", Gate 2 condition). Where this
addendum and the plan disagree, this addendum wins. Everything it does not mention stays as approved.

Citations are at `65499f2c` (read with `git show refs/remotes/pr/832:<path>`) unless marked `main`.
Abbreviations: `W/` = `libs/frontend/setup-wizard/src/lib/`, `S/` = `libs/shared/src/lib/types/`,
`B/` = `libs/backend/rpc-handlers/src/lib/handlers/`. Capability ids P1-P29 refer to
`parity-inventory.pr832.md`.

## Inputs and constraints

- Requirements used: `context.md` (incl. Gate 2 and the PR 832 note), `implementation-plan.md`,
  `parity-inventory.md`, `design-spec.md`, the PR 832 description (`gh pr view 832`), and the PR
  diff `git diff main...refs/remotes/pr/832` (merge base `0e17912e3` = current `main`).
- PR scope used: 60 files under `libs/frontend/setup-wizard/**`, `S/rpc/rpc-setup*.ts`,
  `S/rpc.types.ts`, `S/wizard/phase.ts`, `libs/shared/src/index.ts`, plus read-only backend
  context (`B/wizard-generation-rpc.handlers.ts`, `B/wizard-generation/generation-preview.service.ts`,
  `B/guidance-generation-run.supervisor*.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`).
- PR 832 touches no file the plan modifies outside setup-wizard: `git diff --name-only` over
  `libs/frontend/{core,chat,chat-ui,chat-state,harness-builder}`, `apps/ptah-extension-webview`,
  `apps/ptah-electron-e2e`, `eslint.config.mjs`, `tsconfig.base.json`,
  `S/webview-surface.types.ts`, `S/messages/schemas.ts`, `webview-lifecycle.service.ts`,
  `apps/ptah-electron/src/services` is empty, except two additive message constants (`library:changed`)
  that no plan file uses.
- The PR description says its remaining batches (19-26) touch `skill-synthesis-ui`, `marketplace` and
  the backend, not setup-wizard. Treated as an **Assumption**; Rebase notes item 1 checks it.
- This task still has **no backend change**.
- Missing decision-critical input: one user decision (PR-R1). It blocks only the error branch of the
  bound preview owner in B3a and one deletion detail in B5b. Everything else proceeds.

## What changes, in one paragraph

PR 832 turns the A2 overwrite preview from an informational "Will overwrite" list into a keep/replace
decision step (default Keep), adds a target-root choice, makes a tab-keyed preview mandatory for
bound submits, adds a community-pack install prompt with the same decisions, widens agent outcomes
with `kept` / `changed-since-preview`, and adds three completion sub-components (outcome summary,
grade expectation, Library-stale notice) plus a safe-failure-copy rule. Onboarding reuses all of it
through the setup-wizard barrel. The plan's new `overwrite-preview.component.ts` is dropped in favour
of the PR's `AgentPreviewDialogComponent`. A2's preview owner becomes the PR's
`GenerationPreviewStore`, extended with a tab binding. A3 and A5 show the PR's outcome components.
`ItemStatusCard` maps seven statuses and never renders raw error text. Two PR files become orphans
when the legacy wizard is deleted and join the deletion ledger. D9 is unaffected.

## Contract drift (plan citations re-cited at 65499f2c)

Shape changes are marked **shape**; everything else moved only.

| Plan citation (main) | At 65499f2c | Change |
| --- | --- | --- |
| `S/rpc/rpc-setup.types.ts:11-12` (`SetupGenerationWorkflow`) | `:22-23` | moved (+11 import lines) |
| `:14-23` (tab/run binding), `:20-23` | `:25-33`, `:31-33` | moved |
| `:32-39` (lifecycle) | `:43-50` | moved |
| `:54-63` (`SetupGenerationRejection`) | `:65-74` | union unchanged; **behaviour**: a bound submit without a preview recorded for its tab now returns `preview-required` (`B/wizard-generation-rpc.handlers.ts:479-490`, `B/wizard-generation/generation-preview.service.ts:364-365`) |
| `:65-96` (`SetupGenerationResultFacts`) | `:76-120` | **shape**: `agentOutcomes[].status` is `FileOutcome \| 'skipped' \| 'rejected'` (`:86-91`); `counts.kept?`, `counts.changedSincePreview?` (`:100`, `:102`); `target?`, `libraryPass?`, `libraryDiverged?` (`:112-119`) |
| `:98-107` / `:98-108` (`SetupGenerationRunState`) | `:122-131` | moved |
| `:209` (`MultiPhaseAnalysisResponse`) | `:233` | moved |
| `:294` (`WizardSubmitSelectionParams`, parity) | `:318-343` | **shape**: `previewToken?`, `fileDecisions?`, `target?` (`:338-342`) |
| `:316-341` (resumable run) | `:349-373` | **shape**: `ResumableGenerationAgent.status` is `'pending' \| 'running' \| FileOutcome` (`:352`) |
| `:353` (`WizardPreviewGenerationParams`, parity) | `:386-393` | **shape**: `target?` (`:392`) |
| `:395` (`WizardPreviewGenerationResponse`) | `:443-457` | **shape**: `previewToken?`, `target?`, `rivalStatus?` (`:452-456`); files gain `localState?`, `revision?` (`:419`, `:424`); agents gain `agentModel?`, `libraryCopyEdited?`, `unchangedSinceWizardWrite?` (`:432-436`) |
| `:473-489`, `:481` (guidance status, `detectedStack`) | `:527-542`, `:535` | moved |
| `:506-525`, `:519-520`, `:521-522`, `:523-524` (summary, `totalTokens`, `qualityScore`, `usedFallback`) | `:560-579`, `:573-574`, `:575-576`, `:577-578` | moved |
| `:641`, `:649` (pack install, parity) | `:695-718` | **shape**: params `planToken?`, `decisions?`, `target?` (`:701-705`); result `files?`, `libraryPass?` (`:715-717`) |
| — | `S/rpc/rpc-setup-decisions.types.ts:1-154` (new) | **new**: `FileOutcome` (`:89-94`), `GenerationTargetInfo` (`:54-62`), `LibraryPassStatus` (`:105`), `PackFilePlan`, plan params/result (`:123-148`); re-exported by `S/rpc.types.ts` |
| — | `S/rpc.types.ts:1103-1106`, `:3187` | **new RPC** `wizard:plan-pack-install` (consumed only inside the reused pack prompt) |
| `S/wizard/phase.ts:51-79`, `:71-79`, `:81` (scan progress) | `:52-80`, `:72-80`, `:82` | moved (+1 import); scan phase status union unchanged (`:74`) |
| `phase.ts:67-71`, `:191` (context.md) | `:68-72`, `:188` | moved |
| `phase.ts:202-205` (`GenerationAgentOutcome`) | `:203-211` | **shape**: `status: FileOutcome` (`:206`); complete payload `keptCount?`, `changedSincePreviewCount?` (`:234`, `:239`) |
| `W/services/wizard-rpc.service.ts:86-102` (`getBoundRunState`) | `:131-147` | moved; signature unchanged |
| `wizard-rpc.service.ts:445` (`getEnhancedPromptsStatus`), `:521` (`getEnhancedPromptContent`) | `:504`, `:580` | moved; signatures unchanged |
| `wizard-rpc.service.ts` `launchWizard` (D13, main `:194`) | `:241` | moved |
| — | `wizard-rpc.service.ts:166-196` | **shape**: `startBoundAgents(binding, ids, resume = false, decisions?: BoundAgentDecisions)`; `BoundAgentDecisions` `:55-58`; `previewGeneration(ids, target?)` `:253-270`; `planPackInstall` `:693-720` |
| `W/services/generation-workflow.store.ts:11-22`, `:12` (`GenerationViewState`) | `:14-25`, `:15` | moved; union unchanged |
| `generation-workflow.store.ts:68`, `:68-85` (`bind`) | `:71`, `:71-88` | moved; signature unchanged (B3b still adds `expectedRunId?`) |
| `generation-workflow.store.ts:267-300`, `:296-300` (`refresh`) | `:282-315`, `:311-315` | moved |
| — | `generation-workflow.store.ts:104-143` | **shape**: `startAgents(selectedAgentIds, decisions?: BoundAgentDecisions)` |
| `W/services/wizard-analysis-runner.service.ts:80-120`, `:132-160`, `:220-240` | `:87-127`, `:139-167`, `:227-247` | moved (+7); resume now settles `kept`/`changed-since-preview` (`:34-35`, `:45`) |
| `W/components/completion.component.ts:512-516` (`SETUP_WIZARD_COMPLETE`, L7) | `:455-459` | moved (file is still deleted in B5b) |
| `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:68` (guidance supervisor singleton, D9) | `:76` | moved; still `registerSingleton(GuidanceGenerationRunSupervisor)` |
| `libs/frontend/setup-wizard/src/index.ts:10`, `:17`, `:18`, `:22`, `:37`, `:38`, `:40` | same | unchanged (file not in the PR diff) |

Unchanged at 65499f2c (verified with `git diff --quiet main...refs/remotes/pr/832 -- <file>`):
`B/guidance-generation-run.supervisor.ts`, `B/enhanced-prompts-rpc.handlers.ts`,
`libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`,
`W/services/guidance-generation.store.ts`, `W/services/generation-handoff.store.ts`,
`W/services/bound-generation-tab.ts`, `W/services/agent-generation.store.ts`,
`W/components/cards/enhanced-prompts-summary-card.component.ts`,
`W/components/guidance-result-panel.component.ts`, `generation-model-picker.component.ts`,
`generation-source-status.component.ts`, `confirmation-modal.component.ts`,
`analysis-transcript.component.ts`. All plan citations into these files stand.

## Component changes

### C-B2. `ItemStatusCard` / `ItemStatusGrid` (onboarding, B2) — status map and failure copy

- Purpose unchanged. Contract change: the status input is typed
  `ResumableGenerationAgent['status']` (`S/rpc/rpc-setup.types.ts:352`) and the label map is a
  `Record` over that union, so a future member fails typecheck instead of rendering blank. Seven
  states: `pending` "Waiting", `running` "Writing", and the five `FileOutcome` labels copied from the
  PR's outcome summary (`W/components/completion/outcome-summary.component.ts:24-30`): "Written",
  "Kept (your file)", "Already current", "Changed since preview (kept)", "Failed" (AD5).
- `error` is never rendered raw. The card shows `safeFailureCopy(error, <fixed fallback>)`
  (`W/utils/safe-failure-copy.ts:67-73`), imported from `@ptah-extension/setup-wizard` (export added in
  B2). Raw text stays out of the DOM (PR rule B5, `safe-failure-copy.ts:1-7`).
- `chipStateFor` is unaffected (`GenerationViewState` unchanged, `generation-workflow.store.ts:14-25`).
- Failure behaviour: an unknown failure kind shows the fallback; a missing `error` shows the label only.
- Verification seam: card spec. Every one of the seven statuses renders its label; an `error` with a
  path or URL renders the fixed copy and the raw string is absent from the rendered text.

### C-A2. A2 preview, decisions and packs (B3a)

**Drop** `libs/frontend/onboarding/src/lib/analyze/overwrite-preview.component.ts` from the plan's
Create list. A2 renders `AgentPreviewDialogComponent` (`index.ts:18`; inputs and outputs
`W/components/agent-preview-dialog.component.ts:271-285`) as its preview sheet (AD1, AD3).

**Owner: `GenerationPreviewStore`** (`W/services/generation-preview.store.ts:39-172`), reused and
extended, not copied (AD2). It is component-scoped (`@Injectable()` at `:39`, lint note `:38`), so
`ChooseAgentsPage` lists it in its `providers` and the preview resets with the page.

Changes to the store (setup-wizard, B3a), additive until B5b:

```ts
// generation-preview.store.ts
async open(agentIds: readonly string[], keepTarget: boolean, binding?: SetupGenerationTabBinding): Promise<void>;
// confirm / changeTarget / setRowDecision / setAllRowDecisions / cancel: signatures unchanged;
// they use the binding captured by the last open().
// wizard-rpc.service.ts:253 — third optional parameter, sent as `tabBinding` when set
async previewGeneration(selectedAgentIds: string[], target?: GenerationTargetChoice, tabBinding?: SetupGenerationTabBinding): Promise<WizardPreviewGenerationResponse>;
```

- With a binding, `load()` sends `tabBinding`, so the backend records the preview under that tab's
  key (`B/wizard-generation-rpc.handlers.ts:1095-1117`). That record is what a bound submit requires
  (`:490`). The backend validates the binding and rejects a foreign workspace
  (`:1078-1106`); the store's existing catch maps any throw to the fixed "Preview unavailable"
  (`generation-preview.store.ts:160-168`), so no raw text reaches the dialog.
- With a binding, `confirm()` after a preview error re-runs the comparison (`load(agentIds, true)`)
  and never returns the create-only result. This matches the PR's own bound owner
  (`W/components/agent-selection-list.component.ts:335-338`, `:362-415`). PR-R1 approved by the user
  (2026-10-27): the bound branch has no create-only return. The dialog's error state shows a Retry
  action with retry-specific copy ("Preview failed. Retry the comparison to continue."), never
  "Generate without preview".
- Without a binding, behaviour is byte-for-byte the PR's (the legacy `AgentSelectionComponent` still
  uses it until B5b).

`ChooseAgentsPage` wiring (B3a):

- Inputs: `open` = `store.isOpen()`, `loading`, `preview`, `snapshot` = `store.decisions()`,
  `changed`, `error` = `store.error() !== null`, `model` = `GenerationWorkflowStore.model()`,
  `isElectron` = `VSCodeService.isElectron`. Outputs: `decisionChange` → `setRowDecision`,
  `applyAll` → `setAllRowDecisions`, `targetChange` → `changeTarget(ids, choice)`, `dismissed` →
  `cancel()`, `confirm` → the confirm sequence below.
- Confirm sequence: `c = await previewStore.confirm(ids)`; if `c.submit`,
  `r = await analysisStep.submit(binding, c.decisions)`. If `r` is a rejection with
  `reason === 'preview-required'`, call `previewStore.open(ids, true, binding)` (keeps the root and
  shows "Targets changed…", `generation-preview.store.ts:62-76`) and show the inline
  "Targets need another review." (copy from `agent-selection-list.component.ts:161-162`). `blocked`
  keeps the plan's owner-conflict banner.
- Community packs: unchanged in the plan (`CommunityPacksPanelComponent`, `index.ts:17`). It now
  carries P13-P15 itself (pack prompt `community-packs-panel.component.ts:194`, root store
  `pack-install.store.ts:68`). No new import.

Changes to the plan's Contracts §C6 `AnalysisStepStore`:

```ts
// removed: readonly preview: Signal<WizardPreviewGenerationResponse | null>;
// removed: refreshPreview(binding: SetupGenerationTabBinding): Promise<void>;
submit(binding: SetupGenerationTabBinding, decisions?: BoundAgentDecisions):
  Promise<{ runId: string } | { rejection: SetupGenerationRejection } | { error: string }>;
// delegates to GenerationWorkflowStore.startAgents(ids, decisions) (generation-workflow.store.ts:104-143)
```

- The A3 facts-row item "will overwrite from preview kept in the store" (design-spec §3.2 A3) is
  dropped: the preview is page-scoped now and the run result reports what was actually written,
  kept or changed since the preview (P17, P25).
- Failure behaviour: preview throw → dialog error state, confirm retries (PR-R1 approved);
  `preview-required` → re-open with kept root; RPC start failure → the store's existing
  `startError` path (`generation-workflow.store.ts:132-143`).
- Verification seams: `generation-preview.store.spec.ts` (new, the PR adds no spec for this store):
  a bound open sends `tabBinding`; a bound confirm after an error re-runs the comparison and never
  returns `{ submit: true, decisions: undefined }` (PR-R1 approved), tested for a missing preview
  record, a matching earlier record, and changed targets; the error state renders the Retry label; an unbound confirm after an error keeps the PR
  behaviour; a target change resets every row to Keep; a superseded reply is dropped; a confirm whose
  re-preview differs returns `{ submit: false }` and sets `changed`. `wizard-rpc.service.spec.ts`: the
  third argument is sent as `tabBinding` and omitted when absent. `choose-agents.page.spec.ts`:
  decisions reach `startAgents`; `preview-required` re-opens with `keepTarget`; Replace count drives
  the confirm label (`preview-decisions.state.ts:322-330`).

### C-B3b. A3 and A5 outcomes (B3b)

- A3 (`generate-agents.page.ts`) shows **exactly one** outcome summary per page (AD4):
  - when the page mounts `AgentNextStepsComponent` for the handoff (plan, unchanged), its built-in
    `OutcomeSummary` + `GradeExpectation` + `LibraryStaleNotice` block (`agent-next-steps.component.ts:58-73`)
    is the terminal per-file view;
  - for a terminal run whose result has `agentOutcomes` but where the page does not mount
    `AgentNextSteps` (failed, cancelled, timed-out without handoff), the page renders
    `OutcomeSummaryComponent` itself (`[compact]="false"`), with the same inputs `AgentNextSteps`
    derives (`:160-191`).
  - `ItemStatusGrid` renders while the run is non-terminal. After a terminal state it lists only
    agents whose status is `failed` and that `wizard:retry-item` can retry, so "Retry this agent"
    survives without a second per-file list.
- A5 (`analyze-done.page.ts`) renders `OutcomeSummaryComponent` (non-compact),
  `GradeExpectationComponent` and `LibraryStaleNoticeComponent` from the agent run's
  `SetupGenerationResultFacts` (`S/rpc/rpc-setup.types.ts:76-120`). Grade and stale copy only when
  `libraryReachable(isElectron, result.target)` (`outcome-summary.component.ts:39-48`).
  `openLibrary` calls `AppStateManager.openSkillsDivergedClones()` (verified on `main`,
  `libs/frontend/core/src/lib/services/app-state.service.ts:1082`) after `completedAt` is set.
  Absent result facts (older host, reload with no state) → no outcome block, facts only (spec
  absence rule).
- `GenerationStepStore.doneFacts` (C6) carries the agent run's `SetupGenerationResultFacts` unchanged
  (no re-derived counts) and an `outcomeRows: readonly OutcomeFileRow[]` built with the same rule as
  `agent-next-steps.component.ts:32-39`, `:165-178`: `skipped` omitted, `rejected` → `failed`,
  `fileName || \`${agentId}.md\``. The rule is kept in onboarding (two uses after B5b deletes
  `completion.component.ts`; not worth a shared helper yet).
- Verification seams: `generate-agents.page.spec.ts` asserts one `ptah-outcome-summary` in every
  terminal state with outcomes, and a failed agent keeps Retry; `analyze-done.page.spec.ts` asserts
  the five counters, Library copy hidden when `isElectron` is false or `target.chosen` is
  `opened-folder` on a non-harness root, and no outcome block when `result` is absent;
  `generation-step.store.spec.ts` covers the row mapping (skipped, rejected, missing `fileName`).

## Barrel exports: new and changed, with batch owner

`libs/frontend/setup-wizard/src/index.ts` (each export lands in the batch of its first consumer, L13):

| Batch | Plan (unchanged) | Added by this addendum | First consumer |
| --- | --- | --- | --- |
| B2 | `export type { GenerationViewState }` | `export { safeFailureCopy } from './lib/utils/safe-failure-copy'` | `ItemStatusCard` |
| B3a | `WizardAnalysisRunner`, `findBoundGenerationTab` | `GenerationPreviewStore`, `type PreviewConfirmation` (`generation-preview.store.ts:24-29`), `type BoundAgentDecisions` (`wizard-rpc.service.ts:55-58`) | `ChooseAgentsPage`, `AnalysisStepStore` |
| B3b | `GuidanceGenerationStore`, `GuidanceResultPanelComponent` | `OutcomeSummaryComponent`, `GradeExpectationComponent`, `LibraryStaleNoticeComponent`, `libraryReachable`, `type OutcomeFileRow` (all `W/components/completion/*`) | `GenerateAgentsPage`, `AnalyzeDonePage`, `GenerationStepStore` |
| B5b | drop deleted exports, `provideSetupWizardFocusRouter` (`:10`) | nothing extra: `GenerationPreviewModalComponent` was never exported | — |

No other barrel changes. `harness-builder` and onboarding barrels are unaffected.

## Deletion ledger delta (plan "Delete (B5b)")

Changed rows (files the plan deletes that PR 832 modified; still deleted):

| # | File(s) | PR 832 change | Parity rows it carries → new owner (amended) |
| --- | --- | --- | --- |
| 12-13 | `agent-selection.component.ts` (+spec) | hosts the preview modal + `GenerationPreviewStore` (`:92`, `:610-624`), inline packs in scope `'wizard'` (P16) | Legacy duplicate selection/preview/packs → A2; P11 → dialog; P12 → PR-R1; P16 → `CommunityPacksPanel` |
| 14-15 | `agent-selection-list.component.ts` (+spec) | bound preview owner with decisions, target, `preview-required` re-open (`:161-162`, `:319-444`) | as before → A2 + `AnalysisStepStore`; P8 owner → `GenerationPreviewStore` (extended, B3a); P9 → `AnalysisStepStore.submit` |
| 31-32 | `completion.component.ts` (+spec) | outcomes via P17-P19 from `CompletionData.result` (`:135-147`, `:356-388`); close message now `:455-459` | as before → A3 terminal + A5; P17-P19 → A5 (direct) and A3 (via `AgentNextSteps` or direct) |

New rows (PR 832 files orphaned by the deletions above):

| # | File(s) | Why it is orphaned | Parity |
| --- | --- | --- | --- |
| 52-53 | `W/components/generation-preview-modal.component.ts` (+spec) | its only consumer is `agent-selection.component.ts` (row 12-13); `git grep GenerationPreviewModalComponent refs/remotes/pr/832 -- libs apps` finds no other non-spec user | P11 carried by the dialog; P12 per PR-R1 |

New total: **53 files deleted** = 50 production/spec files in the two libs (rows 1-48, 52-53) + 3 e2e
specs (rows 49-51).

Files PR 832 added that are **kept** (29 of its 31 new setup-wizard files):

- Reused through the barrel or a reused component: `completion/{outcome-summary,grade-expectation,library-stale-notice}.component.ts` (+specs), `utils/safe-failure-copy.ts` (+spec), `services/generation-preview.store.ts` (extended in B3a; gains a spec), `preview-decisions/*` (7 files + 7 specs, used by the dialog and the pack prompt), `pack-install-prompt.component.ts` (+spec), `pack-install/pack-install-result.ts` (+spec), `services/pack-install.store.ts` (+spec).
- Kept unchanged on purpose: `PackHostScope` keeps its `'wizard'` member after its last producer is deleted (AD8); `CompletionData.result` and its handler line (`setup-wizard-state.types.ts:134`, `wizard-phase-generation.ts:100`) stay with the message handling, and B5b's dead-member sweep must not remove `completionData` on the grounds that its readers were deleted (AD9).

## Updated batch file lists

Only B2, B3a, B3b and B5b change. B1, B4a, B4b, B5a: no change (PR 832 touches none of their files
and none of their contracts).

### B2 (additions)

- Files: `libs/frontend/setup-wizard/src/index.ts` also exports `safeFailureCopy`;
  `shared/item-status-card.component.ts` / `item-status-grid.component.ts` (+spec) per C-B2.
- Acceptance (replaces "item card status map (pending/running/written/unchanged/failed)"): all seven
  statuses of `ResumableGenerationAgent['status']` with the C-B2 labels; raw `error` never rendered.
- Import audit: `safeFailureCopy` exported **in B2** by this batch.

### B3a (changes)

- Remove: `analyze/overwrite-preview.component.ts`.
- Add: `W/services/generation-preview.store.ts` (binding), `W/services/generation-preview.store.spec.ts`
  (**CREATE**), `W/services/wizard-rpc.service.ts` (+spec; `previewGeneration` `tabBinding`),
  `setup-wizard/src/index.ts` (`GenerationPreviewStore`, `PreviewConfirmation`, `BoundAgentDecisions`).
- `choose-agents.page.ts` (+spec): C-A2 wiring. `analysis-step.store.ts` (+spec): C6 delta.
- Acceptance (replaces "preview sheet refreshed on open and before confirm"): the dialog opens with a
  fresh tab-bound comparison and every existing file on Keep; Keep all / Replace all; target change
  re-compares and resets to Keep; confirm re-compares and submits only if nothing reviewed changed;
  the submit carries the token, Replace entries and target; `preview-required` re-opens the dialog
  with the chosen root; confirm label from `confirmLabel('sidebar-dialog', n)`; community packs open
  the pack prompt with target choice and keep/replace (panel behaviour, smoke-checked in the page
  spec by presence only).
- Import audit additions: `GenerationPreviewStore`, `PreviewConfirmation`, `BoundAgentDecisions`
  exported **in B3a**; `AgentPreviewDialogComponent`, `CommunityPacksPanelComponent` already exported.

### B3b (additions)

- Files: `setup-wizard/src/index.ts` (completion exports); `generate-agents.page.ts`,
  `analyze-done.page.ts`, `generation-step.store.ts` (+specs) per C-B3b.
- Acceptance additions: one outcome summary per A3 terminal state; failed agents keep Retry; A5 shows
  the five counters, opened-folder notice, diverged Library copies with Open the Library (Electron,
  harness root), grade expectation and stale notice; nothing Library-related in VS Code.
- Import audit additions: completion components and `libraryReachable`, `OutcomeFileRow` exported
  **in B3b**.

### B5b (additions)

- Files: delete ledger rows 52-53; `generation-preview.store.ts` (+spec): `binding` becomes required
  on `open()` and the unbound preview path is removed (no unbound caller remains); the create-only
  error branch is removed (PR-R1 approved by the user).
- Acceptance additions: `git grep GenerationPreviewModalComponent` returns nothing; no
  `previewGeneration` call without `tabBinding`; `PackHostScope` unchanged.

## Shared-file ownership table delta

Rows added or changed (other rows unchanged):

| File | B1 | B2 | B3a | B3b | B4a | B4b | B5a | B5b |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `libs/frontend/setup-wizard/src/index.ts` | — | + `GenerationViewState` (type), **+ `safeFailureCopy`** | + runner, `findBoundGenerationTab`, **+ `GenerationPreviewStore`, `PreviewConfirmation`, `BoundAgentDecisions`** | + guidance store, result panel, **+ completion components, `libraryReachable`, `OutcomeFileRow`** | — | — | — | − deleted exports, − `provideSetupWizardFocusRouter` |
| `W/services/generation-preview.store.ts` (+new spec) | — | — | optional binding, bound error branch, spec created | — | — | — | — | binding required, unbound path removed (+ PR-R1 branch) |
| `W/services/wizard-rpc.service.ts` (+spec) | — | — | `previewGeneration(…, tabBinding?)` | — | — | — | — | − `launchWizard` (D13) |

Serial order **B1 → B2 → B3a → B3b → B4a → B4b → B5a → B5b is kept** (AD6). Every new edit lands in
a batch that already edits setup-wizard, and each new export lands in its first consumer's batch, so
no reordering is required and no batch imports a symbol that does not exist at its start.

## Verification matrix delta

No row changes its project list. B2, B3a, B3b and B5b already list `@ptah-extension/setup-wizard`,
`@ptah-extension/onboarding` and `ptah-extension-webview` with `ptah-electron` as `-t lint,typecheck`.
This task still edits no shared or backend file, so no host is added. The spec files that the new
work touches all live in those projects (`generation-preview.store.spec.ts`,
`wizard-rpc.service.spec.ts`, onboarding page and store specs) and run through the existing (F)
command. The header check ("Running target(s) … for N projects") is unchanged.

## Effects on D9

None in behaviour. Verified:

- `B/guidance-generation-run.supervisor.ts`, `B/enhanced-prompts-rpc.handlers.ts` and
  `enhanced-prompts.service.ts` are unchanged at 65499f2c, so every D9 citation into them
  (`:15-22`, `:81-85`, `:94-95`, `:139-180`; `:164-202`, `:262`, `:624`, `:882-897`, `:907-950`;
  `:314-319`, `:891-901`, `:1408-1409`, `:1460-1482`) stands. `response-parser.ts` is unchanged.
- The supervisor spec changes only a fixture (`keptCount: 0`, `changedSincePreviewCount: 0`,
  `guidance-generation-run.supervisor.spec.ts:43-44`), the new complete-payload fields.
- Re-cites only: supervisor singleton `register-shared-rpc-handlers.ts:68` → `:76`;
  `getBoundRunState` `:86-102` → `:131-147`; `getEnhancedPromptsStatus` `:445` → `:504`;
  `getEnhancedPromptContent` `:521` → `:580`. Signatures unchanged, so the `captureGuidanceSections`
  sequence (runless `L`, status, content, status, `L`) is unchanged. `GuidanceGenerationStore` and
  `EnhancedPromptsSummaryCardComponent` are unchanged, so the B3b narrowing and the user-approved
  losses stand.
- R12 is unchanged.

## Host impact

No new host change. The Library copy is Electron-only inside the reused components (`isElectron`
gating, `outcome-summary.component.ts:39-48`, `agent-next-steps.component.ts:157`, dialog and panel
`isElectron` inputs), so the VS Code webview shows decisions and outcomes without Library copy.
TUI and CLI: none (no Angular surface; PR 832's CLI changes are its own).

## Risks (new)

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R13 | PR 832 changes after 65499f2c (it is a draft, batches 19-26 outstanding) and edits setup-wizard or the rpc-setup contracts again | Medium / Medium | Rebase notes items 1-3 re-run the overlap diff before B1 starts; any new overlap gets a second addendum before code |
| R14 | A2 submits without a tab-keyed preview (for example a page that restores straight into submit) and every bound start is refused with `preview-required` | Medium / High (no generation) | Only the dialog's confirm path calls `submit`; the page re-opens the preview on `preview-required`; page spec covers it |
| R15 | The backend preview record is process-local and capped (`MAX_PREVIEW_RECORDS = 64`, `generation-preview.service.ts:88`); an Electron main restart between preview and confirm loses it | Low / Low | The refusal is `preview-required`, handled by R14's re-open |
| R16 | Two per-file outcome lists on A3 (cards and outcome summary) confuse users | Medium / Low | C-B3b "exactly one" rule; terminal grid lists only retryable failures |
| R17 | Raw backend error text (paths, tokens) leaks through an onboarding error line | Low / Medium | L-P4: `safeFailureCopy` on every rendered backend failure string; card spec asserts absence of the raw string |
| R18 | Design copy drift: onboarding spec says "Will overwrite" / "Unchanged", PR copy says keep/replace / "Already current" | Certain without AD1/AD5 / Low | AD1, AD5; visual review uses the PR copy |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| AD1 | A2's overwrite preview uses the PR's keep/replace copy and controls, not the design-spec "Will overwrite" tag and "Generate n agents (m overwrite)" label. Both positions: design-spec §3.2 A2 (`design-spec.md:112`, field table `:205`) was written against main, where the dialog showed `willOverwrite` as a tag (main `agent-preview-dialog.component.ts:64`). At 65499f2c every existing file defaults to Keep (`preview-decisions.state.ts:193`) and the server keeps it unless a Replace with the matching revision arrives (`generation-preview.service.ts:325-418`), so "Will overwrite" would be false. Resolution: the spec text is the artifact that changes; the plan follows the PR | Keep the spec copy (factually wrong after 832); map `willOverwrite` onto a new tag next to the controls (duplicates the state badge, `preview-decisions.state.ts:135-148`) | as listed | Yes (copy only) |
| AD2 | The A2 preview owner is the PR's `GenerationPreviewStore`, extended with an optional tab binding, exported in B3a | (a) Move `agent-selection-list`'s inline owner into `AnalysisStepStore` and export 8 pure helpers + 2 types from `preview-decisions.state.ts` (wide coupling to internals, a third copy of the owner logic); (b) leave the store unbound (backend refuses bound submits without a tab preview, `wizard-generation-rpc.handlers.ts:490`) | Two owner copies exist today (`agent-selection-list.component.ts:319-444`, `generation-preview.store.ts:39-204`); after B5b one remains; the store is the only `previewGeneration` caller (`git grep`) | Yes |
| AD3 | A2 renders `AgentPreviewDialogComponent`; `GenerationPreviewModalComponent` is deleted in B5b as an orphan | Reuse the modal (its error path is the unbound "Generate without preview", `generation-preview-modal.component.ts:320-323`; never exported) | The dialog is the PR's bound surface (doc `:52-57`), already exported (`index.ts:18`) and already in the plan's B3a import audit | Yes |
| AD4 | A3/A5 reuse the PR's completion sub-components; A3 shows exactly one outcome summary per state; terminal `ItemStatusGrid` lists only retryable failures | Keep the plan's cards as the only terminal view and hide the summary (needs a new input on the PR's `AgentNextSteps`, losing kept/changed/Library copy); show both lists | `AgentNextSteps` renders the summary whenever the bound run has outcomes (`agent-next-steps.component.ts:58-73`, `:160-163`) | Yes |
| AD5 | Item status labels for the five outcomes copy the PR's labels ("Already current", not the spec's "Unchanged") | Spec labels (two names for one state on one page) | `outcome-summary.component.ts:24-30` is on the same A3 page | Yes |
| AD6 | Serial batch order B1..B5b unchanged | Insert a "PR 832 alignment" batch | All edits fall in batches that already own setup-wizard files; exports follow L13 | Yes |
| AD7 | `safeFailureCopy` and the completion components are imported through the barrel, not copied into onboarding | Copy the helper (two sources of fixed copy) | `safe-failure-copy.ts:54-73`; onboarding → setup-wizard is the allowed direction (plan A1) | Yes |
| AD8 | `PackHostScope` keeps `'wizard'` after B5b | Narrow to `'sidebar'` (edits the PR's store and spec for no user-visible gain) | `pack-install.store.ts:21`; recorded as a follow-up candidate | Yes |
| AD9 | `SetupWizardStateService.completionData` and `CompletionData.result` stay | Remove with the completion page | They belong to the kept `generation-complete` message handling (`wizard-phase-generation.ts:87-103`); the plan's sweep is limited to step-navigation members | Yes |
| AD10 | D9 needs no change | — | "Effects on D9" | — |

## Lane-introduced constraints

Additions beyond the spec, the plan and the user decisions (each reversible):

| # | Constraint | Why |
| --- | --- | --- |
| L-P1 | `overwrite-preview.component.ts` is not created; A2 uses `AgentPreviewDialogComponent` | AD1, AD3 |
| L-P2 | `GenerationPreviewStore.open(…, binding?)` and `WizardRpcService.previewGeneration(…, tabBinding?)`; a bound confirm after a preview error re-compares (PR-R1 approved) | AD2; bound submits need a tab preview (`wizard-generation-rpc.handlers.ts:490`) |
| L-P3 | `ItemStatusCard` labels are a `Record` over `ResumableGenerationAgent['status']` (seven values) | P24; typecheck catches the next widening |
| L-P4 | Every backend failure string onboarding renders goes through `safeFailureCopy` with a fixed fallback; raw text only in the Details log transcript | PR rule B5 (`safe-failure-copy.ts:1-7`) |
| L-P5 | A3 shows exactly one outcome summary per terminal state | AD4 |
| L-P6 | A5 shows Library copy only when `libraryReachable`; "Open the Library" exits via `openSkillsDivergedClones()` after `completedAt` is written | P17-P20 |
| L-P7 | `generation-preview.store.spec.ts` is created in B3a (the PR ships the store without a spec) | Test the extended contract at its boundary |
| L-P8 | `AnalysisStepStore` drops `preview`/`refreshPreview`; `submit` takes the confirmed decisions | The preview is page-scoped (component-provided store) |

## Proposed Removals

**PR-R1: approved by the user on 2026-10-27 (option 1). A2 retries the comparison.**

| # | Capability | Source (65499f2c) | Why it is not carried | Options |
| --- | --- | --- | --- | --- |
| PR-R1 | "Generate without preview": after a failed preview, confirm starts a create-only generation (no token, no Replace, missing files only, chosen root honoured) | `W/services/generation-preview.store.ts:84-100`; copy `W/components/generation-preview-modal.component.ts:120-133`, label `:320-323` | It exists only in the legacy unbound wizard page, which this plan deletes (ledger 12-13). The PR's own bound flow does not offer it: its owner re-runs the comparison on confirm (`agent-selection-list.component.ts:335-338`). In a bound flow the server refuses a submit when no preview is recorded for the tab (`B/wizard-generation-rpc.handlers.ts:490`, `B/wizard-generation/generation-preview.service.ts:364-365`), and a failed preview records nothing, so the fallback would usually be refused | (1) **Approve (Recommended)**: A2 retries the comparison; the capability is removed with the legacy page. (2) Keep it in A2: the bound confirm after an error submits create-only; a `preview-required` refusal re-opens the preview. It works only when an earlier preview for the same tab succeeded |

No other capability is dropped. P11 (the modal) and P16 (legacy inline packs) are carried.

## Clarifications Needed

None open. Item 1 (PR-R1) was answered by the user on 2026-10-27: remove, Retry only.

1. PR-R1: may the "Generate without preview" fallback of the legacy wizard page be removed with that
   page?
   - (Recommended) Yes, remove it. A2 retries the comparison, matching the PR's own bound flow.
   - No, keep it in A2 as a create-only submit after a preview error, accepting that the server
     usually refuses it when no earlier preview succeeded in the same tab.

   Blocks only the bound error branch of `GenerationPreviewStore` (B3a) and the matching B5b
   cleanup. Implementation does not start before PR 832 merges, so the answer is needed before B3a.

## Rebase notes

Citations in this addendum are at `65499f2c`. After PR 832 merges and this branch is rebased onto
`main`, before B1 starts:

1. Re-run the overlap check against the merged result:
   `git diff --stat 65499f2c..main -- libs/frontend/setup-wizard libs/shared/src/lib/types/rpc libs/shared/src/lib/types/wizard libs/shared/src/index.ts libs/frontend/core libs/frontend/chat libs/frontend/chat-ui libs/frontend/harness-builder apps/ptah-extension-webview`.
   Empty → this addendum holds. Non-empty → amend it before code (R13).
2. Confirm the merged `libs/frontend/setup-wizard/src/index.ts` still exports
   `CommunityPacksPanelComponent`, `AgentPreviewDialogComponent`, `AgentNextStepsComponent` and
   none of the B2/B3a/B3b additions (a merged export would turn an addendum "add" into a no-op).
3. Re-cite every line in "Contract drift" and C-A2/C-B3b on the merged `main`; the shift is
   expected to be zero if 832 merges as is, non-zero if it is squashed with later batches. Check
   especially `wizard-rpc.service.ts` (`:131-147`, `:253`, `:504`, `:580`),
   `generation-workflow.store.ts` (`:15`, `:71`, `:104-143`, `:282-315`),
   `generation-preview.store.ts` (`:39-204`), `rpc-setup.types.ts` (`:65-74`, `:76-120`, `:352`,
   `:443-457`, `:535`, `:560-579`), `register-shared-rpc-handlers.ts:76`,
   `completion.component.ts:455-459`.
4. Re-verify the backend facts the design relies on, since 832's batches 19-26 touch the backend:
   bound submit `requirePreview: !!tabBinding` (`wizard-generation-rpc.handlers.ts:490`), preview
   keyed by `tabId` (`:1112`), and the D9 files (guidance supervisor, enhanced-prompts handlers and
   service) still unchanged versus `0e17912e3`.
5. Re-check orphan status: `git grep -l GenerationPreviewModalComponent -- libs apps` must list only
   the modal, its spec and `agent-selection.component.ts`; `git grep -l "previewGeneration("` only
   `generation-preview.store.ts`.
6. Re-run the plan's own parity check (B5b acceptance) against `parity-inventory.md` plus
   `parity-inventory.pr832.md`.
7. The specs the plan migrates that 832 edited (`generation-workflow.store.spec.ts`,
   `wizard-rpc.service.spec.ts`) are now the baseline; extend them, do not restore main's versions.
8. PR 832 lists `ptah-extension-webview:lint` as an accepted pre-existing failure. If it is still red
   on `main` after the merge, record it in each batch's test plan as pre-existing rather than fixing
   it inside this task.

### Post-merge revalidation (2026-10-28, main 35203f1d8)

Basis: PR 832 merged as `fdbb632da`; the branch is rebased onto `35203f1d8`. `git diff
fdbb632da 35203f1d8` touches no file below. Method: every `file:line` citation in the plan (basis
`0e17912e3`) and in this addendum (basis `65499f2c`) was mapped to HEAD through the `git diff -U0`
hunks, and each moved or touched range was opened at HEAD. Setup-wizard commits after `65499f2c`:
`f2a312631`, `9e25520c2`, `82cb4b699` (new narrow entry `@ptah-extension/setup-wizard/app`),
`762c1421d` (preview dialog becomes a native `<dialog>`). The rest of the `65499f2c..main` delta
in item 1 (278 files) is other PRs merged through `main`. It only shifts lines in the files below.

Results of items 1-8:

- Item 1: the diff is non-empty. This subsection is the amendment.
- Item 2: the barrel is unchanged since `65499f2c`. It still exports `CommunityPacksPanelComponent`
  (`:17`), `AgentPreviewDialogComponent` (`:18`) and `AgentNextStepsComponent` (`:22`), and none of
  the B2/B3a/B3b additions. `provideSetupWizardFocusRouter` is still at `:10`.
- Items 3-4: see the table. `wizard-rpc.service.ts`, `generation-workflow.store.ts`,
  `generation-preview.store.ts`, `wizard-analysis-runner.service.ts`, `rpc-setup.types.ts`,
  `rpc-setup-decisions.types.ts`, `phase.ts`, `wizard-generation-rpc.handlers.ts` and
  `generation-preview.service.ts` are byte-identical to `65499f2c`. `:490` is still
  `requirePreview: !!tabBinding` and `:1112` is still `key: previewKeyFor(binding?.tabId)`. The D9
  files (guidance supervisor, `enhanced-prompts-rpc.handlers.ts`, `enhanced-prompts.service.ts`)
  are unchanged versus `0e17912e3`.
- Item 5: `GenerationPreviewModalComponent` is found only in the modal, its spec and
  `agent-selection.component.ts`. `previewGeneration(` is found in `generation-preview.store.ts`,
  plus its definition in `wizard-rpc.service.ts` and that file's spec. Both match the expectation.
- Items 6-8: not run in this pass. They are B5b acceptance and per-batch test-plan items.

| Plan citation | Old location | Current location (HEAD) | Impact |
| --- | --- | --- | --- |
| `S/rpc.types.ts:1253-1256` (`enhancedPrompts:getPromptContent`, D9) | `0e17912e3` `:1253-1256` | `:1290-1293`, same shape `{ workspacePath } → { content: string \| null; error? }` | citation-only |
| `S/rpc.types.ts:1103-1106`, `:3187` (`wizard:plan-pack-install`) | `65499f2c` | `:1129-1132`, `:3234` | citation-only |
| `register-shared-rpc-handlers.ts:76` (guidance supervisor singleton) | `65499f2c` `:76` | `:79`, still `registerSingleton(GuidanceGenerationRunSupervisor)` | citation-only |
| `completion.component.ts:455-459` (`SETUP_WIZARD_COMPLETE`, L7) | `65499f2c` | `:458-462` (`MESSAGE_TYPES.SETUP_WIZARD_COMPLETE` at `:460`); still deleted in B5b | citation-only |
| `outcome-summary.component.ts:24-30` (five labels, C-B2, AD5) | `65499f2c` | `:15-21` (`OUTCOME_LABELS`), labels unchanged | citation-only |
| `outcome-summary.component.ts:39-48` (`libraryReachable`, `OutcomeFileRow`) | `65499f2c` | moved to `W/components/completion/outcome-rows.ts` (`OutcomeFileRow` `:10-17`, `libraryReachable` `:24-30`). `outcome-summary` imports both and does not re-export them. | citation-only. B3b's barrel exports `libraryReachable` and `type OutcomeFileRow` from `./lib/components/completion/outcome-rows`. `completion/outcome-rows.ts` joins the B5b "reused through the barrel" list. |
| `agent-next-steps.component.ts:58-73` (summary + grade + stale block) | `65499f2c` | `:58-76`. The block now sits inside `@defer (on immediate)` (`:61`); its inputs are unchanged. | citation-only. Onboarding page specs that assert `ptah-outcome-summary` through `AgentNextSteps` must let the defer block render. |
| `agent-next-steps.component.ts:32-39`, `:157`, `:160-163`, `:160-191`, `:165-178` | `65499f2c` | `:32-39` unchanged; `:160` (`isElectron`), `:163-166`, `:163-194`, `:168-181` | citation-only |
| `agent-preview-dialog.component.ts:271-285` (inputs/outputs) | `65499f2c` | `:290-304`. The same 8 inputs and 5 outputs. Since `762c1421d` it renders as a native `<dialog>` (`showModal()`) in the top layer. | citation-only. `libs/frontend/onboarding/src/test-setup.ts` needs the `HTMLDialogElement` `showModal`/`close` stub that `setup-wizard/src/test-setup.ts:8-15` added, for `choose-agents.page.spec.ts` (B1 creates the file; the stub lands no later than B3a). |
| `agent-selection-list.component.ts:161-162`, `:319-444`, `:335-338`, `:362-415` | `65499f2c` | `:159-160`, `:318-443`, `:334-337`, `:361-414` | citation-only |
| `community-packs-panel.component.ts:194` (pack prompt) | `65499f2c` | `:195-202`, prompt inside `@defer (when request() !== null)` | citation-only |
| `app.routes.ts:9-12` (old static imports) | `0e17912e3` | same lines; they now import from `@ptah-extension/setup-wizard/app` | citation-only. B5b file list grows; see the note below. |
| `app.routes.ts:81-98`, `:99-112`, `:127-162`, `:231-232` | `0e17912e3` | unchanged | none |
| `app.config.ts:90-107`, `:101-107` ("`setup-wizard` is eager, wide barrel") | `0e17912e3` | `:91-103`, `:97-103`. Eager code now imports the narrow `/app` entry (comment `:91-96`). | citation-only. For plan l.46 and l.118, read "narrow `/app` entry" instead of "wide barrel". setup-wizard is still eager and still hosts `MESSAGE_HANDLERS`, so D1 holds. |
| `app.config.ts:47-60`, `:189-191`, `:220-226`, `:232-238`, `:240-248`, `:394-397` | `0e17912e3` | `:48-61`, `:188-190`, `:219-225`, `:231-237`, `:239-247`, `:393-396` | citation-only |
| `eslint.config.mjs:258-287`, `:279-287` (dynamic-import exceptions) | `0e17912e3` | `:258-292`, `:279-292` (`@ptah-extension/shared` added at `:287-291`) | citation-only |
| `eslint.config.mjs:298-300`, `:408-416` | `0e17912e3` | `:303-305`, `:413-421` | citation-only |
| `tsconfig.base.json:202-206` | `0e17912e3` | `:205-209`; new path `@ptah-extension/setup-wizard/app` at `:236-238` | citation-only |
| `electron-shell.component.ts:534-550`, `:288-306`, `:616-618` | `0e17912e3` | `:588-604`, `:295-313`, `:678-680` (content identical) | citation-only |
| `setup-status.store.ts:9-60`, `:112-125`, `:117` | `0e17912e3` | class `:54`, `launchWizard` `:217-230`, `setup-wizard:launch` call `:222`. The store now has three checks (Skills, Scan, Agents) and a separate `scanError` signal (`2af42c828`). | citation-only. D13 holds. Home "Status unavailable, Retry" should treat `error` or `scanError` as a failed chip. |
| `S/rpc/rpc-setup.types.ts` (all), `S/rpc/rpc-setup-decisions.types.ts`, `S/wizard/phase.ts` | `65499f2c` | unchanged | none |
| `W/services/*` (`wizard-rpc.service.ts`, `generation-workflow.store.ts`, `generation-preview.store.ts`, `wizard-analysis-runner.service.ts`, `pack-install.store.ts`), `W/utils/safe-failure-copy.ts`, `preview-decisions/*`, `pack-install-prompt.component.ts` | `65499f2c` | unchanged | none |
| `B/wizard-generation-rpc.handlers.ts:479-490`, `:490`, `:1078-1117`, `:1112`; `B/wizard-generation/generation-preview.service.ts:88`, `:325-418`, `:364-365`; `guidance-generation-run.supervisor.spec.ts:43-44` | `65499f2c` | unchanged | none |
| `setup-wizard/src/index.ts:10`, `:17`, `:18`, `:22`, `:37`, `:38`, `:40` | `65499f2c` | unchanged | none |
| `app-state.service.ts` (all plan citations, `:1082`), `message-dispatch.service.ts:181-229`, all other plan citations in `core`, `chat`, `chat-ui`, `harness-builder`, `shared` | `0e17912e3` | unchanged at the cited lines | none |
| `_router-chunk.mjs:1879-1883` (Angular router v22.2.3) | `0e17912e3` | the installed version is still 22.2.3 | none |

Totals: 19 citation-only rows, 7 rows with no change, 0 decision-affecting.

**Webview 4 MB budget (`@defer`).** The plan does not undo the fix:

- `/onboarding` is a `loadChildren` entry (plan §A2). Onboarding's static imports of the wide
  `@ptah-extension/setup-wizard` barrel (dialog, packs panel, completion components, stores) land in
  the lazy chunk, not in the initial bundle.
- The eager edges are `app.routes.ts`, `app.config.ts` and `initial-navigation.ts`. They reach only
  `@ptah-extension/onboarding/services`. The plan stages these contents in it: flag, tracker,
  guard, first-run provider and the focus router. None of them needs setup-wizard. The two routers
  being merged import only `@angular/core`, `@ptah-extension/chat-state` and
  `@ptah-extension/core` (`setup-wizard-focus-router.service.ts:1-3`,
  `harness-builder-focus-router.service.ts:1-3`).

Constraint added to B1 and B5a acceptance: nothing reachable from `onboarding/src/services.ts`
imports `@ptah-extension/setup-wizard` (wide or `/app`). Check it with
`git grep -n "@ptah-extension/setup-wizard" libs/frontend/onboarding/src/services.ts
libs/frontend/onboarding/src/lib/first-run libs/frontend/onboarding/src/lib/focus`; the expected
result is empty. The reused components keep their own `@defer` blocks inside the onboarding chunk.

**File-list additions (no decision change).** These come from `82cb4b699` and are needed for
`B5b`:

- `libs/frontend/setup-wizard/src/app.ts` (MODIFY). Drop the exports of
  `WizardViewComponent`, `GenerationWorkflowShellComponent` and `provideSetupWizardFocusRouter`,
  because their files are deleted (ledger rows 1, 16-17, 35-37).
- `apps/ptah-extension-webview/src/app/setup-wizard-entry.spec.ts` (MODIFY). Trim
  `ALLOWED_EXPORT_SOURCES` to match. After B5b, `app.routes.ts` imports no setup-wizard entry, so
  its `it.each` case (`toBeGreaterThan(0)`) would fail. Keep the `app.config.ts` case, which still
  imports `SetupWizardStateService`, `SetupGenerationOpenHandler`, `GenerationRunEventAdapter` and
  `provideWizardInternalState` from `/app`. Replace the `app.routes.ts` case with a check that it
  imports no wide `@ptah-extension/setup-wizard`.
- B5a removes `provideSetupWizardFocusRouter` from the `/app` import in `app.config.ts`. The
  remaining setup-wizard import must stay on `/app`, because the spec above pins it.
- `tsconfig.base.json`'s `@ptah-extension/setup-wizard/app` path stays.

Decision-affecting items: none. No new clarification is needed. PR-R1 and AD1-AD9 stand as
approved.

## Review r0 follow-ups (orchestrator)

- Codex review r0: APPROVED (`implementation-plan.addendum-pr832-review.md`). Non-blocking 1 and 2
  applied above for the approved PR-R1 branch: the tests are split by record state, and the error
  state uses Retry copy. Non-blocking 3: B3a's changed setup-wizard files include
  `generation-preview.store.ts` and `wizard-rpc.service.ts` (plus specs), not only `index.ts`. The
  base plan's B3a verification commands already cover them, so no project or target changes.
