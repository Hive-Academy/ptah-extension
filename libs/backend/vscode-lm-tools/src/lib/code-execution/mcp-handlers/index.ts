/**
 * Backward-compat shim — the contents of `mcp-handlers/` were relocated as
 * part of TASK_2026_128 Phase 0:
 *
 *   - protocol handlers, tool descriptions, response formatters, the code
 *     execution engine, and the approval prompt handler now live in
 *     `code-execution/mcp-core/`.
 *   - the HTTP server lifecycle (`startHttpServer` etc.) now lives in
 *     `code-execution/mcp-http/`.
 *
 * This file re-exports the original public surface from those new homes so
 * any in-tree or out-of-tree consumer of `mcp-handlers/*` keeps compiling
 * unchanged. Deleted in a follow-up once we confirm no callers remain.
 */

export {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
  executeCode,
  wrapCodeForExecution,
  serializeResult,
  handleApprovalPrompt,
  handleMCPRequest,
  type CodeExecutionDependencies,
  type ApprovalPromptDependencies,
  type ProtocolHandlerDependencies,
  type ToolResultCallback,
} from '../mcp-core';

export {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
  type HttpServerConfig,
  type HttpServerResult,
} from '../mcp-http/http-server.handler';
