/**
 * Stream Transformer
 *
 * Transforms SDK message streams into ExecutionNode streams.
 * Handles session ID extraction and message storage.
 */

import { injectable, inject } from 'tsyringe';
import { SessionId, ExecutionNode, MessageId } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { SdkSessionStorage } from '../sdk-session-storage';
import { StoredSessionMessage } from '../types/sdk-session.types';
import { SDK_TOKENS } from '../di/tokens';
import { SessionLifecycleManager } from './session-lifecycle-manager';

/**
 * Generic SDK message type
 */
type SDKMessage = {
  type: string;
  [key: string]: unknown;
};

/**
 * Callback type for notifying when real Claude session ID is resolved
 */
export type SessionIdResolvedCallback = (
  placeholderId: SessionId,
  realClaudeSessionId: string
) => void;

/**
 * Configuration for stream transformation
 */
export interface StreamTransformConfig {
  sdkQuery: AsyncIterable<SDKMessage>;
  sessionId: SessionId;
  initialModel: string;
  onSessionIdResolved?: SessionIdResolvedCallback;
}

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
 * StreamTransformer - Transforms SDK messages to ExecutionNodes
 *
 * Responsibilities:
 * - Extract real Claude session ID from system 'init' messages
 * - Transform SDK messages to ExecutionNode format
 * - Store messages in session storage
 * - Handle authentication errors gracefully
 */
@injectable()
export class StreamTransformer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
    @inject(SDK_TOKENS.SDK_SESSION_STORAGE)
    private readonly storage: SdkSessionStorage,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager
  ) {}

  /**
   * Create a transformed ExecutionNode stream from SDK messages
   */
  transform(config: StreamTransformConfig): AsyncIterable<ExecutionNode> {
    const { sdkQuery, sessionId, initialModel, onSessionIdResolved } = config;

    // Capture references for use in generator
    const logger = this.logger;
    const messageTransformer = this.messageTransformer;
    const storage = this.storage;
    const sessionLifecycle = this.sessionLifecycle;

    return {
      async *[Symbol.asyncIterator]() {
        try {
          logger.info(
            `[StreamTransformer] Starting message stream for ${sessionId}`
          );

          for await (const sdkMessage of sdkQuery) {
            // Extract real Claude session ID from system 'init' message
            // This is the ONLY place where we get the real Claude UUID
            if (
              sdkMessage.type === 'system' &&
              'subtype' in sdkMessage &&
              sdkMessage['subtype'] === 'init' &&
              'session_id' in sdkMessage &&
              typeof sdkMessage['session_id'] === 'string'
            ) {
              const realClaudeSessionId = sdkMessage['session_id'] as string;
              logger.info(
                `[StreamTransformer] Captured real Claude session ID: ${realClaudeSessionId} (placeholder: ${sessionId})`
              );

              // Store the real Claude session ID for future resumption
              try {
                await storage.updateClaudeSessionId(
                  sessionId,
                  realClaudeSessionId
                );
                logger.debug(
                  `[StreamTransformer] Stored claudeSessionId mapping: ${sessionId} -> ${realClaudeSessionId}`
                );

                // Register mapping for session lookup (enables abort by real ID)
                sessionLifecycle.registerSessionIdMapping(
                  realClaudeSessionId,
                  sessionId as string
                );

                // Notify via callback
                if (onSessionIdResolved) {
                  onSessionIdResolved(sessionId, realClaudeSessionId);
                }
              } catch (storageError) {
                logger.warn(
                  `[StreamTransformer] Failed to store Claude session ID`,
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError))
                );
              }
            }

            const nodes = messageTransformer.transform(sdkMessage, sessionId);

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
                sessionLifecycle.getActiveSession(sessionId);
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
                await storage.addMessage(sessionId, storedMessage);
              } catch (storageError) {
                const errObj =
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError));
                logger.warn(
                  `[StreamTransformer] Failed to store message ${messageId}, continuing anyway`,
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

          logger.error(
            `[StreamTransformer] Session ${sessionId} error: ${errorObj.message}`,
            errorObj
          );

          // Check for auth errors and provide helpful logging
          if (
            errorObj.message.includes('401') ||
            errorObj.message.toLowerCase().includes('unauthorized') ||
            errorObj.message.toLowerCase().includes('authentication') ||
            errorObj.message.toLowerCase().includes('invalid') ||
            errorObj.message.toLowerCase().includes('api key')
          ) {
            logger.error('[StreamTransformer] AUTHENTICATION ERROR!');
            logger.error(
              '[StreamTransformer] SDK requires valid API key from console.anthropic.com'
            );
            logger.error(
              '[StreamTransformer] OR OAuth token from "claude setup-token"'
            );
            logger.error(
              `[StreamTransformer] Current: ANTHROPIC_API_KEY=${
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
          sessionLifecycle.getActiveSession(sessionId); // Cleanup handled by endSession
          logger.info(`[StreamTransformer] Session ${sessionId} ended`);
        }
      },
    };
  }
}
