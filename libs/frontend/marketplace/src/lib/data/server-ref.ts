/**
 * The `:serverRef` route segment — `${origin}:${serverKey}` (implementation
 * plan D1).
 *
 * An installed MCP server is only unique per origin: the same key can be
 * installed through the harness config and through Claude's user config at
 * once. The ref therefore carries both halves in ONE path segment, so
 * `servers/:serverRef` never competes with the static source paths
 * (`servers/smithery` is a source, `servers/smithery:foo` is a server).
 *
 * Decoding splits at the FIRST `:`. No {@link McpServerOrigin} contains a colon,
 * so everything after it is the key, colons included. Pure and total: a
 * malformed ref decodes to `null` and the page renders "Not found".
 */

import type { McpServerOrigin } from '@ptah-extension/shared';

/** A decoded `:serverRef`. */
export interface ServerRef {
  readonly origin: McpServerOrigin;
  readonly serverKey: string;
}

/**
 * Every origin, as a lookup table.
 *
 * A `Record` over the union rather than an array: adding an origin to the
 * shared contract without listing it here is a compile error, not a server
 * whose detail link silently reports "Not found".
 */
const KNOWN_ORIGINS: Readonly<Record<McpServerOrigin, true>> = {
  'harness-config': true,
  'claude-user': true,
  smithery: true,
  oauth: true,
  'claude-connector': true,
};

const SEPARATOR = ':';

/** `{ origin: 'claude-user', serverKey: 'sentry' }` → `'claude-user:sentry'`. */
export function encodeServerRef(ref: ServerRef): string {
  return `${ref.origin}${SEPARATOR}${ref.serverKey}`;
}

/**
 * Decode a route parameter. Returns `null` for a missing value, a value with no
 * separator, an unknown origin, or an empty key.
 */
export function decodeServerRef(
  raw: string | null | undefined,
): ServerRef | null {
  if (!raw) return null;

  const separatorAt = raw.indexOf(SEPARATOR);
  if (separatorAt === -1) return null;

  const origin = raw.slice(0, separatorAt);
  const serverKey = raw.slice(separatorAt + SEPARATOR.length);
  if (!isMcpServerOrigin(origin) || serverKey.length === 0) return null;

  return { origin, serverKey };
}

function isMcpServerOrigin(value: string): value is McpServerOrigin {
  return Object.prototype.hasOwnProperty.call(KNOWN_ORIGINS, value);
}
