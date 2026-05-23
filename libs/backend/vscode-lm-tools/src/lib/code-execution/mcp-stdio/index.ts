/**
 * mcp-stdio — Stdio transport for the MCP protocol core.
 *
 * Public surface consumed by `apps/ptah-cli/src/cli/commands/mcp-serve.ts`:
 *   - {@link StdioTransport}     — `IMcpServer` framing adapter over a host
 *                                  JSON-RPC notifier.
 *   - {@link StdioMcpServerService} — handles `initialize`, `tools/list`,
 *                                  `tools/call` (placeholder until Phase 3).
 *   - {@link registerMcpStdioServices} — DI registration helper.
 *   - {@link buildMcpMvpTools}   — 7-tool MVP catalog with MCP-wire names.
 */

export {
  StdioTransport,
  type StdioTransportDeps,
  type McpStdioNotifier,
} from './stdio-transport';

export {
  StdioMcpServerService,
  createStdioMcpServer,
  MCP_PROTOCOL_VERSION,
  type StdioMcpServerConfig,
  type StdioMcpServerInfo,
} from './stdio-mcp-server.service';

export { registerMcpStdioServices, STDIO_MCP_SERVER_TOKEN } from './register';

export {
  MCP_MVP_TOOL_NAMES,
  buildMcpAgentSpawnTool,
  buildMcpAgentStatusTool,
  buildMcpAgentReadTool,
  buildMcpAgentSteerTool,
  buildMcpAgentStopTool,
  buildMcpAgentListTool,
  buildMcpSessionSubmitTool,
  buildMcpMvpTools,
  type McpMvpToolName,
} from './tool-builders';
