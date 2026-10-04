/**
 * mcp-stdio — Stdio transport for the MCP protocol core.
 *
 * Public surface consumed by `apps/ptah-cli/src/cli/commands/mcp-serve.ts`:
 *   - {@link StdioTransport}     — `IMcpServer` framing adapter over a host
 *                                  JSON-RPC notifier.
 *   - {@link StdioMcpServerService} — handles `initialize`, `tools/list`,
 *                                  `tools/call`. It dispatches the
 *                                  `agent_*` tools and `run_check` through
 *                                  {@link AgentToolDispatcher} and
 *                                  `session_submit` to a CLI-supplied
 *                                  composite handler.
 *   - {@link registerMcpStdioServices} — DI registration helper.
 *   - {@link buildMcpMvpTools}   — 10-tool MVP catalog with MCP-wire names.
 *   - {@link AgentToolDispatcher} — exported for unit-test reuse.
 *   - {@link ISessionSubmitHandler} / {@link SessionSubmitCancellation} —
 *                                  port the CLI implements to supply the
 *                                  `session_submit` dispatcher.
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

export { AgentToolDispatcher } from './agent-tool.dispatcher';

export type {
  ISessionSubmitHandler,
  SessionSubmitCancellation,
} from './session-submit.port';

export {
  MCP_MVP_TOOL_NAMES,
  buildMcpAgentSpawnTool,
  buildMcpAgentStatusTool,
  buildMcpAgentReadTool,
  buildMcpAgentMessageTool,
  buildMcpAgentReportTool,
  buildMcpAgentStopTool,
  buildMcpAgentListTool,
  buildMcpAgentWaitTool,
  buildMcpRunCheckTool,
  buildMcpSessionSubmitTool,
  buildMcpMvpTools,
  type McpMvpToolName,
} from './tool-builders';
