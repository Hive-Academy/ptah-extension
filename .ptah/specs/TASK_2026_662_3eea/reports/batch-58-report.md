# Batch 58 report

## Changes

- Removed 25 unused facade methods from `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts`: `listCandidates`, `getCandidate`, `promote`, `reject`, `rejectBulk`, `promoteBulk`, `rejectByPattern`, `pin`, `unpin`, `invocations`, `stats`, `getSettings`, `updateSettings`, `getLanes`, `setLanes`, `runCurator`, `invocationStats`, `listSuggestions`, `acceptSuggestion`, `getSuggestion`, `updateSuggestion`, `dismissSuggestion`, `queue`, `digest`, `enhanceNow`. Removed their exclusive types/imports and obsolete tests. No diagnostics, analyze, or trigger facade methods were present.
- Kept all specified Library, model, scorecard, and spec methods. `previewEnhancement` remains the Enhance now flow; its PAUSED tests remain.
- O37: `staleSpecCount` now counts harvested specs with non-null `ageDays >= 7`, matching the backend's default seven-day retention. The state spec covers freshly harvested age 0, harvested age 8, and active age 8. Backend `clearStale` includes a timestamp exactly at the cutoff (`harvestedAt > cutoff` is skipped); integer `ageDays >= 7` includes that boundary.

## Retained facade callers

Paths below are relative to `libs/frontend/skill-synthesis-ui/src/lib/`.

| Method | Live caller |
| --- | --- |
| `listClones`, `getScorecards`, `getAgentOutcomeSignals`, `getScorecardDetail`, `getClone`, `saveCloneBody` | `services/skill-clones-state.service.ts:73,99,121,144,210,245` respectively |
| `previewEnhancement`, `getHistoryBody`, `revertEnhancement`, `saveCloneBody`, `rebaseClone`, `keepClone` | `components/clones/skill-clones-view.component.ts:796,743,764,825,872,892` respectively |
| `rebaseClone` | `services/clone-bulk-rebase.service.ts:103` |
| `listQuarantinedAgents`, `restoreQuarantinedAgent` | `components/clones/quarantined-agents-panel.component.ts:358,402` |
| `getAgentModels`, `listCliModels`, `getAgentLaneConfig` | `components/clones/agent-models.store.ts:154-156` |
| `setAgentModel` | `components/clones/agent-model-editor.component.ts:710` |
| `listSpecs`, `harvestSpecs`, `clearStaleSpecs` | `services/skill-synthesis-state.service.ts:238,252,274` (new line positions after O37 edit) |
| `listModels` | No current production caller; retained by explicit batch instruction and facade spec. |
| `applyProposal` | No current production caller; retained by explicit batch instruction as a Library RPC. |

## Validation

- The requested `rg -n "skillSynthesis:(...)'" libs/frontend apps` search found **no hits in this facade or its spec**. It still finds hits outside batch ownership: `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:712,765-766` has legacy settings fixtures; `apps/ptah-tui/src/components/thoth/SkillsPanel.tsx:80,91,125,139,153` still issues pipeline RPCs; `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:120-178` contains the obsolete expected method list. The TUI calls are live; the other hits are fixtures/spec expectations. None was edited because batch 58 owns only the four service/spec files and this report. The requested workspace-wide zero-live-hit condition therefore does not yet hold.
- AST analysis of the edited facade returned `parseStatus: ok`, `errorNodeCount: 0`; its method list contains only retained methods. A targeted `rg` found zero obsolete method RPC strings in the facade and its spec.
- Tests, typecheck, lint, build, Nx, Jest, and diagnostics were not run under the batch's explicit prohibition.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep `listModels` and `applyProposal` despite no production caller. | Remove as unused, or keep. The batch explicitly names both as retained Library methods; kept. | Yes |
| Preserve timeout values used by retained methods. | Prune all pipeline-era timeout names, or keep values still referenced by Library/spec methods. The retained methods still call `SHORT_MS`, `PROMOTE_MS`, `SETTINGS_MS`, and `CURATOR_MS`; kept and updated the comments. | Yes |
| Count `ageDays >= 7`. | Compare a frontend timestamp, or use the backend-provided integer age. `SkillSynthesisSpecSummary.ageDays` is `number | null` and backend floors age in days; the batch specifies the age-based predicate. | Yes |

## Not done

- No files outside the four assigned source/spec paths were changed. Remaining validation hits need their owning batches.
