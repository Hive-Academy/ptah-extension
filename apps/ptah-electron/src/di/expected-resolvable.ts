import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { CODEX_RUNTIME_TOKENS } from '@ptah-extension/codex-runtime';
import {
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
  GitWatchRpcHandlers,
  RecentWorkspacesService,
  DisplayWindowRpcHandlers,
  ReviewRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { CHAT_TOKENS } from '@ptah-extension/rpc-handlers';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import {
  REVIEW_CORE_TOKENS,
  REVIEW_CONTEXT_TOKENS,
  REVIEW_LANE_TOKENS,
} from '@ptah-extension/review-core';
import { REVIEW_GITHUB_TOKENS } from '@ptah-extension/review-github';
import { CODEX_SIGN_IN_QUIT_HANDLE } from './codex-login-composition';

export const EXPECTED_RESOLVABLE = [
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
  // `git:watchRoots` (TASK_2026_855 D20); needs GIT_ROOT_WATCH_REGISTRY_TOKEN.
  GitWatchRpcHandlers,
  RecentWorkspacesService,
  DisplayWindowRpcHandlers,
  ReviewRpcHandlers,
] as const;

/** Lib-owned tokens composed by Electron in addition to handler classes. */
export const EXPECTED_RESOLVABLE_TOKENS = [
  ['HOST_ROUTING_COORDINATOR', CHAT_TOKENS.HOST_ROUTING_COORDINATOR],
  ['SESSION_USAGE_SINK', PLATFORM_TOKENS.SESSION_USAGE_SINK],
  ['SESSION_DRIVER_LOCK', PLATFORM_TOKENS.SESSION_DRIVER_LOCK],
  [
    'SESSION_DRIVER_LOCK_COORDINATOR',
    CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR,
  ],
  // Backend-owned follow-up queue (TASK_2026_884), bound by registerChatServices.
  ['FOLLOW_UP_QUEUE', CHAT_TOKENS.FOLLOW_UP_QUEUE],
  ['HOST_ROUTING_SETTING', LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING],
  ['LANE_TASK_KIND_CLASSIFIER', LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER],
  ['OUTCOME_TASK_KIND_CLASSIFIER', LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER],
  ['SDK_NEXT_TURN_REMINDER_QUEUE', SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE],
  ['SESSION_HISTORY_ROUTER', SDK_TOKENS.SESSION_HISTORY_ROUTER],
  ['REVIEW_ORCHESTRATOR', REVIEW_CORE_TOKENS.ORCHESTRATOR],
  ['REVIEW_QUERY_REPOSITORY', REVIEW_CORE_TOKENS.QUERY_REPOSITORY],
  ['REVIEW_SETTINGS_STORE', REVIEW_CORE_TOKENS.SETTINGS_STORE],
  ['REVIEW_ARTIFACT_READER', REVIEW_CORE_TOKENS.ARTIFACT_READER],
  ['REVIEW_SECRET_PRESENCE', REVIEW_CORE_TOKENS.SECRET_PRESENCE],
  ['REVIEW_GITHUB', REVIEW_CORE_TOKENS.GITHUB],
  ['REVIEW_ENVIRONMENT', REVIEW_CORE_TOKENS.ENVIRONMENT],
  ['REVIEW_PUBLICATION_GUARD', REVIEW_GITHUB_TOKENS.PUBLICATION_GUARD],
  ['REVIEW_PUBLICATION_PORT', REVIEW_GITHUB_TOKENS.PUBLICATION_PORT],
  ['REVIEW_CONTEXT_FILES', REVIEW_CONTEXT_TOKENS.FILES],
  ['REVIEW_COMMAND_RUNNER', REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER],
  ['REVIEW_LANE_GATEWAY', REVIEW_LANE_TOKENS.GATEWAY],
  ['REVIEW_LANE_FILES', REVIEW_LANE_TOKENS.FILES],
  ['REVIEW_ARTIFACT_FILES', REVIEW_CORE_TOKENS.ARTIFACT_FILES],
  ['CODEX_SIGN_IN_QUIT_HANDLE', CODEX_SIGN_IN_QUIT_HANDLE],
  ['SDK_CODEX_LOGIN', AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN],
  ['SDK_CODEX_READINESS', AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS],
  ['SQLITE_SEARCH_WORKER', MEMORY_TOKENS.SQLITE_SEARCH_WORKER],
] as const;

/**
 * Electron-only port bound in `phase-4-handlers.ts` (TASK_2026_855 D20).
 * Same symbol as `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const GIT_ROOT_WATCH_REGISTRY_TOKEN = Symbol.for(
  'PlatformGitRootWatchRegistry',
);

/** Phase-2 singleton; kept separate from the handler-class census. */
export const HOST_ATTENTION_COORDINATOR_TOKEN = Symbol.for(
  'HostAttentionCoordinator',
);

/**
 * Optional port registered by `registerSharedRpcHandlers` (Batch 14).
 * Same symbol as `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const LANE_MODEL_LISTING_TOKEN = Symbol.for(
  'LaneRoutingLaneModelListing',
);

/**
 * Optional port registered by `registerSdkServices` (Batch 19).
 * Same symbol as `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const STRUCTURED_DECISION_TOKEN = Symbol.for(
  'LaneRoutingStructuredDecision',
);

/**
 * Lib-owned config registered by `registerLaneRoutingServices` (Batch 30a).
 * Same symbol as `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const DECISION_MODEL_CONFIG_TOKEN = Symbol.for(
  'LaneRoutingDecisionModelConfig',
);

/**
 * Lib-owned catalog registered by `registerLaneRoutingServices`
 * (TASK_2026_684 Batch 13). Same symbol as
 * `LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const DECISION_MODEL_CATALOG_TOKEN = Symbol.for(
  'LaneRoutingDecisionModelCatalog',
);

/** SDK defaults before bootstrap installs the complete Electron binding. */
export const EXPECTED_NULL_RUNTIME_TOKENS = [
  SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
  SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
  SDK_TOKENS.RUNTIME_ADMISSION_PORT,
  SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
  SDK_TOKENS.NATIVE_SESSION_CONTROLS,
  SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT,
  SDK_TOKENS.LEGACY_SESSION_CONTROLS,
  SDK_TOKENS.SESSION_RUNTIME_ROUTER,
  SDK_TOKENS.CODEX_CHAT_ADAPTER,
  SDK_TOKENS.ROUTING_AGENT_ADAPTER,
] as const;

export const EXPECTED_RUNTIME_TOKENS = [
  ...EXPECTED_NULL_RUNTIME_TOKENS,
  SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
] as const;

export const ELECTRON_CODEX_BOUND_TOKENS = [
  CODEX_RUNTIME_TOKENS.SelectionSnapshot,
  SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
  SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
  SDK_TOKENS.RUNTIME_ADMISSION_PORT,
  SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
  SDK_TOKENS.NATIVE_SESSION_CONTROLS,
  SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
  SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT,
] as const;
