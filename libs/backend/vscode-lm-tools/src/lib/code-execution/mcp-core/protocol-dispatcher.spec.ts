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

import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
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
// Harness tools
//
// Two invariants: all six harness methods are reachable as MCP tools (an agent
// that finished a build had nowhere to send the result because proposeConfig
// was reachable only from execute_code), and a degraded search is reported as a
// TOOL ERROR rather than as data an agent could read as a valid empty answer.
// ---------------------------------------------------------------------------

describe('harness tools', () => {
  function harnessDeps(harness: Record<string, unknown>) {
    return buildDeps({ ptahAPI: buildPtahAPIStub({ harness }) });
  }

  function callTool(
    name: string,
    args: Record<string, unknown>,
    deps: ProtocolHandlerDependencies,
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: `call-${name}`,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      deps,
    );
  }

  function toolResult(res: MCPResponse): {
    isError?: boolean;
    text: string;
  } {
    const result = res.result as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    return { isError: result.isError, text: result.content[0].text };
  }

  it('lists all six harness methods as tools', async () => {
    const names = listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'list-harness', method: 'tools/list' }),
        buildDeps(),
      ),
    );

    for (const tool of [
      'ptah_harness_search_skills',
      'ptah_harness_create_skill',
      'ptah_harness_search_mcp_registry',
      'ptah_harness_list_installed_mcp',
      'ptah_harness_install_mcp_server',
      'ptah_harness_propose_config',
    ]) {
      expect(names).toContain(tool);
    }
  });

  it('flags a degraded skill search as a tool error instead of a clean empty list', async () => {
    const deps = harnessDeps({
      searchSkills: jest.fn(async () => ({
        skills: [],
        count: 0,
        status: 'degraded',
        sources: [
          {
            source: 'skills.sh',
            status: 'failed',
            count: 0,
            error: 'upstream 503',
          },
        ],
        offset: 0,
        limit: 50,
        hasMore: false,
      })),
    });

    const { isError, text } = toolResult(
      await callTool('ptah_harness_search_skills', { query: 'threejs' }, deps),
    );

    expect(isError).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ status: 'degraded' });
  });

  it('returns a genuinely empty skill search as a normal success', async () => {
    const deps = harnessDeps({
      searchSkills: jest.fn(async () => ({
        skills: [],
        count: 0,
        status: 'ok',
        sources: [{ source: 'skills.sh', status: 'ok', count: 0 }],
        offset: 0,
        limit: 50,
        hasMore: false,
      })),
    });

    const { isError } = toolResult(
      await callTool('ptah_harness_search_skills', { query: 'threejs' }, deps),
    );

    expect(isError).toBeUndefined();
  });

  it('forwards the paging window to searchSkills', async () => {
    const searchSkills = jest.fn(async () => ({
      skills: [],
      count: 0,
      status: 'ok',
      sources: [],
      offset: 25,
      limit: 5,
      hasMore: false,
    }));
    await callTool(
      'ptah_harness_search_skills',
      { query: 'react', limit: 5, offset: 25 },
      harnessDeps({ searchSkills }),
    );
    expect(searchSkills).toHaveBeenCalledWith('react', 5, 25);
  });

  it('forwards the scope to createSkill and rejects an unknown one', async () => {
    const createSkill = jest.fn(async () => ({
      skillId: 'house-style',
      skillPath:
        '/ws/.ptah/plugins/ptah-harness-house-style/skills/house-style/SKILL.md',
      scope: 'workspace',
      pluginId: 'ptah-harness-house-style',
    }));
    const deps = harnessDeps({ createSkill });

    await callTool(
      'ptah_harness_create_skill',
      {
        name: 'House Style',
        description: 'd',
        content: 'c',
        scope: 'workspace',
      },
      deps,
    );
    expect(createSkill).toHaveBeenCalledWith(
      'House Style',
      'd',
      'c',
      undefined,
      'workspace',
    );

    const { isError } = toolResult(
      await callTool(
        'ptah_harness_create_skill',
        { name: 'x', description: 'd', content: 'c', scope: 'global' },
        deps,
      ),
    );
    expect(isError).toBe(true);
    expect(createSkill).toHaveBeenCalledTimes(1);
  });

  it('flags a degraded registry search as a tool error', async () => {
    const deps = harnessDeps({
      searchMcpRegistry: jest.fn(async () => ({
        servers: [],
        count: 0,
        status: 'degraded',
        sources: [
          {
            source: 'official',
            status: 'failed',
            count: 0,
            error: 'registry 503',
          },
        ],
      })),
    });

    const { isError } = toolResult(
      await callTool(
        'ptah_harness_search_mcp_registry',
        { query: 'postgres' },
        deps,
      ),
    );

    expect(isError).toBe(true);
  });

  it('reports an absent harness namespace as an error, not as an empty result', async () => {
    const { isError, text } = toolResult(
      await callTool('ptah_harness_search_skills', { query: 'x' }, buildDeps()),
    );

    expect(isError).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ status: 'error', skills: [] });
  });

  it('routes propose_config to the namespace and echoes the completion flag', async () => {
    const proposeConfig = jest.fn(async () => 'Configuration marked complete.');
    const deps = harnessDeps({ proposeConfig });

    const { isError, text } = toolResult(
      await callTool(
        'ptah_harness_propose_config',
        { configUpdates: { name: 'My Harness' }, isConfigComplete: true },
        deps,
      ),
    );

    expect(isError).toBeUndefined();
    expect(proposeConfig).toHaveBeenCalledWith({ name: 'My Harness' }, true);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      isConfigComplete: true,
    });
  });

  it('rejects propose_config without an object configUpdates', async () => {
    const proposeConfig = jest.fn();
    const deps = harnessDeps({ proposeConfig });

    const { isError } = toolResult(
      await callTool(
        'ptah_harness_propose_config',
        { configUpdates: 'nope' },
        deps,
      ),
    );

    expect(isError).toBe(true);
    expect(proposeConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task specs namespace (TASK_2026_179, step 17)
// ---------------------------------------------------------------------------

const TASK_TOOLS = [
  'ptah_task_create',
  'ptah_task_update',
  'ptah_task_get',
  'ptah_task_list',
  'ptah_task_check',
] as const;

/** Tool definitions from a `tools/list` response. */
function listedTools(res: MCPResponse): Array<{
  name: string;
  annotations?: { readOnlyHint?: boolean };
}> {
  return (
    res.result as {
      tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    }
  ).tools;
}

function listedToolNames(res: MCPResponse): string[] {
  return listedTools(res).map((tool) => tool.name);
}

describe('tools/list — task specs are ALWAYS ON', () => {
  it('exposes all five task tools in the default (no-config) tool list', async () => {
    const names = listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'tasks-1', method: 'tools/list' }),
        buildDeps(),
      ),
    );
    for (const tool of TASK_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  /**
   * The namespace must be un-disableable, not merely on-by-default.
   *
   * Disabling every toggleable namespace AND passing `'tasks'` (the name a user
   * would reach for) must still leave all five present. If someone later wraps
   * these builders in a `disabled.has('tasks')` guard, this is what catches it.
   */
  it('survives disabledMcpNamespaces, including an explicit "tasks" entry', async () => {
    const names = listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'tasks-2', method: 'tools/list' }),
        buildDeps({
          hasIDECapabilities: true,
          disabledMcpNamespaces: [
            'tasks',
            'task',
            'ide',
            'agent',
            'git',
            'json',
            'browser',
            'harness',
            'code',
          ],
        }),
      ),
    );
    for (const tool of TASK_TOOLS) {
      expect(names).toContain(tool);
    }
    // Sanity: the toggles really did take effect for toggleable namespaces,
    // otherwise the assertion above proves nothing.
    expect(names).not.toContain('ptah_browser_navigate');
    expect(names).not.toContain('ptah_agent_spawn');
  });

  /**
   * No prose-writing tool, ever.
   *
   * The contract splits ownership: the carrier is machine-owned metadata and
   * prose is agent-owned. A `set_section` tool would put agent narrative onto
   * the file the Tasks board mutates — which is precisely the lost-status bug
   * this task set exists to close. Asserting on the PATTERN rather than one
   * exact name means a differently-spelled section-writer also fails.
   */
  it('exposes no *set_section* tool on any configuration', async () => {
    for (const deps of [
      buildDeps(),
      buildDeps({ hasIDECapabilities: true }),
      buildDeps({ hasIDECapabilities: true, hasSqliteLayer: true }),
    ]) {
      const names = listedToolNames(
        await handleMCPRequest(
          makeRequest({ id: 'tasks-3', method: 'tools/list' }),
          deps,
        ),
      );
      expect(names.filter((name) => name.includes('set_section'))).toEqual([]);
    }
  });

  it('declares the read-only task tools as read-only', async () => {
    const response = await handleMCPRequest(
      makeRequest({ id: 'tasks-4', method: 'tools/list' }),
      buildDeps(),
    );
    const byName = new Map(
      listedTools(response).map((tool) => [tool.name, tool]),
    );
    for (const readOnly of [
      'ptah_task_get',
      'ptah_task_list',
      'ptah_task_check',
    ]) {
      expect(byName.get(readOnly)?.annotations?.readOnlyHint).toBe(true);
    }
    // The mutating pair must NOT claim to be read-only.
    for (const mutating of ['ptah_task_create', 'ptah_task_update']) {
      expect(byName.get(mutating)?.annotations?.readOnlyHint).toBeUndefined();
    }
  });
});

describe('tools/call — task specs routing', () => {
  interface TasksApiMock {
    create: jest.Mock;
    update: jest.Mock;
    get: jest.Mock;
    list: jest.Mock;
    check: jest.Mock;
  }

  function buildTasksApi(): {
    tasks: TasksApiMock;
    deps: ProtocolHandlerDependencies;
  } {
    const tasks = {
      create: jest.fn().mockResolvedValue({ ok: true, task: { id: 'A' } }),
      update: jest.fn().mockResolvedValue({ ok: true, task: { id: 'A' } }),
      get: jest.fn().mockResolvedValue({ ok: true, task: { id: 'A' } }),
      list: jest.fn().mockResolvedValue({ ok: true, tasks: [], count: 0 }),
      check: jest.fn().mockResolvedValue({ ok: true, healthy: true }),
    };
    return { tasks, deps: buildDeps({ ptahAPI: buildPtahAPIStub({ tasks }) }) };
  }

  it('routes each task tool to its namespace method with the raw args', async () => {
    const { tasks, deps } = buildTasksApi();

    await handleMCPRequest(
      makeRequest({
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'ptah_task_create',
          arguments: { title: 'New', type: 'FEATURE' },
        },
      }),
      deps,
    );
    expect(tasks.create).toHaveBeenCalledWith({
      title: 'New',
      type: 'FEATURE',
    });

    await handleMCPRequest(
      makeRequest({
        id: 'call-2',
        method: 'tools/call',
        params: {
          name: 'ptah_task_update',
          arguments: { taskId: 'TASK_2026_179', status: 'done' },
        },
      }),
      deps,
    );
    expect(tasks.update).toHaveBeenCalledWith({
      taskId: 'TASK_2026_179',
      status: 'done',
    });

    await handleMCPRequest(
      makeRequest({
        id: 'call-3',
        method: 'tools/call',
        params: { name: 'ptah_task_check' },
      }),
      deps,
    );
    expect(tasks.check).toHaveBeenCalled();
  });

  /**
   * A validation refusal is DATA, not a protocol error: the namespace returns
   * `{ ok: false, ... }` and the dispatcher passes it through as a successful
   * tool result. That is what lets the agent read the reason and correct
   * itself instead of only seeing "tool failed".
   */
  it('passes a typed namespace refusal through as tool result content', async () => {
    const { tasks, deps } = buildTasksApi();
    tasks.update.mockResolvedValue({
      ok: false,
      code: 'TASK_CONFLICT',
      error: 'changed on disk',
    });

    const response = await handleMCPRequest(
      makeRequest({
        id: 'call-4',
        method: 'tools/call',
        params: {
          name: 'ptah_task_update',
          arguments: { taskId: 'TASK_2026_179', status: 'done' },
        },
      }),
      deps,
    );

    const result = response.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      code: 'TASK_CONFLICT',
      error: 'changed on disk',
    });
  });
});

// ---------------------------------------------------------------------------
// tools/list — eager (_meta alwaysLoad) marking
// ---------------------------------------------------------------------------

describe('protocol-handlers › tools/list eager _meta marking', () => {
  function getTools(
    res: MCPResponse,
  ): Array<{ name: string; _meta?: Record<string, unknown> }> {
    const result = res.result as
      | { tools: Array<{ name: string; _meta?: Record<string, unknown> }> }
      | undefined;
    return result?.tools ?? [];
  }

  function isEager(
    tool: { _meta?: Record<string, unknown> } | undefined,
  ): boolean {
    return tool?._meta?.['anthropic/alwaysLoad'] === true;
  }

  async function listTools(
    overrides: Partial<ProtocolHandlerDependencies> = {},
  ): Promise<Array<{ name: string; _meta?: Record<string, unknown> }>> {
    return getTools(
      await handleMCPRequest(
        makeRequest({ id: 'eager', method: 'tools/list' }),
        buildDeps(overrides),
      ),
    );
  }

  it('marks the always-eager core tools with _meta alwaysLoad === true', async () => {
    const tools = await listTools();
    for (const name of [
      'ptah_search_files',
      'ptah_ast_analyze',
      'ptah_context_enrich_file',
      'ptah_get_diagnostics',
      'ptah_workspace_analyze',
    ]) {
      expect(isEager(tools.find((t) => t.name === name))).toBe(true);
    }
  });

  it('keeps execute_code available but deferred behind tool search', async () => {
    const tools = await listTools();
    const executeCode = tools.find((tool) => tool.name === 'execute_code');

    expect(executeCode).toBeDefined();
    expect(isEager(executeCode)).toBe(false);
    expect(executeCode?._meta).toBeUndefined();
  });

  it('does NOT mark non-eager tools (e.g. a browser tool) with _meta', async () => {
    const tools = await listTools();
    const browser = tools.find((t) => t.name === 'ptah_browser_navigate');
    expect(browser).toBeDefined();
    expect(isEager(browser)).toBe(false);
    expect(browser?._meta).toBeUndefined();
  });

  it('marks IDE-only eager tools only when hasIDECapabilities is true', async () => {
    const withIde = await listTools({ hasIDECapabilities: true });
    for (const name of [
      'ptah_lsp_references',
      'ptah_lsp_definitions',
      'ptah_get_dirty_files',
    ]) {
      expect(isEager(withIde.find((t) => t.name === name))).toBe(true);
    }
  });

  it('does NOT mark IDE-only eager tools when hasIDECapabilities is false', async () => {
    const tools = await listTools({ hasIDECapabilities: false });
    expect(tools.find((t) => t.name === 'ptah_lsp_references')).toBeUndefined();
  });

  it('marks SQLite-only eager tools only when hasSqliteLayer is true', async () => {
    const withSqlite = await listTools({ hasSqliteLayer: true });
    for (const name of ['ptah_code_search_symbols', 'ptah_memory_search']) {
      expect(isEager(withSqlite.find((t) => t.name === name))).toBe(true);
    }
  });

  it('does NOT mark SQLite-only eager tools when hasSqliteLayer is falsy', async () => {
    const tools = await listTools();
    expect(
      isEager(tools.find((t) => t.name === 'ptah_code_search_symbols')),
    ).toBe(false);
    expect(isEager(tools.find((t) => t.name === 'ptah_memory_search'))).toBe(
      false,
    );
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

  it('builds the dependency graph from ABSOLUTE paths and resolves a relative query arg', async () => {
    const root = path.resolve('/ws');
    const isBuilt = jest.fn().mockResolvedValue(false);
    const buildGraph = jest.fn().mockResolvedValue({ nodeCount: 2 });
    const getDependents = jest.fn().mockResolvedValue([]);
    const getInfo = jest.fn().mockResolvedValue({ path: root });
    const findFiles = jest.fn().mockResolvedValue(['src/a.ts', 'src/b.ts']);

    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        workspace: { getInfo } as unknown as PtahAPI['workspace'],
        search: { findFiles } as unknown as PtahAPI['search'],
        dependencies: {
          isBuilt,
          buildGraph,
          getDependents,
        } as unknown as PtahAPI['dependencies'],
      }),
    });

    await handleMCPRequest(
      makeRequest({
        id: 5,
        method: 'tools/call',
        params: {
          name: 'ptah_get_dependents',
          arguments: { file: 'src/a.ts' },
        },
      }),
      deps,
    );

    // Graph built with absolute file paths (relative findFiles results joined to root).
    expect(buildGraph).toHaveBeenCalledWith(
      [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
      root,
    );
    // Relative query arg resolved to absolute before querying.
    expect(getDependents).toHaveBeenCalledWith(path.join(root, 'src/a.ts'));
  });

  it('passes an absolute dependency query arg through unchanged', async () => {
    const abs = path.resolve('/ws/src/a.ts');
    const getDependencies = jest.fn().mockResolvedValue([]);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        workspace: {
          getInfo: jest.fn().mockResolvedValue({ path: path.resolve('/ws') }),
        } as unknown as PtahAPI['workspace'],
        search: {
          findFiles: jest.fn().mockResolvedValue([]),
        } as unknown as PtahAPI['search'],
        dependencies: {
          isBuilt: jest.fn().mockResolvedValue(true),
          getDependencies,
        } as unknown as PtahAPI['dependencies'],
      }),
    });

    await handleMCPRequest(
      makeRequest({
        id: 6,
        method: 'tools/call',
        params: {
          name: 'ptah_get_dependencies',
          arguments: { file: abs },
        },
      }),
      deps,
    );

    expect(getDependencies).toHaveBeenCalledWith(abs, undefined);
  });

  it('ptah_count_tokens reads a relative path as-is through the sandbox', async () => {
    const read = jest.fn().mockResolvedValue('source');
    const countTokens = jest.fn().mockResolvedValue(42);
    const getInfo = jest.fn();
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        files: { read } as unknown as PtahAPI['files'],
        context: { countTokens } as unknown as PtahAPI['context'],
        workspace: { getInfo } as unknown as PtahAPI['workspace'],
      }),
    });

    await handleMCPRequest(
      makeRequest({
        id: 1,
        method: 'tools/call',
        params: { name: 'ptah_count_tokens', arguments: { file: 'src/a.ts' } },
      }),
      deps,
    );

    expect(read).toHaveBeenCalledWith('src/a.ts');
    expect(getInfo).not.toHaveBeenCalled();
    expect(countTokens).toHaveBeenCalledWith('source');
  });

  it('ptah_count_tokens rewrites an absolute in-workspace path to relative for the sandbox', async () => {
    const read = jest.fn().mockResolvedValue('source');
    const countTokens = jest.fn().mockResolvedValue(7);
    const getInfo = jest.fn().mockResolvedValue({ path: 'D:/ws' });
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        files: { read } as unknown as PtahAPI['files'],
        context: { countTokens } as unknown as PtahAPI['context'],
        workspace: { getInfo } as unknown as PtahAPI['workspace'],
      }),
    });

    await handleMCPRequest(
      makeRequest({
        id: 2,
        method: 'tools/call',
        params: {
          name: 'ptah_count_tokens',
          arguments: { file: 'D:/ws/src/a.ts' },
        },
      }),
      deps,
    );

    expect(read).toHaveBeenCalledWith(path.join('src', 'a.ts'));
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
        params: { name: 'ptah_agent_spawn', arguments: { cli: 'codex' } },
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

  it('returns -32602 Invalid params when tools/call params is missing', async () => {
    // Per JSON-RPC 2.0: missing/invalid params must surface as -32602, not the
    // generic -32603 Internal error that an uncaught destructure TypeError
    // would otherwise produce.
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({ id: 5, method: 'tools/call' }),
      deps,
    );

    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32602);
    expect(typeof res.error?.message).toBe('string');
    expect(res.error?.message).toMatch(/[Ii]nvalid params/);
  });

  it('returns -32602 Invalid params when tools/call params lacks a "name" string', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      makeRequest({
        id: 6,
        method: 'tools/call',
        // arguments present but no name — still invalid per JSON-RPC 2.0.
        params: { arguments: {} } as unknown as MCPRequest['params'],
      }),
      deps,
    );

    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toMatch(/[Ii]nvalid params/);
  });
});
