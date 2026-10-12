/** The platform-neutral, zod-free fixed vocabulary for surface contract v2. */
import {
  DASHBOARD_ACTIONS,
  DASHBOARD_CATALOG_VERSION,
  DASHBOARD_LIMITS,
  DASHBOARD_SCHEMA_VERSION,
} from './dashboard-catalog';

export const SURFACE_SCHEMA_VERSION = 'dashboard-spec/2';
/**
 * The released Apps-profile catalog (TASK_2026_594). `ptah_surface_update`,
 * its tool text and the Apps prompt advertise this version only.
 */
export const SURFACE_CATALOG_VERSION = 'dashboard-catalog/3';
/**
 * The ptah-ui display catalog: `/3` plus the `accordion` layout kind, the
 * `avatar` display kind and the stat `trend` and `spark` fields. It never
 * widens `/3`: a `/3` envelope that uses any of them is rejected.
 */
export const SURFACE_CATALOG_VERSION_4 = 'dashboard-catalog/4';
export const SURFACE_SUPPORTED_SCHEMA_VERSIONS = [
  SURFACE_SCHEMA_VERSION,
] as const;
export const SURFACE_SUPPORTED_CATALOG_VERSIONS = [
  SURFACE_CATALOG_VERSION,
  SURFACE_CATALOG_VERSION_4,
] as const;
/** Every legal `[schemaVersion, catalogVersion]` pair; matched as a whole pair. */
export const DASHBOARD_CONTRACT_VERSION_PAIRS = [
  [DASHBOARD_SCHEMA_VERSION, DASHBOARD_CATALOG_VERSION],
  [SURFACE_SCHEMA_VERSION, SURFACE_CATALOG_VERSION],
  [SURFACE_SCHEMA_VERSION, SURFACE_CATALOG_VERSION_4],
] as const;

/** dashboard-catalog/3 layout vocabulary. */
export const SURFACE_LAYOUT_KINDS = [
  'section',
  'stack',
  'grid',
  'card',
] as const;
export const SURFACE_INPUT_KINDS = [
  'text',
  'select',
  'radio-group',
  'checkbox',
] as const;
/** dashboard-catalog/3 display vocabulary: the five v1 kinds first, then the six status kinds. */
export const SURFACE_DISPLAY_KINDS = [
  'stat',
  'line-chart',
  'bar-chart',
  'table',
  'list',
  'alert',
  'badge',
  'progress',
  'radial-progress',
  'divider',
  'text-block',
] as const;
/** dashboard-catalog/3 component vocabulary (19 kinds). */
export const SURFACE_COMPONENT_KINDS = [
  ...SURFACE_LAYOUT_KINDS,
  ...SURFACE_INPUT_KINDS,
  ...SURFACE_DISPLAY_KINDS,
] as const;
/** dashboard-catalog/4 additions, kept apart so the `/3` lists above never grow. */
export const SURFACE_CATALOG_4_ONLY_LAYOUT_KINDS = ['accordion'] as const;
export const SURFACE_CATALOG_4_ONLY_DISPLAY_KINDS = ['avatar'] as const;
export const SURFACE_CATALOG_4_ONLY_STAT_FIELDS = ['trend', 'spark'] as const;
/** dashboard-catalog/4 vocabularies: the `/3` lists plus the additions above. */
export const SURFACE_CATALOG_4_LAYOUT_KINDS = [
  ...SURFACE_LAYOUT_KINDS,
  ...SURFACE_CATALOG_4_ONLY_LAYOUT_KINDS,
] as const;
export const SURFACE_CATALOG_4_DISPLAY_KINDS = [
  ...SURFACE_DISPLAY_KINDS,
  ...SURFACE_CATALOG_4_ONLY_DISPLAY_KINDS,
] as const;
export const SURFACE_CATALOG_4_COMPONENT_KINDS = [
  ...SURFACE_CATALOG_4_LAYOUT_KINDS,
  ...SURFACE_INPUT_KINDS,
  ...SURFACE_CATALOG_4_DISPLAY_KINDS,
] as const;
/** Closed stat trend enums (`/4`). Direction is conveyed by text, never colour alone. */
export const SURFACE_TREND_DIRECTIONS = ['up', 'down'] as const;
export const SURFACE_TREND_POLARITIES = ['good', 'bad'] as const;
/** A sparkline needs two points to draw a line; the ceiling is `maxSeriesPoints`. */
export const SURFACE_SPARK_MIN_POINTS = 2;
export const SURFACE_ACTIONS = [
  ...DASHBOARD_ACTIONS,
  'surface.submit',
] as const;
export const SURFACE_HOST_SUPPORTED_ACTIONS = [
  'surface.submit',
  'dashboard.select',
] as const;
export const SURFACE_STACK_DIRECTIONS = ['vertical', 'horizontal'] as const;
export const SURFACE_GAPS = ['none', 'small', 'medium', 'large'] as const;

export type SurfaceCatalogVersion =
  (typeof SURFACE_SUPPORTED_CATALOG_VERSIONS)[number];
/** Kind types span every supported catalog (`/4` is a superset of `/3`). */
export type SurfaceLayoutKind = (typeof SURFACE_CATALOG_4_LAYOUT_KINDS)[number];
export type SurfaceInputKind = (typeof SURFACE_INPUT_KINDS)[number];
export type SurfaceDisplayKind =
  (typeof SURFACE_CATALOG_4_DISPLAY_KINDS)[number];
export type SurfaceComponentKind =
  (typeof SURFACE_CATALOG_4_COMPONENT_KINDS)[number];
export type SurfaceTrendDirection = (typeof SURFACE_TREND_DIRECTIONS)[number];
export type SurfaceTrendPolarity = (typeof SURFACE_TREND_POLARITIES)[number];
export type SurfaceActionId = (typeof SURFACE_ACTIONS)[number];
export type SurfaceStackDirection = (typeof SURFACE_STACK_DIRECTIONS)[number];
export type SurfaceGap = (typeof SURFACE_GAPS)[number];

/** Missing bindings read these values. A required checkbox must be checked. */
export const SURFACE_INPUT_EMPTY_VALUES = {
  text: '',
  select: null,
  'radio-group': null,
  checkbox: false,
} as const;
export const SURFACE_PATH_DENYLIST = [
  '__proto__',
  'prototype',
  'constructor',
] as const;
export const SURFACE_PATH_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const SURFACE_PATH_SEPARATOR = '.';
export const SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SURFACE_V1_ID_PREFIX = 'v1:';
export const SURFACE_OPERATION_ID_PATTERN = /^op-[0-9]{13}-[A-Za-z0-9]{8,40}$/;

/**
 * Budgets.
 *
 * `maxComponents`, `maxTreeDepth`, `maxStringLength`, `maxTableRows`,
 * `maxTableColumns` and `maxSeriesPoints` are the same numbers as
 * `DASHBOARD_LIMITS` and are CONFIRMED there (see that doc comment).
 * `maxInputs`, `maxOptions` (on both `select` and `radio-group`),
 * `maxChildrenPerNode`, `maxGridColumns`, `maxDataModelBytes` and
 * `maxSurfaceBytes` are CONFIRMED by TASK_2026_494: each renders through the
 * real `SurfaceRendererComponent` with no `renderFailed`, at exactly this
 * value, in
 * `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`
 * (`budget-render-report.md`, TASK_2026_494_ca38). The measured jsdom render
 * times are a RELATIVE signal only (that report's A4 caveat); none was slow
 * enough to justify lowering a value. Every other budget below —
 * `maxActionsPerComponent`, the id/path-grammar limits, the data-model shape
 * limits, `maxUpdateRequestBytes`, `maxPatchOps`, `maxRpcRequestBytes`,
 * `maxSubmitMessageBytes`, `maxStateReadBytes` and the write-log limits —
 * stays PROVISIONAL: it is pinned at the validator boundary
 * (`surface-budgets.spec.ts`, `surface-concurrency.spec.ts`) but is not a
 * `budget-render.spec.ts` case, so this task does not confirm it against the
 * renderer. Consumers read budgets here so confirming or changing a number is
 * a one-line change in one file.
 */
export const SURFACE_LIMITS = {
  maxComponents: DASHBOARD_LIMITS.maxComponents,
  maxTreeDepth: DASHBOARD_LIMITS.maxTreeDepth,
  maxStringLength: DASHBOARD_LIMITS.maxStringLength,
  maxTableRows: DASHBOARD_LIMITS.maxTableRows,
  maxTableColumns: DASHBOARD_LIMITS.maxTableColumns,
  maxSeriesPoints: DASHBOARD_LIMITS.maxSeriesPoints,
  maxChildrenPerNode: 50,
  maxGridColumns: 4,
  maxActionsPerComponent: 8,
  maxInputs: 100,
  maxOptions: 50,
  maxOptionValueLength: 200,
  maxSurfaceIdLength: 128,
  maxComponentIdLength: 128,
  maxPathSegments: 8,
  maxPathSegmentLength: 64,
  maxDataModelDepth: 6,
  maxDataModelArrayLength: 200,
  maxDataModelObjectKeys: 100,
  maxDataModelBytes: 64 * 1024,
  maxSurfaceBytes: 256 * 1024,
  maxUpdateRequestBytes: 300 * 1024,
  maxPatchOps: 100,
  maxRpcRequestBytes: 16 * 1024,
  maxSubmitMessageBytes: 32 * 1024,
  /**
   * The escaped worst case of a complete agent read (U+2028/U+2029 become six
   * bytes each), per implementation-plan.md "Batch 9 read-budget decision".
   * State view: T1 metadata 4 KiB + T2 data model 128 KiB + T3a form values
   * 128 KiB + T3b form keys, ids and issues 100 KiB + T4 selection 140 KiB +
   * T5 last submit 48 KiB = 548 KiB. Structure view: 2 x maxSurfaceBytes +
   * 4 KiB = 516 KiB, within the same bound.
   */
  maxStateReadBytes: 548 * 1024,
  maxWriteLogEntries: 32,
  maxWriteLogPathsPerEntry: 16,
} as const;

/**
 * Store budgets — PROVISIONAL. Not a `budget-render.spec.ts` case (there is
 * no store in a render test); TASK_2026_494 leaves these as they were.
 */
export const SURFACE_STORE_LIMITS = {
  maxRoutingIds: 32,
  maxSurfacesPerRoutingId: 8,
  maxStoreBytes: 24 * 1024 * 1024,
  maxOperationRecordsPerRoutingId: 128,
  operationRecordBytes: 1024,
  operationRetentionMs: 600_000,
  maxPendingOperationsPerRoutingId: 4,
  maxOperationClockSkewMs: 300_000,
  maxLedgerRoutingIds: 64,
} as const;
