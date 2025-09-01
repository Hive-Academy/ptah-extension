import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  MessageError,
  ChatSendMessagePayload,
  ChatNewSessionPayload,
  ChatMessageChunkPayload,
  ChatSessionCreatedPayload,
  ChatRenameSessionPayload,
  ChatDeleteSessionPayload,
  ChatBulkDeleteSessionsPayload,
  ChatGetSessionStatsPayload,
  ChatPermissionResponsePayload,
  StrictChatMessage,
} from '@ptah-extension/shared';
import { SessionId, MessageId, CorrelationId } from '@ptah-extension/shared';
import { SessionManager } from '../session-manager';
import { ClaudeCliService } from '../claude-cli.service';
import { Logger } from '../../core/logger';

/**
 * Chat Message Types - Strict type definition
 */
type ChatMessageTypes =
  | 'chat:sendMessage'
  | 'chat:newSession'
  | 'chat:switchSession'
  | 'chat:getHistory'
  | 'chat:renameSession'
  | 'chat:deleteSession'
  | 'chat:bulkDeleteSessions'
  | 'chat:requestSessions'
  | 'chat:getSessionStats'
  | 'chat:stopStream'
  | 'chat:permissionResponse';

/**
 * ChatMessageHandler - Single Responsibility: Handle all chat-related webview messages
 * Implements real Claude CLI streaming integration with strict typing
 */
export class ChatMessageHandler
  extends BaseWebviewMessageHandler<ChatMessageTypes>
  implements IWebviewMessageHandler<ChatMessageTypes>
{
  readonly messageType = 'chat:';

  constructor(
    postMessage: StrictPostMessageFunction,
    private sessionManager: SessionManager,
    private claudeService: ClaudeCliService
  ) {
    super(postMessage);
  }

  async handle<K extends ChatMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      switch (messageType) {
        case 'chat:sendMessage':
          return await this.handleSendMessage(
            payload as ChatSendMessagePayload
          );
        case 'chat:newSession':
          return await this.handleNewSession(payload as ChatNewSessionPayload);
        case 'chat:switchSession':
          return await this.handleSwitchSession(
            payload as { sessionId: SessionId }
          );
        case 'chat:getHistory':
          return await this.handleGetHistory(
            payload as { sessionId: SessionId }
          );
        case 'chat:renameSession':
          return await this.handleRenameSession(
            payload as ChatRenameSessionPayload
          );
        case 'chat:deleteSession':
          return await this.handleDeleteSession(
            payload as ChatDeleteSessionPayload
          );
        case 'chat:bulkDeleteSessions':
          return await this.handleBulkDeleteSessions(
            payload as ChatBulkDeleteSessionsPayload
          );
        case 'chat:requestSessions':
          return await this.handleRequestSessions();
        case 'chat:getSessionStats':
          return await this.handleGetSessionStats();
        case 'chat:stopStream':
          return await this.handleStopStream(
            payload as {
              sessionId: SessionId | null;
              messageId: MessageId | null;
              timestamp: number;
            }
          );
        case 'chat:permissionResponse':
          return await this.handlePermissionResponse(
            payload as MessagePayloadMap['chat:permissionResponse']
          );
        default:
          throw new Error(`Unknown chat message type: ${messageType}`);
      }
    } catch (error) {
      Logger.error(`Error handling chat message ${messageType}:`, error);
      throw error;
    }
  }

  private async handleSendMessage(
    data: ChatSendMessagePayload
  ): Promise<MessageResponse> {
    try {
      // Create session on-demand when user sends first message
      let currentSession = this.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.sessionManager.createSession();
        const strictSession =
          this.sessionManager.toStrictChatSession(currentSession);
        this.sendSuccessResponse('chat:sessionCreated', {
          session: strictSession,
        });
      }

      // Permission responses are now handled through the popup UI via chat:permissionResponse message type
      // No longer handling permission responses in regular chat messages

      // Add user message to UI immediately with proper branded types
      const userMessage: StrictChatMessage = {
        id: MessageId.create(),
        sessionId: SessionId.safeParse(currentSession.id) || SessionId.create(),
        type: 'user',
        content: data.content,
        timestamp: Date.now(),
        streaming: false,
        isComplete: true,
        files: data.files,
      };

      this.sendSuccessResponse('chat:messageAdded', {
        message: userMessage,
      });

      // Add user message to session (session already exists, so no auto-creation in SessionManager)
      await this.sessionManager.sendMessage(
        data.content,
        data.files ? [...data.files] : []
      );

      // Verify Claude CLI is available
      const isAvailable = await this.claudeService.verifyInstallation();
      if (!isAvailable) {
        throw new Error(
          'Claude CLI not available. Please install Claude Code CLI first.'
        );
      }

      // Send message to Claude CLI using new simplified flow
      Logger.info(
        `Sending message to Claude CLI for session: ${currentSession.id}`
      );

      // Get Claude CLI session ID for resumption if available
      const resumeSessionId = this.sessionManager.getClaudeSessionId(
        currentSession.id
      );

      const messageStream = await this.claudeService.sendMessage(
        data.content,
        currentSession.id,
        resumeSessionId,
        this.sessionManager // Pass session manager for session ID tracking
      );

      // Process streaming response from Claude CLI
      let assistantMessageContent = '';
      let messageId: MessageId | null = null;

      // Set up stream event handlers for simplified message processing
      let hasReceivedData = false;
      let errorCount = 0;
      const MAX_ERROR_RETRIES = 3;

      messageStream.on(
        'data',
        (messageResponse: MessageResponse<StrictChatMessage>) => {
          try {
            hasReceivedData = true;
            errorCount = 0; // Reset error count on successful data

            if (!messageResponse.success) {
              Logger.error(
                'Received error response from stream',
                messageResponse.error
              );
              // Send error to frontend but continue streaming
              this.sendErrorResponse('chat:streamError', {
                code: 'STREAM_ERROR',
                message:
                  messageResponse.error?.message || 'Stream error occurred',
              });
              return;
            }

            const chatMessage = messageResponse.data;
            if (!chatMessage) {
              Logger.warn('Received empty message data from stream');
              return;
            }

            if (chatMessage.type === 'assistant') {
              // Set messageId from first chunk
              if (!messageId) {
                messageId = chatMessage.id;
              }

              assistantMessageContent += chatMessage.content;

              // Send streaming chunk to Angular with proper typing
              this.sendSuccessResponse('chat:messageChunk', {
                sessionId: chatMessage.sessionId,
                messageId: chatMessage.id,
                content: chatMessage.content,
                isComplete: chatMessage.isComplete,
                streaming: chatMessage.streaming,
              });
            }
          } catch (error) {
            errorCount++;
            Logger.error(
              `Error processing stream data (attempt ${errorCount}/${MAX_ERROR_RETRIES}):`,
              error
            );

            if (errorCount >= MAX_ERROR_RETRIES) {
              messageStream.destroy();
              this.sendErrorResponse('chat:streamError', {
                code: 'MAX_ERRORS_EXCEEDED',
                message: 'Too many errors processing stream data',
              });
            }
          }
        }
      );

      // Handle stream completion with timeout
      const STREAM_TIMEOUT = 60000; // 60 seconds timeout
      const streamTimeout = setTimeout(() => {
        Logger.warn(`Stream timeout for session: ${currentSession?.id}`);
        messageStream.destroy();
      }, STREAM_TIMEOUT);

      await new Promise<void>((resolve, reject) => {
        messageStream.on('end', () => {
          clearTimeout(streamTimeout);
          Logger.info(`Stream completed for session: ${currentSession?.id}`);
          resolve();
        });

        messageStream.on('error', (error) => {
          clearTimeout(streamTimeout);
          Logger.error(
            `Stream error in chat handler for session: ${currentSession?.id}`,
            error
          );

          // Send error to frontend but don't reject if we've received some data
          if (hasReceivedData && assistantMessageContent) {
            Logger.info(
              'Stream error occurred but partial response received, completing gracefully'
            );
            resolve();
          } else {
            reject(error);
          }
        });

        messageStream.on('close', () => {
          clearTimeout(streamTimeout);
          Logger.info(`Stream closed for session: ${currentSession?.id}`);
          resolve();
        });
      });

      // Mark streaming as complete and save the complete message
      if (assistantMessageContent && messageId) {
        await this.sessionManager.addAssistantMessage(
          currentSession.id,
          assistantMessageContent
        );

        // Send final completion message with proper typing
        this.sendSuccessResponse('chat:messageComplete', {
          message: {
            type: 'assistant' as const,
            id: messageId,
            sessionId: currentSession?.id as any,
            content: assistantMessageContent,
            timestamp: Date.now(),
            streaming: false,
            isComplete: true,
          },
        });
      }

      Logger.info(
        `Claude CLI streaming completed for session: ${currentSession.id}`
      );

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: {
          messageId: messageId || 'unknown',
          content: assistantMessageContent,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          sessionId: currentSession?.id as any,
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error in Claude CLI streaming:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send message';
      this.sendErrorResponse('chat:sendMessage', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'MESSAGE_SEND_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleNewSession(
    data: ChatNewSessionPayload
  ): Promise<MessageResponse> {
    try {
      const session = await this.sessionManager.createSession(data.name);
      const strictSession = this.sessionManager.toStrictChatSession(session);
      this.sendSuccessResponse('chat:sessionCreated', {
        session: strictSession,
      });
      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { session: strictSession },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create session';
      this.sendErrorResponse('chat:newSession', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSION_CREATION_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleSwitchSession(data: {
    sessionId: string;
  }): Promise<MessageResponse> {
    try {
      await this.sessionManager.switchSession(data.sessionId);
      const session = this.sessionManager.getCurrentSession();
      const strictSession = session
        ? this.sessionManager.toStrictChatSession(session)
        : null;
      this.sendSuccessResponse('chat:sessionSwitched', {
        session: strictSession,
      });
      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { session: strictSession },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to switch session';
      this.sendErrorResponse('chat:switchSession', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSION_SWITCH_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetHistory(data: {
    sessionId: string;
  }): Promise<MessageResponse> {
    try {
      const sessions = this.sessionManager.getAllSessions();
      const session = sessions.find((s) => s.id === data.sessionId);
      const messages = session?.messages || [];
      this.sendSuccessResponse('chat:historyLoaded', { messages });
      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { messages },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load history';
      this.sendErrorResponse('chat:getHistory', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'HISTORY_LOAD_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  /**
   * Enhanced Session Management Handlers
   */
  private async handleRenameSession(
    data: ChatRenameSessionPayload
  ): Promise<MessageResponse> {
    try {
      const success = await this.sessionManager.renameSession(
        data.sessionId,
        data.newName
      );

      if (success) {
        this.sendSuccessResponse('chat:sessionRenamed', {
          sessionId: data.sessionId,
          newName: data.newName,
        });

        return {
          requestId: CorrelationId.create(),
          success: true,
          data: { sessionId: data.sessionId, newName: data.newName },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      } else {
        throw new Error('Session not found');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to rename session';
      this.sendErrorResponse('chat:renameSession', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSION_RENAME_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleDeleteSession(
    data: ChatDeleteSessionPayload
  ): Promise<MessageResponse> {
    try {
      const success = await this.sessionManager.deleteSession(data.sessionId);

      if (success) {
        this.sendSuccessResponse('chat:sessionDeleted', {
          sessionId: data.sessionId,
        });

        return {
          requestId: CorrelationId.create(),
          success: true,
          data: { sessionId: data.sessionId, deleted: true },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      } else {
        throw new Error('Session not found');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to delete session';
      this.sendErrorResponse('chat:deleteSession', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSION_DELETE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleBulkDeleteSessions(
    data: ChatBulkDeleteSessionsPayload
  ): Promise<MessageResponse> {
    try {
      const result = await this.sessionManager.bulkDeleteSessions([
        ...data.sessionIds,
      ]);

      // Send individual session deleted events for UI updates
      for (const deletedId of result.deleted) {
        this.sendSuccessResponse('chat:sessionDeleted', {
          sessionId: deletedId as SessionId,
        });
      }

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: result,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to bulk delete sessions';
      this.sendErrorResponse('chat:bulkDeleteSessions', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'BULK_DELETE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleRequestSessions(): Promise<MessageResponse> {
    try {
      const strictSessions = this.sessionManager.getAllStrictSessions();

      this.sendSuccessResponse('chat:sessionsUpdated', {
        sessions: strictSessions,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { sessions: strictSessions },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get sessions';
      this.sendErrorResponse('chat:requestSessions', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSIONS_REQUEST_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetSessionStats(): Promise<MessageResponse> {
    try {
      const stats = this.sessionManager.getSessionStatistics();

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { stats },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to get session statistics';
      this.sendErrorResponse('chat:getSessionStats', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'SESSION_STATS_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  /**
   * Extract file paths from message content
   * Looks for common file path patterns in Claude CLI responses
   */
  private extractFilesFromContent(content: string): string[] {
    if (!content) return [];

    const filePathPatterns = [
      // Windows paths: d:/path/to/file.ext or D:\path\to\file.ext
      /[a-zA-Z]:[\\/][^\s<>:"|?*\n\r]+\.[a-zA-Z0-9]+/g,
      // Unix paths: /path/to/file.ext
      /\/[^\s<>:"|?*\n\r]+\.[a-zA-Z0-9]+/g,
      // Relative paths: ./path/to/file.ext or ../path/to/file.ext
      /\.\.[\\/][^\s<>:"|?*\n\r]+\.[a-zA-Z0-9]+/g,
      /\.[\\/][^\s<>:"|?*\n\r]+\.[a-zA-Z0-9]+/g,
    ];

    const foundPaths: string[] = [];

    for (const pattern of filePathPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        foundPaths.push(...matches);
      }
    }

    // Remove duplicates and filter out common false positives
    const uniquePaths = [...new Set(foundPaths)].filter((path) => {
      // Filter out common false positives
      const lowerPath = path.toLowerCase();
      return (
        !lowerPath.includes('http') &&
        !lowerPath.includes('www.') &&
        !lowerPath.includes('ftp') &&
        path.length > 5
      ); // Minimum reasonable path length
    });

    if (uniquePaths.length > 0) {
      Logger.info(
        `Extracted ${uniquePaths.length} file paths from message:`,
        uniquePaths
      );
    }

    return uniquePaths;
  }

  /**
   * Handle stop streaming request
   */
  private async handleStopStream(data: {
    sessionId: SessionId | null;
    messageId: MessageId | null;
    timestamp: number;
  }): Promise<MessageResponse> {
    try {
      Logger.info(
        `Stop streaming requested for session: ${data.sessionId}, message: ${data.messageId}`
      );

      // Try to stop the current Claude CLI process if running
      // Note: This would require implementing process management in ClaudeCliService
      // For now, we'll just acknowledge the stop request

      // Send stop acknowledgment to frontend
      this.sendSuccessResponse('chat:streamStopped', {
        sessionId: data.sessionId,
        messageId: data.messageId,
        timestamp: Date.now(),
        success: true,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: {
          stopped: true,
          sessionId: data.sessionId,
          messageId: data.messageId,
          timestamp: Date.now(),
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to stop stream';
      Logger.error('Error stopping stream:', error);

      this.sendErrorResponse('chat:stopStream', errorMessage);

      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'STOP_STREAM_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  /**
   * Handle permission response from popup UI
   */
  private async handlePermissionResponse(
    data: MessagePayloadMap['chat:permissionResponse']
  ): Promise<MessageResponse> {
    try {
      Logger.info(
        `Permission response received: ${data.response} for request: ${data.requestId}`
      );

      // Extract session ID from request ID (format: perm_{sessionId}_{timestamp})
      const sessionIdMatch = data.requestId.match(/perm_(.+?)_\d+$/);
      const sessionIdString = sessionIdMatch?.[1];

      if (!sessionIdString) {
        throw new Error('Invalid permission request ID format');
      }

      const sessionId =
        SessionId.safeParse(sessionIdString) || SessionId.create();

      // Map response format
      let claudeResponse: 'allow' | 'always_allow' | 'deny';
      switch (data.response.toLowerCase()) {
        case 'allow':
          claudeResponse = 'allow';
          break;
        case 'always_allow':
          claudeResponse = 'always_allow';
          break;
        case 'deny':
        default:
          claudeResponse = 'deny';
          break;
      }

      // Send permission response to Claude CLI
      await this.claudeService.respondToPermission(sessionId, claudeResponse);

      Logger.info(
        `Permission response '${claudeResponse}' sent to Claude CLI for session: ${sessionId}`
      );

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: {
          message: `Permission ${
            claudeResponse === 'deny' ? 'denied' : 'granted'
          }`,
          requestId: data.requestId,
          response: claudeResponse,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to handle permission response';
      Logger.error('Error handling permission response:', error);

      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'PERMISSION_RESPONSE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }
}
