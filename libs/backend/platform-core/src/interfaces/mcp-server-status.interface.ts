/**
 * IMcpServerStatus — read-only status port for the in-process MCP server.
 *
 * Exists to break the construction-time cycle between vscode-lm-tools'
 * `CodeExecutionMCP` (which builds the `ptah.*` API used by spawned children)
 * and cli-agent-runtime's `PtahCliSpawnOptions` (which needs to know whether
 * the MCP server is running so spawned children can be wired to it).
 *
 * Consumers depend on this port, not on the concrete `CodeExecutionMCP`
 * class, keeping the module graph acyclic.
 */
export interface IMcpServerStatus {
  /** HTTP port the MCP server is listening on, or null if not started. */
  getPort(): number | null;
}

/** The two MCP fields every one-shot SDK query has to fill in. */
export interface McpSessionWiring {
  mcpServerRunning: boolean;
  mcpPort?: number;
}

/**
 * Turn the status port into the `{ mcpServerRunning, mcpPort }` pair the
 * one-shot query path expects.
 *
 * Three background session paths — the cron job runner, the memory curator's
 * LLM adapter and the wizard's content generator — each hard-coded
 * `mcpServerRunning: false` (TASK_2026_278 defect 13). That is not a config
 * choice; it means a cron job or a curator pass runs with `mcpServers: {}` and
 * therefore cannot use a single Ptah tool, on a host where the server is
 * demonstrably listening. Three call sites converging on one helper is what
 * stops a fourth from inventing a fourth answer.
 *
 * Passing the PORT and not just the boolean matters: the server falls back to
 * an OS-assigned port when the configured one is taken (EACCES under Hyper-V,
 * EADDRINUSE), so the `PTAH_MCP_PORT` default the runner would otherwise
 * substitute can be the wrong number on exactly the machines that needed the
 * fallback.
 *
 * An absent status port (a host that never started an MCP server, e.g. the
 * CLI) yields `{ mcpServerRunning: false }` — the previous behaviour, now
 * derived rather than assumed.
 */
export function resolveMcpSessionWiring(
  status: IMcpServerStatus | null | undefined,
): McpSessionWiring {
  const port = status?.getPort() ?? null;
  if (port === null) return { mcpServerRunning: false };
  return { mcpServerRunning: true, mcpPort: port };
}
