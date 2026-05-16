/**
 * Message Validator Service - Runtime Type Safety with Zod
 *
 * Provides comprehensive runtime validation for all message types with zero `any` types.
 * Integrated with TSyringe DI for extensibility.
 */

import { injectable } from 'tsyringe';
import { z, ZodError } from 'zod';
import type {
  StrictMessage,
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  StrictChatMessage,
  StrictChatSession,
} from '@ptah-extension/shared';
import {
  ChatSendMessagePayloadSchema,
  ChatMessageChunkPayloadSchema,
  MessageResponseSchema,
  StrictChatMessageSchema,
  StrictChatSessionSchema,
  StrictMessageSchema,
  SessionId,
  MessageId,
  CorrelationId,
  BrandedTypeValidator,
} from '@ptah-extension/shared';

/**
 * Structured Error Hierarchy for Validation Failures
 */
export abstract class PtahError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'validation' | 'communication' | 'cli' | 'state';

  constructor(
    message: string,
    public readonly context: Readonly<Record<string, unknown>> = {},
    public readonly timestamp = Date.now(),
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends PtahError {
  readonly code = 'VALIDATION_ERROR';
  readonly category = 'validation' as const;

  constructor(
    message: string,
    context: Readonly<{
      errors?: readonly z.ZodIssue[];
      received?: unknown;
      expected?: string;
    }> = {},
  ) {
    super(message, context);
  }
}

export class MessageValidationError extends ValidationError {
  override readonly code = 'VALIDATION_ERROR'; // Keep base code for compatibility

  constructor(
    message: string,
    public readonly messageType: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, context);
  }
}

/**
 * Type-Safe Message Validator Service
 * Eliminates all 'any' types through runtime validation
 */
@injectable()
export class MessageValidatorService {
  /**
   * Validate a generic message with strict typing
   */
  validateMessage<T extends keyof MessagePayloadMap>(
    data: unknown,
    expectedType: T,
  ): StrictMessage<T> {
    try {
      // First validate the basic message structure
      const messageSchema = StrictMessageSchema(expectedType);
      const baseResult = messageSchema.safeParse(data);

      if (!baseResult.success) {
        throw new MessageValidationError(
          `Invalid message structure for type ${expectedType}`,
          expectedType,
          {
            errors: baseResult.error.issues,
            received: data,
          },
        );
      }

      // Then validate the specific payload
      const message = baseResult.data as StrictMessage<T>;
      this.validatePayloadForType(message.payload, expectedType);

      return message;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      throw new MessageValidationError(
        `Unexpected validation error for ${expectedType}`,
        expectedType,
        {
          originalError: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Validate message payload based on type
   */
  private validatePayloadForType<T extends keyof MessagePayloadMap>(
    payload: unknown,
    messageType: T,
  ): MessagePayloadMap[T] {
    const schema = this.getPayloadSchemaForType(messageType);
    const result = schema.safeParse(payload);

    if (!result.success) {
      throw new MessageValidationError(
        `Invalid payload for message type ${messageType}`,
        messageType,
        {
          errors: result.error.issues,
          received: payload,
        },
      );
    }

    return result.data as MessagePayloadMap[T];
  }

  /**
   * Get appropriate Zod schema for message type
   */
  private getPayloadSchemaForType(messageType: StrictMessageType): z.ZodSchema {
    switch (messageType) {
      case 'chat:sendMessage':
        return ChatSendMessagePayloadSchema;
      case 'chat:messageChunk':
        return ChatMessageChunkPayloadSchema;

      // Analytics schemas
      case 'analytics:getData':
        return z.object({}); // Empty payload for getData request
      case 'analytics:trackEvent':
        return z.object({
          event: z.string(),
          properties: z.record(z.string(), z.unknown()).optional(),
        });

      // State management schemas
      case 'state:save':
        return z.object({
          state: z.unknown(), // Accept any state data
        });
      case 'state:load':
        return z.object({}); // Empty payload for load request
      case 'state:clear':
        return z.object({}); // Empty payload for clear request

      // Configuration schemas
      case 'config:get':
        return z.object({
          key: z.string().optional(), // Optional key parameter
          timestamp: z.number().optional(), // Optional timestamp for caching
        });
      case 'config:set':
        return z.object({
          key: z.string(),
          value: z.unknown(),
        });
      case 'config:update':
        return z.object({
          updates: z.record(z.string(), z.unknown()),
        });
      case 'config:refresh':
        return z.object({
          timestamp: z.number().optional(), // Optional timestamp for caching
        });

      // Provider management schemas
      case 'providers:getAvailable':
        return z.object({}); // Empty payload
      case 'providers:getCurrent':
        return z.object({}); // Empty payload
      case 'providers:getAllHealth':
        return z.object({}); // Empty payload
      case 'providers:switch':
        return z.object({
          providerId: z.string(),
          reason: z
            .enum(['user-request', 'auto-fallback', 'error-recovery'])
            .optional(),
        });
      case 'providers:getHealth':
        return z.object({
          providerId: z.string().optional(),
        });
      case 'providers:setDefault':
        return z.object({
          providerId: z.string(),
        });
      case 'providers:enableFallback':
        return z.object({
          enabled: z.boolean(),
        });
      case 'providers:setAutoSwitch':
        return z.object({
          enabled: z.boolean(),
        });
      case 'providers:currentChanged':
        return z.object({
          from: z.string().nullable(),
          to: z.string(),
          reason: z.enum(['user-request', 'auto-fallback', 'error-recovery']),
          timestamp: z.number(),
        });
      case 'providers:healthChanged':
        return z.object({
          providerId: z.string(),
          health: z.object({
            status: z.enum([
              'available',
              'unavailable',
              'error',
              'initializing',
              'disabled',
            ]),
            lastCheck: z.number(),
            errorMessage: z.string().optional(),
            responseTime: z.number().optional(),
            uptime: z.number().optional(),
          }),
        });
      case 'providers:error':
        return z.object({
          providerId: z.string(),
          error: z.object({
            type: z.string(),
            message: z.string(),
            recoverable: z.boolean(),
            suggestedAction: z.string(),
            context: z.record(z.string(), z.unknown()).optional(),
          }),
          timestamp: z.number(),
        });
      case 'providers:availableUpdated':
        return z.object({
          availableProviders: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              status: z.enum([
                'available',
                'unavailable',
                'error',
                'initializing',
                'disabled',
              ]),
            }),
          ),
        });

      // Context management schemas
      case 'context:updateFiles':
        return z.object({
          files: z.array(z.string()),
        });
      case 'context:getFiles':
        return z.object({}); // Empty payload
      case 'context:includeFile':
        return z.object({
          filePath: z.string(),
        });
      case 'context:excludeFile':
        return z.object({
          filePath: z.string(),
        });
      case 'context:searchFiles':
        return z.object({
          query: z.string(),
          includeImages: z.boolean().optional(),
          maxResults: z.number().optional(),
          fileTypes: z.array(z.string()).optional(),
        });
      case 'context:getAllFiles':
        return z.object({
          includeImages: z.boolean().optional(),
          offset: z.number().optional(),
          limit: z.number().optional(),
        });
      case 'context:getFileSuggestions':
        return z.object({
          query: z.string(),
          limit: z.number().optional(),
        });
      case 'context:searchImages':
        return z.object({
          query: z.string(),
        });

      // Chat session schemas
      case 'chat:sessionStart':
        return z.object({
          sessionId: z.string(),
        });
      case 'chat:sessionEnd':
        return z.object({
          sessionId: z.string(),
        });
      case 'chat:newSession':
        return z.object({
          name: z.string().optional(),
        });
      case 'chat:switchSession':
        return z.object({
          sessionId: z.string(),
        });
      case 'chat:getHistory':
        return z.object({
          sessionId: z.string().optional(),
        });
      case 'chat:requestSessions':
        return z.object({}); // Empty payload
      case 'chat:messageAdded':
        return z.object({
          message: z.object({
            id: z.string(),
            sessionId: z.string(),
            type: z.enum(['user', 'assistant', 'system']),
            content: z.string(),
            timestamp: z.number(),
            streaming: z.boolean().optional(),
            files: z.array(z.string()).optional(),
            isError: z.boolean().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        });
      case 'chat:messageComplete':
        return z.object({
          messageId: z.string(),
        });
      case 'chat:sessionCreated':
      case 'chat:sessionSwitched':
      case 'chat:historyLoaded':
        return z.object({}).passthrough(); // Allow any payload for complex session data
      case 'chat:renameSession':
        return z.object({
          sessionId: z.string(),
          newName: z.string(),
        });
      case 'chat:deleteSession':
        return z.object({
          sessionId: z.string(),
        });
      case 'chat:bulkDeleteSessions':
        return z.object({
          sessionIds: z.array(z.string()),
        });
      case 'chat:sessionRenamed':
        return z.object({
          sessionId: z.string(),
          newName: z.string(),
        });
      case 'chat:sessionDeleted':
        return z.object({
          sessionId: z.string(),
        });
      case 'chat:getSessionStats':
        return z.object({});
      case 'chat:error':
        return z.object({
          message: z.string(),
          code: z.string().optional(),
          sessionId: z.string().optional(),
        });
      case 'chat:sessionsUpdated':
        return z.object({}).passthrough(); // Allow flexible session data structure

      // Permission request/response schemas
      case 'chat:permissionRequest':
        return z.object({
          requestId: z.string().min(1),
          permission: z.string().min(1),
          context: z.string().optional(),
          timestamp: z.number(),
          sessionId: z.string().min(1),
        });
      case 'chat:permissionResponse':
        return z.object({
          requestId: z.string().min(1),
          response: z.enum(['allow', 'always_allow', 'deny']),
          timestamp: z.number(),
        });

      // Command management schemas
      case 'commands:getTemplates':
        return z.object({}); // Empty payload
      case 'commands:executeCommand':
        return z.object({
          templateId: z.string(),
          parameters: z.record(z.string(), z.unknown()),
        });
      case 'commands:selectFile':
        return z.object({
          multiple: z.boolean().optional(),
        });
      case 'commands:saveTemplate':
        return z.object({
          template: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            command: z.string(),
            parameters: z
              .array(
                z.object({
                  name: z.string(),
                  type: z.string(),
                  description: z.string().optional(),
                  required: z.boolean().optional(),
                  default: z.unknown().optional(),
                }),
              )
              .optional(),
          }),
        });

      // View and navigation schemas
      case 'view:changed':
        return z.object({
          view: z.string(),
        });
      case 'view:routeChanged':
        return z.object({
          route: z.string(),
        });
      case 'view:generic':
        return z.object({
          data: z.unknown(),
        });

      // System message schemas
      case 'ready':
        return z.object({
          currentView: z.string().optional(),
        });
      case 'webview-ready':
        return z.object({}); // Empty payload
      case 'requestInitialData':
        return z.object({}); // Empty payload
      case 'initialData':
        return z.object({
          config: z.unknown().optional(),
          sessions: z.array(z.unknown()).optional(),
          currentSession: z.unknown().optional(),
        });
      case 'themeChanged':
        return z.object({
          theme: z.enum(['light', 'dark', 'high-contrast']),
        });
      case 'navigate':
        return z.object({
          route: z.string(),
        });
      case 'state:saved':
        return z.object({
          success: z.boolean(),
        });
      case 'state:loaded':
        return z.object({
          state: z.unknown(),
        });
      case 'error':
        return z.object({
          message: z.string(),
          code: z.string().optional(),
          stack: z.string().optional(),
        });

      // Legacy message types for compatibility
      case 'switchView':
        return z.object({
          view: z.string(),
        });
      case 'workspaceChanged':
        return z.object({
          workspaceInfo: z.unknown(),
        });

      default: {
        throw new ValidationError(
          `No payload schema defined for message type: ${messageType}`,
        );
      }
    }
  }

  /**
   * Validate chat message with discriminated union
   */
  validateChatMessage(data: unknown): StrictChatMessage {
    const result = StrictChatMessageSchema.safeParse(data);

    if (!result.success) {
      throw new ValidationError('Invalid chat message structure', {
        errors: result.error.issues,
        received: data,
      });
    }

    // Ensure 'id' is present and not undefined
    if (!result.data.id) {
      throw new ValidationError(
        'Chat message is missing required "id" property',
        {
          received: data,
        },
      );
    }

    return result.data as unknown as StrictChatMessage;
  }

  /**
   * Validate chat session
   */
  validateChatSession(data: unknown): StrictChatSession {
    const result = StrictChatSessionSchema.safeParse(data);

    if (!result.success) {
      throw new ValidationError('Invalid chat session structure', {
        errors: result.error.issues,
        received: data,
      });
    }

    return result.data as unknown as StrictChatSession;
  }

  /**
   * Validate message response
   */
  validateMessageResponse(data: unknown): MessageResponse {
    const result = MessageResponseSchema.safeParse(data);

    if (!result.success) {
      throw new ValidationError('Invalid message response structure', {
        errors: result.error.issues,
        received: data,
      });
    }

    return result.data as MessageResponse;
  }

  /**
   * Validate branded types with runtime checking
   */
  validateSessionId(data: unknown): SessionId {
    return BrandedTypeValidator.validateSessionId(data);
  }

  validateMessageId(data: unknown): MessageId {
    return BrandedTypeValidator.validateMessageId(data);
  }

  validateCorrelationId(data: unknown): CorrelationId {
    return BrandedTypeValidator.validateCorrelationId(data);
  }

  /**
   * Safe validation wrapper - returns null instead of throwing
   */
  safeValidateMessage<T extends keyof MessagePayloadMap>(
    data: unknown,
    expectedType: T,
  ): StrictMessage<T> | null {
    try {
      return this.validateMessage(data, expectedType);
    } catch {
      return null;
    }
  }

  /**
   * Validation wrapper for unknown message types
   */
  validateUnknownMessage(data: unknown): {
    type: keyof MessagePayloadMap;
    message: StrictMessage;
  } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const obj = data as Record<string, unknown>;
    const messageType = obj['type'];

    if (typeof messageType !== 'string') {
      return null;
    }

    const validatedMessage = this.safeValidateMessage(
      data,
      messageType as keyof MessagePayloadMap,
    );
    if (!validatedMessage) {
      return null;
    }

    return {
      type: messageType as keyof MessagePayloadMap,
      message: validatedMessage,
    };
  }

  /**
   * Format validation errors for debugging
   */
  formatValidationError(error: ZodError): string {
    return error.issues
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
  }

  /**
   * Create contextual error information
   */
  createErrorContext(
    error: unknown,
    context: Readonly<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    const baseContext = {
      timestamp: Date.now(),
      ...context,
    };

    if (error instanceof ZodError) {
      return {
        ...baseContext,
        validationErrors: error.issues,
        formattedError: this.formatValidationError(error),
      };
    }

    if (error instanceof Error) {
      return {
        ...baseContext,
        errorMessage: error.message,
        errorStack: error.stack,
      };
    }

    return {
      ...baseContext,
      error: String(error),
    };
  }
}
