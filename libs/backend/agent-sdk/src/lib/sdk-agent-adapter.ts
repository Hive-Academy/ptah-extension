/**
 * SDK Agent Adapter - IAIProvider implementation using official Claude Agent SDK
 *
 * This adapter replaces CLI-based integration with direct in-process SDK communication,
 * providing 10x performance improvements and eliminating correlation bugs.
 */

import { injectable, inject } from 'tsyringe';
import {
  IAIProvider,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderCapabilities,
  AISessionConfig,
  AIMessageOptions,
  SessionId,
  ExecutionNode,
} from '@ptah-extension/shared';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { SdkMessageTransformer } from './sdk-message-transformer';
import { SdkSessionStorage } from './sdk-session-storage';
import { SdkPermissionHandler } from './sdk-permission-handler';
import { StoredSession, StoredSessionMessage } from './types/sdk-session.types';
import { MessageId } from '@ptah-extension/shared';
import * as vscode from 'vscode';
import { createPtahTools } from './ptah-tools-server';

/**
 * SDK Types - Structural typing to avoid ESM/CommonJS import issues
 *
 * The SDK package is ESM-only ("type": "module"), but this library is CommonJS.
 * We use structural typing (duck typing) to accept SDK types without imports.
 * These interfaces match the runtime shape of SDK types without requiring
 * compile-time type compatibility with the ESM module.
 *
 * Dynamic import() is used at runtime (see line ~250 for query function).
 */

/**
 * UUID type for SDK message identifiers
 */
type UUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * User message structure for SDK streaming input
 * Structurally matches SDK's SDKUserMessage type
 */
type SDKUserMessage = {
  type: 'user';
  uuid: UUID;
  session_id: string;
  message: {
    role: 'user';
    content: string;
  };
  parent_tool_use_id: string | null;
};

/**
 * Generic SDK message type for internal type hints
 * Uses structural typing to accept any SDK message
 */
type SDKMessage = {
  type: string;
  [key: string]: any;
};

/**
 * Query interface - matches SDK's Query runtime structure
 * Uses structural typing for AsyncGenerator to accept SDK's actual Query type
 */
interface Query {
  [Symbol.asyncIterator](): AsyncIterator<any, void>;
  next(...args: any[]): Promise<IteratorResult<any, void>>;
  return?(value?: any): Promise<IteratorResult<any, void>>;
  throw?(e?: any): Promise<IteratorResult<any, void>>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
}

/**
 * Provider capabilities for SDK-based integration
 */
const SDK_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: true,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: false, // SDK doesn't support image analysis yet
  functionCalling: true, // Tool calling supported via preset tools
};

/**
 * Provider information for SDK adapter
 */
const SDK_PROVIDER_INFO: ProviderInfo = {
  id: 'claude-cli' as ProviderId, // Keep same ID for compatibility
  name: 'Claude Agent SDK',
  version: '1.0.0',
  description: 'Official Claude Agent SDK integration (in-process)',
  vendor: 'Anthropic',
  capabilities: SDK_CAPABILITIES,
  maxContextTokens: 200000, // Context window for Claude Sonnet 4.5
  supportedModels: [
    'claude-sonnet-4.5-20250929',
    'claude-opus-4.5-20251101',
    'claude-haiku-4.0-20250107',
  ],
};

/**
 * Active session tracking
 *
 * SYNCHRONIZATION PROTOCOL:
 * - messageQueue: Array of pending user messages
 * - resolveNext: Callback set by generator when waiting for messages
 * - The generator sets resolveNext when queue is empty
 * - sendMessageToSession pushes to queue AND calls resolveNext if set
 * - Abort signal resolves any pending Promise to prevent memory leaks
 */
interface ActiveSession {
  readonly sessionId: SessionId;
  readonly query: Query;
  readonly config: AISessionConfig;
  readonly abortController: AbortController;
  // Mutable: Message queue for streaming input mode
  messageQueue: SDKUserMessage[];
  // Mutable: Callback to wake iterator when message arrives
  resolveNext: (() => void) | null;
  // Mutable: Current model (may differ from config.model after setModel())
  currentModel: string;
}

/**
 * Helper function to get message role from SDK message type
 * Ensures type-safe role mapping for StoredSessionMessage
 */
function getRoleFromSDKMessage(
  sdkMessage: SDKMessage
): 'user' | 'assistant' | 'system' {
  switch (sdkMessage.type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'result':
      return 'system';
    default:
      return 'assistant'; // fallback
  }
}

/**
 * SdkAgentAdapter - Core SDK wrapper implementing IAIProvider
 *
 * Provides streaming agent communication via the official SDK's query() function,
 * transforming SDK messages to ExecutionNode format for UI compatibility.
 */
@injectable()
export class SdkAgentAdapter implements IAIProvider {
  readonly providerId: ProviderId = 'claude-cli' as ProviderId;
  readonly info: ProviderInfo = SDK_PROVIDER_INFO;

  private initialized = false;
  private health: ProviderHealth = {
    status: 'initializing' as ProviderStatus,
    lastCheck: Date.now(),
  };

  /**
   * Active sessions map: SessionId → ActiveSession
   */
  private activeSessions = new Map<string, ActiveSession>();

  /**
   * Message transformer for SDK → ExecutionNode conversion
   */
  private transformer: SdkMessageTransformer;

  /**
   * Config watchers for automatic re-initialization on auth changes
   */
  private configWatchers: vscode.Disposable[] = [];

  /**
   * State machine flag to prevent concurrent re-initialization
   */
  private isReinitializing = false;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject('SdkSessionStorage') private storage: SdkSessionStorage,
    @inject('SdkPermissionHandler')
    private permissionHandler: SdkPermissionHandler
  ) {
    this.transformer = new SdkMessageTransformer(logger);
  }

  /**
   * Initialize the SDK adapter
   * No CLI detection needed - SDK is in-process
   */
  async initialize(): Promise<boolean> {
    try {
      this.logger.info('[SdkAgentAdapter] Initializing SDK adapter...');

      // Configure authentication from settings or environment variables
      // Priority: Settings > Environment Variables
      const authMethod = this.config.get<string>('authMethod') || 'auto';
      this.logger.debug(`[SdkAgentAdapter] Auth method: ${authMethod}`);

      let authConfigured = false;

      // Try OAuth token
      if (authMethod === 'oauth' || authMethod === 'auto') {
        const oauthToken = this.config.get<string>('claudeOAuthToken');
        if (oauthToken?.trim()) {
          process.env['CLAUDE_CODE_OAUTH_TOKEN'] = oauthToken.trim();
          this.logger.info(
            '[SdkAgentAdapter] Using Claude OAuth token from settings'
          );
          authConfigured = true;
        } else if (process.env['CLAUDE_CODE_OAUTH_TOKEN']) {
          this.logger.info(
            '[SdkAgentAdapter] Using Claude OAuth token from environment'
          );
          authConfigured = true;
        }
      }

      // Try API key
      if (authMethod === 'apiKey' || authMethod === 'auto') {
        const apiKey = this.config.get<string>('anthropicApiKey');
        if (apiKey?.trim()) {
          process.env['ANTHROPIC_API_KEY'] = apiKey.trim();
          this.logger.info(
            '[SdkAgentAdapter] Using Anthropic API key from settings'
          );
          authConfigured = true;
        } else if (process.env['ANTHROPIC_API_KEY']) {
          this.logger.info(
            '[SdkAgentAdapter] Using Anthropic API key from environment'
          );
          authConfigured = true;
        }
      }

      // Validate at least one auth method is available
      if (!authConfigured) {
        this.logger.error(
          '[SdkAgentAdapter] No authentication configured. Please set ptah.claudeOAuthToken or ptah.anthropicApiKey in VS Code settings (Ctrl+,).'
        );
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage:
            'No authentication configured. Set ptah.claudeOAuthToken or ptah.anthropicApiKey in Settings.',
        };
        return false;
      }

      // SDK requires no external dependencies - in-process execution
      this.initialized = true;
      this.health = {
        status: 'available' as ProviderStatus,
        lastCheck: Date.now(),
        responseTime: 0,
        uptime: Date.now(),
      };

      // Register config watchers for automatic re-initialization on auth changes
      this.registerConfigWatchers();

      this.logger.info('[SdkAgentAdapter] Initialized successfully');
      return true;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error('[SdkAgentAdapter] Initialization failed', errorObj);
      this.health = {
        status: 'error' as ProviderStatus,
        lastCheck: Date.now(),
        errorMessage: errorObj.message,
      };
      return false;
    }
  }

  /**
   * Register ConfigManager watchers for automatic re-initialization
   * Watches auth-related settings and triggers re-init on changes
   */
  private registerConfigWatchers(): void {
    // Dispose existing watchers first (in case of re-initialization)
    for (const watcher of this.configWatchers) {
      watcher.dispose();
    }
    this.configWatchers = [];

    const watchKeys = ['claudeOAuthToken', 'anthropicApiKey', 'authMethod'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async (value) => {
        // Prevent concurrent re-initialization
        if (this.isReinitializing) {
          this.logger.debug(
            `[SdkAgentAdapter] Skipping re-init, already in progress (${key} changed)`
          );
          return;
        }

        this.logger.info(
          `[SdkAgentAdapter] Auth config changed (${key}), re-initializing...`
        );
        this.isReinitializing = true;

        try {
          // Gracefully abort active sessions before re-init
          for (const [sessionId, session] of this.activeSessions.entries()) {
            this.logger.debug(
              `[SdkAgentAdapter] Aborting session ${sessionId} for re-init`
            );
            try {
              await session.query.interrupt();
            } catch (err) {
              this.logger.warn(
                `[SdkAgentAdapter] Failed to interrupt session ${sessionId} during re-init`,
                err instanceof Error ? err : new Error(String(err))
              );
            }
          }
          this.activeSessions.clear();

          // Re-initialize with new auth settings
          await this.initialize();
        } catch (error) {
          this.logger.error(
            '[SdkAgentAdapter] Re-initialization failed after config change',
            error instanceof Error ? error : new Error(String(error))
          );
        } finally {
          this.isReinitializing = false;
        }
      });

      this.configWatchers.push(watcher);
    }

    this.logger.debug(
      `[SdkAgentAdapter] Registered ${watchKeys.length} config watchers`
    );
  }

  /**
   * Dispose all active sessions and cleanup
   */
  dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');

    // Dispose config watchers
    for (const watcher of this.configWatchers) {
      watcher.dispose();
    }
    this.configWatchers = [];

    // End all active sessions
    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[SdkAgentAdapter] Ending session: ${sessionId}`);
      session.abortController.abort();
      session.query.interrupt().catch((err) => {
        this.logger.warn(
          `[SdkAgentAdapter] Failed to interrupt session ${sessionId}`,
          err
        );
      });
    }

    this.activeSessions.clear();
    this.initialized = false;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }

  /**
   * Verify installation - SDK is bundled, always available
   */
  async verifyInstallation(): Promise<boolean> {
    return true; // SDK is bundled as npm dependency
  }

  /**
   * Get current health status
   */
  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  /**
   * Reset adapter state
   */
  async reset(): Promise<void> {
    this.logger.info('[SdkAgentAdapter] Resetting adapter...');
    this.dispose();
    await this.initialize();
  }

  /**
   * Start a chat session with streaming support
   *
   * Returns an AsyncIterable of ExecutionNode messages that can be consumed
   * by the UI layer. Uses SDK's query() function with preset Claude Code tools
   * plus custom Ptah tools (help, executeCode).
   */
  async startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<AsyncIterable<ExecutionNode>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.'
      );
    }

    this.logger.info(`[SdkAgentAdapter] Starting chat session: ${sessionId}`, {
      config,
    });

    // Create session record in storage
    const workspaceId =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
    const storedSession: StoredSession = {
      id: sessionId,
      workspaceId,
      name: `Session ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };
    await this.storage.saveSession(storedSession);
    this.logger.debug(
      `[SdkAgentAdapter] Created session storage for ${sessionId}`
    );

    // Create abort controller for this session
    const abortController = new AbortController();

    // Dynamically import query function and custom tools (ESM in CommonJS context)
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const ptahTools = await createPtahTools();

    // Create message queue for streaming input mode
    const messageQueue: SDKUserMessage[] = [];

    // Store references for closure in generator
    const activeSessions = this.activeSessions;
    const sessionIdStr = sessionId as string;
    const logger = this.logger;

    /**
     * AsyncIterable for streaming user messages to SDK.
     *
     * FIXES APPLIED:
     * 1. Race condition: Check queue BEFORE waiting (handles messages sent before generator starts)
     * 2. Queue draining: Process ALL queued messages before waiting again
     * 3. Abort handling: Listen to abort signal to resolve pending Promise (prevents memory leak)
     * 4. Timeout: 5-minute timeout on wait to detect stuck sessions
     */
    const userMessageStream: AsyncIterable<SDKUserMessage> = {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          // DRAIN ALL QUEUED MESSAGES before waiting
          // This fixes: "only one message per wake" bug
          while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            if (message) {
              logger.debug(
                `[SdkAgentAdapter] Yielding message from queue (${messageQueue.length} remaining)`
              );
              yield message;
            }

            // Check abort between messages
            if (abortController.signal.aborted) return;
          }

          // Queue is empty - wait for next message
          // FIXES: Race condition by checking queue first, abort signal handling
          const waitResult = await new Promise<
            'message' | 'aborted' | 'timeout'
          >((resolve) => {
            // Set up abort listener BEFORE setting resolveNext
            // This prevents the race where abort happens after resolveNext is set
            const abortHandler = () => {
              resolve('aborted');
            };
            abortController.signal.addEventListener('abort', abortHandler, {
              once: true,
            });

            // Timeout after 5 minutes to detect stuck sessions
            const timeoutId = setTimeout(() => {
              logger.warn(
                `[SdkAgentAdapter] Message wait timeout after 5 minutes`
              );
              resolve('timeout');
            }, 5 * 60 * 1000);

            // Check if messages arrived while we were setting up
            if (messageQueue.length > 0) {
              clearTimeout(timeoutId);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
              return;
            }

            // Set resolveNext - sendMessageToSession will call this
            const session = activeSessions.get(sessionIdStr);
            if (session) {
              session.resolveNext = () => {
                clearTimeout(timeoutId);
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
              };
            } else {
              // Session was removed - exit
              clearTimeout(timeoutId);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('aborted');
            }
          });

          // Handle wait result
          if (waitResult === 'aborted') {
            logger.info(`[SdkAgentAdapter] Message stream aborted`);
            return;
          }

          if (waitResult === 'timeout') {
            // Continue loop - will wait again if queue still empty
            // This allows the session to stay alive for long-running tasks
            continue;
          }

          // waitResult === 'message' - loop will drain queue on next iteration
        }

        logger.info(`[SdkAgentAdapter] Message stream ended (abort signal)`);
      },
    };

    // Configure SDK query options
    const sdkQuery = query({
      prompt: userMessageStream, // Streaming input mode for multi-turn conversation
      options: {
        abortController,
        cwd: config?.projectPath || process.cwd(),
        model: config?.model || 'claude-sonnet-4.5-20250929',
        // Note: temperature is not supported in SDK Options type
        maxTurns: config?.maxTokens
          ? Math.floor(config.maxTokens / 1000)
          : undefined,
        systemPrompt: config?.systemPrompt
          ? {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: config.systemPrompt,
            }
          : {
              type: 'preset' as const,
              preset: 'claude_code' as const,
            },
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: {
          ptah: ptahTools as any, // Add custom Ptah tools (help, executeCode)
        },
        permissionMode: 'default', // Use default permission handling
        canUseTool: this.permissionHandler.createCallback(), // Add permission callback
        includePartialMessages: true, // Enable streaming for real-time updates
      },
    });

    // Track active session
    // Note: resolveNext starts as null, will be set by generator when waiting
    const initialModel = config?.model || 'claude-sonnet-4.5-20250929';
    const activeSession: ActiveSession = {
      sessionId,
      query: sdkQuery,
      config: config || {},
      abortController,
      messageQueue,
      resolveNext: null,
      currentModel: initialModel,
    };
    this.activeSessions.set(sessionId as string, activeSession);

    // Create async iterable that transforms SDK messages to ExecutionNodes
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const transformedStream: AsyncIterable<ExecutionNode> = {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const sdkMessage of sdkQuery) {
            // Transform SDK message to ExecutionNode(s)
            const nodes = self.transformer.transform(sdkMessage, sessionId);

            // Store messages in session storage using SDK's native parent linking
            for (const node of nodes) {
              // Create MessageId from node.id string
              const messageId = MessageId.from(node.id);

              // Extract parent_tool_use_id from SDK message (if available)
              const parentToolUseId =
                'parent_tool_use_id' in sdkMessage
                  ? sdkMessage.parent_tool_use_id
                  : null;

              // Get current model from session (may have changed via setSessionModel)
              const currentSession = activeSessions.get(sessionIdStr);
              const currentModel =
                currentSession?.currentModel ||
                config?.model ||
                'claude-sonnet-4.5-20250929';

              // Create stored message from ExecutionNode
              const storedMessage: StoredSessionMessage = {
                id: messageId,
                parentId: parentToolUseId
                  ? MessageId.from(parentToolUseId)
                  : null,
                role: getRoleFromSDKMessage(sdkMessage),
                content: [node],
                timestamp: Date.now(),
                model: currentModel,
                tokens: node.tokenUsage,
              };

              // Save to storage - log errors but don't block UI
              // FIX: Previously silent failure - now logs warning
              try {
                await self.storage.addMessage(sessionId, storedMessage);
              } catch (storageError) {
                const errObj =
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError));
                self.logger.warn(
                  `[SdkAgentAdapter] Failed to store message ${messageId}, continuing anyway`,
                  errObj
                );
                // Continue - don't block UI just because storage failed
                // TODO: Consider emitting storage error event to UI
              }

              // Yield ExecutionNode for UI consumption
              yield node;
            }
          }
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          self.logger.error(
            `[SdkAgentAdapter] Session ${sessionId} error`,
            errorObj
          );
          throw error;
        } finally {
          // Cleanup session on completion
          self.activeSessions.delete(sessionId as string);
          self.logger.info(`[SdkAgentAdapter] Session ${sessionId} ended`);
        }
      },
    };

    return transformedStream;
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(`[SdkAgentAdapter] Session not found: ${sessionId}`);
      return;
    }

    this.logger.info(`[SdkAgentAdapter] Ending session: ${sessionId}`);

    // Abort the session
    session.abortController.abort();
    session.query.interrupt().catch((err) => {
      this.logger.warn(
        `[SdkAgentAdapter] Failed to interrupt session ${sessionId}`,
        err
      );
    });

    this.activeSessions.delete(sessionId as string);
  }

  /**
   * Send a message to an active session
   *
   * Queues user message for SDK streaming input mode and stores for UI history.
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(
      `[SdkAgentAdapter] Sending message to session: ${sessionId}`,
      {
        contentLength: content.length,
        options,
      }
    );

    // Generate message ID
    const messageId = MessageId.create();
    const messageIdStr = messageId.toString();

    // Create SDKUserMessage for SDK
    const sdkUserMessage: SDKUserMessage = {
      type: 'user',
      uuid: messageIdStr as `${string}-${string}-${string}-${string}-${string}`,
      session_id: sessionId as string,
      message: {
        role: 'user',
        content: content,
      },
      parent_tool_use_id: null, // SDK manages parent linking automatically
    };

    // Create stored message for UI history
    const storedMessage: StoredSessionMessage = {
      id: messageId,
      parentId: null, // SDK will provide parent_tool_use_id when message is processed
      role: 'user',
      content: [
        {
          id: messageIdStr,
          type: 'text',
          status: 'complete',
          content,
          children: [],
          isCollapsed: false,
        },
      ],
      timestamp: Date.now(),
      model: session.currentModel,
    };

    // Store for UI history
    await this.storage.addMessage(sessionId, storedMessage);

    // Queue message for SDK generator
    session.messageQueue.push(sdkUserMessage);

    // Wake up the iterator if it's waiting
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(
      `[SdkAgentAdapter] Queued message for session: ${sessionId}`
    );
  }

  /**
   * Interrupt active session (stop agent mid-execution)
   * Only available when using streaming input mode
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      await session.query.interrupt();
      this.logger.info(`[SdkAgentAdapter] Interrupted session: ${sessionId}`);
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[SdkAgentAdapter] Failed to interrupt session ${sessionId}`,
        errorObj
      );
      throw errorObj;
    }
  }

  /**
   * Change model mid-conversation
   * Only available when using streaming input mode
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      await session.query.setModel(model);
      // FIX: Sync model so storage uses correct model
      session.currentModel = model;
      this.logger.info(
        `[SdkAgentAdapter] Changed model to ${model} for session: ${sessionId}`
      );
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[SdkAgentAdapter] Failed to set model for session ${sessionId}`,
        errorObj
      );
      throw errorObj;
    }
  }

  /**
   * Change permission mode (autopilot toggle)
   * Only available when using streaming input mode
   */
  async setSessionPermissionMode(
    sessionId: SessionId,
    mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      await session.query.setPermissionMode(mode);
      this.logger.info(
        `[SdkAgentAdapter] Changed permission mode to ${mode} for session: ${sessionId}`
      );
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[SdkAgentAdapter] Failed to set permission mode for session ${sessionId}`,
        errorObj
      );
      throw errorObj;
    }
  }

  /**
   * Get available models from SDK
   */
  async getAvailableModels?(): Promise<readonly string[]> {
    return SDK_PROVIDER_INFO.supportedModels || [];
  }

  /**
   * Attempt recovery (no-op for SDK - always available)
   */
  async attemptRecovery?(): Promise<boolean> {
    await this.reset();
    return this.initialized;
  }
}
