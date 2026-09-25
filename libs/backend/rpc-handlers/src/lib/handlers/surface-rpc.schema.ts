/**
 * Zod schemas for {@link SurfaceRpcHandlers} (TASK_2026_538, plan Component 15).
 *
 * Every schema is `.strict()`: Ptah owns both ends of this boundary, so an
 * unknown key is a caller bug and an error, never silently dropped (Req 9.2).
 *
 * Composed only from the depth-bounded LEAF schemas of the v2 contract
 * (surface ids, operation ids, data values, selections), never from
 * `SurfaceComponentSchema` or `SurfaceEnvelopeSchema`: the renderer never sends
 * structure. The handler measures `jsonUtf8Bytes(params)` against
 * `SURFACE_LIMITS.maxRpcRequestBytes` BEFORE any of these run, so a parse never
 * walks an oversized request.
 *
 * Req 6.2: every mutation (`change`, `select`, `action`) requires `routingId`,
 * `surfaceId`, the rendered `revision` and an `operationId`. `read` names a
 * routing id and optionally one surface; `operation` names a routing id and an
 * operation id. Neither has a rendered revision to report.
 */

import { z } from 'zod';
import {
  SurfaceAnyIdSchema,
  SurfaceDataValueSchema,
  SurfaceOperationIdSchema,
  SurfaceSelectionSchema,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/**
 * A routing id is a tab id or a real session id, both host-generated and far
 * shorter than this. The bound only keeps an absurd key out of the store's
 * lookups and the host log.
 */
export const SURFACE_RPC_MAX_ROUTING_ID_LENGTH = 256;

const RoutingIdSchema = z
  .string()
  .min(1)
  .max(SURFACE_RPC_MAX_ROUTING_ID_LENGTH);

/** Component and action ids share the contract's component-id rule. */
const ComponentIdSchema = SurfaceSelectionSchema.shape.componentId;

/** A host revision: revisions start at 1 and only grow. */
const RevisionSchema = z.number().int().positive();

const mutationShape = {
  routingId: RoutingIdSchema,
  surfaceId: SurfaceAnyIdSchema,
  revision: RevisionSchema,
  operationId: SurfaceOperationIdSchema,
};

export const SurfaceReadParamsSchema = z
  .object({
    routingId: RoutingIdSchema,
    surfaceId: SurfaceAnyIdSchema.optional(),
  })
  .strict();

export const SurfaceChangeParamsSchema = z
  .object({
    ...mutationShape,
    componentId: ComponentIdSchema,
    value: SurfaceDataValueSchema,
  })
  .strict();

export const SurfaceSelectParamsSchema = z
  .object({
    ...mutationShape,
    selection: SurfaceSelectionSchema.nullable(),
  })
  .strict();

export const SurfaceActionParamsSchema = z
  .object({
    ...mutationShape,
    actionId: ComponentIdSchema,
  })
  .strict();

export const SurfaceOperationParamsSchema = z
  .object({
    routingId: RoutingIdSchema,
    operationId: SurfaceOperationIdSchema,
  })
  .strict();

export type SurfaceReadInput = z.infer<typeof SurfaceReadParamsSchema>;
export type SurfaceChangeInput = z.infer<typeof SurfaceChangeParamsSchema>;
export type SurfaceSelectInput = z.infer<typeof SurfaceSelectParamsSchema>;
export type SurfaceActionInput = z.infer<typeof SurfaceActionParamsSchema>;
export type SurfaceOperationInput = z.infer<
  typeof SurfaceOperationParamsSchema
>;
