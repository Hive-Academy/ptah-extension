/**
 * Electron RPC Handler Setup
 *
 * TASK_2025_200 Batch 3, Task 3.2: RPC handler index for Electron.
 *
 * This module determines which RPC handler classes from the VS Code app
 * can be reused in Electron and which need Electron-specific implementations.
 *
 * AUDIT RESULTS:
 *
 * The RPC handler classes live in apps/ptah-extension-vscode/src/services/rpc/handlers/
 * which is app-level code (not a shared library). They CANNOT be imported
 * directly from the Electron app. Each handler was audited for vscode imports:
 *
 * PLATFORM-AGNOSTIC (no vscode import -- could be shared if moved to a library):
 *   - SessionRpcHandlers     - Session management
 *   - ContextRpcHandlers     - Context file management
 *   - AutocompleteRpcHandlers - Autocomplete suggestions
 *   - LlmRpcHandlers         - LLM provider management (app-level, not vscode-core)
 *   - PluginRpcHandlers      - Plugin configuration
 *   - PtahCliRpcHandlers     - Ptah CLI agent management
 *   - SubagentRpcHandlers    - Subagent resumption
 *
 * VS CODE-SPECIFIC (import and use vscode APIs at runtime):
 *   - ChatRpcHandlers         - Uses vscode.workspace.workspaceFolders
 *   - ConfigRpcHandlers       - Uses vscode.ConfigurationTarget
 *   - AuthRpcHandlers         - Uses vscode.window.createTerminal, vscode.authentication
 *   - FileRpcHandlers         - Uses vscode file system APIs
 *   - SetupRpcHandlers        - Uses vscode workspace APIs
 *   - LicenseRpcHandlers      - Uses vscode.window (notifications)
 *   - CommandRpcHandlers      - Uses vscode.commands.executeCommand
 *   - EnhancedPromptsRpcHandlers - Uses vscode workspace APIs
 *   - QualityRpcHandlers      - Uses vscode workspace APIs
 *   - WizardGenerationRpcHandlers - Uses vscode workspace APIs
 *   - ProviderRpcHandlers     - Uses vscode workspace APIs
 *   - AgentRpcHandlers        - Uses vscode workspace APIs
 *
 * STRATEGY:
 * Since handler classes are app-level code and many import vscode directly,
 * we register the RPC methods inline using the RpcHandler API. This avoids
 * the need to import handler classes across app boundaries.
 *
 * The RPC method registration delegates to domain services (workspace-intelligence,
 * agent-sdk, etc.) which are already platform-agnostic via PLATFORM_TOKENS.
 * The thin RPC "glue" layer is duplicated here rather than shared.
 *
 * Extended methods are registered in rpc-method-registration.service.ts (Batch 4, Task 4.4).
 */

import type { DependencyContainer } from 'tsyringe';
import type { RpcHandler } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  ISecretStorage,
} from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/** Default model used when no model is explicitly selected or stored. */
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Logger interface matching the structured Logger from vscode-core. */
interface ElectronLogger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Setup core RPC handlers for Electron.
 *
 * Registers a subset of RPC methods that are essential for the Electron app
 * to function. Platform-agnostic domain logic is delegated to library services
 * (agent-sdk, workspace-intelligence, etc.) which are already registered
 * in the DI container.
 *
 * Full RPC method registration (matching VS Code parity) is done in
 * Batch 4 via ElectronRpcMethodRegistrationService.
 *
 * @param container - Configured DI container (after ElectronDIContainer.setup())
 */
export function setupRpcHandlers(container: DependencyContainer): void {
  const rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  const logger = container.resolve<ElectronLogger>(TOKENS.LOGGER);

  // ========================================
  // Session RPC Methods (platform-agnostic)
  // ========================================
  registerSessionMethods(container, rpcHandler);

  // ========================================
  // Chat RPC Methods (platform-adapted)
  // ========================================
  registerChatMethods(container, rpcHandler, logger);

  // ========================================
  // Config RPC Methods (platform-adapted)
  // ========================================
  registerConfigMethods(container, rpcHandler);

  // ========================================
  // Auth RPC Methods (platform-adapted)
  // ========================================
  registerAuthMethods(container, rpcHandler);

  // ========================================
  // Context RPC Methods (platform-agnostic)
  // ========================================
  registerContextMethods(container, rpcHandler);

  // ========================================
  // File RPC Methods (platform-adapted)
  // ========================================
  registerFileMethods(container, rpcHandler);

  // ========================================
  // License RPC Methods (Electron stub)
  // ========================================
  registerLicenseMethods(rpcHandler);
}

/**
 * Register session management RPC methods.
 * These delegate to SDK SessionMetadataStore which is platform-agnostic.
 */
function registerSessionMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  // Session list - delegates to SDK session metadata store
  rpcHandler.registerMethod('session:list', async () => {
    try {
      const metadataStore = container.resolve<{
        getAllSessions(): Array<{
          id: string;
          name: string;
          createdAt: number;
          totalCost: number;
        }>;
      }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);
      const sessions = metadataStore.getAllSessions();
      return { sessions };
    } catch {
      return { sessions: [] };
    }
  });

  // Session delete - delegates to SDK session lifecycle manager
  rpcHandler.registerMethod(
    'session:delete',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      try {
        const lifecycleManager = container.resolve<{
          endSession(sessionId: string): Promise<void>;
        }>(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER);
        await lifecycleManager.endSession(params.sessionId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

/**
 * Stream SDK events from an AsyncIterable to the renderer via WEBVIEW_MANAGER.
 *
 * Iterates the stream, broadcasting each event as CHAT_CHUNK. When a
 * message_complete event is detected, sends CHAT_COMPLETE to signal
 * turn-level completion. A safety-net CHAT_COMPLETE is sent after the
 * stream ends if no explicit completion was detected.
 *
 * Errors are caught and logged -- streaming failures must NOT crash the app.
 */
async function streamEventsToRenderer(
  container: DependencyContainer,
  sessionId: string,
  stream: AsyncIterable<unknown>,
  tabId: string | undefined,
  logger: ElectronLogger
): Promise<void> {
  const routingId = tabId || sessionId;

  try {
    const webviewManager = container.resolve<{
      broadcastMessage(type: string, payload: unknown): Promise<void>;
    }>(TOKENS.WEBVIEW_MANAGER);

    let turnCompleteSent = false;

    for await (const event of stream) {
      // Reset turnCompleteSent on new turn start so multi-turn conversations
      // properly signal completion for each turn
      if ((event as { eventType?: string }).eventType === 'message_start') {
        turnCompleteSent = false;
      }

      await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
        tabId: routingId,
        sessionId: (event as { sessionId?: string }).sessionId || sessionId,
        event,
      });

      if (
        (event as { eventType?: string }).eventType === 'message_complete' &&
        !turnCompleteSent
      ) {
        turnCompleteSent = true;
        await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
          tabId: routingId,
          sessionId: (event as { sessionId?: string }).sessionId || sessionId,
        });
      }
    }

    // Safety net: ensure CHAT_COMPLETE is always sent
    if (!turnCompleteSent) {
      await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
        tabId: routingId,
        sessionId,
      });
    }
  } catch (error) {
    logger.error(
      `[Electron RPC] streamEventsToRenderer error for session ${sessionId}:`,
      error instanceof Error ? error : new Error(String(error))
    );

    // Best-effort: broadcast CHAT_COMPLETE so the UI doesn't get stuck in loading state
    try {
      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);
      await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
        tabId: routingId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Webview manager not available -- nothing more we can do
    }
  }
}

/**
 * Register chat RPC methods with Electron-compatible workspace resolution.
 * In VS Code, workspace comes from vscode.workspace.workspaceFolders.
 * In Electron, it comes from IWorkspaceProvider.
 */
function registerChatMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: ElectronLogger
): void {
  rpcHandler.registerMethod(
    'chat:start',
    async (
      params:
        | {
            message: string;
            contextFiles?: string[];
            tabId?: string;
            model?: string;
          }
        | undefined
    ) => {
      if (!params?.message) {
        return { success: false, error: 'message is required' };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const sdkAdapter = container.resolve<{
          startChatSession(config: {
            tabId: string;
            workspaceId: string;
            projectPath: string;
            name: string;
            prompt: string;
            files?: string[];
            isPremium?: boolean;
            mcpServerRunning?: boolean;
            model?: string;
          }): Promise<AsyncIterable<unknown>>;
        }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

        const workspaceRoot = workspaceProvider.getWorkspaceRoot() ?? '';
        const tabId = params.tabId || `electron-${Date.now()}`;

        // Get current model from storage if not provided
        let currentModel = params.model;
        if (!currentModel) {
          try {
            const storageService = container.resolve<{
              get<T>(key: string, defaultValue: T): T;
            }>(TOKENS.STORAGE_SERVICE);
            currentModel = storageService.get('model.selected', DEFAULT_MODEL);
          } catch {
            currentModel = DEFAULT_MODEL;
          }
        }

        const stream = await sdkAdapter.startChatSession({
          tabId,
          workspaceId: workspaceRoot,
          projectPath: workspaceRoot,
          name: `Session ${new Date().toLocaleDateString()}`,
          prompt: params.message,
          files: params.contextFiles,
          isPremium: true,
          mcpServerRunning: false,
          model: currentModel,
        });

        // Fire-and-forget: stream events to renderer in background
        void streamEventsToRenderer(
          container,
          tabId,
          stream,
          tabId,
          logger
        ).catch((err) =>
          logger.error(
            '[Electron RPC] chat:start streaming error:',
            err instanceof Error ? err : new Error(String(err))
          )
        );

        // Return immediately -- real sessionId comes via SESSION_ID_RESOLVED in stream
        return { success: true, sessionId: tabId };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  rpcHandler.registerMethod(
    'chat:abort',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      const sdkAdapter = container.resolve<{
        interruptSession(sessionId: string): Promise<void>;
      }>(SDK_TOKENS.SDK_AGENT_ADAPTER);
      await sdkAdapter.interruptSession(params.sessionId);
      return { success: true };
    }
  );

  // chat:continue - Send follow-up message to existing session (with auto-resume)
  rpcHandler.registerMethod(
    'chat:continue',
    async (
      params:
        | {
            sessionId: string;
            prompt: string;
            tabId: string;
            workspacePath?: string;
            model?: string;
            files?: string[];
            images?: unknown[];
          }
        | undefined
    ) => {
      if (!params?.sessionId || !params?.prompt) {
        return {
          success: false,
          error: 'sessionId and prompt are required',
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const sdkAdapter = container.resolve<{
          isSessionActive(sessionId: string): boolean;
          resumeSession(
            sessionId: string,
            config: unknown
          ): Promise<AsyncIterable<unknown>>;
          sendMessageToSession(
            sessionId: string,
            content: string,
            options?: { files?: string[]; images?: unknown[] }
          ): Promise<void>;
        }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

        const workspaceRoot =
          params.workspacePath || workspaceProvider.getWorkspaceRoot() || '';
        const isActive = sdkAdapter.isSessionActive(params.sessionId);

        // Auto-resume: if session is not active in memory, resume it first
        if (!isActive) {
          const storageService = container.resolve<{
            get<T>(key: string, defaultValue: T): T;
          }>(TOKENS.STORAGE_SERVICE);
          const currentModel =
            params.model || storageService.get('model.selected', DEFAULT_MODEL);

          const stream = await sdkAdapter.resumeSession(params.sessionId, {
            projectPath: workspaceRoot,
            model: currentModel,
            isPremium: true,
            mcpServerRunning: false,
            tabId: params.tabId,
          });

          // Fire-and-forget: stream resumed session events to renderer
          void streamEventsToRenderer(
            container,
            params.sessionId,
            stream,
            params.tabId,
            logger
          ).catch((err) =>
            logger.error(
              '[Electron RPC] chat:continue resume streaming error:',
              err instanceof Error ? err : new Error(String(err))
            )
          );
        }

        // TASK_2025_201: Inject interrupted subagent context into prompt
        // This enables Claude to automatically resume interrupted agents.
        // Simplified for Electron: skip transcript file existence check.
        let enhancedPrompt = params.prompt;
        try {
          const subagentRegistry = container.resolve<{
            getResumableBySession(sessionId: string): Array<{
              agentId: string;
              agentType: string;
              toolCallId: string;
              interruptedAt?: number;
            }>;
            remove(toolCallId: string): void;
          }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);

          const resumableSubagents = subagentRegistry.getResumableBySession(
            params.sessionId
          );

          if (resumableSubagents.length > 0) {
            const agentDetails = resumableSubagents
              .map((s) => {
                const interruptedAgo = s.interruptedAt
                  ? Math.round((Date.now() - s.interruptedAt) / 1000 / 60)
                  : 0;
                return `  - ${s.agentType} agent (agentId: ${s.agentId})${
                  interruptedAgo > 0
                    ? ` - interrupted ${interruptedAgo} min ago`
                    : ''
                }`;
              })
              .join('\n');

            const contextPrefix = `[SYSTEM CONTEXT - INTERRUPTED AGENTS]
The following subagent(s) were interrupted and did not complete their work:
${agentDetails}

IMPORTANT INSTRUCTIONS:
1. Your FIRST action should be to resume these interrupted agents using the Task tool with the "resume" parameter set to the agentId shown above (e.g., resume: "${resumableSubagents[0].agentId}").
2. Resume agents in the order they were interrupted (continue their previous work).
3. After resuming completes, address the user's current message if it requires additional work.
4. If the user explicitly asks to start fresh or work on something completely unrelated, you may skip resumption and acknowledge the interrupted work was abandoned.

[END SYSTEM CONTEXT]

`;
            enhancedPrompt = contextPrefix + params.prompt;

            logger.info(
              '[Electron RPC] chat:continue - injected subagent context',
              {
                sessionId: params.sessionId,
                resumableCount: resumableSubagents.length,
                agents: resumableSubagents.map((s) => ({
                  agentId: s.agentId,
                  agentType: s.agentType,
                })),
              }
            );

            // Remove injected subagents from registry (one-shot injection)
            for (const s of resumableSubagents) {
              subagentRegistry.remove(s.toolCallId);
            }
          }
        } catch {
          // SubagentRegistryService may not be registered -- best-effort, don't block message sending
        }

        // Send the follow-up message to the (now-active) session
        await sdkAdapter.sendMessageToSession(
          params.sessionId,
          enhancedPrompt,
          {
            files: params.files ?? [],
            images: params.images ?? [],
          }
        );

        return { success: true, sessionId: params.sessionId };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // chat:resume - Load session history from JSONL files for display
  rpcHandler.registerMethod(
    'chat:resume',
    async (
      params:
        | {
            sessionId: string;
            tabId: string;
            workspacePath?: string;
            model?: string;
          }
        | undefined
    ) => {
      if (!params?.sessionId) {
        return {
          success: false,
          error: 'sessionId is required',
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const historyReader = container.resolve<{
          readSessionHistory(
            sessionId: string,
            workspacePath: string
          ): Promise<{ events: unknown[]; stats: unknown }>;
          readHistoryAsMessages(
            sessionId: string,
            workspacePath: string
          ): Promise<unknown[]>;
        }>(SDK_TOKENS.SDK_SESSION_HISTORY_READER);

        const workspaceRoot =
          params.workspacePath || workspaceProvider.getWorkspaceRoot() || '';
        const result = await historyReader.readSessionHistory(
          params.sessionId,
          workspaceRoot
        );

        // Read backward-compatible messages from history
        let messages: unknown[] = [];
        try {
          messages = await historyReader.readHistoryAsMessages(
            params.sessionId,
            workspaceRoot
          );
        } catch {
          // readHistoryAsMessages may not be available -- graceful degradation
        }

        // Register interrupted agents from history into SubagentRegistryService
        // This enables context injection in chat:continue for cold-loaded sessions.
        let registeredFromHistory = 0;
        try {
          const subagentRegistry = container.resolve<{
            getResumableBySession(
              sessionId: string
            ): Array<{ agentId: string; agentType: string }>;
            registerFromHistoryEvents(
              events: unknown[],
              sessionId: string
            ): number;
          }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);

          registeredFromHistory = subagentRegistry.registerFromHistoryEvents(
            result.events,
            params.sessionId
          );

          if (registeredFromHistory > 0) {
            logger.info(
              '[Electron RPC] Registered interrupted agents from history',
              {
                sessionId: params.sessionId,
                registeredCount: registeredFromHistory,
              }
            );
          }
        } catch {
          // SubagentRegistryService may not be registered -- graceful degradation
        }

        // Query subagent registry for resumable subagents
        let resumableSubagents: Array<{
          agentId: string;
          agentType: string;
        }> = [];
        try {
          const subagentRegistry = container.resolve<{
            getResumableBySession(
              sessionId: string
            ): Array<{ agentId: string; agentType: string }>;
          }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);
          resumableSubagents = subagentRegistry.getResumableBySession(
            params.sessionId
          );
        } catch {
          // SubagentRegistryService may not be registered -- graceful degradation
        }

        return {
          success: true,
          messages,
          events: result.events,
          stats: result.stats,
          resumableSubagents,
        };
      } catch (error) {
        logger.error(
          '[Electron RPC] chat:resume error:',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: true,
          messages: [],
          events: [],
          stats: null,
          resumableSubagents: [],
        };
      }
    }
  );

  // chat:running-agents - Query running subagents for a session
  rpcHandler.registerMethod(
    'chat:running-agents',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { agents: [] };
      }

      try {
        const subagentRegistry = container.resolve<{
          getRunningBySession(
            sessionId: string
          ): Array<{ agentId: string; agentType: string }>;
        }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);
        const agents = subagentRegistry.getRunningBySession(params.sessionId);
        return {
          agents: agents.map((a) => ({
            agentId: a.agentId,
            agentType: a.agentType,
          })),
        };
      } catch {
        return { agents: [] };
      }
    }
  );
}

/**
 * Register config RPC methods using IWorkspaceProvider.
 * Uses getConfiguration(section, key, defaultValue) from the platform interface.
 */
function registerConfigMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  rpcHandler.registerMethod('config:model-get', async () => {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER
    );
    return {
      model: workspaceProvider.getConfiguration<string>(
        'ptah',
        'model.selected',
        DEFAULT_MODEL
      ),
      autopilot: workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'autopilot.enabled',
        true
      ),
    };
  });

  rpcHandler.registerMethod(
    'config:model-set',
    async (params: { model?: string; autopilot?: boolean } | undefined) => {
      // Config updates are handled through workspace state storage in Electron
      // The IWorkspaceProvider.getConfiguration is read-only
      // Config persistence is handled by the Electron workspace config file
      if (params?.model !== undefined) {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);
        await storageService.set('model.selected', params.model);
      }
      if (params?.autopilot !== undefined) {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);
        await storageService.set('autopilot.enabled', params.autopilot);
      }
      return { success: true };
    }
  );
}

/**
 * Register auth RPC methods for API key management.
 * In Electron, authentication is via API key stored in ISecretStorage.
 */
function registerAuthMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  rpcHandler.registerMethod(
    'auth:setApiKey',
    async (params: { provider: string; apiKey: string } | undefined) => {
      if (!params?.provider || !params?.apiKey) {
        return { success: false, error: 'provider and apiKey are required' };
      }

      const secretStorage = container.resolve<ISecretStorage>(
        PLATFORM_TOKENS.SECRET_STORAGE
      );

      const storageKey = `ptah.apiKey.${params.provider}`;
      await secretStorage.store(storageKey, params.apiKey);

      // Also set in environment for Claude Agent SDK
      if (params.provider === 'anthropic') {
        process.env['ANTHROPIC_API_KEY'] = params.apiKey;
      }

      return { success: true };
    }
  );

  rpcHandler.registerMethod('auth:getStatus', async () => {
    const secretStorage = container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE
    );

    const anthropicKey = await secretStorage.get('ptah.apiKey.anthropic');

    return {
      isAuthenticated: !!anthropicKey,
      provider: 'anthropic',
      hasApiKey: !!anthropicKey,
    };
  });

  // auth:getAuthStatus - Returns auth configuration flags (called by AppShellComponent on startup)
  rpcHandler.registerMethod('auth:getAuthStatus', async () => {
    const secretStorage = container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE
    );

    const anthropicKey = await secretStorage.get('ptah.apiKey.anthropic');
    const openrouterKey = await secretStorage.get('ptah.apiKey.openrouter');

    return {
      hasOAuthToken: false,
      hasApiKey: !!anthropicKey,
      hasOpenRouterKey: !!openrouterKey,
      hasAnyProviderKey: !!anthropicKey || !!openrouterKey,
      authMethod: 'apiKey' as const,
      anthropicProviderId: 'anthropic',
      availableProviders: [],
      copilotAuthenticated: false,
      codexAuthenticated: false,
    };
  });

  // auth:getApiKeyStatus - Returns per-provider key status without exposing values
  rpcHandler.registerMethod('auth:getApiKeyStatus', async () => {
    const secretStorage = container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE
    );

    const anthropicKey = await secretStorage.get('ptah.apiKey.anthropic');
    const openrouterKey = await secretStorage.get('ptah.apiKey.openrouter');

    return {
      providers: [
        {
          provider: 'anthropic',
          displayName: 'Anthropic (Claude)',
          hasApiKey: !!anthropicKey,
          isDefault: true,
        },
        {
          provider: 'openrouter',
          displayName: 'OpenRouter',
          hasApiKey: !!openrouterKey,
          isDefault: false,
        },
      ],
    };
  });
}

/**
 * Register context file management RPC methods.
 * Uses IFileSystemProvider for platform-agnostic file access.
 */
function registerContextMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  rpcHandler.registerMethod('context:getFiles', async () => {
    return { files: [] };
  });

  rpcHandler.registerMethod(
    'context:searchFiles',
    async (params: { query: string; maxResults?: number } | undefined) => {
      if (!params?.query) {
        return { files: [] };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const fileSystemProvider = container.resolve<IFileSystemProvider>(
          PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER
        );

        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return { files: [] };
        }

        const files = await fileSystemProvider.findFiles(
          `${workspaceRoot}/**/*${params.query}*`,
          '**/node_modules/**',
          params.maxResults ?? 20
        );
        return { files };
      } catch {
        return { files: [] };
      }
    }
  );
}

/**
 * Register file operation RPC methods using IFileSystemProvider.
 */
function registerFileMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  rpcHandler.registerMethod(
    'file:read',
    async (params: { path: string } | undefined) => {
      if (!params?.path) {
        throw new Error('path is required');
      }
      const fileSystem = container.resolve<IFileSystemProvider>(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER
      );
      const content = await fileSystem.readFile(params.path);
      return { content };
    }
  );

  rpcHandler.registerMethod(
    'file:exists',
    async (params: { path: string } | undefined) => {
      if (!params?.path) {
        return { exists: false };
      }
      const fileSystem = container.resolve<IFileSystemProvider>(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER
      );
      const exists = await fileSystem.exists(params.path);
      return { exists };
    }
  );
}

/**
 * Register license RPC methods. Electron stub returns always-valid.
 */
function registerLicenseMethods(rpcHandler: RpcHandler): void {
  rpcHandler.registerMethod('license:getStatus', async () => {
    return {
      valid: true,
      tier: 'pro',
      source: 'electron-stub',
    };
  });

  rpcHandler.registerMethod('license:setKey', async () => {
    return { success: true };
  });
}
