/**
 * Zod runtime validation schemas for messages, sessions, and content blocks.
 */

import { z } from 'zod';

import {
  SessionIdSchema,
  MessageIdSchema,
  CorrelationIdSchema,
} from '../branded.types';

import type { StrictMessageType } from './message-type';

/**
 * Zod Schemas for Runtime Validation
 */
export const StrictMessageTypeSchema = z.enum([
  'chat:sendMessage',
  'chat:messageChunk',
  'chat:sessionStart',
  'chat:sessionEnd',
  'chat:newSession',
  'chat:switchSession',
  'chat:getHistory',
  'chat:messageAdded',
  'chat:messageComplete',
  'chat:sessionCreated',
  'chat:sessionSwitched',
  'chat:historyLoaded',
  'context:updateFiles',
  'analytics:trackEvent',
]);

export const ChatSendMessagePayloadSchema = z
  .object({
    content: z.string().min(1).max(10000),
    files: z.array(z.string()).optional(),
    correlationId: z.string().optional(),
    metadata: z
      .object({
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
  })
  .strict();

export const ChatMessageChunkPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    messageId: MessageIdSchema,
    content: z.string(),
    isComplete: z.boolean(),
    streaming: z.boolean(),
  })
  .strict();

export const MessageMetadataSchema = z
  .object({
    timestamp: z.number().positive(),
    source: z.enum(['extension', 'webview']),
    sessionId: SessionIdSchema.optional(),
    version: z.string(),
  })
  .strict();

export const StrictMessageSchema = <T extends StrictMessageType>(type: T) =>
  z
    .object({
      id: CorrelationIdSchema,
      type: z.literal(type),
      payload: z.unknown(), // Will be refined by specific payload schema
      metadata: MessageMetadataSchema,
    })
    .strict();

export const MessageResponseSchema = z
  .object({
    requestId: CorrelationIdSchema,
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        context: z.record(z.string(), z.unknown()).optional(),
        stack: z.string().optional(),
      })
      .optional(),
    metadata: MessageMetadataSchema,
  })
  .strict();

// Zod schema for MCPServerInfo
export const MCPServerInfoSchema = z.object({
  name: z.string(),
  status: z.enum(['connected', 'disabled', 'failed']),
  tools: z.array(z.string()).optional(),
});

// Zod schema for SessionCapabilities
export const SessionCapabilitiesSchema = z.object({
  cwd: z.string(),
  model: z.string(),
  tools: z.array(z.string()),
  agents: z.array(z.string()),
  slash_commands: z.array(z.string()),
  mcp_servers: z.array(MCPServerInfoSchema),
  claude_code_version: z.string(),
});

/**
 * Zod Schemas for ContentBlock Runtime Validation
 */

/**
 * TextContentBlock Zod schema
 */
export const TextContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    index: z.number().optional(),
  })
  .strict();

/**
 * ToolUseContentBlock Zod schema
 */
export const ToolUseContentBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    index: z.number().optional(),
  })
  .strict();

/**
 * ThinkingContentBlock Zod schema
 */
export const ThinkingContentBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    index: z.number().optional(),
  })
  .strict();

/**
 * ContentBlock Zod schema - discriminated union
 * Enables runtime validation of structured content blocks
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ToolUseContentBlockSchema,
  ThinkingContentBlockSchema,
]);

export const StrictChatMessageSchema = z.object({
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  type: z.enum(['user', 'assistant', 'system']),
  contentBlocks: z.array(ContentBlockSchema),
  timestamp: z.number().positive(),
  streaming: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  isError: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // For assistant messages
  isComplete: z.boolean().optional(),
  // For system messages
  level: z.enum(['info', 'warning', 'error']).optional(),
  // Message lifecycle fields
  cost: z.number().nonnegative().optional(),
  tokens: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheHit: z.number().nonnegative().optional(),
    })
    .optional(),
  duration: z.number().nonnegative().optional(),
});

export const StrictChatSessionSchema = z
  .object({
    id: SessionIdSchema,
    name: z.string(),
    workspaceId: z.string().optional(),
    messages: z.array(StrictChatMessageSchema),
    createdAt: z.number().positive(),
    lastActiveAt: z.number().positive(),
    updatedAt: z.number().positive(),
    messageCount: z.number().nonnegative(),
    tokenUsage: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        total: z.number().nonnegative(),
        percentage: z.number().nonnegative(),
        maxTokens: z.number().positive().optional(),
      })
      .strict(),
    // IMPLEMENTATION_PLAN compatibility fields
    capabilities: SessionCapabilitiesSchema.optional(),
    model: z.string().optional(),
    totalCost: z.number().nonnegative().optional(),
    totalTokensInput: z.number().nonnegative().optional(),
    totalTokensOutput: z.number().nonnegative().optional(),
  })
  .strict();
