/**
 * Zod schemas for runtime validation of execution-node types.
 *
 * Extracted from execution-node.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import { z } from 'zod';

import type { ExecutionNode } from './node';

export const ExecutionNodeTypeSchema = z.enum([
  'message',
  'agent',
  'tool',
  'thinking',
  'text',
  'system',
]);

export const ExecutionStatusSchema = z.enum([
  'pending',
  'streaming',
  'complete',
  'interrupted',
  'resumed',
  'error',
]);

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);

/**
 * MessageTokenUsage Zod schema - validates token usage with optional cache fields
 * Aligned with Claude SDK cost tracking
 */
export const MessageTokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheCreation: z.number().optional(),
});

// Recursive schema requires lazy evaluation
export const ExecutionNodeSchema: z.ZodType<ExecutionNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: ExecutionNodeTypeSchema,
    status: ExecutionStatusSchema,
    content: z.string().nullable(),
    error: z.string().optional(),
    toolName: z.string().optional(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    toolOutput: z.unknown().optional(),
    toolCallId: z.string().optional(),
    isPermissionRequest: z.boolean().optional(),
    agentType: z.string().optional(),
    agentModel: z.string().optional(),
    agentDescription: z.string().optional(),
    agentPrompt: z.string().optional(),
    summaryContent: z.string().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    duration: z.number().optional(),
    tokenUsage: MessageTokenUsageSchema.optional(),
    toolCount: z.number().optional(),
    children: z.array(ExecutionNodeSchema),
    isCollapsed: z.boolean(),
    isHighlighted: z.boolean().optional(),
    isBackground: z.boolean().optional(),
  }),
);

export const AgentInfoSchema = z.object({
  agentType: z.string(),
  agentDescription: z.string().optional(),
  agentModel: z.string().optional(),
  summaryContent: z.string().optional(),
  hasSummary: z.boolean().optional(),
  hasExecution: z.boolean().optional(),
  isInterrupted: z.boolean().optional(),
  isStreaming: z.boolean().optional(),
  isBackground: z.boolean().optional(),
  toolUseId: z.string().optional(),
});

export const ExecutionChatMessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  timestamp: z.number(),
  streamingState: ExecutionNodeSchema.nullable(),
  rawContent: z.string().optional(),
  files: z.array(z.string()).readonly().optional(),
  imageCount: z.number().optional(),
  sessionId: z.string().optional(),
  agentInfo: AgentInfoSchema.optional(),
});

export const ChatSessionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  tokenUsage: MessageTokenUsageSchema.optional(),
  isActive: z.boolean(),
});

export const JSONLMessageTypeSchema = z.enum([
  'system',
  'assistant',
  'user',
  'tool',
  'result',
]);

export const ContentBlockJSONSchema = z.object({
  type: z.enum(['text', 'tool_use', 'tool_result']),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  content: z.union([z.string(), z.unknown()]).optional(),
  is_error: z.boolean().optional(),
});

export const JSONLMessageSchema = z.object({
  type: JSONLMessageTypeSchema,
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  thinking: z.string().optional(),
  delta: z.string().optional(),
  message: z
    .object({
      content: z.array(ContentBlockJSONSchema).readonly().optional(),
      stop_reason: z.string().optional(),
    })
    .optional(),
  tool: z.string().optional(),
  tool_use_id: z.string().optional(),
  parent_tool_use_id: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  cost: z.number().optional(),
  duration: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
  timestamp: z.string().optional(),
});
