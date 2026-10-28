/**
 * RPC Type Definitions
 *
 * Type-safe parameter and response types for all RPC methods.
 * Used by both frontend (caller) and backend (handler) for compile-time type safety.
 *
 * Domain-specific types are split into child files under ./rpc/ for maintainability.
 * This barrel re-exports all child types and contains the central RpcMethodRegistry.
 */

export * from './rpc/rpc-chat.types';
export * from './rpc/rpc-attention.types';
export * from './rpc/rpc-session.types';
export * from './rpc/rpc-analytics.types';
import type { UsageSummary, UsageSummaryParams } from './rpc/rpc-analytics.types';
import type { WorkspaceListRecentResult } from './rpc/rpc-workspace.types';
export * from './rpc/rpc-config.types';
export * from './rpc/rpc-auth.types';
export * from './rpc/rpc-providers.types';
export * from './rpc/rpc-provider-accounts.types';
export * from './rpc/rpc-setup.types';
export * from './rpc/rpc-agents.types';
export * from './rpc/rpc-misc.types';
export * from './rpc/rpc-git.types';
export * from './rpc/rpc-change-set.types';
export * from './rpc/rpc-editor.types';
export * from './rpc/rpc-memory.types';
export * from './rpc/rpc-mem.types';
export * from './rpc/rpc-corpus.types';
import type {
  ArtifactListRequest,
  ArtifactListResponse,
} from '../../mcp-apps-contracts/artifact.types';

export * from './rpc/rpc-indexing.types';

export * from './rpc/rpc-update.types';

export * from './rpc/rpc-skill-clone.types';

export * from './rpc/rpc-tasks.types';

export * from './rpc/rpc-output-style.types';

export * from './rpc/rpc-plugin-marketplace.types';

export * from './rpc/rpc-peer-session.types';

export * from './rpc/rpc-surface.types';

export * from './rpc/rpc-capability.types';

export * from './rpc/rpc-lane-plan-limits.types';

export * from './rpc/rpc-lane-outcome.types';

export * from './rpc/rpc-decision-model-catalog.types';

import type {
  AgentGetLanePlanLimitsParams,
  AgentGetLanePlanLimitsResult,
} from './rpc/rpc-lane-plan-limits.types';
import type { ProviderAccountRpcMethodRegistry } from './rpc/rpc-provider-accounts.types';
import type {
  AttentionGetSnapshotParams,
  AttentionGetSnapshotResult,
} from './rpc/rpc-attention.types';

import type {
  AgentOutcomeSignalsParams,
  AgentOutcomeSignalsResult,
} from './rpc/rpc-lane-outcome.types';

import type {
  AgentListDecisionModelsParams,
  AgentListDecisionModelsResult,
} from './rpc/rpc-decision-model-catalog.types';

import type {
  CapabilitiesGetEffectiveParams,
  CapabilitiesGetEffectiveResult,
  CapabilitiesGetStateParams,
  CapabilitiesGetStateResult,
  CapabilitiesSetEnabledParams,
  CapabilitiesSetEnabledResult,
} from './rpc/rpc-capability.types';

import type {
  ExternalInstallParams,
  ExternalInstallResponse,
  ExternalMarketplaceBrowseResult,
  ExternalMarketplace,
  ExternalUninstallParams,
  ExternalUninstallResult,
  ListMarketplacesResult,
  MarketplaceBrowseParams,
  MarketplaceSourceParams,
} from './rpc/rpc-plugin-marketplace.types';

import type {
  SubagentQueryParams,
  SubagentQueryResult,
  SubagentSendMessageParams,
  SubagentStopParams,
  SubagentInterruptParams,
  SubagentBackgroundParams,
  SubagentBackgroundResult,
  SubagentCommandResult,
  SubagentHistoryPageParams,
  SubagentHistoryPageResult,
} from './subagent-registry.types';
import type { SavedAnalysisMetadata } from './wizard';
import type {
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatSetStreamViewportParams,
  ChatSetStreamViewportResult,
  ChatResumeParams,
  ChatResumeResult,
  ChatHistoryPageParams,
  ChatHistoryPageResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatPendingQuestionsParams,
  ChatPendingQuestionsResult,
  ChatRunningAgentsParams,
  ChatRunningAgentsResult,
  ChatAgentSessionsParams,
  ChatAgentSessionsResult,
} from './rpc/rpc-chat.types';

import type {
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  SessionDeleteParams,
  SessionDeleteResult,
  SessionRenameParams,
  SessionRenameResult,
  SessionValidateParams,
  SessionValidateResult,
  SessionCliSessionsParams,
  SessionCliSessionsResult,
  SessionCliOutputPageParams,
  SessionCliOutputPageResult,
  SessionStatsBatchParams,
  SessionStatsBatchResult,
  SessionForkParams,
  SessionForkResult,
  SessionRewindParams,
  SessionRewindResult,
  SessionStatusParams,
  SessionStatusResponse,
  SessionSetOrganizationParams,
  SessionSetOrganizationResult,
  SessionGetOrganizationParams,
  SessionGetOrganizationResult,
  SessionLinkTaskParams,
  SessionLinkTaskResult,
  SessionUnlinkTaskParams,
  SessionUnlinkTaskResult,
  SessionAddPrLinkParams,
  SessionAddPrLinkResult,
  SessionRemovePrLinkParams,
  SessionRemovePrLinkResult,
  SessionListForTasksParams,
  SessionListForTasksResult,
} from './rpc/rpc-session.types';

import type {
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigEffortSetParams,
  ConfigEffortSetResult,
  ConfigEffortGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetParams,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
  ConfigPricingGetResult,
} from './rpc/rpc-config.types';

import type {
  AuthGetHealthParams,
  AuthGetHealthResponse,
  AuthSaveSettingsParams,
  AuthSaveSettingsResponse,
  AuthTestConnectionParams,
  AuthTestConnectionResponse,
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
  AuthCopilotLoginParams,
  AuthCopilotLoginResponse,
  AuthCopilotLogoutParams,
  AuthCopilotLogoutResponse,
  AuthCopilotStatusParams,
  AuthCopilotStatusResponse,
  AuthCodexLoginParams,
  AuthCodexLoginResponse,
  AuthKimiCodeLoginParams,
  AuthKimiCodeLoginResponse,
  AuthKimiCodeLoginCancelParams,
  AuthKimiCodeLoginCancelResponse,
  AuthGetEffectiveRouteParams,
  AuthGetEffectiveRouteResult,
  ConfigGetScopesParams,
  ConfigGetScopesResult,
  ConfigClearScopeOverrideParams,
  ConfigClearScopeOverrideResult,
  AuthGetScopeResult,
  AuthClearWorkspaceOverrideResult,
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
  AuthCancelDraftVerificationParams,
  AuthCancelDraftVerificationResult,
  AuthDeleteStoredKeyParams,
  AuthDeleteStoredKeyResult,
  AuthGetApiKeyStatusResult,
  AuthCheckConnectionParams,
  AuthCheckConnectionResult,
} from './rpc/rpc-auth.types';

import type {
  ProviderListModelsParams,
  ProviderListModelsResult,
  ProviderSetModelTierParams,
  ProviderSetModelTierResult,
  ProviderGetModelTiersParams,
  ProviderGetModelTiersResult,
  ProviderClearModelTierParams,
  ProviderClearModelTierResult,
  ProviderListCustomEntriesParams,
  ProviderListCustomEntriesResult,
  ProviderAddCustomEntryParams,
  ProviderAddCustomEntryResult,
  ProviderUpdateCustomEntryParams,
  ProviderUpdateCustomEntryResult,
  ProviderRemoveCustomEntryParams,
  ProviderRemoveCustomEntryResult,
  ProviderTestCustomEntryParams,
  ProviderTestCustomEntryResult,
  ProviderGetAccountUsageParams,
  ProviderGetAccountUsageResult,
  ProviderGetPlanLimitsParams,
  ProviderGetPlanLimitsResult,
  LlmGetProviderStatusParams,
  LlmProviderStatusResponse,
  LlmSetApiKeyParams,
  LlmSetApiKeyResponse,
  LlmRemoveApiKeyParams,
  LlmRemoveApiKeyResponse,
  LlmGetDefaultProviderParams,
  LlmGetDefaultProviderResponse,
  SetDefaultProviderRequest,
  SetDefaultProviderResponse,
  LlmValidateApiKeyFormatParams,
  LlmValidateApiKeyFormatResponse,
  LlmSetDefaultModelParams,
  LlmSetDefaultModelResponse,
  LlmListVsCodeModelsParams,
  LlmListProviderModelsParams,
  LlmListProviderModelsResponse,
  LlmSetProviderBaseUrlParams,
  LlmSetProviderBaseUrlResponse,
  LlmGetProviderBaseUrlParams,
  LlmGetProviderBaseUrlResponse,
  LlmClearProviderBaseUrlParams,
  LlmClearProviderBaseUrlResponse,
} from './rpc/rpc-providers.types';

import type {
  SetupStatusGetParams,
  SetupStatusGetResponse,
  SetupWizardLaunchParams,
  SetupWizardLaunchResponse,
  WizardDeepAnalyzeParams,
  WizardDeepAnalyzeResponse,
  WizardGetResumableRunParams,
  WizardGetResumableRunResponse,
  WizardAnalysisStatusParams,
  WizardAnalysisStatusResponse,
  WizardRecommendAgentsParams,
  WizardRecommendAgentsResponse,
  WizardCancelAnalysisParams,
  WizardCancelAnalysisResponse,
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
  WizardCancelParams,
  WizardCancelResponse,
  WizardGetGenerationRunStateParams,
  WizardGetGenerationRunStateResponse,
  WizardRetryItemParams,
  WizardRetryItemResponse,
  WizardPreviewGenerationParams,
  WizardPreviewGenerationResponse,
  MultiPhaseAnalysisResponse,
  EnhancedPromptsGetStatusParams,
  EnhancedPromptsGetStatusResponse,
  EnhancedPromptsRunWizardParams,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsSetEnabledParams,
  EnhancedPromptsSetEnabledResponse,
  EnhancedPromptsRegenerateParams,
  EnhancedPromptsRegenerateResponse,
  EnhancedPromptsCancelParams,
  EnhancedPromptsCancelResponse,
  EnhancedPromptsGetRunStateParams,
  EnhancedPromptsGetRunStateResponse,
  WizardListAgentPacksParams,
  WizardListAgentPacksResult,
  WizardInstallPackAgentsParams,
  WizardInstallPackAgentsResult,
} from './rpc/rpc-setup.types';

import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  AgentContinueErrorCode,
  AgentPermissionDecision,
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
  PtahCliListParams,
  PtahCliListResult,
  PtahCliCreateParams,
  PtahCliCreateResult,
  PtahCliUpdateParams,
  PtahCliUpdateResult,
  PtahCliDeleteParams,
  PtahCliDeleteResult,
  PtahCliTestConnectionParams,
  PtahCliTestConnectionResult,
  PtahCliListModelsParams,
  PtahCliListModelsResult,
} from './rpc/rpc-agents.types';

import type {
  McpDirectorySearchParams,
  McpDirectorySearchResult,
  McpDirectoryGetDetailsParams,
  McpDirectoryGetDetailsResult,
  McpDirectoryInstallParams,
  McpDirectoryInstallResult,
  McpDirectoryUninstallParams,
  McpDirectoryUninstallResult,
  McpDirectoryListInstalledParams,
  McpDirectoryListInstalledResult,
  McpDirectoryGetPopularParams,
  McpDirectoryGetPopularResult,
  McpDirectorySetSmitheryApiKeyParams,
  McpDirectorySetSmitheryApiKeyResult,
  McpDirectoryGetSmitheryKeyStatusParams,
  McpDirectoryGetSmitheryKeyStatusResult,
  McpDirectoryResolveSmitheryParams,
  McpDirectoryResolveSmitheryResult,
  McpDirectoryInstallSmitheryParams,
  McpDirectoryInstallSmitheryResult,
  McpDirectoryUninstallSmitheryParams,
  McpDirectoryUninstallSmitheryResult,
  McpDirectoryListSmitheryInstalledParams,
  McpDirectoryListSmitheryInstalledResult,
  McpDirectorySmitheryAccountParams,
  McpDirectorySmitheryAccountResult,
  McpDirectoryListSmitheryConnectionsParams,
  McpDirectoryListSmitheryConnectionsResult,
  McpDirectorySmitheryConnectionStatusParams,
  McpDirectorySmitheryConnectionStatusResult,
  McpDirectoryOpenSmitherySetupParams,
  McpDirectoryOpenSmitherySetupResult,
  McpDirectoryConnectOAuthParams,
  McpDirectoryConnectOAuthResult,
  McpDirectoryProbeOAuthDiscoveryParams,
  McpDirectoryProbeOAuthDiscoveryResult,
  McpDirectoryOAuthStatusParams,
  McpDirectoryOAuthStatusResult,
  McpDirectoryDisconnectOAuthParams,
  McpDirectoryDisconnectOAuthResult,
  McpDirectoryListOAuthConnectedParams,
  McpDirectoryListOAuthConnectedResult,
  McpDirectoryGetOAuthRedirectUriParams,
  McpDirectoryGetOAuthRedirectUriResult,
} from './mcp-directory.types';

import type {
  GitInfoParams,
  GitInfoResult,
  GitReviewChangesParams,
  GitReviewChangesResult,
  GitReviewFileParams,
  GitReviewFileResult,
  GitWorktreesParams,
  GitWorktreesResult,
  GitAddWorktreeParams,
  GitAddWorktreeResult,
  GitRemoveWorktreeParams,
  GitRemoveWorktreeResult,
  GitStageParams,
  GitStageResult,
  GitUnstageParams,
  GitUnstageResult,
  GitDiscardParams,
  GitDiscardResult,
  GitCommitParams,
  GitCommitResult,
  GitCancelOperationParams,
  GitCancelOperationResult,
  GitGenerateCommitMessageParams,
  GitGenerateCommitMessageResult,
  GitPrStatusParams,
  GitPrStatusResult,
  GitOperationAbortParams,
  GitOperationAbortResult,
  GitOperationContinueParams,
  GitOperationContinueResult,
  GitLogParams,
  GitLogResult,
  GitShowFileParams,
  GitShowFileResult,
  GitDiffFileParams,
  GitDiffFileResult,
  GitApplyHunksParams,
  GitApplyHunksResult,
  GitPushParams,
  GitPushResult,
  GitPullParams,
  GitPullResult,
  GitFetchParams,
  GitFetchResult,
  GitStashApplyParams,
  GitStashPopParams,
  GitStashDropParams,
  GitStashMutationResult,
  GitStashShowParams,
  GitStashShowResult,
  GitBranchesParams,
  GitBranchesResult,
  GitCheckoutParams,
  GitCheckoutResult,
  GitStashListParams,
  GitStashListResult,
  GitTagsParams,
  GitTagsResult,
  GitRemotesParams,
  GitRemotesResult,
  GitLastCommitParams,
  GitLastCommitResult,
} from './rpc/rpc-git.types';
import type {
  GitTurnChangeSetsParams,
  GitTurnChangeSetsResult,
} from './rpc/rpc-change-set.types';

import type {
  MemoryListParams,
  MemoryListResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryPinParams,
  MemoryPinResult,
  MemoryForgetParams,
  MemoryForgetResult,
  MemoryRebuildIndexParams,
  MemoryRebuildIndexResult,
  MemoryStatsParams,
  MemoryStatsResult,
  MemoryPurgeBySubjectPatternParams,
  MemoryPurgeBySubjectPatternResult,
  MemoryPurgeJunkParams,
  MemoryPurgeJunkResult,
  MemorySearchSymbolsParams,
  MemorySearchSymbolsResult,
  MemoryListQuarantinedParams,
  MemoryListQuarantinedResult,
  MemoryRestoreQuarantinedParams,
  MemoryRestoreQuarantinedResult,
} from './rpc/rpc-memory.types';

import type {
  MemSearchIndexParams,
  MemSearchIndexResult,
  MemTimelineParams,
  MemTimelineResult,
  MemGetObservationsParams,
  MemGetObservationsResult,
} from './rpc/rpc-mem.types';

import type {
  CorpusListParams,
  CorpusListResult,
  CorpusGetParams,
  CorpusGetResult,
  CorpusBuildParams,
  CorpusBuildResult,
  CorpusPrimeParams,
  CorpusPrimeResult,
  CorpusQueryParams,
  CorpusQueryResult,
  CorpusReprimeParams,
  CorpusReprimeResult,
  CorpusRebuildParams,
  CorpusRebuildResult,
  CorpusDeleteParams,
  CorpusDeleteResult,
  CorpusSuggestParams,
  CorpusSuggestResult,
} from './rpc/rpc-corpus.types';

import type {
  IndexingGetStatusParams,
  IndexingGetStatusResult,
  IndexingStartParams,
  IndexingStartResult,
  IndexingPauseParams,
  IndexingPauseResult,
  IndexingResumeParams,
  IndexingResumeResult,
  IndexingCancelParams,
  IndexingCancelResult,
  IndexingSetPipelineEnabledParams,
  IndexingSetPipelineEnabledResult,
  IndexingDismissStaleParams,
  IndexingDismissStaleResult,
  IndexingAcknowledgeDisclosureParams,
  IndexingAcknowledgeDisclosureResult,
} from './rpc/rpc-indexing.types';

import type {
  SkillSynthesisListClonesParams,
  SkillSynthesisListClonesResult,
  SkillSynthesisGetCloneParams,
  SkillSynthesisGetCloneResult,
  SkillSynthesisEnhanceNowParams,
  SkillSynthesisEnhanceNowResult,
  SkillSynthesisPreviewEnhancementParams,
  SkillSynthesisPreviewEnhancementResult,
  SkillSynthesisApplyProposalParams,
  SkillSynthesisApplyProposalResult,
  SkillSynthesisGetHistoryBodyParams,
  SkillSynthesisGetHistoryBodyResult,
  SkillSynthesisRevertEnhancementParams,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisRebaseCloneParams,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisKeepCloneParams,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisSaveCloneBodyParams,
  SkillSynthesisSaveCloneBodyResult,
  SkillSynthesisInvocationStatsParams,
  SkillSynthesisInvocationStatsResult,
  SkillSynthesisGetScorecardsParams,
  SkillSynthesisGetScorecardsResult,
  SkillSynthesisGetScorecardDetailParams,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisListQuarantinedAgentsParams,
  SkillSynthesisListQuarantinedAgentsResult,
  SkillSynthesisRestoreQuarantinedAgentParams,
  SkillSynthesisRestoreQuarantinedAgentResult,
  SkillSynthesisGetAgentModelsParams,
  SkillSynthesisGetAgentModelsResult,
  SkillSynthesisSetAgentModelParams,
  SkillSynthesisSetAgentModelResult,
} from './rpc/rpc-skill-clone.types';

import type {
  HarnessInitializeParams,
  HarnessInitializeResponse,
  HarnessSuggestConfigParams,
  HarnessSuggestConfigResponse,
  HarnessSearchSkillsParams,
  HarnessSearchSkillsResponse,
  HarnessCreateSkillParams,
  HarnessCreateSkillResponse,
  HarnessDiscoverMcpParams,
  HarnessDiscoverMcpResponse,
  HarnessGeneratePromptParams,
  HarnessGeneratePromptResponse,
  HarnessGenerateClaudeMdParams,
  HarnessGenerateClaudeMdResponse,
  HarnessApplyParams,
  HarnessApplyResponse,
  HarnessSavePresetParams,
  HarnessSavePresetResponse,
  HarnessLoadPresetsParams,
  HarnessLoadPresetsResponse,
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessStartNewProjectParams,
  HarnessStartNewProjectResult,
  HarnessWorkflowPromptParams,
  HarnessWorkflowPromptResponse,
} from './rpc/rpc-harness.types';
import type {
  HarnessGetProposalParams,
  HarnessGetProposalResult,
} from './rpc/rpc-harness-proposal.types';

// The reconciler's own surface (TASK_2026_278 Batch 4). It shares the
// `harness:` namespace with the setup builder above but not its types: these
// describe propagation health, not a wizard step.
import type {
  HarnessGetSkillSelectionParams,
  HarnessGetSkillSelectionResult,
  HarnessHealthParams,
  HarnessHealthResult,
  HarnessReconcileParams,
  HarnessReconcileResult,
  HarnessRemoveParams,
  HarnessRemoveResult,
  HarnessRepairBlockedParams,
  HarnessRepairBlockedResult,
  HarnessSetSkillSelectionParams,
  HarnessSetSkillSelectionResult,
} from './harness-sync.types';

import type {
  ContextGetAllFilesParams,
  ContextGetAllFilesResult,
  ContextGetFileSuggestionsParams,
  ContextGetFileSuggestionsResult,
  AutocompleteAgentsParams,
  AutocompleteAgentsResult,
  AutocompleteCommandsParams,
  AutocompleteCommandsResult,
  FileOpenParams,
  FileOpenResult,
  FileViewContentParams,
  FileViewContentResult,
  FileSaveContentParams,
  FileSaveContentResult,
  LicenseGetStatusParams,
  LicenseGetStatusResponse,
  LicenseSetKeyParams,
  LicenseSetKeyResponse,
  LicenseClearKeyParams,
  LicenseClearKeyResponse,
  CommandExecuteParams,
  CommandExecuteResponse,
  QualityGetAssessmentParams,
  QualityGetAssessmentResult,
  QualityGetHistoryParams,
  QualityGetHistoryResult,
  QualityExportParams,
  QualityExportResult,
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from './rpc/rpc-misc.types';
import type {
  EditorDetectTargetsParams,
  EditorDetectTargetsResult,
  EditorOpenFileParams,
  EditorOpenWorkspaceParams,
  EditorOpenResult,
  EditorOpenMergeParams,
  EditorOpenMergeResult,
} from './rpc/rpc-editor.types';
import type {
  DbHealthResult,
  DbResetResult,
  DbReloadVecResult,
  DbOpenBindingFolderResult,
  EmbedderStatusParams,
  EmbedderStatusResult,
  EmbedderRetryParams,
  EmbedderRetryResult,
} from './rpc/rpc-persistence.types';

import type { BootGetReadinessResult } from './rpc/rpc-readiness.types';

import type {
  UpdateGetStateParams,
  UpdateGetStateResult,
  UpdateCheckNowParams,
  UpdateCheckNowResult,
  UpdateMarkDownloadedParams,
  UpdateMarkDownloadedResult,
} from './rpc/rpc-update.types';

import type {
  MemoryDiagnosticsParams,
  MemoryDiagnosticsResult,
  MemoryRunNowParams,
  MemoryRunNowResult,
  MemorySetTriggersParams,
  MemorySetTriggersResult,
  MemoryGetTriggersParams,
  MemoryGetTriggersResult,
} from './rpc/rpc-curator-diagnostics.types';
import type {
  TasksListParams,
  TasksListResult,
  TasksGetParams,
  TasksGetResult,
  TasksGetArtifactParams,
  TasksGetArtifactResult,
  TasksGetRoundJudgeParams,
  TasksGetRoundJudgeResult,
  TasksCreateParams,
  TasksCreateResult,
  TasksSweepParams,
  TasksSweepResult,
  TasksUpdateStatusParams,
  TasksUpdateStatusResult,
  TasksUpdateMetadataParams,
  TasksUpdateMetadataResult,
  TasksBulkUpdateStatusParams,
  TasksBulkUpdateStatusResult,
  TasksBulkUpdateLabelParams,
  TasksBulkUpdateLabelResult,
  TasksGenerateRegistryParams,
  TasksGenerateRegistryResult,
  TasksBoardParams,
  TasksBoardResult,
  TasksReindexParams,
  TasksReindexResult,
  TasksAdoptParams,
  TasksAdoptResult,
  TasksDoctorPlanParams,
  TasksDoctorPlanResult,
  TasksGetViewsParams,
  TasksGetViewsResult,
  TasksSaveViewsParams,
  TasksSaveViewsResult,
} from './rpc/rpc-tasks.types';
import type {
  OutputStyleListParams,
  OutputStyleListResult,
  OutputStyleGetParams,
  OutputStyleGetResult,
  OutputStyleActivateParams,
  OutputStyleActivateResult,
  OutputStyleSaveParams,
  OutputStyleSaveResult,
  OutputStyleDeleteParams,
  OutputStyleDeleteResult,
  OutputStyleDiagnoseParams,
  OutputStyleDiagnoseResult,
} from './rpc/rpc-output-style.types';
import type {
  PeerSessionListParams,
  PeerSessionListResult,
  PeerSessionSendParams,
  PeerSessionSendResult,
} from './rpc/rpc-peer-session.types';
import type {
  SurfaceActionParams,
  SurfaceActionResult,
  SurfaceChangeParams,
  SurfaceMutationResult,
  SurfaceOperationParams,
  SurfaceOperationResult,
  SurfaceReadParams,
  SurfaceReadResult,
  SurfaceSelectParams,
} from './rpc/rpc-surface.types';

/**
 * RPC Method Registry
 *
 * This is the SINGLE SOURCE OF TRUTH for all valid RPC methods.
 * Both frontend and backend MUST use this registry to ensure:
 * 1. Frontend can only call methods that exist
 * 2. Backend must register handlers for all methods
 * 3. Compile-time type checking for params and results
 *
 * If you add a new RPC method:
 * 1. Add its params/result types above
 * 2. Add an entry to this registry
 * 3. Give it an owner in RPC_HANDLER_MANIFEST (@ptah-extension/rpc-handlers)
 *
 * If a method is not in this registry, it CANNOT be called from frontend.
 *
 * Provider account methods (`provider:*Account*`, TASK_2026_712) are declared
 * in `rpc/rpc-provider-accounts.types.ts` and merged in through `extends`.
 */
export interface RpcMethodRegistry extends ProviderAccountRpcMethodRegistry {
  'artifacts:list': { params: ArtifactListRequest; result: ArtifactListResponse };
  'artifacts:openLink': { params: { url: string }; result: { opened: boolean } };
  'analytics:spendSummary': { params: UsageSummaryParams; result: UsageSummary };
  'attention:getSnapshot': {
    params: AttentionGetSnapshotParams;
    result: AttentionGetSnapshotResult;
  };
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  'chat:setStreamViewport': {
    params: ChatSetStreamViewportParams;
    result: ChatSetStreamViewportResult;
  };
  'chat:resume': { params: ChatResumeParams; result: ChatResumeResult };
  'chat:history-page': {
    params: ChatHistoryPageParams;
    result: ChatHistoryPageResult;
  };
  'chat:abort': { params: ChatAbortParams; result: ChatAbortResult };
  'chat:pending-questions': {
    params: ChatPendingQuestionsParams;
    result: ChatPendingQuestionsResult;
  };
  'chat:running-agents': {
    params: ChatRunningAgentsParams;
    result: ChatRunningAgentsResult;
  };
  'chat:agent-sessions': {
    params: ChatAgentSessionsParams;
    result: ChatAgentSessionsResult;
  };
  'session:list': { params: SessionListParams; result: SessionListResult };
  'session:load': { params: SessionLoadParams; result: SessionLoadResult };
  'session:delete': {
    params: SessionDeleteParams;
    result: SessionDeleteResult;
  };
  'session:rename': {
    params: SessionRenameParams;
    result: SessionRenameResult;
  };
  'session:validate': {
    params: SessionValidateParams;
    result: SessionValidateResult;
  };
  'session:cli-sessions': {
    params: SessionCliSessionsParams;
    result: SessionCliSessionsResult;
  };
  'session:cli-output-page': {
    params: SessionCliOutputPageParams;
    result: SessionCliOutputPageResult;
  };
  'session:stats-batch': {
    params: SessionStatsBatchParams;
    result: SessionStatsBatchResult;
  };
  'session:forkSession': {
    params: SessionForkParams;
    result: SessionForkResult;
  };
  'session:rewindFiles': {
    params: SessionRewindParams;
    result: SessionRewindResult;
  };
  'session:status': {
    params: SessionStatusParams;
    result: SessionStatusResponse;
  };
  // Session organization (TASK_2026_580). Served on every host; a host
  // without the organization store answers `organization-unavailable`.
  'session:setOrganization': {
    params: SessionSetOrganizationParams;
    result: SessionSetOrganizationResult;
  };
  'session:getOrganization': {
    params: SessionGetOrganizationParams;
    result: SessionGetOrganizationResult;
  };
  'session:linkTask': {
    params: SessionLinkTaskParams;
    result: SessionLinkTaskResult;
  };
  'session:unlinkTask': {
    params: SessionUnlinkTaskParams;
    result: SessionUnlinkTaskResult;
  };
  'session:addPrLink': {
    params: SessionAddPrLinkParams;
    result: SessionAddPrLinkResult;
  };
  'session:removePrLink': {
    params: SessionRemovePrLinkParams;
    result: SessionRemovePrLinkResult;
  };
  'session:listForTasks': {
    params: SessionListForTasksParams;
    result: SessionListForTasksResult;
  };
  'context:getAllFiles': {
    params: ContextGetAllFilesParams;
    result: ContextGetAllFilesResult;
  };
  'context:getFileSuggestions': {
    params: ContextGetFileSuggestionsParams;
    result: ContextGetFileSuggestionsResult;
  };
  'autocomplete:agents': {
    params: AutocompleteAgentsParams;
    result: AutocompleteAgentsResult;
  };
  'autocomplete:commands': {
    params: AutocompleteCommandsParams;
    result: AutocompleteCommandsResult;
  };
  'file:open': { params: FileOpenParams; result: FileOpenResult };
  'file:viewContent': {
    params: FileViewContentParams;
    result: FileViewContentResult;
  };
  'file:saveContent': {
    params: FileSaveContentParams;
    result: FileSaveContentResult;
  };
  'editor:detectTargets': {
    params: EditorDetectTargetsParams;
    result: EditorDetectTargetsResult;
  };
  'editor:openFile': {
    params: EditorOpenFileParams;
    result: EditorOpenResult;
  };
  'editor:openWorkspace': {
    params: EditorOpenWorkspaceParams;
    result: EditorOpenResult;
  };
  'editor:openMerge': {
    params: EditorOpenMergeParams;
    result: EditorOpenMergeResult;
  };
  'file:pick': {
    params: { multiple?: boolean };
    result: { files: Array<{ path: string; size: number }> };
  };
  'file:pick-images': {
    params: { multiple?: boolean };
    result: {
      images: Array<{
        data: string;
        mediaType: string;
        name: string;
      }>;
    };
  };
  'config:model-switch': {
    params: ConfigModelSwitchParams;
    result: ConfigModelSwitchResult;
  };
  'config:model-get': {
    params: Record<string, never>;
    result: ConfigModelGetResult;
  };
  'config:autopilot-toggle': {
    params: ConfigAutopilotToggleParams;
    result: ConfigAutopilotToggleResult;
  };
  'config:autopilot-get': {
    params: ConfigAutopilotGetParams;
    result: ConfigAutopilotGetResult;
  };
  'config:models-list': {
    params: Record<string, never>;
    result: ConfigModelsListResult;
  };
  'config:effort-get': {
    params: Record<string, never>;
    result: ConfigEffortGetResult;
  };
  'config:effort-set': {
    params: ConfigEffortSetParams;
    result: ConfigEffortSetResult;
  };
  'config:pricing-get': {
    params: Record<string, never>;
    result: ConfigPricingGetResult;
  };
  'auth:getHealth': {
    params: AuthGetHealthParams;
    result: AuthGetHealthResponse;
  };
  'auth:saveSettings': {
    params: AuthSaveSettingsParams;
    result: AuthSaveSettingsResponse;
  };
  'auth:testConnection': {
    params: AuthTestConnectionParams;
    result: AuthTestConnectionResponse;
  };
  'auth:getAuthStatus': {
    params: AuthGetAuthStatusParams;
    result: AuthGetAuthStatusResponse;
  };
  'auth:copilotLogin': {
    params: AuthCopilotLoginParams;
    result: AuthCopilotLoginResponse;
  };
  'auth:copilotLogout': {
    params: AuthCopilotLogoutParams;
    result: AuthCopilotLogoutResponse;
  };
  'auth:copilotStatus': {
    params: AuthCopilotStatusParams;
    result: AuthCopilotStatusResponse;
  };
  'auth:codexLogin': {
    params: AuthCodexLoginParams;
    result: AuthCodexLoginResponse;
  };
  'auth:kimiCodeLogin': {
    params: AuthKimiCodeLoginParams;
    result: AuthKimiCodeLoginResponse;
  };
  'auth:kimiCodeLoginCancel': {
    params: AuthKimiCodeLoginCancelParams;
    result: AuthKimiCodeLoginCancelResponse;
  };
  'auth:getEffectiveRoute': {
    params: AuthGetEffectiveRouteParams;
    result: AuthGetEffectiveRouteResult;
  };
  'auth:checkConnection': {
    params: AuthCheckConnectionParams;
    result: AuthCheckConnectionResult;
  };
  'config:getScopes': {
    params: ConfigGetScopesParams;
    result: ConfigGetScopesResult;
  };
  'config:clearScopeOverride': {
    params: ConfigClearScopeOverrideParams;
    result: ConfigClearScopeOverrideResult;
  };
  'auth:getScope': {
    params: Record<string, never>;
    result: AuthGetScopeResult;
  };
  'auth:clearWorkspaceOverride': {
    params: Record<string, never>;
    result: AuthClearWorkspaceOverrideResult;
  };
  'auth:verifyDraftConnection': {
    params: AuthVerifyDraftConnectionParams;
    result: AuthVerifyDraftConnectionResult;
  };
  'auth:cancelDraftVerification': {
    params: AuthCancelDraftVerificationParams;
    result: AuthCancelDraftVerificationResult;
  };
  'setup-status:get-status': {
    params: SetupStatusGetParams;
    result: SetupStatusGetResponse;
  };
  'setup-wizard:launch': {
    params: SetupWizardLaunchParams;
    result: SetupWizardLaunchResponse;
  };
  'wizard:deep-analyze': {
    params: WizardDeepAnalyzeParams;
    result: WizardDeepAnalyzeResponse;
  };
  'wizard:get-resumable-run': {
    params: WizardGetResumableRunParams;
    result: WizardGetResumableRunResponse;
  };
  'wizard:analysis-status': {
    params: WizardAnalysisStatusParams;
    result: WizardAnalysisStatusResponse;
  };
  'wizard:recommend-agents': {
    params: WizardRecommendAgentsParams;
    result: WizardRecommendAgentsResponse;
  };
  'wizard:cancel-analysis': {
    params: WizardCancelAnalysisParams;
    result: WizardCancelAnalysisResponse;
  };
  'wizard:submit-selection': {
    params: WizardSubmitSelectionParams;
    result: WizardSubmitSelectionResponse;
  };
  'wizard:cancel': {
    params: WizardCancelParams;
    result: WizardCancelResponse;
  };
  'wizard:get-generation-run-state': {
    params: WizardGetGenerationRunStateParams;
    result: WizardGetGenerationRunStateResponse;
  };
  'wizard:retry-item': {
    params: WizardRetryItemParams;
    result: WizardRetryItemResponse;
  };
  'wizard:preview-generation': {
    params: WizardPreviewGenerationParams;
    result: WizardPreviewGenerationResponse;
  };
  'wizard:list-analyses': {
    params: Record<string, never>;
    result: { analyses: SavedAnalysisMetadata[] };
  };
  'wizard:load-analysis': {
    params: { filename: string };
    result: MultiPhaseAnalysisResponse;
  };
  'wizard:list-agent-packs': {
    params: WizardListAgentPacksParams;
    result: WizardListAgentPacksResult;
  };
  'wizard:install-pack-agents': {
    params: WizardInstallPackAgentsParams;
    result: WizardInstallPackAgentsResult;
  };
  'license:getStatus': {
    params: LicenseGetStatusParams;
    result: LicenseGetStatusResponse;
  };
  'license:setKey': {
    params: LicenseSetKeyParams;
    result: LicenseSetKeyResponse;
  };
  'license:clearKey': {
    params: LicenseClearKeyParams;
    result: LicenseClearKeyResponse;
  };
  'command:execute': {
    params: CommandExecuteParams;
    result: CommandExecuteResponse;
  };
  'llm:getProviderStatus': {
    params: LlmGetProviderStatusParams;
    result: LlmProviderStatusResponse;
  };
  'llm:setApiKey': { params: LlmSetApiKeyParams; result: LlmSetApiKeyResponse };
  'llm:removeApiKey': {
    params: LlmRemoveApiKeyParams;
    result: LlmRemoveApiKeyResponse;
  };
  'llm:getDefaultProvider': {
    params: LlmGetDefaultProviderParams;
    result: LlmGetDefaultProviderResponse;
  };
  'llm:setDefaultProvider': {
    params: SetDefaultProviderRequest;
    result: SetDefaultProviderResponse;
  };
  'llm:validateApiKeyFormat': {
    params: LlmValidateApiKeyFormatParams;
    result: LlmValidateApiKeyFormatResponse;
  };
  'llm:setDefaultModel': {
    params: LlmSetDefaultModelParams;
    result: LlmSetDefaultModelResponse;
  };
  'llm:listVsCodeModels': {
    params: LlmListVsCodeModelsParams;
    result: unknown[];
  };
  'llm:listProviderModels': {
    params: LlmListProviderModelsParams;
    result: LlmListProviderModelsResponse;
  };
  'llm:setProviderBaseUrl': {
    params: LlmSetProviderBaseUrlParams;
    result: LlmSetProviderBaseUrlResponse;
  };
  'llm:getProviderBaseUrl': {
    params: LlmGetProviderBaseUrlParams;
    result: LlmGetProviderBaseUrlResponse;
  };
  'llm:clearProviderBaseUrl': {
    params: LlmClearProviderBaseUrlParams;
    result: LlmClearProviderBaseUrlResponse;
  };
  'provider:listModels': {
    params: ProviderListModelsParams;
    result: ProviderListModelsResult;
  };
  'provider:setModelTier': {
    params: ProviderSetModelTierParams;
    result: ProviderSetModelTierResult;
  };
  'provider:getModelTiers': {
    params: ProviderGetModelTiersParams;
    result: ProviderGetModelTiersResult;
  };
  'provider:clearModelTier': {
    params: ProviderClearModelTierParams;
    result: ProviderClearModelTierResult;
  };
  'provider:listCustomEntries': {
    params: ProviderListCustomEntriesParams;
    result: ProviderListCustomEntriesResult;
  };
  'provider:addCustomEntry': {
    params: ProviderAddCustomEntryParams;
    result: ProviderAddCustomEntryResult;
  };
  'provider:updateCustomEntry': {
    params: ProviderUpdateCustomEntryParams;
    result: ProviderUpdateCustomEntryResult;
  };
  'provider:removeCustomEntry': {
    params: ProviderRemoveCustomEntryParams;
    result: ProviderRemoveCustomEntryResult;
  };
  'provider:testCustomEntry': {
    params: ProviderTestCustomEntryParams;
    result: ProviderTestCustomEntryResult;
  };
  'provider:getAccountUsage': {
    params: ProviderGetAccountUsageParams;
    result: ProviderGetAccountUsageResult;
  };
  'provider:getPlanLimits': {
    params: ProviderGetPlanLimitsParams;
    result: ProviderGetPlanLimitsResult;
  };
  'chat:subagent-query': {
    params: SubagentQueryParams;
    result: SubagentQueryResult;
  };
  'subagent:send-message': {
    params: SubagentSendMessageParams;
    result: SubagentCommandResult;
  };
  'subagent:stop': {
    params: SubagentStopParams;
    result: SubagentCommandResult;
  };
  'subagent:interrupt': {
    params: SubagentInterruptParams;
    result: SubagentCommandResult;
  };
  'subagent:background': {
    params: SubagentBackgroundParams;
    result: SubagentBackgroundResult;
  };
  'subagent:history-page': {
    params: SubagentHistoryPageParams;
    result: SubagentHistoryPageResult;
  };
  'enhancedPrompts:getStatus': {
    params: EnhancedPromptsGetStatusParams;
    result: EnhancedPromptsGetStatusResponse;
  };
  'enhancedPrompts:runWizard': {
    params: EnhancedPromptsRunWizardParams;
    result: EnhancedPromptsRunWizardResponse;
  };
  'enhancedPrompts:setEnabled': {
    params: EnhancedPromptsSetEnabledParams;
    result: EnhancedPromptsSetEnabledResponse;
  };
  'enhancedPrompts:regenerate': {
    params: EnhancedPromptsRegenerateParams;
    result: EnhancedPromptsRegenerateResponse;
  };
  'enhancedPrompts:cancel': {
    params: EnhancedPromptsCancelParams;
    result: EnhancedPromptsCancelResponse;
  };
  'enhancedPrompts:getRunState': {
    params: EnhancedPromptsGetRunStateParams;
    result: EnhancedPromptsGetRunStateResponse;
  };
  'enhancedPrompts:getPromptContent': {
    params: { workspacePath: string };
    result: { content: string | null; error?: string };
  };
  'enhancedPrompts:download': {
    params: { workspacePath: string };
    result: { success: boolean; filePath?: string; error?: string };
  };
  'quality:getAssessment': {
    params: QualityGetAssessmentParams;
    result: QualityGetAssessmentResult;
  };
  'quality:getHistory': {
    params: QualityGetHistoryParams;
    result: QualityGetHistoryResult;
  };
  'quality:export': {
    params: QualityExportParams;
    result: QualityExportResult;
  };
  'plugins:list-available': {
    params: Record<string, never>;
    result: { plugins: PluginInfo[] };
  };
  'plugins:get-config': {
    params: Record<string, never>;
    result: PluginConfigState;
  };
  'plugins:save-config': {
    params: {
      enabledPluginIds: string[];
      disabledSkillIds?: string[];
      /**
       * Explicit denylist for default-enabled (harness-authored) plugins.
       * Omit to preserve whatever is already persisted — clients that predate
       * this field (TUI, CLI) must not clobber it.
       */
      disabledPluginIds?: string[];
    };
    result: { success: boolean; error?: string };
  };
  'plugins:list-skills': {
    params: { pluginIds: string[] };
    result: { skills: PluginSkillEntry[] };
  };
  /** Registered external marketplaces plus the built-in suggestions. */
  'plugins:list-marketplaces': {
    params: Record<string, never>;
    result: ListMarketplacesResult;
  };
  /** Register an `owner/repo` after fetching and validating its manifest. */
  'plugins:add-marketplace': {
    params: MarketplaceSourceParams;
    result: { marketplace: ExternalMarketplace };
  };
  /** Deregister a marketplace. Installed plugins from it are NOT removed. */
  'plugins:remove-marketplace': {
    params: MarketplaceSourceParams;
    result: { removed: boolean };
  };
  /** List the plugins a registered marketplace advertises. */
  'plugins:browse-marketplace': {
    params: MarketplaceBrowseParams;
    result: ExternalMarketplaceBrowseResult;
  };
  /**
   * Two-call install. Without `consentToken` this writes nothing and returns a
   * plan; with a valid token it performs the install. See
   * `rpc-plugin-marketplace.types.ts` for the security model.
   */
  'plugins:install-external': {
    params: ExternalInstallParams;
    result: ExternalInstallResponse;
  };
  /** Remove an installed external plugin and its consent record. */
  'plugins:uninstall-external': {
    params: ExternalUninstallParams;
    result: ExternalUninstallResult;
  };
  'agent:getConfig': {
    params: void;
    result: AgentOrchestrationConfig;
  };
  'agent:setConfig': {
    params: AgentSetConfigParams;
    result: { success: boolean; error?: string };
  };
  'agent:detectClis': {
    params: void;
    result: { clis: import('./agent-process.types').CliDetectionResult[] };
  };
  'agent:listCliModels': {
    params: void;
    result: AgentListCliModelsResult;
  };
  /** Route user's permission decision to Copilot SDK bridge */
  'agent:permissionResponse': {
    params: AgentPermissionDecision;
    result: { success: boolean; error?: string };
  };
  /**
   * TEST-ONLY seam (TASK_2026_264). Invokes the real
   * `SdkPermissionHandler.createCallback()` — the exact entry point the SDK
   * itself calls for every tool permission check — so an out-of-process e2e
   * can populate the REAL `pendingRequests` map without a live model. No-ops
   * with `{success:false, error:'e2e-only'}` unless `PTAH_E2E=1`, the same
   * flag the e2e launcher already sets and the same gating precedent used by
   * `apps/ptah-extension-vscode/src/activation/bootstrap.ts`'s license seed.
   * Awaits the full permission round trip, so a call with no routable
   * `sessionId`/`tabId` blocks for up to the 60s unroutable-deny timeout.
   */
  'agent:e2eSeedPermission': {
    params: {
      toolName: string;
      input: Record<string, unknown>;
      toolUseId: string;
      sessionId?: string;
      tabId?: string;
    };
    result: {
      success: boolean;
      error?: string;
      behavior?: 'allow' | 'deny';
      message?: string;
      interrupt?: boolean;
    };
  };
  /** Stop a running CLI agent by agentId */
  'agent:stop': {
    params: { agentId: string };
    result: { success: boolean; error?: string };
  };
  'agent:continue': {
    params: { agentId: string; message: string };
    result: { success: boolean; error?: string; code?: AgentContinueErrorCode };
  };
  /** Resume a CLI agent session by spawning a new process with resumeSessionId */
  'agent:resumeCliSession': {
    params: {
      /** CLI-native session ID to resume */
      cliSessionId: string;
      /** Which CLI adapter produced this session */
      cli: import('./agent-process.types').CliType;
      /** Task description to re-use */
      task: string;
      /** Parent Ptah session ID (for re-linking) */
      parentSessionId?: string;
      /** Ptah CLI agent ID (for ptah-cli type agents) */
      ptahCliId?: string;
      /** Previous agent ID (for in-place card replacement on resume) */
      previousAgentId?: string;
    };
    result: {
      success: boolean;
      agentId?: string;
      error?: string;
      /** What the resume gate did: the session was resumed, or a fresh lane got a handoff brief, and why. */
      resumeDecision?: import('./agent-process.types').AgentResumeOutcome;
      /** Set with the fixed refusal text when the runtime refused the lane's named Claude account. */
      code?: 'account_refused';
    };
  };
  /** List background agents for a session */
  'agent:backgroundList': {
    params: { sessionId?: string };
    result: {
      agents: Array<{
        toolCallId: string;
        agentId: string;
        agentType: string;
        status: string;
        startedAt: number;
      }>;
    };
  };
  /**
   * Read-only per-lane plan-limit rows, as `ptah_agent_list` prints them
   * (TASK_2026_623 R10.1). Electron only; text and lane counts, no identity.
   */
  'agent:getLanePlanLimits': {
    params: AgentGetLanePlanLimitsParams;
    result: AgentGetLanePlanLimitsResult;
  };
  /**
   * Per-slug outcome signals for the Agents tab (TASK_2026_646, Req 9.1).
   * Read-only; ids, counts and ratios only, no text or identity.
   */
  'agent:outcomeSignals': {
    params: AgentOutcomeSignalsParams;
    result: AgentOutcomeSignalsResult;
  };
  /**
   * Decision-capable models of one host, for the decision-model picker
   * (TASK_2026_684, Requirement 4). Every host; ids and counts only.
   */
  'agent:listDecisionModels': {
    params: AgentListDecisionModelsParams;
    result: AgentListDecisionModelsResult;
  };
  'ptahCli:list': {
    params: PtahCliListParams;
    result: PtahCliListResult;
  };
  'ptahCli:create': {
    params: PtahCliCreateParams;
    result: PtahCliCreateResult;
  };
  'ptahCli:update': {
    params: PtahCliUpdateParams;
    result: PtahCliUpdateResult;
  };
  'ptahCli:delete': {
    params: PtahCliDeleteParams;
    result: PtahCliDeleteResult;
  };
  'ptahCli:testConnection': {
    params: PtahCliTestConnectionParams;
    result: PtahCliTestConnectionResult;
  };
  'ptahCli:listModels': {
    params: PtahCliListModelsParams;
    result: PtahCliListModelsResult;
  };
  'skillsSh:search': {
    params: { query: string };
    result: { skills: SkillShEntry[]; error?: string };
  };
  'skillsSh:listInstalled': {
    params: Record<string, never>;
    result: { skills: InstalledSkill[] };
  };
  /**
   * Install a skills.sh skill into its Ptah-owned source root, then propagate.
   *
   * Neither `scope` nor `agents` survives from the pre-TASK_2026_288 shape, and
   * both were removed for the same reason: each named a choice the
   * implementation could not make.
   *
   * - `agents?: SkillAgentTarget[]` was declared, validated and then dropped on
   *   the floor — every install hardcoded `--agent claude-code`. It is gone
   *   rather than wired because target selection now has ONE owner: the
   *   reconciler fans a skill out to every CLI `IHarnessCliDetector` finds.
   *   Honouring a per-install list would be a second, divergent copy of that
   *   decision, and a skill installed "for Codex only" would be silently
   *   overwritten by the next pass anyway.
   * - `scope: 'project' | 'global'` chose between `{ws}/.claude/skills` and
   *   `~/.claude/skills`. The reconciler reconciles neither, so both values
   *   became the same user-global source root. Per-workspace control moved to
   *   `disabledPluginIds` / `disabledSkillIds`, which is reversible.
   */
  'skillsSh:install': {
    params: {
      source: string;
      skillId?: string;
    };
    result: { success: boolean; error?: string };
  };
  'skillsSh:uninstall': {
    params: { name: string };
    result: { success: boolean; error?: string };
  };
  'skillsSh:getPopular': {
    params: Record<string, never>;
    result: { skills: SkillShEntry[] };
  };
  'skillsSh:detectRecommended': {
    params: Record<string, never>;
    result: SkillDetectionResult;
  };
  'mcpDirectory:search': {
    params: McpDirectorySearchParams;
    result: McpDirectorySearchResult;
  };
  'mcpDirectory:getDetails': {
    params: McpDirectoryGetDetailsParams;
    result: McpDirectoryGetDetailsResult;
  };
  'mcpDirectory:install': {
    params: McpDirectoryInstallParams;
    result: McpDirectoryInstallResult;
  };
  'mcpDirectory:uninstall': {
    params: McpDirectoryUninstallParams;
    result: McpDirectoryUninstallResult;
  };
  'mcpDirectory:listInstalled': {
    params: McpDirectoryListInstalledParams;
    result: McpDirectoryListInstalledResult;
  };
  'mcpDirectory:getPopular': {
    params: McpDirectoryGetPopularParams;
    result: McpDirectoryGetPopularResult;
  };
  'mcpDirectory:setSmitheryApiKey': {
    params: McpDirectorySetSmitheryApiKeyParams;
    result: McpDirectorySetSmitheryApiKeyResult;
  };
  'mcpDirectory:getSmitheryKeyStatus': {
    params: McpDirectoryGetSmitheryKeyStatusParams;
    result: McpDirectoryGetSmitheryKeyStatusResult;
  };
  'mcpDirectory:resolveSmithery': {
    params: McpDirectoryResolveSmitheryParams;
    result: McpDirectoryResolveSmitheryResult;
  };
  'mcpDirectory:installSmithery': {
    params: McpDirectoryInstallSmitheryParams;
    result: McpDirectoryInstallSmitheryResult;
  };
  'mcpDirectory:uninstallSmithery': {
    params: McpDirectoryUninstallSmitheryParams;
    result: McpDirectoryUninstallSmitheryResult;
  };
  'mcpDirectory:listSmitheryInstalled': {
    params: McpDirectoryListSmitheryInstalledParams;
    result: McpDirectoryListSmitheryInstalledResult;
  };
  'mcpDirectory:smitheryAccount': {
    params: McpDirectorySmitheryAccountParams;
    result: McpDirectorySmitheryAccountResult;
  };
  'mcpDirectory:listSmitheryConnections': {
    params: McpDirectoryListSmitheryConnectionsParams;
    result: McpDirectoryListSmitheryConnectionsResult;
  };
  'mcpDirectory:smitheryConnectionStatus': {
    params: McpDirectorySmitheryConnectionStatusParams;
    result: McpDirectorySmitheryConnectionStatusResult;
  };
  'mcpDirectory:openSmitherySetup': {
    params: McpDirectoryOpenSmitherySetupParams;
    result: McpDirectoryOpenSmitherySetupResult;
  };
  'mcpDirectory:connectOAuth': {
    params: McpDirectoryConnectOAuthParams;
    result: McpDirectoryConnectOAuthResult;
  };
  'mcpDirectory:probeOAuthDiscovery': {
    params: McpDirectoryProbeOAuthDiscoveryParams;
    result: McpDirectoryProbeOAuthDiscoveryResult;
  };
  'mcpDirectory:oauthStatus': {
    params: McpDirectoryOAuthStatusParams;
    result: McpDirectoryOAuthStatusResult;
  };
  'mcpDirectory:disconnectOAuth': {
    params: McpDirectoryDisconnectOAuthParams;
    result: McpDirectoryDisconnectOAuthResult;
  };
  'mcpDirectory:listOAuthConnected': {
    params: McpDirectoryListOAuthConnectedParams;
    result: McpDirectoryListOAuthConnectedResult;
  };
  'mcpDirectory:getOAuthRedirectUri': {
    params: McpDirectoryGetOAuthRedirectUriParams;
    result: McpDirectoryGetOAuthRedirectUriResult;
  };
  /** Every MCP server, skill and plugin row for the active workspace. */
  'capabilities:getState': {
    params: CapabilitiesGetStateParams;
    result: CapabilitiesGetStateResult;
  };
  /** The effective set a session in the active workspace would load. */
  'capabilities:getEffective': {
    params: CapabilitiesGetEffectiveParams;
    result: CapabilitiesGetEffectiveResult;
  };
  /** One workspace or global toggle; returns the re-resolved row. */
  'capabilities:setEnabled': {
    params: CapabilitiesSetEnabledParams;
    result: CapabilitiesSetEnabledResult;
  };
  'workspace:getInfo': {
    params: Record<string, never>;
    result: {
      folders: string[];
      root: string | undefined;
      activeFolder: string | undefined;
      name: string;
    };
  };
  'workspace:addFolder': {
    params: Record<string, never>;
    result: { path: string | null; name: string | null; error?: string };
  };
  'workspace:removeFolder': {
    params: { path: string };
    result: { success: boolean; error?: string };
  };
  'workspace:switch': {
    params: { path: string; origin?: string };
    result: { success: boolean; error?: string };
  };
  'workspace:registerFolder': {
    params: { path: string };
    result: { success: boolean; path: string; name: string; error?: string };
  };
  'workspace:listRecent': {
    params: Record<string, never>;
    result: WorkspaceListRecentResult;
  };
  'file:read': {
    params: { path: string };
    result: { content: string };
  };
  'file:exists': {
    params: { path: string };
    result: { exists: boolean };
  };
  'file:save-dialog': {
    params: {
      content: string;
      defaultFileName?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    };
    result: { saved: boolean; filePath?: string; error?: string };
  };
  'config:model-set': {
    params: {
      model?: string;
      autopilot?: boolean;
      applyTo?: 'global' | 'workspace';
    };
    result: { success: boolean };
  };
  'auth:setApiKey': {
    params: { provider: string; apiKey: string };
    result: { success: boolean; error?: string };
  };
  'auth:deleteStoredKey': {
    params: AuthDeleteStoredKeyParams;
    result: AuthDeleteStoredKeyResult;
  };
  'auth:getStatus': {
    params: Record<string, never>;
    result: { isAuthenticated: boolean; provider: string; hasApiKey: boolean };
  };
  'auth:getApiKeyStatus': {
    params: Record<string, never>;
    result: AuthGetApiKeyStatusResult;
  };
  'settings:get': {
    params: { key: string };
    result: { success: boolean; value?: unknown; error?: string };
  };
  'settings:set': {
    params: { key: string; value: unknown };
    result: { success: boolean; error?: string };
  };
  'settings:export': {
    params: Record<string, never>;
    result: {
      exported: boolean;
      cancelled?: boolean;
      filePath?: string;
      secretCount?: number;
      configCount?: number;
      error?: string;
    };
  };
  'settings:import': {
    params: Record<string, never>;
    result: {
      cancelled?: boolean;
      result?: { imported: string[]; skipped: string[]; errors: string[] };
    };
  };
  'webSearch:getApiKeyStatus': {
    params: { provider: string };
    result: { configured: boolean };
  };
  'webSearch:setApiKey': {
    params: { provider: string; apiKey: string };
    result: { success: boolean };
  };
  'webSearch:deleteApiKey': {
    params: { provider: string };
    result: { success: boolean };
  };
  'webSearch:test': {
    params: Record<string, never>;
    result: {
      success: boolean;
      results: Array<{ provider: string; success: boolean; error?: string }>;
    };
  };
  'webSearch:getConfig': {
    params: Record<string, never>;
    result: { providers: string[]; maxResults: number };
  };
  'webSearch:setConfig': {
    params: { providers?: string[]; maxResults?: number };
    result: { success: boolean };
  };
  'git:info': { params: GitInfoParams; result: GitInfoResult };
  'git:reviewChanges': {
    params: GitReviewChangesParams;
    result: GitReviewChangesResult;
  };
  'git:reviewFile': {
    params: GitReviewFileParams;
    result: GitReviewFileResult;
  };
  'git:worktrees': { params: GitWorktreesParams; result: GitWorktreesResult };
  'git:addWorktree': {
    params: GitAddWorktreeParams;
    result: GitAddWorktreeResult;
  };
  'git:removeWorktree': {
    params: GitRemoveWorktreeParams;
    result: GitRemoveWorktreeResult;
  };
  'git:stage': { params: GitStageParams; result: GitStageResult };
  'git:unstage': { params: GitUnstageParams; result: GitUnstageResult };
  'git:discard': { params: GitDiscardParams; result: GitDiscardResult };
  'git:commit': { params: GitCommitParams; result: GitCommitResult };
  'git:cancelOperation': {
    params: GitCancelOperationParams;
    result: GitCancelOperationResult;
  };
  'git:generateCommitMessage': {
    params: GitGenerateCommitMessageParams;
    result: GitGenerateCommitMessageResult;
  };
  'git:prStatus': { params: GitPrStatusParams; result: GitPrStatusResult };
  'git:operationAbort': {
    params: GitOperationAbortParams;
    result: GitOperationAbortResult;
  };
  'git:operationContinue': {
    params: GitOperationContinueParams;
    result: GitOperationContinueResult;
  };
  'git:log': { params: GitLogParams; result: GitLogResult };
  'git:showFile': { params: GitShowFileParams; result: GitShowFileResult };
  'git:diffFile': { params: GitDiffFileParams; result: GitDiffFileResult };
  'git:applyHunks': {
    params: GitApplyHunksParams;
    result: GitApplyHunksResult;
  };
  'git:push': { params: GitPushParams; result: GitPushResult };
  'git:pull': { params: GitPullParams; result: GitPullResult };
  'git:fetch': { params: GitFetchParams; result: GitFetchResult };
  'git:branches': { params: GitBranchesParams; result: GitBranchesResult };
  'git:checkout': { params: GitCheckoutParams; result: GitCheckoutResult };
  'git:stashList': { params: GitStashListParams; result: GitStashListResult };
  'git:stashApply': {
    params: GitStashApplyParams;
    result: GitStashMutationResult;
  };
  'git:stashPop': { params: GitStashPopParams; result: GitStashMutationResult };
  'git:stashDrop': {
    params: GitStashDropParams;
    result: GitStashMutationResult;
  };
  'git:stashShow': { params: GitStashShowParams; result: GitStashShowResult };
  'git:tags': { params: GitTagsParams; result: GitTagsResult };
  'git:remotes': { params: GitRemotesParams; result: GitRemotesResult };
  'git:lastCommit': {
    params: GitLastCommitParams;
    result: GitLastCommitResult;
  };
  'git:turnChangeSets': {
    params: GitTurnChangeSetsParams;
    result: GitTurnChangeSetsResult;
  };
  'harness:initialize': {
    params: HarnessInitializeParams;
    result: HarnessInitializeResponse;
  };
  'harness:suggest-config': {
    params: HarnessSuggestConfigParams;
    result: HarnessSuggestConfigResponse;
  };
  'harness:search-skills': {
    params: HarnessSearchSkillsParams;
    result: HarnessSearchSkillsResponse;
  };
  'harness:create-skill': {
    params: HarnessCreateSkillParams;
    result: HarnessCreateSkillResponse;
  };
  'harness:discover-mcp': {
    params: HarnessDiscoverMcpParams;
    result: HarnessDiscoverMcpResponse;
  };
  'harness:generate-prompt': {
    params: HarnessGeneratePromptParams;
    result: HarnessGeneratePromptResponse;
  };
  'harness:generate-claude-md': {
    params: HarnessGenerateClaudeMdParams;
    result: HarnessGenerateClaudeMdResponse;
  };
  'harness:apply': {
    params: HarnessApplyParams;
    result: HarnessApplyResponse;
  };
  'harness:save-preset': {
    params: HarnessSavePresetParams;
    result: HarnessSavePresetResponse;
  };
  'harness:load-presets': {
    params: HarnessLoadPresetsParams;
    result: HarnessLoadPresetsResponse;
  };
  'harness:design-agents': {
    params: HarnessDesignAgentsParams;
    result: HarnessDesignAgentsResponse;
  };
  'harness:generate-skills': {
    params: HarnessGenerateSkillsParams;
    result: HarnessGenerateSkillsResponse;
  };
  'harness:generate-document': {
    params: HarnessGenerateDocumentParams;
    result: HarnessGenerateDocumentResponse;
  };
  'harness:analyze-intent': {
    params: HarnessAnalyzeIntentParams;
    result: HarnessAnalyzeIntentResponse;
  };
  'harness:start-new-project': {
    params: HarnessStartNewProjectParams;
    result: HarnessStartNewProjectResult;
  };
  'harness:get-proposal': {
    params: HarnessGetProposalParams;
    result: HarnessGetProposalResult;
  };
  'harness:workflow-prompt': {
    params: HarnessWorkflowPromptParams;
    result: HarnessWorkflowPromptResponse;
  };
  'harness:health': {
    params: HarnessHealthParams;
    result: HarnessHealthResult;
  };
  'harness:reconcile': {
    params: HarnessReconcileParams;
    result: HarnessReconcileResult;
  };
  'harness:remove': {
    params: HarnessRemoveParams;
    result: HarnessRemoveResult;
  };
  /**
   * The consent-gated repair of a blocked path (TASK_2026_306 Batch 8).
   *
   * Per-path only. Nothing proves Ptah wrote the directories that occupy these
   * paths, so the user's explicit selection IS the ownership claim and there is
   * deliberately no bulk shape to weaken it.
   */
  'harness:repairBlocked': {
    params: HarnessRepairBlockedParams;
    result: HarnessRepairBlockedResult;
  };
  /**
   * The per-workspace skill selection (TASK_2026_316 Batch 3).
   *
   * `get` is READ-ONLY — it resolves the gate and never persists the derived
   * answer, so a surface that polls cannot record a decision for the user.
   * `set` writes the choice and then propagates it.
   */
  'harness:get-skill-selection': {
    params: HarnessGetSkillSelectionParams;
    result: HarnessGetSkillSelectionResult;
  };
  'harness:set-skill-selection': {
    params: HarnessSetSkillSelectionParams;
    result: HarnessSetSkillSelectionResult;
  };
  'memory:list': { params: MemoryListParams; result: MemoryListResult };
  'memory:search': { params: MemorySearchParams; result: MemorySearchResult };
  'memory:get': { params: MemoryGetParams; result: MemoryGetResult };
  'memory:pin': { params: MemoryPinParams; result: MemoryPinResult };
  'memory:unpin': { params: MemoryPinParams; result: MemoryPinResult };
  'memory:forget': { params: MemoryForgetParams; result: MemoryForgetResult };
  'memory:rebuildIndex': {
    params: MemoryRebuildIndexParams;
    result: MemoryRebuildIndexResult;
  };
  'memory:stats': { params: MemoryStatsParams; result: MemoryStatsResult };
  'memory:searchSymbols': {
    params: MemorySearchSymbolsParams;
    result: MemorySearchSymbolsResult;
  };
  'memory:purgeBySubjectPattern': {
    params: MemoryPurgeBySubjectPatternParams;
    result: MemoryPurgeBySubjectPatternResult;
  };
  'memory:purgeJunk': {
    params: MemoryPurgeJunkParams;
    result: MemoryPurgeJunkResult;
  };
  'memory:diagnostics': {
    params: MemoryDiagnosticsParams;
    result: MemoryDiagnosticsResult;
  };
  'memory:runNow': {
    params: MemoryRunNowParams;
    result: MemoryRunNowResult;
  };
  'memory:setTriggers': {
    params: MemorySetTriggersParams;
    result: MemorySetTriggersResult;
  };
  'memory:getTriggers': {
    params: MemoryGetTriggersParams;
    result: MemoryGetTriggersResult;
  };
  'memory:listQuarantined': {
    params: MemoryListQuarantinedParams;
    result: MemoryListQuarantinedResult;
  };
  'memory:restoreQuarantined': {
    params: MemoryRestoreQuarantinedParams;
    result: MemoryRestoreQuarantinedResult;
  };
  'mem:searchIndex': {
    params: MemSearchIndexParams;
    result: MemSearchIndexResult;
  };
  'mem:timeline': {
    params: MemTimelineParams;
    result: MemTimelineResult;
  };
  'mem:getObservations': {
    params: MemGetObservationsParams;
    result: MemGetObservationsResult;
  };
  'corpus:list': {
    params: CorpusListParams;
    result: CorpusListResult;
  };
  'corpus:get': {
    params: CorpusGetParams;
    result: CorpusGetResult;
  };
  'corpus:build': {
    params: CorpusBuildParams;
    result: CorpusBuildResult;
  };
  'corpus:prime': {
    params: CorpusPrimeParams;
    result: CorpusPrimeResult;
  };
  'corpus:query': {
    params: CorpusQueryParams;
    result: CorpusQueryResult;
  };
  'corpus:reprime': {
    params: CorpusReprimeParams;
    result: CorpusReprimeResult;
  };
  'corpus:rebuild': {
    params: CorpusRebuildParams;
    result: CorpusRebuildResult;
  };
  'corpus:delete': {
    params: CorpusDeleteParams;
    result: CorpusDeleteResult;
  };
  'corpus:suggest': {
    params: CorpusSuggestParams;
    result: CorpusSuggestResult;
  };
  'skillSynthesis:listClones': {
    params: SkillSynthesisListClonesParams;
    result: SkillSynthesisListClonesResult;
  };
  'skillSynthesis:getClone': {
    params: SkillSynthesisGetCloneParams;
    result: SkillSynthesisGetCloneResult;
  };
  'skillSynthesis:previewEnhancement': {
    params: SkillSynthesisPreviewEnhancementParams;
    result: SkillSynthesisPreviewEnhancementResult;
  };
  'skillSynthesis:applyProposal': {
    params: SkillSynthesisApplyProposalParams;
    result: SkillSynthesisApplyProposalResult;
  };
  'skillSynthesis:getHistoryBody': {
    params: SkillSynthesisGetHistoryBodyParams;
    result: SkillSynthesisGetHistoryBodyResult;
  };
  'skillSynthesis:revertEnhancement': {
    params: SkillSynthesisRevertEnhancementParams;
    result: SkillSynthesisRevertEnhancementResult;
  };
  'skillSynthesis:rebaseClone': {
    params: SkillSynthesisRebaseCloneParams;
    result: SkillSynthesisRebaseCloneResult;
  };
  'skillSynthesis:keepClone': {
    params: SkillSynthesisKeepCloneParams;
    result: SkillSynthesisKeepCloneResult;
  };
  'skillSynthesis:saveCloneBody': {
    params: SkillSynthesisSaveCloneBodyParams;
    result: SkillSynthesisSaveCloneBodyResult;
  };
  'skillSynthesis:listQuarantinedAgents': {
    params: SkillSynthesisListQuarantinedAgentsParams;
    result: SkillSynthesisListQuarantinedAgentsResult;
  };
  'skillSynthesis:restoreQuarantinedAgent': {
    params: SkillSynthesisRestoreQuarantinedAgentParams;
    result: SkillSynthesisRestoreQuarantinedAgentResult;
  };
  'skillSynthesis:getAgentModels': {
    params: SkillSynthesisGetAgentModelsParams;
    result: SkillSynthesisGetAgentModelsResult;
  };
  'skillSynthesis:setAgentModel': {
    params: SkillSynthesisSetAgentModelParams;
    result: SkillSynthesisSetAgentModelResult;
  };
  'skillSynthesis:invocationStats': {
    params: SkillSynthesisInvocationStatsParams;
    result: SkillSynthesisInvocationStatsResult;
  };
  'skillSynthesis:getScorecards': {
    params: SkillSynthesisGetScorecardsParams;
    result: SkillSynthesisGetScorecardsResult;
  };
  'skillSynthesis:getScorecardDetail': {
    params: SkillSynthesisGetScorecardDetailParams;
    result: SkillSynthesisGetScorecardDetailResult;
  };
  'skillSynthesis:listSpecs': {
    params: SkillSynthesisListSpecsParams;
    result: SkillSynthesisListSpecsResult;
  };
  'skillSynthesis:harvestSpecs': {
    params: SkillSynthesisHarvestSpecsParams;
    result: SkillSynthesisHarvestSpecsResult;
  };
  'skillSynthesis:clearStaleSpecs': {
    params: SkillSynthesisClearStaleSpecsParams;
    result: SkillSynthesisClearStaleSpecsResult;
  };
  'cron:list': { params: CronListParams; result: CronListResult };
  'cron:get': { params: CronGetParams; result: CronGetResult };
  'cron:create': { params: CronCreateParams; result: CronCreateResult };
  'cron:update': { params: CronUpdateParams; result: CronUpdateResult };
  'cron:delete': { params: CronDeleteParams; result: CronDeleteResult };
  'cron:toggle': { params: CronToggleParams; result: CronToggleResult };
  'cron:runNow': { params: CronRunNowParams; result: CronRunNowResult };
  'cron:runs': { params: CronRunsParams; result: CronRunsResult };
  'cron:nextFire': { params: CronNextFireParams; result: CronNextFireResult };
  'gateway:status': {
    params: GatewayStatusParams;
    result: GatewayStatusResult;
  };
  'gateway:start': {
    params: GatewayStartParams;
    result: GatewayStartResult;
  };
  'gateway:stop': {
    params: GatewayStopParams;
    result: GatewayStopResult;
  };
  'gateway:setToken': {
    params: GatewaySetTokenParams;
    result: GatewaySetTokenResult;
  };
  'gateway:listBindings': {
    params: GatewayListBindingsParams;
    result: GatewayListBindingsResult;
  };
  'gateway:approveBinding': {
    params: GatewayApproveBindingParams;
    result: GatewayApproveBindingResult;
  };
  'gateway:blockBinding': {
    params: GatewayBlockBindingParams;
    result: GatewayBlockBindingResult;
  };
  'gateway:listMessages': {
    params: GatewayListMessagesParams;
    result: GatewayListMessagesResult;
  };
  'gateway:test': {
    params: GatewayTestParams;
    result: GatewayTestResult;
  };
  'gateway:getAllowList': {
    params: GatewayGetAllowListParams;
    result: GatewayGetAllowListResult;
  };
  'gateway:setAllowList': {
    params: GatewaySetAllowListParams;
    result: GatewaySetAllowListResult;
  };
  'gateway:getDiscordAppId': {
    params: GatewayGetDiscordAppIdParams;
    result: GatewayGetDiscordAppIdResult;
  };
  'gateway:setDiscordAppId': {
    params: GatewaySetDiscordAppIdParams;
    result: GatewaySetDiscordAppIdResult;
  };
  'gateway:registerDiscordCommands': {
    params: GatewayRegisterDiscordCommandsParams;
    result: GatewayRegisterDiscordCommandsResult;
  };
  'gateway:listDiscordGuilds': {
    params: GatewayListDiscordGuildsParams;
    result: GatewayListDiscordGuildsResult;
  };
  'gateway:attachSession': {
    params: GatewayAttachSessionParams;
    result: GatewayAttachSessionResult;
  };
  'gateway:detachSession': {
    params: GatewayDetachSessionParams;
    result: GatewayDetachSessionResult;
  };

  'voice:transcribe': {
    params: VoiceTranscribeParams;
    result: VoiceTranscribeResult;
  };
  'voice:getConfig': {
    params: VoiceGetConfigParams;
    result: VoiceGetConfigResult;
  };
  'voice:setConfig': {
    params: VoiceSetConfigParams;
    result: VoiceSetConfigResult;
  };
  'voice:downloadModel': {
    params: VoiceDownloadModelParams;
    result: VoiceDownloadModelResult;
  };
  'voice:getTtsConfig': {
    params: VoiceGetTtsConfigParams;
    result: VoiceGetTtsConfigResult;
  };
  'voice:setTtsConfig': {
    params: VoiceSetTtsConfigParams;
    result: VoiceSetTtsConfigResult;
  };
  'voice:downloadTtsModel': {
    params: VoiceDownloadTtsModelParams;
    result: VoiceDownloadTtsModelResult;
  };
  'voice:synthesize': {
    params: VoiceSynthesizeParams;
    result: VoiceSynthesizeResult;
  };

  // Provider-agnostic voice surface (FR-8). Appended after the existing 8.
  'voice:listProviders': {
    params: VoiceListProvidersParams;
    result: VoiceListProvidersResult;
  };
  'voice:listVoices': {
    params: VoiceListVoicesParams;
    result: VoiceListVoicesResult;
  };
  'voice:getProviderConfig': {
    params: VoiceGetProviderConfigParams;
    result: VoiceGetProviderConfigResult;
  };
  'voice:setProviderConfig': {
    params: VoiceSetProviderConfigParams;
    result: VoiceSetProviderConfigResult;
  };
  'voice:setApiKey': {
    params: VoiceSetApiKeyParams;
    result: VoiceSetApiKeyResult;
  };
  'voice:testConnection': {
    params: VoiceTestConnectionParams;
    result: VoiceTestConnectionResult;
  };

  /**
   * Pull the current boot readiness. Same shape as the
   * `boot:readinessChanged` push, because a renderer that missed the push —
   * Angular installs its message listener after `did-finish-load`, and a
   * renderer reload gets no replay — must not need a second consumer path.
   */
  'boot:getReadiness': {
    params: Record<string, never>;
    result: BootGetReadinessResult;
  };

  'db:health': {
    params: { fullCheck?: boolean };
    result: DbHealthResult;
  };
  'db:reset': {
    params: { confirm: string };
    result: DbResetResult;
  };
  'db:reloadVec': {
    params: Record<string, never>;
    result: DbReloadVecResult;
  };
  'db:openBindingFolder': {
    params: Record<string, never>;
    result: DbOpenBindingFolderResult;
  };
  'embedder:status': {
    params: EmbedderStatusParams;
    result: EmbedderStatusResult;
  };
  'embedder:retry': {
    params: EmbedderRetryParams;
    result: EmbedderRetryResult;
  };
  'indexing:getStatus': {
    params: IndexingGetStatusParams;
    result: IndexingGetStatusResult;
  };
  'indexing:start': {
    params: IndexingStartParams;
    result: IndexingStartResult;
  };
  'indexing:pause': {
    params: IndexingPauseParams;
    result: IndexingPauseResult;
  };
  'indexing:resume': {
    params: IndexingResumeParams;
    result: IndexingResumeResult;
  };
  'indexing:cancel': {
    params: IndexingCancelParams;
    result: IndexingCancelResult;
  };
  'indexing:setPipelineEnabled': {
    params: IndexingSetPipelineEnabledParams;
    result: IndexingSetPipelineEnabledResult;
  };
  'indexing:dismissStale': {
    params: IndexingDismissStaleParams;
    result: IndexingDismissStaleResult;
  };
  'indexing:acknowledgeDisclosure': {
    params: IndexingAcknowledgeDisclosureParams;
    result: IndexingAcknowledgeDisclosureResult;
  };
  'update:get-state': {
    params: UpdateGetStateParams;
    result: UpdateGetStateResult;
  };
  'update:check-now': {
    params: UpdateCheckNowParams;
    result: UpdateCheckNowResult;
  };
  'update:mark-downloaded': {
    params: UpdateMarkDownloadedParams;
    result: UpdateMarkDownloadedResult;
  };
  'diagnostics:go-vet-consent-get': {
    params: DiagnosticsGoVetConsentGetParams;
    result: DiagnosticsGoVetConsentGetResult;
  };
  'diagnostics:go-vet-consent-set': {
    params: DiagnosticsGoVetConsentSetParams;
    result: DiagnosticsGoVetConsentSetResult;
  };
  'tasks:list': { params: TasksListParams; result: TasksListResult };
  'tasks:get': { params: TasksGetParams; result: TasksGetResult };
  'tasks:getArtifact': {
    params: TasksGetArtifactParams;
    result: TasksGetArtifactResult;
  };
  'tasks:getRoundJudge': {
    params: TasksGetRoundJudgeParams;
    result: TasksGetRoundJudgeResult;
  };
  'tasks:create': { params: TasksCreateParams; result: TasksCreateResult };
  'tasks:sweepFinished': {
    params: TasksSweepParams;
    result: TasksSweepResult;
  };
  'tasks:updateStatus': {
    params: TasksUpdateStatusParams;
    result: TasksUpdateStatusResult;
  };
  'tasks:updateMetadata': {
    params: TasksUpdateMetadataParams;
    result: TasksUpdateMetadataResult;
  };
  'tasks:bulkUpdateStatus': {
    params: TasksBulkUpdateStatusParams;
    result: TasksBulkUpdateStatusResult;
  };
  'tasks:bulkUpdateLabel': {
    params: TasksBulkUpdateLabelParams;
    result: TasksBulkUpdateLabelResult;
  };
  'tasks:generateRegistry': {
    params: TasksGenerateRegistryParams;
    result: TasksGenerateRegistryResult;
  };
  'tasks:board': { params: TasksBoardParams; result: TasksBoardResult };
  'tasks:reindex': { params: TasksReindexParams; result: TasksReindexResult };
  'tasks:adopt': { params: TasksAdoptParams; result: TasksAdoptResult };
  'tasks:doctorPlan': {
    params: TasksDoctorPlanParams;
    result: TasksDoctorPlanResult;
  };
  'tasks:getViews': {
    params: TasksGetViewsParams;
    result: TasksGetViewsResult;
  };
  'tasks:saveViews': {
    params: TasksSaveViewsParams;
    result: TasksSaveViewsResult;
  };
  'outputStyle:list': {
    params: OutputStyleListParams;
    result: OutputStyleListResult;
  };
  'outputStyle:get': {
    params: OutputStyleGetParams;
    result: OutputStyleGetResult;
  };
  'outputStyle:activate': {
    params: OutputStyleActivateParams;
    result: OutputStyleActivateResult;
  };
  'outputStyle:save': {
    params: OutputStyleSaveParams;
    result: OutputStyleSaveResult;
  };
  'outputStyle:delete': {
    params: OutputStyleDeleteParams;
    result: OutputStyleDeleteResult;
  };
  'outputStyle:diagnose': {
    params: OutputStyleDiagnoseParams;
    result: OutputStyleDiagnoseResult;
  };
  'peerSession:list': {
    params: PeerSessionListParams;
    result: PeerSessionListResult;
  };
  'peerSession:send': {
    params: PeerSessionSendParams;
    result: PeerSessionSendResult;
  };
  // Host-owned surface state (TASK_2026_538): the webview's only channel.
  'surface:read': { params: SurfaceReadParams; result: SurfaceReadResult };
  'surface:change': {
    params: SurfaceChangeParams;
    result: SurfaceMutationResult;
  };
  'surface:select': {
    params: SurfaceSelectParams;
    result: SurfaceMutationResult;
  };
  'surface:action': {
    params: SurfaceActionParams;
    result: SurfaceActionResult;
  };
  'surface:operation': {
    params: SurfaceOperationParams;
    result: SurfaceOperationResult;
  };
}

export type SkillSynthesisSpecStatus =
  'active' | 'complete-unharvested' | 'harvested';
export interface SkillSynthesisSpecSummary {
  taskId: string;
  status: SkillSynthesisSpecStatus;
  batchCount: number;
  harvestedAt: number | null;
  ageDays: number | null;
}
export type SkillSynthesisListSpecsParams = Record<string, never>;
export interface SkillSynthesisListSpecsResult {
  specs: SkillSynthesisSpecSummary[];
}
export type SkillSynthesisHarvestSpecsParams = Record<string, never>;
export interface SkillSynthesisHarvestSpecsResult {
  scanned: number;
  harvested: number;
  reconciled: number;
}
export interface SkillSynthesisClearStaleSpecsParams {
  retentionDays?: number;
  mode?: 'archive' | 'delete';
}
export interface SkillSynthesisClearStaleSpecsResult {
  cleared: number;
  mode: 'archive' | 'delete';
  taskIds: string[];
}

export type SkillSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export type GatewayPlatformId = 'telegram' | 'discord' | 'slack';
export type GatewayApprovalStatus =
  'pending' | 'approved' | 'rejected' | 'revoked';
export type GatewayMessageDirection = 'inbound' | 'outbound';

export interface GatewayBindingDto {
  id: string;
  platform: GatewayPlatformId;
  externalChatId: string;
  /** Allow-list id (Telegram user / Discord guild / Slack team), or null for pre-0020 rows. */
  allowListId: string | null;
  displayName: string | null;
  approvalStatus: GatewayApprovalStatus;
  ptahSessionId: string | null;
  workspaceRoot: string | null;
  pairingCode: string | null;
  createdAt: number;
  approvedAt: number | null;
  lastActiveAt: number | null;
}

export interface GatewayMessageDto {
  id: string;
  bindingId: string;
  direction: GatewayMessageDirection;
  externalMsgId: string | null;
  ptahMessageId: string | null;
  body: string;
  voicePath: string | null;
  createdAt: number;
}

export type GatewayStatusParams = Record<string, never>;
export interface GatewayStatusResult {
  enabled: boolean;
  adapters: Array<{
    platform: GatewayPlatformId;
    running: boolean;
    lastError?: string;
  }>;
}

export interface GatewayStartParams {
  platform?: GatewayPlatformId;
}
export interface GatewayStartResult {
  ok: true;
}

export interface GatewayStopParams {
  platform?: GatewayPlatformId;
}
export interface GatewayStopResult {
  ok: true;
}

export interface GatewaySetTokenParams {
  platform: GatewayPlatformId;
  token: string;
  /** Slack only — required for Socket Mode (xapp-...). */
  slackAppToken?: string;
}
export interface GatewaySetTokenResult {
  ok: true;
}

export interface GatewayListBindingsParams {
  platform?: GatewayPlatformId;
  status?: GatewayApprovalStatus;
}
export interface GatewayListBindingsResult {
  bindings: GatewayBindingDto[];
}

export interface GatewayApproveBindingParams {
  bindingId: string;
  /**
   * The 6-digit pairing code the bot sent to the user. Compared against the
   * stored pairing code with a constant-time comparison. The backend NEVER
   * returns the stored code in `gateway:listBindings`, so the user must
   * type the code from the bot to approve.
   */
  code: string;
  ptahSessionId?: string;
  workspaceRoot?: string;
}
export type GatewayApproveBindingResult =
  | { ok: true; binding: GatewayBindingDto }
  | { ok: false; error: 'invalid-code' | 'binding-not-found' };

export interface GatewayBlockBindingParams {
  bindingId: string;
  /** Optional explicit terminal state — defaults to `'rejected'`. */
  status?: 'rejected' | 'revoked';
}
export interface GatewayBlockBindingResult {
  binding: GatewayBindingDto;
}

export interface GatewayListMessagesParams {
  bindingId: string;
  limit?: number;
  /** Cursor: only return messages with createdAt < before. */
  before?: number;
}
export interface GatewayListMessagesResult {
  messages: GatewayMessageDto[];
}

/**
 * `gateway:test` accepts a platform identifier — same set as
 * {@link GatewayPlatformId}. Kept as a separate alias so the frontend service
 * can reason about the test-call surface independently of the broader platform
 * type if it diverges in the future.
 */
export type GatewayTestPlatform = GatewayPlatformId;

export interface GatewayTestParams {
  platform: GatewayTestPlatform;
  /** Optional binding override — when omitted, the first approved binding is used. */
  bindingId?: string;
}

export type GatewayTestResult =
  | { ok: true; bindingId: string; externalMsgId: string | null }
  | { ok: false; error: string };

export interface GatewayGetAllowListParams {
  platform: GatewayPlatformId;
}
export interface GatewayGetAllowListResult {
  entries: string[];
}

export interface GatewaySetAllowListParams {
  platform: GatewayPlatformId;
  entries: string[];
}
export interface GatewaySetAllowListResult {
  ok: true;
}

export type GatewayGetDiscordAppIdParams = Record<string, never>;
export interface GatewayGetDiscordAppIdResult {
  applicationId: string | null;
}

export interface GatewaySetDiscordAppIdParams {
  applicationId: string;
}
export interface GatewaySetDiscordAppIdResult {
  ok: true;
}

export type GatewayRegisterDiscordCommandsParams = Record<string, never>;
export type GatewayRegisterDiscordCommandsResult =
  | {
      ok: true;
      registered: number;
      scope: 'guild' | 'global';
      /**
       * Guilds whose registration failed while others succeeded (429 after
       * retries, missing access, network). Empty/absent when all succeeded.
       * `ok` is still true — the caller must look here to see partial failure.
       */
      failed?: ReadonlyArray<{ guildId: string; error: string }>;
    }
  | { ok: false; error: string };

/**
 * `gateway:attachSession` — attach an existing Ptah SDK session to an approved
 * messaging binding so subsequent inbound platform messages resume that exact
 * conversation. Webview-initiated: the webview supplies the real SDK
 * `sessionUuid` AND the session's `workspaceRoot` (never inferred backend-side).
 */
export interface GatewayAttachSessionParams {
  bindingId: string;
  /** The canonical SDK session UUID to attach (from the webview). */
  sessionUuid: string;
  /** The session's workspace root — supplied by the webview, never inferred. */
  workspaceRoot: string;
  /** Optional external conversation id (Discord thread, etc.); defaults to 'default'. */
  externalConversationId?: string;
}
export type GatewayAttachSessionResult =
  | { ok: true; binding: GatewayBindingDto }
  | {
      ok: false;
      error:
        | 'binding-not-found'
        | 'binding-not-approved'
        /**
         * The binding's platform transport is stopped or disconnected. Attach
         * hands the tab over to that platform, so accepting it here would
         * produce a read-only tab nothing can ever drive (TASK_2026_272 #2).
         */
        | 'adapter-not-running'
        | 'session-not-resumable';
    };

/**
 * `gateway:detachSession` — clear the session link on a binding's
 * conversation(s) (sets `ptahSessionId` to NULL). No continuity flag.
 */
export interface GatewayDetachSessionParams {
  bindingId: string;
}
export type GatewayDetachSessionResult =
  | { ok: true; binding: GatewayBindingDto }
  | { ok: false; error: 'binding-not-found' };

export interface GatewayDiscordGuildDto {
  id: string;
  name: string;
}
export type GatewayListDiscordGuildsParams = Record<string, never>;
export interface GatewayListDiscordGuildsResult {
  guilds: GatewayDiscordGuildDto[];
}

export interface VoiceTranscribeParams {
  /** Base64-encoded audio recording from the renderer (MediaRecorder output). */
  audioBase64: string;
  /** MIME type of the recording, e.g. 'audio/webm' or 'audio/webm;codecs=opus'. */
  mimeType: string;
}

export type VoiceTranscribeResult =
  | { ok: true; transcript: string }
  | {
      ok: false;
      error: string;
      code?: string;
      remediation?: string;
      /** FR-7: cloud provider error category (auth/quota/network/provider-error). */
      category?: string;
      /** FR-7: id of the provider that failed (e.g. 'elevenlabs'). */
      providerId?: string;
    };

export interface VoiceConfigDto {
  whisperModel: string;
  /** Whether the selected Whisper model is already downloaded on disk. */
  downloaded: boolean;
}

export type VoiceGetConfigParams = Record<string, never>;

export type VoiceGetConfigResult =
  { ok: true; config: VoiceConfigDto } | { ok: false; error: string };

export interface VoiceSetConfigParams {
  whisperModel: string;
  /** FR-4: user-selected model source for the local Whisper model. */
  modelSource?: 'curated' | 'hf' | 'dir';
  /** FR-4: HF repo id or absolute local dir (used when modelSource is hf/dir). */
  customModel?: string;
}

export type VoiceSetConfigResult = { ok: true } | { ok: false; error: string };

export interface VoiceDownloadModelParams {
  /** Model to download; defaults to the currently configured Whisper model. */
  model?: string;
}

export type VoiceDownloadModelResult =
  | { ok: true; alreadyPresent: boolean }
  | { ok: false; error: string; code?: string; remediation?: string };

export interface TtsConfigDto {
  /** Selected Kokoro voice id, e.g. 'af_heart'. */
  voice: string;
  /** Whether the Kokoro TTS model is already downloaded on disk. */
  downloaded: boolean;
  /** FR-4.1: user-selected model source for the local Kokoro model. */
  modelSource: 'curated' | 'hf' | 'dir';
  /** FR-4.1: HF repo id or absolute local dir (set when modelSource is hf/dir). */
  customModel?: string;
}

export type VoiceGetTtsConfigParams = Record<string, never>;

export type VoiceGetTtsConfigResult =
  { ok: true; config: TtsConfigDto } | { ok: false; error: string };

export interface VoiceSetTtsConfigParams {
  voice: string;
  /** FR-4.1: user-selected model source for the local Kokoro model. */
  modelSource?: 'curated' | 'hf' | 'dir';
  /** FR-4.1: HF repo id or absolute local dir (used when modelSource is hf/dir). */
  customModel?: string;
}

export type VoiceSetTtsConfigResult =
  { ok: true } | { ok: false; error: string };

export type VoiceDownloadTtsModelParams = Record<string, never>;

export type VoiceDownloadTtsModelResult =
  | { ok: true; alreadyPresent: boolean }
  | { ok: false; error: string; code?: string; remediation?: string };

export interface VoiceSynthesizeParams {
  /** Text to speak. */
  text: string;
  /** Voice id override; defaults to the configured TTS voice. */
  voice?: string;
}

export type VoiceSynthesizeResult =
  | { ok: true; audioBase64: string; mimeType: string }
  | {
      ok: false;
      error: string;
      code?: string;
      remediation?: string;
      /** FR-7: cloud provider error category (auth/quota/network/provider-error). */
      category?: string;
      /** FR-7: id of the provider that failed (e.g. 'elevenlabs'). */
      providerId?: string;
    };

/**
 * Provider-agnostic voice surface DTOs (FR-8). Mirrors
 * `VoiceProviderCapability` / `VoiceInfo` in `voice-contracts` but stays a plain
 * wire shape (ids as `string`) so `libs/shared` keeps zero backend deps.
 */
export interface VoiceProviderCapabilityDto {
  id: string;
  label: string;
  kind: 'local' | 'cloud';
  requiresDownload: boolean;
  requiresApiKey: boolean;
  supports: { tts: boolean; stt: boolean };
  available: boolean;
  unavailableReason?: string;
}

export type VoiceListProvidersParams = Record<string, never>;

export type VoiceListProvidersResult =
  | {
      ok: true;
      providers: VoiceProviderCapabilityDto[];
      active: { tts: string; stt: string };
    }
  | { ok: false; error: string };

export interface VoiceInfoDto {
  id: string;
  label: string;
  category?: string;
}

export interface VoiceListVoicesParams {
  providerId: 'local' | 'elevenlabs';
}

export type VoiceListVoicesResult =
  | { ok: true; voices: VoiceInfoDto[] }
  | { ok: false; error: string; category?: string };

export interface VoiceProviderConfigLocalDto {
  whisperModel: string;
  modelSource: 'curated' | 'hf' | 'dir';
  customModel?: string;
  sttDownloaded: boolean;
  ttsDownloaded: boolean;
  ttsVoice: string;
}

export interface VoiceProviderConfigElevenLabsDto {
  /** Whether an API key is stored — NEVER the key or its ciphertext. */
  apiKeyConfigured: boolean;
  voiceId?: string;
  ttsModelId: string;
  outputFormat: string;
  sttModelId: string;
}

export interface VoiceProviderConfigDto {
  ttsProvider: string;
  sttProvider: string;
  local: VoiceProviderConfigLocalDto;
  elevenlabs: VoiceProviderConfigElevenLabsDto;
}

export type VoiceGetProviderConfigParams = Record<string, never>;

export type VoiceGetProviderConfigResult =
  { ok: true; config: VoiceProviderConfigDto } | { ok: false; error: string };

export interface VoiceSetProviderConfigParams {
  ttsProvider?: 'local' | 'elevenlabs';
  sttProvider?: 'local' | 'elevenlabs';
  elevenlabs?: {
    voiceId?: string;
    ttsModelId?: string;
    outputFormat?: string;
    sttModelId?: string;
  };
}

export type VoiceSetProviderConfigResult =
  { ok: true } | { ok: false; error: string };

export interface VoiceSetApiKeyParams {
  providerId: 'elevenlabs';
  /** Plaintext API key; an empty string clears the stored key. */
  apiKey: string;
}

export type VoiceSetApiKeyResult = { ok: true } | { ok: false; error: string };

export interface VoiceTestConnectionParams {
  providerId: 'elevenlabs';
  /** Optional unsaved key for a pre-save connectivity probe. */
  apiKey?: string;
}

export type VoiceTestConnectionResult =
  { ok: true } | { ok: false; error: string; category?: string };

export interface ScheduledJobDto {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  prompt: string;
  workspaceRoot: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

export interface JobRunDto {
  id: string;
  jobId: string;
  scheduledFor: number;
  startedAt: number | null;
  endedAt: number | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  resultSummary: string | null;
  errorMessage: string | null;
}

export interface CronListParams {
  enabledOnly?: boolean;
  /**
   * When provided, restrict results to jobs whose `workspaceRoot` matches this
   * absolute path after normalization (trailing-separator strip, drive-letter
   * case fold, separator canonicalization) — not a byte-exact match. Omit for a
   * cross-workspace (global) listing. Optional so existing callers (which pass
   * `{}`) are unaffected.
   */
  workspaceRoot?: string;
}
export interface CronListResult {
  jobs: ScheduledJobDto[];
}

export interface CronGetParams {
  id: string;
}
export interface CronGetResult {
  job: ScheduledJobDto | null;
}

export interface CronCreateParams {
  name: string;
  cronExpr: string;
  timezone?: string;
  prompt: string;
  workspaceRoot?: string | null;
  enabled?: boolean;
}
export interface CronCreateResult {
  job: ScheduledJobDto;
}

export interface CronUpdateParams {
  id: string;
  patch: {
    name?: string;
    cronExpr?: string;
    timezone?: string;
    prompt?: string;
    workspaceRoot?: string | null;
    enabled?: boolean;
  };
}
export interface CronUpdateResult {
  job: ScheduledJobDto;
}

export interface CronDeleteParams {
  id: string;
}
export interface CronDeleteResult {
  ok: boolean;
}

export interface CronToggleParams {
  id: string;
  enabled: boolean;
}
export interface CronToggleResult {
  job: ScheduledJobDto;
}

export interface CronRunNowParams {
  id: string;
}
export interface CronRunNowResult {
  run: JobRunDto | null;
}

export interface CronRunsParams {
  id: string;
  limit?: number;
  offset?: number;
}
export interface CronRunsResult {
  runs: JobRunDto[];
}

export interface CronNextFireParams {
  id: string;
}
export interface CronNextFireResult {
  nextRunAt: number | null;
}

// --- `go vet` consent (TASK_2026_559 Batch 37b1c, O2 §3) -------------------

/** Per-workspace `go vet` consent as the host judges it now. */
export type GoVetConsentStateDto = 'off' | 'on' | 'stale';

/**
 * Why a stored consent no longer holds (User Decision 25): the folder moved,
 * was replaced, or the Go binary changed. A `stale` consent never runs vet.
 */
export type GoVetConsentStaleReasonDto =
  'root-moved' | 'root-replaced' | 'go-changed';

/** Params for `diagnostics:go-vet-consent-get` — none. */
export type DiagnosticsGoVetConsentGetParams = Record<string, never>;

/** Response from `diagnostics:go-vet-consent-get`. */
export interface DiagnosticsGoVetConsentGetResult {
  /** `false` when the host has no per-workspace state storage. */
  supported: boolean;
  /** The active, host-registered workspace root, or `null`. */
  workspace: { root: string } | null;
  state: GoVetConsentStateDto;
  /** Set only when `state` is `stale`. */
  staleReason?: GoVetConsentStaleReasonDto;
  /** The binary the consent records (`on`) or a grant would record; display only. */
  goBinary?: string;
  /**
   * Opaque, host-issued identity of what this answer displays: the root's
   * real path and file identity, and the Go binary a grant would record.
   * Present whenever `workspace` is. A SET that enables must send it back
   * unchanged; the host refuses (`workspace-changed` / `go-changed`) when the
   * folder or the binary is no longer the one shown.
   */
  confirmToken?: string;
}

/** Params for `diagnostics:go-vet-consent-set`. */
export interface DiagnosticsGoVetConsentSetParams {
  enabled: boolean;
  /**
   * The root the caller last displayed (from GET). A comparison token only:
   * the host writes to its own active root, and refuses with
   * `workspace-changed` when the two differ.
   */
  workspaceRoot: string;
  /**
   * The `confirmToken` of the GET whose root and binary the user saw.
   * Required when `enabled` is `true` (else `invalid-params`); ignored on a
   * revoke, which is never refused for a changed target.
   */
  confirmToken?: string;
  source: 'settings-ui' | 'cli';
}

/** Fixed refusal codes of `diagnostics:go-vet-consent-set`. */
export type DiagnosticsGoVetConsentSetError =
  | 'invalid-params'
  | 'unsupported'
  | 'no-workspace'
  | 'workspace-changed'
  | 'go-changed'
  | 'no-go-binary'
  | 'persist-failed';

/** Response from `diagnostics:go-vet-consent-set`; success only after read-back. */
export type DiagnosticsGoVetConsentSetResult =
  | {
      success: true;
      state: 'on' | 'off';
      /** On a grant: the binary the committed record binds (display). */
      goBinary?: string;
    }
  | { success: false; error: DiagnosticsGoVetConsentSetError };

/**
 * Valid RPC method names (compile-time enforced)
 * Use this type to ensure only valid methods can be called
 */
export type RpcMethodName = keyof RpcMethodRegistry;

/**
 * Compile-enforced map from RPC method name → placeholder.
 *
 * Typed as Record<RpcMethodName, true>: the compiler requires every key of
 * RpcMethodRegistry to appear as a key here (excess-property check forbids
 * any extra keys). So adding a new entry to RpcMethodRegistry above WITHOUT
 * adding it here is a compile error — and the error points at the single
 * site that needs to change.
 *
 * Runtime-visible via Object.keys() → RPC_METHOD_NAMES. Insertion order
 * matches declaration order (ES2015+ object-key order for string keys), and
 * this object declares keys in the same order as the former hand-maintained
 * RPC_METHOD_NAMES array (which itself mirrored RpcMethodRegistry's section
 * layout). No consumer currently depends on iteration order —
 * verifyRpcRegistration uses set-membership checks only.
 */
const RPC_METHOD_ENTRIES: Record<RpcMethodName, true> = {
  'artifacts:list': true,
  'artifacts:openLink': true,
  'analytics:spendSummary': true,
  'attention:getSnapshot': true,
  'chat:start': true,
  'chat:continue': true,
  'chat:setStreamViewport': true,
  'chat:abort': true,
  'chat:pending-questions': true,
  'chat:running-agents': true,
  'chat:agent-sessions': true,
  'chat:resume': true,
  'chat:history-page': true,
  'session:list': true,
  'session:load': true,
  'session:delete': true,
  'session:rename': true,
  'session:validate': true,
  'session:cli-sessions': true,
  'session:cli-output-page': true,
  'session:stats-batch': true,
  'session:forkSession': true,
  'session:rewindFiles': true,
  'session:status': true,
  'session:setOrganization': true,
  'session:getOrganization': true,
  'session:linkTask': true,
  'session:unlinkTask': true,
  'session:addPrLink': true,
  'session:removePrLink': true,
  'session:listForTasks': true,
  'context:getAllFiles': true,
  'context:getFileSuggestions': true,
  'autocomplete:agents': true,
  'autocomplete:commands': true,
  'file:open': true,
  'file:viewContent': true,
  'file:saveContent': true,
  'editor:detectTargets': true,
  'editor:openFile': true,
  'editor:openWorkspace': true,
  'editor:openMerge': true,
  'file:pick': true,
  'file:pick-images': true,
  'config:model-switch': true,
  'config:model-get': true,
  'config:autopilot-toggle': true,
  'config:autopilot-get': true,
  'config:models-list': true,
  'config:effort-get': true,
  'config:effort-set': true,
  'config:pricing-get': true,
  'auth:getHealth': true,
  'auth:saveSettings': true,
  'auth:testConnection': true,
  'auth:getAuthStatus': true,
  'auth:copilotLogin': true,
  'auth:copilotLogout': true,
  'auth:copilotStatus': true,
  'auth:codexLogin': true,
  'auth:kimiCodeLogin': true,
  'auth:kimiCodeLoginCancel': true,
  'auth:getEffectiveRoute': true,
  'auth:checkConnection': true,
  'config:getScopes': true,
  'config:clearScopeOverride': true,
  'auth:getScope': true,
  'auth:clearWorkspaceOverride': true,
  'auth:verifyDraftConnection': true,
  'auth:cancelDraftVerification': true,
  'setup-status:get-status': true,
  'setup-wizard:launch': true,
  'wizard:deep-analyze': true,
  'wizard:get-resumable-run': true,
  'wizard:analysis-status': true,
  'wizard:recommend-agents': true,
  'wizard:cancel-analysis': true,
  'wizard:submit-selection': true,
  'wizard:cancel': true,
  'wizard:get-generation-run-state': true,
  'wizard:retry-item': true,
  'wizard:preview-generation': true,
  'wizard:list-analyses': true,
  'wizard:load-analysis': true,
  'wizard:list-agent-packs': true,
  'wizard:install-pack-agents': true,
  'license:getStatus': true,
  'license:setKey': true,
  'license:clearKey': true,
  'command:execute': true,
  'llm:getProviderStatus': true,
  'llm:setApiKey': true,
  'llm:removeApiKey': true,
  'llm:getDefaultProvider': true,
  'llm:setDefaultProvider': true,
  'llm:setDefaultModel': true,
  'llm:validateApiKeyFormat': true,
  'llm:listVsCodeModels': true,
  'llm:listProviderModels': true,
  'llm:setProviderBaseUrl': true,
  'llm:getProviderBaseUrl': true,
  'llm:clearProviderBaseUrl': true,
  'provider:listModels': true,
  'provider:setModelTier': true,
  'provider:getModelTiers': true,
  'provider:clearModelTier': true,
  'provider:listCustomEntries': true,
  'provider:addCustomEntry': true,
  'provider:updateCustomEntry': true,
  'provider:removeCustomEntry': true,
  'provider:testCustomEntry': true,
  'provider:getAccountUsage': true,
  'provider:getPlanLimits': true,
  // TASK_2026_712 provider accounts (registry merged via `extends`). `provider:`
  // is already in `ALLOWED_METHOD_PREFIXES`. Capability-gated to Electron in
  // RPC_HANDLER_MANIFEST (`providerAccounts`).
  'provider:listAccounts': true,
  'provider:addAccount': true,
  'provider:renameAccount': true,
  'provider:removeAccount': true,
  'provider:getAccountStatus': true,
  'provider:startAccountSignIn': true,
  'provider:cancelAccountSignIn': true,
  'provider:signOutAccount': true,
  'provider:setAccountSelection': true,
  'provider:setAccountDefault': true,
  'provider:getAmbientClaudeStatus': true,
  'chat:subagent-query': true,
  'subagent:send-message': true,
  'subagent:stop': true,
  'subagent:interrupt': true,
  'subagent:background': true,
  'subagent:history-page': true,
  'enhancedPrompts:getStatus': true,
  'enhancedPrompts:runWizard': true,
  'enhancedPrompts:setEnabled': true,
  'enhancedPrompts:regenerate': true,
  'enhancedPrompts:cancel': true,
  'enhancedPrompts:getRunState': true,
  'enhancedPrompts:getPromptContent': true,
  'enhancedPrompts:download': true,
  'quality:getAssessment': true,
  'quality:getHistory': true,
  'quality:export': true,
  'plugins:list-available': true,
  'plugins:get-config': true,
  'plugins:save-config': true,
  'plugins:list-skills': true,
  'plugins:list-marketplaces': true,
  'plugins:add-marketplace': true,
  'plugins:remove-marketplace': true,
  'plugins:browse-marketplace': true,
  'plugins:install-external': true,
  'plugins:uninstall-external': true,
  'agent:getConfig': true,
  'agent:setConfig': true,
  'agent:detectClis': true,
  'agent:listCliModels': true,
  'agent:permissionResponse': true, // Copilot SDK permission response
  'agent:e2eSeedPermission': true, // TEST-ONLY seam, PTAH_E2E-gated (TASK_2026_264)
  'agent:stop': true,
  'agent:continue': true,
  'agent:resumeCliSession': true, // CLI agent session resume
  'agent:backgroundList': true, // Background agent listing
  // TASK_2026_623 R10.1. `agent:` is ALREADY in `ALLOWED_METHOD_PREFIXES`, so
  // the registry entry plus this allow-map entry are the whole of
  // dual-registration. Capability-gated to Electron in RPC_HANDLER_MANIFEST.
  'agent:getLanePlanLimits': true,
  'agent:outcomeSignals': true,
  'agent:listDecisionModels': true,
  'ptahCli:list': true,
  'ptahCli:create': true,
  'ptahCli:update': true,
  'ptahCli:delete': true,
  'ptahCli:testConnection': true,
  'ptahCli:listModels': true,
  'skillsSh:search': true,
  'skillsSh:listInstalled': true,
  'skillsSh:install': true,
  'skillsSh:uninstall': true,
  'skillsSh:getPopular': true,
  'skillsSh:detectRecommended': true,
  'mcpDirectory:search': true,
  'mcpDirectory:getDetails': true,
  'mcpDirectory:install': true,
  'mcpDirectory:uninstall': true,
  'mcpDirectory:listInstalled': true,
  'mcpDirectory:getPopular': true,
  'mcpDirectory:setSmitheryApiKey': true,
  'mcpDirectory:getSmitheryKeyStatus': true,
  'mcpDirectory:resolveSmithery': true,
  'mcpDirectory:installSmithery': true,
  'mcpDirectory:uninstallSmithery': true,
  'mcpDirectory:listSmitheryInstalled': true,
  'mcpDirectory:smitheryAccount': true,
  'mcpDirectory:listSmitheryConnections': true,
  'mcpDirectory:smitheryConnectionStatus': true,
  'mcpDirectory:openSmitherySetup': true,
  'mcpDirectory:connectOAuth': true,
  'mcpDirectory:probeOAuthDiscovery': true,
  'mcpDirectory:oauthStatus': true,
  'mcpDirectory:disconnectOAuth': true,
  'mcpDirectory:listOAuthConnected': true,
  'mcpDirectory:getOAuthRedirectUri': true,
  'capabilities:getState': true,
  'capabilities:getEffective': true,
  'capabilities:setEnabled': true,
  'workspace:getInfo': true,
  'workspace:addFolder': true,
  'workspace:removeFolder': true,
  'workspace:switch': true,
  'workspace:registerFolder': true,
  'workspace:listRecent': true,
  'file:read': true,
  'file:exists': true,
  'file:save-dialog': true,
  'config:model-set': true,
  'auth:setApiKey': true,
  'auth:deleteStoredKey': true,
  'auth:getStatus': true,
  'auth:getApiKeyStatus': true,
  'settings:get': true,
  'settings:set': true,
  'settings:export': true,
  'settings:import': true,
  'webSearch:getApiKeyStatus': true,
  'webSearch:setApiKey': true,
  'webSearch:deleteApiKey': true,
  'webSearch:test': true,
  'webSearch:getConfig': true,
  'webSearch:setConfig': true,
  'git:info': true,
  'git:reviewChanges': true,
  'git:reviewFile': true,
  'git:worktrees': true,
  'git:addWorktree': true,
  'git:removeWorktree': true,
  'git:stage': true,
  'git:unstage': true,
  'git:discard': true,
  'git:commit': true,
  'git:cancelOperation': true,
  'git:generateCommitMessage': true,
  'git:prStatus': true,
  'git:operationAbort': true,
  'git:operationContinue': true,
  'git:log': true,
  'git:showFile': true,
  'git:diffFile': true,
  'git:applyHunks': true,
  'git:push': true,
  'git:pull': true,
  'git:fetch': true,
  'git:branches': true,
  'git:checkout': true,
  'git:stashList': true,
  'git:stashApply': true,
  'git:stashPop': true,
  'git:stashDrop': true,
  'git:stashShow': true,
  'git:tags': true,
  'git:remotes': true,
  'git:lastCommit': true,
  'git:turnChangeSets': true,
  'harness:initialize': true,
  'harness:suggest-config': true,
  'harness:search-skills': true,
  'harness:create-skill': true,
  'harness:discover-mcp': true,
  'harness:generate-prompt': true,
  'harness:generate-claude-md': true,
  'harness:apply': true,
  'harness:save-preset': true,
  'harness:load-presets': true,
  'harness:design-agents': true,
  'harness:generate-skills': true,
  'harness:generate-document': true,
  'harness:analyze-intent': true,
  'harness:start-new-project': true,
  'harness:get-proposal': true,
  'harness:workflow-prompt': true,
  'harness:health': true,
  'harness:reconcile': true,
  'harness:remove': true,
  'harness:repairBlocked': true,
  'harness:get-skill-selection': true,
  'harness:set-skill-selection': true,

  'memory:list': true,
  'memory:search': true,
  'memory:get': true,
  'memory:pin': true,
  'memory:unpin': true,
  'memory:forget': true,
  'memory:rebuildIndex': true,
  'memory:stats': true,
  'memory:searchSymbols': true,
  'memory:purgeBySubjectPattern': true,
  'memory:purgeJunk': true,
  'memory:diagnostics': true,
  'memory:runNow': true,
  'memory:setTriggers': true,
  'memory:getTriggers': true,
  'memory:listQuarantined': true,
  'memory:restoreQuarantined': true,

  'mem:searchIndex': true,
  'mem:timeline': true,
  'mem:getObservations': true,

  'corpus:list': true,
  'corpus:get': true,
  'corpus:build': true,
  'corpus:prime': true,
  'corpus:query': true,
  'corpus:reprime': true,
  'corpus:rebuild': true,
  'corpus:delete': true,
  'corpus:suggest': true,

  // The runtime guard accepts the skillSynthesis prefix; this map lists its
  // retained methods individually for the compile-time contract.
  'skillSynthesis:listClones': true,
  'skillSynthesis:getClone': true,
  'skillSynthesis:previewEnhancement': true,
  'skillSynthesis:applyProposal': true,
  'skillSynthesis:getHistoryBody': true,
  'skillSynthesis:revertEnhancement': true,
  'skillSynthesis:rebaseClone': true,
  'skillSynthesis:keepClone': true,
  'skillSynthesis:saveCloneBody': true,
  'skillSynthesis:listQuarantinedAgents': true,
  'skillSynthesis:restoreQuarantinedAgent': true,
  'skillSynthesis:getAgentModels': true,
  'skillSynthesis:setAgentModel': true,
  'skillSynthesis:invocationStats': true,
  'skillSynthesis:getScorecards': true,
  'skillSynthesis:getScorecardDetail': true,
  'skillSynthesis:listSpecs': true,
  'skillSynthesis:harvestSpecs': true,
  'skillSynthesis:clearStaleSpecs': true,
  'cron:list': true,
  'cron:get': true,
  'cron:create': true,
  'cron:update': true,
  'cron:delete': true,
  'cron:toggle': true,
  'cron:runNow': true,
  'cron:runs': true,
  'cron:nextFire': true,

  'gateway:status': true,
  'gateway:start': true,
  'gateway:stop': true,
  'gateway:setToken': true,
  'gateway:listBindings': true,
  'gateway:approveBinding': true,
  'gateway:blockBinding': true,
  'gateway:listMessages': true,
  'gateway:test': true,
  'gateway:getAllowList': true,
  'gateway:setAllowList': true,
  'gateway:getDiscordAppId': true,
  'gateway:setDiscordAppId': true,
  'gateway:registerDiscordCommands': true,
  'gateway:listDiscordGuilds': true,
  'gateway:attachSession': true,
  'gateway:detachSession': true,

  'voice:transcribe': true,
  'voice:getConfig': true,
  'voice:setConfig': true,
  'voice:downloadModel': true,
  'voice:getTtsConfig': true,
  'voice:setTtsConfig': true,
  'voice:downloadTtsModel': true,
  'voice:synthesize': true,
  'voice:listProviders': true,
  'voice:listVoices': true,
  'voice:getProviderConfig': true,
  'voice:setProviderConfig': true,
  'voice:setApiKey': true,
  'voice:testConnection': true,

  'boot:getReadiness': true,

  'db:health': true,
  'db:reset': true,
  'db:reloadVec': true,
  'db:openBindingFolder': true,

  'embedder:status': true,
  'embedder:retry': true,

  'indexing:getStatus': true,
  'indexing:start': true,
  'indexing:pause': true,
  'indexing:resume': true,
  'indexing:cancel': true,
  'indexing:setPipelineEnabled': true,
  'indexing:dismissStale': true,
  'indexing:acknowledgeDisclosure': true,

  'update:get-state': true,
  'update:check-now': true,
  'update:mark-downloaded': true,

  'diagnostics:go-vet-consent-get': true,
  'diagnostics:go-vet-consent-set': true,

  'tasks:list': true,
  'tasks:get': true,
  'tasks:getArtifact': true,
  'tasks:getRoundJudge': true,
  'tasks:create': true,
  'tasks:sweepFinished': true,
  'tasks:updateStatus': true,
  'tasks:updateMetadata': true,
  'tasks:bulkUpdateStatus': true,
  'tasks:bulkUpdateLabel': true,
  'tasks:generateRegistry': true,
  'tasks:board': true,
  'tasks:reindex': true,
  'tasks:adopt': true,
  'tasks:doctorPlan': true,
  'tasks:getViews': true,
  'tasks:saveViews': true,

  'outputStyle:list': true,
  'outputStyle:get': true,
  'outputStyle:activate': true,
  'outputStyle:save': true,
  'outputStyle:delete': true,
  'outputStyle:diagnose': true,

  'peerSession:list': true,
  'peerSession:send': true,

  'surface:read': true,
  'surface:change': true,
  'surface:select': true,
  'surface:action': true,
  'surface:operation': true,
};

/**
 * All RPC method names as a runtime array.
 *
 * Derived from RPC_METHOD_ENTRIES via Object.keys(). Key iteration order is
 * stable in ES2015+ for string keys (insertion order), so this array
 * reflects the declaration order of RPC_METHOD_ENTRIES above.
 *
 * The `as readonly RpcMethodName[]` cast is sound because the type of
 * RPC_METHOD_ENTRIES guarantees its keys ARE exactly RpcMethodName —
 * Object.keys widens to string[], the cast re-narrows.
 *
 * Used by the backend verification helper (verifyRpcRegistration) to ensure
 * all methods have handlers. Consumers of this export are unchanged by the
 * derivation swap.
 */
export const RPC_METHOD_NAMES = Object.keys(
  RPC_METHOD_ENTRIES,
) as readonly RpcMethodName[];

/**
 * Compile-time drift detection: fails to build if a key is added to
 * RpcMethodRegistry without being added to RPC_METHOD_NAMES.
 */
type _MissingRpcMethodNames = Exclude<
  RpcMethodName,
  (typeof RPC_METHOD_NAMES)[number]
>;
type _AssertAllRpcMethodsListed = [_MissingRpcMethodNames] extends [never]
  ? true
  : ['RPC_METHOD_NAMES missing entries for', _MissingRpcMethodNames];

/**
 * Extract params type for a given RPC method
 * @example RpcMethodParams<'chat:start'> => ChatStartParams
 */
export type RpcMethodParams<T extends RpcMethodName> =
  RpcMethodRegistry[T]['params'];

/**
 * Extract result type for a given RPC method
 * @example RpcMethodResult<'chat:start'> => ChatStartResult
 */
export type RpcMethodResult<T extends RpcMethodName> =
  RpcMethodRegistry[T]['result'];
