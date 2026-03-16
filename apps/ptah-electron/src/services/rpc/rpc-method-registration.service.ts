/**
 * Electron RPC Method Registration Service
 *
 * TASK_2025_200 Batch 4, Task 4.4
 *
 * Extends the core RPC handler setup (rpc-handler-setup.ts) with additional
 * platform-agnostic RPC methods that mirror the VS Code RPC registration.
 *
 * The core methods (chat, session:list, session:delete, config, auth, context,
 * file, license) are registered in rpc-handler-setup.ts. This service adds:
 *
 * - session:load, session:validate, session:cli-sessions (SDK metadata store)
 * - autocomplete:agents, autocomplete:commands (workspace intelligence)
 * - setup-status:get-status (agent generation - Electron-adapted)
 * - chat:subagent-query (subagent registry)
 * - chat:send-message (alias for chat:start continuation)
 * - llm:getProviderStatus, llm:setApiKey (Electron-adapted)
 * - plugins:list-available, plugins:get-config, plugins:save-config
 *
 * STRATEGY:
 * Since VS Code handler classes are app-level code (cannot import cross-app),
 * we register methods inline using the RpcHandler API, delegating to
 * domain services that are already registered in the DI container.
 */

import type { DependencyContainer } from 'tsyringe';
import type { RpcHandler, Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  ISecretStorage,
} from '@ptah-extension/platform-core';

/**
 * Register extended RPC methods for the Electron app.
 *
 * This supplements the core methods from setupRpcHandlers() with additional
 * methods needed for full frontend functionality. Called after the IPC bridge
 * is initialized so that responses can flow back to the renderer.
 *
 * @param container - Configured DI container (after ElectronDIContainer.setup())
 */
export function registerExtendedRpcMethods(
  container: DependencyContainer
): void {
  const rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  const logger = container.resolve<Logger>(TOKENS.LOGGER);

  registerSessionExtendedMethods(container, rpcHandler, logger);
  registerAutocompleteMethods(container, rpcHandler, logger);
  registerSubagentMethods(container, rpcHandler, logger);
  registerSetupStatusMethods(container, rpcHandler, logger);
  registerLlmMethods(container, rpcHandler, logger);
  registerPluginMethods(container, rpcHandler, logger);
  registerWorkspaceMethods(container, rpcHandler, logger);
  registerChatExtendedMethods(container, rpcHandler, logger);

  logger.info('[Electron RPC] Extended RPC methods registered', {
    methods: rpcHandler.getRegisteredMethods(),
  });
}

/**
 * Register extended session methods (load, validate, cli-sessions).
 * These delegate to SDK SessionMetadataStore which is platform-agnostic.
 */
function registerSessionExtendedMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // session:load - Load session metadata for display
  rpcHandler.registerMethod(
    'session:load',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      try {
        const metadataStore = container.resolve<{
          getSession(id: string): {
            id: string;
            name: string;
            createdAt: number;
            totalCost: number;
            messages?: unknown[];
          } | null;
        }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);

        const session = metadataStore.getSession(params.sessionId);
        if (!session) {
          return { success: false, error: 'Session not found' };
        }
        return { session };
      } catch (error) {
        logger.error(
          '[Electron RPC] session:load failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // session:validate - Check if a session file still exists on disk
  rpcHandler.registerMethod(
    'session:validate',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { valid: false };
      }
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');

        // SDK stores sessions at ~/.claude/projects/{hash}/{sessionId}.jsonl
        const claudeDir = path.join(os.homedir(), '.claude', 'projects');
        // Check if any subdirectory contains the session file
        const exists = await checkSessionFileExists(
          fs,
          path,
          claudeDir,
          params.sessionId
        );
        return { valid: exists };
      } catch {
        return { valid: false };
      }
    }
  );

  // session:cli-sessions - Get CLI session references for a parent session
  rpcHandler.registerMethod(
    'session:cli-sessions',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { cliSessions: [] };
      }
      try {
        const metadataStore = container.resolve<{
          getCliSessions(sessionId: string): Array<{
            cliSessionId: string;
            cli: string;
            agentId: string;
            task?: string;
            status: string;
          }>;
        }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);

        const cliSessions = metadataStore.getCliSessions(params.sessionId);
        return { cliSessions };
      } catch {
        return { cliSessions: [] };
      }
    }
  );
}

/**
 * Helper: Check if a session .jsonl file exists in any subdirectory.
 */
async function checkSessionFileExists(
  fs: typeof import('fs/promises'),
  path: typeof import('path'),
  claudeDir: string,
  sessionId: string
): Promise<boolean> {
  try {
    const dirs = await fs.readdir(claudeDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const sessionFile = path.join(
          claudeDir,
          dir.name,
          `${sessionId}.jsonl`
        );
        try {
          await fs.access(sessionFile);
          return true;
        } catch {
          // File not in this directory, continue
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Register autocomplete methods for agent and command discovery.
 * Uses workspace-intelligence services.
 */
function registerAutocompleteMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // autocomplete:agents - Search for available agents
  rpcHandler.registerMethod(
    'autocomplete:agents',
    async (params: { query?: string; maxResults?: number } | undefined) => {
      try {
        const agentDiscovery = container.resolve<{
          searchAgents(request: {
            query: string;
            maxResults?: number;
          }): Promise<unknown>;
        }>(TOKENS.AGENT_DISCOVERY_SERVICE);

        return agentDiscovery.searchAgents({
          query: params?.query ?? '',
          maxResults: params?.maxResults,
        });
      } catch (error) {
        logger.warn(
          '[Electron RPC] autocomplete:agents failed (discovery service unavailable)',
          error instanceof Error ? error : new Error(String(error))
        );
        return { agents: [] };
      }
    }
  );

  // autocomplete:commands - Search for available slash commands
  rpcHandler.registerMethod(
    'autocomplete:commands',
    async (params: { query?: string; maxResults?: number } | undefined) => {
      try {
        const commandDiscovery = container.resolve<{
          searchCommands(request: {
            query: string;
            maxResults?: number;
          }): Promise<unknown>;
        }>(TOKENS.COMMAND_DISCOVERY_SERVICE);

        return commandDiscovery.searchCommands({
          query: params?.query ?? '',
          maxResults: params?.maxResults,
        });
      } catch (error) {
        logger.warn(
          '[Electron RPC] autocomplete:commands failed (discovery service unavailable)',
          error instanceof Error ? error : new Error(String(error))
        );
        return { commands: [] };
      }
    }
  );
}

/**
 * Register subagent query method.
 * Uses SubagentRegistryService from vscode-core (platform-agnostic).
 */
function registerSubagentMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  rpcHandler.registerMethod(
    'chat:subagent-query',
    async (
      params:
        | { toolCallId?: string; sessionId?: string; resumable?: boolean }
        | undefined
    ) => {
      try {
        const registry = container.resolve<SubagentRegistryService>(
          TOKENS.SUBAGENT_REGISTRY_SERVICE
        );

        if (params?.toolCallId) {
          const record = registry.getSubagent(params.toolCallId);
          return { subagents: record ? [record] : [] };
        }

        if (params?.sessionId) {
          const subagents = registry.getResumableSubagents(params.sessionId);
          return { subagents };
        }

        // Return all resumable subagents
        const allResumable = registry.getResumableSubagents();
        return { subagents: allResumable };
      } catch (error) {
        logger.warn(
          '[Electron RPC] chat:subagent-query failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { subagents: [] };
      }
    }
  );
}

/**
 * Register setup status methods (Electron-adapted).
 * Uses agent-generation services (platform-agnostic via PLATFORM_TOKENS).
 */
function registerSetupStatusMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // setup-status:get-status - Get agent configuration status for workspace
  rpcHandler.registerMethod('setup-status:get-status', async () => {
    try {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER
      );
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();

      if (!workspaceRoot) {
        return {
          isConfigured: false,
          agentCount: 0,
          lastModified: null,
          projectAgents: [],
          userAgents: [],
        };
      }

      // Try to resolve the setup status service
      const setupStatusService = container.resolve<{
        getSetupStatus(workspacePath: string): Promise<{
          isConfigured: boolean;
          agentCount: number;
          lastModified: string | null;
          projectAgents: string[];
          userAgents: string[];
        }>;
      }>(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE);

      return setupStatusService.getSetupStatus(workspaceRoot);
    } catch (error) {
      logger.warn(
        '[Electron RPC] setup-status:get-status failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        isConfigured: false,
        agentCount: 0,
        lastModified: null,
        projectAgents: [],
        userAgents: [],
      };
    }
  });
}

/**
 * Register LLM provider management methods (Electron-adapted).
 * In Electron, we use direct API key management via ISecretStorage.
 */
function registerLlmMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // llm:getProviderStatus - Get status of configured providers
  rpcHandler.registerMethod('llm:getProviderStatus', async () => {
    try {
      const secretStorage = container.resolve<ISecretStorage>(
        PLATFORM_TOKENS.SECRET_STORAGE
      );

      const anthropicKey = await secretStorage.get('ptah.apiKey.anthropic');
      const openrouterKey = await secretStorage.get('ptah.apiKey.openrouter');

      return {
        providers: [
          {
            name: 'anthropic',
            displayName: 'Anthropic (Claude)',
            hasApiKey: !!anthropicKey,
            isDefault: true,
          },
          {
            name: 'openrouter',
            displayName: 'OpenRouter',
            hasApiKey: !!openrouterKey,
            isDefault: false,
          },
        ],
      };
    } catch (error) {
      logger.warn(
        '[Electron RPC] llm:getProviderStatus failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return { providers: [] };
    }
  });

  // llm:setApiKey - Store API key for a provider
  rpcHandler.registerMethod(
    'llm:setApiKey',
    async (params: { provider: string; apiKey: string } | undefined) => {
      if (!params?.provider || !params?.apiKey) {
        return { success: false, error: 'provider and apiKey are required' };
      }

      try {
        const secretStorage = container.resolve<ISecretStorage>(
          PLATFORM_TOKENS.SECRET_STORAGE
        );

        const storageKey = `ptah.apiKey.${params.provider}`;
        await secretStorage.store(storageKey, params.apiKey);

        // Set in environment for SDK adapters
        if (params.provider === 'anthropic') {
          process.env['ANTHROPIC_API_KEY'] = params.apiKey;
        } else if (params.provider === 'openrouter') {
          process.env['OPENROUTER_API_KEY'] = params.apiKey;
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // llm:removeApiKey - Remove stored API key
  rpcHandler.registerMethod(
    'llm:removeApiKey',
    async (params: { provider: string } | undefined) => {
      if (!params?.provider) {
        return { success: false, error: 'provider is required' };
      }

      try {
        const secretStorage = container.resolve<ISecretStorage>(
          PLATFORM_TOKENS.SECRET_STORAGE
        );
        await secretStorage.delete(`ptah.apiKey.${params.provider}`);

        if (params.provider === 'anthropic') {
          delete process.env['ANTHROPIC_API_KEY'];
        } else if (params.provider === 'openrouter') {
          delete process.env['OPENROUTER_API_KEY'];
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // llm:getDefaultProvider - Get the default LLM provider
  rpcHandler.registerMethod('llm:getDefaultProvider', async () => {
    return { provider: 'anthropic' };
  });

  // llm:validateApiKeyFormat - Basic format validation
  rpcHandler.registerMethod(
    'llm:validateApiKeyFormat',
    async (params: { provider: string; apiKey: string } | undefined) => {
      if (!params?.provider || !params?.apiKey) {
        return { valid: false, error: 'provider and apiKey are required' };
      }

      const key = params.apiKey.trim();
      if (params.provider === 'anthropic') {
        return { valid: key.startsWith('sk-ant-') && key.length > 20 };
      }
      if (params.provider === 'openrouter') {
        return { valid: key.startsWith('sk-or-') && key.length > 20 };
      }
      return { valid: key.length > 10 };
    }
  );
}

/**
 * Register plugin configuration methods.
 * Uses agent-sdk PluginLoaderService (platform-agnostic).
 */
function registerPluginMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // plugins:list-available - List bundled plugins with metadata
  rpcHandler.registerMethod('plugins:list-available', async () => {
    try {
      const pluginLoader = container.resolve<{
        getAvailablePlugins(): Array<{
          id: string;
          name: string;
          description: string;
          category: string;
        }>;
      }>(SDK_TOKENS.SDK_PLUGIN_LOADER);

      return { plugins: pluginLoader.getAvailablePlugins() };
    } catch (error) {
      logger.warn(
        '[Electron RPC] plugins:list-available failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return { plugins: [] };
    }
  });

  // plugins:get-config - Get per-workspace plugin configuration
  rpcHandler.registerMethod('plugins:get-config', async () => {
    try {
      const storageService = container.resolve<{
        get<T>(key: string, defaultValue?: T): T | undefined;
      }>(TOKENS.STORAGE_SERVICE);

      const enabledPlugins =
        storageService.get<string[]>('plugins.enabled') ?? [];
      return { enabledPlugins };
    } catch {
      return { enabledPlugins: [] };
    }
  });

  // plugins:save-config - Save plugin configuration
  rpcHandler.registerMethod(
    'plugins:save-config',
    async (params: { enabledPlugins: string[] } | undefined) => {
      if (!params) {
        return { success: false, error: 'enabledPlugins is required' };
      }
      try {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);

        await storageService.set('plugins.enabled', params.enabledPlugins);
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
 * Register workspace-related methods.
 */
function registerWorkspaceMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  _logger: Logger
): void {
  // workspace:getInfo - Get workspace information for the frontend
  rpcHandler.registerMethod('workspace:getInfo', async () => {
    try {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER
      );
      const folders = workspaceProvider.getWorkspaceFolders();
      const root = workspaceProvider.getWorkspaceRoot();

      return {
        folders,
        root,
        name: root ? root.split(/[/\\]/).pop() ?? 'Workspace' : 'No Workspace',
      };
    } catch {
      return { folders: [], root: undefined, name: 'No Workspace' };
    }
  });
}

/**
 * Register extended chat methods (send-message, stop, continue).
 */
function registerChatExtendedMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // chat:send-message - Alias for sending a message to an existing session
  // Frontend uses this for continuation messages after initial chat:start
  rpcHandler.registerMethod(
    'chat:send-message',
    async (
      params:
        | { sessionId: string; message: string; contextFiles?: string[] }
        | undefined
    ) => {
      if (!params?.sessionId || !params?.message) {
        return {
          success: false,
          error: 'sessionId and message are required',
        };
      }
      try {
        const sdkAdapter = container.resolve<{
          continueSession(options: {
            sessionId: string;
            message: string;
            contextFiles?: string[];
          }): Promise<{ success: boolean }>;
        }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

        return sdkAdapter.continueSession({
          sessionId: params.sessionId,
          message: params.message,
          contextFiles: params.contextFiles,
        });
      } catch (error) {
        logger.error(
          '[Electron RPC] chat:send-message failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // chat:stop - Stop an active chat session
  rpcHandler.registerMethod(
    'chat:stop',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      try {
        const sdkAdapter = container.resolve<{
          abortSession(sessionId: string): Promise<void>;
        }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

        await sdkAdapter.abortSession(params.sessionId);
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
