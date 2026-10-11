/**
 * Zod validation schemas for Memory RPC handlers.
 *
 * `MemoryPurgeBySubjectPatternParamsSchema` validates params for the
 * `memory:purgeBySubjectPattern` RPC method before the handler acts on them.
 * The `min(1)` guard is belt-and-braces on top of the store-level empty-string guard.
 *
 * `MemorySearchParamsSchema` validates params for `memory:search`, including
 * the optional `workspaceRoot` filter.
 */
import { z } from 'zod';

export const MemoryPurgeBySubjectPatternParamsSchema = z.object({
  pattern: z.string().min(1, 'pattern must not be empty'),
  mode: z.enum(['substring', 'like']),
  workspaceRoot: z.string().min(1),
});

export const MemorySearchParamsSchema = z.object({
  query: z.string(),
  topK: z.number().int().positive().max(50).optional(),
  workspaceRoot: z.string().min(1).optional(),
});

export type MemoryPurgeBySubjectPatternParams = z.infer<
  typeof MemoryPurgeBySubjectPatternParamsSchema
>;

export const MemoryDiagnosticsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  eventLimit: z.number().int().positive().max(200).optional(),
});

export const MemoryRunNowParamsSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .refine((v) => v !== 'manual', {
      message: 'reserved sessionId',
    }),
  workspaceRoot: z.string().min(1),
});

export const MemoryTriggersSchema = z.object({
  idleMs: z
    .number()
    .int()
    .nonnegative()
    .refine((v) => v === 0 || v >= 5000, {
      message: 'idleMs must be 0 or >= 5000',
    }),
  turnThreshold: z
    .number()
    .int()
    .nonnegative()
    .refine((v) => v === 0 || v >= 2, {
      message: 'turnThreshold must be 0 or >= 2',
    }),
  bootScan: z.boolean(),
  userPromptSubmit: z
    .object({
      enabled: z.boolean(),
      cueList: z.array(z.string().min(1).max(200)).max(50),
      minPromptLength: z.number().int().min(0).max(10000),
    })
    .optional(),
  postToolUse: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  turnComplete: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  episode: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  sessionEnd: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  maxCuratesPerHour: z.number().int().min(0).max(1000).optional(),
  curatorProvider: z.string().max(200).optional(),
  curatorModel: z.string().max(200).optional(),
});

export const MemorySetTriggersParamsSchema = z.object({
  triggers: MemoryTriggersSchema.partial(),
  /** `memory.enabled` — the memory pause switch. Omitted → unchanged. */
  enabled: z.boolean().optional(),
});

export const MemoryGetTriggersParamsSchema = z.object({}).strict().optional();

/**
 * `scope` on the read-scoped memory endpoints. Optional with a defined default
 * of `'workspace'`, so callers that predate the field — `ptah memory stats`
 * and the TUI Memory panel both send `{}` — keep working and get the
 * workspace-scoped answer by explicit decision rather than by accident.
 */
export const MemoryQueryScopeSchema = z
  .enum(['all', 'workspace'])
  .default('workspace');

export const MemoryStatsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  scope: MemoryQueryScopeSchema,
});

/** A quarantine rule reason as written by the rules, e.g. `rule:commitlint-scope-facts`. */
const QuarantineReasonSchema = z
  .string()
  .max(200)
  .regex(/^rule:[a-z0-9-]+$/, 'reason must match rule:<id>');

/** Most ids one `memory:restoreQuarantined` call accepts (the store's cap). */
const RESTORE_QUARANTINED_MAX_IDS = 500;

export const MemoryListQuarantinedParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  scope: MemoryQueryScopeSchema,
  reason: QuarantineReasonSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

/**
 * `workspaceRoot` is a REQUIRED key: an omitted key must never fall back to
 * "current workspace" or "all workspaces". An explicit `null` targets exactly
 * the unscoped rows. Exactly one of `ids`, `reason`, `all` selects the rows.
 */
export const MemoryRestoreQuarantinedParamsSchema = z
  .object({
    workspaceRoot: z.union([z.string().min(1), z.null()]),
    ids: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(RESTORE_QUARANTINED_MAX_IDS)
      .optional(),
    reason: QuarantineReasonSchema.optional(),
    all: z.literal(true).optional(),
  })
  .refine(
    (p) =>
      [p.ids, p.reason, p.all].filter((selector) => selector !== undefined)
        .length === 1,
    { message: 'exactly one of ids, reason or all is required' },
  );

export const MemorySearchSymbolsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  scope: MemoryQueryScopeSchema,
  query: z.string().max(500).optional(),
  kinds: z.array(z.string().min(1).max(100)).max(50).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
