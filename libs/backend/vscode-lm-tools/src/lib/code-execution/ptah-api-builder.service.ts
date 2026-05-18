/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 15 namespaces for code execution context.
 * Delegates to specialized namespace builders for each domain:
 *
 * Core (workspace discovery):
 * - workspace: analysis, project type, frameworks detection
 * - search: file search and relevance
 * - diagnostics: errors, warnings, all diagnostics
 *
 * System (VS Code integration):
 * - files: read, list operations
 *
 * Analysis (workspace intelligence):
 * - context: token budget management and optimization
 * - project: monorepo detection, dependencies
 * - relevance: file scoring with explanations
 *
 * AST (code structure):
 * - ast: tree-sitter based code analysis
 */

import * as os from 'os';
import * as path from 'path';
import { injectable, inject, container } from 'tsyringe';
import { TOKENS, Logger, FileSystemManager } from '@ptah-extension/vscode-core';
import type { WebviewManager } from '@ptah-extension/vscode-core';
import type {
  IMemoryReader,
  IMemoryLister,
} from '@ptah-extension/memory-contracts';
import type { CodeSymbolIndexer } from '@ptah-extension/workspace-intelligence';
import { CODE_SYMBOL_INDEXER as CODE_SYMBOL_INDEXER_TOKEN } from '@ptah-extension/workspace-intelligence';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDiagnosticsProvider,
  ISecretStorage,
  IMemoryWriter,
} from '@ptah-extension/platform-core';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  TreeSitterParserService,
  AstAnalysisService,
  ContextEnrichmentService,
  DependencyGraphService,
} from '@ptah-extension/workspace-intelligence';
import type { PtahAPI } from './types';
import { WebSearchService } from './services/web-search.service';
import {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  buildFilesNamespace,
  buildHelpMethod,
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  buildAstNamespace,
  buildIDENamespace,
  type IIDECapabilities,
  buildOrchestrationNamespace,
  buildAgentNamespace,
  buildGitNamespace,
  buildJsonNamespace,
  buildBrowserNamespace,
  type IBrowserCapabilities,
  buildSkillNamespace,
  buildMemoryNamespace,
  buildCodeNamespace,
} from './namespace-builders';
import {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/cli-agent-runtime';

/**
 * Duplicated from SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_SESSION_LIFECYCLE_MANAGER = Symbol.for('SdkSessionLifecycleManager');

/**
 * Duplicated from AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE to avoid taking
 * a hard dependency from vscode-lm-tools onto agent-generation. Must match the
 * Symbol.for() description in:
 * libs/backend/agent-generation/src/lib/di/tokens.ts
 *
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const ENHANCED_PROMPTS_SERVICE_TOKEN = Symbol.for('SdkEnhancedPromptsService');

/**
 * Duplicated from SDK_TOKENS.SDK_PTAH_CLI_REGISTRY to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_PTAH_CLI_REGISTRY in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_PTAH_CLI_REGISTRY = Symbol.for('SdkPtahCliRegistry');

/**
 * Duplicated from SDK_TOKENS.SDK_PLUGIN_LOADER to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_PLUGIN_LOADER in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_PLUGIN_LOADER = Symbol.for('SdkPluginLoader');

/**
 * Duplicated from MEMORY_TOKENS.MEMORY_SEARCH to avoid circular dependency
 * between vscode-lm-tools -> memory-curator. Must match the string in:
 * libs/backend/memory-curator/src/lib/di/tokens.ts
 *
 * @see MEMORY_TOKENS.MEMORY_SEARCH in libs/backend/memory-curator/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const MEMORY_SEARCH_TOKEN = Symbol.for('PtahMemorySearch');

/**
 * Duplicated from MEMORY_TOKENS.MEMORY_STORE to avoid circular dependency
 * between vscode-lm-tools -> memory-curator. Must match the string in:
 * libs/backend/memory-curator/src/lib/di/tokens.ts
 *
 * @see MEMORY_TOKENS.MEMORY_STORE in libs/backend/memory-curator/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const MEMORY_STORE_TOKEN = Symbol.for('PtahMemoryStore');

/**
 * Duplicated from PLATFORM_TOKENS.MEMORY_WRITER to avoid circular dependency
 * between vscode-lm-tools -> platform-core via DI resolution.
 * Must match: libs/backend/platform-core/src/di/tokens.ts
 *
 * @see PLATFORM_TOKENS.MEMORY_WRITER in libs/backend/platform-core/src/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const MEMORY_WRITER_TOKEN = Symbol.for('PlatformMemoryWriter');

/**
 * DI token for IDE capabilities (VS Code-specific).
 * In VS Code, VscodeIDECapabilities is registered under this token.
 * In Electron/standalone, this token is NOT registered, so buildIDENamespace()
 * receives undefined and returns graceful degradation stubs.
 *
 * @see VscodeIDECapabilities in namespace-builders/ide-capabilities.vscode.ts
 */
export const IDE_CAPABILITIES_TOKEN = Symbol.for('IDECapabilities');

/**
 * DI token for browser capabilities.
 * In Electron, ElectronBrowserCapabilities is registered under this token.
 * In VS Code, ChromeLauncherBrowserCapabilities is registered under this token.
 * When not registered, buildBrowserNamespace() returns graceful degradation stubs.
 *
 * @see ElectronBrowserCapabilities in apps/ptah-electron/src/services/electron-browser-capabilities.ts
 * @see ChromeLauncherBrowserCapabilities in services/chrome-launcher-browser-capabilities.ts
 */
export const BROWSER_CAPABILITIES_TOKEN = Symbol.for('BrowserCapabilities');

@injectable()
export class PtahAPIBuilder {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,

    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(TOKENS.FILE_SYSTEM_MANAGER)
    private readonly fileSystemManager: FileSystemManager,
    @inject(TOKENS.CONTEXT_SIZE_OPTIMIZER)
    private readonly contextOptimizer: ContextSizeOptimizerService,

    @inject(TOKENS.MONOREPO_DETECTOR_SERVICE)
    private readonly monorepoDetector: MonorepoDetectorService,

    @inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,

    @inject(TOKENS.FILE_RELEVANCE_SCORER)
    private readonly relevanceScorer: FileRelevanceScorerService,

    @inject(TOKENS.TOKEN_COUNTER_SERVICE)
    private readonly tokenCounter: TokenCounterService,

    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly workspaceIndexer: WorkspaceIndexerService,

    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(TOKENS.CONTEXT_ENRICHMENT_SERVICE)
    private readonly contextEnrichment: ContextEnrichmentService,

    @inject(TOKENS.DEPENDENCY_GRAPH_SERVICE)
    private readonly dependencyGraph: DependencyGraphService,
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,

    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,

    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetectionService: CliDetectionService,

    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,

    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystemProvider: IFileSystemProvider,

    @inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)
    private readonly diagnosticsProvider: IDiagnosticsProvider,

    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
  ) {
    this.logger.info('PtahAPIBuilder initialized with 15 namespaces');
  }

  /**
   * Build the complete Ptah API object with all 14 namespaces.
   *
   * Each namespace builder is wrapped in try/catch so that one failing
   * namespace does not prevent the remaining namespaces (and their tools)
   * from being available. A failed namespace is replaced with a proxy that
   * throws a descriptive error on any method call.
   */
  build(): PtahAPI {
    this.logger.debug('Building Ptah API with all namespaces');
    const coreDeps = {
      workspaceAnalyzer: this.workspaceAnalyzer,
      contextOrchestration: this.contextOrchestration,
    };

    const systemDeps = {
      fileSystemManager: this.fileSystemManager,
      workspaceProvider: this.workspaceProvider,
      fileSystemProvider: this.fileSystemProvider,
    };

    const analysisDeps = {
      contextOptimizer: this.contextOptimizer,
      monorepoDetector: this.monorepoDetector,
      dependencyAnalyzer: this.dependencyAnalyzer,
      relevanceScorer: this.relevanceScorer,
      tokenCounter: this.tokenCounter,
      workspaceIndexer: this.workspaceIndexer,
      projectDetector: this.projectDetector,
      workspaceAnalyzer: this.workspaceAnalyzer,
      contextEnrichment: this.contextEnrichment,
      dependencyGraph: this.dependencyGraph,
      workspaceProvider: this.workspaceProvider,
    };

    const astDeps = {
      treeSitterParser: this.treeSitterParser,
      astAnalysis: this.astAnalysis,
      fileSystemProvider: this.fileSystemProvider,
      workspaceProvider: this.workspaceProvider,
    };
    const getWorkspaceRootLazy = () => this.getWorkspaceRoot();
    const orchestrationDeps = {
      get workspaceRoot() {
        return getWorkspaceRootLazy();
      },
    };

    return {
      workspace: this.buildNamespaceSafe('workspace', () =>
        buildWorkspaceNamespace(coreDeps),
      ),
      search: this.buildNamespaceSafe('search', () =>
        buildSearchNamespace(coreDeps),
      ),
      diagnostics: this.buildNamespaceSafe('diagnostics', () =>
        buildDiagnosticsNamespace(this.diagnosticsProvider),
      ),
      files: this.buildNamespaceSafe('files', () =>
        buildFilesNamespace(systemDeps),
      ),
      context: this.buildNamespaceSafe('context', () =>
        buildContextNamespace(analysisDeps),
      ),
      project: this.buildNamespaceSafe('project', () =>
        buildProjectNamespace(analysisDeps),
      ),
      relevance: this.buildNamespaceSafe('relevance', () =>
        buildRelevanceNamespace(analysisDeps),
      ),
      dependencies: this.buildNamespaceSafe('dependencies', () =>
        buildDependencyNamespace(analysisDeps),
      ),
      ast: this.buildNamespaceSafe('ast', () => buildAstNamespace(astDeps)),
      ide: this.buildNamespaceSafe('ide', () =>
        buildIDENamespace(this.resolveIDECapabilities()),
      ),
      orchestration: this.buildNamespaceSafe('orchestration', () =>
        buildOrchestrationNamespace(orchestrationDeps),
      ),
      agent: this.buildNamespaceSafe('agent', () =>
        buildAgentNamespace({
          agentProcessManager: this.agentProcessManager,
          cliDetectionService: this.cliDetectionService,
          getWorkspaceRoot: () => this.getWorkspaceRoot(),
          getActiveSessionId: () => {
            if (!container.isRegistered(SDK_SESSION_LIFECYCLE_MANAGER)) {
              return undefined;
            }
            try {
              const manager = container.resolve<{
                getActiveSessionIds(): string[];
              }>(SDK_SESSION_LIFECYCLE_MANAGER);
              const ids = manager.getActiveSessionIds();
              return ids.length > 0 ? (ids[0] as string) : undefined;
            } catch {
              return undefined;
            }
          },
          resolveSessionId: (tabIdOrSessionId: string) => {
            if (!container.isRegistered(SDK_SESSION_LIFECYCLE_MANAGER)) {
              return tabIdOrSessionId;
            }
            try {
              const manager = container.resolve<{
                find(id: string): { realSessionId: string | null } | undefined;
              }>(SDK_SESSION_LIFECYCLE_MANAGER);
              const rec = manager.find(tabIdOrSessionId);
              return rec?.realSessionId ?? tabIdOrSessionId;
            } catch {
              return tabIdOrSessionId;
            }
          },
          getProjectGuidance: async () => {
            if (!container.isRegistered(ENHANCED_PROMPTS_SERVICE_TOKEN)) {
              return undefined;
            }
            try {
              const service = container.resolve<{
                getProjectGuidanceContent(
                  workspacePath: string,
                ): Promise<string | null>;
              }>(ENHANCED_PROMPTS_SERVICE_TOKEN);
              const workspacePath = this.getWorkspaceRoot();
              const content =
                await service.getProjectGuidanceContent(workspacePath);
              return content ?? undefined;
            } catch {
              return undefined;
            }
          },
          getSystemPrompt: async () => {
            if (!container.isRegistered(ENHANCED_PROMPTS_SERVICE_TOKEN)) {
              return undefined;
            }
            try {
              const service = container.resolve<{
                getEnhancedPromptContent(
                  workspacePath: string,
                ): Promise<string | null>;
              }>(ENHANCED_PROMPTS_SERVICE_TOKEN);
              const workspacePath = this.getWorkspaceRoot();
              const content =
                await service.getEnhancedPromptContent(workspacePath);
              return content ?? undefined;
            } catch {
              return undefined;
            }
          },
          getPluginPaths: async () => {
            if (!container.isRegistered(SDK_PLUGIN_LOADER)) {
              return undefined;
            }
            try {
              const pluginLoader = container.resolve<{
                getWorkspacePluginConfig(): {
                  enabledPluginIds: string[];
                };
                resolvePluginPaths(pluginIds: string[]): string[];
              }>(SDK_PLUGIN_LOADER);
              const config = pluginLoader.getWorkspacePluginConfig();
              if (
                !config.enabledPluginIds ||
                config.enabledPluginIds.length === 0
              ) {
                return undefined;
              }
              return pluginLoader.resolvePluginPaths(config.enabledPluginIds);
            } catch {
              return undefined;
            }
          },
          getPtahCliRegistry: () => {
            if (!container.isRegistered(SDK_PTAH_CLI_REGISTRY)) {
              return undefined;
            }
            try {
              return container.resolve<{
                listAgents(): Promise<
                  Array<{
                    id: string;
                    name: string;
                    providerName: string;
                    hasApiKey: boolean;
                    enabled: boolean;
                  }>
                >;
                spawnAgent(
                  id: string,
                  task: string,
                  options?: {
                    projectGuidance?: string;
                    workingDirectory?: string;
                  },
                ): Promise<
                  | {
                      handle: {
                        abort: AbortController;
                        done: Promise<number>;
                        onOutput: (cb: (data: string) => void) => void;
                      };
                      agentName: string;
                      setAgentId: (id: string) => void;
                    }
                  | {
                      status:
                        | 'not_found'
                        | 'disabled'
                        | 'no_api_key'
                        | 'unknown_provider';
                      message: string;
                    }
                >;
              }>(SDK_PTAH_CLI_REGISTRY);
            } catch {
              return undefined;
            }
          },
          getDisabledClis: () => {
            return (
              this.workspaceProvider.getConfiguration<string[]>(
                'ptah',
                'agentOrchestration.disabledClis',
                [],
              ) ?? []
            );
          },
          getPreferredAgentOrder: () => {
            return (
              this.workspaceProvider.getConfiguration<string[]>(
                'ptah.agentOrchestration',
                'preferredAgentOrder',
                [],
              ) ?? []
            );
          },
        }),
      ),
      git: this.buildNamespaceSafe('git', () =>
        buildGitNamespace({
          getWorkspaceRoot: getWorkspaceRootLazy,
          onWorktreeChanged: this.buildWorktreeChangeHandler(),
        }),
      ),
      json: this.buildNamespaceSafe('json', () =>
        buildJsonNamespace({
          fileSystemProvider: this.fileSystemProvider,
          workspaceProvider: this.workspaceProvider,
        }),
      ),
      browser: this.buildNamespaceSafe('browser', () =>
        buildBrowserNamespace({
          capabilities: this.resolveBrowserCapabilities(),
          getAllowLocalhost: () =>
            this.workspaceProvider.getConfiguration<boolean>(
              'ptah',
              'browser.allowLocalhost',
              false,
            ) ?? false,
        }),
      ),
      skill: this.buildNamespaceSafe('skill', () =>
        buildSkillNamespace({
          getSkillsRoot: () => path.join(os.homedir(), '.ptah', 'skills'),
        }),
      ),
      webSearch: this.buildNamespaceSafe(
        'webSearch',
        () =>
          new WebSearchService({
            secretStorage: this.secretStorage,
            workspaceProvider: this.workspaceProvider,
            logger: this.logger,
          }),
      ),
      memory: this.buildNamespaceSafe('memory', () =>
        buildMemoryNamespace({
          getMemorySearch: () => {
            try {
              return container.isRegistered(MEMORY_SEARCH_TOKEN)
                ? container.resolve<IMemoryReader>(MEMORY_SEARCH_TOKEN)
                : undefined;
            } catch {
              return undefined;
            }
          },
          getMemoryStore: () => {
            try {
              return container.isRegistered(MEMORY_STORE_TOKEN)
                ? container.resolve<IMemoryLister>(MEMORY_STORE_TOKEN)
                : undefined;
            } catch {
              return undefined;
            }
          },
          getMemoryWriter: () => {
            try {
              return container.isRegistered(MEMORY_WRITER_TOKEN)
                ? container.resolve<IMemoryWriter>(MEMORY_WRITER_TOKEN)
                : undefined;
            } catch {
              return undefined;
            }
          },
          getWorkspaceRoot: () => this.getWorkspaceRoot(),
        }),
      ),
      code: this.buildNamespaceSafe('code', () =>
        buildCodeNamespace({
          getMemorySearch: () => {
            try {
              return container.isRegistered(MEMORY_SEARCH_TOKEN)
                ? container.resolve<IMemoryReader>(MEMORY_SEARCH_TOKEN)
                : undefined;
            } catch {
              return undefined;
            }
          },
          getSymbolIndexer: () => {
            try {
              return container.isRegistered(CODE_SYMBOL_INDEXER_TOKEN)
                ? container.resolve<CodeSymbolIndexer>(
                    CODE_SYMBOL_INDEXER_TOKEN,
                  )
                : undefined;
            } catch {
              return undefined;
            }
          },
          getWorkspaceRoot: () => this.getWorkspaceRoot(),
        }),
      ),
      help: buildHelpMethod(),
    };
  }

  /**
   * Safely build a namespace, catching any errors during construction.
   *
   * If a namespace builder throws (e.g., missing dependency, initialization error),
   * the failure is logged and a proxy is returned that throws descriptive errors
   * when any method is called. This prevents one broken namespace from killing
   * all 16 MCP tools.
   *
   * @param name - Namespace name for logging (e.g., 'workspace', 'ide')
   * @param builder - Factory function that builds the namespace
   * @returns The built namespace, or a proxy that throws on access
   */
  private buildNamespaceSafe<T extends object>(
    name: string,
    builder: () => T,
  ): T {
    try {
      return builder();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[PtahAPIBuilder] Failed to build '${name}' namespace: ${errorMessage}. ` +
          `Methods on ptah.${name} will return errors.`,
        'PtahAPIBuilder',
      );
      return new Proxy({} as T, {
        get: (_target, prop) => {
          if (typeof prop === 'symbol') return undefined;
          return (..._args: unknown[]) => {
            throw new Error(
              `ptah.${name}.${String(prop)}() is unavailable: the '${name}' namespace ` +
                `failed to initialize (${errorMessage}). Other ptah namespaces are still available.`,
            );
          };
        },
      });
    }
  }

  /**
   * Get workspace root, preferring the active SDK session's projectPath.
   *
   * Resolution order:
   * 1. Active session's projectPath (per-session accuracy for multi-workspace)
   * 2. IWorkspaceProvider.getWorkspaceRoot() (platform-level: active editor folder or Electron active folder)
   * 3. Empty string (never process.cwd() — that's the app installation directory)
   *
   * This ensures MCP tools (ptah_agent_spawn, git worktrees, orchestration) operate
   * in the correct project directory even when multiple workspaces are open in Electron
   * or multiple sessions target different workspace folders.
   */
  private getWorkspaceRoot(): string {
    try {
      if (container.isRegistered(SDK_SESSION_LIFECYCLE_MANAGER)) {
        const manager = container.resolve<{
          getActiveSessionWorkspace(): string | undefined;
        }>(SDK_SESSION_LIFECYCLE_MANAGER);
        const sessionWorkspace = manager.getActiveSessionWorkspace();
        if (sessionWorkspace) {
          return sessionWorkspace;
        }
      }
    } catch {
    }
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      return workspaceRoot;
    }
    return os.homedir();
  }

  /**
   * Build a worktree change handler that broadcasts git:worktreeChanged
   * to the frontend via WebviewManager when MCP tools create/remove worktrees.
   *
   * WebviewManager is resolved lazily on each invocation (not at build time)
   * to handle cases where the manager is registered after PtahAPIBuilder.build().
   */
  private buildWorktreeChangeHandler(): (event: {
    action: 'created' | 'removed';
    worktreePath?: string;
    branch?: string;
  }) => void {
    const logger = this.logger;

    return (event) => {
      if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
        logger.debug(
          '[PtahAPIBuilder] WebviewManager not registered, skipping worktree notification',
        );
        return;
      }

      let webviewManager: WebviewManager;
      try {
        webviewManager = container.resolve<WebviewManager>(
          TOKENS.WEBVIEW_MANAGER,
        );
      } catch {
        return;
      }

      logger.info(
        `[PtahAPIBuilder] MCP worktree ${event.action}: ${event.worktreePath ?? event.branch}`,
      );
      webviewManager
        .broadcastMessage('git:worktreeChanged', {
          action: event.action,
          name: event.branch,
          path: event.worktreePath,
        })
        .catch((error) => {
          logger.error(
            '[PtahAPIBuilder] Failed to send git:worktreeChanged',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    };
  }

  /**
   * Lazily resolve IDE capabilities from DI container.
   *
   * In VS Code, VscodeIDECapabilities is registered under IDE_CAPABILITIES_TOKEN.
   * In Electron/standalone, the token is NOT registered, so this returns undefined
   * and buildIDENamespace() uses graceful degradation stubs instead.
   *
   * Follows the same pattern as SDK_SESSION_LIFECYCLE_MANAGER lazy resolution.
   */
  private resolveIDECapabilities(): IIDECapabilities | undefined {
    if (!container.isRegistered(IDE_CAPABILITIES_TOKEN)) {
      return undefined;
    }
    try {
      return container.resolve<IIDECapabilities>(IDE_CAPABILITIES_TOKEN);
    } catch {
      return undefined;
    }
  }

  /**
   * Lazily resolve browser capabilities from DI container.
   *
   * In Electron, ElectronBrowserCapabilities is registered under BROWSER_CAPABILITIES_TOKEN.
   * In VS Code, ChromeLauncherBrowserCapabilities is registered under BROWSER_CAPABILITIES_TOKEN.
   * When not registered, returns undefined and buildBrowserNamespace() uses graceful degradation.
   *
   * Follows the same pattern as IDE_CAPABILITIES_TOKEN lazy resolution.
   */
  private resolveBrowserCapabilities(): IBrowserCapabilities | undefined {
    if (!container.isRegistered(BROWSER_CAPABILITIES_TOKEN)) {
      return undefined;
    }
    try {
      return container.resolve<IBrowserCapabilities>(
        BROWSER_CAPABILITIES_TOKEN,
      );
    } catch {
      return undefined;
    }
  }
}
