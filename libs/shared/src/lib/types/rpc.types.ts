/**
 * RPC Type Definitions
 *
 * Type-safe parameter and response types for all RPC methods.
 * Used by both frontend (caller) and backend (handler) for compile-time type safety.
 *
 * TASK_2025_051: SDK-only migration - proper type definitions
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

// ============================================================
// Imports for RpcMethodRegistry (types used only in registry entries)
// ============================================================

// TASK_2025_109: SubagentResumeParams/Result removed - now uses context injection
import type {
  SubagentQueryParams,
  SubagentQueryResult,
} from './subagent-registry.types';
import type { SavedAnalysisMetadata } from './setup-wizard.types';

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
  WizardNewProjectSelectTypeParams,
  WizardNewProjectSelectTypeResult,
  WizardNewProjectSubmitAnswersParams,
  WizardNewProjectSubmitAnswersResult,
  WizardNewProjectGetPlanParams,
  WizardNewProjectGetPlanResult,
  WizardNewProjectApprovePlanParams,
  WizardNewProjectApprovePlanResult,
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
} from './rpc/rpc-git.types';

import type {
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalKillParams,
  TerminalKillResult,
} from './rpc/rpc-terminal.types';

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
  // Wizard Generation Methods (TASK_2025_148)
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
  // Agent Pack Browser Methods (TASK_2025_258)
  'wizard:list-agent-packs': {
    params: WizardListAgentPacksParams;
    result: WizardListAgentPacksResult;
  };
  'wizard:install-pack-agents': {
    params: WizardInstallPackAgentsParams;
    result: WizardInstallPackAgentsResult;
  };
  // New Project Wizard Methods
  'wizard:new-project-select-type': {
    params: WizardNewProjectSelectTypeParams;
    result: WizardNewProjectSelectTypeResult;
  };
  'wizard:new-project-submit-answers': {
    params: WizardNewProjectSubmitAnswersParams;
    result: WizardNewProjectSubmitAnswersResult;
  };
  'wizard:new-project-get-plan': {
    params: WizardNewProjectGetPlanParams;
    result: WizardNewProjectGetPlanResult;
  };
  'wizard:new-project-approve-plan': {
    params: WizardNewProjectApprovePlanParams;
    result: WizardNewProjectApprovePlanResult;
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

  // ---- Command Methods (TASK_2025_126) ----
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

  // ---- Provider Model Methods (TASK_2025_091 Phase 2, generalized TASK_2025_132) ----
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

  // ---- Subagent Methods (TASK_2025_103) ----
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query': {
    params: SubagentQueryParams;
    result: SubagentQueryResult;
  };

  // ---- Enhanced Prompts Methods (TASK_2025_137) ----
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
  // TASK_2025_149 Batch 5: Settings UI prompt content & download
  'enhancedPrompts:getPromptContent': {
    params: { workspacePath: string };
    result: { content: string | null; error?: string };
  };
  'enhancedPrompts:download': {
    params: { workspacePath: string };
    result: { success: boolean; filePath?: string; error?: string };
  };

  // ---- Quality Dashboard Methods (TASK_2025_144) ----
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

  // ---- Plugin Methods (TASK_2025_153) ----
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

  // ---- Agent Orchestration Methods (TASK_2025_157) ----
  'agent:getConfig': {
    params: void;
    result: AgentOrchestrationConfig;
  };
  'agent:setConfig': {
    params: AgentSetConfigParams;
    result: { success: boolean; reloadRequired?: boolean; error?: string };
  };
  'agent:detectClis': {
    params: void;
    result: { clis: import('./agent-process.types').CliDetectionResult[] };
  };
  'agent:listCliModels': {
    params: void;
    result: AgentListCliModelsResult;
  };
  /** Route user's permission decision to Copilot SDK bridge (TASK_2025_162) */
  'agent:permissionResponse': {
    params: AgentPermissionDecision;
    result: { success: boolean; error?: string };
  };
  /** Stop a running CLI agent by agentId */
  'agent:stop': {
    params: { agentId: string };
    result: { success: boolean; error?: string };
  };
  /** Resume a CLI agent session by spawning a new process with resumeSessionId (TASK_2025_173) */
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
  /** List background agents for a session (TASK_2025_168) */
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

  // ---- Ptah CLI Agent Methods (TASK_2025_167 -> TASK_2025_170) ----
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

  // ---- Skills.sh Marketplace Methods (TASK_2025_204) ----
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
    params: { path: string };
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

  // ---- Electron Editor Methods (TASK_2025_203) ----
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

  // ---- Electron File Methods (TASK_2025_203) ----
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

  // ---- Electron Config Extended Methods (TASK_2025_203) ----
  'config:model-set': {
    params: { model?: string; autopilot?: boolean };
    result: { success: boolean };
  };

  // ---- Electron Auth Extended Methods (TASK_2025_203) ----
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

  // ---- Electron Settings Methods (TASK_2025_210) ----
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

  // ---- Web Search Settings Methods (TASK_2025_235) ----
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

  // ---- Git Methods (TASK_2025_227) ----
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
  // Source control methods (TASK_2025_273)
  'git:stage': { params: GitStageParams; result: GitStageResult };
  'git:unstage': { params: GitUnstageParams; result: GitUnstageResult };
  'git:discard': { params: GitDiscardParams; result: GitDiscardResult };
  'git:commit': { params: GitCommitParams; result: GitCommitResult };
  'git:showFile': { params: GitShowFileParams; result: GitShowFileResult };

  // ---- Terminal Methods (TASK_2025_227) ----
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
}

/**
 * Valid RPC method names (compile-time enforced)
 * Use this type to ensure only valid methods can be called
 */
export type RpcMethodName = keyof RpcMethodRegistry;

/**
 * All RPC method names as a runtime array
 *
 * This array MUST match the keys in RpcMethodRegistry.
 * Used by the backend verification helper to ensure all methods have handlers.
 *
 * CRITICAL: When adding a new method to RpcMethodRegistry, add it here too!
 * TypeScript will NOT catch mismatches automatically (runtime vs compile-time).
 */
export const RPC_METHOD_NAMES: RpcMethodName[] = [
  // Chat Methods
  'chat:start',
  'chat:continue',
  'chat:abort',
  'chat:running-agents',
  'chat:resume',

  // Session Methods
  'session:list',
  'session:load',
  'session:delete',
  'session:rename',
  'session:validate',
  'session:cli-sessions',
  'session:stats-batch',

  // Context Methods
  'context:getAllFiles',
  'context:getFileSuggestions',

  // Autocomplete Methods
  'autocomplete:agents',
  'autocomplete:commands',

  // File Methods
  'file:open',
  'file:pick',
  'file:pick-images',

  // Config Methods
  'config:model-switch',
  'config:model-get',
  'config:autopilot-toggle',
  'config:autopilot-get',
  'config:models-list',
  'config:effort-get',
  'config:effort-set',

  // Auth Methods
  'auth:getHealth',
  'auth:saveSettings',
  'auth:testConnection',
  'auth:getAuthStatus',
  'auth:copilotLogin',
  'auth:copilotLogout',
  'auth:copilotStatus',
  'auth:codexLogin',

  // Setup Methods
  'setup-status:get-status',
  'setup-wizard:launch',
  'wizard:deep-analyze',
  'wizard:recommend-agents',
  'wizard:cancel-analysis',
  // Wizard Generation Methods (TASK_2025_148)
  'wizard:submit-selection',
  'wizard:cancel',
  'wizard:retry-item',
  // Wizard Analysis History Methods (v2 Multi-Phase)
  'wizard:list-analyses',
  'wizard:load-analysis',
  // Agent Pack Browser Methods (TASK_2025_258)
  'wizard:list-agent-packs',
  'wizard:install-pack-agents',
  // New Project Wizard Methods
  'wizard:new-project-select-type',
  'wizard:new-project-submit-answers',
  'wizard:new-project-get-plan',
  'wizard:new-project-approve-plan',

  // License Methods
  'license:getStatus',
  'license:setKey',
  'license:clearKey',

  // Command Methods (TASK_2025_126)
  'command:execute',

  // LLM Provider Methods
  'llm:getProviderStatus',
  'llm:setApiKey',
  'llm:removeApiKey',
  'llm:getDefaultProvider',
  'llm:setDefaultProvider',
  'llm:setDefaultModel',
  'llm:validateApiKeyFormat',
  'llm:listVsCodeModels',
  'llm:listProviderModels',

  // Provider Model Methods (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  'provider:listModels',
  'provider:setModelTier',
  'provider:getModelTiers',
  'provider:clearModelTier',

  // Subagent Methods (TASK_2025_103)
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query',

  // Enhanced Prompts Methods (TASK_2025_137)
  'enhancedPrompts:getStatus',
  'enhancedPrompts:runWizard',
  'enhancedPrompts:setEnabled',
  'enhancedPrompts:regenerate',
  // TASK_2025_149 Batch 5: Settings UI prompt content & download
  'enhancedPrompts:getPromptContent',
  'enhancedPrompts:download',

  // Quality Dashboard Methods (TASK_2025_144)
  'quality:getAssessment',
  'quality:getHistory',
  'quality:export',

  // Plugin Methods (TASK_2025_153)
  'plugins:list-available',
  'plugins:get-config',
  'plugins:save-config',
  'plugins:list-skills',

  // Agent Orchestration Methods (TASK_2025_157)
  'agent:getConfig',
  'agent:setConfig',
  'agent:detectClis',
  'agent:listCliModels',
  'agent:permissionResponse', // TASK_2025_162: Copilot SDK permission response
  'agent:stop',
  'agent:resumeCliSession', // TASK_2025_173: CLI agent session resume
  'agent:backgroundList', // TASK_2025_168: Background agent listing

  // Ptah CLI Agent Methods (TASK_2025_167 -> TASK_2025_170)
  'ptahCli:list',
  'ptahCli:create',
  'ptahCli:update',
  'ptahCli:delete',
  'ptahCli:testConnection',
  'ptahCli:listModels',

  // Skills.sh Marketplace Methods (TASK_2025_204)
  'skillsSh:search',
  'skillsSh:listInstalled',
  'skillsSh:install',
  'skillsSh:uninstall',
  'skillsSh:getPopular',
  'skillsSh:detectRecommended',

  // MCP Server Directory Methods
  'mcpDirectory:search',
  'mcpDirectory:getDetails',
  'mcpDirectory:install',
  'mcpDirectory:uninstall',
  'mcpDirectory:listInstalled',
  'mcpDirectory:getPopular',

  // Workspace Methods (Electron desktop)
  'workspace:getInfo',
  'workspace:addFolder',
  'workspace:removeFolder',
  'workspace:switch',
  'workspace:registerFolder',

  // Layout Methods (Electron desktop)
  'layout:persist',
  'layout:restore',

  // Electron Editor Methods (TASK_2025_203)
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',
  'editor:createFile',
  'editor:createFolder',
  'editor:renameItem',
  'editor:deleteItem',

  // Electron File Methods (TASK_2025_203)
  'file:read',
  'file:exists',
  'file:save-dialog',

  // Electron Config Extended Methods (TASK_2025_203)
  'config:model-set',

  // Electron Auth Extended Methods (TASK_2025_203)
  'auth:setApiKey',
  'auth:getStatus',
  'auth:getApiKeyStatus',

  // Electron Settings Methods (TASK_2025_210)
  'settings:export',
  'settings:import',

  // Web Search Settings Methods (TASK_2025_235)
  'webSearch:getApiKeyStatus',
  'webSearch:setApiKey',
  'webSearch:deleteApiKey',
  'webSearch:test',
  'webSearch:getConfig',
  'webSearch:setConfig',

  // Git Methods (TASK_2025_227)
  'git:info',
  'git:worktrees',
  'git:addWorktree',
  'git:removeWorktree',
  // Source control methods (TASK_2025_273)
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:commit',
  'git:showFile',

  // Terminal Methods (TASK_2025_227)
  'terminal:create',
  'terminal:kill',

  // Harness Builder Methods
  'harness:initialize',
  'harness:suggest-config',
  'harness:search-skills',
  'harness:create-skill',
  'harness:discover-mcp',
  'harness:generate-prompt',
  'harness:generate-claude-md',
  'harness:apply',
  'harness:save-preset',
  'harness:load-presets',
  'harness:chat',
  'harness:design-agents',
  'harness:generate-skills',
  'harness:generate-document',
  'harness:analyze-intent',
  'harness:converse',
] as const;

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
