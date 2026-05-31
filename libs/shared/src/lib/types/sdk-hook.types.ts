/**
 * SDK Hook Payload Types
 *
 * Structural mirrors of the SDK hook payloads that cross the wire
 * (backend → webview) as session lifecycle notifications. These types are
 * shared between the bus emitter side (`agent-sdk` lib) and the webview
 * consumer side, and are validated with Zod at the RPC boundary.
 *
 * Covers PostCompact (Phase 1), Stop / StopFailure (Phase 2), and
 * SubagentStop (Phase 3).
 */

import { z } from 'zod';

/**
 * Wire payload for `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE`
 * (`'session:compactionComplete'`).
 *
 * Emitted after the SDK's PostCompact hook fires. Consumers stamp
 * `tab.lastCompactionAt = timestamp` and clear any in-flight compaction
 * state for the affected conversation.
 */
export interface SdkCompactionCompletePayload {
  /** SDK session UUID the compaction belongs to. */
  readonly sessionId: string;
  /** Workspace root the SDK query was rooted at. */
  readonly cwd: string;
  /** Whether the compaction was user-initiated (`manual`) or SDK-driven (`auto`). */
  readonly trigger: 'manual' | 'auto';
  /** Compaction summary text produced by the SDK. */
  readonly compactSummary: string;
  /** Epoch ms when the PostCompact hook fired in the backend. */
  readonly timestamp: number;
}

/** Zod schema for {@link SdkCompactionCompletePayload}, used at the RPC boundary. */
export const SdkCompactionCompletePayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  trigger: z.union([z.literal('manual'), z.literal('auto')]),
  compactSummary: z.string(),
  timestamp: z.number().int().nonnegative(),
});

/**
 * Structural mirror of the SDK's `BackgroundTaskSummary`
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:123-138`).
 */
export interface SdkBackgroundTaskSummary {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly description: string;
  readonly command?: string;
}

/** Zod schema for {@link SdkBackgroundTaskSummary}. */
export const SdkBackgroundTaskSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string(),
  command: z.string().optional(),
});

/**
 * Structural mirror of the SDK's `SessionCronSummary`
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3724-3738`).
 */
export interface SdkSessionCronSummary {
  readonly id: string;
  readonly schedule: string;
  readonly recurring: boolean;
  readonly prompt: string;
}

/** Zod schema for {@link SdkSessionCronSummary}. */
export const SdkSessionCronSummarySchema = z.object({
  id: z.string(),
  schedule: z.string(),
  recurring: z.boolean(),
  prompt: z.string(),
});

/**
 * Structural mirror of the SDK's 12-variant `TerminalReason` union
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5687`).
 */
export type SdkTerminalReason =
  | 'blocking_limit'
  | 'rapid_refill_breaker'
  | 'prompt_too_long'
  | 'image_error'
  | 'model_error'
  | 'aborted_streaming'
  | 'aborted_tools'
  | 'stop_hook_prevented'
  | 'hook_stopped'
  | 'tool_deferred'
  | 'max_turns'
  | 'completed';

/** Zod schema for {@link SdkTerminalReason}. */
export const SdkTerminalReasonSchema = z.union([
  z.literal('blocking_limit'),
  z.literal('rapid_refill_breaker'),
  z.literal('prompt_too_long'),
  z.literal('image_error'),
  z.literal('model_error'),
  z.literal('aborted_streaming'),
  z.literal('aborted_tools'),
  z.literal('stop_hook_prevented'),
  z.literal('hook_stopped'),
  z.literal('tool_deferred'),
  z.literal('max_turns'),
  z.literal('completed'),
]);

/**
 * Structural mirror of the SDK's `SDKAssistantMessageError` string literal union
 * (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2574`).
 */
export type SdkAssistantMessageError =
  | 'authentication_failed'
  | 'oauth_org_not_allowed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens';

/** Zod schema for {@link SdkAssistantMessageError}. */
export const SdkAssistantMessageErrorSchema = z.union([
  z.literal('authentication_failed'),
  z.literal('oauth_org_not_allowed'),
  z.literal('billing_error'),
  z.literal('rate_limit'),
  z.literal('invalid_request'),
  z.literal('model_not_found'),
  z.literal('server_error'),
  z.literal('unknown'),
  z.literal('max_output_tokens'),
]);

/**
 * Wire payload for `MESSAGE_TYPES.SESSION_TURN_ENDED`
 * (`'session:turnEnded'`).
 *
 * Emitted after the SDK's Stop hook fires. Consumers finalize the
 * in-flight assistant message and flip tab status to `'loaded'`
 * (Phase 2) or `'awaiting-background'` (Phase 3, when background tasks
 * are still in flight).
 */
export interface SdkTurnEndedPayload {
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastAssistantMessage: string | null;
  readonly backgroundTasks: readonly SdkBackgroundTaskSummary[];
  readonly sessionCrons: readonly SdkSessionCronSummary[];
  readonly terminalReason: SdkTerminalReason | null;
  readonly timestamp: number;
}

/** Zod schema for {@link SdkTurnEndedPayload}. */
export const SdkTurnEndedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  lastAssistantMessage: z.string().nullable(),
  backgroundTasks: z.array(SdkBackgroundTaskSummarySchema).readonly(),
  sessionCrons: z.array(SdkSessionCronSummarySchema).readonly(),
  terminalReason: SdkTerminalReasonSchema.nullable(),
  timestamp: z.number().int().nonnegative(),
});

/**
 * Wire payload for `MESSAGE_TYPES.SESSION_TURN_FAILED`
 * (`'session:turnFailed'`).
 *
 * Emitted after the SDK's StopFailure hook fires. Consumers finalize the
 * in-flight assistant message as aborted and surface the error.
 */
export interface SdkTurnFailedPayload {
  readonly sessionId: string;
  readonly cwd: string;
  readonly lastAssistantMessage: string | null;
  readonly error: SdkAssistantMessageError;
  readonly errorDetails: string | null;
  readonly terminalReason: SdkTerminalReason | null;
  readonly timestamp: number;
}

/** Zod schema for {@link SdkTurnFailedPayload}. */
export const SdkTurnFailedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  lastAssistantMessage: z.string().nullable(),
  error: SdkAssistantMessageErrorSchema,
  errorDetails: z.string().nullable(),
  terminalReason: SdkTerminalReasonSchema.nullable(),
  timestamp: z.number().int().nonnegative(),
});

/**
 * Wire payload for `MESSAGE_TYPES.SESSION_SUBAGENT_ENDED`
 * (`'session:subagentEnded'`).
 *
 * Emitted after the SDK's SubagentStop hook fires. Consumers reconcile the
 * background-task list on the parent session so the UI can transition the
 * tab out of `'awaiting-background'` once every in-flight subagent has
 * reported in.
 */
export interface SdkSubagentEndedPayload {
  readonly sessionId: string;
  readonly cwd: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly lastAssistantMessage: string | null;
  readonly backgroundTasks: readonly SdkBackgroundTaskSummary[];
  readonly timestamp: number;
}

/** Zod schema for {@link SdkSubagentEndedPayload}. */
export const SdkSubagentEndedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  agentId: z.string().min(1),
  agentType: z.string().min(1),
  lastAssistantMessage: z.string().nullable(),
  backgroundTasks: z.array(SdkBackgroundTaskSummarySchema).readonly(),
  timestamp: z.number().int().nonnegative(),
});
