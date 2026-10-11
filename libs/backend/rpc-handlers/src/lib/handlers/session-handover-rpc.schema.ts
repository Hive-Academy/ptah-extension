import { z } from 'zod';
import { UUID_REGEX, type RpcMethodParams } from '@ptah-extension/shared';

const boundedText = z.string().trim().min(1).max(12_000);

export const BeginSessionHandoverParamsSchema = z.object({
  sourceSessionId: z.string().regex(UUID_REGEX),
  sourceTabId: z.string().min(1).max(200),
  handoff: boundedText.optional(),
  queuedInput: boundedText.optional(),
});

export const CancelSessionHandoverParamsSchema = z.object({
  sourceSessionId: z.string().regex(UUID_REGEX),
  operationId: z.string().uuid(),
});

export const SuccessorBoundParamsSchema = z.object({
  operationId: z.string().uuid(),
  sourceTabId: z.string().min(1).max(200),
  successorTabId: z.string().uuid(),
});

export const GetSessionHandoverStateParamsSchema = z.object({
  sourceSessionId: z.string().regex(UUID_REGEX),
});

export function parseBeginSessionHandoverParams(
  raw: unknown,
): RpcMethodParams<'session:beginHandover'> | null {
  const result = BeginSessionHandoverParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseCancelSessionHandoverParams(
  raw: unknown,
): RpcMethodParams<'session:cancelHandover'> | null {
  const result = CancelSessionHandoverParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseSuccessorBoundParams(
  raw: unknown,
): RpcMethodParams<'session:successorBound'> | null {
  const result = SuccessorBoundParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseGetSessionHandoverStateParams(
  raw: unknown,
): RpcMethodParams<'session:getHandoverState'> | null {
  const result = GetSessionHandoverStateParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
