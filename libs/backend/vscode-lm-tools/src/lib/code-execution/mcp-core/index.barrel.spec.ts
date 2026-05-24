/**
 * mcp-core public-barrel regression spec.
 *
 * After TASK_2026_128 Phase 0 the MCP protocol code moved out of
 * `mcp-handlers/` into `mcp-core/`. This spec locks down the
 * `mcp-core` barrel re-export surface so a follow-up refactor can't
 * silently break downstream consumers (the HTTP transport in
 * `mcp-http/`, the upcoming stdio transport in `mcp-stdio/`, and the
 * `mcp-handlers/index.ts` back-compat shim).
 */

import 'reflect-metadata';

import * as mcpCore from './index';

describe('mcp-core public barrel', () => {
  it('re-exports handleMCPRequest as a function', () => {
    expect(typeof mcpCore.handleMCPRequest).toBe('function');
  });

  it('re-exports the code-execution engine helpers', () => {
    expect(typeof mcpCore.executeCode).toBe('function');
    expect(typeof mcpCore.wrapCodeForExecution).toBe('function');
    expect(typeof mcpCore.serializeResult).toBe('function');
  });

  it('re-exports the approval-prompt handler', () => {
    expect(typeof mcpCore.handleApprovalPrompt).toBe('function');
  });

  it('re-exports execute_code + approval_prompt tool builders', () => {
    expect(typeof mcpCore.buildExecuteCodeTool).toBe('function');
    expect(typeof mcpCore.buildApprovalPromptTool).toBe('function');
  });
});
