/**
 * The webview's persisted route — the contract the renderer writes into
 * `vscode.setState` and the extension host reads back on panel restore
 * (TASK_2026_524).
 *
 * **Why this lives in `libs/shared`.** Same reason as
 * `webview-surface.types.ts`: the renderer writes the record and the VS Code
 * host's panel serializer reads it, and `libs/shared` is the one sanctioned
 * bridge between them.
 *
 * This module is deliberately dependency-free — no Angular, no Node, no
 * `vscode` — because both the renderer and the extension host import it.
 *
 * **Security boundary.** The record is persisted state that comes back from
 * outside the running webview, so {@link parseWebviewRouteState} accepts only
 * the exact shape below and returns `null` for anything else — including
 * input whose property access throws. A rejected route costs only the
 * restore (boot falls back to the host value or `chat`), so the route rules
 * lean strict.
 */

/** The key the route record occupies inside the mergeable `setState` record. */
export const WEBVIEW_ROUTE_STATE_KEY = 'ptahRoute';

/** Longest `route` the parser accepts. */
const MAX_ROUTE_LENGTH = 2048;
/** Longest `seed` the parser accepts. */
const MAX_SEED_LENGTH = 64;
/** Longest `panelId` the parser accepts. */
const MAX_PANEL_ID_LENGTH = 128;

/** The whole charset a `panelId` may use. */
const PANEL_ID_CHARSET = /^[A-Za-z0-9._-]*$/;
/** A per-panel id minted by the host: `ptah.panel.<id>`. */
const EDITOR_PANEL_ID = /^ptah\.panel\.[A-Za-z0-9._-]+$/;
/** The sidebar's `panelId`. */
const SIDEBAR_PANEL_ID = '';
/** The Electron main window's `panelId`. */
const ELECTRON_PANEL_ID = 'electron-main';

/**
 * The one route shape allowed to carry a colon: the marketplace skill-detail
 * page, `/marketplace/skills/:skillRef`. A colon anywhere else — any other
 * path segment, a matrix parameter, the query or the fragment — reads as a
 * URL scheme and the route is rejected.
 *
 * Duplicated here (not imported) because `libs/shared` stays dependency-free.
 * Sources, keep in step:
 * - the path: `libs/frontend/marketplace/src/lib/routes/marketplace.routes.ts`
 *   (`skills` → `listWithDetail('', …, 'skillRef', …)`);
 * - the segment, `${kind}:${id}`, and the three kinds:
 *   `libs/frontend/marketplace/src/lib/data/skill-ref.ts`
 *   (`MarketplaceSkillKind`, `encodeSkillRef`);
 * - `external:` as the only second prefix, on `marketplace-plugin` ids
 *   (`external:<owner>/<repo>/<plugin>`; the Router percent-encodes the
 *   slashes, so the ref stays one segment).
 *
 * The id itself carries no further colon, and an optional matrix, query or
 * fragment suffix carries none either. Any other colon-bearing route falls
 * back on restore.
 */
const SKILL_REF_ROUTE =
  /^\/marketplace\/skills\/(?:(?:ptah-plugin|community-skill|marketplace-plugin):|marketplace-plugin:external:)[^/;?#:]+(?:[;?#][^:]*)?$/;

/** A percent-encoded colon, which a Router-serialized URL never contains. */
const ENCODED_COLON = /%3a/i;

/** The route a webview last settled on, persisted under {@link WEBVIEW_ROUTE_STATE_KEY}. */
export interface WebviewRouteState {
  readonly v: 1;
  /** Logical Angular URL as serialized by the Router: '/'-rooted, e.g.
   *  '/chat/550e8400-e29b-41d4-a716-446655440000', '/thoth/skills',
   *  '/marketplace/servers/smithery'. Max 2048 chars. Never a scheme,
   *  authority ('//'), backslash or control character, raw or
   *  percent-decoded; never a malformed percent escape. */
  readonly route: string;
  /** Raw host initialView this webview last consumed; null if none.
   *  Max 64 chars. */
  readonly seed: string | null;
  /** ptahConfig.panelId at write time: '' (sidebar), 'electron-main',
   *  or 'ptah.panel.<uuid>'. Charset [A-Za-z0-9._-], max 128. A HINT. */
  readonly panelId: string;
}

/**
 * Reads the route record out of a whole `getState()` record.
 *
 * Takes the full state record, not the route entry, so every caller reads the
 * same key. Returns a fresh object holding only the contract's four fields
 * (extra keys are dropped), or `null` when the record, the entry or any field
 * falls outside the contract. Never throws: a throwing getter or proxy trap
 * on the input yields `null`.
 */
export function parseWebviewRouteState(
  record: unknown,
): WebviewRouteState | null {
  try {
    return parseRecord(record);
  } catch {
    // degradation-audit: reported — `null` is the documented invalid-input result.
    // Only reachable through hostile input (a throwing getter or proxy trap);
    // `getState()` itself returns plain cloned data. Invalid input is `null`.
    return null;
  }
}

function parseRecord(record: unknown): WebviewRouteState | null {
  if (!isPlainRecord(record)) return null;
  const entry = record[WEBVIEW_ROUTE_STATE_KEY];
  if (!isPlainRecord(entry)) return null;

  // Each field is read exactly once, so a getter cannot pass validation with
  // one value and return another.
  const { v, route, seed, panelId } = entry;
  if (v !== 1) return null;
  if (!isValidRoute(route)) return null;
  if (!isValidSeed(seed)) return null;
  if (!isValidPanelId(panelId)) return null;

  return { v: 1, route, seed, panelId };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRoute(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_ROUTE_LENGTH ||
    !value.startsWith('/')
  ) {
    return false;
  }
  const decoded = percentDecode(value);
  return (
    decoded !== null &&
    isSafeRouteText(value) &&
    isSafeRouteText(decoded) &&
    hasOnlyAllowedColons(value)
  );
}

/** The checks both the raw and the percent-decoded spelling must pass. */
function isSafeRouteText(value: string): boolean {
  return (
    !value.includes('//') &&
    !value.includes('\\') &&
    !hasControlCharacter(value)
  );
}

/**
 * No colon, or exactly the {@link SKILL_REF_ROUTE} shape. Checked on the raw
 * spelling only: an encoded colon is rejected outright, so decoding cannot add
 * a colon the raw check did not see.
 */
function hasOnlyAllowedColons(value: string): boolean {
  if (ENCODED_COLON.test(value)) return false;
  return !value.includes(':') || SKILL_REF_ROUTE.test(value);
}

/** `decodeURIComponent`, or `null` for a malformed escape such as `%` or `%GG`. */
function percentDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // degradation-audit: reported — `null` is the documented malformed-escape result.
    // A URIError is the documented signal for a malformed escape.
    return null;
  }
}

function isValidSeed(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length <= MAX_SEED_LENGTH)
  );
}

function isValidPanelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PANEL_ID_LENGTH &&
    PANEL_ID_CHARSET.test(value) &&
    (value === SIDEBAR_PANEL_ID ||
      value === ELECTRON_PANEL_ID ||
      EDITOR_PANEL_ID.test(value))
  );
}

/** C0 controls, DEL and C1 controls. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
