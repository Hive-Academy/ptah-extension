# Batches 63 and 66 report

## Batch 63

Removed 82 of the 83 listed exported types:

- **rpc.types.ts: judge and candidate DTOs (23):** `SkillJudgeStatusDto`, `SkillJudgeCriteriaDto`, `SkillJudgePanelRoleDto`, `SkillJudgePanelRationaleDto`, `SkillSynthesisCandidateSummary`, `SkillSynthesisCandidateDetail`, `SkillSynthesisInvocationEntry`, `SkillSynthesisCandidateScope`, `SkillSynthesisListCandidatesParams`, `SkillSynthesisListCandidatesResult`, `SkillSynthesisGetCandidateParams`, `SkillSynthesisGetCandidateResult`, `SkillSynthesisPromoteParams`, `SkillSynthesisPromoteResult`, `SkillSynthesisRejectParams`, `SkillSynthesisRejectResult`, `SkillSynthesisRejectBulkParams`, `SkillSynthesisRejectBulkResult`, `SkillSynthesisPromoteBulkParams`, `SkillSynthesisPromoteBulkDecision`, `SkillSynthesisPromoteBulkResult`, `SkillSynthesisRejectByPatternParams`, `SkillSynthesisRejectByPatternResult`.

- **rpc.types.ts: queue, digest, settings and curator DTOs (29):** `SkillSynthesisQueueStage`, `SkillSynthesisQueueStatus`, `SkillSynthesisQueueItem`, `SkillSynthesisDrainRun`, `SkillSynthesisStageSpend`, `SkillSynthesisQueueParams`, `SkillSynthesisQueueResult`, `SkillDigestItemKind`, `SkillDigestEvidence`, `SkillDigestItem`, `SkillSynthesisDigestParams`, `SkillSynthesisDigestResult`, `SkillSynthesisInvocationsParams`, `SkillSynthesisInvocationsResult`, `SkillSynthesisStatsParams`, `SkillSynthesisStatsResult`, `SkillSynthesisSettingsDto`, `SkillSynthesisGetSettingsParams`, `SkillSynthesisGetSettingsResult`, `SkillSynthesisSettingsWriteDto`, `SkillSynthesisUpdateSettingsParams`, `SkillSynthesisUpdateSettingsResult`, `SkillSynthesisPinParams`, `SkillSynthesisPinResult`, `SkillSynthesisUnpinParams`, `SkillSynthesisUnpinResult`, `SkillSynthesisRunCuratorParams`, `SkillSynthesisCuratorOverlap`, `SkillSynthesisRunCuratorResult`.

- **rpc.types.ts: suggestion DTOs (12):** `SkillSuggestionSummary`, `SkillSuggestionDetail`, `SkillSynthesisListSuggestionsParams`, `SkillSynthesisListSuggestionsResult`, `SkillSynthesisAcceptSuggestionParams`, `SkillSynthesisAcceptSuggestionResult`, `SkillSynthesisDismissSuggestionParams`, `SkillSynthesisDismissSuggestionResult`, `SkillSynthesisGetSuggestionParams`, `SkillSynthesisGetSuggestionResult`, `SkillSynthesisUpdateSuggestionParams`, `SkillSynthesisUpdateSuggestionResult`.

- **rpc-curator-diagnostics.types.ts: events (2):** `SkillSynthesisEventKind`, `SkillSynthesisEventWire`.

- **rpc-curator-diagnostics.types.ts: diagnostics and lanes (16):** `SkillDiagnosticsParams`, `SkillDiagnosticsResult`, `SkillAnalyzeNowParams`, `SkillAnalyzeNowResult`, `SkillSetTriggersParams`, `SkillSetTriggersResult`, `SkillGetTriggersParams`, `SkillGetTriggersResult`, `SkillLaneIdDto`, `SkillLaneTierDto`, `SkillLaneDto`, `SkillLanesDto`, `SkillSetLanesParams`, `SkillSetLanesResult`, `SkillGetLanesParams`, `SkillGetLanesResult`.

**Kept with reason:**

- `SkillSynthesisSpecStatus` remains at `libs/shared/src/lib/types/rpc.types.ts:2375`; kept `SkillSynthesisSpecSummary.status` references it at line 2379.

**Other edits:**

- `libs/shared/src/lib/types/rpc.types.ts:99` (original line): removed the now-unused `SkillDrainTier` import. Original lines 679-690: removed 12 imports of the deleted diagnostics/lanes DTOs. The RPC method map ends at current line 2373 and was not edited; no map entry names a removed type.
- `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:32-63,247-376` (original lines): removed the dead skill event, diagnostics, trigger RPC and lane DTO blocks. Kept memory-curator DTOs. Kept unlisted `SkillTriggersDto` (current line 58), which `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:3,80,168` uses.
- `SkillSuggestionStatus` (current `rpc.types.ts:2404`) and `EligibilityHistogramDto` (current `rpc-curator-diagnostics.types.ts:153`) are unlisted exported types, so they remain.
- `SkillSynthesisSettingsDto` and its `trayKeepalive` field were removed together (original `rpc.types.ts:2881,2926`).
- `libs/shared/src/index.ts` has wildcard type re-exports only; there was no explicit removed-name export to update. `libs/shared/src/lib/types/rpc/index.ts` does not exist. `rg` found no shared spec files pinning removed names.

## Batch 66

**Deleted files:**

- `libs/shared/src/lib/constants/skill-drain.constants.ts`
- `libs/shared/src/lib/constants/skill-drain.constants.spec.ts`

**rg evidence and remaining references:**

- Before deletion, `rg -n` for `SKILL_DRAIN_TIERS|SkillDrainTier|SKILL_DRAIN_JOB_IDS|SKILL_DRAIN_HANDLER_NAMES|skillDrainTierForJobId` under `libs apps tools` found definitions/usages only in the constants file and its spec, plus the `SkillDrainTier` import/field in `rpc.types.ts:99,2719` (original lines). Those were removed in Batch 63.
- After deletion, the same symbol search under `libs apps tools` returned no hits. The path search still finds historical file-path strings in `tools/mcp-bench/questions/7910f34cf/{relevance,file-tools}.json`; these are data, not imports.
- Removed `export * from './lib/constants/skill-drain.constants';` from `libs/shared/src/index.ts:79` (original line).
- `rg -n -i 'skill.?drain|skills:drain|skills-drain' libs/backend/platform-core` returned no comments or references to list.
- `libs/backend/thoth-runtime/src/lib/retired-skill-jobs.ts:5-7` has its own literal retired job IDs. Its imports are `IJobStore` and `JobId`; it does not import the deleted constants.

## Decisions

- Retained `SkillSynthesisSpecStatus` because a kept type references it. Retained other unlisted exported types under the task definition, including `SkillTriggersDto` and `SkillSuggestionStatus`.
- No Nx, Jest, TypeScript, npm, build, lint or other checks were run, as requested. Verification used `rg` and file reads only.

## Could not do

- Nothing.
