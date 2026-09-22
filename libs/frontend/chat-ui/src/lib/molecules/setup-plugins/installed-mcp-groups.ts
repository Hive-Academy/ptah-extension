import type {
  InstalledMcpServer,
  McpInstallTarget,
} from '@ptah-extension/shared';

/**
 * Grouped installed servers for the Installed tab.
 *
 * Grouped by origin AND server key, never by key alone: a `github` entry read
 * from `.mcp.json` and a `github` connector held by a live claude.ai session
 * are two different installations with two different removal paths. Collapsing
 * them onto one row hands the user a Remove button that acts on the wrong one.
 */
export interface InstalledServerGroup {
  /** `${origin} ${serverKey}` — the grouping identity, and the @for track. */
  key: string;
  /** The bare key as it appears in config / session status. */
  serverKey: string;
  origin: InstalledMcpServer['origin'];
  originLabel: string;
  /** `harness-config` is the unremarkable case and stays unlabelled. */
  showOriginLabel: boolean;
  removal: InstalledMcpServer['removal'];
  removalBlockedReason?: string;
  servers: InstalledMcpServer[];
  /** Only the rows that actually have a target — Smithery/OAuth rows have none. */
  targets: McpInstallTarget[];
  /** Distinct config files behind this group, named in the `direct` confirm step. */
  configPaths: string[];
}

const TARGET_LABELS: Record<McpInstallTarget, string> = {
  vscode: 'VS Code',
  // Codex has its own target now — it reads ~/.codex/config.toml, never
  // .mcp.json, so it was never actually covered by the Claude entry.
  claude: 'Claude Code',
  cursor: 'Cursor',
  copilot: 'Copilot CLI',
  codex: 'Codex CLI',
  // Same story as Codex: `agy` reads ~/.gemini/config/mcp_config.json and
  // nothing else, so until TASK_2026_285 it could not be offered at all.
  antigravity: 'Antigravity CLI',
};

/** Display name for one install target. */
export function mcpTargetLabel(target: McpInstallTarget): string {
  return TARGET_LABELS[target];
}

/**
 * Collapse a flat installed-server list into one row per origin+key.
 *
 * Total: every input shape produces a group list, never a throw. Insertion
 * order of the first row for each identity is preserved, so the rendered list
 * stays stable across reloads of the same data.
 */
export function groupInstalledServers(
  servers: readonly InstalledMcpServer[],
): InstalledServerGroup[] {
  const map = new Map<string, InstalledMcpServer[]>();
  for (const server of servers) {
    const key = `${server.origin} ${server.serverKey}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(server);
    } else {
      map.set(key, [server]);
    }
  }
  return Array.from(map.entries()).map(([key, grouped]) => {
    const head = grouped[0];
    return {
      key,
      serverKey: head.serverKey,
      origin: head.origin,
      originLabel: head.originLabel,
      showOriginLabel: head.origin !== 'harness-config',
      removal: head.removal,
      removalBlockedReason: head.removalBlockedReason,
      servers: grouped,
      targets: grouped
        .map((s) => s.target)
        .filter((t): t is McpInstallTarget => t !== undefined),
      configPaths: Array.from(
        new Set(grouped.map((s) => s.configPath).filter(Boolean)),
      ),
    };
  });
}
