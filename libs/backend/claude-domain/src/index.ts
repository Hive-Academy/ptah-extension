/**
 * Claude Domain - Claude CLI integration library
 * TASK_2025_023: Purged broken CLI management systems
 * Keeping only essential components for rebuild
 */

// Detector - KEEP
export { ClaudeCliDetector } from './detector/claude-cli-detector';
export type { ClaudeInstallation } from './detector/claude-cli-detector';
export { ClaudeCliPathResolver } from './detector/claude-cli-path-resolver';
export type { ResolvedClaudeCliPath } from './detector/claude-cli-path-resolver';

// Session Parser - KEEP (parses .jsonl files)
export { JsonlSessionParser } from './session/jsonl-session-parser';

// CLI Services - KEEP (will simplify)
export { ClaudeCliService } from './cli/claude-cli.service';
export { ClaudeCliLauncher } from './cli/claude-cli-launcher';
export type { LauncherDependencies } from './cli/claude-cli-launcher';
export { ProcessManager } from './cli/process-manager';
export type { ProcessMetadata } from './cli/process-manager';
export { MCPRegistrationService } from './cli/mcp-registration.service';

// ClaudeProcess - NEW (Batch 4 - TASK_2025_023)
export { ClaudeProcess } from './cli/claude-process';
export type { ClaudeProcessOptions } from './cli/claude-process';

// Permissions - KEEP
export { PermissionService } from './permissions/permission-service';
export type { PermissionServiceConfig } from './permissions/permission-service';
export {
  InMemoryPermissionRulesStore,
  type IPermissionRulesStore,
} from './permissions/permission-rules.store';

// Events - KEEP
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

// ============================================================
// PURGED (TASK_2025_023):
// - SessionManager (in-memory duplication)
// - InteractiveSessionManager (complex state machine)
// - SessionProcess (message queue, backpressure)
// - MessageQueue (unnecessary complexity)
// - JSONLStreamParser (will simplify inline)
// ============================================================
