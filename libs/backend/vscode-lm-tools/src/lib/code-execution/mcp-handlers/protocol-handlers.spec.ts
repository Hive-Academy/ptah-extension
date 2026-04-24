/**
 * protocol-handlers — unit specs.
 *
 * Covers JSON-RPC 2.0 routing surface exposed by `handleMCPRequest`:
 *   1. Handshake (`initialize`) response shape.
 *   2. `tools/list` namespace toggle + IDE capability gating.
 *   3. `tools/call` individual tool routing (success + validation failure).
 *   4. `tools/call` `approval_prompt` auto-allow in Electron mode (no
 *      WebviewManager).
 *   5. Unknown method / unknown tool rejection → -32601 / -32602.
 *   6. Uncaught exception → -32603 internal error envelope.
 *
 * These are pure protocol-level tests — no HTTP, no real code execution.
 * `PtahAPI` is shimmed via a partial stub that only populates namespaces
 * the tests touch. Unused namespaces remain unset; casting through
 * `unknown` bridges the gap (same pattern used by
 * `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts`).
 *
 * Source-under-test:
 *   libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-handlers';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function createMockLogger(): MockLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/**
 * Build a minimal PtahAPI stub. Only the namespaces referenced in a given
 * test are wired with jest mocks; the rest are left undefined and cast
 * through `unknown` so TypeScript does not require us to populate the full
 * 15-namespace surface for each test.
 */
function buildPtahAPIStub(
  overrides: Partial<Record<keyof PtahAPI, unknown>> = {},
): PtahAPI {
  return overrides as unknown as PtahAPI;
}

function buildDeps(
  overrides: Partial<ProtocolHandlerDependencies> = {},
): ProtocolHandlerDependencies {
  return {
    ptahAPI: buildPtahAPIStub(),
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: asLogger(createMockLogger()),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<MCPRequest> = {}): MCPRequest {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Handshake (initialize)
// ---------------------------------------------------------------------------

describe('protocol-handlers › handshake (initialize)', () => {
  it('returns MCP 2024-11-05 protocol version + tools capability', async () => {
    const logger = createMockLogger();
    const deps = buildDeps({ logger: asLogger(logger) });
    const req = makeRequest({
      id: 'handshake-42',
      method: 'initialize',
      params: { clientInfo: { name: 'claude-code', version: '0.1.0' } },
    });

    const res = await handleMCPRequest(req, deps);

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe('handshake-42');
    expect(res.error).toBeUndefined();
    const result = res.result as {
      protocolVersion: string;
      capabilities: { tools: Record<string, unknown> };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo).toEqual({ name: 'ptah', version: '1.0.0' });
    // Logger must record both the top-level MCP Request and the initialize hook.
    expect(logger.info).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tools/list — namespace gating & IDE capabilities
// ---------------------------------------------------------------------------

describe('protocol-handlers › tools/list', () => {
  function getToolNames(res: MCPResponse): string[] {
    const result = res.result as { tools: Array<{ name: string }> } | undefined;
    return (result?.tools ?? []).map((t) => t.name);
  }

  it('always includes the 7 always-on core tools', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({ id: 'list-1', method: 'tools/list' }),
      deps,
    );
    const names = getToolNames(res);

    for (const core of [
      'ptah_workspace_analyze',
      'ptah_search_files',
      'ptah_get_diagnostics',
      'ptah_count_tokens',
      'ptah_web_search',
      'execute_code',
      'approval_prompt',
    ]) {
      expect(names).toContain(core);
    }
  });

  it('excludes IDE / LSP tools when hasIDECapabilities is false', async () => {
    const deps = buildDeps({ hasIDECapabilities: false });
    const names = getToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'list-2', method: 'tools/list' }),
        deps,
      ),
    );
    expect(names).not.toContain('ptah_lsp_references');
    expect(names).not.toContain('ptah_lsp_definitions');
    expect(names).not.toContain('ptah_get_dirty_files');
  });

  it('includes IDE / LSP tools when hasIDECapabilities is true and ide namespace not disabled', async () => {
    const deps = buildDeps({ hasIDECapabilities: true });
    const names = getToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'list-3', method: 'tools/list' }),
        deps,
      ),
    );
    expect(names).toContain('ptah_lsp_references');
    expect(names).toContain('ptah_lsp_definitions');
    expect(names).toContain('ptah_get_dirty_files');
  });

  it('filters out namespace-toggleable tools listed in disabledMcpNamespaces', async () => {
    const deps = buildDeps({
      hasIDECapabilities: true,
      disabledMcpNamespaces: [
        'agent',
        'git',
        'json',
        'browser',
        'harness',
        'ide',
      ],
    });
    const names = getToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'list-4', method: 'tools/list' }),
        deps,
      ),
    );

    // Toggled-off namespace tools should be absent.
    for (const gone of [
      'ptah_lsp_references',
      'ptah_agent_spawn',
      'ptah_git_worktree_list',
      'ptah_json_validate',
      'ptah_browser_navigate',
      'ptah_harness_search_skills',
    ]) {
      expect(names).not.toContain(gone);
    }
    // Always-on core tools must survive all toggles.
    expect(names).toContain('ptah_workspace_analyze');
    expect(names).toContain('execute_code');
    expect(names).toContain('approval_prompt');
  });
});

// ---------------------------------------------------------------------------
// tools/call — individual tool routing
// ---------------------------------------------------------------------------

describe('protocol-handlers › tools/call individual tool routing', () => {
  it('routes ptah_search_files to ptahAPI.search.findFiles and wraps text content', async () => {
    const findFiles = jest.fn().mockResolvedValue(['a.ts', 'b.ts']);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        search: { findFiles } as unknown as PtahAPI['search'],
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 99,
        method: 'tools/call',
        params: {
          name: 'ptah_search_files',
          arguments: { pattern: '**/*.ts', limit: 10 },
        },
      }),
      deps,
    );

    expect(findFiles).toHaveBeenCalledWith('**/*.ts', 10);
    const content = (
      res.result as { content: Array<{ type: string; text: string }> }
    ).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('a.ts');
    expect(content[0].text).toContain('b.ts');
  });

  it('invokes onToolResult callback with request id and result text on success', async () => {
    const onToolResult = jest.fn();
    const findFiles = jest.fn().mockResolvedValue(['x.ts']);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        search: { findFiles } as unknown as PtahAPI['search'],
      }),
      onToolResult,
    });

    await handleMCPRequest(
      makeRequest({
        id: 'cb-7',
        method: 'tools/call',
        params: { name: 'ptah_search_files', arguments: { pattern: '*.ts' } },
      }),
      deps,
    );

    expect(onToolResult).toHaveBeenCalledTimes(1);
    const [id, text, isError] = onToolResult.mock.calls[0];
    expect(id).toBe('cb-7');
    expect(typeof text).toBe('string');
    expect(isError).toBe(false);
  });

  it('returns isError envelope when an individual tool handler throws', async () => {
    const findFiles = jest.fn().mockRejectedValue(new Error('boom'));
    const onToolResult = jest.fn();
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        search: { findFiles } as unknown as PtahAPI['search'],
      }),
      onToolResult,
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'err-1',
        method: 'tools/call',
        params: { name: 'ptah_search_files', arguments: { pattern: '**/*' } },
      }),
      deps,
    );

    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
    expect(onToolResult).toHaveBeenCalledWith('err-1', 'boom', true);
  });

  it('rejects ptah_agent_spawn with malformed task (missing) via isError payload', async () => {
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        agent: {
          spawn: jest.fn(),
        } as unknown as PtahAPI['agent'],
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 7,
        method: 'tools/call',
        params: { name: 'ptah_agent_spawn', arguments: { cli: 'gemini' } },
      }),
      deps,
    );

    const result = res.result as {
      content: Array<{ text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/"task" parameter is required/);
  });

  it('rejects ptah_git_worktree_add when branch is empty', async () => {
    const worktreeAdd = jest.fn();
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        git: { worktreeAdd } as unknown as PtahAPI['git'],
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'wt-1',
        method: 'tools/call',
        params: { name: 'ptah_git_worktree_add', arguments: { branch: '   ' } },
      }),
      deps,
    );

    const result = res.result as {
      content: Array<{ text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/"branch" is required/);
    expect(worktreeAdd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tools/call — approval_prompt (Electron auto-allow branch)
// ---------------------------------------------------------------------------

describe('protocol-handlers › approval_prompt auto-allow', () => {
  it('auto-allows approval_prompt when webviewManager is absent (Electron mode)', async () => {
    const deps = buildDeps({
      webviewManager: undefined,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'approve-1',
        method: 'tools/call',
        params: {
          name: 'approval_prompt',
          arguments: { tool_name: 'Bash', input: { cmd: 'ls' } },
        },
      }),
      deps,
    );

    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(result.content[0].text) as {
      behavior: string;
      updatedInput: Record<string, unknown>;
    };
    expect(parsed.behavior).toBe('allow');
    expect(parsed.updatedInput).toEqual({ cmd: 'ls' });
  });
});

// ---------------------------------------------------------------------------
// Malformed / unknown method and tool rejection
// ---------------------------------------------------------------------------

describe('protocol-handlers › malformed message rejection', () => {
  it('returns -32601 Method not found for unknown JSON-RPC method', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({ id: 3, method: 'tools/does-not-exist' }),
      deps,
    );

    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toMatch(
      /Method not found: tools\/does-not-exist/,
    );
    expect(res.id).toBe(3);
  });

  it('returns -32602 Unknown tool for unrecognized tools/call name', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({
        id: 4,
        method: 'tools/call',
        params: { name: 'totally_unknown_tool', arguments: {} },
      }),
      deps,
    );

    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toMatch(/Unknown tool: totally_unknown_tool/);
  });

  it('returns -32603 Internal error when tools/call params is missing (uncaught throw)', async () => {
    // params is required by handleToolsCall — its destructure throws on undefined.
    // The outer try/catch in handleMCPRequest must translate this into a -32603.
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({ id: 5, method: 'tools/call' }),
      deps,
    );

    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32603);
    expect(typeof res.error?.message).toBe('string');
  });
});
