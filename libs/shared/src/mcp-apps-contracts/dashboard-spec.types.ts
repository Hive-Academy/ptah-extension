/**
 * Declarative dashboard spec — the plain type surface, with no `zod` import.
 *
 * TASK_2026_493_9f58. Split from `dashboard-spec.schemas.ts` for the reason
 * `provider-profile.types.ts` is split from `provider-profile.schemas.ts`, and
 * with the same one-way dependency direction: **schemas → types, never the
 * reverse**. Two things depend on that split, and the second one bites:
 *
 * 1. `payload-map.ts` needs `DashboardSpecEnvelope` to type the
 *    `dashboard:spec-proposed` payload, and it sits in the main
 *    `@ptah-extension/shared` barrel, which must stay `zod`-free (see
 *    `src/schemas.ts`).
 * 2. `tsconfig.base.json` sets `"strict": false`, and four backend libs —
 *    `settings-core`, `memory-contracts`, `voice-contracts` and
 *    `auth-providers-tokens` — never override it. Under
 *    `strictNullChecks: false` every key of a zod object infers as OPTIONAL,
 *    because `undefined` is assignable to every type. A zod-inferred type
 *    reached from the main barrel therefore fails to typecheck in those
 *    projects, and it fails inside `libs/shared`'s own source rather than at
 *    the import site. The settings-core typecheck target caught exactly this.
 *    Plain interfaces are strictness-independent, so the barrel exports these
 *    and the inference stays behind the entry point. TASK_2026_528_5d1e
 *    tracks turning strict on in those four libs, which would retire this
 *    whole constraint.
 *
 * `dashboard-spec.schemas.ts` binds every schema to the type here with
 * `satisfies z.ZodType<…>`. Read the header of that file for the exact scope of
 * that check before relying on it: it is a ONE-WAY assignability check, so it
 * catches a field the schema drops or narrows incompatibly, and it does NOT
 * catch a field the schema adds. An earlier version of this comment claimed a
 * bidirectional guarantee; that was wrong and a reviewer disproved it by
 * compiling the source.
 */

import type {
  DashboardActionId,
  DashboardTextFormat,
} from './dashboard-catalog';

/**
 * Text, and the one interpretation it is allowed (trust-boundary control 3).
 *
 * `format` has exactly one value, `'plain'`, and an absent `format` means the
 * same thing. `'markdown'` was removed in revision 1 because it was a URL
 * channel that bypassed the scheme allowlist — the reproduction and the
 * conditions for ever restoring it are recorded at `DASHBOARD_TEXT_FORMATS`
 * in `dashboard-catalog.ts`.
 *
 * Consequence for a renderer: no text field in this contract may be parsed.
 * Bind `text` as text. A link belongs in a `dashboard.open-url` action, whose
 * `url` is scheme-checked; there is no HTML field anywhere in this contract.
 */
export interface DashboardRichText {
  readonly text: string;
  readonly format?: DashboardTextFormat;
}

/**
 * A URL a spec may carry. Structurally a string; the scheme allowlist is
 * enforced by `DashboardUrlSchema` / `isAllowedDashboardUrl` at the boundary,
 * because no TypeScript type can express it.
 */
export type DashboardUrl = string;

/**
 * An action a component may offer (trust-boundary controls 1 and 5).
 *
 * `action` is an id from the allowlist — never a tool name, never an RPC
 * method, never a command line. The renderer forwards it to the host and the
 * host decides. `params` values are scalars only, so an action payload cannot
 * carry a second, unvalidated document.
 */
export interface DashboardAction {
  readonly action: DashboardActionId;
  readonly label: DashboardRichText;
  /** Required by `dashboard.open-url`, rejected on every other action. */
  readonly url?: DashboardUrl;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * An opaque handle to data the spec does NOT embed.
 *
 * `resultId` is opaque to the renderer; resolving it is a host action
 * (`dashboard.drill-down`), so a spec value cannot become a data fetch.
 */
export interface DashboardDataRef {
  readonly resultId: string;
  /** Total rows behind the reference, when the producer knows it. */
  readonly rowCount?: number;
  /** True when the producer already dropped rows to fit its own budget. */
  readonly truncated?: boolean;
}

/** One point on a line or bar chart. */
export interface DashboardSeriesPoint {
  readonly x: string | number;
  readonly y: number;
}

/** One named series. The per-chart point budget is summed across series. */
export interface DashboardSeries {
  readonly name: string;
  readonly points: readonly DashboardSeriesPoint[];
}

/** A table column header. `key` is for the host; `label` is for the reader. */
export interface DashboardTableColumn {
  readonly key: string;
  readonly label: DashboardRichText;
  readonly align?: 'left' | 'center' | 'right';
}

/** A table cell. Scalars only — a cell never nests another document. */
export type DashboardTableCell = string | number | boolean | null;

/** One list row. */
export interface DashboardListItem {
  readonly text: DashboardRichText;
  readonly detail?: DashboardRichText;
  readonly url?: DashboardUrl;
}

/** Fields every component kind carries. */
interface DashboardComponentBase {
  /** Unique across the whole spec. A duplicate is a rejection. */
  readonly id: string;
  readonly title?: DashboardRichText;
  readonly description?: DashboardRichText;
  readonly actions?: readonly DashboardAction[];
  /** Layout nesting. Depth is capped by `DASHBOARD_LIMITS.maxTreeDepth`. */
  readonly children?: readonly DashboardComponent[];
}

/** A single number or short string with a label. */
export interface DashboardStatComponent extends DashboardComponentBase {
  readonly kind: 'stat';
  readonly value: string | number;
  readonly unit?: string;
  /** Signed change against the previous period, for an up/down affordance. */
  readonly delta?: number;
}

/** Points joined over an ordered x axis. */
export interface DashboardLineChartComponent extends DashboardComponentBase {
  readonly kind: 'line-chart';
  readonly xLabel?: DashboardRichText;
  readonly yLabel?: DashboardRichText;
  /** Exactly one of `series` or `data` is present. */
  readonly series?: readonly DashboardSeries[];
  readonly data?: DashboardDataRef;
}

/** Points as bars over a categorical x axis. */
export interface DashboardBarChartComponent extends DashboardComponentBase {
  readonly kind: 'bar-chart';
  readonly xLabel?: DashboardRichText;
  readonly yLabel?: DashboardRichText;
  /** Exactly one of `series` or `data` is present. */
  readonly series?: readonly DashboardSeries[];
  readonly data?: DashboardDataRef;
}

/** Rows and columns. Every row has exactly one cell per column. */
export interface DashboardTableComponent extends DashboardComponentBase {
  readonly kind: 'table';
  readonly columns: readonly DashboardTableColumn[];
  /** Exactly one of `rows` or `data` is present. */
  readonly rows?: readonly (readonly DashboardTableCell[])[];
  readonly data?: DashboardDataRef;
}

/** An ordered or unordered sequence of short rows. */
export interface DashboardListComponent extends DashboardComponentBase {
  readonly kind: 'list';
  readonly ordered?: boolean;
  /** Exactly one of `items` or `data` is present. */
  readonly items?: readonly DashboardListItem[];
  readonly data?: DashboardDataRef;
}

/** The five component kinds, and only the five. */
export type DashboardComponent =
  | DashboardStatComponent
  | DashboardLineChartComponent
  | DashboardBarChartComponent
  | DashboardTableComponent
  | DashboardListComponent;

/**
 * The versioned spec envelope.
 *
 * `revision` exists for the pinned-refresh work (research report Revision 4,
 * sequence A step 3); this task validates it as a positive integer and does not
 * interpret it. A spec is always whole: there is no partial or incremental
 * form of this type.
 */
export interface DashboardSpecEnvelope {
  readonly schemaVersion: 'dashboard-spec/1';
  readonly catalogVersion: 'dashboard-catalog/1';
  readonly specId: string;
  readonly revision: number;
  /** ISO 8601, with `Z` or an explicit offset. */
  readonly generatedAt: string;
  readonly title: DashboardRichText;
  readonly description?: DashboardRichText;
  readonly components: readonly DashboardComponent[];
}

/**
 * The MCP tool's argument object. ONE key, so the whole envelope stays atomic:
 * there is no second argument a caller could use to patch or stream half a spec
 * into the UI.
 */
export interface DashboardProposeSpecInput {
  readonly spec: DashboardSpecEnvelope;
}
