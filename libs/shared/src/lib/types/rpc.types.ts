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
export * from './rpc/rpc-session.types';
export * from './rpc/rpc-config.types';
export * from './rpc/rpc-auth.types';
export * from './rpc/rpc-providers.types';
export * from './rpc/rpc-setup.types';
export * from './rpc/rpc-agents.types';
export * from './rpc/rpc-misc.types';
export * from './rpc/rpc-git.types';
export * from './rpc/rpc-terminal.types';
export * from './rpc/rpc-editor.types';
export * from './rpc/rpc-memory.types';
export * from './rpc/rpc-mem.types';
export * from './rpc/rpc-corpus.types';

export * from './rpc/rpc-indexing.types';

export * from './rpc/rpc-update.types';

export * from './rpc/rpc-skill-clone.types';

export * from './rpc/rpc-tasks.types';

export * from './rpc/rpc-output-style.types';

export * from './rpc/rpc-plugin-marketplace.types';

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
  SubagentTranscriptParams,
  SubagentTranscriptResult,
} from './subagent-registry.types';
import type { SavedAnalysisMetadata } from './wizard';
import type { SkillDrainTier } from '../constants/skill-drain.constants';
import type {
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatResumeParams,
  ChatResumeResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatPendingQuestionsParams,
  ChatPendingQuestionsResult,
  ChatRunningAgentsParams,
  ChatRunningAgentsResult,
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
  SessionStatsBatchParams,
  SessionStatsBatchResult,
  SessionForkParams,
  SessionForkResult,
  SessionRewindParams,
  SessionRewindResult,
  SessionStatusParams,
  SessionStatusResponse,
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
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
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
  AuthGetScopeResult,
  AuthClearWorkspaceOverrideResult,
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
  WizardRecommendAgentsParams,
  WizardRecommendAgentsResponse,
  WizardCancelAnalysisParams,
  WizardCancelAnalysisResponse,
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
  WizardCancelParams,
  WizardCancelResponse,
  WizardRetryItemParams,
  WizardRetryItemResponse,
  MultiPhaseAnalysisResponse,
  EnhancedPromptsGetStatusParams,
  EnhancedPromptsGetStatusResponse,
  EnhancedPromptsRunWizardParams,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsSetEnabledParams,
  EnhancedPromptsSetEnabledResponse,
  EnhancedPromptsRegenerateParams,
  EnhancedPromptsRegenerateResponse,
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
  McpDirectoryConnectOAuthParams,
  McpDirectoryConnectOAuthResult,
  McpDirectoryOAuthStatusParams,
  McpDirectoryOAuthStatusResult,
  McpDirectoryDisconnectOAuthParams,
  McpDirectoryDisconnectOAuthResult,
  McpDirectoryListOAuthConnectedParams,
  McpDirectoryListOAuthConnectedResult,
} from './mcp-directory.types';

import type {
  GitInfoParams,
  GitInfoResult,
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
  GitShowFileParams,
  GitShowFileResult,
  GitDiffFileParams,
  GitDiffFileResult,
  GitApplyHunksParams,
  GitApplyHunksResult,
  GitPushParams,
  GitPushResult,
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
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalKillParams,
  TerminalKillResult,
} from './rpc/rpc-terminal.types';

import type {
  EditorRevertFilesParams,
  EditorRevertFilesResult,
} from './rpc/rpc-editor.types';

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
  SkillSynthesisInvocationStatsParams,
  SkillSynthesisInvocationStatsResult,
  SkillSynthesisGetScorecardsParams,
  SkillSynthesisGetScorecardsResult,
  SkillSynthesisGetScorecardDetailParams,
  SkillSynthesisGetScorecardDetailResult,
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
  DbHealthResult,
  DbResetResult,
  DbReloadVecResult,
  DbOpenBindingFolderResult,
  EmbedderStatusParams,
  EmbedderStatusResult,
  EmbedderRetryParams,
  EmbedderRetryResult,
} from './rpc/rpc-persistence.types';

import type {
  UpdateGetStateParams,
  UpdateGetStateResult,
  UpdateCheckNowParams,
  UpdateCheckNowResult,
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
  SkillDiagnosticsParams,
  SkillDiagnosticsResult,
  SkillAnalyzeNowParams,
  SkillAnalyzeNowResult,
  SkillSetTriggersParams,
  SkillSetTriggersResult,
  SkillGetTriggersParams,
  SkillGetTriggersResult,
  SkillSetLanesParams,
  SkillSetLanesResult,
  SkillGetLanesParams,
  SkillGetLanesResult,
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
 */
export interface RpcMethodRegistry {
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  'chat:resume': { params: ChatResumeParams; result: ChatResumeResult };
  'chat:abort': { params: ChatAbortParams; result: ChatAbortResult };
  'chat:pending-questions': {
    params: ChatPendingQuestionsParams;
    result: ChatPendingQuestionsResult;
  };
  'chat:running-agents': {
    params: ChatRunningAgentsParams;
    result: ChatRunningAgentsResult;
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
    params: Record<string, never>;
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
  'auth:getScope': {
    params: Record<string, never>;
    result: AuthGetScopeResult;
  };
  'auth:clearWorkspaceOverride': {
    params: Record<string, never>;
    result: AuthClearWorkspaceOverrideResult;
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
  'wizard:retry-item': {
    params: WizardRetryItemParams;
    result: WizardRetryItemResponse;
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
  'subagent:transcript': {
    params: SubagentTranscriptParams;
    result: SubagentTranscriptResult;
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
    result: { success: boolean; agentId?: string; error?: string };
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
  'mcpDirectory:connectOAuth': {
    params: McpDirectoryConnectOAuthParams;
    result: McpDirectoryConnectOAuthResult;
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
  'layout:persist': {
    params: Record<string, unknown>;
    result: { success: boolean };
  };
  'layout:restore': {
    params: Record<string, never>;
    result: { success: boolean };
  };
  'editor:revertFiles': {
    params: EditorRevertFilesParams;
    result: EditorRevertFilesResult;
  };
  'editor:openFile': {
    params: { filePath: string };
    result: {
      success: boolean;
      content?: string;
      filePath?: string;
      error?: string;
    };
  };
  'editor:saveFile': {
    params: { filePath: string; content: string };
    result: { success: boolean; error?: string };
  };
  'editor:getFileTree': {
    params: { rootPath?: string };
    result: {
      success: boolean;
      tree: Array<{
        name: string;
        path: string;
        type: 'file' | 'directory';
        children?: unknown[];
      }>;
      error?: string;
    };
  };

  'editor:getDirectoryChildren': {
    params: { dirPath: string };
    result: {
      success: boolean;
      children: Array<{
        name: string;
        path: string;
        type: 'file' | 'directory';
      }>;
      error?: string;
    };
  };
  'editor:createFile': {
    params: { filePath: string; content?: string };
    result: { success: boolean; error?: string };
  };
  'editor:createFolder': {
    params: { folderPath: string };
    result: { success: boolean; error?: string };
  };
  'editor:renameItem': {
    params: { oldPath: string; newPath: string };
    result: { success: boolean; error?: string };
  };
  'editor:deleteItem': {
    params: { itemPath: string; isDirectory: boolean };
    result: { success: boolean; error?: string };
  };
  'editor:getSetting': {
    params: { key: string };
    result: { success: boolean; value?: unknown; error?: string };
  };
  'editor:updateSetting': {
    params: { key: string; value: unknown };
    result: { success: boolean; error?: string };
  };
  'editor:searchInFiles': {
    params: {
      query: string;
      isRegex: boolean;
      caseSensitive: boolean;
      maxFileResults?: number;
      maxMatchesPerFile?: number;
    };
    result: {
      success: boolean;
      files: Array<{
        filePath: string;
        matches: Array<{ line: number; lineText: string; matchText: string }>;
      }>;
      truncated: boolean;
      totalMatches: number;
      error?: string;
    };
  };
  'editor:listAllFiles': {
    params: Record<string, never>;
    result: { success: boolean; files: string[]; error?: string };
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
  'auth:getStatus': {
    params: Record<string, never>;
    result: { isAuthenticated: boolean; provider: string; hasApiKey: boolean };
  };
  'auth:getApiKeyStatus': {
    params: Record<string, never>;
    result: {
      providers: Array<{
        provider: string;
        displayName: string;
        hasApiKey: boolean;
        isDefault: boolean;
      }>;
    };
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
    result: { success: boolean; provider: string; error?: string };
  };
  'webSearch:getConfig': {
    params: Record<string, never>;
    result: { provider: string; maxResults: number };
  };
  'webSearch:setConfig': {
    params: { provider?: string; maxResults?: number };
    result: { success: boolean };
  };
  'git:info': { params: GitInfoParams; result: GitInfoResult };
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
  'git:showFile': { params: GitShowFileParams; result: GitShowFileResult };
  'git:diffFile': { params: GitDiffFileParams; result: GitDiffFileResult };
  'git:applyHunks': {
    params: GitApplyHunksParams;
    result: GitApplyHunksResult;
  };
  'git:push': { params: GitPushParams; result: GitPushResult };
  'git:branches': { params: GitBranchesParams; result: GitBranchesResult };
  'git:checkout': { params: GitCheckoutParams; result: GitCheckoutResult };
  'git:stashList': { params: GitStashListParams; result: GitStashListResult };
  'git:tags': { params: GitTagsParams; result: GitTagsResult };
  'git:remotes': { params: GitRemotesParams; result: GitRemotesResult };
  'git:lastCommit': {
    params: GitLastCommitParams;
    result: GitLastCommitResult;
  };
  'terminal:create': {
    params: TerminalCreateParams;
    result: TerminalCreateResult;
  };
  'terminal:kill': { params: TerminalKillParams; result: TerminalKillResult };
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
  'skillSynthesis:listCandidates': {
    params: SkillSynthesisListCandidatesParams;
    result: SkillSynthesisListCandidatesResult;
  };
  'skillSynthesis:getCandidate': {
    params: SkillSynthesisGetCandidateParams;
    result: SkillSynthesisGetCandidateResult;
  };
  'skillSynthesis:promote': {
    params: SkillSynthesisPromoteParams;
    result: SkillSynthesisPromoteResult;
  };
  'skillSynthesis:reject': {
    params: SkillSynthesisRejectParams;
    result: SkillSynthesisRejectResult;
  };
  'skillSynthesis:invocations': {
    params: SkillSynthesisInvocationsParams;
    result: SkillSynthesisInvocationsResult;
  };
  'skillSynthesis:stats': {
    params: SkillSynthesisStatsParams;
    result: SkillSynthesisStatsResult;
  };
  'skillSynthesis:getSettings': {
    params: SkillSynthesisGetSettingsParams;
    result: SkillSynthesisGetSettingsResult;
  };
  'skillSynthesis:updateSettings': {
    params: SkillSynthesisUpdateSettingsParams;
    result: SkillSynthesisUpdateSettingsResult;
  };
  'skillSynthesis:pin': {
    params: SkillSynthesisPinParams;
    result: SkillSynthesisPinResult;
  };
  'skillSynthesis:unpin': {
    params: SkillSynthesisUnpinParams;
    result: SkillSynthesisUnpinResult;
  };
  'skillSynthesis:runCurator': {
    params: SkillSynthesisRunCuratorParams;
    result: SkillSynthesisRunCuratorResult;
  };
  'skillSynthesis:diagnostics': {
    params: SkillDiagnosticsParams;
    result: SkillDiagnosticsResult;
  };
  'skillSynthesis:analyzeNow': {
    params: SkillAnalyzeNowParams;
    result: SkillAnalyzeNowResult;
  };
  'skillSynthesis:setTriggers': {
    params: SkillSetTriggersParams;
    result: SkillSetTriggersResult;
  };
  'skillSynthesis:getTriggers': {
    params: SkillGetTriggersParams;
    result: SkillGetTriggersResult;
  };
  'skillSynthesis:setLanes': {
    params: SkillSetLanesParams;
    result: SkillSetLanesResult;
  };
  'skillSynthesis:getLanes': {
    params: SkillGetLanesParams;
    result: SkillGetLanesResult;
  };
  'skillSynthesis:listClones': {
    params: SkillSynthesisListClonesParams;
    result: SkillSynthesisListClonesResult;
  };
  'skillSynthesis:getClone': {
    params: SkillSynthesisGetCloneParams;
    result: SkillSynthesisGetCloneResult;
  };
  'skillSynthesis:enhanceNow': {
    params: SkillSynthesisEnhanceNowParams;
    result: SkillSynthesisEnhanceNowResult;
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
  'skillSynthesis:listSuggestions': {
    params: SkillSynthesisListSuggestionsParams;
    result: SkillSynthesisListSuggestionsResult;
  };
  'skillSynthesis:acceptSuggestion': {
    params: SkillSynthesisAcceptSuggestionParams;
    result: SkillSynthesisAcceptSuggestionResult;
  };
  'skillSynthesis:dismissSuggestion': {
    params: SkillSynthesisDismissSuggestionParams;
    result: SkillSynthesisDismissSuggestionResult;
  };
  'skillSynthesis:getSuggestion': {
    params: SkillSynthesisGetSuggestionParams;
    result: SkillSynthesisGetSuggestionResult;
  };
  'skillSynthesis:updateSuggestion': {
    params: SkillSynthesisUpdateSuggestionParams;
    result: SkillSynthesisUpdateSuggestionResult;
  };
  'skillSynthesis:rejectBulk': {
    params: SkillSynthesisRejectBulkParams;
    result: SkillSynthesisRejectBulkResult;
  };
  'skillSynthesis:promoteBulk': {
    params: SkillSynthesisPromoteBulkParams;
    result: SkillSynthesisPromoteBulkResult;
  };
  'skillSynthesis:rejectByPattern': {
    params: SkillSynthesisRejectByPatternParams;
    result: SkillSynthesisRejectByPatternResult;
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
  'skillSynthesis:queue': {
    params: SkillSynthesisQueueParams;
    result: SkillSynthesisQueueResult;
  };
  'skillSynthesis:digest': {
    params: SkillSynthesisDigestParams;
    result: SkillSynthesisDigestResult;
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
}

/**
 * The judge verdict vocabulary on the wire (TASK_2026_180, Phase 1).
 *
 * Structural mirror of `JudgeStatus` in
 * `skill-synthesis/src/lib/types.ts` — declared here rather than imported
 * because `libs/shared` is the foundation layer and may not import a backend
 * lib. `SkillCandidateStore` remains the enforcing gate on both edges; this
 * union is the wire restatement, not a second validation layer.
 */
export type SkillJudgeStatusDto = 'scored' | 'unscored' | 'disabled';

/**
 * The five criteria the judge scores. Carried individually rather than only as
 * an average so the UI can render a scorecard instead of one collapsed number.
 * `null` per criterion means "this criterion was not scored".
 */
export interface SkillJudgeCriteriaDto {
  novelty: number | null;
  actionability: number | null;
  scope: number | null;
  generalization: number | null;
  triggerClarity: number | null;
}

/**
 * Who produced one entry in a judge PANEL, on the wire (TASK_2026_180, Phase 3).
 *
 * Structural mirror of `JudgePanelRole` in `skill-synthesis/src/lib/types.ts`,
 * restated here for the same reason `SkillJudgeStatusDto` is: `libs/shared` is
 * the foundation layer and may not import a backend lib.
 *
 * Three roles, not two: the escalation is a THIRD opinion taken when the two
 * panellists disagreed, not an edit of either one's. Folding it into a
 * panellist role would erase the fact that a disagreement happened, which is
 * the only reason the third call was ever paid for.
 */
export type SkillJudgePanelRoleDto =
  | 'panellist-a'
  | 'panellist-b'
  | 'escalation';

/**
 * One panellist's answer, as the wire carries it.
 *
 * A panel entry is a VERDICT, and it carries the same `status`/`score`
 * contract `SkillSynthesisCandidateSummary.judgeScore` does: only `'scored'`
 * may carry a number, and every other status carries `score: null`. Letting
 * `{ status: 'unscored', score: 10 }` reach a renderer would be the fabricated
 * verdict Phase 1 removed, one field to the left.
 */
export interface SkillJudgePanelRationaleDto {
  role: SkillJudgePanelRoleDto;
  status: SkillJudgeStatusDto;
  /** Populated ONLY on `status: 'scored'`. Never `0` as a stand-in for absent. */
  score: number | null;
  /** `null` = this panellist produced no per-criterion breakdown. */
  criteria: SkillJudgeCriteriaDto | null;
  /** A judge reason, or a lane failure's own user-facing reason. */
  reason: string;
  /** The rendering the escalation prompt actually read, as stored. */
  summary: string;
}

export interface SkillSynthesisCandidateSummary {
  id: string;
  /**
   * The SLUG. An internal id and the `SKILL.md` folder name — never a title.
   * Render `displayName` and fall back to this.
   */
  name: string;
  description: string;
  status: 'candidate' | 'promoted' | 'rejected';
  successCount: number;
  failureCount: number;
  createdAt: number;
  promotedAt: number | null;
  rejectedAt: number | null;
  rejectedReason: string | null;
  pinned: boolean;
  // ── Judge verdict (TASK_2026_180, Phase 1) ────────────────────────────────
  /** Human-readable title. `null` = none yet; the UI falls back to `name`. */
  displayName: string | null;
  /**
   * `null` = the candidate was NOT scored — never judged, judged while the
   * gate was off, or a judge call that failed. It is NOT a low score and it is
   * NEVER `0`. Coalescing this to zero re-introduces exactly the defect this
   * field exists to remove: before it, a failed judge call fabricated a verdict
   * the UI then rendered as genuine. Read `judgeStatus` to tell the cases
   * apart.
   */
  judgeScore: number | null;
  /** `null` = no verdict has ever been recorded for this candidate. */
  judgeStatus: SkillJudgeStatusDto | null;
  /**
   * Why. For `'unscored'` this is the FAILURE ("rate limited"), not a critique.
   */
  judgeReason: string | null;
  /** `null` = the judge produced no per-criterion breakdown. */
  judgeCriteria: SkillJudgeCriteriaDto | null;
  // ── Empirical gates (TASK_2026_180, Phase 3) ──────────────────────────────
  // Every number below repeats the `judgeScore` rule, for the same reason and
  // with the same consequence for getting it wrong: `null` is NOT zero.
  /**
   * Plan-vs-actual replay alignment, 0–1.
   *
   * `null` = the replay NEVER RAN — no hold-out session existed, the gate was
   * off, or the replay produced no trustworthy number. A genuine `0` means the
   * replay ran and the skill aligned with nothing, which is real evidence
   * AGAINST promotion. A reader that coalesces `null` to `0` turns "we never
   * measured this" into "we measured it and it failed" — exactly the
   * fabricated verdict Phase 1 removed, and it also makes an unmeasured
   * candidate look ineligible for the retry it is still owed.
   */
  replayConfidence: number | null;
  /**
   * Description-only trigger-retrieval score, derived from precision + recall.
   *
   * `null` = the trigger eval never ran. A genuine `0` means the description
   * retrieved nothing. Same rule as {@link replayConfidence}: never coalesce.
   */
  triggerScore: number | null;
  /**
   * The panel's per-role rationales, parsed off the stored JSON.
   *
   * `null` = no readable panel — either none was ever convened, or the stored
   * record failed to parse or to satisfy the `status`/`score` contract. Never
   * `[]`: the store refuses to write a panel with no members, so an empty list
   * would describe a deliberation nobody held.
   */
  judgePanelRationales: SkillJudgePanelRationaleDto[] | null;
}

export interface SkillSynthesisCandidateDetail extends SkillSynthesisCandidateSummary {
  bodyPath: string;
  body: string | null;
  trajectoryHash: string;
  sourceSessionIds: string[];
}

export interface SkillSynthesisInvocationEntry {
  id: string;
  skillId: string;
  sessionId: string;
  succeeded: boolean;
  invokedAt: number;
  notes: string | null;
}

export interface SkillSynthesisListCandidatesParams {
  status?: 'candidate' | 'promoted' | 'rejected' | 'all';
  limit?: number;
}
export interface SkillSynthesisListCandidatesResult {
  candidates: SkillSynthesisCandidateSummary[];
}

export interface SkillSynthesisGetCandidateParams {
  id: string;
}
export interface SkillSynthesisGetCandidateResult {
  candidate: SkillSynthesisCandidateDetail | null;
}

export interface SkillSynthesisPromoteParams {
  id: string;
}
export interface SkillSynthesisPromoteResult {
  promoted: boolean;
  reason: string | null;
  filePath: string | null;
}

export interface SkillSynthesisRejectParams {
  id: string;
  reason?: string;
}
export interface SkillSynthesisRejectResult {
  rejected: boolean;
}

export interface SkillSynthesisRejectBulkParams {
  ids: string[];
  reason?: string;
}
export interface SkillSynthesisRejectBulkResult {
  rejected: number;
}
export interface SkillSynthesisPromoteBulkParams {
  ids: string[];
}
export interface SkillSynthesisPromoteBulkDecision {
  id: string;
  promoted: boolean;
  reason: string | null;
  filePath: string | null;
}
export interface SkillSynthesisPromoteBulkResult {
  decisions: SkillSynthesisPromoteBulkDecision[];
  promoted: number;
}
export interface SkillSynthesisRejectByPatternParams {
  pattern: string;
  reason?: string;
}
export interface SkillSynthesisRejectByPatternResult {
  rejected: number;
  matched: number;
}

export type SkillSynthesisSpecStatus =
  | 'active'
  | 'complete-unharvested'
  | 'harvested';
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

/**
 * Every `skill_synthesis_queue.stage` member (migration `0032`).
 *
 * This union is the wire-side restatement of `SkillQueueStage` in
 * `@ptah-extension/skill-synthesis`, which `libs/shared` may not import (it is
 * the foundation layer). Drift is caught at COMPILE TIME in the direction that
 * matters: the handler maps a backend row into this type, so a stage added to
 * `0032` and to the backend union but not here fails `nx typecheck rpc-handlers`.
 */
export type SkillSynthesisQueueStage =
  | 'prefilter'
  | 'archaeology'
  | 'synthesis'
  | 'embedding'
  | 'clustering'
  | 'cluster-synthesis'
  | 'judge'
  | 'judge-panel'
  | 'replay'
  | 'trigger-eval'
  | 'digest';

/** Every `skill_synthesis_queue.status` member (migration `0032`). */
export type SkillSynthesisQueueStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'done'
  | 'failed'
  | 'unscored'
  | 'skipped';

/**
 * One queue row as the Activity surface sees it.
 *
 * `last_error` is deliberately ABSENT. It holds whatever a stage threw —
 * an SDK message, a provider payload, a SQLite driver string — and forwarding
 * that verbatim to a renderer is the "never expose a raw error message across
 * the boundary" rule. `reason` is the short, deliberately-authored sentence the
 * drain writes for exactly this purpose; the full error stays in the log.
 */
export interface SkillSynthesisQueueItem {
  id: string;
  sessionId: string;
  /** Round-robin fairness key. `''` for cross-project stages. */
  workspaceRoot: string;
  stage: SkillSynthesisQueueStage;
  status: SkillSynthesisQueueStatus;
  attemptCount: number;
  enqueuedAt: number;
  /** Epoch ms before which the row is not eligible. `0` = eligible now. */
  notBefore: number;
  finishedAt: number | null;
  /** Which provider lane ran (or will run) the row. `null` before Phase 1. */
  lane: string | null;
  /** Short and user-facing — a stall reason, a skip reason, a backoff note. */
  reason: string | null;
  candidateId: string | null;
}

/**
 * One drain `job_runs` row, resolved to its tier.
 *
 * `durationMs` is precomputed rather than left to the renderer: a run that is
 * still in flight has no end, and `null` says that unambiguously where
 * `endedAt - startedAt` would silently produce `NaN`.
 */
export interface SkillSynthesisDrainRun {
  id: string;
  jobId: string;
  tier: SkillDrainTier;
  scheduledFor: number;
  startedAt: number | null;
  endedAt: number | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  /** `null` while the run has not finished. */
  durationMs: number | null;
  /** The drain's own summary line. Never a raw error message. */
  summary: string | null;
}

/**
 * What one stage has actually SPENT today, from `skill_synthesis_budget`
 * (migration `0035`, keyed `(day_key, stage)` in UTC).
 *
 * This is the real token counter, not a proxy. Queue rows carry dispatches;
 * only the ledger carries tokens, and the ledger is day-and-stage-keyed rather
 * than row-keyed — so the cost figure rides the RESPONSE, not
 * {@link SkillSynthesisQueueItem}. A stage can appear here with no queue rows
 * left (it spent, then finished), and rows can exist for a stage that has spent
 * nothing; both are true statements and neither is derivable from the other.
 *
 * `stage: ''` is the unattributed bucket — spend no queue stage owned, such as
 * the foreground promotion gate's judge call. It is reported rather than
 * dropped because the entries must sum to the day total the daily cap
 * (`skillSynthesis.budget.maxTokensPerDay`) is compared against; an entry list
 * that summed to less would read as headroom the user does not have.
 */
export interface SkillSynthesisStageSpend {
  /** A queue stage, or `''` for spend no queue stage owned. */
  stage: SkillSynthesisQueueStage | '';
  inputTokens: number;
  outputTokens: number;
  /** `inputTokens + outputTokens` — the figure the daily cap gates on. */
  totalTokens: number;
  costUsd: number;
}

export interface SkillSynthesisQueueParams {
  /** Queue rows to return, newest-enqueued first. */
  limit?: number;
  /** Drain runs to return, most-recently-scheduled first. */
  runLimit?: number;
}

export interface SkillSynthesisQueueResult {
  items: SkillSynthesisQueueItem[];
  recentRuns: SkillSynthesisDrainRun[];
  /** Today's UTC token ledger, one entry per stage, heaviest first. */
  stageSpend: SkillSynthesisStageSpend[];
}

/**
 * Which sweep produced a digest item (TASK_2026_180 Phase 4).
 *
 * The wire restatement of `DigestItemKind` in `@ptah-extension/skill-synthesis`,
 * which `libs/shared` may not import. The names carry the `SkillDigest` prefix
 * rather than the backend's bare `DigestItem` because the RPC handler imports
 * BOTH sides into one file to map between them, and two `DigestItem`s in one
 * import list is a rename waiting to be got wrong.
 */
export type SkillDigestItemKind =
  | 'missed-trigger'
  | 'friction-opportunity'
  | 'win-rate'
  | 'memory-signal';

/**
 * The receipts behind one digest item.
 *
 * `winRate` IS `number | null` AND `null` IS NEVER `0`. `null` means nobody has
 * measured this skill; `0` means it was measured and lost every measured
 * session. `0` is falsy, so `winRate || x` anywhere on this path silently
 * retitles a measured failure as an absent measurement — use `??` or an
 * explicit `=== null`. The backend half of this rule lives on
 * `SkillCandidateStore.getWinRates()` and `scoreForWinRate`; this is the same
 * rule at the wire.
 */
export interface SkillDigestEvidence {
  /** Sessions that justify the item. NEVER empty — an item with no receipts is not filed. */
  sessionIds: string[];
  /** Per-kind tallies (`missedSessions`, `retry`, `invocations`, `memoryHits`, …). */
  counts: Record<string, number>;
  /** `wins / measured` for the skill involved; `null` = unmeasured, NEVER `0`. */
  winRate: number | null;
}

/**
 * One ranked nudge. `score` is a 0–1 attention weight and the digest arrives
 * sorted by it DESCENDING; it is not a quality score and carries no unit beyond
 * "look at this one first". A digest item is never an action — the user still
 * accepts or dismisses.
 */
export interface SkillDigestItem {
  kind: SkillDigestItemKind;
  /** One short human-facing line. Safe to render as a heading. */
  title: string;
  /** Why this was surfaced, stated as measured facts rather than advice. */
  rationale: string;
  /** Attention weight, 0–1. Higher first. */
  score: number;
  evidence: SkillDigestEvidence;
}

export interface SkillSynthesisDigestParams {
  /**
   * The workspace whose sessions are swept. Omitted = the host's current
   * workspace; `''` is the explicit cross-project feed and is NOT the same
   * request as omitting the field.
   */
  workspaceRoot?: string;
  /** Items returned after ranking. Defaults to the curator's own limit. */
  limit?: number;
  /**
   * Whether this sweep may SPEND on the authoring lane.
   *
   * **Omitted means `false`, and that asymmetry is the whole point of the
   * field.** The digest's one write — sweep (a)'s description rewrite — is
   * authored by an LLM on the `synthesis` lane, and that lane is NOT covered by
   * the drain's per-item token budget: no handler is registered for the
   * `digest` queue stage and nothing enqueues a `digest` row, so
   * `SkillGapCuratorService.runDigest` only ever runs in the foreground from
   * this RPC. There is no budget gate underneath it.
   *
   * The digest is also refreshed AUTOMATICALLY — on tab init and, debounced, on
   * four background event kinds — so a default of `true` would mean background
   * activity buying unbudgeted LLM calls. The failure mode of getting this
   * wrong is spending the user's money, so the safe value is the one a caller
   * gets by saying nothing: every automatic path omits it or sends `false`, and
   * only an explicit user-initiated refresh may send `true`.
   *
   * `false` does not degrade the digest. The sweep falls back to appending the
   * archaeologist's VERBATIM session intents — exactly what shipped before the
   * lane existed — so the ranking, the evidence and the write are all unchanged;
   * only the wording of the appended clause is cheaper.
   */
  allowRewrite?: boolean;
}

export interface SkillSynthesisDigestResult {
  /** Ranked by `score` DESCENDING. The order is part of the contract. */
  items: SkillDigestItem[];
}

export interface SkillSynthesisInvocationsParams {
  skillId: string;
  limit?: number;
}
export interface SkillSynthesisInvocationsResult {
  invocations: SkillSynthesisInvocationEntry[];
}

export type SkillSynthesisStatsParams = Record<string, never>;
export interface SkillSynthesisStatsResult {
  totalCandidates: number;
  totalPromoted: number;
  totalRejected: number;
  totalInvocations: number;
  activeSkills: number;
}

/**
 * DTO mirroring all SkillSynthesisSettings fields.
 * Shared between frontend and backend — no branded types.
 */
export interface SkillSynthesisSettingsDto {
  enabled: boolean;
  successesToPromote: number;
  dedupCosineThreshold: number;
  maxActiveSkills: number;
  candidatesDir: string;
  eligibilityMinTurns: number;
  evictionDecayRate: number;
  generalizationContextThreshold: number;
  dedupClusterThreshold: number;
  prefilterMinEdits: number;
  prefilterMinChars: number;
  prefilterMinToolUses: number;
  judgeEnabled: boolean;
  minJudgeScore: number;
  judgeModel: string;
  maxPinnedSkills: number;
  curatorEnabled: boolean;
  curatorIntervalHours: number;
  suggestionMinClusterSize: number;
  suggestionMaxCandidates: number;
  // TASK_2026_180 Phase 0 — the drain knobs.
  //
  // The keys are DOTTED because `skillSynthesis:getSettings` builds its config
  // key as `skillSynthesis.${schemaKey}` and `updateSettings` writes back the
  // same way. A key of `'drain.cronExpr'` is therefore literally the settings
  // path `skillSynthesis.drain.cronExpr`; renaming it to `drainCronExpr` would
  // silently read and write a key that no host stores.
  'drain.cronExpr': string;
  'drain.nightlyCronExpr': string;
  'drain.weeklyCronExpr': string;
  'drain.maxItemsPerRun': number;
  'drain.nightlyMaxItemsPerRun': number;
  'drain.weeklyMaxItemsPerRun': number;
  'drain.perWorkspaceBatch': number;
  'drain.foregroundBackoffMs': number;
  'drain.pauseOnBattery': boolean;
  'drain.maxAttempts': number;
  'drain.staleClaimTtlMs': number;
  'budget.maxTokensPerDay': number;
  trayKeepalive: boolean;
}

export type SkillSynthesisGetSettingsParams = Record<string, never>;
export interface SkillSynthesisGetSettingsResult {
  settings: SkillSynthesisSettingsDto;
}

export interface SkillSynthesisUpdateSettingsParams {
  settings: Partial<SkillSynthesisSettingsDto>;
}
export interface SkillSynthesisUpdateSettingsResult {
  updated: boolean;
}

export interface SkillSynthesisPinParams {
  id: string;
}
export interface SkillSynthesisPinResult {
  pinned: boolean;
}

export interface SkillSynthesisUnpinParams {
  id: string;
}
export interface SkillSynthesisUnpinResult {
  pinned: boolean;
}

export type SkillSynthesisRunCuratorParams = Record<string, never>;

export interface SkillSynthesisCuratorOverlap {
  skillIdA: string;
  skillIdB: string;
  reason: string;
}

export interface SkillSynthesisRunCuratorResult {
  reportPath: string;
  changesQueued: number;
  skippedPinned: number;
  overlaps?: SkillSynthesisCuratorOverlap[];
  suggestionsCreated: number;
}

export type SkillSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface SkillSuggestionSummary {
  id: string;
  name: string;
  description: string;
  clusterSize: number;
  technologyFingerprint: string;
  judgeScore: number;
  memberSessionIds: string[];
  status: SkillSuggestionStatus;
  createdAt: number;
}

export interface SkillSuggestionDetail extends SkillSuggestionSummary {
  body: string;
}

export interface SkillSynthesisListSuggestionsParams {
  status?: SkillSuggestionStatus;
}
export interface SkillSynthesisListSuggestionsResult {
  suggestions: SkillSuggestionSummary[];
}

export interface SkillSynthesisAcceptSuggestionParams {
  id: string;
}
export interface SkillSynthesisAcceptSuggestionResult {
  accepted: boolean;
  filePath: string;
}

export interface SkillSynthesisDismissSuggestionParams {
  id: string;
  reason?: string;
}
export interface SkillSynthesisDismissSuggestionResult {
  dismissed: boolean;
}

export interface SkillSynthesisGetSuggestionParams {
  id: string;
}
export interface SkillSynthesisGetSuggestionResult {
  suggestion: SkillSuggestionDetail | null;
}

export interface SkillSynthesisUpdateSuggestionParams {
  id: string;
  name?: string;
  description?: string;
  body?: string;
}
export interface SkillSynthesisUpdateSuggestionResult {
  updated: boolean;
  suggestion: SkillSuggestionDetail | null;
}

export type GatewayPlatformId = 'telegram' | 'discord' | 'slack';
export type GatewayApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked';
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
  | { ok: true; config: VoiceConfigDto }
  | { ok: false; error: string };

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
  | { ok: true; config: TtsConfigDto }
  | { ok: false; error: string };

export interface VoiceSetTtsConfigParams {
  voice: string;
  /** FR-4.1: user-selected model source for the local Kokoro model. */
  modelSource?: 'curated' | 'hf' | 'dir';
  /** FR-4.1: HF repo id or absolute local dir (used when modelSource is hf/dir). */
  customModel?: string;
}

export type VoiceSetTtsConfigResult =
  | { ok: true }
  | { ok: false; error: string };

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
  | { ok: true; config: VoiceProviderConfigDto }
  | { ok: false; error: string };

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
  | { ok: true }
  | { ok: false; error: string };

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
  | { ok: true }
  | { ok: false; error: string; category?: string };

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
  'chat:start': true,
  'chat:continue': true,
  'chat:abort': true,
  'chat:pending-questions': true,
  'chat:running-agents': true,
  'chat:resume': true,
  'session:list': true,
  'session:load': true,
  'session:delete': true,
  'session:rename': true,
  'session:validate': true,
  'session:cli-sessions': true,
  'session:stats-batch': true,
  'session:forkSession': true,
  'session:rewindFiles': true,
  'session:status': true,
  'context:getAllFiles': true,
  'context:getFileSuggestions': true,
  'autocomplete:agents': true,
  'autocomplete:commands': true,
  'file:open': true,
  'file:pick': true,
  'file:pick-images': true,
  'config:model-switch': true,
  'config:model-get': true,
  'config:autopilot-toggle': true,
  'config:autopilot-get': true,
  'config:models-list': true,
  'config:effort-get': true,
  'config:effort-set': true,
  'auth:getHealth': true,
  'auth:saveSettings': true,
  'auth:testConnection': true,
  'auth:getAuthStatus': true,
  'auth:copilotLogin': true,
  'auth:copilotLogout': true,
  'auth:copilotStatus': true,
  'auth:codexLogin': true,
  'auth:getScope': true,
  'auth:clearWorkspaceOverride': true,
  'setup-status:get-status': true,
  'setup-wizard:launch': true,
  'wizard:deep-analyze': true,
  'wizard:recommend-agents': true,
  'wizard:cancel-analysis': true,
  'wizard:submit-selection': true,
  'wizard:cancel': true,
  'wizard:retry-item': true,
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
  'chat:subagent-query': true,
  'subagent:send-message': true,
  'subagent:stop': true,
  'subagent:interrupt': true,
  'subagent:background': true,
  'subagent:transcript': true,
  'enhancedPrompts:getStatus': true,
  'enhancedPrompts:runWizard': true,
  'enhancedPrompts:setEnabled': true,
  'enhancedPrompts:regenerate': true,
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
  'mcpDirectory:connectOAuth': true,
  'mcpDirectory:oauthStatus': true,
  'mcpDirectory:disconnectOAuth': true,
  'mcpDirectory:listOAuthConnected': true,
  'workspace:getInfo': true,
  'workspace:addFolder': true,
  'workspace:removeFolder': true,
  'workspace:switch': true,
  'workspace:registerFolder': true,
  'layout:persist': true,
  'layout:restore': true,
  'editor:revertFiles': true,
  'editor:openFile': true,
  'editor:saveFile': true,
  'editor:getFileTree': true,
  'editor:getDirectoryChildren': true,
  'editor:createFile': true,
  'editor:createFolder': true,
  'editor:renameItem': true,
  'editor:deleteItem': true,
  'editor:getSetting': true,
  'editor:updateSetting': true,
  'editor:searchInFiles': true,
  'editor:listAllFiles': true,
  'file:read': true,
  'file:exists': true,
  'file:save-dialog': true,
  'config:model-set': true,
  'auth:setApiKey': true,
  'auth:getStatus': true,
  'auth:getApiKeyStatus': true,
  'settings:export': true,
  'settings:import': true,
  'webSearch:getApiKeyStatus': true,
  'webSearch:setApiKey': true,
  'webSearch:deleteApiKey': true,
  'webSearch:test': true,
  'webSearch:getConfig': true,
  'webSearch:setConfig': true,
  'git:info': true,
  'git:worktrees': true,
  'git:addWorktree': true,
  'git:removeWorktree': true,
  'git:stage': true,
  'git:unstage': true,
  'git:discard': true,
  'git:commit': true,
  'git:showFile': true,
  'git:diffFile': true,
  'git:applyHunks': true,
  'git:push': true,
  'git:branches': true,
  'git:checkout': true,
  'git:stashList': true,
  'git:tags': true,
  'git:remotes': true,
  'git:lastCommit': true,
  'terminal:create': true,
  'terminal:kill': true,
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

  'skillSynthesis:listCandidates': true,
  'skillSynthesis:getCandidate': true,
  'skillSynthesis:promote': true,
  'skillSynthesis:reject': true,
  'skillSynthesis:invocations': true,
  'skillSynthesis:stats': true,
  'skillSynthesis:getSettings': true,
  'skillSynthesis:updateSettings': true,
  'skillSynthesis:pin': true,
  'skillSynthesis:unpin': true,
  'skillSynthesis:runCurator': true,
  'skillSynthesis:diagnostics': true,
  'skillSynthesis:analyzeNow': true,
  'skillSynthesis:setTriggers': true,
  'skillSynthesis:getTriggers': true,
  // TASK_2026_180 Phase 1. `skillSynthesis:` is ALREADY in
  // `ALLOWED_METHOD_PREFIXES`, so only the compile-time half of
  // dual-registration applies to these two: the registry entry above and this
  // allow-map entry. Adding a runtime-guard entry per METHOD would be wrong —
  // the guard is per PREFIX.
  'skillSynthesis:setLanes': true,
  'skillSynthesis:getLanes': true,
  'skillSynthesis:listClones': true,
  'skillSynthesis:getClone': true,
  'skillSynthesis:enhanceNow': true,
  'skillSynthesis:previewEnhancement': true,
  'skillSynthesis:applyProposal': true,
  'skillSynthesis:getHistoryBody': true,
  'skillSynthesis:revertEnhancement': true,
  'skillSynthesis:rebaseClone': true,
  'skillSynthesis:keepClone': true,
  'skillSynthesis:invocationStats': true,
  'skillSynthesis:getScorecards': true,
  'skillSynthesis:getScorecardDetail': true,
  'skillSynthesis:listSuggestions': true,
  'skillSynthesis:acceptSuggestion': true,
  'skillSynthesis:dismissSuggestion': true,
  'skillSynthesis:getSuggestion': true,
  'skillSynthesis:updateSuggestion': true,
  'skillSynthesis:rejectBulk': true,
  'skillSynthesis:promoteBulk': true,
  'skillSynthesis:rejectByPattern': true,
  'skillSynthesis:listSpecs': true,
  'skillSynthesis:harvestSpecs': true,
  'skillSynthesis:clearStaleSpecs': true,
  'skillSynthesis:queue': true,
  // TASK_2026_180 Phase 4 (correction C11). `skillSynthesis:` is ALREADY in
  // `ALLOWED_METHOD_PREFIXES`, and that guard is per PREFIX — so the registry
  // entry above plus this allow-map entry are the WHOLE of dual-registration
  // for a new method in an existing namespace.
  'skillSynthesis:digest': true,

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
