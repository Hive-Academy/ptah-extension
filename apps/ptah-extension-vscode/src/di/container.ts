/**
 * Centralized Dependency Injection Container
 *
 * SINGLE SOURCE OF TRUTH for all service registrations.
 * All services from all libraries are registered here in the correct order.
 *
 * Benefits of centralized registration:
 * - Clear registration order (prevents webpack bundling issues)
 * - No hidden re-registrations (prevents EventBus overwrite bug)
 * - Single place to debug DI issues
 * - Explicit control over service lifecycle
 * - Better for monorepo single-application architecture
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

// Import TOKENS (single source of truth)
import { TOKENS } from '@ptah-extension/vscode-core';

// Import vscode-core services
import {
  Logger,
  ErrorHandler,
  ConfigManager,
  MessageValidatorService,
  CommandManager,
  WebviewManager,
  OutputManager,
  StatusBarManager,
  FileSystemManager,
  RpcHandler,
  RpcMethodRegistrationService,
  SessionDiscoveryService,
  AgentSessionWatcherService,
} from '@ptah-extension/vscode-core';

// Import workspace-intelligence services
import {
  PatternMatcherService,
  IgnorePatternResolverService,
  FileTypeClassifierService,
  WorkspaceIndexerService,
  WorkspaceAnalyzerService,
  WorkspaceService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FrameworkDetectorService,
  ProjectDetectorService,
  ContextService,
  FileSystemService,
  TokenCounterService,
  FileRelevanceScorerService,
  ContextSizeOptimizerService,
  ContextOrchestrationService,
  TreeSitterParserService,
  AstAnalysisService,
  AgentDiscoveryService,
  CommandDiscoveryService,
} from '@ptah-extension/workspace-intelligence';

// Import Code Execution MCP services (TASK_2025_025)
// DELETED: AnalyzeWorkspaceTool, SearchFilesTool, GetRelevantFilesTool,
// GetDiagnosticsTool, FindSymbolTool, GetGitStatusTool, LMToolsRegistrationService
// (These languageModelTools only worked with Copilot, not Claude CLI)
import {
  PtahAPIBuilder,
  CodeExecutionMCP,
  PermissionPromptService,
} from '@ptah-extension/vscode-lm-tools';

// Import claude-domain services
import {
  ClaudeCliDetector,
  ProcessManager,
  ClaudeCliService,
  MCPConfigManagerService,
  ClaudeProcess,
  // DELETED in TASK_2025_023 purge: SessionManager, InteractiveSessionManager, ClaudeCliLauncher
  // DELETED: PermissionService, InMemoryPermissionRulesStore (over-engineered, unused)
  // DELETED in TASK_2025_025: MCPRegistrationService (replaced by MCPConfigManagerService)
} from '@ptah-extension/claude-domain';

// Import webview support services
import { WebviewEventQueue } from '../services/webview-event-queue';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';

/**
 * Centralized DI Container
 * Registers ALL services for the entire application
 */
export class DIContainer {
  /**
   * Setup and register all services
   * @param context - VS Code extension context
   * @returns Configured DependencyContainer
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // ========================================
    // PHASE 0: Extension Context (MUST BE FIRST)
    // ========================================
    // Extension Context must be registered BEFORE any services that depend on it
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // ========================================
    // PHASE 1: Infrastructure Services (vscode-core)
    // ========================================
    // These must be registered FIRST as they're dependencies for everything else

    // Core infrastructure
    container.registerSingleton(TOKENS.LOGGER, Logger);
    container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
    container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
    container.registerSingleton(
      TOKENS.MESSAGE_VALIDATOR,
      MessageValidatorService
    );

    // NOTE: CONFIGURATION_PROVIDER token removed - orchestration services deleted in RPC Phase 3.5
    // Configuration now accessed directly via ConfigManager

    // API Wrappers
    container.registerSingleton(TOKENS.COMMAND_MANAGER, CommandManager);
    container.registerSingleton(TOKENS.WEBVIEW_MANAGER, WebviewManager);
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
    container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

    // RPC Handler (Phase 2 - TASK_2025_021)
    container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);

    // RPC Method Registration Service (Phase 2 - Clean separation)
    container.registerSingleton(
      TOKENS.RPC_METHOD_REGISTRATION_SERVICE,
      RpcMethodRegistrationService
    );

    // Session Discovery Service (extracted from RpcMethodRegistrationService)
    container.registerSingleton(
      TOKENS.SESSION_DISCOVERY_SERVICE,
      SessionDiscoveryService
    );

    // Agent Session Watcher (real-time summary streaming during agent execution)
    container.registerSingleton(
      TOKENS.AGENT_SESSION_WATCHER_SERVICE,
      AgentSessionWatcherService
    );

    // ClaudeProcess factory (Batch 4 - TASK_2025_023)
    container.register('ClaudeProcessFactory', {
      useValue: (cliPath: string, workspacePath: string) =>
        new ClaudeProcess(cliPath, workspacePath),
    });

    // ========================================
    // PHASE 2: Workspace Intelligence Services
    // ========================================

    // Base services (no dependencies)
    container.registerSingleton(
      TOKENS.PATTERN_MATCHER_SERVICE,
      PatternMatcherService
    );
    container.registerSingleton(
      TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE,
      IgnorePatternResolverService
    );
    container.registerSingleton(
      TOKENS.FILE_TYPE_CLASSIFIER_SERVICE,
      FileTypeClassifierService
    );
    container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
    container.registerSingleton(
      TOKENS.TOKEN_COUNTER_SERVICE,
      TokenCounterService
    );

    // Project detection services
    container.registerSingleton(
      TOKENS.MONOREPO_DETECTOR_SERVICE,
      MonorepoDetectorService
    );
    container.registerSingleton(
      TOKENS.DEPENDENCY_ANALYZER_SERVICE,
      DependencyAnalyzerService
    );
    container.registerSingleton(
      TOKENS.FRAMEWORK_DETECTOR_SERVICE,
      FrameworkDetectorService
    );
    container.registerSingleton(
      TOKENS.PROJECT_DETECTOR_SERVICE,
      ProjectDetectorService
    );

    // Indexing services (depend on base services)
    container.registerSingleton(
      TOKENS.WORKSPACE_INDEXER_SERVICE,
      WorkspaceIndexerService
    );

    // Analysis services (depend on indexing)
    container.registerSingleton(
      TOKENS.WORKSPACE_ANALYZER_SERVICE,
      WorkspaceAnalyzerService
    );
    container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);

    // Context services
    container.registerSingleton(TOKENS.CONTEXT_SERVICE, ContextService);
    container.registerSingleton(
      TOKENS.FILE_RELEVANCE_SCORER,
      FileRelevanceScorerService
    );
    container.registerSingleton(
      TOKENS.CONTEXT_SIZE_OPTIMIZER,
      ContextSizeOptimizerService
    );
    container.registerSingleton(
      TOKENS.CONTEXT_ORCHESTRATION_SERVICE,
      ContextOrchestrationService
    );

    // AST services (Phase 2: RooCode migration)
    container.registerSingleton(
      TOKENS.TREE_SITTER_PARSER_SERVICE,
      TreeSitterParserService
    );
    container.registerSingleton(
      TOKENS.AST_ANALYSIS_SERVICE,
      AstAnalysisService
    );

    // Autocomplete discovery services (TASK_2025_019)
    container.registerSingleton(
      TOKENS.AGENT_DISCOVERY_SERVICE,
      AgentDiscoveryService
    );
    container.registerSingleton(
      TOKENS.COMMAND_DISCOVERY_SERVICE,
      CommandDiscoveryService
    );

    // ========================================
    // PHASE 2.5: Code Execution MCP (TASK_2025_025)
    // ========================================
    // DELETED: Individual languageModelTools registrations (only worked with Copilot)
    // DELETED: ANALYZE_WORKSPACE_TOOL, SEARCH_FILES_TOOL, GET_RELEVANT_FILES_TOOL,
    // GET_DIAGNOSTICS_TOOL, FIND_SYMBOL_TOOL, GET_GIT_STATUS_TOOL, LM_TOOLS_REGISTRATION_SERVICE

    // Code Execution MCP services (expose workspace-intelligence to Claude CLI)
    container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);
    container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);

    // Permission Prompt Service (TASK_2025_026)
    container.registerSingleton(
      TOKENS.PERMISSION_PROMPT_SERVICE,
      PermissionPromptService
    );

    // ========================================
    // PHASE 3: Claude Domain Services
    // ========================================

    // Storage adapter (from VS Code workspace state)
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const value = context.workspaceState.get<T>(key);
        // Fix: Handle undefined properly before passing to get()
        return value !== undefined ? value : defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await context.workspaceState.update(key, value);
      },
    };
    container.register(TOKENS.STORAGE_SERVICE, { useValue: storageAdapter });

    // NOTE: CONFIGURATION_PROVIDER is NOW registered during Phase 1 (line 121)
    // It was moved from main.ts to fix dependency injection order issues.

    // Core domain services
    container.registerSingleton(TOKENS.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
    container.registerSingleton(TOKENS.PROCESS_MANAGER, ProcessManager);
    container.registerSingleton(TOKENS.CLAUDE_CLI_SERVICE, ClaudeCliService);
    container.registerSingleton(
      TOKENS.MCP_CONFIG_MANAGER_SERVICE,
      MCPConfigManagerService
    );

    // Session management - DELETED in TASK_2025_023 purge + cleanup
    // SessionManager, InteractiveSessionManager, ClaudeCliLauncher removed
    // New pattern: ClaudeProcess handles sessions directly via CLI --session-id flag
    // Process lifecycle: ProcessManager tracks active processes by SessionId

    // ========================================
    // PHASE 4: Main App Services
    // ========================================

    // Webview support services (restored - still needed for webview lifecycle)
    container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);
    container.registerSingleton(
      TOKENS.ANGULAR_WEBVIEW_PROVIDER,
      AngularWebviewProvider
    );

    // NOTE: WebviewHtmlGenerator is not registered in DI (instantiated directly in AngularWebviewProvider)
    // NOTE: Orchestration services and CONFIGURATION_PROVIDER removed in RPC Phase 3.5

    return container;
  }

  /**
   * Get the global container instance
   */
  static getContainer(): DependencyContainer {
    return container;
  }

  /**
   * Resolve a service by its token
   */
  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  /**
   * Check if a service is registered
   */
  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }

  /**
   * Clear all instances (for testing)
   */
  static clear(): void {
    container.clearInstances();
  }
}

// Re-export container for backward compatibility
export { container };
