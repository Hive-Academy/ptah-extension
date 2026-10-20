# Batch 59.1: skill synthesis RPC contraction

## Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`: contracted the method list and registrations, deleted retired handlers and helpers/imports, and changed preview scoring.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`: removed tests and fixtures for retired methods; retained and adjusted tests for supported methods and constructor resolution.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts` and `skills-synthesis-rpc.schema.spec.ts`: removed retired method schemas and tests.
- `libs/shared/src/lib/types/rpc.types.ts`: removed retired method map and `RPC_METHOD_ENTRIES` keys; retained DTO interfaces for batch 63.
- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`: removed retired method names.
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`: contracted the exact expected RPC list.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`: removed obsolete settings RPC entries and unused settings fixture value.

## Contract

Removed together, all with the `skillSynthesis:` prefix: `listCandidates`, `getCandidate`, `promote`, `reject`, `invocations`, `stats`, `getSettings`, `updateSettings`, `pin`, `unpin`, `runCurator`, `diagnostics`, `analyzeNow`, `setTriggers`, `getTriggers`, `setLanes`, `getLanes`, `listSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `getSuggestion`, `updateSuggestion`, `rejectBulk`, `promoteBulk`, `rejectByPattern`, `queue`, `digest`, and `enhanceNow`.

Kept: `listClones`, `getClone`, `getHistoryBody`, `revertEnhancement`, `rebaseClone`, `keepClone`, `saveCloneBody`, `previewEnhancement`, `applyProposal`, `getScorecards`, `getScorecardDetail`, `invocationStats`, `listQuarantinedAgents`, `restoreQuarantinedAgent`, `getAgentModels`, `setAgentModel`, `listSpecs`, `harvestSpecs`, and `clearStaleSpecs`. The `skillSynthesis:` allowed prefix remains.

Removed constructor injections: `SKILL_SYNTHESIS_SERVICE`, `SKILL_CANDIDATE_STORE`, `SKILL_QUEUE_STORE`, `SKILL_BUDGET_STORE`, plus now unused diagnostics, curator, suggestion store, cron, and gap curator dependencies. Kept the enhancer, registry store, user layer mirror, content download, spec harvester, scorecard, agent sync gate, runtime container, repropagation port, and core logger/RPC/Sentry/workspace dependencies because retained methods use them. None of the four specifically named retired injections is needed by a kept method.

O31a/O38b: `skills-synthesis-rpc.handlers.ts:150-151` defines `PREVIEW_MIN_JUDGE_SCORE = 6.0`, documenting the shipped default at `libs/backend/platform-core/src/file-settings-keys.ts:608`. At line 341, preview passes this value to `generateProposal` in place of `this.synthesis.readSettings()`. The existing enhancer signature takes `SkillSynthesisSettings`, although its implementation reads only `minJudgeScore`; the local object is asserted to that type to preserve the call contract within this batch's file boundary.

## Validation and remaining work

- Exact requested `rg` sweep for the 28 retired quoted RPC names over `libs apps tools`, excluding `apps/ptah-tui/**`: **zero hits**. A separate search of `apps/ptah-tui` also found zero retired names; no TUI files were edited.
- Handler `METHODS`, shared method map/runtime entries, and VS Code surface expectation each contain the same 19 retained names. Other host surface specs did not contain a retired name. The host source baseline retains its original supported subset and event entry after removing retired names.
- The AST tool reported clean TypeScript parses for seven changed files. For the large `rpc.types.ts` file it reported `parseStatus: recovered` with 20 capped error nodes; the affected method-map and runtime-entry sections were inspected as text. An authoritative TypeScript check remains for the orchestrator.
- All eight edited source/spec/fixture files were checked as UTF-8 without BOM.
- Tests, typecheck, lint, build, Nx, and Jest were not run, as explicitly prohibited. The orchestrator must verify `rpc-allowlist.spec.ts`, host `rpc-surface.spec.ts`, and `host-source-registry.contract.spec.ts`.

## Decisions

1. **Preview threshold:** use a named 6.0 constant. Options were a constant or retaining the settings service. Evidence: the task names the shipped default and says the settings key is removed in batch 65; the enhancer reads `minJudgeScore`. Reversible if the enhancer contract changes.
2. **DTO ownership:** retain the now unused RPC DTO interfaces. Options were deleting them here or leaving cleanup to batch 63. Evidence: the batch explicitly assigns DTO cleanup to batch 63. Reversible.
3. **Other host specs:** leave specs with no retired method names untouched. Options were editing every host spec or only affected exact lists. Evidence: the targeted sweep found obsolete names only in the VS Code surface expectation. Reversible.

No further source edits are known to be required within batch 59.1; compilation and test verification remain outstanding by instruction.
