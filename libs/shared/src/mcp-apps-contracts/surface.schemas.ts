/** Strict JSON boundary for surface v2; the main type surface stays zod-free. */
import { z } from 'zod';
import { DASHBOARD_LIMITS } from './dashboard-catalog';
import {
  checkChart,
  requireOneDataSource,
  DashboardDataRefSchema,
  DashboardListItemSchema,
  DashboardRichTextSchema,
  DashboardSeriesSchema,
  DashboardTableCellSchema,
  DashboardTableColumnSchema,
  DashboardUrlSchema,
} from './dashboard-spec.schemas';
import {
  SURFACE_ACTIONS,
  SURFACE_CATALOG_VERSION,
  SURFACE_GAPS,
  SURFACE_ID_PATTERN,
  SURFACE_LIMITS,
  SURFACE_OPERATION_ID_PATTERN,
  SURFACE_PATH_DENYLIST,
  SURFACE_PATH_SEGMENT_PATTERN,
  SURFACE_PATH_SEPARATOR,
  SURFACE_SCHEMA_VERSION,
  SURFACE_STACK_DIRECTIONS,
  SURFACE_V1_ID_PREFIX,
} from './surface-catalog';
import type {
  SurfaceAction,
  SurfaceBarChartComponent,
  SurfaceCardComponent,
  SurfaceCheckboxInput,
  SurfaceComponent,
  SurfaceDataModel,
  SurfaceDataValue,
  SurfaceEnvelope,
  SurfaceGetStateInput,
  SurfaceGridComponent,
  SurfaceInputOption,
  SurfaceLineChartComponent,
  SurfaceListComponent,
  SurfacePatchOp,
  SurfaceRadioGroupInput,
  SurfaceRequiredHints,
  SurfaceSectionComponent,
  SurfaceSelectInput,
  SurfaceSelection,
  SurfaceSelectionTarget,
  SurfaceStackComponent,
  SurfaceStatComponent,
  SurfaceTableComponent,
  SurfaceTextHints,
  SurfaceTextInput,
  SurfaceUpdateInput,
} from './surface.types';

const boundedString = () => z.string().max(SURFACE_LIMITS.maxStringLength);
const componentId = () =>
  z
    .string()
    .min(1)
    .max(SURFACE_LIMITS.maxComponentIdLength)
    .regex(SURFACE_ID_PATTERN);
const revision = () => z.number().int().positive();

export const SurfaceIdSchema = z
  .string()
  .min(1)
  .max(SURFACE_LIMITS.maxSurfaceIdLength)
  .superRefine((id, ctx) => {
    if (id.startsWith(SURFACE_V1_ID_PREFIX)) {
      ctx.addIssue({
        code: 'custom',
        message: 'v1 surfaces are managed by ptah_dashboard_propose_spec.',
      });
    } else if (!SURFACE_ID_PATTERN.test(id)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Surface id must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/ (no colon).',
      });
    }
  }) satisfies z.ZodType<string>;

/** v1 slugs retain their original length and colon allowance. Only reads use this. */
export const SurfaceAnyIdSchema = z.union([
  SurfaceIdSchema,
  z
    .string()
    .max(DASHBOARD_LIMITS.maxStringLength + SURFACE_V1_ID_PREFIX.length)
    .regex(/^v1:[A-Za-z0-9][A-Za-z0-9._:-]*$/),
]) satisfies z.ZodType<string>;
export const SurfaceOperationIdSchema = z
  .string()
  .regex(SURFACE_OPERATION_ID_PATTERN) satisfies z.ZodType<string>;

const SurfacePathSegmentSchema = z
  .string()
  .min(1)
  .max(SURFACE_LIMITS.maxPathSegmentLength)
  .regex(SURFACE_PATH_SEGMENT_PATTERN)
  .refine(
    (segment) => !SURFACE_PATH_DENYLIST.some((denied) => segment === denied),
    {
      message: 'Denied surface path segment.',
    },
  ) satisfies z.ZodType<string>;
export const SurfacePathSchema = z
  .string()
  .min(1)
  .max(
    SURFACE_LIMITS.maxPathSegments * (SURFACE_LIMITS.maxPathSegmentLength + 1) -
      1,
  )
  .superRefine((path, ctx) => {
    const segments = path.split(SURFACE_PATH_SEPARATOR);
    if (segments.length > SURFACE_LIMITS.maxPathSegments) {
      ctx.addIssue({
        code: 'custom',
        message: `Path exceeds maxPathSegments ${SURFACE_LIMITS.maxPathSegments}.`,
      });
    }
    for (const segment of segments) {
      if (!SurfacePathSegmentSchema.safeParse(segment).success) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid or denied path segment "${segment}" (maxPathSegmentLength ${SURFACE_LIMITS.maxPathSegmentLength}).`,
        });
      }
    }
  }) satisfies z.ZodType<string>;

export const SurfaceActionSchema = z
  .object({
    id: componentId(),
    action: z.enum(SURFACE_ACTIONS),
    label: DashboardRichTextSchema,
    url: DashboardUrlSchema.optional(),
    params: z
      .preprocess(
        checkRawObjectKeys,
        z.record(
          SurfacePathSegmentSchema,
          z.union([boundedString(), z.number(), z.boolean()]),
        ),
      )
      .refine(
        (params) =>
          Object.keys(params).length <= SURFACE_LIMITS.maxDataModelObjectKeys,
        {
          message: `Action params exceed maxDataModelObjectKeys ${SURFACE_LIMITS.maxDataModelObjectKeys}.`,
        },
      )
      .optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (action.action === 'dashboard.open-url' && action.url === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'dashboard.open-url requires a url.',
      });
    }
    if (action.action !== 'dashboard.open-url' && action.url !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'url is only allowed on dashboard.open-url.',
      });
    }
    if (action.action === 'surface.submit' && action.params !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['params'],
        message: 'surface.submit does not accept params.',
      });
    }
  }) satisfies z.ZodType<SurfaceAction>;

const actions = () =>
  z
    .array(SurfaceActionSchema)
    .max(SURFACE_LIMITS.maxActionsPerComponent)
    .optional();
const children = () =>
  z.lazy(() =>
    z.array(SurfaceComponentSchema).max(SURFACE_LIMITS.maxChildrenPerNode),
  );
const layoutShape = {
  id: componentId(),
  children: children(),
  actions: actions(),
};

export const SurfaceSectionComponentSchema = z
  .object({
    ...layoutShape,
    kind: z.literal('section'),
    title: DashboardRichTextSchema,
    description: DashboardRichTextSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceSectionComponent>;
export const SurfaceStackComponentSchema = z
  .object({
    ...layoutShape,
    kind: z.literal('stack'),
    direction: z.enum(SURFACE_STACK_DIRECTIONS).optional(),
    gap: z.enum(SURFACE_GAPS).optional(),
  })
  .strict() satisfies z.ZodType<SurfaceStackComponent>;
export const SurfaceGridComponentSchema = z
  .object({
    ...layoutShape,
    kind: z.literal('grid'),
    columns: z.number().int().min(1).max(SURFACE_LIMITS.maxGridColumns),
    gap: z.enum(SURFACE_GAPS).optional(),
  })
  .strict() satisfies z.ZodType<SurfaceGridComponent>;
export const SurfaceCardComponentSchema = z
  .object({
    ...layoutShape,
    kind: z.literal('card'),
    title: DashboardRichTextSchema.optional(),
    description: DashboardRichTextSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceCardComponent>;

export const SurfaceRequiredHintsSchema = z
  .object({ required: z.boolean().optional() })
  .strict() satisfies z.ZodType<SurfaceRequiredHints>;
export const SurfaceTextHintsSchema = z
  .object({
    required: z.boolean().optional(),
    minLength: z
      .number()
      .int()
      .nonnegative()
      .max(SURFACE_LIMITS.maxStringLength)
      .optional(),
    maxLength: z
      .number()
      .int()
      .nonnegative()
      .max(SURFACE_LIMITS.maxStringLength)
      .optional(),
  })
  .strict()
  .superRefine((hints, ctx) => {
    if (
      hints.minLength !== undefined &&
      hints.maxLength !== undefined &&
      hints.minLength > hints.maxLength
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minLength'],
        message: 'minLength must not exceed maxLength.',
      });
    }
  }) satisfies z.ZodType<SurfaceTextHints>;
export const SurfaceInputOptionSchema = z
  .object({
    value: z.string().min(1).max(SURFACE_LIMITS.maxOptionValueLength),
    label: boundedString(),
  })
  .strict() satisfies z.ZodType<SurfaceInputOption>;
const options = () =>
  z
    .array(SurfaceInputOptionSchema)
    .min(1)
    .max(SURFACE_LIMITS.maxOptions)
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      values.forEach((option, index) => {
        if (seen.has(option.value))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'value'],
            message: `Duplicate option value "${option.value}".`,
          });
        seen.add(option.value);
      });
    });
const inputShape = {
  id: componentId(),
  label: boundedString(),
  path: SurfacePathSchema,
};
export const SurfaceTextInputSchema = z
  .object({
    ...inputShape,
    kind: z.literal('text'),
    description: DashboardRichTextSchema.optional(),
    placeholder: boundedString().optional(),
    multiline: z.boolean().optional(),
    hints: SurfaceTextHintsSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceTextInput>;
export const SurfaceSelectInputSchema = z
  .object({
    ...inputShape,
    kind: z.literal('select'),
    options: options(),
    hints: SurfaceRequiredHintsSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceSelectInput>;
export const SurfaceRadioGroupInputSchema = z
  .object({
    ...inputShape,
    kind: z.literal('radio-group'),
    options: options(),
    hints: SurfaceRequiredHintsSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceRadioGroupInput>;
export const SurfaceCheckboxInputSchema = z
  .object({
    ...inputShape,
    kind: z.literal('checkbox'),
    hints: SurfaceRequiredHintsSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceCheckboxInput>;

const displayShape = {
  id: componentId(),
  title: DashboardRichTextSchema.optional(),
  description: DashboardRichTextSchema.optional(),
  actions: actions(),
};
export const SurfaceStatComponentSchema = z
  .object({
    ...displayShape,
    kind: z.literal('stat'),
    value: z.union([boundedString(), z.number()]),
    unit: boundedString().optional(),
    delta: z.number().optional(),
  })
  .strict() satisfies z.ZodType<SurfaceStatComponent>;
const chartShape = {
  ...displayShape,
  xLabel: DashboardRichTextSchema.optional(),
  yLabel: DashboardRichTextSchema.optional(),
  series: z
    .array(DashboardSeriesSchema)
    .max(SURFACE_LIMITS.maxComponents)
    .optional(),
  data: DashboardDataRefSchema.optional(),
};
export const SurfaceLineChartComponentSchema = z
  .object({ ...chartShape, kind: z.literal('line-chart') })
  .strict()
  .superRefine(checkChart) satisfies z.ZodType<SurfaceLineChartComponent>;
export const SurfaceBarChartComponentSchema = z
  .object({ ...chartShape, kind: z.literal('bar-chart') })
  .strict()
  .superRefine(checkChart) satisfies z.ZodType<SurfaceBarChartComponent>;
export const SurfaceTableComponentSchema = z
  .object({
    ...displayShape,
    kind: z.literal('table'),
    columns: z
      .array(DashboardTableColumnSchema)
      .min(1)
      .max(SURFACE_LIMITS.maxTableColumns),
    rows: z
      .array(
        z.array(DashboardTableCellSchema).max(SURFACE_LIMITS.maxTableColumns),
      )
      .max(SURFACE_LIMITS.maxTableRows)
      .optional(),
    data: DashboardDataRefSchema.optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
    requireOneDataSource(ctx, table.rows, table.data, 'rows');
    (table.rows ?? []).forEach((row, index) => {
      if (row.length !== table.columns.length)
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: `Row has ${row.length} cells but the table declares ${table.columns.length} columns.`,
        });
    });
  }) satisfies z.ZodType<SurfaceTableComponent>;
export const SurfaceListComponentSchema = z
  .object({
    ...displayShape,
    kind: z.literal('list'),
    ordered: z.boolean().optional(),
    items: z
      .array(DashboardListItemSchema)
      .max(SURFACE_LIMITS.maxTableRows)
      .optional(),
    data: DashboardDataRefSchema.optional(),
  })
  .strict()
  .superRefine((list, ctx) =>
    requireOneDataSource(ctx, list.items, list.data, 'items'),
  ) satisfies z.ZodType<SurfaceListComponent>;

/** Explicit annotation breaks the recursive children/type inference cycle. */
export const SurfaceComponentSchema: z.ZodType<SurfaceComponent> = z
  .discriminatedUnion('kind', [
    SurfaceSectionComponentSchema,
    SurfaceStackComponentSchema,
    SurfaceGridComponentSchema,
    SurfaceCardComponentSchema,
    SurfaceTextInputSchema,
    SurfaceSelectInputSchema,
    SurfaceRadioGroupInputSchema,
    SurfaceCheckboxInputSchema,
    SurfaceStatComponentSchema,
    SurfaceLineChartComponentSchema,
    SurfaceBarChartComponentSchema,
    SurfaceTableComponentSchema,
    SurfaceListComponentSchema,
  ])
  .meta({ id: 'SurfaceComponent' }) satisfies z.ZodType<SurfaceComponent>;

/**
 * Recursive JSON with a finite expansion: stop BEFORE parsing a seventh
 * container. This also rejects cycles without overflowing the call stack.
 * A standalone root container is depth 1; the model root counts as one too.
 */
function dataValueAtDepth(depth: number): z.ZodType<SurfaceDataValue> {
  const scalar = z.union([
    boundedString(),
    z.number(),
    z.boolean(),
    z.null(),
  ]) satisfies z.ZodType<SurfaceDataValue>;
  if (depth >= SURFACE_LIMITS.maxDataModelDepth) return scalar;
  const child: z.ZodType<SurfaceDataValue> = z.lazy(() =>
    dataValueAtDepth(depth + 1),
  );
  return z.union([
    scalar,
    z.array(child).max(SURFACE_LIMITS.maxDataModelArrayLength),
    dataObject(child),
  ]) satisfies z.ZodType<SurfaceDataValue>;
}
/**
 * Zod records skip __proto__ during parsing. Reject it on the original object,
 * before the record parser can silently remove it. The record/key schemas
 * still describe the shape when tools generate their JSON schemas.
 */
function checkRawObjectKeys(value: unknown, ctx: z.RefinementCtx): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (SURFACE_PATH_DENYLIST.some((denied) => key === denied)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Denied object key "${key}".`,
        });
      }
    }
  }
  return value;
}

function dataObject(child: z.ZodType<SurfaceDataValue>) {
  return z
    .preprocess(checkRawObjectKeys, z.record(SurfacePathSegmentSchema, child))
    .refine(
      (value) =>
        Object.keys(value).length <= SURFACE_LIMITS.maxDataModelObjectKeys,
      {
        message: `Data exceeds maxDataModelObjectKeys ${SURFACE_LIMITS.maxDataModelObjectKeys}.`,
      },
    ) satisfies z.ZodType<SurfaceDataModel>;
}
export const SurfaceDataValueSchema: z.ZodType<SurfaceDataValue> =
  dataValueAtDepth(0).meta({
    id: 'SurfaceDataValue',
  }) satisfies z.ZodType<SurfaceDataValue>;
export const SurfaceDataModelSchema = dataObject(
  dataValueAtDepth(1),
) satisfies z.ZodType<SurfaceDataModel>;

export const SurfaceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(SURFACE_SCHEMA_VERSION),
    catalogVersion: z.literal(SURFACE_CATALOG_VERSION),
    surfaceId: SurfaceIdSchema,
    title: DashboardRichTextSchema,
    description: DashboardRichTextSchema.optional(),
    components: z
      .array(SurfaceComponentSchema)
      .min(1)
      .max(SURFACE_LIMITS.maxComponents),
    dataModel: SurfaceDataModelSchema.optional(),
  })
  .strict() satisfies z.ZodType<SurfaceEnvelope>;

export const SurfacePatchOpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('set-data'),
      path: SurfacePathSchema,
      value: SurfaceDataValueSchema,
    })
    .strict(),
  z.object({ op: z.literal('remove-data'), path: SurfacePathSchema }).strict(),
  z
    .object({
      op: z.literal('add-component'),
      parentId: componentId().nullable(),
      index: z
        .number()
        .int()
        .nonnegative()
        .max(SURFACE_LIMITS.maxComponents)
        .optional(),
      component: SurfaceComponentSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('replace-component'),
      component: SurfaceComponentSchema,
    })
    .strict(),
  z
    .object({ op: z.literal('remove-component'), componentId: componentId() })
    .strict(),
  z
    .object({
      op: z.literal('set-title'),
      title: DashboardRichTextSchema,
      description: DashboardRichTextSchema.optional(),
    })
    .strict(),
]) satisfies z.ZodType<SurfacePatchOp>;
export const SurfaceUpdateInputSchema = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('create'), surface: SurfaceEnvelopeSchema })
    .strict(),
  z
    .object({
      operation: z.literal('replace'),
      baseRevision: revision(),
      surface: SurfaceEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('patch'),
      surfaceId: SurfaceIdSchema,
      baseRevision: revision(),
      ops: z.array(SurfacePatchOpSchema).min(1).max(SURFACE_LIMITS.maxPatchOps),
    })
    .strict(),
  z
    .object({
      operation: z.literal('delete'),
      surfaceId: SurfaceIdSchema,
      baseRevision: revision(),
    })
    .strict(),
]) satisfies z.ZodType<SurfaceUpdateInput>;
export const SurfaceGetStateInputSchema = z
  .object({
    surfaceId: SurfaceAnyIdSchema.optional(),
    view: z.enum(['state', 'structure']).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.view === 'structure' && input.surfaceId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['surfaceId'],
        message: 'Structure view requires surfaceId.',
      });
    }
  }) satisfies z.ZodType<SurfaceGetStateInput>;
export const SurfaceSelectionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stat') }).strict(),
  z
    .object({
      kind: z.literal('table-row'),
      rowIndex: z
        .number()
        .int()
        .nonnegative()
        .max(SURFACE_LIMITS.maxTableRows - 1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('list-item'),
      itemIndex: z
        .number()
        .int()
        .nonnegative()
        .max(SURFACE_LIMITS.maxTableRows - 1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('chart-point'),
      seriesIndex: z
        .number()
        .int()
        .nonnegative()
        .max(SURFACE_LIMITS.maxComponents - 1),
      pointIndex: z
        .number()
        .int()
        .nonnegative()
        .max(SURFACE_LIMITS.maxSeriesPoints - 1),
    })
    .strict(),
]) satisfies z.ZodType<SurfaceSelectionTarget>;
export const SurfaceSelectionSchema = z
  .object({ componentId: componentId(), target: SurfaceSelectionTargetSchema })
  .strict() satisfies z.ZodType<SurfaceSelection>;
