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
 * Staleness threshold for the generation guard.
 * If a generation has been running longer than this, assume it crashed
 * and allow new generations to proceed.
 */
const GENERATION_STALENESS_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Module-level concurrent generation guard.
 * Shared by wizard:submit-selection, wizard:cancel, and wizard:retry-item
 * to prevent duplicate generation runs.
 */
let isGenerating = false;
let generationStartedAt: number | null = null;

/**
 * Check if the isGenerating flag is stale (stuck due to a crash) and reset it.
 * Called before early-return checks to prevent permanent lockout.
 */
function checkAndResetStaleness(logger: Logger): void {
  if (
    isGenerating &&
    generationStartedAt &&
    Date.now() - generationStartedAt > GENERATION_STALENESS_MS
  ) {
    logger.warn('[Electron RPC] Generation guard was stale, resetting');
    isGenerating = false;
    generationStartedAt = null;
  }
}

/** Default model for SDK operations when no user preference is stored. */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

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
  registerEditorMethods(container, rpcHandler, logger);
  registerConfigExtendedMethods(container, rpcHandler, logger);
  registerCommandMethods(container, rpcHandler, logger);
  registerQualityMethods(container, rpcHandler, logger);
  registerWizardMethods(container, rpcHandler, logger);
  registerAgentMethods(container, rpcHandler, logger);

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
    async (params: { enabledPluginIds: string[] } | undefined) => {
      if (!params) {
        return { success: false, error: 'enabledPluginIds is required' };
      }
      try {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);

        await storageService.set('plugins.enabled', params.enabledPluginIds);
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

// ============================================================
// Editor Methods (Monaco Editor + File Explorer)
// ============================================================

function registerEditorMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  const fs = container.resolve<{
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    readDirectory(path: string): Promise<{ name: string; type: number }[]>;
    stat(path: string): Promise<{ type: number }>;
  }>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);

  const workspace = container.resolve<{
    getWorkspaceRoot(): string | undefined;
  }>(PLATFORM_TOKENS.WORKSPACE_PROVIDER);

  // editor:openFile - Read file content for Monaco editor
  rpcHandler.registerMethod(
    'editor:openFile',
    async (params: { filePath: string } | undefined) => {
      if (!params?.filePath) {
        return { success: false, error: 'filePath is required' };
      }
      try {
        const content = await fs.readFile(params.filePath);

        // Notify editor provider of file open
        try {
          const editorProvider = container.resolve<{
            notifyFileOpened(filePath: string): void;
          }>(PLATFORM_TOKENS.EDITOR_PROVIDER);
          editorProvider.notifyFileOpened(params.filePath);
        } catch {
          // Editor provider may not support notify
        }

        return { success: true, content, filePath: params.filePath };
      } catch (error) {
        logger.error('[Electron RPC] editor:openFile failed', {
          filePath: params.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // editor:saveFile - Save file content from Monaco editor
  rpcHandler.registerMethod(
    'editor:saveFile',
    async (params: { filePath: string; content: string } | undefined) => {
      if (!params?.filePath || typeof params.content !== 'string') {
        return { success: false, error: 'filePath and content are required' };
      }
      try {
        await fs.writeFile(params.filePath, params.content);
        return { success: true };
      } catch (error) {
        logger.error('[Electron RPC] editor:saveFile failed', {
          filePath: params.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // editor:getFileTree - Build recursive file tree from workspace root
  rpcHandler.registerMethod(
    'editor:getFileTree',
    async (params: { rootPath?: string } | undefined) => {
      const root = params?.rootPath ?? workspace.getWorkspaceRoot();
      if (!root) {
        return { success: true, tree: [] };
      }
      try {
        const tree = await buildFileTree(fs, root, 3);
        return { success: true, tree };
      } catch (error) {
        logger.error('[Electron RPC] editor:getFileTree failed', {
          root,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          tree: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

// ============================================================
// Config Extended Methods (autopilot, models)
// TASK_2025_201 Batch 3, Task 3.1
// ============================================================

function registerConfigExtendedMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // config:autopilot-get - Read autopilot settings from storage
  rpcHandler.registerMethod('config:autopilot-get', async () => {
    try {
      const storageService = container.resolve<{
        get<T>(key: string, defaultValue: T): T;
      }>(TOKENS.STORAGE_SERVICE);

      const enabled = storageService.get('autopilot.enabled', false);
      const permissionLevel = storageService.get(
        'autopilot.permissionLevel',
        'ask'
      );
      return { enabled, permissionLevel };
    } catch (error) {
      logger.warn(
        '[Electron RPC] config:autopilot-get failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return { enabled: false, permissionLevel: 'ask' };
    }
  });

  // config:autopilot-toggle - Persist autopilot settings and sync to SDK
  rpcHandler.registerMethod(
    'config:autopilot-toggle',
    async (
      params:
        | {
            enabled: boolean;
            permissionLevel: string;
            sessionId?: string;
          }
        | undefined
    ) => {
      if (params === undefined) {
        return { enabled: false, permissionLevel: 'ask' };
      }

      const validLevels = ['ask', 'auto-edit', 'yolo', 'plan'];
      if (!validLevels.includes(params.permissionLevel)) {
        return {
          success: false,
          error: `Invalid permissionLevel: ${
            params.permissionLevel
          }. Must be one of: ${validLevels.join(', ')}`,
        };
      }

      try {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);

        await storageService.set('autopilot.enabled', params.enabled);
        await storageService.set(
          'autopilot.permissionLevel',
          params.permissionLevel
        );

        // Sync to SDK permission handler
        const effectiveLevel = params.enabled ? params.permissionLevel : 'ask';
        try {
          const permissionHandler = container.resolve<{
            setPermissionLevel(level: string): void;
          }>(SDK_TOKENS.SDK_PERMISSION_HANDLER);
          permissionHandler.setPermissionLevel(effectiveLevel);
        } catch {
          // Permission handler may not be registered yet
        }

        // Sync to active session (best-effort)
        if (params.sessionId) {
          try {
            const sdkAdapter = container.resolve<{
              setSessionPermissionLevel(
                sessionId: string,
                level: string
              ): Promise<void>;
            }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

            // Map frontend permission levels to SDK permission levels
            const sdkModeMap: Record<string, string> = {
              ask: 'default',
              'auto-edit': 'acceptEdits',
              yolo: 'bypassPermissions',
              plan: 'plan',
            };
            const sdkMode = sdkModeMap[effectiveLevel] || 'default';
            await sdkAdapter.setSessionPermissionLevel(
              params.sessionId,
              sdkMode
            );
          } catch {
            // Session sync is best-effort
          }
        }

        return {
          enabled: params.enabled,
          permissionLevel: params.permissionLevel,
        };
      } catch (error) {
        logger.error(
          '[Electron RPC] config:autopilot-toggle failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { enabled: false, permissionLevel: 'ask' };
      }
    }
  );

  // config:models-list - Get available models from SDK
  rpcHandler.registerMethod('config:models-list', async () => {
    try {
      const storageService = container.resolve<{
        get<T>(key: string, defaultValue: T): T;
      }>(TOKENS.STORAGE_SERVICE);
      const savedModel = storageService.get('model.selected', DEFAULT_MODEL);

      const sdkAdapter = container.resolve<{
        getSupportedModels(): Promise<
          Array<{
            value: string;
            displayName: string;
            description?: string;
          }>
        >;
      }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

      const supportedModels = await sdkAdapter.getSupportedModels();

      const models = supportedModels.map((m) => ({
        id: m.value,
        name: m.displayName,
        description: m.description,
        apiName: m.value,
        isSelected: m.value === savedModel,
        isRecommended:
          m.value.toLowerCase().includes('sonnet') ||
          (m.displayName || '').toLowerCase().includes('sonnet'),
      }));

      return { models };
    } catch (error) {
      logger.error(
        '[Electron RPC] config:models-list failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return { models: [] };
    }
  });

  // config:model-switch - Switch the active model
  rpcHandler.registerMethod(
    'config:model-switch',
    async (params: { model: string; sessionId?: string } | undefined) => {
      if (!params?.model) {
        return { success: false, error: 'model is required' };
      }

      try {
        const storageService = container.resolve<{
          set<T>(key: string, value: T): Promise<void>;
        }>(TOKENS.STORAGE_SERVICE);

        await storageService.set('model.selected', params.model);

        // Sync to active session (best-effort)
        if (params.sessionId) {
          try {
            const sdkAdapter = container.resolve<{
              setSessionModel(sessionId: string, model: string): Promise<void>;
            }>(SDK_TOKENS.SDK_AGENT_ADAPTER);
            await sdkAdapter.setSessionModel(params.sessionId, params.model);
          } catch {
            // Session model sync is best-effort
          }
        }

        return { model: params.model };
      } catch (error) {
        logger.error(
          '[Electron RPC] config:model-switch failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // Initialize permission handler from saved config at startup.
  // This ensures the saved autopilot permission level is applied immediately
  // rather than waiting for the user to toggle it in the UI.
  try {
    const initStorageService = container.resolve<{
      get<T>(key: string, defaultValue: T): T;
    }>(TOKENS.STORAGE_SERVICE);
    const savedEnabled = initStorageService.get('autopilot.enabled', false);
    const savedLevel = initStorageService.get(
      'autopilot.permissionLevel',
      'ask'
    );
    if (savedEnabled && savedLevel !== 'ask') {
      const permissionHandler = container.resolve<{
        setPermissionLevel(level: string): void;
      }>(SDK_TOKENS.SDK_PERMISSION_HANDLER);
      permissionHandler.setPermissionLevel(savedLevel);
      logger.info(
        '[Electron RPC] Initialized permission handler from saved config',
        { permissionLevel: savedLevel }
      );
    }
  } catch {
    // Permission handler may not be registered yet -- best-effort
    logger.debug(
      '[Electron RPC] Permission handler initialization skipped (best-effort)'
    );
  }
}

// ============================================================
// Command Methods (Electron-adapted)
// TASK_2025_201 Batch 3, Task 3.2
// ============================================================

function registerCommandMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // command:execute - Accept ptah.* commands silently, reject others
  rpcHandler.registerMethod(
    'command:execute',
    async (params: { command: string; args?: unknown[] } | undefined) => {
      if (!params?.command) {
        return { success: false, error: 'command is required' };
      }

      // In Electron, VS Code commands are not available.
      // Accept ptah.* commands silently (frontend expects success).
      if (params.command.startsWith('ptah.')) {
        logger.debug('[Electron RPC] command:execute no-op for ptah command', {
          command: params.command,
        });
        return { success: true };
      }

      return {
        success: false,
        error: `Command not available in Electron: ${params.command}`,
      };
    }
  );
}

// ============================================================
// Agent Methods (stop)
// TASK_2025_201 Batch 3, Task 3.2
// ============================================================

function registerAgentMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // agent:stop - Stop an active agent session via SDK
  rpcHandler.registerMethod(
    'agent:stop',
    async (params: { agentId: string } | undefined) => {
      if (!params?.agentId) {
        return { success: false, error: 'agentId is required' };
      }
      try {
        const sdkAdapter = container.resolve<{
          interruptSession(sessionId: string): Promise<void>;
        }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

        await sdkAdapter.interruptSession(params.agentId);
        return { success: true };
      } catch (error) {
        logger.error(
          '[Electron RPC] agent:stop failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

// ============================================================
// Quality Methods (export)
// TASK_2025_201 Batch 3, Task 3.3
// ============================================================

function registerQualityMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // quality:export - Generate quality report and return content to renderer
  rpcHandler.registerMethod(
    'quality:export',
    async (params: { format?: string } | undefined) => {
      const format = params?.format ?? 'markdown';
      const validFormats = ['markdown', 'json', 'csv'];
      if (!validFormats.includes(format)) {
        return {
          success: false,
          error: `Invalid export format: ${format}. Supported: ${validFormats.join(
            ', '
          )}`,
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return {
            success: false,
            error: 'No workspace folder open.',
          };
        }

        const intelligenceService = container.resolve<{
          getIntelligence(path: string): Promise<unknown>;
        }>(TOKENS.PROJECT_INTELLIGENCE_SERVICE);

        const exportService = container.resolve<{
          exportMarkdown(data: unknown): string;
          exportJson(data: unknown): string;
          exportCsv(data: unknown): string;
        }>(TOKENS.QUALITY_EXPORT_SERVICE);

        const intelligence = await intelligenceService.getIntelligence(
          workspaceRoot
        );

        const dateStamp = new Date().toISOString().split('T')[0];
        let content: string;
        let filename: string;
        let mimeType: string;

        switch (format) {
          case 'json':
            content = exportService.exportJson(intelligence);
            filename = `quality-report-${dateStamp}.json`;
            mimeType = 'application/json';
            break;
          case 'csv':
            content = exportService.exportCsv(intelligence);
            filename = `quality-report-${dateStamp}.csv`;
            mimeType = 'text/csv';
            break;
          case 'markdown':
          default:
            content = exportService.exportMarkdown(intelligence);
            filename = `quality-report-${dateStamp}.md`;
            mimeType = 'text/markdown';
            break;
        }

        return { content, filename, mimeType };
      } catch (error) {
        logger.error(
          '[Electron RPC] quality:export failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

// ============================================================
// Wizard Methods (9 methods total)
// TASK_2025_201 Batch 3, Tasks 3.4, 3.5, 3.6
// ============================================================

function registerWizardMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler,
  logger: Logger
): void {
  // ----- Task 3.4: setup-wizard:launch, wizard:cancel, wizard:cancel-analysis -----

  // setup-wizard:launch - Launch the wizard for the current workspace
  rpcHandler.registerMethod('setup-wizard:launch', async () => {
    try {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER
      );
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();

      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      const wizardService = container.resolve<{
        launchWizard(path: string): {
          isErr(): boolean;
          error?: { message?: string };
        };
      }>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE);

      const result = wizardService.launchWizard(workspaceRoot);
      if (result.isErr()) {
        return {
          success: false,
          error: result.error?.message || 'Failed to launch wizard',
        };
      }

      return { success: true };
    } catch (error) {
      logger.error(
        '[Electron RPC] setup-wizard:launch failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // wizard:cancel - Cancel the wizard and optionally save progress
  rpcHandler.registerMethod(
    'wizard:cancel',
    async (params: { saveProgress?: boolean } | undefined) => {
      try {
        const wizardService = container.resolve<{
          getCurrentSession(): { sessionId: string } | null;
          cancelWizard(id: string, save: boolean): void;
        }>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE);

        const session = wizardService.getCurrentSession();
        if (!session) {
          isGenerating = false;
          generationStartedAt = null;
          return { cancelled: false };
        }

        const saveProgress = params?.saveProgress ?? true;
        wizardService.cancelWizard(session.sessionId, saveProgress);
        isGenerating = false;
        generationStartedAt = null;

        return {
          cancelled: true,
          sessionId: session.sessionId,
          progressSaved: saveProgress,
        };
      } catch (error) {
        logger.error(
          '[Electron RPC] wizard:cancel failed',
          error instanceof Error ? error : new Error(String(error))
        );
        isGenerating = false;
        generationStartedAt = null;
        return { cancelled: false };
      }
    }
  );

  // wizard:cancel-analysis - Cancel both multi-phase and agentic analysis
  rpcHandler.registerMethod('wizard:cancel-analysis', async () => {
    let anyCancelled = false;

    try {
      const multiPhaseService = container.resolve<{
        cancelAnalysis(): void;
      }>(AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE);
      multiPhaseService.cancelAnalysis();
      anyCancelled = true;
    } catch {
      // Multi-phase analysis service may not be registered
    }

    try {
      const agenticService = container.resolve<{
        cancelAnalysis(): void;
      }>(AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE);
      agenticService.cancelAnalysis();
      anyCancelled = true;
    } catch {
      // Agentic analysis service may not be registered
    }

    return { cancelled: anyCancelled };
  });

  // ----- Task 3.5: wizard:deep-analyze, wizard:list-analyses, wizard:load-analysis, wizard:recommend-agents -----

  // wizard:deep-analyze - Run multi-phase deep workspace analysis
  rpcHandler.registerMethod(
    'wizard:deep-analyze',
    async (params: { model?: string } | undefined) => {
      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return {
            success: false,
            error: 'No workspace folder open',
          };
        }

        // Get model from params or storage
        let model = params?.model;
        if (!model) {
          try {
            const storageService = container.resolve<{
              get<T>(key: string, defaultValue: T): T;
            }>(TOKENS.STORAGE_SERVICE);
            model = storageService.get('model.selected', DEFAULT_MODEL);
          } catch {
            model = DEFAULT_MODEL;
          }
        }

        const analysisService = container.resolve<{
          analyzeWorkspace(
            path: string,
            opts: unknown
          ): Promise<{
            isErr(): boolean;
            error?: { message?: string };
            value?: unknown;
          }>;
        }>(AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE);

        const result = await analysisService.analyzeWorkspace(workspaceRoot, {
          model,
          isPremium: true,
          mcpServerRunning: false,
        });

        if (result.isErr()) {
          return {
            success: false,
            error: result.error?.message || 'Multi-phase analysis failed',
          };
        }

        const manifest = result.value as {
          slug: string;
          phases: Array<{
            file: string;
            status: string;
          }>;
        };

        // Read phase file contents from the analysis directory
        const storageService = container.resolve<{
          getSlugDir(workspacePath: string, slug: string): string;
          readPhaseFile(
            slugDir: string,
            filename: string
          ): Promise<string | null>;
        }>(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE);

        const slugDir = storageService.getSlugDir(workspaceRoot, manifest.slug);

        const phaseContents: Record<string, string> = {};
        if (manifest.phases) {
          for (const phase of manifest.phases) {
            if (phase.status === 'completed' && phase.file) {
              const content = await storageService.readPhaseFile(
                slugDir,
                phase.file
              );
              if (content) {
                phaseContents[phase.file] = content;
              }
            }
          }
        }

        return {
          isMultiPhase: true,
          manifest,
          phaseContents,
          analysisDir: slugDir,
        };
      } catch (error) {
        logger.error(
          '[Electron RPC] wizard:deep-analyze failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // wizard:list-analyses - List saved analyses for the workspace
  rpcHandler.registerMethod('wizard:list-analyses', async () => {
    try {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER
      );
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return { analyses: [] };
      }

      const storageService = container.resolve<{
        list(path: string): Promise<unknown[]>;
      }>(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE);

      const analyses = await storageService.list(workspaceRoot);
      return { analyses };
    } catch (error) {
      logger.warn(
        '[Electron RPC] wizard:list-analyses failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return { analyses: [] };
    }
  });

  // wizard:load-analysis - Load a specific analysis result
  rpcHandler.registerMethod(
    'wizard:load-analysis',
    async (params: { filename: string } | undefined) => {
      if (!params?.filename) {
        return {
          success: false,
          error: 'filename is required',
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return {
            success: false,
            error: 'No workspace folder open',
          };
        }

        const storageService = container.resolve<{
          loadMultiPhase(path: string, filename: string): Promise<unknown>;
        }>(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE);

        const result = await storageService.loadMultiPhase(
          workspaceRoot,
          params.filename
        );
        return result;
      } catch (error) {
        logger.error(
          '[Electron RPC] wizard:load-analysis failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // wizard:recommend-agents - Get agent recommendations based on analysis
  rpcHandler.registerMethod(
    'wizard:recommend-agents',
    async (params: { analysisData: unknown } | undefined) => {
      if (!params?.analysisData) {
        return {
          success: false,
          error: 'analysisData is required',
        };
      }

      try {
        // Multi-phase analysis: return all 13 agents with full recommendation
        const analysisObj = params.analysisData as {
          isMultiPhase?: boolean;
        };
        if (analysisObj.isMultiPhase === true) {
          const agentCatalog = [
            {
              agentId: 'project-manager',
              category: 'planning',
              description: 'Strategic planning and task decomposition',
            },
            {
              agentId: 'software-architect',
              category: 'planning',
              description: 'System design and architecture decisions',
            },
            {
              agentId: 'team-leader',
              category: 'planning',
              description: 'Task orchestration and batch management',
            },
            {
              agentId: 'backend-developer',
              category: 'development',
              description: 'Server-side implementation',
            },
            {
              agentId: 'frontend-developer',
              category: 'development',
              description: 'UI/UX implementation',
            },
            {
              agentId: 'devops-engineer',
              category: 'development',
              description: 'CI/CD and infrastructure',
            },
            {
              agentId: 'senior-tester',
              category: 'qa',
              description: 'Test strategy and implementation',
            },
            {
              agentId: 'code-style-reviewer',
              category: 'qa',
              description: 'Code style and conventions',
            },
            {
              agentId: 'code-logic-reviewer',
              category: 'qa',
              description: 'Business logic correctness',
            },
            {
              agentId: 'researcher-expert',
              category: 'specialist',
              description: 'Deep technical research',
            },
            {
              agentId: 'modernization-detector',
              category: 'specialist',
              description: 'Technology modernization',
            },
            {
              agentId: 'technical-content-writer',
              category: 'creative',
              description: 'Documentation and content',
            },
            {
              agentId: 'ui-ux-designer',
              category: 'creative',
              description: 'Visual design and UX',
            },
          ];

          const recommendations = agentCatalog.map((agent) => ({
            agentId: agent.agentId,
            agentName: agent.agentId
              .split('-')
              .map((w) => w[0].toUpperCase() + w.slice(1))
              .join(' '),
            category: agent.category,
            relevanceScore: 100,
            recommended: true,
            matchedCriteria: ['Multi-phase analysis (all agents recommended)'],
            description: agent.description,
          }));

          return { recommendations };
        }

        // Legacy analysis: delegate to recommendation service
        const recommendationService = container.resolve<{
          calculateRecommendations(data: unknown): Promise<unknown>;
        }>(AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE);

        const result = await recommendationService.calculateRecommendations(
          params.analysisData
        );
        return { recommendations: result };
      } catch (error) {
        logger.error(
          '[Electron RPC] wizard:recommend-agents failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // ----- Task 3.6: wizard:submit-selection, wizard:retry-item -----

  // wizard:submit-selection - Start agent generation (fire-and-forget)
  rpcHandler.registerMethod(
    'wizard:submit-selection',
    async (
      params:
        | {
            selectedAgentIds: string[];
            threshold?: number;
            variableOverrides?: Record<string, string>;
            analysisData?: unknown;
            analysisDir?: string;
            model?: string;
          }
        | undefined
    ) => {
      if (!params?.selectedAgentIds?.length) {
        return {
          success: false,
          error: 'No agents selected. Please select at least one agent.',
        };
      }

      checkAndResetStaleness(logger);

      if (isGenerating) {
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete or cancel it first.',
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return {
            success: false,
            error: 'No workspace folder open.',
          };
        }

        isGenerating = true;
        generationStartedAt = Date.now();

        const orchestrator = container.resolve<{
          generateAgents(
            options: unknown,
            progressCallback?: (progress: {
              phase: string;
              percentComplete: number;
              currentOperation?: string;
            }) => void
          ): Promise<{
            isOk?(): boolean;
            value?: unknown;
          }>;
        }>(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR);

        // Resolve WebviewManager for progress broadcasting (best-effort)
        let webviewManager: {
          broadcastMessage(type: string, payload: unknown): Promise<void>;
        } | null = null;
        try {
          webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER);
        } catch {
          logger.warn(
            '[Electron RPC] WebviewManager not available for progress broadcasting'
          );
        }

        // Resolve enhanced prompt content (best-effort)
        let enhancedPromptContent: string | undefined;
        try {
          const enhancedPromptsService = container.resolve<{
            getEnhancedPromptContent(path: string): Promise<string | undefined>;
          }>(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE);
          enhancedPromptContent =
            await enhancedPromptsService.getEnhancedPromptContent(
              workspaceRoot
            );
        } catch {
          // Enhanced prompts service not available
        }

        // Build generation options
        const options = {
          workspacePath: workspaceRoot,
          userOverrides: params.selectedAgentIds,
          threshold: params.threshold,
          variableOverrides: params.variableOverrides,
          enhancedPromptContent,
          preComputedAnalysis: params.analysisData,
          isPremium: true,
          mcpServerRunning: false,
          model: params.model,
          analysisDir: params.analysisDir,
        };

        // Progress callback broadcasts to renderer
        const progressCallback = (progress: {
          phase: string;
          percentComplete: number;
          currentOperation?: string;
        }): void => {
          try {
            if (!webviewManager) return;
            webviewManager
              .broadcastMessage('setup-wizard:generation-progress', {
                progress: {
                  phase:
                    progress.phase === 'writing' ? 'rendering' : progress.phase,
                  percentComplete: progress.percentComplete,
                  currentAgent: progress.currentOperation,
                },
              })
              .catch((broadcastError) => {
                logger.warn(
                  '[Electron RPC] Failed to broadcast generation progress',
                  {
                    error:
                      broadcastError instanceof Error
                        ? broadcastError.message
                        : String(broadcastError),
                  }
                );
              });
          } catch {
            // Swallow synchronous errors to avoid crashing generation
          }
        };

        // Fire-and-forget: run generation in background
        orchestrator
          .generateAgents(options, progressCallback)
          .then((result) => {
            if (webviewManager) {
              webviewManager
                .broadcastMessage('setup-wizard:generation-complete', {
                  success: true,
                  result: result.isOk?.() ? result.value : result,
                })
                .catch((err) => {
                  logger.warn(
                    '[Electron RPC] Failed to broadcast generation complete',
                    {
                      error: err instanceof Error ? err.message : String(err),
                    }
                  );
                });
            }
          })
          .catch((error) => {
            logger.error(
              '[Electron RPC] Agent generation failed',
              error instanceof Error ? error : new Error(String(error))
            );
            if (webviewManager) {
              webviewManager
                .broadcastMessage('setup-wizard:generation-complete', {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                })
                .catch(() => {
                  // Swallow broadcast errors
                });
            }
          })
          .finally(() => {
            isGenerating = false;
            generationStartedAt = null;
          });

        return { success: true };
      } catch (error) {
        isGenerating = false;
        generationStartedAt = null;
        logger.error(
          '[Electron RPC] wizard:submit-selection failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // wizard:retry-item - Retry generation for a single agent
  rpcHandler.registerMethod(
    'wizard:retry-item',
    async (params: { itemId: string } | undefined) => {
      if (!params?.itemId) {
        return { success: false, error: 'itemId is required' };
      }

      checkAndResetStaleness(logger);

      if (isGenerating) {
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete.',
        };
      }

      try {
        const workspaceProvider = container.resolve<IWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER
        );
        const workspaceRoot = workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          return {
            success: false,
            error: 'No workspace folder open.',
          };
        }

        isGenerating = true;
        generationStartedAt = Date.now();

        const orchestrator = container.resolve<{
          generateAgents(
            options: unknown,
            progressCallback?: (progress: {
              phase: string;
              percentComplete: number;
              currentOperation?: string;
            }) => void
          ): Promise<{
            isOk?(): boolean;
            value?: unknown;
          }>;
        }>(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR);

        let webviewManager: {
          broadcastMessage(type: string, payload: unknown): Promise<void>;
        } | null = null;
        try {
          webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER);
        } catch {
          // WebviewManager not available
        }

        const options = {
          workspacePath: workspaceRoot,
          userOverrides: [params.itemId],
          isPremium: true,
          mcpServerRunning: false,
        };

        try {
          const result = await orchestrator.generateAgents(options);

          if (webviewManager) {
            webviewManager
              .broadcastMessage('setup-wizard:generation-complete', {
                success: true,
                result: result.isOk?.() ? result.value : result,
              })
              .catch(() => {
                // Swallow broadcast errors
              });
          }

          return { success: true };
        } catch (genError) {
          logger.error(
            '[Electron RPC] wizard:retry-item generation failed',
            genError instanceof Error ? genError : new Error(String(genError))
          );

          if (webviewManager) {
            webviewManager
              .broadcastMessage('setup-wizard:generation-complete', {
                success: false,
                error:
                  genError instanceof Error
                    ? genError.message
                    : String(genError),
              })
              .catch(() => {
                // Swallow broadcast errors
              });
          }

          return {
            success: false,
            error:
              genError instanceof Error ? genError.message : String(genError),
          };
        } finally {
          isGenerating = false;
          generationStartedAt = null;
        }
      } catch (error) {
        isGenerating = false;
        generationStartedAt = null;
        logger.error(
          '[Electron RPC] wizard:retry-item failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

/**
 * Recursively build a file tree structure from a directory.
 * Limits depth to prevent excessive I/O on deep directory structures.
 */
async function buildFileTree(
  fs: {
    readDirectory(path: string): Promise<{ name: string; type: number }[]>;
  },
  dirPath: string,
  maxDepth: number,
  currentDepth = 0
): Promise<
  {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: unknown[];
  }[]
> {
  if (currentDepth >= maxDepth) return [];

  try {
    const entries = await fs.readDirectory(dirPath);
    const result: {
      name: string;
      path: string;
      type: 'file' | 'directory';
      children?: unknown[];
    }[] = [];

    // Sort: directories first, then alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 2 ? -1 : 1; // Directory = 2
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      // Skip hidden files/dirs and node_modules
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist'
      ) {
        continue;
      }

      const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
      const isDir = (entry.type & 2) !== 0; // FileType.Directory = 2

      if (isDir) {
        const children = await buildFileTree(
          fs,
          fullPath,
          maxDepth,
          currentDepth + 1
        );
        result.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        });
      } else {
        result.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
        });
      }
    }

    return result;
  } catch {
    return [];
  }
}
