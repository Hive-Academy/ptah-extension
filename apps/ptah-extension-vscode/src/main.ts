// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  ClaudeCliService,
  SessionManager,
} from '@ptah-extension/claude-domain';
import type { SessionId } from '@ptah-extension/shared';
import * as vscode from 'vscode';
import { PtahExtension } from './core/ptah-extension';
import { DIContainer } from './di/container';
import { ContextMessageBridgeService } from './services/context-message-bridge.service';

let ptahExtension: PtahExtension | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('===== PTAH ACTIVATION START =====');
  try {
    // Initialize centralized DI Container with ALL services
    console.log('[Activate] Step 1: Setting up DI Container...');
    DIContainer.setup(context);
    console.log('[Activate] Step 1: DI Container setup complete');

    // Get logger from DI container
    console.log('[Activate] Step 2: Resolving Logger...');
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');
    console.log('[Activate] Step 2: Logger resolved');

    // Initialize ContextMessageBridgeService (architectural bridge for file include/exclude)
    console.log(
      '[Activate] Step 3.5: Initializing ContextMessageBridgeService...'
    );
    const contextBridge = DIContainer.getContainer().resolve(
      ContextMessageBridgeService
    );
    contextBridge.initialize();
    context.subscriptions.push({ dispose: () => contextBridge.dispose() });
    logger.info('ContextMessageBridgeService initialized');
    console.log('[Activate] Step 3.5: ContextMessageBridgeService initialized');

    // Register RPC Methods (Phase 2 - TASK_2025_021)
    console.log('[Activate] Step 3.6: Registering RPC methods...');
    const rpcHandler = DIContainer.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    const claudeCliService = DIContainer.resolve<ClaudeCliService>(
      TOKENS.CLAUDE_CLI_SERVICE
    );
    const sessionManager = DIContainer.resolve<SessionManager>(
      TOKENS.SESSION_MANAGER
    );

    // Session operations (restored - TASK_2025_021)
    rpcHandler.registerMethod('session:list', async () => {
      try {
        logger.debug('RPC: session:list called');
        const sessions = sessionManager.getAllSessions();
        // Return SessionUIData format for frontend
        return sessionManager.getSessionsUIData();
      } catch (error) {
        logger.error('RPC: session:list failed', error);
        throw new Error(
          `Failed to list sessions: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    rpcHandler.registerMethod('session:get', async (params: any) => {
      try {
        const { id } = params;
        logger.debug('RPC: session:get called', { id });
        const session = sessionManager.getSession(id as SessionId);
        return session ?? null;
      } catch (error) {
        logger.error('RPC: session:get failed', error);
        throw new Error(
          `Failed to get session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    rpcHandler.registerMethod('session:create', async (params: any) => {
      try {
        const { name } = params;
        logger.debug('RPC: session:create called', { name });
        const session = await sessionManager.createSession({ name });
        return session.id;
      } catch (error) {
        logger.error('RPC: session:create failed', error);
        throw new Error(
          `Failed to create session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    rpcHandler.registerMethod('session:switch', async (params: any) => {
      try {
        const { id } = params;
        logger.debug('RPC: session:switch called', { id });
        const success = await sessionManager.switchSession(id as SessionId);
        if (!success) {
          throw new Error(`Session not found: ${id}`);
        }
        return;
      } catch (error) {
        logger.error('RPC: session:switch failed', error);
        throw new Error(
          `Failed to switch session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // Chat operations (uses ClaudeCliService)
    rpcHandler.registerMethod('chat:sendMessage', async (params: any) => {
      try {
        const { content, files, sessionId } = params;
        logger.debug('RPC: chat:sendMessage called', {
          contentLength: content?.length,
          fileCount: files?.length,
          sessionId,
        });

        // Use ClaudeCliService to send message
        const stream = await claudeCliService.sendMessage(
          sessionId,
          content,
          files
        );

        // For RPC, we return immediately (streaming handled separately)
        // TODO: Implement proper streaming response when RPC streaming is added
        return { success: true };
      } catch (error) {
        logger.error('RPC: chat:sendMessage failed', error);
        throw new Error(
          `Failed to send message: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // File operations (frontend may read directly, this is optional)
    rpcHandler.registerMethod('file:read', async (params: any) => {
      try {
        const { sessionId } = params;
        // TODO: Implement session file reading when needed
        logger.debug('RPC: file:read called', { sessionId });
        return null;
      } catch (error) {
        logger.error('RPC: file:read failed', error);
        throw new Error(
          `Failed to read file: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    logger.info('RPC methods registered', {
      methods: rpcHandler.getRegisteredMethods(),
    });
    console.log(
      '[Activate] Step 3.6: RPC methods registered:',
      rpcHandler.getRegisteredMethods()
    );

    // Initialize main extension controller
    console.log('[Activate] Step 4: Creating PtahExtension instance...');
    ptahExtension = new PtahExtension(context);
    console.log('[Activate] Step 4: PtahExtension instance created');

    console.log('[Activate] Step 5: Calling ptahExtension.initialize()...');
    await ptahExtension.initialize();
    console.log('[Activate] Step 5: ptahExtension.initialize() complete');

    // Register late-binding adapters (require PtahExtension initialization)
    console.log('[Activate] Step 6: Registering late-binding adapters...');
    // NOTE: CONFIGURATION_PROVIDER is now registered in DIContainer.setup()
    // It was moved there to fix dependency injection order (ConfigOrchestrationService depends on it)
    console.log(
      '[Activate] Step 6: Late-binding adapters registered (analytics removed)'
    );

    // Register all providers, commands, and services
    console.log('[Activate] Step 7: Calling ptahExtension.registerAll()...');
    await ptahExtension.registerAll();
    console.log('[Activate] Step 7: ptahExtension.registerAll() complete');

    // Register Language Model Tools with VS Code
    console.log('[Activate] Step 8: Registering Language Model Tools...');
    const lmToolsService = DIContainer.resolve(
      TOKENS.LM_TOOLS_REGISTRATION_SERVICE
    );
    (
      lmToolsService as {
        registerAll: (context: vscode.ExtensionContext) => void;
      }
    ).registerAll(context);
    logger.info('Language Model Tools registered (6 tools)');
    console.log('[Activate] Step 8: Language Model Tools registered');

    // Start Code Execution MCP Server
    console.log('[Activate] Step 9: Starting Code Execution MCP Server...');
    const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
    const mcpPort = await (
      codeExecutionMCP as { start: () => Promise<number> }
    ).start();
    context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
    logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
    console.log(
      `[Activate] Step 9: Code Execution MCP Server started (port ${mcpPort})`
    );

    // Register Ptah MCP server with Claude CLI (one-time)
    console.log(
      '[Activate] Step 10: Registering MCP server with Claude CLI...'
    );
    try {
      const mcpRegistration = DIContainer.resolve(
        TOKENS.MCP_REGISTRATION_SERVICE
      );
      await (
        mcpRegistration as { registerPtahMCPServer: () => Promise<void> }
      ).registerPtahMCPServer();

      logger.info('MCP server registered with Claude CLI', {
        context: 'Extension Activation',
        status: 'registered',
        scope: 'local',
        url: 'http://localhost:${PTAH_MCP_PORT}',
      });
      console.log('[Activate] Step 10: MCP server registered with Claude CLI');
    } catch (error) {
      logger.error(
        'Failed to register MCP server (non-blocking)',
        'Extension Activation',
        error
      );
      console.warn(
        '[Activate] Step 10: MCP registration failed (non-blocking)',
        error
      );
      // Don't block extension activation if MCP registration fails
    }

    logger.info('Ptah extension activated successfully');
    console.log('===== PTAH ACTIVATION COMPLETE =====');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    console.error('===== PTAH ACTIVATION FAILED =====');
    console.error('[Activate] Error details:', error);
    console.error(
      '[Activate] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error('Failed to activate Ptah extension', error);
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');
  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
