/**
 * Zod schema for `agent:getCapabilityMatrix`.
 *
 * Params are an empty object. The reader result is untrusted: the store's
 * result is parsed at the RPC boundary before it becomes a response.
 */

import { z } from 'zod';
import { OUTCOME_TASK_KINDS } from '@ptah-extension/shared';
import { CAPABILITY_MATRIX_CELL_SOURCES } from '@ptah-extension/shared';

export const CapabilityMatrixParamsSchema = z.object({}).strict();
export const RotationPicksSchema = z.array(z.object({
  key: z.string().min(1),
  candidateId: z.string().min(1),
}).strict());

const unknownCellSchema = z
  .object({
    kind: z.literal('unknown'),
  })
  .strict();

const valueCellSchema = z
  .object({
    kind: z.literal('value'),
    score: z.number().finite(),
    source: z.enum(CAPABILITY_MATRIX_CELL_SOURCES),
    sourceRef: z.string().nullable().optional(),
    asOf: z.string(),
    stale: z.boolean(),
    sampleCount: z.number().finite().nullable().optional(),
    note: z.string().optional(),
  })
  .strict();

const cellSchema = z.discriminatedUnion('kind', [
  unknownCellSchema,
  valueCellSchema,
]);

const cellsShape = {
  plan: cellSchema,
  implement: cellSchema,
  review: cellSchema,
  research: cellSchema,
  tests: cellSchema,
  docs: cellSchema,
} as const;

const cellsSchema = z.object(cellsShape).strict();

const profileSchema = z
  .object({
    family: z.string().min(1),
    model: z.string().min(1),
    cells: cellsSchema,
  })
  .strict();

/** Accepts the view document (`version` ignored) or `{ profiles }`. */
export const CapabilityMatrixViewSchema = z
  .object({
    profiles: z.array(profileSchema),
  })
  .passthrough();

export type ParsedCapabilityMatrixView = z.infer<
  typeof CapabilityMatrixViewSchema
>;

/** Every task kind the cell object must carry. Kept next to the schema. */
export const CAPABILITY_MATRIX_KINDS = OUTCOME_TASK_KINDS;
