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

  // ========================================
  // Session RPC Methods (platform-agnostic)
  // ========================================
  registerSessionMethods(container, rpcHandler);

  // ========================================
  // Chat RPC Methods (platform-adapted)
  // ========================================
  registerChatMethods(container, rpcHandler);

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
 * Register chat RPC methods with Electron-compatible workspace resolution.
 * In VS Code, workspace comes from vscode.workspace.workspaceFolders.
 * In Electron, it comes from IWorkspaceProvider.
 */
function registerChatMethods(
  container: DependencyContainer,
  rpcHandler: RpcHandler
): void {
  rpcHandler.registerMethod(
    'chat:start',
    async (
      params:
        | { message: string; contextFiles?: string[]; tabId?: string }
        | undefined
    ) => {
      if (!params?.message) {
        return { success: false, error: 'message is required' };
      }

      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER
      );
      const sdkAdapter = container.resolve<{
        startSession(options: {
          message: string;
          workspacePath: string;
          contextFiles?: string[];
          tabId?: string;
        }): Promise<{ sessionId: string }>;
      }>(SDK_TOKENS.SDK_AGENT_ADAPTER);

      const workspaceRoot = workspaceProvider.getWorkspaceRoot() ?? '';

      return sdkAdapter.startSession({
        message: params.message,
        workspacePath: workspaceRoot,
        contextFiles: params.contextFiles,
        tabId: params.tabId,
      });
    }
  );

  rpcHandler.registerMethod(
    'chat:abort',
    async (params: { sessionId: string } | undefined) => {
      if (!params?.sessionId) {
        return { success: false, error: 'sessionId is required' };
      }
      const sdkAdapter = container.resolve<{
        abortSession(sessionId: string): Promise<void>;
      }>(SDK_TOKENS.SDK_AGENT_ADAPTER);
      await sdkAdapter.abortSession(params.sessionId);
      return { success: true };
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
        'claude-sonnet-4-20250514'
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
