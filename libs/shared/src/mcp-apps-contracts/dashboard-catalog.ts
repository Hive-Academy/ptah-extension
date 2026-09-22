/**
 * Declarative dashboard catalog — versions, allowlists and budgets.
 *
 * TASK_2026_493_9f58. This module is the fixed half of the contract: the two
 * version strings a host will accept, the five component kinds it can render,
 * the action ids a spec may name, the URL schemes a spec may carry, and the
 * numeric budgets every spec is measured against. Nothing here depends on zod,
 * on a platform or on a renderer, so the MCP tool boundary (backend) and the
 * webview RPC boundary (TASK_2026_494) read the SAME numbers.
 *
 * Why a fixed catalog is not a safety property on its own: research report
 * `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 6, entry 1.
 * Limiting the component TYPES does nothing about the VALUES, which are
 * agent-controlled and therefore untrusted. The five controls that do the work
 * are the action allowlist (`DASHBOARD_ACTIONS`), zod validation of every value
 * (`dashboard-spec.schemas.ts`), output escaping (`DASHBOARD_TEXT_FORMATS` —
 * plain text only, and read the comment there before changing it), the URL
 * scheme allowlist (`isAllowedDashboardUrl`) and host mediation of every action
 * (the action shape carries an ID, never a tool name or an RPC method).
 */

/**
 * The only spec envelope version this catalog understands.
 *
 * An envelope carrying any other value is REJECTED, never best-effort
 * rendered — that is the "fail closed" half of deliverable 3. When a second
 * version exists, add it to `DASHBOARD_SUPPORTED_SCHEMA_VERSIONS` only once a
 * host can actually render it.
 */
export const DASHBOARD_SCHEMA_VERSION = 'dashboard-spec/1';

/** Every envelope version a host accepts. Unknown version ⇒ rejection. */
export const DASHBOARD_SUPPORTED_SCHEMA_VERSIONS = [
  DASHBOARD_SCHEMA_VERSION,
] as const;

/**
 * The component-catalog version. Separate from `schemaVersion` on purpose: the
 * envelope shape and the component vocabulary version independently, so adding
 * a sixth component kind does not invalidate stored envelopes.
 */
export const DASHBOARD_CATALOG_VERSION = 'dashboard-catalog/1';

/** Every catalog version a host accepts. Unknown version ⇒ rejection. */
export const DASHBOARD_SUPPORTED_CATALOG_VERSIONS = [
  DASHBOARD_CATALOG_VERSION,
] as const;

/**
 * The five component kinds, and the complete list of them.
 *
 * An unknown kind is a rejection of the WHOLE spec (atomic specs, deliverable
 * 3) — a host never drops the offending node and renders the rest, because a
 * dashboard missing one tile reads as a dashboard, not as an error.
 */
export const DASHBOARD_COMPONENT_KINDS = [
  'stat',
  'line-chart',
  'bar-chart',
  'table',
  'list',
] as const;

export type DashboardComponentKind = (typeof DASHBOARD_COMPONENT_KINDS)[number];

/**
 * Control 1 of the trust boundary — the action allowlist.
 *
 * A spec may name ONLY these. The renderer does not resolve an action to a
 * tool or an RPC method; it forwards the id to the host, which owns the
 * mapping and the permission decision (control 5, host mediation). That is why
 * the list is small, why every entry is namespaced under `dashboard.`, and why
 * nothing here is a verb the host does not already implement.
 */
export const DASHBOARD_ACTIONS = [
  /** Re-run the tool call that produced this spec. */
  'dashboard.refresh',
  /** Persist the spec to the pinned-app grid. */
  'dashboard.pin',
  /** Hand the spec's data to the host's export path. */
  'dashboard.export',
  /** Copy a component's value to the clipboard. */
  'dashboard.copy',
  /** Open `DashboardAction.url` through the host's external-link path. */
  'dashboard.open-url',
  /** Tell the host which row/point/tile the user selected. */
  'dashboard.select',
  /** Ask the host to expand a referenced dataset (see `DashboardDataRef`). */
  'dashboard.drill-down',
] as const;

export type DashboardActionId = (typeof DASHBOARD_ACTIONS)[number];

/**
 * Control 4 of the trust boundary — the URL scheme allowlist.
 *
 * `https:` only. `javascript:`, `data:` and `file:` are the named rejections in
 * `context.md`; plain `http:` is rejected too, because a spec is authored by a
 * model and there is no reason for it to name a cleartext endpoint.
 */
export const DASHBOARD_URL_SCHEME_ALLOWLIST = ['https:'] as const;

/**
 * Control 3 of the trust boundary — output escaping. PLAIN TEXT ONLY.
 *
 * `'markdown'` was here and was REMOVED in revision 1 after a review proved it
 * was a second URL channel that bypassed `DASHBOARD_URL_SCHEME_ALLOWLIST`
 * entirely. The reproduction: a spec whose `title` is
 * `{ format: 'markdown', text: '![x](data:image/png;base64,AAAA)' }` passed
 * `validateDashboardSpec`, because the URL refinement only ever looks at the
 * explicit `url` fields. Running it through the prescribed chokepoint —
 * `marked` plus the real full-preset sanitizer — yielded a live
 * `<img src="data:image/png;base64,AAAA">`, because that sanitizer is a
 * DENY-list whose `ALLOWED_URI_REGEXP` explicitly permits `http:` and `data:`
 * (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:72`). The same
 * payload worked through a list item's text. `context.md:44` says `data:` is a
 * rejection, so the contract was contradicting itself.
 *
 * The fix is to narrow the contract rather than to inspect the content. A
 * markdown URL extractor in `libs/shared` would be a SECOND markdown parser,
 * and it and `marked` would eventually disagree — parser-differential bugs are
 * how this hole reopens. Narrowing rejects strictly more than before, so it
 * cannot break a valid spec, and a real link already has a home: the
 * `dashboard.open-url` action, whose `url` goes through the allowlist.
 *
 * BEFORE PUTTING `'markdown'` BACK, two things must exist: a URL policy the
 * markdown chokepoint can actually enforce (its current preset cannot express
 * "https only"), and a new `catalogVersion` — which is precisely what
 * `catalogVersion` is for. Adding a value here without both re-opens the
 * bypass, and `dashboard-trust-boundary.spec.ts` control 3 will fail if you do.
 *
 * With markdown gone, the contract carries no HTML-bearing field and no field
 * a renderer is licensed to parse, so there is nothing to bind to `innerHTML`.
 * Text binds as text. That last part is a statement FOR the renderer
 * (TASK_2026_494), not code this task can write: `libs/shared` is
 * platform-neutral and must not import an Angular lib.
 */
export const DASHBOARD_TEXT_FORMATS = ['plain'] as const;

export type DashboardTextFormat = (typeof DASHBOARD_TEXT_FORMATS)[number];

/**
 * Spec budgets — PROVISIONAL.
 *
 * These are the starting values from `context.md` "Budgets". That section also
 * asks for them to be confirmed by a render test; the renderer does not exist
 * yet (it is TASK_2026_494), and a number confirmed against a renderer that
 * does not exist would be a fabrication. So they ship provisional and
 * TASK_2026_494 confirms or replaces them. Anything that reads a budget reads
 * it from HERE, so confirming a number is a one-line change in one file.
 *
 * - `maxComponents` counts every node in the tree, not just the roots.
 * - `maxTreeDepth` counts nesting levels; a flat list of tiles is depth 1.
 * - `maxStringLength` applies to every string the contract accepts, ids
 *   included, so there is exactly one string limit to reason about.
 * - `maxTableRows` also caps `list.items` — both are row-shaped and a second
 *   number would be a second thing to confirm for no gain.
 * - `maxSeriesPoints` is summed across all series of ONE chart component.
 * - `maxSpecBytes` is measured on the UTF-8 JSON encoding of the spec as it
 *   ARRIVED, by `jsonUtf8Bytes` from
 *   `libs/backend/platform-core/src/utils/json-budget.ts` at the MCP boundary.
 */
export const DASHBOARD_LIMITS = {
  maxComponents: 200,
  maxTreeDepth: 8,
  maxStringLength: 2_000,
  maxTableRows: 1_000,
  maxTableColumns: 50,
  maxSeriesPoints: 5_000,
  maxSpecBytes: 256 * 1024,
} as const;

/**
 * Rows the plain-text fallback prints per table before it truncates.
 * `context.md` "Transport contract" fixes this at 20.
 */
export const DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS = 20;

/**
 * Whether `value` is a URL a spec may carry (control 4).
 *
 * Three rejections beyond the scheme check, each for a real smuggling route:
 *
 * 1. Surrounding whitespace. A browser's URL parser strips leading control
 *    characters and whitespace BEFORE reading the scheme, so `" javascript:x"`
 *    is a live `javascript:` URL that a naive `startsWith('https:')` passes.
 *    Rather than replicate that stripping, a value that is not already trimmed
 *    is simply refused.
 * 2. A relative or schemeless value. `URL.canParse` without a base is false for
 *    it, which is the answer we want: a spec must be explicit.
 * 3. Embedded credentials (`https://user:pass@host`). A spec has no business
 *    carrying a credential, and the userinfo field is a standard way to make a
 *    hostile host look like a trusted one in a rendered link.
 */
export function isAllowedDashboardUrl(value: string): boolean {
  if (value.length === 0 || value.length > DASHBOARD_LIMITS.maxStringLength) {
    return false;
  }
  if (value !== value.trim()) return false;

  // `URL.canParse` is the non-throwing form of the same parse. It keeps the
  // rejection a rejection instead of routing it through an exception that this
  // predicate would then have to swallow, which the degradation audit counts —
  // correctly — as a silently dropped failure.
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);

  if (parsed.username.length > 0 || parsed.password.length > 0) return false;

  return (DASHBOARD_URL_SCHEME_ALLOWLIST as readonly string[]).includes(
    parsed.protocol,
  );
}
