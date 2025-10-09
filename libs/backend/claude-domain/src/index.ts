/**
 * Claude Domain - Claude CLI integration library
 * Exports all public APIs for use by extension and ai-providers-core
 */

// Detector
export { ClaudeCliDetector } from './detector/claude-cli-detector';
export type { ClaudeInstallation } from './detector/claude-cli-detector';

// Session Management
export { SessionManager } from './session/session-manager';
export type { SessionMetadata } from './session/session-manager';

// CLI Launcher & Process Management
export { ClaudeCliLauncher } from './cli/claude-cli-launcher';
export type { LauncherDependencies } from './cli/claude-cli-launcher';
export { ProcessManager } from './cli/process-manager';
export type { ProcessMetadata } from './cli/process-manager';

// JSONL Parsing
export { JSONLStreamParser } from './cli/jsonl-stream-parser';
export type {
  JSONLParserCallbacks,
  JSONLMessage,
  JSONLSystemMessage,
  JSONLAssistantMessage,
  JSONLToolMessage,
  JSONLPermissionMessage,
  ParsedEvent,
} from './cli/jsonl-stream-parser';

// Permissions
export { PermissionService } from './permissions/permission-service';
export type { PermissionServiceConfig } from './permissions/permission-service';
export {
  InMemoryPermissionRulesStore,
  type IPermissionRulesStore,
} from './permissions/permission-rules.store';

// Events
export {
  ClaudeDomainEventPublisher,
  CLAUDE_DOMAIN_EVENTS,
  type IEventBus,
} from './events/claude-domain.events';
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
