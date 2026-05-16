/**
 * RPC Type Definitions
 *
 * Type-safe parameter and response types for all RPC methods.
 * Used by both frontend (caller) and backend (handler) for compile-time type safety.
 *
 * Domain-specific types are split into child files under ./rpc/ for maintainability.
 * This barrel re-exports all child types and contains the central RpcMethodRegistry.
 */

// ============================================================
// Re-export all domain-specific RPC types
// ============================================================

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

export * from './rpc/rpc-indexing.types';

export * from './rpc/rpc-update.types';

// ============================================================
// Imports for RpcMethodRegistry (types used only in registry entries)
// ============================================================

import type {
  SubagentQueryParams,
  SubagentQueryResult,
  SubagentSendMessageParams,
  SubagentStopParams,
  SubagentInterruptParams,
  SubagentCommandResult,
} from './subagent-registry.types';
import type { SavedAnalysisMetadata } from './wizard';

// Types from child files used in the registry
import type {
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatResumeParams,
  ChatResumeResult,
  ChatAbortParams,
  ChatAbortResult,
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
  WizardStartNewProjectChatParams,
  WizardStartNewProjectChatResult,
} from './rpc/rpc-setup.types';

import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  AgentPermissionDecision,
  SkillShEntry,
  SkillAgentTarget,
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
} from './rpc/rpc-memory.types';

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
  HarnessChatParams,
  HarnessChatResponse,
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessConverseParams,
  HarnessConverseResponse,
} from './rpc/rpc-harness.types';

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
} from './rpc/rpc-persistence.types';

import type {
  UpdateCheckNowParams,
  UpdateCheckNowResult,
  UpdateInstallNowParams,
  UpdateInstallNowResult,
} from './rpc/rpc-update.types';

// ============================================================
// RPC Method Registry (Compile-Time Enforcement)
// ============================================================

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
 * 3. Register the handler in RpcMethodRegistrationService
 *
 * If a method is not in this registry, it CANNOT be called from frontend.
 */
export interface RpcMethodRegistry {
  // ---- Chat Methods ----
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  'chat:resume': { params: ChatResumeParams; result: ChatResumeResult };
  'chat:abort': { params: ChatAbortParams; result: ChatAbortResult };
  'chat:running-agents': {
    params: ChatRunningAgentsParams;
    result: ChatRunningAgentsResult;
  };

  // ---- Session Methods ----
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

  // ---- Context Methods ----
  'context:getAllFiles': {
    params: ContextGetAllFilesParams;
    result: ContextGetAllFilesResult;
  };
  'context:getFileSuggestions': {
    params: ContextGetFileSuggestionsParams;
    result: ContextGetFileSuggestionsResult;
  };

  // ---- Autocomplete Methods ----
  'autocomplete:agents': {
    params: AutocompleteAgentsParams;
    result: AutocompleteAgentsResult;
  };
  'autocomplete:commands': {
    params: AutocompleteCommandsParams;
    result: AutocompleteCommandsResult;
  };

  // ---- File Methods ----
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

  // ---- Config Methods ----
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

  // ---- Auth Methods ----
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

  // ---- Setup Methods ----
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
  // Wizard Generation Methods
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
  // Wizard Analysis History Methods (v2 Multi-Phase)
  'wizard:list-analyses': {
    params: Record<string, never>;
    result: { analyses: SavedAnalysisMetadata[] };
  };
  'wizard:load-analysis': {
    params: { filename: string };
    result: MultiPhaseAnalysisResponse;
  };
  // Agent Pack Browser Methods
  'wizard:list-agent-packs': {
    params: WizardListAgentPacksParams;
    result: WizardListAgentPacksResult;
  };
  'wizard:install-pack-agents': {
    params: WizardInstallPackAgentsParams;
    result: WizardInstallPackAgentsResult;
  };
  // New Project Chat Handoff
  'wizard:start-new-project-chat': {
    params: WizardStartNewProjectChatParams;
    result: WizardStartNewProjectChatResult;
  };

  // ---- License Methods ----
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

  // ---- Command Methods ----
  'command:execute': {
    params: CommandExecuteParams;
    result: CommandExecuteResponse;
  };

  // ---- LLM Provider Methods ----
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

  // ---- Provider Model Methods ----
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

  // ---- Subagent Methods ----
  'chat:subagent-query': {
    params: SubagentQueryParams;
    result: SubagentQueryResult;
  };
  // Bidirectional messaging + stop/interrupt
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

  // ---- Enhanced Prompts Methods ----
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
  // Settings UI prompt content & download
  'enhancedPrompts:getPromptContent': {
    params: { workspacePath: string };
    result: { content: string | null; error?: string };
  };
  'enhancedPrompts:download': {
    params: { workspacePath: string };
    result: { success: boolean; filePath?: string; error?: string };
  };

  // ---- Quality Dashboard Methods ----
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

  // ---- Plugin Methods ----
  'plugins:list-available': {
    params: Record<string, never>;
    result: { plugins: PluginInfo[] };
  };
  'plugins:get-config': {
    params: Record<string, never>;
    result: PluginConfigState;
  };
  'plugins:save-config': {
    params: { enabledPluginIds: string[]; disabledSkillIds?: string[] };
    result: { success: boolean; error?: string };
  };
  'plugins:list-skills': {
    params: { pluginIds: string[] };
    result: { skills: PluginSkillEntry[] };
  };

  // ---- Agent Orchestration Methods ----
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
  /** Stop a running CLI agent by agentId */
  'agent:stop': {
    params: { agentId: string };
    result: { success: boolean; error?: string };
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

  // ---- Ptah CLI Agent Methods ----
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

  // ---- Skills.sh Marketplace Methods ----
  'skillsSh:search': {
    params: { query: string };
    result: { skills: SkillShEntry[]; error?: string };
  };
  'skillsSh:listInstalled': {
    params: Record<string, never>;
    result: { skills: InstalledSkill[] };
  };
  'skillsSh:install': {
    params: {
      source: string;
      skillId?: string;
      scope: 'project' | 'global';
      agents?: SkillAgentTarget[];
    };
    result: { success: boolean; error?: string };
  };
  'skillsSh:uninstall': {
    params: { name: string; scope: 'project' | 'global' };
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

  // ---- MCP Server Directory Methods ----
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

  // ---- Workspace Methods (Electron desktop) ----
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
    // `origin` is an opaque per-call token stamped by the frontend so the
    // resulting WORKSPACE_CHANGED echo can be identified and dropped
    // (self-echo suppression). Optional for backward compat with platforms
    // that don't broadcast push events.
    params: { path: string; origin?: string };
    result: { success: boolean; error?: string };
  };
  'workspace:registerFolder': {
    params: { path: string };
    result: { success: boolean; path: string; name: string; error?: string };
  };

  // ---- Layout Methods (Electron desktop) ----
  'layout:persist': {
    params: Record<string, unknown>;
    result: { success: boolean };
  };
  'layout:restore': {
    params: Record<string, never>;
    result: { success: boolean };
  };

  // ---- Editor Methods (M3 — VS Code, post-rewind buffer revert) ----
  'editor:revertFiles': {
    params: EditorRevertFilesParams;
    result: EditorRevertFilesResult;
  };

  // ---- Electron Editor Methods ----
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

  // ---- Electron File CRUD Methods ----
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

  // ---- Electron File Methods ----
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

  // ---- Electron Config Extended Methods ----
  'config:model-set': {
    params: { model?: string; autopilot?: boolean };
    result: { success: boolean };
  };

  // ---- Electron Auth Extended Methods ----
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

  // ---- Electron Settings Methods ----
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

  // ---- Web Search Settings Methods ----
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

  // ---- Git Methods ----
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
  // Source control methods
  'git:stage': { params: GitStageParams; result: GitStageResult };
  'git:unstage': { params: GitUnstageParams; result: GitUnstageResult };
  'git:discard': { params: GitDiscardParams; result: GitDiscardResult };
  'git:commit': { params: GitCommitParams; result: GitCommitResult };
  'git:showFile': { params: GitShowFileParams; result: GitShowFileResult };
  // Git enhancement methods
  'git:branches': { params: GitBranchesParams; result: GitBranchesResult };
  'git:checkout': { params: GitCheckoutParams; result: GitCheckoutResult };
  'git:stashList': { params: GitStashListParams; result: GitStashListResult };
  'git:tags': { params: GitTagsParams; result: GitTagsResult };
  'git:remotes': { params: GitRemotesParams; result: GitRemotesResult };
  'git:lastCommit': {
    params: GitLastCommitParams;
    result: GitLastCommitResult;
  };

  // ---- Terminal Methods ----
  'terminal:create': {
    params: TerminalCreateParams;
    result: TerminalCreateResult;
  };
  'terminal:kill': { params: TerminalKillParams; result: TerminalKillResult };

  // ---- Harness Builder Methods ----
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
  'harness:chat': {
    params: HarnessChatParams;
    result: HarnessChatResponse;
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
  'harness:converse': {
    params: HarnessConverseParams;
    result: HarnessConverseResponse;
  };

  // Letta-style tiered memory curator
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
  'memory:purgeBySubjectPattern': {
    params: MemoryPurgeBySubjectPatternParams;
    result: MemoryPurgeBySubjectPatternResult;
  };
  'memory:purgeJunk': {
    params: MemoryPurgeJunkParams;
    result: MemoryPurgeJunkResult;
  };

  // Autonomous skill synthesis
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

  // Cron scheduler
  'cron:list': { params: CronListParams; result: CronListResult };
  'cron:get': { params: CronGetParams; result: CronGetResult };
  'cron:create': { params: CronCreateParams; result: CronCreateResult };
  'cron:update': { params: CronUpdateParams; result: CronUpdateResult };
  'cron:delete': { params: CronDeleteParams; result: CronDeleteResult };
  'cron:toggle': { params: CronToggleParams; result: CronToggleResult };
  'cron:runNow': { params: CronRunNowParams; result: CronRunNowResult };
  'cron:runs': { params: CronRunsParams; result: CronRunsResult };
  'cron:nextFire': { params: CronNextFireParams; result: CronNextFireResult };

  // Messaging gateway
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

  'db:health': {
    params: { fullCheck?: boolean };
    result: DbHealthResult;
  };
  'db:reset': {
    params: { confirm: string };
    result: DbResetResult;
  };

  // User-controlled workspace indexing
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

  // Electron auto-update UX (check-now, install-now)
  'update:check-now': {
    params: UpdateCheckNowParams;
    result: UpdateCheckNowResult;
  };
  'update:install-now': {
    params: UpdateInstallNowParams;
    result: UpdateInstallNowResult;
  };
}

// Skill synthesis RPC param/result types.
// Inlined here (rather than a child rpc-skill-synthesis.types.ts) because
// the surface is small and self-contained — six methods, all reading from
// or mutating the candidate store / invocation log.

export interface SkillSynthesisCandidateSummary {
  id: string;
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
 * DTO mirroring all 17 SkillSynthesisSettings fields.
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
  minTrajectoryFidelityRatio: number;
  dedupClusterThreshold: number;
  minAbstractionEditDistance: number;
  judgeEnabled: boolean;
  minJudgeScore: number;
  judgeModel: string;
  maxPinnedSkills: number;
  curatorEnabled: boolean;
  curatorIntervalHours: number;
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
}

// Messaging gateway RPC param/result types.
//
// Eight methods covering: status query, start/stop lifecycle, token write,
// binding list/approve/block (the per-user pairing surface), and message
// history. All param/result shapes are deliberately small — the heavy
// payloads (binding rows, message rows) live in the messaging-gateway lib's
// own types; we mirror the bare DTO fields here so the shared package stays
// dependency-free.

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

// Cron scheduler RPC param/result types.
// Wire-friendly DTOs that mirror the persisted shape from
// `@ptah-extension/cron-scheduler` types.ts but use plain `string` for ids
// (frontend bindings don't have access to the JobId / RunId branded types).

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
  // Chat Methods
  'chat:start': true,
  'chat:continue': true,
  'chat:abort': true,
  'chat:running-agents': true,
  'chat:resume': true,

  // Session Methods
  'session:list': true,
  'session:load': true,
  'session:delete': true,
  'session:rename': true,
  'session:validate': true,
  'session:cli-sessions': true,
  'session:stats-batch': true,
  'session:forkSession': true,
  'session:rewindFiles': true,

  // Context Methods
  'context:getAllFiles': true,
  'context:getFileSuggestions': true,

  // Autocomplete Methods
  'autocomplete:agents': true,
  'autocomplete:commands': true,

  // File Methods
  'file:open': true,
  'file:pick': true,
  'file:pick-images': true,

  // Config Methods
  'config:model-switch': true,
  'config:model-get': true,
  'config:autopilot-toggle': true,
  'config:autopilot-get': true,
  'config:models-list': true,
  'config:effort-get': true,
  'config:effort-set': true,

  // Auth Methods
  'auth:getHealth': true,
  'auth:saveSettings': true,
  'auth:testConnection': true,
  'auth:getAuthStatus': true,
  'auth:copilotLogin': true,
  'auth:copilotLogout': true,
  'auth:copilotStatus': true,
  'auth:codexLogin': true,

  // Setup Methods
  'setup-status:get-status': true,
  'setup-wizard:launch': true,
  'wizard:deep-analyze': true,
  'wizard:recommend-agents': true,
  'wizard:cancel-analysis': true,
  // Wizard Generation Methods
  'wizard:submit-selection': true,
  'wizard:cancel': true,
  'wizard:retry-item': true,
  // Wizard Analysis History Methods (v2 Multi-Phase)
  'wizard:list-analyses': true,
  'wizard:load-analysis': true,
  // Agent Pack Browser Methods
  'wizard:list-agent-packs': true,
  'wizard:install-pack-agents': true,
  // New Project Chat Handoff
  'wizard:start-new-project-chat': true,

  // License Methods
  'license:getStatus': true,
  'license:setKey': true,
  'license:clearKey': true,

  // Command Methods
  'command:execute': true,

  // LLM Provider Methods
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

  // Provider Model Methods
  'provider:listModels': true,
  'provider:setModelTier': true,
  'provider:getModelTiers': true,
  'provider:clearModelTier': true,

  // Subagent Methods
  'chat:subagent-query': true,
  // Bidirectional messaging + stop/interrupt
  'subagent:send-message': true,
  'subagent:stop': true,
  'subagent:interrupt': true,

  // Enhanced Prompts Methods
  'enhancedPrompts:getStatus': true,
  'enhancedPrompts:runWizard': true,
  'enhancedPrompts:setEnabled': true,
  'enhancedPrompts:regenerate': true,
  // Settings UI prompt content & download
  'enhancedPrompts:getPromptContent': true,
  'enhancedPrompts:download': true,

  // Quality Dashboard Methods
  'quality:getAssessment': true,
  'quality:getHistory': true,
  'quality:export': true,

  // Plugin Methods
  'plugins:list-available': true,
  'plugins:get-config': true,
  'plugins:save-config': true,
  'plugins:list-skills': true,

  // Agent Orchestration Methods
  'agent:getConfig': true,
  'agent:setConfig': true,
  'agent:detectClis': true,
  'agent:listCliModels': true,
  'agent:permissionResponse': true, // Copilot SDK permission response
  'agent:stop': true,
  'agent:resumeCliSession': true, // CLI agent session resume
  'agent:backgroundList': true, // Background agent listing

  // Ptah CLI Agent Methods
  'ptahCli:list': true,
  'ptahCli:create': true,
  'ptahCli:update': true,
  'ptahCli:delete': true,
  'ptahCli:testConnection': true,
  'ptahCli:listModels': true,

  // Skills.sh Marketplace Methods
  'skillsSh:search': true,
  'skillsSh:listInstalled': true,
  'skillsSh:install': true,
  'skillsSh:uninstall': true,
  'skillsSh:getPopular': true,
  'skillsSh:detectRecommended': true,

  // MCP Server Directory Methods
  'mcpDirectory:search': true,
  'mcpDirectory:getDetails': true,
  'mcpDirectory:install': true,
  'mcpDirectory:uninstall': true,
  'mcpDirectory:listInstalled': true,
  'mcpDirectory:getPopular': true,

  // Workspace Methods (Electron desktop)
  'workspace:getInfo': true,
  'workspace:addFolder': true,
  'workspace:removeFolder': true,
  'workspace:switch': true,
  'workspace:registerFolder': true,

  // Layout Methods (Electron desktop)
  'layout:persist': true,
  'layout:restore': true,

  // Editor Methods (M3 — VS Code, post-rewind buffer revert)
  'editor:revertFiles': true,

  // Electron Editor Methods
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

  // Electron File Methods
  'file:read': true,
  'file:exists': true,
  'file:save-dialog': true,

  // Electron Config Extended Methods
  'config:model-set': true,

  // Electron Auth Extended Methods
  'auth:setApiKey': true,
  'auth:getStatus': true,
  'auth:getApiKeyStatus': true,

  // Electron Settings Methods
  'settings:export': true,
  'settings:import': true,

  // Web Search Settings Methods
  'webSearch:getApiKeyStatus': true,
  'webSearch:setApiKey': true,
  'webSearch:deleteApiKey': true,
  'webSearch:test': true,
  'webSearch:getConfig': true,
  'webSearch:setConfig': true,

  // Git Methods
  'git:info': true,
  'git:worktrees': true,
  'git:addWorktree': true,
  'git:removeWorktree': true,
  // Source control methods
  'git:stage': true,
  'git:unstage': true,
  'git:discard': true,
  'git:commit': true,
  'git:showFile': true,
  // Git enhancement methods
  'git:branches': true,
  'git:checkout': true,
  'git:stashList': true,
  'git:tags': true,
  'git:remotes': true,
  'git:lastCommit': true,

  // Terminal Methods
  'terminal:create': true,
  'terminal:kill': true,

  // Harness Builder Methods
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
  'harness:chat': true,
  'harness:design-agents': true,
  'harness:generate-skills': true,
  'harness:generate-document': true,
  'harness:analyze-intent': true,
  'harness:converse': true,

  'memory:list': true,
  'memory:search': true,
  'memory:get': true,
  'memory:pin': true,
  'memory:unpin': true,
  'memory:forget': true,
  'memory:rebuildIndex': true,
  'memory:stats': true,
  'memory:purgeBySubjectPattern': true,
  'memory:purgeJunk': true,

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

  'db:health': true,
  'db:reset': true,

  'indexing:getStatus': true,
  'indexing:start': true,
  'indexing:pause': true,
  'indexing:resume': true,
  'indexing:cancel': true,
  'indexing:setPipelineEnabled': true,
  'indexing:dismissStale': true,
  'indexing:acknowledgeDisclosure': true,

  'update:check-now': true,
  'update:install-now': true,
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
