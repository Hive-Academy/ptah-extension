/**
 * MCP Handlers Module
 *
 * Re-exports all MCP handler components for code execution.
 */
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
} from './protocol-handlers';
export {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
  type HttpServerConfig,
  type HttpServerResult,
} from './http-server.handler';
