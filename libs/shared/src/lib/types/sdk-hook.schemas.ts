/**
 * Zod schemas for the SDK hook payload types.
 *
 * Split out of `sdk-hook.types.ts` so the wire types themselves carry no `zod`
 * dependency; only the RPC boundary that actually validates a payload pays for
 * it. Dependency direction is one-way: schemas → types.
 */

import { z } from 'zod';

/** Zod schema for {@link SdkCompactionCompletePayload}, used at the RPC boundary. */
export const SdkCompactionCompletePayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  trigger: z.union([z.literal('manual'), z.literal('auto')]),
  compactSummary: z.string(),
  timestamp: z.number().int().nonnegative(),
});

/** Zod schema for {@link SdkBackgroundTaskSummary}. */
export const SdkBackgroundTaskSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string(),
  command: z.string().optional(),
});

/** Zod schema for {@link SdkSessionCronSummary}. */
export const SdkSessionCronSummarySchema = z.object({
  id: z.string(),
  schedule: z.string(),
  recurring: z.boolean(),
  prompt: z.string(),
});

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
 * Zod schema for {@link SdkSubagentEndedPayload}.
 *
 * `toolCallId` is the one OPTIONAL field, and its `.catch(undefined)` is
 * load-bearing. It is a correlation id, not a required part of the terminal
 * signal: a peer of a different version that puts a blank or non-string value
 * on the key must still deliver the payload, because dropping it leaves every
 * background agent of that session stuck in `running` — the exact symptom
 * TASK_2026_376 F1 was filed to repair. `.catch(undefined)` therefore accepts
 * the payload and treats an invalid value as absent, while `.min(1)` keeps the
 * rule that `''` is never an id. The REQUIRED fields still reject.
 *
 * The key sits between `agentType` and `lastAssistantMessage` because Zod emits
 * output keys in SHAPE order, and `parseSdkSubagentEndedPayload` — proven
 * key-order-identical in `wire-parsers.equivalence.spec.ts` — writes it there.
 */
export const SdkSubagentEndedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  agentId: z.string().min(1),
  agentType: z.string().min(1),
  toolCallId: z.string().min(1).optional().catch(undefined),
  lastAssistantMessage: z.string().nullable(),
  backgroundTasks: z.array(SdkBackgroundTaskSummarySchema).readonly(),
  timestamp: z.number().int().nonnegative(),
});

/** Zod schema for {@link SessionTurnPhase}. */
export const SessionTurnPhaseSchema = z.enum([
  'generating',
  'awaiting-background',
  'sleeping',
  'idle',
  'failed',
]);

/** Zod schema for {@link SessionTurnState}, used at the `session:status` RPC boundary. */
export const SessionTurnStateSchema = z.object({
  phase: SessionTurnPhaseSchema,
  revision: z.number().int().nonnegative(),
  backgroundTasks: z.array(SdkBackgroundTaskSummarySchema).readonly(),
  sessionCrons: z.array(SdkSessionCronSummarySchema).readonly(),
  terminalReason: SdkTerminalReasonSchema.nullable(),
  error: SdkAssistantMessageErrorSchema.optional(),
  timestamp: z.number().int().nonnegative(),
});
