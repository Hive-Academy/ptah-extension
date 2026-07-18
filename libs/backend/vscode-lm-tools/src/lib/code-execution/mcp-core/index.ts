/**
 * mcp-core — Transport-agnostic MCP protocol core.
 *
 * Hosts the JSON-RPC 2.0 dispatcher, tool descriptions, response formatters,
 * the code-execution engine, approval prompt handler, and the MCP protocol
 * type definitions. Consumed by every transport adapter (`mcp-http/`,
 * `mcp-stdio/`) — none of which appear here.
 */

export * from './types/mcp-protocol.types';
export * from './types/mcp-transport.types';

export {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
} from './tool-description.builder';

export {
  executeCode,
  wrapCodeForExecution,
  serializeResult,
  type CodeExecutionDependencies,
} from './code-execution.engine';

export {
  handleApprovalPrompt,
  type ApprovalPromptDependencies,
} from './approval-prompt.handler';

export {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
  type ToolResultCallback,
} from './protocol-dispatcher';

export {
  runWithMcpRequestContext,
  getCallerSessionId,
  type McpRequestContext,
} from './mcp-request-context';
