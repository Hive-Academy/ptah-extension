/**
 * `@ptah-extension/shared/mcp-apps-contracts` — the MCP-apps wire contracts.
 *
 * TASK_2026_493_9f58 opens this entry point with the declarative dashboard
 * contract: the versioned envelope, the five-kind component tree, the data
 * reference, the boundary validator and the mandatory plain-text fallback.
 * Later tasks in the same lane (app descriptors, view messages, stored
 * manifests — `critique-engineering.md` section 3) add to it here.
 *
 * It is a SECONDARY ENTRY POINT of `libs/shared`, not a separate Nx project;
 * the reasoning is in the task's `implementation-note.md` under Decisions. Like
 * `@ptah-extension/shared/schemas`, it is zod-bearing, so the main
 * `@ptah-extension/shared` barrel stays zod-free — import the plain types from
 * the main barrel and reach here for the schema values you parse with.
 *
 * No Electron import, no Angular import, no platform adapter. `scope:shared`,
 * `type:util` (inherited from `libs/shared/project.json`).
 *
 * ONE CONSTRAINT on importing this entry point: the importing project's
 * tsconfig must set `"strict": true`. `tsconfig.base.json` sets it to `false`,
 * and zod's optional-key inference is strictness-dependent — under
 * `strictNullChecks: false` every key of a zod object infers as optional and
 * `satisfies z.ZodType<…>` in `dashboard-spec.schemas.ts` fails. Need only the
 * SHAPE in a non-strict project? Import the plain types from
 * `@ptah-extension/shared`; they carry no zod and no such constraint.
 */

export {
  DASHBOARD_ACTIONS,
  DASHBOARD_CATALOG_VERSION,
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_LIMITS,
  DASHBOARD_SCHEMA_VERSION,
  DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
  DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS,
  DASHBOARD_TEXT_FORMATS,
  DASHBOARD_URL_SCHEME_ALLOWLIST,
  isAllowedDashboardUrl,
} from './dashboard-catalog';
export type {
  DashboardActionId,
  DashboardComponentKind,
  DashboardTextFormat,
} from './dashboard-catalog';

/**
 * The plain types are re-exported here for convenience, but they are ALSO
 * exported from the main `@ptah-extension/shared` barrel (see
 * `libs/shared/src/index.ts`), exactly as `provider-profile.types.ts` is.
 * A consumer that only needs the shape should import from there and keep zod
 * out of its graph; reach this entry point for the schema VALUES you parse with.
 */
export type {
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

export {
  DashboardActionSchema,
  DashboardBarChartComponentSchema,
  DashboardComponentSchema,
  DashboardDataRefSchema,
  DashboardLineChartComponentSchema,
  DashboardListComponentSchema,
  DashboardListItemSchema,
  DashboardProposeSpecInputSchema,
  DashboardRichTextSchema,
  DashboardSeriesPointSchema,
  DashboardSeriesSchema,
  DashboardSpecEnvelopeSchema,
  DashboardStatComponentSchema,
  DashboardTableCellSchema,
  DashboardTableColumnSchema,
  DashboardTableComponentSchema,
  DashboardUrlSchema,
  collectDashboardComponentIds,
  countDashboardComponents,
  dashboardTreeDepth,
} from './dashboard-spec.schemas';

export {
  formatDashboardSpecIssues,
  validateDashboardSpec,
} from './dashboard-spec.validator';
export type {
  DashboardJsonByteCounter,
  DashboardSpecAccepted,
  DashboardSpecRejected,
  DashboardSpecValidation,
} from './dashboard-spec.validator';

export {
  describeDashboardLimits,
  renderDashboardSpecText,
} from './dashboard-text-fallback';
