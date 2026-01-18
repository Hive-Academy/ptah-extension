/**
 * SDK Message Factory - Creates SDK user messages with attachments
 *
 * Extracted from SdkAgentAdapter to eliminate code duplication.
 * Both startChatSession() and sendMessageToSession() need to create
 * SDK user messages with optional file attachments.
 *
 * Single Responsibility: Create properly formatted SDK user messages
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { MessageId, SessionId } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { AttachmentProcessorService } from './attachment-processor.service';
import {
  UserMessageContent,
  TextBlock,
  SDKUserMessage,
} from '../types/sdk-types/claude-sdk.types';

// Re-export SDKUserMessage type for consumers
export type { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';

/**
 * Parameters for creating a user message
 */
export interface CreateMessageParams {
  /** Text content of the message */
  content: string;
  /** Session ID to associate with the message */
  sessionId: SessionId;
  /** Optional file paths to attach */
  files?: string[];
}

/**
 * Factory for creating SDK-compatible user messages
 *
 * Handles:
 * - Text content formatting
 * - File attachment processing (images, documents)
 * - Message ID generation
 * - SDK message structure creation
 */
@injectable()
export class SdkMessageFactory {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR)
    private readonly attachmentProcessor: AttachmentProcessorService
  ) {}

  /**
   * Create an SDK user message with optional attachments
   *
   * @param params - Message creation parameters
   * @returns Properly formatted SDK user message
   *
   * @example
   * ```typescript
   * const message = await factory.createUserMessage({
   *   content: 'Analyze this file',
   *   sessionId: 'session-123',
   *   files: ['/path/to/file.ts']
   * });
   * ```
   */
  async createUserMessage(
    params: CreateMessageParams
  ): Promise<SDKUserMessage> {
    const { content, sessionId, files = [] } = params;

    // Build message content (text + optional attachments)
    let messageContent: UserMessageContent = content;

    if (files.length > 0) {
      this.logger.debug(
        `[SdkMessageFactory] Processing ${files.length} attachments`
      );

      const attachmentBlocks =
        await this.attachmentProcessor.processAttachments(files);

      if (attachmentBlocks.length > 0) {
        // When attachments exist, content becomes array of blocks
        const textBlock: TextBlock = { type: 'text', text: content };
        messageContent = [textBlock, ...attachmentBlocks];
      }
    }

    // Generate unique message ID
    const messageId = MessageId.create();
    const messageIdStr = messageId.toString();

    // Create SDK-compatible message structure
    const sdkMessage: SDKUserMessage = {
      type: 'user',
      uuid: messageIdStr as `${string}-${string}-${string}-${string}-${string}`,
      session_id: sessionId as string,
      message: {
        role: 'user',
        content: messageContent,
      },
      parent_tool_use_id: null,
    };

    this.logger.debug('[SdkMessageFactory] Created user message', {
      messageId: messageIdStr.slice(0, 8) + '...',
      sessionId: (sessionId as string).slice(0, 8) + '...',
      hasAttachments: files.length > 0,
      attachmentCount: files.length,
    });

    return sdkMessage;
  }
}
