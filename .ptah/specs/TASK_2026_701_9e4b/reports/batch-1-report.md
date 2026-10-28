# Backend implementation: `TASK_2026_701_9e4b`, batch 1 (B1, shared contracts)

**Tasks completed**: Task 1.1. One plan item is deferred: the outcome-union widening. The reason is under Decisions D-B1-1.

**Verdict**: Every target that this batch's code can affect passes. The worktree has no `node_modules`, and that breaks Jest suites in seven projects. One webview lint error was already there before this batch. Both problems are explained below.

## Files

Root: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`

- CREATED `libs\shared\src\lib\types\rpc\rpc-setup-decisions.types.ts`
  - `LocalFileState`, `PackFileState`, `FileDecision`, `FileDecisionEntry`
  - `GenerationTargetChoice`, `GenerationTargetInfo`
  - `AgentModelOrigin`, `AgentModelPreview`
  - `FileOutcome`, `LibraryPassStatus`, `GenerationRivalStatus`
  - `PackFilePlan`, `WizardPlanPackInstallParams`, `WizardPlanPackInstallResult`, `PackFileOutcome`
- CREATED `libs\shared\src\lib\types\library-provenance.ts`
  - Types: `LibraryProvenance`, `LibraryPluginState`, `DivergedReason`.
  - Pure functions: `provenanceLabel()`, `divergedReasonText()`, `orphanedText()`.
  - The returned strings are the exact text of design-spec section 5.
- CREATED `libs\shared\src\lib\types\library-provenance.spec.ts`. It covers every variant, including null and undefined.
- CREATED `libs\shared\src\lib\types\origin-sidecar.types.spec.ts`. It parses a sidecar with the new fields and one without them (the older format), and checks that a malformed `sourceRef` is rejected.
- CREATED `libs\shared\src\testing\fixtures\library-agreement.ts`
  - `makeLibraryAgreementFixtures()` returns the 8 scenarios, as fresh copies on every call:
    1. plugin with skills and agents
    2. shadowed skill
    3. shadowed agent
    4. community skill
    5. turned-off plugin with an edited clone
    6. uninstalled plugin with an edited clone (display name differs from the id)
    7. diverged after a plugin update
    8. two external plugins with the same basename `toolkit`
  - Also exports `LIBRARY_AGREEMENT_SCOPE_ROOT`.
  - It imports only shared types.
- MODIFIED `libs\shared\src\testing\index.ts`: exports the fixtures and their types.
- MODIFIED `libs\shared\src\testing\index.spec.ts`: new export case. It checks that every scenario comes back fresh, that each one has `scopeRoot`, and that `expectedLabels` equals `provenanceLabel()` for each clone.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-setup.types.ts`. All additions are optional fields:
  - `WizardPreviewGenerationParams.target`
  - `GenerationPreviewFile.localState`, `.revision`
  - `GenerationPreviewAgent.agentModel`, `.libraryCopyEdited`, `.unchangedSinceWizardWrite`
  - `WizardPreviewGenerationResponse.previewToken`, `.target`, `.rivalStatus`
  - `WizardSubmitSelectionParams.previewToken`, `.fileDecisions`, `.target`
  - `WizardInstallPackAgentsParams.planToken`, `.decisions`, `.target`
  - `WizardInstallPackAgentsResult.files`, `.libraryPass`
  - `SetupGenerationResultFacts.counts.kept`, `.counts.changedSincePreview`, `.target`, `.libraryPass`, `.libraryDiverged`
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-skill-clone.types.ts`: `CloneSummary.provenance`, `.divergedReason`, `.conflictsWith`, and `SkillSynthesisListClonesResult.scopeRoot`. All optional.
- MODIFIED `libs\shared\src\lib\types\origin-sidecar.types.ts`: `sourceRef` and `sourceLabel` as `z.string().optional()`.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-plugin-marketplace.types.ts`
  - New types: `LocalItemFamily`, `ExternalLocalItemKind`, `ExternalLocalItem` (has no digest or hash field), `KeptItemReason`, `KeptItem`, `PluginsReplaceKeptItemsParams`, `PluginsReplaceKeptItemsResult`.
  - New optional fields: `ExternalInstallPlan.localItems`, `ExternalInstallParams.localItemDecisions`, `ExternalInstallResult.kept`, `.replaced`, `.libraryPass`.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-misc.types.ts`
  - New optional `PluginInfo` fields: `agentCount`, `skillNames`, `agentNames`, `commandNames`.
  - New types: `PluginConfigHomeCandidate`, `PluginConfigHomeStatus`, `PluginConfigStateWithHome`, `PluginsResolveConfigHomeParams`, `PluginsResolveConfigHomeResult`.
- MODIFIED `libs\shared\src\lib\types\rpc.types.ts`
  - Re-exports `rpc-setup-decisions.types` next to `rpc-setup.types`.
  - Widens existing result types only, with optional fields:
    - `plugins:get-config` now returns `PluginConfigStateWithHome`.
    - `plugins:save-config` and `skillsSh:install` gain `kept?: KeptItem[]` and `libraryPass?`.
  - **No new entries** in the method map or the true-map (A33).
- MODIFIED `libs\shared\src\lib\types\messages\message-constants.ts`: `LIBRARY_CHANGED: 'library:changed'`.
- MODIFIED `libs\shared\src\lib\types\messages\payload-map.ts`: `LibraryChangedPayload {workspaceRoot, status: 'updated' | 'failed', reasons}` and its map entry `'library:changed'`.
- MODIFIED `libs\shared\src\index.ts`: exports `./lib/types/library-provenance`. The messages and `rpc.types` exports were already in this barrel.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-setup-generation.contract.spec.ts`
  - Type assertions: `FileOutcome` is exactly the five-member union. `GenerationAgentOutcome['status']` stays the three-member union for now.
  - New runtime case covering decision params, `kept` and `changedSincePreview` counts, per-file pack outcomes, `libraryPass` and a pack plan.
- Not touched: `libs\shared\src\lib\types\harness-sync.types.ts` (TL4) and `libs\shared\src\lib\types\wizard\phase.ts`. `phase.ts` was edited and then fully reverted, so its net diff is empty.

## Stack observed

- **Library**: `@ptah-extension/shared` is pure TypeScript types plus Zod only at file boundaries (`origin-sidecar.types.ts`). Domain files are re-exported through the `rpc.types.ts` barrel.
- **Tests**: Jest, colocated `*.spec.ts`.
- **Contract-spec pattern**: `Assert<Equal<...>>` type assertions (`rpc-setup-generation.contract.spec.ts`).
- **Fixture pattern**: `testing/fixtures/dashboard-spec.ts`.

## Verification

Command:

```
npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview
```

- **Header**: this verify script prints no "Running target ... for N projects" line. It printed `lock acquired ...: verify lint,test,typecheck (` followed by all 8 projects, then `NX 71 tasks`.
- **Final run**: `71 tasks: 63 succeeded, 2 cached, 8 failed`, exit 1.

Results per target:

| Project | lint | typecheck | test |
| --- | --- | --- | --- |
| @ptah-extension/shared | pass | pass | pass |
| @ptah-extension/rpc-handlers | pass | pass | FAIL: environment |
| @ptah-extension/setup-wizard | pass | pass | FAIL: environment |
| ptah-electron | pass | pass | FAIL: environment |
| ptah-extension-vscode | pass | pass | FAIL: environment |
| ptah-cli | pass | pass | FAIL: environment |
| ptah-tui | pass | pass | FAIL: environment |
| ptah-extension-webview | FAIL: already there before this batch | pass | FAIL: environment |

**Environment failures (test targets).** The worktree has no `node_modules` directory; packages resolve from the parent checkout. Jest's moduleNameMapper points at `<worktree>\node_modules\marked\lib\marked.umd.js`, which does not exist. As a result:

- Every failed suite reports `Could not locate module marked mapped as: ...`. That accounts for:
  - rpc-handlers: 90 suites
  - setup-wizard: 9
  - webview: 7
  - vscode: 9
  - cli: 36
  - tui: 1
  - electron: 18 of its 20 failed suites
- The other 2 Electron suites (`better-sqlite3-packaging.spec.ts` and the Electron shell CSP spec) fail with `ENOENT ...\node_modules\electron\package.json` or `...\electron\path.txt`.
- No assertion failed in any suite that loaded. The test counts all pass: rpc-handlers 2280, setup-wizard 386, webview 475, vscode 95, cli 433, tui 345. The only Electron test failures are the 8 cases that hit `node_modules\electron`.
- Fix: the team-leader installs or links `node_modules` in the worktree and re-runs. I did not change the environment.

**Webview lint (already there before this batch).** `app.routes.ts:224` reports a circular dependency `ptah-extension-webview -> @ptah-extension/command-center`. It comes through `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts`. No file in that chain is touched by this batch.

**First run.** Before the deviation below, typecheck failed in rpc-handlers, setup-wizard, webview and every host. It passed in the final run.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | --- | --- | --- | --- |
| D-B1-1 | Defer widening `GenerationAgentOutcome.status` (`wizard/phase.ts`) and `ResumableGenerationAgent.status` (`rpc-setup.types.ts`) to `kept` / `changed-since-preview`. `FileOutcome` is defined and exported now, and the batch that updates the consumers widens the union to it. | (a) widen in B1 and edit the consumers; (b) defer, the same way TL4 deferred `changed-since-approval` | The first verify run broke typecheck at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:430` (the checkpoint record is not assignable to `GenerationAgentCheckpoint`) and `libs/frontend/setup-wizard/src/lib/components/completion.component.ts:416` (the `AgentOutcomeTile` status union). Both files are outside this batch, and the batch rule says to report rather than edit. The contract spec pins the current union so the later batch must flip it on purpose. | yes |
| D-B1-2 | `LibraryProvenance` and `DivergedReason` are discriminated unions. A plugin provenance carries `name` and `state: 'active' \| 'turned-off' \| 'uninstalled'`. `divergedReasonText` returns null for `source-changed`. | string enums plus separate name fields | Design 3.6 maps labels by recorded marker and gives turned-off and uninstalled different copy. Design section 5 has no copy for a generic source change (A11 `source-changed`). | yes |
| D-B1-3 | `ExternalInstallResult.replaced` is typed `ExternalLocalItem[]`, not `KeptItem[]`. | `KeptItem[]` | `KeptItem.reason` has no `library-clone` or `agent-source` value, and both can be replaced through the consent plan. | yes |
| D-B1-4 | `ExternalLocalItem.family` reuses the installer family union (`LocalItemFamily`) that `KeptItem` uses. | an entry-kind union | Plan :796 records `family` on the approval as the installer family; :823 says items are replaced only through their own family's route. | yes |
| D-B1-5 | The `plugins:get-config` result is the named type `PluginConfigStateWithHome`, equal to `PluginConfigState & {configHome?}`. | an inline intersection in the registry | One name for consumers; the shape is unchanged. | yes |

## Plan deviations

- **D-B1-1 (outcome union deferred).** The batches that update the consumers need to:
  - widen `GenerationAgentOutcome.status` to `FileOutcome`;
  - widen `ResumableGenerationAgent.status`, adding `kept` and `changed-since-preview`;
  - update `wizard-generation-checkpoint.service.ts` (B3/B5, Batch 10/11) and `completion.component.ts` `AgentOutcomeTile` (F5, Batch 17);
  - change the `_AgentOutcomeNotYetWidened` assertion in `rpc-setup-generation.contract.spec.ts` to `Equal<..., FileOutcome>`.
- **One new spec file not listed in the batch:** `origin-sidecar.types.spec.ts`. The batch verification requires "origin-sidecar parse case with and without new fields", and no parse spec existed. It is colocated with a listed file.

## Risks and edge cases handled

- **TL4**: `harness-sync.types.ts` untouched. No `expectedDigest`, no `'changed-since-approval'` on `HarnessRepairPathResult`, no `overwrittenLocalEdit` rename.
- **A33**: no method-map or true-map entries in `rpc.types.ts`. `wizard:plan-pack-install`, `plugins:replace-kept-items` and `plugins:resolve-config-home` have only their DTOs.
- **Outcome union breaking a consumer (MEDIUM risk)**: this happened. I reported it and deferred the union (D-B1-1); every typecheck is now green.
- **New message type**: `library:changed` does not match the host-source pattern. `host-source-registry.contract.spec.ts` stays green with no baseline change, and the shared tests pass. No exhaustive `Record<MessageType, ...>` consumer exists (repo search returned nothing).
- **Older sidecars parse unchanged**: covered by `origin-sidecar.types.spec.ts`.
- **Compatibility**: all new fields are optional and there is no `any`.
- **Fixture isolation**: fresh objects on every call (asserted). The two plugins with basename `toolkit` resolve to their own display names. The uninstalled plugin keeps "Former Helper", which differs from its id `former-helper-plugin`.

## Out-of-scope observations

- The worktree is missing `node_modules`, which breaks Jest module mapping and the Electron packaging and CSP specs. The team-leader should fix this before later batches verify.
- The webview lint circular dependency through `command-center/src/lib/scene/scene-contrast.spec.ts` was already there before this batch.
