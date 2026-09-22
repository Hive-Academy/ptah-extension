/**
 * Declarative dashboard spec — the zod schemas.
 *
 * TASK_2026_493_9f58, deliverable 1. An agent emits JSON from the fixed catalog
 * in `dashboard-catalog.ts` and never writes HTML. This module is the only
 * definition of what that JSON may contain: the envelope, the component tree,
 * and the data reference that keeps a large dataset OUT of the spec.
 *
 * The published TYPES live in `dashboard-spec.types.ts`, which imports no zod.
 * Dependency direction is one-way, schemas → types, exactly as
 * `provider-profile.schemas.ts` → `provider-profile.types.ts`; that file
 * explains why.
 *
 * WHAT `satisfies z.ZodType<…>` DOES AND DOES NOT GUARANTEE. Revision 1 of this
 * task overstated it, and a reviewer disproved the claim by compiling the real
 * source, so here is the exact scope. `satisfies` checks ASSIGNABILITY of the
 * schema's output to the published type, in one direction. It therefore catches:
 * a required field dropped from the schema, a field whose schema type no longer
 * fits the declared one, and a literal or enum that drifts. It does NOT catch a
 * field added to the SCHEMA only — a schema-only `reviewerOnly: z.string()`
 * compiles cleanly, because a wider object is still assignable. Nor can an
 * exact-equality assertion be added cheaply: the declared types use `readonly`
 * arrays and zod infers mutable ones, so mutual assignability fails on a
 * difference that does not matter. The schema-only direction is guarded at
 * RUNTIME instead — every object is `.strict()`, so an undeclared key is a
 * rejection — and by the contract specs, which round-trip a populated instance
 * of each of the five kinds. Do not rely on the compiler for more than the
 * above.
 *
 * Every object is `.strict()`. There is no `z.any()`, no `z.unknown()` in a
 * value position and no `.passthrough()`/`.loose()` anywhere — `context.md`
 * "Trust boundary" control 2 forbids them, and `dashboard-trust-boundary.spec.ts`
 * proves the file keeps its word. An unknown key is a rejection with the
 * offending path named, not a silently dropped field, because a dropped field
 * is how an agent's typo becomes a dashboard that quietly means something else.
 *
 * Past this boundary the types are trusted: nothing re-validates.
 */

import { z } from 'zod';
import {
  DASHBOARD_ACTIONS,
  DASHBOARD_LIMITS,
  DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
  DASHBOARD_TEXT_FORMATS,
  isAllowedDashboardUrl,
} from './dashboard-catalog';
import type {
  DashboardAction,
  DashboardBarChartComponent,
  DashboardComponent,
  DashboardDataRef,
  DashboardLineChartComponent,
  DashboardListComponent,
  DashboardListItem,
  DashboardProposeSpecInput,
  DashboardRichText,
  DashboardSeries,
  DashboardSeriesPoint,
  DashboardSpecEnvelope,
  DashboardStatComponent,
  DashboardTableCell,
  DashboardTableColumn,
  DashboardTableComponent,
  DashboardUrl,
} from './dashboard-spec.types';

const MAX_STRING = DASHBOARD_LIMITS.maxStringLength;

/**
 * A slug: an id the host can use as a key, a DOM id fragment and a log field
 * without escaping it. Anchored at both ends, so no newline, no whitespace and
 * no path or protocol separator can enter an id.
 */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Every string in the contract is capped by the one string budget. */
const boundedString = () => z.string().max(MAX_STRING);

const slug = () => z.string().min(1).max(MAX_STRING).regex(SLUG_PATTERN);

/**
 * A URL a spec may carry (trust-boundary control 4). The refinement is the
 * whole point: `z.string().url()` would accept `javascript:alert(1)`.
 */
export const DashboardUrlSchema = z
  .string()
  .max(MAX_STRING)
  .refine(isAllowedDashboardUrl, {
    message:
      'URL must be absolute, carry no credentials and use an allowed scheme (https:). ' +
      'javascript:, data:, file: and http: are rejected.',
  }) satisfies z.ZodType<DashboardUrl>;

/** See `DashboardRichText`. Absent `format` means `plain` — the safe default. */
export const DashboardRichTextSchema = z
  .object({
    text: boundedString(),
    format: z.enum(DASHBOARD_TEXT_FORMATS).optional(),
  })
  .strict() satisfies z.ZodType<DashboardRichText>;

/**
 * See `DashboardAction` (trust-boundary controls 1 and 5). `.strict()` is what
 * makes host mediation structural rather than a convention: a spec that tries
 * to smuggle a `toolName` or `rpcMethod` key is rejected outright instead of
 * having the key ignored.
 */
export const DashboardActionSchema = z
  .object({
    action: z.enum(DASHBOARD_ACTIONS),
    label: DashboardRichTextSchema,
    /** Required by `dashboard.open-url`, rejected on every other action. */
    url: DashboardUrlSchema.optional(),
    params: z
      .record(
        z.string().min(1).max(MAX_STRING),
        z.union([boundedString(), z.number(), z.boolean()]),
      )
      .optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    const needsUrl = action.action === 'dashboard.open-url';
    if (needsUrl && action.url === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'dashboard.open-url requires a url.',
      });
    }
    if (!needsUrl && action.url !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `url is only allowed on dashboard.open-url, not on ${action.action}.`,
      });
    }
  }) satisfies z.ZodType<DashboardAction>;

/**
 * See `DashboardDataRef`. Critique `critique-engineering.md` section 5: "Large
 * datasets should be paged or referenced by opaque result id, never embedded
 * without a cap in the spec". A component carries either its own inline data
 * (capped by the row/point budgets) or one of these — never both, never
 * neither.
 */
export const DashboardDataRefSchema = z
  .object({
    resultId: slug(),
    rowCount: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<DashboardDataRef>;

/** See `DashboardSeriesPoint`. */
export const DashboardSeriesPointSchema = z
  .object({
    x: z.union([boundedString(), z.number()]),
    y: z.number(),
  })
  .strict() satisfies z.ZodType<DashboardSeriesPoint>;

/** See `DashboardSeries`. The per-chart budget is summed across series. */
export const DashboardSeriesSchema = z
  .object({
    name: boundedString(),
    points: z
      .array(DashboardSeriesPointSchema)
      .max(DASHBOARD_LIMITS.maxSeriesPoints),
  })
  .strict() satisfies z.ZodType<DashboardSeries>;

/** See `DashboardTableColumn`. */
export const DashboardTableColumnSchema = z
  .object({
    key: slug(),
    label: DashboardRichTextSchema,
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict() satisfies z.ZodType<DashboardTableColumn>;

/** See `DashboardTableCell`. Scalars only. */
export const DashboardTableCellSchema = z.union([
  boundedString(),
  z.number(),
  z.boolean(),
  z.null(),
]) satisfies z.ZodType<DashboardTableCell>;

/** See `DashboardListItem`. */
export const DashboardListItemSchema = z
  .object({
    text: DashboardRichTextSchema,
    detail: DashboardRichTextSchema.optional(),
    url: DashboardUrlSchema.optional(),
  })
  .strict() satisfies z.ZodType<DashboardListItem>;

// ---------------------------------------------------------------------------
// The component tree
// ---------------------------------------------------------------------------

/**
 * Ceiling for an array the "Budgets" table does not size — today the actions on
 * one component and the series on one chart.
 *
 * It exists only so that no array in the contract is UNBOUNDED. The byte budget
 * already caps the total, but 256 KB of 25-byte empty series is ten thousand
 * series, and an array with no `max` at a trust boundary is the kind of thing
 * that is obvious in hindsight. Reusing `maxComponents` is a structural bound,
 * not a designed number: nothing should come close to it, and when a render
 * test in TASK_2026_494 produces a real figure for either array it should get
 * its own entry in `DASHBOARD_LIMITS`.
 */
const FINITE_ARRAY_MAX = DASHBOARD_LIMITS.maxComponents;

const componentBaseShape = {
  id: slug(),
  title: DashboardRichTextSchema.optional(),
  description: DashboardRichTextSchema.optional(),
  actions: z.array(DashboardActionSchema).max(FINITE_ARRAY_MAX).optional(),
};

/**
 * `children` is lazy so the five member schemas can reference the union they
 * belong to. The reference resolves on first parse, by which time the module
 * has finished evaluating.
 */
const childrenField = () =>
  z
    .lazy(() =>
      z.array(DashboardComponentSchema).max(DASHBOARD_LIMITS.maxComponents),
    )
    .optional();

/** Exactly one of two data sources must be present. */
function requireOneDataSource(
  ctx: z.RefinementCtx,
  inline: unknown,
  reference: unknown,
  inlineKey: string,
): void {
  const hasInline = inline !== undefined;
  const hasReference = reference !== undefined;
  if (hasInline === hasReference) {
    ctx.addIssue({
      code: 'custom',
      path: [inlineKey],
      message: `provide exactly one of "${inlineKey}" or "data", not ${
        hasInline ? 'both' : 'neither'
      }.`,
    });
  }
}

export const DashboardStatComponentSchema = z
  .object({
    ...componentBaseShape,
    kind: z.literal('stat'),
    value: z.union([boundedString(), z.number()]),
    unit: boundedString().optional(),
    delta: z.number().optional(),
    children: childrenField(),
  })
  .strict() satisfies z.ZodType<DashboardStatComponent>;

const chartShape = {
  ...componentBaseShape,
  xLabel: DashboardRichTextSchema.optional(),
  yLabel: DashboardRichTextSchema.optional(),
  series: z.array(DashboardSeriesSchema).max(FINITE_ARRAY_MAX).optional(),
  data: DashboardDataRefSchema.optional(),
  children: childrenField(),
};

/** Shared chart checks: one data source, and the per-chart point budget. */
function checkChart(
  chart: {
    readonly series?: readonly DashboardSeries[];
    readonly data?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  requireOneDataSource(ctx, chart.series, chart.data, 'series');
  const points = (chart.series ?? []).reduce(
    (total, series) => total + series.points.length,
    0,
  );
  if (points > DASHBOARD_LIMITS.maxSeriesPoints) {
    ctx.addIssue({
      code: 'custom',
      path: ['series'],
      message: `chart carries ${points} points across its series, over the ${DASHBOARD_LIMITS.maxSeriesPoints} limit.`,
    });
  }
}

export const DashboardLineChartComponentSchema = z
  .object({ ...chartShape, kind: z.literal('line-chart') })
  .strict()
  .superRefine(checkChart) satisfies z.ZodType<DashboardLineChartComponent>;

export const DashboardBarChartComponentSchema = z
  .object({ ...chartShape, kind: z.literal('bar-chart') })
  .strict()
  .superRefine(checkChart) satisfies z.ZodType<DashboardBarChartComponent>;

export const DashboardTableComponentSchema = z
  .object({
    ...componentBaseShape,
    kind: z.literal('table'),
    columns: z
      .array(DashboardTableColumnSchema)
      .min(1)
      .max(DASHBOARD_LIMITS.maxTableColumns),
    rows: z
      .array(z.array(DashboardTableCellSchema))
      .max(DASHBOARD_LIMITS.maxTableRows)
      .optional(),
    data: DashboardDataRefSchema.optional(),
    children: childrenField(),
  })
  .strict()
  .superRefine((table, ctx) => {
    requireOneDataSource(ctx, table.rows, table.data, 'rows');
    const width = table.columns.length;
    (table.rows ?? []).forEach((row, index) => {
      if (row.length !== width) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: `row has ${row.length} cells but the table declares ${width} columns.`,
        });
      }
    });
  }) satisfies z.ZodType<DashboardTableComponent>;

export const DashboardListComponentSchema = z
  .object({
    ...componentBaseShape,
    kind: z.literal('list'),
    ordered: z.boolean().optional(),
    items: z
      .array(DashboardListItemSchema)
      .max(DASHBOARD_LIMITS.maxTableRows)
      .optional(),
    data: DashboardDataRefSchema.optional(),
    children: childrenField(),
  })
  .strict()
  .superRefine((list, ctx) => {
    requireOneDataSource(ctx, list.items, list.data, 'items');
  }) satisfies z.ZodType<DashboardListComponent>;

/**
 * The five kinds, and only the five kinds. A discriminated union means an
 * unknown `kind` is reported as an unknown discriminator rather than as five
 * unrelated shape failures — and it is a rejection, never a skipped node.
 *
 * This is the one schema that needs an ANNOTATION rather than `satisfies`.
 * `children` makes it self-referential, and TypeScript reports TS7022
 * ("implicitly has type 'any' because it … is referenced … in its own
 * initializer") for a recursive schema with no annotation. The annotation both
 * breaks the cycle and does the `satisfies` job of binding the schema to the
 * published type.
 */
export const DashboardComponentSchema: z.ZodType<DashboardComponent> =
  z
    .discriminatedUnion('kind', [
      DashboardStatComponentSchema,
      DashboardLineChartComponentSchema,
      DashboardBarChartComponentSchema,
      DashboardTableComponentSchema,
      DashboardListComponentSchema,
    ])
    // The id is load-bearing, not decoration: because this schema is recursive,
    // `z.toJSONSchema` MUST emit it as a named definition plus a `$ref`.
    // Without the id the generated MCP input schema names it `__schema0`, which
    // is what an agent would then see in its tool list.
    .meta({ id: 'DashboardComponent' });

// ---------------------------------------------------------------------------
// Tree measurements — the budgets that a per-node refinement cannot express
// ---------------------------------------------------------------------------

/** Total nodes in the tree, roots included. */
export function countDashboardComponents(
  components: readonly DashboardComponent[],
): number {
  return components.reduce(
    (total, component) =>
      total + 1 + countDashboardComponents(component.children ?? []),
    0,
  );
}

/** Deepest nesting level. A flat row of tiles is 1; an empty spec is 0. */
export function dashboardTreeDepth(
  components: readonly DashboardComponent[],
): number {
  return components.reduce(
    (deepest, component) =>
      Math.max(deepest, 1 + dashboardTreeDepth(component.children ?? [])),
    0,
  );
}

/** Every id in the tree, in document order, duplicates included. */
export function collectDashboardComponentIds(
  components: readonly DashboardComponent[],
): string[] {
  return components.flatMap((component) => [
    component.id,
    ...collectDashboardComponentIds(component.children ?? []),
  ]);
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * See `DashboardSpecEnvelope`.
 *
 * `schemaVersion` and `catalogVersion` are `z.enum` over the SUPPORTED lists,
 * so an unknown version fails at the boundary with a named reason instead of
 * reaching a renderer that would have to guess. The tree-wide checks that no
 * per-node refinement can express — total component count, depth and id
 * uniqueness — are the `superRefine` below.
 */
export const DashboardSpecEnvelopeSchema = z
  .object({
    schemaVersion: z.enum(DASHBOARD_SUPPORTED_SCHEMA_VERSIONS),
    catalogVersion: z.enum(DASHBOARD_SUPPORTED_CATALOG_VERSIONS),
    specId: slug(),
    revision: z.number().int().positive(),
    // `.max()` is not redundant beside the ISO format check (revision 1,
    // finding 4): ISO 8601 permits fractional seconds of ARBITRARY length, so
    // `z.iso.datetime` alone accepted a 2,022-character timestamp — over the
    // one string budget and inside the byte budget — and passed it to the text
    // fallback. Every string in this contract is capped, this one included.
    generatedAt: z.iso.datetime({ offset: true }).max(MAX_STRING),
    title: DashboardRichTextSchema,
    description: DashboardRichTextSchema.optional(),
    components: z
      .array(DashboardComponentSchema)
      .min(1)
      .max(DASHBOARD_LIMITS.maxComponents),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const total = countDashboardComponents(envelope.components);
    if (total > DASHBOARD_LIMITS.maxComponents) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `spec carries ${total} components, over the ${DASHBOARD_LIMITS.maxComponents} limit.`,
      });
    }

    const depth = dashboardTreeDepth(envelope.components);
    if (depth > DASHBOARD_LIMITS.maxTreeDepth) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `component tree is ${depth} levels deep, over the ${DASHBOARD_LIMITS.maxTreeDepth} limit.`,
      });
    }

    const ids = collectDashboardComponentIds(envelope.components);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    if (duplicates.size > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `duplicate component id(s): ${[...duplicates].sort().join(', ')}.`,
      });
    }
  }) satisfies z.ZodType<DashboardSpecEnvelope>;

/** See `DashboardProposeSpecInput`. One key, so a spec is always whole. */
export const DashboardProposeSpecInputSchema = z
  .object({
    spec: DashboardSpecEnvelopeSchema,
  })
  .strict() satisfies z.ZodType<DashboardProposeSpecInput>;
