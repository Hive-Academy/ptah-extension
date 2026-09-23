/**
 * How two spellings of one MCP server are recognised as the same server.
 *
 * Moved here from the Marketplace (TASK_2026_533, C14) because more than one
 * library now has to agree on it: the Marketplace connector rows and links
 * store, and the brand-mark resolver in `@ptah-extension/ui`. Two copies of
 * these rules would drift, and a server would then match in one place and not
 * the other.
 */

/**
 * Fold a server key to a comparable form.
 *
 * The session reports whatever the CLI calls the server, which for an account
 * connector is a display name (`Google Calendar`), while every disk and
 * manifest row is keyed by a slug (`google-calendar`). Comparing the raw
 * strings would let one server show up twice under two spellings, which is the
 * exact duplication this filter exists to prevent.
 */
export function normalizeServerKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Compare two MCP server URLs the way the manifest and the catalog disagree
 * about them: a trailing slash and host case are not a difference.
 */
export function normalizeMcpServerUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}
