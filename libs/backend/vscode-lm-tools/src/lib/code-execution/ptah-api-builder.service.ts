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
 *
 * TASK_2025_025: Expanded from 8 to 13 namespaces for better Claude discoverability
 * TASK_2025_240: Added json namespace (14 total)
 * TASK_2025_244: Added browser namespace (15 total)
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS, Logger, FileSystemManager } from '@ptah-extension/vscode-core';
import type { WebviewManager } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDiagnosticsProvider,
  ISecretStorage,
} from '@ptah-extension/platform-core';
import { MESSAGE_TYPES, type PermissionResponse } from '@ptah-extension/shared';
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
import type { PtahAPI, BrowserWaitForUserResult } from './types';
import type { PermissionPromptService } from '../permission/permission-prompt.service';
import { WebSearchService } from './services/web-search.service';
import {
  // Core namespace builders
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  // System namespace builders
  buildFilesNamespace,
  buildHelpMethod,
  // Analysis namespace builders
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  // AST namespace builder
  buildAstNamespace,
  // IDE namespace builder (TASK_2025_039, decoupled TASK_2025_226)
  buildIDENamespace,
  type IIDECapabilities,
  // Orchestration namespace builder (TASK_2025_111)
  buildOrchestrationNamespace,
  // Agent namespace builder (TASK_2025_157)
  buildAgentNamespace,
  // Git namespace builder (TASK_2025_236)
  buildGitNamespace,
  // JSON namespace builder (TASK_2025_240)
  buildJsonNamespace,
  // Browser namespace builder (TASK_2025_244)
  buildBrowserNamespace,
  type IBrowserCapabilities,
} from './namespace-builders';
import {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/llm-abstraction';

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
 * Duplicated from SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');

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
 * DI token for IDE capabilities (VS Code-specific).
 * In VS Code, VscodeIDECapabilities is registered under this token.
 * In Electron/standalone, this token is NOT registered, so buildIDENamespace()
 * receives undefined and returns graceful degradation stubs.
 *
 * @see VscodeIDECapabilities in namespace-builders/ide-capabilities.vscode.ts
 */
export const IDE_CAPABILITIES_TOKEN = Symbol.for('IDECapabilities');

/**
 * DI token for browser capabilities (TASK_2025_244).
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

    // Analysis services
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

    // Context enrichment & dependency graph (TASK_2025_182)
    @inject(TOKENS.CONTEXT_ENRICHMENT_SERVICE)
    private readonly contextEnrichment: ContextEnrichmentService,

    @inject(TOKENS.DEPENDENCY_GRAPH_SERVICE)
    private readonly dependencyGraph: DependencyGraphService,

    // AST services
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,

    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,

    // Agent orchestration services (TASK_2025_157)
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

    // Prepare dependency objects for namespace builders
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

    // Get workspace root for orchestration namespace
    const workspaceRoot = this.getWorkspaceRoot();
    const orchestrationDeps = {
      workspaceRoot,
    };

    return {
      // Core namespaces (workspace discovery)
      workspace: this.buildNamespaceSafe('workspace', () =>
        buildWorkspaceNamespace(coreDeps),
      ),
      search: this.buildNamespaceSafe('search', () =>
        buildSearchNamespace(coreDeps),
      ),
      diagnostics: this.buildNamespaceSafe('diagnostics', () =>
        buildDiagnosticsNamespace(this.diagnosticsProvider),
      ),

      // System namespaces (VS Code integration)
      files: this.buildNamespaceSafe('files', () =>
        buildFilesNamespace(systemDeps),
      ),

      // Analysis namespaces (workspace intelligence)
      context: this.buildNamespaceSafe('context', () =>
        buildContextNamespace(analysisDeps),
      ),
      project: this.buildNamespaceSafe('project', () =>
        buildProjectNamespace(analysisDeps),
      ),
      relevance: this.buildNamespaceSafe('relevance', () =>
        buildRelevanceNamespace(analysisDeps),
      ),

      // Dependencies namespace (TASK_2025_182 - import-based dependency graph)
      dependencies: this.buildNamespaceSafe('dependencies', () =>
        buildDependencyNamespace(analysisDeps),
      ),

      // AST namespace (code structure)
      ast: this.buildNamespaceSafe('ast', () => buildAstNamespace(astDeps)),

      // IDE namespace (TASK_2025_039 - LSP, editor, actions, testing)
      // Resolved lazily: if IDE_CAPABILITIES_TOKEN is not registered (Electron/standalone),
      // buildIDENamespace receives undefined and returns graceful degradation stubs.
      ide: this.buildNamespaceSafe('ide', () =>
        buildIDENamespace(this.resolveIDECapabilities()),
      ),

      // Orchestration namespace (TASK_2025_111 - workflow state management)
      orchestration: this.buildNamespaceSafe('orchestration', () =>
        buildOrchestrationNamespace(orchestrationDeps),
      ),

      // Agent orchestration namespace (TASK_2025_157, session linking TASK_2025_161)
      agent: this.buildNamespaceSafe('agent', () =>
        buildAgentNamespace({
          agentProcessManager: this.agentProcessManager,
          cliDetectionService: this.cliDetectionService,
          workspaceRoot,
          getActiveSessionId: () => {
            // SessionLifecycleManager.getActiveSessionIds() returns all active sessions.
            // In single-session mode (current), there's at most one.
            // Resolved lazily: if SDK_SESSION_LIFECYCLE_MANAGER token is unregistered, returns undefined
            // instead of crashing the MCP server during DI resolution.
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
          getProjectGuidance: async () => {
            // Resolve EnhancedPromptsService lazily via DI (same pattern as SDK_SESSION_LIFECYCLE_MANAGER).
            // Avoids hard dependency from vscode-lm-tools -> agent-sdk.
            if (!container.isRegistered(SDK_ENHANCED_PROMPTS_SERVICE)) {
              return undefined;
            }
            try {
              const service = container.resolve<{
                getProjectGuidanceContent(
                  workspacePath: string,
                ): Promise<string | null>;
              }>(SDK_ENHANCED_PROMPTS_SERVICE);
              const workspacePath = this.getWorkspaceRoot();
              const content =
                await service.getProjectGuidanceContent(workspacePath);
              return content ?? undefined;
            } catch {
              return undefined;
            }
          },
          getSystemPrompt: async () => {
            // Resolve EnhancedPromptsService lazily for the full enhanced prompt content.
            // Returns the full enhanced prompts (project guidance + framework guidelines +
            // coding standards + architecture notes) for use as CLI agent system prompt.
            if (!container.isRegistered(SDK_ENHANCED_PROMPTS_SERVICE)) {
              return undefined;
            }
            try {
              const service = container.resolve<{
                getEnhancedPromptContent(
                  workspacePath: string,
                ): Promise<string | null>;
              }>(SDK_ENHANCED_PROMPTS_SERVICE);
              const workspacePath = this.getWorkspaceRoot();
              const content =
                await service.getEnhancedPromptContent(workspacePath);
              return content ?? undefined;
            } catch {
              return undefined;
            }
          },
          getPluginPaths: async () => {
            // Resolve PluginLoaderService lazily to get enabled plugin paths (premium-gated).
            // Skills are synced to CLI directories by CliPluginSyncService on activation.
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
            // Resolve PtahCliRegistry lazily via DI (same pattern as SDK_SESSION_LIFECYCLE_MANAGER).
            // Avoids hard dependency from vscode-lm-tools -> agent-sdk.
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
                'ptah.agentOrchestration',
                'disabledClis',
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

      // Git worktree namespace (TASK_2025_236)
      // Wires onWorktreeChanged callback to broadcast git:worktreeChanged
      // to the frontend when MCP tools create/remove worktrees.
      git: this.buildNamespaceSafe('git', () =>
        buildGitNamespace({
          workspaceRoot,
          onWorktreeChanged: this.buildWorktreeChangeHandler(),
        }),
      ),

      // JSON validation namespace (TASK_2025_240)
      json: this.buildNamespaceSafe('json', () =>
        buildJsonNamespace({
          fileSystemProvider: this.fileSystemProvider,
          workspaceProvider: this.workspaceProvider,
        }),
      ),

      // Browser automation namespace (TASK_2025_244)
      // Resolved lazily: if BROWSER_CAPABILITIES_TOKEN is not registered,
      // buildBrowserNamespace receives undefined capabilities and returns graceful degradation stubs.
      // Headless/viewport are agent-controlled via ptah_browser_navigate params (not settings).
      browser: this.buildNamespaceSafe('browser', () =>
        buildBrowserNamespace({
          capabilities: this.resolveBrowserCapabilities(),
          getAllowLocalhost: () =>
            this.workspaceProvider.getConfiguration<boolean>(
              'ptah.browser',
              'allowLocalhost',
              false,
            ) ?? false,
          // Note: recordingDir is configured via capabilities constructor, not namespace deps
          // Wait-for-user handler (VS Code only, undefined in Electron)
          waitForUser: this.buildWaitForUserHandler(),
        }),
      ),

      // Web search namespace (TASK_2025_189, multi-provider TASK_2025_235)
      webSearch: this.buildNamespaceSafe(
        'webSearch',
        () =>
          new WebSearchService({
            secretStorage: this.secretStorage,
            workspaceProvider: this.workspaceProvider,
            logger: this.logger,
          }),
      ),

      // Help method at root level (ptah.help())
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

      // Return a proxy that throws descriptive errors on any property access
      // that results in a function call. Property reads return functions that throw.
      return new Proxy({} as T, {
        get: (_target, prop) => {
          if (typeof prop === 'symbol') return undefined;
          // Return a function that throws, so ptah.<namespace>.<method>() gives a clear error
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
   * Get the workspace root path
   * Falls back to current working directory if no workspace is open
   */
  private getWorkspaceRoot(): string {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      return workspaceRoot;
    }
    // Fallback to current working directory
    return process.cwd();
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
      // Lazy resolution: check and resolve on each invocation
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

  /**
   * Build the wait-for-user handler for browser automation (TASK_2025_254).
   *
   * In VS Code, this uses WebviewManager + PermissionPromptService to prompt the user
   * via the webview UI (same pattern as approval_prompt in approval-prompt.handler.ts).
   *
   * In Electron, WebviewManager is not registered, so this returns undefined.
   * The Electron DI container provides its own waitForUser via dialog.showMessageBox.
   *
   * @returns Wait-for-user async handler, or undefined when WebviewManager is absent
   */
  private buildWaitForUserHandler():
    | ((params: {
        message: string;
        timeout?: number;
      }) => Promise<BrowserWaitForUserResult>)
    | undefined {
    // Guard: WebviewManager is only available in VS Code
    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      return undefined;
    }

    let webviewManager: WebviewManager;
    let permissionService: PermissionPromptService;

    try {
      webviewManager = container.resolve<WebviewManager>(
        TOKENS.WEBVIEW_MANAGER,
      );
      permissionService = container.resolve<PermissionPromptService>(
        TOKENS.PERMISSION_PROMPT_SERVICE,
      );
    } catch {
      return undefined;
    }

    const logger = this.logger;

    return async (params: {
      message: string;
      timeout?: number;
    }): Promise<BrowserWaitForUserResult> => {
      const startTime = Date.now();
      const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;

      try {
        // 1. Create a permission request using the established pattern
        //    (mirrors approval-prompt.handler.ts flow)
        const permissionRequest = permissionService.createRequest({
          tool_name: 'browser_wait_for_user',
          input: { message: params.message } as Readonly<
            Record<string, unknown>
          >,
        });

        // 2. Create Promise that will be resolved when user responds
        const responsePromise = new Promise<PermissionResponse>((resolve) => {
          permissionService.setPendingResolver(
            permissionRequest.id,
            resolve,
            permissionRequest,
          );
        });

        // 3. Send permission request to webview via WebviewManager
        await webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.PERMISSION_REQUEST,
          permissionRequest,
        );

        // 4. Race between user response and timeout
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
        });

        const result = await Promise.race([responsePromise, timeoutPromise]);

        // Always clear the timeout to prevent timer leak
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        const waitDurationMs = Date.now() - startTime;

        if (result === 'timeout') {
          // Cleanup the pending resolver to avoid stale prompts
          permissionService.removePendingResolver(permissionRequest.id);
          logger.info('Wait-for-user timed out', {
            timeoutMs,
            waitDurationMs,
          });
          return {
            ready: false,
            reason: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for user`,
            waitDurationMs,
          };
        }

        // User responded
        const response = result as PermissionResponse;
        if (
          response.decision === 'allow' ||
          response.decision === 'always_allow'
        ) {
          logger.info('Wait-for-user: user signaled ready', {
            id: response.id,
            waitDurationMs,
          });
          return {
            ready: true,
            waitDurationMs,
          };
        } else {
          logger.info('Wait-for-user: user cancelled', {
            id: response.id,
            reason: response.reason,
            waitDurationMs,
          });
          return {
            ready: false,
            reason: response.reason || 'User cancelled the wait',
            waitDurationMs,
          };
        }
      } catch (error) {
        const waitDurationMs = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error('Wait-for-user handler failed', {
          error: errorMessage,
          waitDurationMs,
        });
        return {
          ready: false,
          waitDurationMs,
          error: `Wait-for-user failed: ${errorMessage}`,
        };
      }
    };
  }
}
