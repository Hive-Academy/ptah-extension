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
  const dashed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return trimEdgeRuns(dashed, '-', true);
}

/**
 * Compare two MCP server URLs the way the manifest and the catalog disagree
 * about them: a trailing slash and host case are not a difference.
 */
export function normalizeMcpServerUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = trimEdgeRuns(url.pathname, '/', false);
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return trimEdgeRuns(raw.trim(), '/', false);
  }
}

/**
 * `text` without the run of `char` at its end, and at its start too when
 * `leading` is set. A linear scan standing in for `/^c+|c+$/g`, whose
 * unanchored `c+$` alternative re-scans every inner run of `char` from each of
 * its positions — quadratic on a long run that is not at the end.
 */
function trimEdgeRuns(text: string, char: string, leading: boolean): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end--;
  let start = 0;
  if (leading) {
    while (start < end && text[start] === char) start++;
  }
  return text.slice(start, end);
}
