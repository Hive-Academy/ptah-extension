# P2 fix round, frontend: TASK_2026_701_9e4b

Scope: `libs/frontend/setup-wizard/src/lib/**` only (L below). Findings fixed: B1, B2 + B4, S1-frontend, M1, B5. B3, B6, B7 and B8 were deferred (D32) and are not touched. No git commands were run. The working tree is left dirty.

## Files

- CREATED `L/services/pack-install.store.ts`: root `PackInstallStore`. It owns the pack install operation and the terminal per-file outcomes.
- CREATED `L/services/generation-preview.store.ts`: component-scoped `GenerationPreviewStore`. It owns the generation preview state and transitions.
- CREATED `L/components/pack-install/pack-install-result.ts`: pure pack-result types and functions (M1).
- CREATED `L/utils/safe-failure-copy.ts`: maps failure kinds to safe copy (B5).
- CREATED specs: `L/services/pack-install.store.spec.ts`, `L/components/pack-install/pack-install-result.spec.ts`, `L/utils/safe-failure-copy.spec.ts`.
- MODIFIED: `agent-selection.component.ts`, `pack-install-prompt.component.ts`, `community-packs-panel.component.ts` and `completion/outcome-summary.component.ts`, plus each of their specs.
- The lib `index.ts` is unchanged. No new public export was needed.

## B1 (Serious): "Generate without preview" keeps the chosen target

- `L/services/generation-preview.store.ts:91-101` (`confirm`): after a preview failure, the confirm returns `{ fileDecisions: {}, target }` when the user explicitly chose a root (`targetChoice`). It sends no `previewToken`. With no explicit choice it still returns `undefined`, so the server default is unchanged.
- `L/components/agent-selection.component.ts` `onConfirmPreview` submits whatever the store settles on. `wizard-rpc.service.ts` already forwards `target` and `fileDecisions` without a token (`boundDecisionFields`), so it is unchanged.
- The contract carries a target without a token. `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts:328-372` (`validateDecisions`) resolves `request.target` and returns create-only guards when no token is valid. The fallback therefore stays enabled.
- Tests, in `agent-selection.component.spec.ts`, `it.each(['preview','confirm'])` "keeps the chosen opened-folder target ... (B1)":
  - Preview failure: the target change re-preview fails, then the user confirms.
  - Confirm-time failure: the target change succeeds, the confirm re-preview fails, then the user confirms.
  - Both assert `submitAgentSelection` arg 3 `== { fileDecisions: {}, target: 'opened-folder' }`.
  - The existing default-target case still asserts that no decisions argument is sent.

## B2 + B4 (Serious + Moderate): the store owns the operation and outcomes

- `PackInstallStore` (`L/services/pack-install.store.ts:69`, `providedIn: 'root'`):
  - `install(scope, job)` (`:118`) marks the files `installing` synchronously and calls `installPackAgents`. It turns a thrown transport error into a failed result and always settles with a terminal result (`settle`, `:174`). It never rejects.
  - Per-file record: `state` (`installing | installed | kept | failed`), the server `outcome` (`written | unchanged | kept | changed-since-preview | failed`), safe `failure` copy, and the `target` roots.
  - Also kept: the last result per pack source and the last target roots.
  - Readers: `fileState`, `failure`, `result`, `targetInfo`, `lastTarget`, `isInstalling(scope, source?)`, `installedCount`.
  - History is kept per host scope (`'wizard' | 'sidebar'`), as before (see Decisions).
- Prompt (`pack-install-prompt.component.ts`):
  - The new required input `scope` is at `:205`.
  - Confirm hands `{ request, plan, decisions }` to `store.install` (`:354`) and emits `dismissed` (`:359`). Closing the modal never cancels the operation.
  - The outputs `installStarted` and `installFinished` were removed.
  - Every newly opened prompt still re-plans and starts every row on Keep. The store holds no keep/replace choice, so no consent is manufactured from stored state.
- Wizard host (`agent-selection.component.ts`):
  - Reads status, Kept, failure, results, the last target and the "Install to" label from the store (`packStore`, `:693`).
  - `getAgentStatus` now returns `'kept'` as a real terminal state. Before, kept was recorded as `idle` in the wizard state.
  - The Community badge count comes from `packStore.installedCount('wizard')`.
- Sidebar host (`community-packs-panel.component.ts`):
  - Its local `statuses`, `failures`, `results` and `target` signals were removed. It reads the store (`:216`, scope `sidebar`).
  - `busy` = prompt open || `store.isInstalling('sidebar')`.
- Tests:
  - `community-packs-panel.component.spec.ts` "install outlives the panel (B2, B4)":
    - Success settles while the panel is destroyed, and the re-created panel shows Installed. Install and Install All are not disabled.
    - Kept and failed settle while re-created. They are restored after a second re-creation, Retry and Install All are enabled, and a new prompt starts on Keep.
  - `agent-selection.component.spec.ts` "install outlives the component (B2, B4)": a terminal success while destroyed is restored; a terminal failure while destroyed is restored safely with Install All and Choose location enabled, and a new prompt starts on Keep; Kept (`changed-since-preview`) is restored after re-creation.
  - `pack-install.store.spec.ts` covers synchronous `installing` and the per-file outcomes, scope separation, a rejected transport reaching a terminal failure, and partial-failure copy.

## S1-frontend (Serious): workflow state out of the component

- The pack workflow moved to `PackInstallStore`. The generation-preview state and transitions moved to `GenerationPreviewStore`: open, cancel, confirm with the confirm-time re-preview and `needsReview`, row and bulk decisions, target change, the request sequence guard, and `submitDecisions`. `GenerationPreviewStore` is provided on the component (`agent-selection.component.ts:92`), so it resets with the component as before.
- The component keeps the bindings, the `isGenerating` guards, `confirmGenerate` (submission and step navigation) and the pre-existing selection and category logic.
- The duplicated "Install to" computeds in both hosts became one pure `installToLabel` (`pack-install-result.ts:169`).
- ESLint-counted lines (`max-lines` options: skipComments, skipBlankLines; isolated count with `@typescript-eslint/parser`):

| File | Before | After | Physical after |
| --- | ---: | ---: | ---: |
| `agent-selection.component.ts` | 1,121 (1,350 physical) | **952** (below the pre-P2 955) | 1,152 |
| `pack-install-prompt.component.ts` | n/a (524 physical) | 359 | 400 |
| `community-packs-panel.component.ts` | 319 | 261 | 288 |
| `services/pack-install.store.ts` | new | 154 | 200 |
| `services/generation-preview.store.ts` | new | 159 | 204 |
| `components/pack-install/pack-install-result.ts` | new | 133 | 179 |
| `utils/safe-failure-copy.ts` | new | 56 | 73 |

## M1 (Minor): pure pack-result module

- `L/components/pack-install/pack-install-result.ts` holds:
  - Types: `PackInstallRequest`, `PackFileStatus` and `PackInstallFinished`. `PackInstallFinished` now carries `outcomes` and the safe `failure` instead of the raw `error`.
  - Constants: `KEPT_PACK_NOTE` and `INSTALL_FAILED_FALLBACK`.
  - Functions: `packFileOutcomes`, `packFileStatus`, `packFileStatuses`, `packInstallFinished`, `packResultCounts`, `openedFolderNotice` and `installToLabel`.
- The prompt, both hosts and the store import it. Nothing imports result logic from the prompt component any more, and there is no re-export shim.
- The helper tests moved from the prompt spec to `pack-install/pack-install-result.spec.ts`, with a new `installToLabel` case.

## B5 (Moderate): no raw errors rendered

- `L/utils/safe-failure-copy.ts`:
  - `failureKind(raw)` classifies a raw error as one of timeout, permission, disk-full, partial (`N file(s) failed to install`), plan-expired, offline, not-found or unknown.
  - `safeFailureCopy(raw, fallback)` returns fixed copy for a known kind and the caller's fallback otherwise. The output never contains any part of `raw`.
- Pack surfaces (wizard `:429`, sidebar `:119`, per-file "Not installed." rows) render `finished.failure` or `store.failure(...)`, which is always safe copy. The fallback is `The install could not be completed. Try again.` A partially failed file in a run reported as successful now gets the failure copy instead of an empty reason.
- Raw detail goes only to `console.warn('[PackInstallStore] pack install failed', { source, error })` (`pack-install.store.ts:144`). This is the same diagnostic channel `WizardRpcService` already uses.
- `outcome-summary.component.ts:127` / `:223` renders `failureText(row)` with the fallback `The write failed.`. `OutcomeFileRow.error` stays an input, documented as never rendered.
- The plan-failure alert in the prompt and the `errorMessage` banner in `agent-selection` were already fixed strings.
- Secret-bearing and HTML-looking strings are tested separately in `safe-failure-copy.spec.ts`, `pack-install.store.spec.ts` (`it.each`, raw only in the log), `community-packs-panel.component.spec.ts` (`it.each`, text, innerHTML and no `<img>`), `agent-selection.component.spec.ts` (destroyed-host failure with a token and `<script>`) and `outcome-summary.component.spec.ts` (`it.each`).

## Verification

```
npm run verify -- -t test -p @ptah-extension/setup-wizard -- --testPathPatterns=agent-selection --testPathPatterns=pack-install --testPathPatterns=community-packs-panel --testPathPatterns=outcome-summary --testPathPatterns=safe-failure-copy
```

- Result: `NX   1 task: 1 succeeded`.
- Jest summary from the Nx terminal output: `Test Suites: 8 passed, 8 total` / `Tests: 118 passed, 118 total`.
- The first run failed one existing test, "should prevent re-entry while generating". It relied on a single microtask hop before the in-flight submit, and delegating to the store adds one await layer. The test now waits one macrotask. Its assertion is unchanged: one submit, and the second confirm is a no-op.

```
npm run verify -- -t typecheck,lint -p @ptah-extension/setup-wizard
```

- Result: `NX   2 tasks: 2 succeeded`.
- The first lint run failed with one error, `@angular-eslint/use-injectable-provided-in` on the component-scoped `GenerationPreviewStore`. It is fixed with a justified `eslint-disable-next-line`, following the precedent in `libs/frontend/command-center/src/lib/model/session-coordinator.ts:16`.
- Lint warnings are only the existing repo-wide `explicit-member-accessibility` style.

Not run: build, serve, e2e, workspace-wide checks and host-app projects. The orchestrator runs the combined verify. No public export of the lib changed, and the removed prompt outputs were used only inside this lib. The visual review is deferred (D31).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep pack history per host scope (`wizard`, `sidebar`) in one root store. | One shared history for both hosts; per-host scopes. | Before P2 the hosts kept separate state: the wizard used `SetupWizardStateService.agentInstallStatus` and the sidebar used local signals, each with its own last target. A shared history would newly bleed targets and outcomes between surfaces, and destination keying is B3, which is deferred. | Yes: drop the scope parameter. |
| Make the store the source of truth and stop writing `SetupWizardStateService.agentInstallStatus`; the wizard badge reads `packStore.installedCount('wizard')`. | Mirror into the wizard state as well; store only. | Mirroring creates two sources of truth. `SetupWizardStateService.reset()` would clear the mirror but not Kept or failed, giving inconsistent rows. The only consumers were `agent-selection` (lib-wide grep). | Yes |
| Install outcomes survive a wizard `reset()`. | Clear on reset (would need the state service to inject the store, a circular dependency); keep. | The files are on disk, so the last result stays truthful. No reset hook exists without a circular DI. | Yes |
| Make `GenerationPreviewStore` component-scoped (`@Injectable()` plus `providers`), not root. | Root; component-scoped. | Before, the preview state lived and reset with the component; root would keep an open preview across navigation. There is repo precedent for a scoped injectable with a justified disable. | Yes |
| B1 fallback sends `{ fileDecisions: {}, target }` only when a root was explicitly chosen. | Always send `target`; send only an explicit choice; disable the fallback. | The backend `validateDecisions` honours `target` without a token (create-only guards). Leaving the absent-choice case as it was keeps the server default and the existing spec. | Yes |
| B5 copy is classified on the frontend from free-text errors. | Ask for error codes in the shared contract (out of scope: `libs/shared`); classify on the frontend with a generic fallback. | `WizardInstallPackAgentsResult.error` is a free string (`rpc-setup.types.ts:713`). The task forbids shared contract changes. Classification never echoes the input. | Yes: switch to codes when the contract has them. |
| Prompt Confirm emits `dismissed` (one output for every close) instead of a separate start event. | Keep `installStarted`; reuse `dismissed`. | Hosts only cleared `request` on start, and the operation now lives in the store. | Yes |

## Proposed Removals

- `SetupWizardStateService.setAgentInstallStatus`, `agentInstallStatus` and `installedCommunityAgentCount`, together with their internal-state, community-packs-state and computeds plumbing, have no production writer or reader left in the repository (grep over `apps/` and `libs/`). They are not removed in this round because they are public API of an exported state service. Proposal: remove them in TASK-P2-FOLLOWUP.

## Not done / out of scope

- B3, B6, B7, B8 and the completion rows in `parity-inventory.md` are deferred per D32.
- Out-of-scope observation: `L/components/completion.component.ts:159-160` still renders `completion().errors` raw (`{{ error }}`). This is the same B5 class, but the file was not in the B5 list. Recommend routing it through `safeFailureCopy` in the follow-up.

## Clarifications Needed

None.
