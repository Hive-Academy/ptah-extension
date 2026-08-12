/**
 * Zod schemas for the Claude domain types.
 *
 * Split out of `claude-domain.types.ts` so the tool-event / streaming
 * interfaces can be imported without pulling `zod` in. Dependency direction is
 * one-way: schemas → types.
 */

import { z } from 'zod';

export const ClaudeToolEventStartSchema = z.object({
  type: z.literal('start'),
  toolCallId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export const ClaudeToolEventProgressSchema = z.object({
  type: z.literal('progress'),
  toolCallId: z.string(),
  message: z.string(),
  timestamp: z.number(),
});

export const ClaudeToolEventResultSchema = z.object({
  type: z.literal('result'),
  toolCallId: z.string(),
  output: z.unknown(),
  duration: z.number(),
  timestamp: z.number(),
});

export const ClaudeToolEventErrorSchema = z.object({
  type: z.literal('error'),
  toolCallId: z.string(),
  error: z.string(),
  timestamp: z.number(),
});

export const ClaudeToolEventSchema = z.discriminatedUnion('type', [
  ClaudeToolEventStartSchema,
  ClaudeToolEventProgressSchema,
  ClaudeToolEventResultSchema,
  ClaudeToolEventErrorSchema,
]);

export const ClaudeContentChunkSchema = z.object({
  type: z.literal('content'),
  blocks: z.array(z.unknown()), // ContentBlock validation handled separately
  index: z.number().optional(),
  timestamp: z.number(),
});

export const ClaudeThinkingEventSchema = z.object({
  type: z.literal('thinking'),
  content: z.string(),
  timestamp: z.number(),
});

export const ClaudeSessionResumeSchema = z.object({
  sessionId: z.string(), // Validated separately as SessionId
  claudeSessionId: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
});

export const ClaudeCliHealthSchema = z.object({
  available: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  responseTime: z.number().optional(),
  error: z.string().optional(),
  platform: z.string(),
  isWSL: z.boolean(),
});

export const ClaudeModelSchema = z.enum(['opus', 'sonnet', 'haiku', 'default']);

export const ClaudeCliLaunchOptionsSchema = z.object({
  sessionId: z.string(), // Validated separately as SessionId
  model: ClaudeModelSchema.optional(),
  resumeSessionId: z.string().optional(),
  workspaceRoot: z.string().optional(),
  verbose: z.boolean().optional(),
});

/**
 * Zod Schemas for Runtime Validation
 */
export const ClaudeAgentStartEventSchema = z
  .object({
    type: z.literal('agent_start'),
    agentId: z.string(),
    subagentType: z.string(),
    description: z.string(),
    prompt: z.string(),
    model: z.string().optional(),
    timestamp: z.number(),
  })
  .strict();

export const ClaudeAgentActivityEventSchema = z
  .object({
    type: z.literal('agent_activity'),
    agentId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()),
    timestamp: z.number(),
  })
  .strict();

export const ClaudeAgentCompleteEventSchema = z
  .object({
    type: z.literal('agent_complete'),
    agentId: z.string(),
    duration: z.number(),
    result: z.string().optional(),
    timestamp: z.number(),
  })
  .strict();

export const ClaudeAgentEventSchema = z.discriminatedUnion('type', [
  ClaudeAgentStartEventSchema,
  ClaudeAgentActivityEventSchema,
  ClaudeAgentCompleteEventSchema,
]);

/**
 * SessionUIData Zod Schema - Runtime validation
 * Used by RPC methods to validate session data from backend
 */
export const SessionUIDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string().optional(),
  messageCount: z.number().int().nonnegative(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  createdAt: z.number().int().positive(),
  lastActiveAt: z.number().int().positive(),
  isActive: z.boolean(),
});
