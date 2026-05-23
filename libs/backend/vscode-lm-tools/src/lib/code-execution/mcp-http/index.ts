/**
 * mcp-http — HTTP transport for the MCP protocol core.
 *
 * Wraps `mcp-core/` with a localhost HTTP server (default port 51820)
 * for in-process subagent discovery by Claude SDK sessions.
 */

export { CodeExecutionMCP } from './http-mcp-server.service';
export {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
  type HttpServerConfig,
  type HttpServerResult,
} from './http-server.handler';
