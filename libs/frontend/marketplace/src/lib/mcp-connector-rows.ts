import type {
  InstalledMcpServer,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';

/**
 * Short badge text for a claude.ai account connector row.
 *
 * `McpDirectoryBrowserComponent` renders `originLabel` verbatim in a
 * `badge-xs`, so it has to stay short enough not to wrap the row.
 */
export const CLAUDE_CONNECTOR_ORIGIN_LABEL = 'claude.ai connector';

/**
 * Why a connector row carries no Remove button.
 *
 * The row exists because a live session reported the server; the server itself
 * lives in the user's claude.ai account and in no file Ptah can write.
 */
export const CLAUDE_CONNECTOR_REMOVAL_REASON =
  'This connector lives in your claude.ai account, not on this machine. ' +
  'Add or remove it from your claude.ai connector settings — Ptah cannot ' +
  'change it from here.';

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
 * Map the session's MCP servers into the account-connector rows the Installed
 * tab cannot see for itself.
 *
 * ## The discriminator, and why it is a set difference
 *
 * `SessionMcpServerEntry` carries `name` and `status` and NOTHING ELSE — there
 * is no field on it that says "this one came from the claude.ai account". So
 * the connector-ness of an entry cannot be read off the entry; it has to be
 * inferred.
 *
 * The inference used here is the one the data actually supports: a session's
 * `mcp_servers` list is the union of what Ptah configured (the six harness
 * config files, `~/.claude.json`, and the Smithery / OAuth session overrides)
 * and what the user's claude.ai account contributed. `mcpDirectory:listInstalled`
 * returns exactly the first group. Whatever the session reports that the
 * installed list does not hold therefore came from the account.
 *
 * The rejected alternative was a hardcoded name list (Gmail, Google Calendar,
 * Drive, Canva). It is more literal but strictly worse: claude.ai gains
 * connectors on Anthropic's schedule, and a fixed list silently hides every one
 * added after this build — the same invisibility this whole change is closing.
 *
 * The set difference is not free of error: a server the user configured through
 * a path `listInstalled` does not read would be labelled a connector. It is
 * labelled with a `removal: 'none'` row that removes nothing and explains
 * itself, which is the mildest way to be wrong here.
 *
 * @param entries    Servers the session reported at `init`.
 * @param knownKeys  `serverKey`s already reaching the tab from disk/manifests.
 */
export function toConnectorRows(
  entries: readonly SessionMcpServerEntry[],
  knownKeys: readonly string[],
): InstalledMcpServer[] {
  const known = new Set(knownKeys.map(normalizeServerKey));
  const seen = new Set<string>();
  const rows: InstalledMcpServer[] = [];

  for (const entry of entries) {
    const normalized = normalizeServerKey(entry.name);
    if (!normalized || known.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push({
      serverKey: entry.name,
      // `target` is deliberately unset: an account connector belongs to no
      // harness config file, and naming one would point the uninstall RPC at a
      // file that has nothing to do with the row.
      configPath: '',
      // The session reports a name and a status, never a transport. `http` is
      // the only shape a remote account connector can have; the URL is
      // Anthropic-side and never crosses to the renderer.
      config: { type: 'http', url: '' },
      managedByPtah: false,
      origin: 'claude-connector',
      originLabel: CLAUDE_CONNECTOR_ORIGIN_LABEL,
      removal: 'none',
      removalBlockedReason: CLAUDE_CONNECTOR_REMOVAL_REASON,
    });
  }

  return rows;
}
