/**
 * MCP Handlers Module
 *
 * Re-exports all MCP handler components for code execution.
 */

// Tool description builders
export {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
} from './tool-description.builder';

// Code execution engine
export {
  executeCode,
  wrapCodeForExecution,
  serializeResult,
  type CodeExecutionDependencies,
} from './code-execution.engine';

// Approval prompt handler
export {
  handleApprovalPrompt,
  type ApprovalPromptDependencies,
} from './approval-prompt.handler';

// MCP protocol handlers
export {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-handlers';

// HTTP server handler
export {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
  type HttpServerConfig,
  type HttpServerResult,
} from './http-server.handler';
