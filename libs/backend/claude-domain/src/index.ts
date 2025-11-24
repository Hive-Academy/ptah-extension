/**
 * Claude Domain - Claude CLI integration library
 * Exports all public APIs for use by extension and ai-providers-core
 */

// Detector
export { ClaudeCliDetector } from './detector/claude-cli-detector';
export type { ClaudeInstallation } from './detector/claude-cli-detector';
export { ClaudeCliPathResolver } from './detector/claude-cli-path-resolver';
export type { ResolvedClaudeCliPath } from './detector/claude-cli-path-resolver';

// Session Management (restored for RPC)
export { SessionManager } from './session/session-manager';
export type {
  SessionUIData,
  ClaudeSessionInfo,
  CreateSessionOptions,
  AddMessageOptions,
  SessionStatistics,
  BulkDeleteResult,
  IStorageService,
} from './session/session-manager';

// Command Execution - DELETED (use frontend chat templates instead)

// Orchestration Services - DELETED (event-based architecture removed)
// Chat Orchestration - DELETED
// Provider Orchestration - DELETED
// Analytics Orchestration - DELETED
// Config Orchestration - DELETED
// Message Handler Service (Router) - DELETED

// CLI Launcher & Process Management
export { ClaudeCliService } from './cli/claude-cli.service';
export { ClaudeCliLauncher } from './cli/claude-cli-launcher';
export type { LauncherDependencies } from './cli/claude-cli-launcher';
export { ProcessManager } from './cli/process-manager';
export type { ProcessMetadata } from './cli/process-manager';
export { MCPRegistrationService } from './cli/mcp-registration.service';

// Interactive Session Management
export { InteractiveSessionManager } from './cli/interactive-session-manager';
export type { InteractiveSessionManagerOptions } from './cli/interactive-session-manager';
export { SessionProcess } from './cli/session-process';
export type {
  SessionProcessState,
  SessionProcessMetadata,
} from './cli/session-process';
export { MessageQueue } from './cli/message-queue';
export type { QueuedMessage } from './cli/message-queue';

// JSONL Parsing
export { JSONLStreamParser } from './cli/jsonl-stream-parser';
export type {
  JSONLParserCallbacks,
  JSONLMessage,
  JSONLSystemMessage,
  JSONLAssistantMessage,
  JSONLToolMessage,
  JSONLPermissionMessage,
  JSONLStreamEvent,
  JSONLResultMessage,
} from './cli/jsonl-stream-parser';

// Permissions
export { PermissionService } from './permissions/permission-service';
export type { PermissionServiceConfig } from './permissions/permission-service';
export {
  InMemoryPermissionRulesStore,
  type IPermissionRulesStore,
} from './permissions/permission-rules.store';

// Events
export type {
  ClaudeContentChunkEvent,
  ClaudeThinkingEventPayload,
  ClaudeToolEventPayload,
  ClaudePermissionRequestEvent,
  ClaudePermissionResponseEvent,
  ClaudeSessionInitEvent,
  ClaudeSessionEndEvent,
  ClaudeHealthUpdateEvent,
  ClaudeErrorEvent,
} from './events/claude-domain.events';

// NOTE: DI registration is now centralized in apps/ptah-extension-vscode/src/di/container.ts
// No longer exporting register functions from libraries
