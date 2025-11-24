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
} from '@ptah-extension/workspace-intelligence';

// Import VS Code Language Model Tools
import {
  AnalyzeWorkspaceTool,
  SearchFilesTool,
  GetRelevantFilesTool,
  GetDiagnosticsTool,
  FindSymbolTool,
  GetGitStatusTool,
  LMToolsRegistrationService,
  PtahAPIBuilder,
  CodeExecutionMCP,
} from '@ptah-extension/vscode-lm-tools';

// Import ai-providers-core services
import {
  IntelligentProviderStrategy,
  ProviderManager,
  ContextManager,
  ClaudeCliAdapter,
  VsCodeLmAdapter,
} from '@ptah-extension/ai-providers-core';

// Import claude-domain services
import {
  ClaudeCliDetector,
  ProcessManager,
  ClaudeDomainEventPublisher,
  PermissionService,
  ClaudeCliService,
  MCPRegistrationService,
  InMemoryPermissionRulesStore,
  SessionManager,
} from '@ptah-extension/claude-domain';

// Import main app services
import { AnalyticsDataCollector } from '../services/analytics-data-collector';
import { CommandBuilderService } from '../services/command-builder.service';
import { WebviewEventQueue } from '../services/webview-event-queue';
import { WebviewInitialDataBuilder } from '../services/webview-initial-data-builder';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';
import { ConfigurationProviderAdapter } from '../adapters/configuration-provider.adapter';
import { ContextMessageBridgeService } from '../services/context-message-bridge.service';

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

    // Configuration Provider Adapter (depends on ConfigManager)
    container.register(TOKENS.CONFIGURATION_PROVIDER, {
      useFactory: (c) => {
        const configManager = c.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);
        return new ConfigurationProviderAdapter(configManager);
      },
    });

    // API Wrappers
    container.registerSingleton(TOKENS.COMMAND_MANAGER, CommandManager);
    container.registerSingleton(TOKENS.WEBVIEW_MANAGER, WebviewManager);
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
    container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

    // RPC Handler (Phase 2 - TASK_2025_021)
    container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);

    // Extension Context (value registration)
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

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

    // ========================================
    // PHASE 2.5: VS Code Language Model Tools
    // ========================================
    // These tools expose workspace-intelligence to GitHub Copilot and other LLMs

    // Register individual tools
    container.registerSingleton(
      TOKENS.ANALYZE_WORKSPACE_TOOL,
      AnalyzeWorkspaceTool
    );
    container.registerSingleton(TOKENS.SEARCH_FILES_TOOL, SearchFilesTool);
    container.registerSingleton(
      TOKENS.GET_RELEVANT_FILES_TOOL,
      GetRelevantFilesTool
    );
    container.registerSingleton(
      TOKENS.GET_DIAGNOSTICS_TOOL,
      GetDiagnosticsTool
    );
    container.registerSingleton(TOKENS.FIND_SYMBOL_TOOL, FindSymbolTool);
    container.registerSingleton(TOKENS.GET_GIT_STATUS_TOOL, GetGitStatusTool);

    // Register the tools registration service
    container.registerSingleton(
      TOKENS.LM_TOOLS_REGISTRATION_SERVICE,
      LMToolsRegistrationService
    );

    // Code Execution MCP services
    container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);
    container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);

    // ========================================
    // PHASE 3: AI Providers Core Services
    // ========================================

    // Strategy (no dependencies)
    container.registerSingleton(
      TOKENS.INTELLIGENT_PROVIDER_STRATEGY,
      IntelligentProviderStrategy
    );

    // Context Manager (no dependencies)
    container.registerSingleton(TOKENS.CONTEXT_MANAGER, ContextManager);

    // Provider Manager (depends on EventBus and Strategy)
    // CRITICAL: Must be singleton to ensure all code uses the SAME instance
    // Otherwise providers registered in one instance won't be visible to other instances!
    container.registerSingleton(TOKENS.PROVIDER_MANAGER, ProviderManager);

    // Provider adapters
    container.registerSingleton(TOKENS.CLAUDE_CLI_ADAPTER, ClaudeCliAdapter);
    container.registerSingleton(TOKENS.VSCODE_LM_ADAPTER, VsCodeLmAdapter);

    // ========================================
    // PHASE 4: Claude Domain Services
    // ========================================

    // Permission store (special string token for interface)
    const permissionStore = new InMemoryPermissionRulesStore();
    container.register('IPermissionRulesStore', { useValue: permissionStore });

    // Storage adapter (from VS Code workspace state)
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        return context.workspaceState.get<T>(key, defaultValue);
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
    container.registerSingleton(
      TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER,
      ClaudeDomainEventPublisher
    );
    container.registerSingleton(TOKENS.PERMISSION_SERVICE, PermissionService);
    container.registerSingleton(TOKENS.CLAUDE_CLI_SERVICE, ClaudeCliService);
    container.registerSingleton(
      TOKENS.MCP_REGISTRATION_SERVICE,
      MCPRegistrationService
    );

    // Session management (restored for RPC - TASK_2025_021)
    container.registerSingleton(TOKENS.SESSION_MANAGER, SessionManager);

    // ========================================
    // PHASE 5: Main App Services
    // ========================================

    // Webview support services (Priority 2 extraction)
    container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);
    container.registerSingleton(
      TOKENS.WEBVIEW_INITIAL_DATA_BUILDER,
      WebviewInitialDataBuilder
    );

    // Main app services
    container.registerSingleton(
      TOKENS.COMMAND_BUILDER_SERVICE,
      CommandBuilderService
    );
    container.registerSingleton(
      TOKENS.ANALYTICS_DATA_COLLECTOR,
      AnalyticsDataCollector
    );
    container.registerSingleton(
      TOKENS.ANGULAR_WEBVIEW_PROVIDER,
      AngularWebviewProvider
    );

    // Context Message Bridge (architectural bridge for file include/exclude)
    container.registerSingleton(ContextMessageBridgeService);

    // Adapters (registered later in main.ts after PtahExtension initialization)
    // These require the extension to be partially initialized first
    // - CONFIGURATION_PROVIDER (uses ConfigManager)
    // - ANALYTICS_DATA_COLLECTOR (uses AnalyticsDataCollector from PtahExtension)

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
