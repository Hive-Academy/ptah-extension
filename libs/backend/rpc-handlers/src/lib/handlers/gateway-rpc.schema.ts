/**
 * Zod schemas for {@link GatewayRpcHandlers}.
 *
 * The `origin` field is a cross-cutting UI-coordination concern added on the
 * wire by the frontend for gateway:start and gateway:stop, but it is NOT
 * declared in the `GatewayStartParams` / `GatewayStopParams` shared types
 * (which remain minimal). We extract it safely using `GatewayOriginSchema`
 * rather than an inline type cast — this converts the unchecked
 * `(params as { origin?: string })` casts into validated optional reads.
 *
 * All other param validation continues via shared TypeScript types and the
 * inline guard clauses in the handler (e.g. platform/token presence checks).
 */
import { z } from 'zod';

/**
 * Extracts the optional `origin` field from gateway start/stop params.
 *
 * `origin` is a string token identifying the UI component that triggered the
 * action — used to suppress self-echo in status broadcasts. It is optional
 * and must be a string when present; non-string values are treated as absent.
 */
export const GatewayOriginSchema = z
  .object({ origin: z.string().optional() })
  .passthrough();

/**
 * Extract the `origin` string from raw params, or null if absent/invalid.
 * Replaces the `(params as { origin?: string } | undefined)?.origin ?? null`
 * inline cast in registerStart and registerStop.
 */
export function extractGatewayOrigin(params: unknown): string | null {
  const parsed = GatewayOriginSchema.safeParse(params ?? {});
  if (!parsed.success) return null;
  return parsed.data.origin ?? null;
}

/**
 * Boundary schema for `gateway:attachSession`. The webview supplies the real
 * SDK `sessionUuid` and the session's `workspaceRoot` (never inferred backend
 * side); `externalConversationId` is optional and defaults to `'default'` at
 * the service layer.
 */
export const GatewayAttachSessionParamsSchema = z
  .object({
    bindingId: z.string().min(1),
    sessionUuid: z.string().min(1),
    workspaceRoot: z.string().min(1),
    externalConversationId: z.string().min(1).optional(),
  })
  .passthrough();

/** Boundary schema for `gateway:detachSession`. */
export const GatewayDetachSessionParamsSchema = z
  .object({
    bindingId: z.string().min(1),
  })
  .passthrough();
