/**
 * SDK Agent Adapter - IAIProvider implementation using official Claude Agent SDK
 *
 * This adapter provides direct in-process SDK communication with 10x performance
 * improvements over CLI-based integration. Responsibilities are delegated to:
 * - AuthManager: Authentication setup and validation
 * - SessionLifecycleManager: Session tracking and cleanup
 * - ConfigWatcher: Config change detection and re-initialization
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
  MessageId,
} from '@ptah-extension/shared';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { SdkMessageTransformer } from './sdk-message-transformer';
import { SdkSessionStorage } from './sdk-session-storage';
import { SdkPermissionHandler } from './sdk-permission-handler';
import { StoredSessionMessage } from './types/sdk-session.types';
import { createPtahTools } from './ptah-tools-server';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  type SDKUserMessage,
} from './helpers';

/**
 * Generic SDK message type for internal type hints
 */
type SDKMessage = {
  type: string;
  [key: string]: unknown;
};

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
  imageAnalysis: false,
  functionCalling: true,
};

/**
 * Provider information for SDK adapter
 */
const SDK_PROVIDER_INFO: ProviderInfo = {
  id: 'claude-cli' as ProviderId,
  name: 'Claude Agent SDK',
  version: '1.0.0',
  description: 'Official Claude Agent SDK integration (in-process)',
  vendor: 'Anthropic',
  capabilities: SDK_CAPABILITIES,
  maxContextTokens: 200000,
  supportedModels: [
    'claude-sonnet-4.5-20250929',
    'claude-opus-4.5-20251101',
    'claude-haiku-4.0-20250107',
  ],
};

/**
 * Helper function to get message role from SDK message type
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
      return 'assistant';
  }
}

/**
 * SdkAgentAdapter - Core SDK wrapper implementing IAIProvider
 *
 * Architecture: Thin orchestration layer that delegates to helper services.
 * Main responsibilities: API surface, message transformation, SDK invocation.
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
   * Message transformer for SDK → ExecutionNode conversion
   */
  private transformer: SdkMessageTransformer;

  /**
   * Helper Services - Extracted for maintainability
   */
  private authManager: AuthManager;
  private sessionLifecycle: SessionLifecycleManager;
  private configWatcher: ConfigWatcher;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject('SdkSessionStorage') private storage: SdkSessionStorage,
    @inject('SdkPermissionHandler')
    private permissionHandler: SdkPermissionHandler
  ) {
    this.transformer = new SdkMessageTransformer(logger);
    this.authManager = new AuthManager(logger, config);
    this.sessionLifecycle = new SessionLifecycleManager(logger, storage);
    this.configWatcher = new ConfigWatcher(logger, config);
  }

  /**
   * Initialize the SDK adapter
   */
  async initialize(): Promise<boolean> {
    try {
      this.logger.info('[SdkAgentAdapter] Initializing SDK adapter...');

      // Delegate authentication to AuthManager
      const authMethod = this.config.get<string>('authMethod') || 'auto';
      const authResult = await this.authManager.configureAuthentication(
        authMethod
      );

      if (!authResult.configured) {
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage: authResult.errorMessage,
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

      // Register config watchers for automatic re-initialization
      this.configWatcher.registerWatchers(async () => {
        // Gracefully dispose active sessions before re-init
        this.sessionLifecycle.disposeAllSessions();
        await this.initialize();
      });

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
   * Dispose all active sessions and cleanup
   */
  dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');
    this.configWatcher.dispose();
    this.sessionLifecycle.disposeAllSessions();
    this.authManager.clearAuthentication();
    this.initialized = false;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }

  /**
   * Verify installation - SDK is bundled, always available
   */
  async verifyInstallation(): Promise<boolean> {
    return true;
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

    // Create session record via SessionLifecycleManager
    await this.sessionLifecycle.createSessionRecord(sessionId);

    // Create abort controller
    const abortController = new AbortController();

    // Import SDK dynamically (ESM in CommonJS context)
    this.logger.info(
      `[SdkAgentAdapter] Importing Claude Agent SDK for session ${sessionId}...`
    );
    this.logger.debug(
      `[SdkAgentAdapter] Environment check: ANTHROPIC_API_KEY=${
        process.env['ANTHROPIC_API_KEY'] ? 'SET' : 'NOT SET'
      }, CLAUDE_CODE_OAUTH_TOKEN=${
        process.env['CLAUDE_CODE_OAUTH_TOKEN'] ? 'SET' : 'NOT SET'
      }`
    );

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.logger.info('[SdkAgentAdapter] SDK imported successfully');

    const ptahTools = await createPtahTools();
    this.logger.debug('[SdkAgentAdapter] Ptah tools created');

    // Store references for closure
    const sessionLifecycle = this.sessionLifecycle;
    const logger = this.logger;

    // Create user message stream for SDK
    const userMessageStream: AsyncIterable<SDKUserMessage> = {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = sessionLifecycle.getActiveSession(sessionId);
          if (!session) {
            logger.warn(
              `[SdkAgentAdapter] Session ${sessionId} not found - ending stream`
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[SdkAgentAdapter] Yielding message (${session.messageQueue.length} remaining)`
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message
          const waitResult = await new Promise<
            'message' | 'aborted' | 'timeout'
          >((resolve) => {
            const abortHandler = () => resolve('aborted');
            abortController.signal.addEventListener('abort', abortHandler);

            const currentSession = sessionLifecycle.getActiveSession(sessionId);
            if (!currentSession) {
              resolve('aborted');
              return;
            }

            // Check queue again before waiting
            if (currentSession.messageQueue.length > 0) {
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
              return;
            }

            // Set timeout (5 minutes)
            const timeoutId = setTimeout(() => {
              logger.warn(`[SdkAgentAdapter] Session ${sessionId} timeout`);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('timeout');
            }, 5 * 60 * 1000);

            // Set wake callback
            currentSession.resolveNext = () => {
              clearTimeout(timeoutId);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
            };

            logger.debug(
              `[SdkAgentAdapter] Waiting for message (${sessionId})...`
            );
          });

          if (waitResult === 'aborted' || waitResult === 'timeout') {
            logger.debug(`[SdkAgentAdapter] Stream ended: ${waitResult}`);
            return;
          }
        }
      },
    };

    // Start SDK query
    const initialModel = config?.model || 'claude-sonnet-4.5-20250929';
    const sdkQuery = query({
      prompt: userMessageStream,
      options: {
        abortController,
        cwd: config?.projectPath || process.cwd(),
        model: initialModel,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ptah: ptahTools as any, // SDK requires any type for custom MCP tools
        },
        permissionMode: 'default',
        canUseTool: this.permissionHandler.createCallback(),
        includePartialMessages: true,
      },
    });

    // Register session
    this.sessionLifecycle.registerActiveSession(
      sessionId,
      sdkQuery,
      config || {},
      abortController
    );

    // Return transformed stream
    return this.createTransformedStream(sdkQuery, sessionId, initialModel);
  }

  /**
   * Create transformed stream that converts SDK messages to ExecutionNodes
   * Private helper to avoid 'this' aliasing in generator functions
   */
  private createTransformedStream(
    sdkQuery: AsyncIterable<SDKMessage>,
    sessionId: SessionId,
    initialModel: string
  ): AsyncIterable<ExecutionNode> {
    // Use arrow function to preserve 'this' context
    return {
      [Symbol.asyncIterator]: async function* (this: SdkAgentAdapter) {
        try {
          this.logger.info(
            `[SdkAgentAdapter] Starting message stream for ${sessionId}`
          );

          for await (const sdkMessage of sdkQuery) {
            const nodes = this.transformer.transform(sdkMessage, sessionId);

            // Store messages and yield nodes
            for (const node of nodes) {
              // Create MessageId from node.id string
              const messageId = MessageId.from(node.id);

              // Extract parent_tool_use_id from SDK message
              const parentToolUseId =
                'parent_tool_use_id' in sdkMessage
                  ? sdkMessage['parent_tool_use_id']
                  : null;

              // Get current model from session
              const currentSession =
                this.sessionLifecycle.getActiveSession(sessionId);
              const currentModel = currentSession?.currentModel || initialModel;

              // Create stored message from ExecutionNode
              const storedMessage: StoredSessionMessage = {
                id: messageId,
                parentId:
                  parentToolUseId && typeof parentToolUseId === 'string'
                    ? MessageId.from(parentToolUseId)
                    : null,
                role: getRoleFromSDKMessage(sdkMessage),
                content: [node],
                timestamp: Date.now(),
                model: currentModel,
                tokens: node.tokenUsage,
              };

              // Save to storage - log errors but don't block UI
              try {
                await this.storage.addMessage(sessionId, storedMessage);
              } catch (storageError) {
                const errObj =
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError));
                this.logger.warn(
                  `[SdkAgentAdapter] Failed to store message ${messageId}, continuing anyway`,
                  errObj
                );
              }

              // Yield ExecutionNode for UI consumption
              yield node;
            }
          }
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));

          this.logger.error(
            `[SdkAgentAdapter] Session ${sessionId} error: ${errorObj.message}`,
            errorObj
          );

          // Check for auth errors
          if (
            errorObj.message.includes('401') ||
            errorObj.message.toLowerCase().includes('unauthorized') ||
            errorObj.message.toLowerCase().includes('authentication') ||
            errorObj.message.toLowerCase().includes('invalid') ||
            errorObj.message.toLowerCase().includes('api key')
          ) {
            this.logger.error('[SdkAgentAdapter] AUTHENTICATION ERROR!');
            this.logger.error(
              '[SdkAgentAdapter] SDK requires valid API key from console.anthropic.com'
            );
            this.logger.error(
              '[SdkAgentAdapter] OR OAuth token from "claude setup-token"'
            );
            this.logger.error(
              `[SdkAgentAdapter] Current: ANTHROPIC_API_KEY=${
                process.env['ANTHROPIC_API_KEY']
                  ? `SET (${process.env['ANTHROPIC_API_KEY'].substring(
                      0,
                      10
                    )}...)`
                  : 'NOT SET'
              }`
            );
          }

          throw error;
        } finally {
          this.sessionLifecycle.getActiveSession(sessionId); // Cleanup handled by endSession
          this.logger.info(`[SdkAgentAdapter] Session ${sessionId} ended`);
        }
      }.bind(this),
    };
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    this.sessionLifecycle.endSession(sessionId);
  }

  /**
   * Send a message to an active session
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: AIMessageOptions // Reserved for future use
  ): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(`[SdkAgentAdapter] Sending message to ${sessionId}`, {
      contentLength: content.length,
    });

    // Generate message ID
    const messageId = MessageId.create();
    const messageIdStr = messageId.toString();

    // Create SDK user message
    const sdkUserMessage: SDKUserMessage = {
      type: 'user',
      uuid: messageIdStr as `${string}-${string}-${string}-${string}-${string}`,
      session_id: sessionId as string,
      message: {
        role: 'user',
        content: content,
      },
      parent_tool_use_id: null,
    };

    // Store for UI history
    const storedMessage: StoredSessionMessage = {
      id: messageId,
      parentId: null,
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

    await this.storage.addMessage(sessionId, storedMessage);

    // Queue for SDK
    session.messageQueue.push(sdkUserMessage);

    // Wake iterator
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[SdkAgentAdapter] Message queued for ${sessionId}`);
  }

  /**
   * Interrupt active session
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      this.logger.warn(
        `[SdkAgentAdapter] Cannot interrupt - session not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);

    try {
      await session.query.interrupt();
      this.logger.info(`[SdkAgentAdapter] Session interrupted: ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to interrupt session ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set session permission level
   */
  async setSessionPermissionLevel(
    sessionId: SessionId,
    level:
      | 'ask'
      | 'auto-edit'
      | 'yolo'
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions'
  ): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(
      `[SdkAgentAdapter] Setting permission level for ${sessionId}: ${level}`
    );

    // Support both frontend names and SDK mode names
    const modeMap: Record<string, string> = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
      default: 'default',
      acceptEdits: 'acceptEdits',
      bypassPermissions: 'bypassPermissions',
    };

    const sdkMode = modeMap[level] || level;

    try {
      await session.query.setPermissionMode(sdkMode);
      this.logger.info(
        `[SdkAgentAdapter] Permission level set for ${sessionId}`
      );
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to set permission for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set session model
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(
      `[SdkAgentAdapter] Setting model for ${sessionId}: ${model}`
    );

    try {
      await session.query.setModel(model);
      session.currentModel = model;
      this.logger.info(`[SdkAgentAdapter] Model set for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to set model for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }
}
