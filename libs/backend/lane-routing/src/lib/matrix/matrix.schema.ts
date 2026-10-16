import { z } from 'zod';
import {
  MINIMUM_SAMPLE_COUNT,
  SCORE_MAX,
  SCORE_MIN,
} from '../routing-constants';
import {
  CAPABILITY_MATRIX_VERSION,
  MATRIX_CELL_SOURCES,
  type CapabilityMatrix,
  type MatrixCell,
  type MatrixCells,
  type MatrixProfile,
} from './matrix.types';

/**
 * Zod schemas for the capability matrix (part A §3). The user file, the
 * shipped seed and the view are all checked against these shapes; the issue
 * path of a rejection names the entry (Requirement 6.7).
 */

const NonBlank = (max: number) =>
  z.string().max(max).regex(/\S/, 'must not be blank');

/** Publication date (`YYYY-MM-DD`) or the timestamp of an outcome record. */
const AsOf = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const UnknownMatrixCellSchema = z
  .object({ kind: z.literal('unknown') })
  .strict();

export const ValueMatrixCellSchema = z
  .object({
    kind: z.literal('value'),
    score: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
    source: z.enum(MATRIX_CELL_SOURCES),
    sourceRef: NonBlank(500).optional(),
    asOf: AsOf,
    stale: z.boolean(),
    note: NonBlank(500).optional(),
    sampleCount: z.number().int().min(MINIMUM_SAMPLE_COUNT).optional(),
  })
  .strict()
  .superRefine((cell, ctx) => {
    if (cell.source === 'seed') {
      if (cell.sourceRef === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceRef'],
          message: 'a seed value must name its dataset or URL',
        });
      }
      if (cell.note === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'a seed value must say what it measures',
        });
      }
    }
    if (cell.source === 'local') {
      if (cell.sampleCount === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['sampleCount'],
          message: 'a local value must carry its sample count',
        });
      }
      if (cell.sourceRef !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceRef'],
          message: 'a local value has no external source',
        });
      }
    } else if (cell.sampleCount !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sampleCount'],
        message: 'only a local value carries a sample count',
      });
    }
  });

export const MatrixCellSchema = z.discriminatedUnion('kind', [
  UnknownMatrixCellSchema,
  ValueMatrixCellSchema,
]) satisfies z.ZodType<MatrixCell>;

/** One key per `OUTCOME_TASK_KINDS` entry; the spec pins the key set. */
export const MatrixCellsSchema = z
  .object({
    plan: MatrixCellSchema,
    implement: MatrixCellSchema,
    review: MatrixCellSchema,
    research: MatrixCellSchema,
    tests: MatrixCellSchema,
    docs: MatrixCellSchema,
  })
  .strict() satisfies z.ZodType<MatrixCells>;

export const MatrixProfileSchema = z
  .object({
    family: NonBlank(200),
    model: NonBlank(200),
    cells: MatrixCellsSchema,
  })
  .strict() satisfies z.ZodType<MatrixProfile>;

export const CapabilityMatrixSchema = z
  .object({
    version: z.literal(CAPABILITY_MATRIX_VERSION),
    // Bounds validation work on a hand-edited file.
    profiles: z.array(MatrixProfileSchema).max(1000),
  })
  .strict()
  .superRefine((matrix, ctx) => {
    const seen = new Set<string>();
    matrix.profiles.forEach((profile, index) => {
      const key = JSON.stringify([profile.family, profile.model]);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['profiles', index, 'model'],
          message:
            `duplicate profile for family "${profile.family}" ` +
            `and model "${profile.model}"`,
        });
      }
      seen.add(key);
    });
  }) satisfies z.ZodType<CapabilityMatrix>;
