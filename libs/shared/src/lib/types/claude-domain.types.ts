/**
 * Claude Domain Types - Shared types for Claude CLI integration
 * Used across extension and webview for permissions, tool events, and streaming
 */

import { z } from 'zod';
import { SessionId } from './branded.types';

/**
 * Permission Decision Types
 */
export type PermissionDecision = 'allow' | 'deny' | 'always_allow';

export const PermissionDecisionSchema = z.enum([
  'allow',
  'deny',
  'always_allow',
]);

/**
 * Permission Rule - Defines an "always allow" pattern for commands
 */
export interface ClaudePermissionRule {
  readonly id: string;
  readonly pattern: string; // Glob pattern for command matching
  readonly scope: 'workspace' | 'user' | 'session';
  readonly createdAt: number;
  readonly expiresAt?: number; // Optional expiration timestamp
}

export const ClaudePermissionRuleSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  scope: z.enum(['workspace', 'user', 'session']),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
});

/**
 * Permission Request - From Claude CLI requesting tool execution permission
 */
export interface ClaudePermissionRequest {
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description?: string;
  readonly timestamp: number;
}

export const ClaudePermissionRequestSchema = z.object({
  toolCallId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  description: z.string().optional(),
  timestamp: z.number(),
});

/**
 * Permission Response - Response to permission request
 */
export interface ClaudePermissionResponse {
  readonly toolCallId: string;
  readonly decision: PermissionDecision;
  readonly provenance: 'user' | 'rule' | 'yolo';
  readonly timestamp: number;
}

export const ClaudePermissionResponseSchema = z.object({
  toolCallId: z.string(),
  decision: PermissionDecisionSchema,
  provenance: z.enum(['user', 'rule', 'yolo']),
  timestamp: z.number(),
});

/**
 * Tool Event Types - For event bus communication
 */
export type ClaudeToolEventType = 'start' | 'progress' | 'result' | 'error';

export interface ClaudeToolEventStart {
  readonly type: 'start';
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ClaudeToolEventProgress {
  readonly type: 'progress';
  readonly toolCallId: string;
  readonly message: string;
  readonly timestamp: number;
}

export interface ClaudeToolEventResult {
  readonly type: 'result';
  readonly toolCallId: string;
  readonly output: unknown;
  readonly duration: number;
  readonly timestamp: number;
}

export interface ClaudeToolEventError {
  readonly type: 'error';
  readonly toolCallId: string;
  readonly error: string;
  readonly timestamp: number;
}

export type ClaudeToolEvent =
  | ClaudeToolEventStart
  | ClaudeToolEventProgress
  | ClaudeToolEventResult
  | ClaudeToolEventError;

export const ClaudeToolEventStartSchema = z.object({
  type: z.literal('start'),
  toolCallId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
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

/**
 * Content Chunk - Streaming content from Claude
 */
export interface ClaudeContentChunk {
  readonly type: 'content';
  readonly delta: string;
  readonly index?: number;
  readonly timestamp: number;
}

export const ClaudeContentChunkSchema = z.object({
  type: z.literal('content'),
  delta: z.string(),
  index: z.number().optional(),
  timestamp: z.number(),
});

/**
 * Thinking Event - Claude's reasoning/thinking content
 */
export interface ClaudeThinkingEvent {
  readonly type: 'thinking';
  readonly content: string;
  readonly timestamp: number;
}

export const ClaudeThinkingEventSchema = z.object({
  type: z.literal('thinking'),
  content: z.string(),
  timestamp: z.number(),
});

/**
 * Session Resume Info - For continuing conversations
 */
export interface ClaudeSessionResume {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string; // Claude CLI's internal session ID
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

export const ClaudeSessionResumeSchema = z.object({
  sessionId: z.string(), // Validated separately as SessionId
  claudeSessionId: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
});

/**
 * CLI Health Check Result
 */
export interface ClaudeCliHealth {
  readonly available: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly responseTime?: number; // ms
  readonly error?: string;
  readonly platform: string; // Platform name (win32, darwin, linux, etc.)
  readonly isWSL: boolean;
}

export const ClaudeCliHealthSchema = z.object({
  available: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  responseTime: z.number().optional(),
  error: z.string().optional(),
  platform: z.string(),
  isWSL: z.boolean(),
});

/**
 * Model Selection Option
 */
export type ClaudeModel = 'opus' | 'sonnet' | 'haiku' | 'default';

export const ClaudeModelSchema = z.enum(['opus', 'sonnet', 'haiku', 'default']);

/**
 * CLI Launch Options
 */
export interface ClaudeCliLaunchOptions {
  readonly sessionId: SessionId;
  readonly model?: ClaudeModel;
  readonly resumeSessionId?: string;
  readonly workspaceRoot?: string;
  readonly verbose?: boolean;
}

export const ClaudeCliLaunchOptionsSchema = z.object({
  sessionId: z.string(), // Validated separately as SessionId
  model: ClaudeModelSchema.optional(),
  resumeSessionId: z.string().optional(),
  workspaceRoot: z.string().optional(),
  verbose: z.boolean().optional(),
});
