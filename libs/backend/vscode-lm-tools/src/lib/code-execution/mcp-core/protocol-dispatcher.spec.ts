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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { countTokensPiecewise } from '@ptah-extension/tool-output-reducers';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import {
  DEFAULT_TOOL_RESULT_BUDGET_CHARS,
  DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  getToolResultBudget,
} from './tool-result-budget';
import {
  formatBrowserContent,
  formatSearchFiles,
} from './mcp-response-formatter';
import {
  buildBrowserScreenshotTool,
  buildSearchFilesTool,
} from './tool-description.builder';
import { buildServerInstructions } from './server-instructions';
import {
  getCallerAgentId,
  getCallerSessionId,
  getCallerWorkspaceRoot,
} from './mcp-request-context';
import type {
  MCPRequest,
  MCPResponse,
  PtahAPI,
  SymbolIndexEntry,
} from '../types';
import { buildCodeNamespace } from '../namespace-builders/code-namespace.builder';
import {
  buildBrowserNamespace,
  type IBrowserCapabilities,
} from '../namespace-builders/browser-namespace.builder';
import {
  SYMBOL_INDEX_DEFAULT_LIMIT,
  SYMBOL_INDEX_MAX_LIMIT,
  pageSymbolIndex,
  type ParsedSymbolIndexQuery,
} from '../namespace-builders/symbol-index-query';
import {
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from '../namespace-builders/analysis-namespace.builders';
import type { ICodeSymbolReader } from '@ptah-extension/memory-contracts';
import { Result } from '@ptah-extension/shared';
import {
  DependencyGraphService,
  type AstAnalysisService,
  type CodeSymbolIndexer,
  type FileSystemService,
} from '@ptah-extension/workspace-intelligence';
import {
  AgentRoleError,
  CliCommandLineTooLongError,
  type AgentRoleErrorCode,
} from '@ptah-extension/cli-agent-runtime';

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
      instructions: string;
    };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo).toEqual({ name: 'ptah', version: '1.0.0' });
    expect(result.instructions).toBe(buildServerInstructions());
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

  // TASK_2026_559 Batch 15 r1 S1: the page is sized by the SAME test the
  // result budget applies, so the budget step never cuts inside a row.
  it('hands ptah_task_list the result-budget test so the page fits whole', async () => {
    const { tasks, deps } = buildTasksApi();

    await handleMCPRequest(
      makeRequest({
        id: 'call-list',
        method: 'tools/call',
        params: { name: 'ptah_task_list', arguments: { limit: 5 } },
      }),
      deps,
    );

    expect(tasks.list).toHaveBeenCalledTimes(1);
    const [args, options] = tasks.list.mock.calls[0] as [
      unknown,
      { fits?: (text: string) => boolean } | undefined,
    ];
    expect(args).toEqual({ limit: 5 });
    expect(typeof options?.fits).toBe('function');
    expect(options?.fits?.('{"ok":true}')).toBe(true);
    expect(options?.fits?.('x'.repeat(8_001))).toBe(false);
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
    // Only the result-budget declaration (Task 2f.2), no alwaysLoad.
    expect(executeCode?._meta).toEqual({
      'anthropic/maxResultSizeChars': 8000,
    });
  });

  it('does NOT mark non-eager tools (e.g. a browser tool) with alwaysLoad', async () => {
    const tools = await listTools();
    const browser = tools.find((t) => t.name === 'ptah_browser_navigate');
    expect(browser).toBeDefined();
    expect(isEager(browser)).toBe(false);
    expect(browser?._meta).toEqual({ 'anthropic/maxResultSizeChars': 8000 });
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

    // One more than the limit, to learn whether the result was capped.
    expect(findFiles).toHaveBeenCalledWith('**/*.ts', 11);
    const content = (
      res.result as { content: Array<{ type: string; text: string }> }
    ).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('a.ts');
    expect(content[0].text).toContain('b.ts');
  });

  // TASK_2026_559 Batch 20.2p: per-record JSON keys cost the promised saving.
  it('writes ptah_ast_analyze records as tables behind parse status and coverage', async () => {
    const analyze = jest.fn().mockResolvedValue({
      parseStatus: 'ok',
      errorNodeCount: 0,
      errorNodeCountCapped: false,
      coverage: { census: 'complete', analyzed: 1 },
      file: 'src/a.ts',
      language: 'typescript',
      functions: [
        { name: 'load', parameters: ['id'], startLine: 1, endLine: 4 },
        { name: 'save', parameters: [], startLine: 6, endLine: 9 },
      ],
      classes: [],
      imports: [{ source: 'node:path', importedSymbols: ['join'] }],
      exports: [{ name: 'load', kind: 'function' }],
    });
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        ast: { analyze } as unknown as PtahAPI['ast'],
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'ast-1',
        method: 'tools/call',
        params: { name: 'ptah_ast_analyze', arguments: { file: 'src/a.ts' } },
      }),
      deps,
    );

    expect(analyze).toHaveBeenCalledWith('src/a.ts', undefined);
    const content = (
      res.result as { content: Array<{ type: string; text: string }> }
    ).content;
    expect(content[0].text).toBe(
      '{"parseStatus":"ok","errorNodeCount":0,"errorNodeCountCapped":false,' +
        '"coverage":{"census":"complete","analyzed":1},"file":"src/a.ts",' +
        '"language":"typescript",' +
        '"functions":[["name","parameters","startLine","endLine"],["load",["id"],1,4],["save",[],6,9]],' +
        '"classes":[],"imports":[["source","importedSymbols"],["node:path",["join"]]],' +
        '"exports":[["name","kind"],["load","function"]]}',
    );
  });

  // TASK_2026_559 Batch 11: a capped search looked complete, and an empty
  // pattern reached the provider and came back as its thrown error.
  describe('ptah_search_files limit probe and argument validation', () => {
    const NOTICE_TAIL = 'narrow the pattern or raise limit)';

    async function searchFiles(
      args: Record<string, unknown>,
      findFiles: jest.Mock,
    ): Promise<{ text: string; isError: boolean | undefined }> {
      const deps = buildDeps({
        ptahAPI: buildPtahAPIStub({
          search: { findFiles } as unknown as PtahAPI['search'],
        }),
      });
      const res = await handleMCPRequest(
        makeRequest({
          id: 'sf',
          method: 'tools/call',
          params: { name: 'ptah_search_files', arguments: args },
        }),
        deps,
      );
      const result = res.result as {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
      return { text: result.content[0].text, isError: result.isError };
    }

    const files = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `src/f${i}.ts`);

    it('shows the first `limit` files and a notice when more matched', async () => {
      const findFiles = jest.fn().mockResolvedValue(files(4));

      const { text, isError } = await searchFiles(
        { pattern: '**/*.ts', limit: 3 },
        findFiles,
      );

      expect(isError).toBeFalsy();
      expect(findFiles).toHaveBeenCalledWith('**/*.ts', 4);
      expect(text).toContain(
        'Found: more than 3 files (showing first 3; narrow the pattern or raise limit)',
      );
      expect(text).toContain('src/f2.ts');
      expect(text).not.toContain('src/f3.ts');
    });

    it('applies the default limit of 50 through the same probe', async () => {
      const findFiles = jest.fn().mockResolvedValue(files(51));

      const { text } = await searchFiles({ pattern: '**/*' }, findFiles);

      expect(findFiles).toHaveBeenCalledWith('**/*', 51);
      expect(text).toContain('(showing first 50; ' + NOTICE_TAIL);
      expect(text).toContain('src/f49.ts');
      expect(text).not.toContain('src/f50.ts');
    });

    it('adds no notice when exactly `limit` files matched', async () => {
      const findFiles = jest.fn().mockResolvedValue(files(3));

      const { text } = await searchFiles(
        { pattern: '*.ts', limit: 3 },
        findFiles,
      );

      expect(text).toContain('Found: 3 files');
      expect(text).not.toContain(NOTICE_TAIL);
    });

    it('adds no notice under the limit', async () => {
      const findFiles = jest.fn().mockResolvedValue(files(2));

      const { text } = await searchFiles(
        { pattern: '*.ts', limit: 10 },
        findFiles,
      );

      expect(text).toContain('Found: 2 files');
      expect(text).not.toContain(NOTICE_TAIL);
    });

    it('caps a provider that ignores the requested maximum', async () => {
      const findFiles = jest.fn().mockResolvedValue(files(9));

      const { text } = await searchFiles(
        { pattern: '*.ts', limit: 2 },
        findFiles,
      );

      expect(text).toContain('(showing first 2; ' + NOTICE_TAIL);
      expect(text).not.toContain('src/f2.ts');
    });

    it('treats a null limit as the default', async () => {
      const findFiles = jest.fn().mockResolvedValue([]);

      await searchFiles({ pattern: '*.ts', limit: null }, findFiles);

      expect(findFiles).toHaveBeenCalledWith('*.ts', 51);
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '   \t'],
      ['a number', 42],
      ['missing', undefined],
    ])(
      'returns a tool error without calling the provider when the pattern is %s',
      async (_label, pattern) => {
        const findFiles = jest.fn().mockResolvedValue([]);

        const { text, isError } = await searchFiles({ pattern }, findFiles);

        expect(isError).toBe(true);
        expect(text).toBe(
          'Error: "pattern" is required and must be a non-empty string.',
        );
        expect(findFiles).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['zero', 0],
      ['negative', -5],
      ['a fraction', 2.5],
      ['NaN', Number.NaN],
      ['a numeric string', '10'],
    ])(
      'returns a tool error without calling the provider when the limit is %s',
      async (_label, limit) => {
        const findFiles = jest.fn().mockResolvedValue([]);

        const { text, isError } = await searchFiles(
          { pattern: '*.ts', limit },
          findFiles,
        );

        expect(isError).toBe(true);
        expect(text).toBe(
          `Error: "limit" must be an integer from 1 to ${Number.MAX_SAFE_INTEGER} (omit it for the default 50).`,
        );
        expect(findFiles).not.toHaveBeenCalled();
      },
    );

    // TASK_2026_559 Batch 11b (r1 M1): discovery published `limit` as any
    // number, so 0, -1 and 2.5 passed the schema and failed the handler.
    it('advertises exactly the limits the handler accepts, and its default', async () => {
      const schema = buildSearchFilesTool().inputSchema.properties['limit'] as {
        type?: unknown;
        minimum?: unknown;
        maximum?: unknown;
        default?: unknown;
      };
      const schemaAccepts = (value: number): boolean =>
        (schema.type === 'integer'
          ? Number.isInteger(value)
          : schema.type === 'number') &&
        (typeof schema.minimum !== 'number' || value >= schema.minimum) &&
        (typeof schema.maximum !== 'number' || value <= schema.maximum);

      for (const limit of [
        1,
        2,
        50,
        10_000,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
        1e20,
        0,
        -1,
        -50,
        0.5,
        2.5,
      ]) {
        const findFiles = jest.fn().mockResolvedValue([]);
        const { isError } = await searchFiles(
          { pattern: '*.ts', limit },
          findFiles,
        );
        const handlerAccepts = !isError && findFiles.mock.calls.length === 1;
        expect({ limit, accepted: schemaAccepts(limit) }).toEqual({
          limit,
          accepted: handlerAccepts,
        });
      }

      const findFiles = jest.fn().mockResolvedValue([]);
      await searchFiles({ pattern: '*.ts' }, findFiles);
      expect(schema.default).toBe(50);
      expect(findFiles).toHaveBeenCalledWith(
        '*.ts',
        Number(schema.default) + 1,
      );
    });
  });

  it('builds the dependency graph from ABSOLUTE paths and resolves a relative query arg', async () => {
    const root = path.resolve('/ws');
    let built = false;
    const isBuilt = jest.fn(async () => built);
    // A small workspace: the build ends inside the bounded wait, so the first
    // call is answered.
    const buildGraph = jest.fn(async () => {
      built = true;
      return { nodeCount: 2 };
    });
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
          getGraphCoverageForFile: jest.fn().mockResolvedValue(undefined),
          reserveGraphBuild: jest.fn(() => 1),
          getGraphBuildState: jest.fn(() => ({
            generation: 1,
            building: false,
          })),
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
      2,
      { yieldToForeground: true, generation: 1 },
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
          getGraphCoverageForFile: jest.fn().mockResolvedValue(undefined),
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

  // Batch 9 revision round 1 (review F3, User Decision 14): the 5,000-file
  // graph cap is disclosed instead of looking like a complete answer.
  it('discovers every source file, graphs the first 5,000 and passes the discovered count', async () => {
    const root = path.resolve('/ws');
    const discovered = Array.from(
      { length: 5_354 },
      (_, i) => `src/file-${String(i).padStart(4, '0')}.ts`,
    );
    const findFiles = jest.fn().mockResolvedValue(discovered);
    const buildGraph = jest.fn().mockResolvedValue({ nodeCount: 5_000 });
    await handleMCPRequest(
      makeRequest({
        id: 'b9-cap',
        method: 'tools/call',
        params: { name: 'ptah_get_dependents', arguments: { file: 'a.ts' } },
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          workspace: {
            getInfo: jest.fn().mockResolvedValue({ path: root }),
          } as unknown as PtahAPI['workspace'],
          search: { findFiles } as unknown as PtahAPI['search'],
          dependencies: {
            isBuilt: jest.fn().mockResolvedValue(false),
            buildGraph,
            getDependents: jest.fn().mockResolvedValue([]),
            getGraphCoverageForFile: jest.fn().mockResolvedValue(undefined),
            reserveGraphBuild: jest.fn(() => 1),
            getGraphBuildState: jest.fn(() => ({
              generation: 1,
              building: false,
            })),
          } as unknown as PtahAPI['dependencies'],
        }),
      }),
    );

    // Discovery is not capped (the cap bounds parsing, not listing).
    expect(findFiles.mock.calls[0][1]).toBeGreaterThan(5_354);
    const [files, graphRoot, discoveredCount] = buildGraph.mock.calls[0];
    expect(files).toHaveLength(5_000);
    expect(files[4_999]).toBe(path.join(root, 'src/file-4999.ts'));
    expect(graphRoot).toBe(root);
    expect(discoveredCount).toBe(5_354);
  });

  describe.each([
    ['ptah_get_dependents', 'getDependents', 'dependents'],
    ['ptah_get_dependencies', 'getDependencies', 'dependencies'],
  ])('%s graph completeness', (toolName, method, listField) => {
    const root = path.resolve('/ws');

    async function call(
      coverage: { graphedFiles: number; discoveredFiles: number } | undefined,
    ): Promise<{
      body: Record<string, unknown>;
      getGraphCoverageForFile: jest.Mock;
    }> {
      const getGraphCoverageForFile = jest.fn().mockResolvedValue(coverage);
      const res = await handleMCPRequest(
        makeRequest({
          id: `b9-${toolName}`,
          method: 'tools/call',
          params: { name: toolName, arguments: { file: 'src/a.ts' } },
        }),
        buildDeps({
          ptahAPI: buildPtahAPIStub({
            workspace: {
              getInfo: jest.fn().mockResolvedValue({ path: root }),
            } as unknown as PtahAPI['workspace'],
            dependencies: {
              isBuilt: jest.fn().mockResolvedValue(true),
              [method]: jest.fn().mockResolvedValue([]),
              getGraphCoverageForFile,
            } as unknown as PtahAPI['dependencies'],
          }),
        }),
      );
      const result = res.result as {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
      expect(result.isError).not.toBe(true);
      return {
        body: JSON.parse(result.content[0].text) as Record<string, unknown>,
        getGraphCoverageForFile,
      };
    }

    it('adds no completeness fields when the graph covers every discovered file', async () => {
      const { body, getGraphCoverageForFile } = await call({
        graphedFiles: 120,
        discoveredFiles: 120,
      });
      expect(getGraphCoverageForFile).toHaveBeenCalledWith(
        path.join(root, 'src/a.ts'),
      );
      expect(body).toEqual({
        file: path.join(root, 'src/a.ts'),
        [listField]: [],
        count: 0,
      });
    });

    it('adds no completeness fields when no graph coverage is known', async () => {
      const { body } = await call(undefined);
      expect(body).not.toHaveProperty('incomplete');
      expect(body).not.toHaveProperty('graphedFiles');
    });

    it('says incomplete, with both counts, when the cap dropped files', async () => {
      const { body } = await call({
        graphedFiles: 5_000,
        discoveredFiles: 5_354,
      });
      expect(body).toMatchObject({
        [listField]: [],
        count: 0,
        incomplete: true,
        graphedFiles: 5_000,
        discoveredFiles: 5_354,
      });
    });
  });

  // Round 2 review R2-B1: the coverage reported is that of the graph which
  // answered the query, not the session root's. Real graph service and
  // namespace; only the parser and file reads are stubbed.
  describe.each([['ptah_get_dependents'], ['ptah_get_dependencies']])(
    '%s coverage of the answering graph',
    (toolName) => {
      const rootA = path.resolve('/ws-a');
      const rootB = path.resolve('/ws-b');
      const nested = path.join(rootA, 'pkg');

      function realGraph(): DependencyGraphService {
        return new DependencyGraphService(
          {
            analyzeSource: jest.fn(async () =>
              Result.ok({
                imports: [],
                exports: [],
                functions: [],
                classes: [],
              }),
            ),
          } as unknown as AstAnalysisService,
          {
            readFile: jest.fn(async () => 'source'),
          } as unknown as FileSystemService,
          asLogger(createMockLogger()),
        );
      }

      async function query(
        graph: DependencyGraphService,
        file: string,
      ): Promise<Record<string, unknown>> {
        const dependencies = buildDependencyNamespace({
          dependencyGraph: graph,
          workspaceProvider: { getWorkspaceRoot: () => rootA },
        } as unknown as AnalysisNamespaceDependencies);
        const res = await handleMCPRequest(
          makeRequest({
            id: `b9-r2-${toolName}`,
            method: 'tools/call',
            params: { name: toolName, arguments: { file } },
          }),
          buildDeps({
            ptahAPI: buildPtahAPIStub({
              // The session root is A throughout.
              workspace: {
                getInfo: jest.fn().mockResolvedValue({ path: rootA }),
              } as unknown as PtahAPI['workspace'],
              dependencies,
            }),
          }),
        );
        const result = res.result as {
          content: Array<{ text: string }>;
          isError?: boolean;
        };
        expect(result.isError).not.toBe(true);
        return JSON.parse(result.content[0].text) as Record<string, unknown>;
      }

      it("reports root B's cap for a file under B while the session root A is complete", async () => {
        const graph = realGraph();
        await graph.buildGraph([path.join(rootA, 'a.ts')], rootA);
        await graph.buildGraph(
          [path.join(rootB, 'b.ts')],
          rootB,
          undefined,
          5_001,
        );
        const body = await query(graph, path.join(rootB, 'b.ts'));
        expect(body).toMatchObject({
          incomplete: true,
          graphedFiles: 1,
          discoveredFiles: 5_001,
        });
      });

      it('reports no cap for a complete root B while the session root A is capped', async () => {
        const graph = realGraph();
        await graph.buildGraph(
          [path.join(rootA, 'a.ts')],
          rootA,
          undefined,
          7_000,
        );
        await graph.buildGraph([path.join(rootB, 'b.ts')], rootB);
        const body = await query(graph, path.join(rootB, 'b.ts'));
        expect(body).not.toHaveProperty('incomplete');
        expect(body).not.toHaveProperty('graphedFiles');
        expect(body).not.toHaveProperty('discoveredFiles');
      });

      it('reports the nested root for a file under it, and the outer root elsewhere', async () => {
        const graph = realGraph();
        await graph.buildGraph([path.join(rootA, 'a.ts')], rootA);
        await graph.buildGraph(
          [path.join(nested, 'x.ts')],
          nested,
          undefined,
          9,
        );
        expect(await query(graph, path.join(nested, 'x.ts'))).toMatchObject({
          incomplete: true,
          graphedFiles: 1,
          discoveredFiles: 9,
        });
        expect(await query(graph, path.join(rootA, 'a.ts'))).not.toHaveProperty(
          'incomplete',
        );
      });
    },
  );

  // Round 2 review R2-S1: a list over the result budget is cut, but the
  // completeness fields come before it and survive the cut.
  describe.each([
    ['ptah_get_dependents', 'getDependents'],
    ['ptah_get_dependencies', 'getDependencies'],
  ])('%s completeness through the result budget', (toolName, method) => {
    let spoolRoot: string;

    beforeEach(() => {
      spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b9-r2-'));
    });

    afterEach(() => {
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    });

    it.each([
      ['the full output is saved', false],
      ['the full output cannot be saved', true],
    ])(
      'keeps incomplete and both counts when %s',
      async (_label, failSpool) => {
        if (failSpool) {
          // A file where the spool directory's parent must be: the save fails.
          fs.writeFileSync(path.join(spoolRoot, '.ptah'), 'not a directory');
        }
        const list = Array.from(
          { length: 1_500 },
          (_, i) => `C:/ws/lib/module-${i}.ts`,
        );
        const res = await handleMCPRequest(
          makeRequest({
            id: `b9-r2-budget-${toolName}`,
            method: 'tools/call',
            params: { name: toolName, arguments: { file: 'C:/ws/lib/hub.ts' } },
            _callerWorkspaceRoot: spoolRoot,
          }),
          buildDeps({
            workspaceProvider: knownFolders(spoolRoot),
            ptahAPI: buildPtahAPIStub({
              workspace: {
                getInfo: jest.fn().mockResolvedValue({ path: 'C:/ws' }),
              } as unknown as PtahAPI['workspace'],
              dependencies: {
                isBuilt: jest.fn().mockResolvedValue(true),
                [method]: jest.fn().mockResolvedValue(list),
                getGraphCoverageForFile: jest.fn().mockResolvedValue({
                  graphedFiles: 5_000,
                  discoveredFiles: 6_000,
                }),
              } as unknown as PtahAPI['dependencies'],
            }),
          }),
        );
        const text = (res.result as { content: Array<{ text: string }> })
          .content[0].text;

        // The list was cut to the budget...
        expect(text.length).toBeLessThanOrEqual(
          getToolResultBudget(toolName).chars,
        );
        expect(text).not.toContain('module-1499.ts');
        // ...and the completeness fields were not.
        expect(text).toMatch(/"count":\s*1500/);
        expect(text).toMatch(/"incomplete":\s*true/);
        expect(text).toMatch(/"graphedFiles":\s*5000/);
        expect(text).toMatch(/"discoveredFiles":\s*6000/);
      },
    );

    // Round 3 review: a query path long enough to use the token budget on its
    // own must not push the completeness fields out of the cut.
    it('keeps incomplete and both counts ahead of a very long query path', async () => {
      const longFile = `C:/ws/${'deepabc/'.repeat(810)}hub.ts`;
      const res = await handleMCPRequest(
        makeRequest({
          id: `b9-r3-long-path-${toolName}`,
          method: 'tools/call',
          params: { name: toolName, arguments: { file: longFile } },
          _callerWorkspaceRoot: spoolRoot,
        }),
        buildDeps({
          workspaceProvider: knownFolders(spoolRoot),
          ptahAPI: buildPtahAPIStub({
            workspace: {
              getInfo: jest.fn().mockResolvedValue({ path: 'C:/ws' }),
            } as unknown as PtahAPI['workspace'],
            dependencies: {
              isBuilt: jest.fn().mockResolvedValue(true),
              [method]: jest
                .fn()
                .mockResolvedValue(['C:/ws/lib/a.ts', 'C:/ws/lib/b.ts']),
              getGraphCoverageForFile: jest.fn().mockResolvedValue({
                graphedFiles: 5_000,
                discoveredFiles: 6_000,
              }),
            } as unknown as PtahAPI['dependencies'],
          }),
        }),
      );
      const text = (res.result as { content: Array<{ text: string }> })
        .content[0].text;

      expect(text.length).toBeLessThanOrEqual(
        getToolResultBudget(toolName).chars,
      );
      expect(text).toMatch(/"count":\s*2/);
      expect(text).toMatch(/"incomplete":\s*true/);
      expect(text).toMatch(/"graphedFiles":\s*5000/);
      expect(text).toMatch(/"discoveredFiles":\s*6000/);
    });
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

  it('ptah_get_diagnostics passes the files scope to the namespace and formats its payload: requested first, siblings capped (TASK_2026_559)', async () => {
    const requested = 'D:/ws/libs/a/src/changed.ts';
    const sibling = 'D:/ws/libs/a/src/other.ts';
    const diagnostics = [
      ...Array.from({ length: 120 }, (_, i) => ({
        file: sibling,
        line: i + 1,
        severity: 'error',
        message: `sibling-${i} broken`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        file: requested,
        line: i + 1,
        severity: 'error',
        message: `requested-${i} broken`,
      })),
    ];
    // The namespace returns the scope it resolved against the session root;
    // the formatter reads it from the payload, not from the tool arguments.
    const getErrors = jest.fn().mockResolvedValue({
      status: 'available',
      source: 'typescript-compiler',
      diagnostics,
      requestedFiles: [requested],
    });
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        diagnostics: { getErrors } as unknown as PtahAPI['diagnostics'],
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'diag-1',
        method: 'tools/call',
        params: {
          name: 'ptah_get_diagnostics',
          arguments: { severity: 'error', files: [requested] },
        },
      }),
      deps,
    );

    expect(getErrors).toHaveBeenCalledWith([requested]);
    const text = (res.result as { content: Array<{ text: string }> }).content[0]
      .text;
    for (let i = 0; i < 3; i++) {
      expect(text).toContain(`requested-${i} broken`);
    }
    expect(text).toContain('**Errors:** 123');
    expect(text).toContain(
      'Shown 50 of 123 (3 in requested files, 73 in sibling files omitted)',
    );
    expect(text.indexOf('requested-0 broken')).toBeLessThan(
      text.indexOf('sibling-0 broken'),
    );
    expect(text.length).toBeLessThanOrEqual(8000);
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
    expect(result.content[0].text).toMatch(
      /invalid ptah_agent_spawn arguments — task: .*Required: "task"/,
    );
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
// tools/call — ptah_web_search argument validation (F6 regression)
//
// The `providers` override is the re-assessment path. An invalid value must be
// an MCP tool ERROR, never a silent fallback to a different provider set: a
// discarded override is invisible to the agent, so the retry would run the very
// provider that had just failed.
// ---------------------------------------------------------------------------

describe('protocol-handlers › ptah_web_search argument validation', () => {
  function buildWebSearchDeps(): {
    deps: ProtocolHandlerDependencies;
    search: jest.Mock;
  } {
    const search = jest.fn().mockResolvedValue({
      query: 'q',
      summary: 's',
      providers: ['serper'],
      status: 'ok',
      durationMs: 10,
      results: [],
      resultCount: 0,
      outcomes: [
        { provider: 'serper', status: 'ok', durationMs: 10, resultCount: 0 },
      ],
    });
    return {
      search,
      deps: buildDeps({
        ptahAPI: buildPtahAPIStub({
          webSearch: { search } as unknown as PtahAPI['webSearch'],
        }),
      }),
    };
  }

  function callWebSearch(
    deps: ProtocolHandlerDependencies,
    args: unknown,
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: 'ws-1',
        method: 'tools/call',
        params: { name: 'ptah_web_search', arguments: args },
      }),
      deps,
    );
  }

  function asToolResult(res: MCPResponse): {
    content: Array<{ text: string }>;
    isError?: boolean;
  } {
    return res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
  }

  it('forwards a valid providers override to webSearch.search', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, {
      query: 'nx docs',
      providers: ['serper', 'exa'],
      maxResults: 3,
    });

    expect(asToolResult(res).isError).toBeUndefined();
    expect(search).toHaveBeenCalledWith('nx docs', {
      maxResults: 3,
      timeout: undefined,
      providers: ['serper', 'exa'],
    });
  });

  it('rejects a string providers value instead of silently running tavily', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, { query: 'q', providers: 'serper' });

    const result = asToolResult(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid ptah_web_search arguments/);
    expect(result.content[0].text).toMatch(/providers/);
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider name', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, { query: 'q', providers: ['bing'] });

    expect(asToolResult(res).isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects an empty providers array', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, { query: 'q', providers: [] });

    expect(asToolResult(res).isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('reports the singular "provider" key rather than dropping it', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, { query: 'q', provider: 'serper' });

    const result = asToolResult(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/provider/);
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects a missing query', async () => {
    const { deps, search } = buildWebSearchDeps();

    const res = await callWebSearch(deps, { providers: ['serper'] });

    expect(asToolResult(res).isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('reports an absent web search service as a tool error', async () => {
    const deps = buildDeps();

    const res = await callWebSearch(deps, { query: 'q' });

    const result = asToolResult(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Web search service not available/);
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

// ---------------------------------------------------------------------------
// tools/call — request-scoped caller identity (TASK_2026_364, Batch A)
// ---------------------------------------------------------------------------

describe('protocol-handlers › tools/call caller identity context', () => {
  it('runs the tool inside a context carrying BOTH identity fields', async () => {
    let seenSession: string | undefined;
    let seenWorkspace: string | undefined;
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        tasks: {
          check: jest.fn(async () => {
            seenSession = getCallerSessionId();
            seenWorkspace = getCallerWorkspaceRoot();
            return { ok: true };
          }),
        },
      }),
    });

    const res = await handleMCPRequest(
      makeRequest({
        id: 'ctx-1',
        method: 'tools/call',
        params: { name: 'ptah_task_check', arguments: {} },
        _callerSessionId: 'sess-A',
        _callerWorkspaceRoot: 'D:\\projects\\ptah-extension',
      }),
      deps,
    );

    expect(res.error).toBeUndefined();
    expect(seenSession).toBe('sess-A');
    expect(seenWorkspace).toBe('D:\\projects\\ptah-extension');
  });

  it('leaves both identity fields undefined for an anonymous call', async () => {
    let seenSession: string | undefined;
    let seenWorkspace: string | undefined;
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        tasks: {
          check: jest.fn(async () => {
            seenSession = getCallerSessionId();
            seenWorkspace = getCallerWorkspaceRoot();
            return { ok: true };
          }),
        },
      }),
    });

    await handleMCPRequest(
      makeRequest({
        id: 'ctx-2',
        method: 'tools/call',
        params: { name: 'ptah_task_check', arguments: {} },
      }),
      deps,
    );

    expect(seenSession).toBeUndefined();
    expect(seenWorkspace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tools/call — ptah_agent_message and ptah_agent_report (TASK_2026_402)
//
// Both schemas are `.strict()` for the same reason `WebSearchArgsSchema` is: a
// dropped argument is invisible to the calling agent, an error is not. And
// `ptah_agent_report` takes no `agentId` — accepting one would let any agent
// report as any other agent.
// ---------------------------------------------------------------------------

function agentToolResult(res: MCPResponse): {
  text: string;
  isError?: boolean;
} {
  const result = res.result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: result.content[0].text, isError: result.isError };
}

describe('protocol-handlers › ptah_agent_message', () => {
  it('is advertised on tools/list', async () => {
    const names = listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'am-list', method: 'tools/list' }),
        buildDeps(),
      ),
    );
    expect(names).toContain('ptah_agent_message');
    expect(names).toContain('ptah_agent_report');
    expect(names).not.toContain('ptah_agent_steer');
  });

  it('delegates to agent.message and renders the reported mode', async () => {
    const message = jest
      .fn()
      .mockResolvedValue({ mode: 'interrupt-resume', detail: 'turn aborted' });
    const res = await handleMCPRequest(
      makeRequest({
        id: 'am-1',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_message',
          arguments: { agentId: 'a-1', message: 'use the other branch' },
        },
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { message } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(message).toHaveBeenCalledWith('a-1', 'use the other branch');
    const { text, isError } = agentToolResult(res);
    expect(isError).toBeUndefined();
    expect(text).toMatch(/Mode:\*\* interrupt-resume/);
    expect(text).toMatch(/DISCARDED/);
  });

  it('ERRORS on the retired `instruction` key rather than dropping it', async () => {
    const message = jest.fn();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'am-2',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_message',
          arguments: { agentId: 'a-1', instruction: 'go' },
        },
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { message } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(message).not.toHaveBeenCalled();
    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toMatch(/invalid ptah_agent_message arguments/);
    expect(text).toMatch(/instruction/);
  });
});

describe('protocol-handlers › ptah_agent_report', () => {
  it('takes its caller identity from the URL, never from the arguments', async () => {
    const report = jest
      .fn()
      .mockResolvedValue({ delivered: true, parentSessionId: 'sess-9' });
    const res = await handleMCPRequest(
      makeRequest({
        id: 'ar-1',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_report',
          arguments: { message: 'blocked on credentials', summary: 'blocked' },
        },
        _callerAgentId: 'agent-from-url',
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { report } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(report).toHaveBeenCalledWith({
      agentId: 'agent-from-url',
      message: 'blocked on credentials',
      summary: 'blocked',
    });
    expect(agentToolResult(res).text).toMatch(/Report Delivered/);
  });

  it('REJECTS a sender-supplied agentId', async () => {
    const report = jest.fn();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'ar-2',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_report',
          arguments: { agentId: 'someone-else', message: 'not mine' },
        },
        _callerAgentId: 'agent-from-url',
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { report } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(report).not.toHaveBeenCalled();
    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toMatch(/There is no "agentId" argument/);
  });

  it('refuses with unattributed-caller when the URL named no agent', async () => {
    const report = jest.fn();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'ar-3',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_report',
          arguments: { message: 'blocked' },
        },
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { report } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(report).not.toHaveBeenCalled();
    const { text } = agentToolResult(res);
    expect(text).toMatch(/Report NOT Delivered/);
    expect(text).toMatch(/unattributed-caller/);
  });

  it.each(['', '   '])(
    'refuses with unattributed-caller when the URL agent id is %j (empty/whitespace is absent)',
    async (agentId) => {
      const report = jest.fn();
      const res = await handleMCPRequest(
        makeRequest({
          id: 'ar-blank',
          method: 'tools/call',
          params: {
            name: 'ptah_agent_report',
            arguments: { message: 'blocked' },
          },
          _callerAgentId: agentId,
        }),
        buildDeps({
          ptahAPI: buildPtahAPIStub({
            agent: { report } as unknown as PtahAPI['agent'],
          }),
        }),
      );

      expect(report).not.toHaveBeenCalled();
      expect(agentToolResult(res).text).toMatch(/unattributed-caller/);
    },
  );

  it('never attributes a report to the caller session when no agent is named', async () => {
    const report = jest.fn();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'ar-session',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_report',
          arguments: { message: 'blocked' },
        },
        _callerSessionId: 'tab-abc',
        _callerWorkspaceRoot: 'D:\\ws-A',
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { report } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(report).not.toHaveBeenCalled();
    expect(agentToolResult(res).text).toMatch(/unattributed-caller/);
  });

  it('renders a router refusal as a refusal, not a success', async () => {
    const report = jest
      .fn()
      .mockResolvedValue({ delivered: false, reason: 'rate-limited' });
    const res = await handleMCPRequest(
      makeRequest({
        id: 'ar-4',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_report',
          arguments: { message: 'again' },
        },
        _callerAgentId: 'a-1',
      }),
      buildDeps({
        ptahAPI: buildPtahAPIStub({
          agent: { report } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    const { text } = agentToolResult(res);
    expect(text).toMatch(/Report NOT Delivered/);
    expect(text).toMatch(/Reason:\*\* rate-limited/);
  });
});

const ROLE_ERROR_CODES: readonly AgentRoleErrorCode[] = [
  'invalid_role_name',
  'no_roles',
  'unknown_role',
  'empty_role',
  'role_too_large',
  'role_read_failed',
  'no_workspace',
];

function spawnRequest(args: unknown): MCPRequest {
  return makeRequest({
    id: 'as-1',
    method: 'tools/call',
    params: { name: 'ptah_agent_spawn', arguments: args },
  });
}

function spawnDeps(spawn: jest.Mock): ProtocolHandlerDependencies {
  return buildDeps({
    ptahAPI: buildPtahAPIStub({
      agent: { spawn } as unknown as PtahAPI['agent'],
    }),
  });
}

describe('protocol-handlers › ptah_agent_spawn shared schema', () => {
  const spawned = {
    agentId: 'a-9',
    cli: 'codex',
    status: 'running',
    startedAt: '2026-09-13T00:00:00Z',
  };

  it('forwards role and renders how it was delivered', async () => {
    const spawn = jest.fn().mockResolvedValue({
      ...spawned,
      role: 'reviewer',
      roleDelivery: 'preamble',
      roleChannel: 'developer-instructions',
    });

    const res = await handleMCPRequest(
      spawnRequest({ task: 'Review', cli: 'codex', role: 'reviewer' }),
      spawnDeps(spawn),
    );

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Review',
        cli: 'codex',
        role: 'reviewer',
      }),
    );
    const { text, isError } = agentToolResult(res);
    expect(isError).toBeUndefined();
    expect(text).toMatch(
      /\*\*Role:\*\* reviewer \(preamble via developer-instructions\)/,
    );
  });

  it('logs the requested role', async () => {
    const logger = createMockLogger();
    const spawn = jest.fn().mockResolvedValue(spawned);

    await handleMCPRequest(
      spawnRequest({ task: 'Review', role: 'architect' }),
      buildDeps({
        logger: asLogger(logger),
        ptahAPI: buildPtahAPIStub({
          agent: { spawn } as unknown as PtahAPI['agent'],
        }),
      }),
    );

    expect(logger.info).toHaveBeenCalledWith(
      '[MCP] ptah_agent_spawn invoked',
      'CodeExecutionMCP',
      expect.objectContaining({ role: 'architect' }),
    );
  });

  it('REJECTS an unknown key instead of dropping it', async () => {
    const spawn = jest.fn();

    const res = await handleMCPRequest(
      spawnRequest({ task: 'Review', roleDefinition: { name: 'x' } }),
      spawnDeps(spawn),
    );

    expect(spawn).not.toHaveBeenCalled();
    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toMatch(/invalid ptah_agent_spawn arguments/);
    expect(text).toMatch(/roleDefinition/);
  });

  it('REJECTS a cli outside the shipped adapter set', async () => {
    const spawn = jest.fn();

    const res = await handleMCPRequest(
      spawnRequest({ task: 'Review', cli: 'aider' }),
      spawnDeps(spawn),
    );

    expect(spawn).not.toHaveBeenCalled();
    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toMatch(/cli:/);
  });

  it('REJECTS a task over the 100 KiB ceiling', async () => {
    const spawn = jest.fn();

    const res = await handleMCPRequest(
      spawnRequest({ task: 'x'.repeat(100 * 1024 + 1) }),
      spawnDeps(spawn),
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(agentToolResult(res).isError).toBe(true);
  });

  it.each([...ROLE_ERROR_CODES])(
    'surfaces AgentRoleError %s as a tool error naming the code',
    async (code) => {
      const spawn = jest
        .fn()
        .mockRejectedValue(
          new AgentRoleError(code, `role failed with ${code}`),
        );

      const res = await handleMCPRequest(
        spawnRequest({ task: 'Review', role: 'reviewer' }),
        spawnDeps(spawn),
      );

      const { text, isError } = agentToolResult(res);
      expect(isError).toBe(true);
      expect(text).toBe(
        `Error: ptah_agent_spawn role ${code}: role failed with ${code}`,
      );
    },
  );

  it('surfaces CliCommandLineTooLongError with the measured size and limit', async () => {
    const spawn = jest
      .fn()
      .mockRejectedValue(
        new CliCommandLineTooLongError(9_000, 8_191, 2, 8_500, 'UTF-16 units'),
      );

    const res = await handleMCPRequest(
      spawnRequest({ task: 'Review', role: 'reviewer' }),
      spawnDeps(spawn),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toMatch(
      /command line too long \(9000 against a limit of 8191\)/,
    );
  });

  it('keeps the generic failure path for any other spawn error', async () => {
    const spawn = jest.fn().mockRejectedValue(new Error('no slot'));

    const res = await handleMCPRequest(
      spawnRequest({ task: 'Review' }),
      spawnDeps(spawn),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toBe('Tool ptah_agent_spawn failed: no slot');
  });
});

describe('protocol-handlers › ptah_agent_list roles', () => {
  const agents = [
    {
      cli: 'codex',
      installed: true,
      messagingMode: 'steer',
      roleDelivery: 'preamble',
      roleChannel: 'developer-instructions',
    },
  ];

  function listDeps(
    listRoles: jest.Mock,
    logger: MockLogger = createMockLogger(),
    list: jest.Mock = jest.fn().mockResolvedValue(agents),
  ): ProtocolHandlerDependencies {
    return buildDeps({
      logger: asLogger(logger),
      ptahAPI: buildPtahAPIStub({
        agent: { list, listRoles } as unknown as PtahAPI['agent'],
      }),
    });
  }

  const listRequest = makeRequest({
    id: 'al-1',
    method: 'tools/call',
    params: { name: 'ptah_agent_list', arguments: {} },
  });

  it('renders the workspace roles', async () => {
    const res = await handleMCPRequest(
      listRequest,
      listDeps(jest.fn().mockResolvedValue(['architect', 'reviewer'])),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBeUndefined();
    expect(text).toMatch(/Roles in this workspace: architect, reviewer/);
    expect(text).toMatch(/role delivery: preamble\/developer-instructions/);
  });

  it('says no roles were generated when there are none', async () => {
    const res = await handleMCPRequest(
      listRequest,
      listDeps(jest.fn().mockResolvedValue([])),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBeUndefined();
    expect(text).toMatch(/No agent roles generated for this workspace/);
  });

  it('still lists agents and logs a warning when listRoles rejects', async () => {
    const logger = createMockLogger();
    const res = await handleMCPRequest(
      listRequest,
      listDeps(
        jest
          .fn()
          .mockRejectedValue(
            new AgentRoleError('no_workspace', 'no workspace is open'),
          ),
        logger,
      ),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBeUndefined();
    expect(text).toMatch(/\*\*Total:\*\* 1/);
    expect(text).toMatch(/No agent roles generated for this workspace/);
    expect(logger.warn).toHaveBeenCalledWith(
      '[MCP] ptah_agent_list could not list roles',
      'CodeExecutionMCP',
      { error: 'no workspace is open' },
    );
  });

  it('keeps the agent.list failure path unchanged', async () => {
    const listRoles = jest.fn().mockResolvedValue([]);
    const res = await handleMCPRequest(
      listRequest,
      listDeps(
        listRoles,
        createMockLogger(),
        jest.fn().mockRejectedValue(new Error('detection exploded')),
      ),
    );

    const { text, isError } = agentToolResult(res);
    expect(isError).toBe(true);
    expect(text).toBe('Tool ptah_agent_list failed: detection exploded');
    expect(listRoles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tools/list + tools/call — ptah_surface_update / ptah_surface_get_state
// (TASK_2026_538, Task 13.3). Scope comes ONLY from the request context the
// dispatcher establishes (`_callerSessionId` -> `runWithMcpRequestContext`);
// a session or tab id inside the tool arguments is forwarded untouched to the
// namespace's strict validator and never becomes the caller.
// ---------------------------------------------------------------------------

describe('protocol-handlers › surface tools', () => {
  const SURFACE_TOOLS = ['ptah_surface_update', 'ptah_surface_get_state'];

  function surfaceDeps(surface: { update?: jest.Mock; getState?: jest.Mock }) {
    return buildDeps({ ptahAPI: buildPtahAPIStub({ surface }) });
  }

  function callSurface(
    name: string,
    args: Record<string, unknown>,
    deps: ProtocolHandlerDependencies,
    callerSessionId?: string,
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: 'surface-7',
        method: 'tools/call',
        params: { name, arguments: args },
        ...(callerSessionId ? { _callerSessionId: callerSessionId } : {}),
      }),
      deps,
    );
  }

  it('lists both tools even when every namespace toggle is off', async () => {
    const res = await handleMCPRequest(
      makeRequest({ id: 'surface-list', method: 'tools/list' }),
      buildDeps({
        disabledMcpNamespaces: [
          'ide',
          'agent',
          'git',
          'json',
          'browser',
          'harness',
          'code',
          'dashboard',
          'surface',
        ],
      }),
    );
    const names = (res.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name,
    );
    for (const name of SURFACE_TOOLS) expect(names).toContain(name);
  });

  it('passes a scoped caller from the request context, not from the arguments', async () => {
    let seenInside: string | undefined;
    const update = jest.fn(async () => {
      seenInside = getCallerSessionId();
      return {
        status: 'accepted' as const,
        surfaceId: 'profile',
        revision: 1,
        text: 'Profile',
        delivery: { status: 'delivered' as const, surfaces: 1 },
      };
    });
    const args = { operation: 'create', surface: {}, sessionId: 'forged' };

    const { text, isError } = agentToolResult(
      await callSurface(
        'ptah_surface_update',
        args,
        surfaceDeps({ update }),
        'tab-a',
      ),
    );

    expect(update).toHaveBeenCalledWith(args, {
      sessionId: 'tab-a',
      toolCallId: 'surface-7',
    });
    expect(seenInside).toBe('tab-a');
    expect(isError).toBeUndefined();
    expect(text).toContain('committed at revision 1');
  });

  it('passes an anonymous caller when the request carries no session', async () => {
    const update = jest.fn(async () => ({
      status: 'render-only' as const,
      text: 'no interactive surface is attached',
    }));
    const getState = jest.fn(async () => ({
      status: 'not-found' as const,
      text: 'no surface state for this caller',
    }));
    const deps = surfaceDeps({ update, getState });

    const rendered = agentToolResult(
      await callSurface('ptah_surface_update', { tabId: 'tab-b' }, deps),
    );
    const read = agentToolResult(
      await callSurface('ptah_surface_get_state', { sessionId: 'tab-b' }, deps),
    );

    expect(update).toHaveBeenCalledWith(
      { tabId: 'tab-b' },
      { sessionId: undefined, toolCallId: 'surface-7' },
    );
    expect(getState).toHaveBeenCalledWith(
      { sessionId: 'tab-b' },
      { sessionId: undefined, toolCallId: 'surface-7' },
    );
    expect(rendered).toEqual({
      text: 'no interactive surface is attached',
      isError: undefined,
    });
    expect(read).toEqual({
      text: 'no surface state for this caller',
      isError: undefined,
    });
  });

  it('routes get_state with a scoped caller and maps failures to tool errors', async () => {
    const getState = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'found',
        text: 'State of profile',
        truncated: false,
        omittedSurfaceIds: [],
      })
      .mockResolvedValueOnce({ status: 'rejected', reason: 'bad view' })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'surface state unavailable on this host',
      });
    const deps = surfaceDeps({ getState });

    const found = agentToolResult(
      await callSurface('ptah_surface_get_state', {}, deps, 'tab-a'),
    );
    const rejected = agentToolResult(
      await callSurface('ptah_surface_get_state', { view: 'x' }, deps, 'tab-a'),
    );
    const unavailable = agentToolResult(
      await callSurface('ptah_surface_get_state', {}, deps, 'tab-a'),
    );

    expect(getState).toHaveBeenNthCalledWith(
      1,
      {},
      {
        sessionId: 'tab-a',
        toolCallId: 'surface-7',
      },
    );
    expect(found).toEqual({ text: 'State of profile', isError: undefined });
    expect(rejected).toEqual({ text: 'bad view', isError: true });
    expect(unavailable).toEqual({
      text: 'surface state unavailable on this host',
      isError: true,
    });
  });

  it('reports a committed-but-undelivered update as an error keeping the text', async () => {
    const update = jest.fn(async () => ({
      status: 'delivery-failed' as const,
      surfaceId: 'profile',
      revision: 2,
      text: 'Name: Grace',
      reason:
        'Surface profile committed revision 2, but delivery failed; do not resend.',
      delivery: {
        status: 'failed' as const,
        delivered: 0,
        surfaces: 1,
        reason: 'x',
      },
    }));

    const { text, isError } = agentToolResult(
      await callSurface(
        'ptah_surface_update',
        {},
        surfaceDeps({ update }),
        'tab-a',
      ),
    );

    expect(isError).toBe(true);
    expect(text).toContain('committed revision 2');
    expect(text).toContain('do not resend');
    expect(text).toContain('Name: Grace');
  });
});

// ---------------------------------------------------------------------------
// tools/call — tool-result budget and per-call debug telemetry
// (TASK_2026_559 Task 2f.1). Every success text goes through
// `applyToolResultBudget`; the spool root is the caller's declared workspace
// root (`_callerWorkspaceRoot`), here a throw-away temp directory that the
// host's workspace provider knows (an unknown declared root is not trusted).
// ---------------------------------------------------------------------------

/** A workspace provider whose open folders are `folders`. */
function knownFolders(
  ...folders: string[]
): NonNullable<ProtocolHandlerDependencies['workspaceProvider']> {
  return { getWorkspaceFolders: () => folders };
}

describe('protocol-handlers › tool-result budget (TASK_2026_559 2f.1)', () => {
  let spoolRoot: string;

  beforeEach(() => {
    spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-2f-'));
  });

  afterEach(() => {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  });

  function spoolDir(root = spoolRoot): string {
    return path.join(root, '.ptah', 'tmp', 'mcp-out');
  }

  /** The one spool file written under `root`. */
  function onlySpoolFile(root = spoolRoot): string {
    const files = fs.readdirSync(spoolDir(root));
    expect(files).toHaveLength(1);
    return fs.readFileSync(path.join(spoolDir(root), files[0]), 'utf8');
  }

  function callTool(
    name: string,
    args: Record<string, unknown>,
    deps: ProtocolHandlerDependencies,
    extra: Partial<MCPRequest> = {},
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: `budget-${name}`,
        method: 'tools/call',
        params: { name, arguments: args },
        _callerWorkspaceRoot: spoolRoot,
        ...extra,
      }),
      { workspaceProvider: knownFolders(spoolRoot), ...deps },
    );
  }

  function textOf(res: MCPResponse): string {
    const content = (res.result as { content: Array<{ text: string }> })
      .content;
    expect(content).toHaveLength(1);
    return content[0].text;
  }

  /** The metadata of the single `[MCP] tool result` debug line. */
  function telemetryOf(logger: MockLogger): Record<string, unknown> {
    const lines = logger.debug.mock.calls.filter(
      (call) => call[0] === '[MCP] tool result',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toBe('CodeExecutionMCP');
    return lines[0][2] as Record<string, unknown>;
  }

  function expectWithinDefaultBudget(text: string): void {
    expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
    );
  }

  it('reduces a 50k-char JSON result within both limits, adds the trailer, spools the raw byte-equal, and tells the transcript the same text', async () => {
    const monorepo = {
      isMonorepo: true,
      packages: Array.from({ length: 700 }, (_, i) => ({
        name: `@scope/package-${i}`,
        path: `libs/group-${i % 7}/package-${i}`,
        dependencies: ['@scope/shared', `@scope/package-${(i + 1) % 700}`],
      })),
    };
    const raw = JSON.stringify(monorepo);
    expect(raw.length).toBeGreaterThan(50_000);
    const logger = createMockLogger();
    const onToolResult = jest.fn();
    const deps = buildDeps({
      logger: asLogger(logger),
      onToolResult,
      ptahAPI: buildPtahAPIStub({
        project: {
          detectMonorepo: jest.fn().mockResolvedValue(monorepo),
        } as unknown as PtahAPI['project'],
      }),
    });

    const res = await callTool('ptah_project_detect_monorepo', {}, deps);

    const text = textOf(res);
    expectWithinDefaultBudget(text);
    expect(text).toMatch(
      /\[reduced: [^\]]+ — showing \d+ of \d+ tokens — full output: [^\]]+\]$/,
    );
    expect(onlySpoolFile()).toBe(raw);
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledWith(
      'budget-ptah_project_detect_monorepo',
      text,
      false,
    );
    const telemetry = telemetryOf(logger);
    expect(telemetry).toMatchObject({
      tool: 'ptah_project_detect_monorepo',
      resultChars: text.length,
      isError: false,
    });
    expect(telemetry['rawTokens']).toBeGreaterThan(
      telemetry['returnedTokens'] as number,
    );
  });

  it('keeps the failure lines of a 50k-char log', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 700; i++) {
      lines.push(
        `2026-09-26T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z INFO worker-${i % 4} processed batch ${i} of the nightly import`,
      );
      if (i === 180 || i === 420 || i === 610) {
        lines.push(
          `2026-09-26T10:00:00.000Z ERROR worker-${i % 4} failed to connect to database replica-${i}: ECONNREFUSED`,
        );
      }
    }
    lines.push('Summary: 700 batches, 3 failed');
    const log = lines.join('\n');
    expect(log.length).toBeGreaterThan(50_000);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        dashboard: {
          proposeSpec: jest
            .fn()
            .mockResolvedValue({ status: 'delivered', text: log }),
        } as unknown as PtahAPI['dashboard'],
      }),
    });

    const text = textOf(
      await callTool('ptah_dashboard_propose_spec', { spec: {} }, deps),
    );

    expectWithinDefaultBudget(text);
    for (const replica of ['replica-180', 'replica-420', 'replica-610']) {
      expect(text).toContain(
        `failed to connect to database ${replica}: ECONNREFUSED`,
      );
    }
    expect(text).toContain('[reduced: ');
    expect(onlySpoolFile()).toBe(log);
  });

  it('budgets an execute_code success result as well', async () => {
    const deps = buildDeps();

    const text = textOf(
      await callTool(
        'execute_code',
        {
          code: "return Array.from({ length: 800 }, (_, i) => ({ id: i, label: 'row-' + i }));",
        },
        deps,
      ),
    );

    expectWithinDefaultBudget(text);
    expect(text).toContain('[reduced: ');
    expect(JSON.parse(onlySpoolFile())).toHaveLength(800);
  });

  it('returns an under-budget result unchanged, spools nothing, and logs its telemetry at debug', async () => {
    const logger = createMockLogger();
    const deps = buildDeps({
      logger: asLogger(logger),
      ptahAPI: buildPtahAPIStub({
        search: {
          findFiles: jest.fn().mockResolvedValue(['a.ts']),
        } as unknown as PtahAPI['search'],
      }),
    });

    const text = textOf(
      await callTool('ptah_search_files', { pattern: '*.ts' }, deps),
    );

    expect(text).not.toContain('[reduced: ');
    expect(fs.existsSync(spoolDir())).toBe(false);
    expect(telemetryOf(logger)).toEqual({
      tool: 'ptah_search_files',
      callerKind: 'workspace',
      durationMs: expect.any(Number),
      resultChars: text.length,
      rawTokens: countTokensPiecewise(text),
      returnedTokens: countTokensPiecewise(text),
      reducer: 'none',
      truncated: false,
      isError: false,
    });
    // Never at info: one line per call would flood the log.
    expect(
      logger.info.mock.calls.some((call) => call[0] === '[MCP] tool result'),
    ).toBe(false);
  });

  it('logs a tool error with isError:true and no budget counts', async () => {
    const logger = createMockLogger();
    const deps = buildDeps({
      logger: asLogger(logger),
      ptahAPI: buildPtahAPIStub({
        search: {
          findFiles: jest.fn().mockRejectedValue(new Error('boom')),
        } as unknown as PtahAPI['search'],
      }),
    });

    const res = await callTool('ptah_search_files', { pattern: '*' }, deps);

    expect(telemetryOf(logger)).toEqual({
      tool: 'ptah_search_files',
      callerKind: 'workspace',
      durationMs: expect.any(Number),
      resultChars: textOf(res).length,
      rawTokens: null,
      returnedTokens: null,
      reducer: 'none',
      truncated: false,
      isError: true,
    });
  });

  it('logs a JSON-RPC error (unknown tool) with isError:true', async () => {
    const logger = createMockLogger();

    const res = await callTool(
      'no_such_tool',
      {},
      buildDeps({ logger: asLogger(logger) }),
    );

    expect(res.error?.code).toBe(-32602);
    expect(telemetryOf(logger)).toMatchObject({
      tool: '<unknown>',
      resultChars: 0,
      isError: true,
    });
  });

  // Review F4: a requested name is caller input and may carry a path or a
  // secret; the telemetry logs only registered tool names.
  it('logs an unregistered tool name as <unknown>, never verbatim', async () => {
    const logger = createMockLogger();

    await callTool(
      'D:/private/secret-token',
      {},
      buildDeps({ logger: asLogger(logger) }),
      { id: 'budget-unknown' },
    );

    expect(telemetryOf(logger)['tool']).toBe('<unknown>');
    for (const mock of [logger.debug, logger.info, logger.warn]) {
      expect(JSON.stringify(mock.mock.calls)).not.toContain('secret-token');
    }
  });

  it('spools under the host provider folder when the caller declared none, without a workspace lookup', async () => {
    const getInfo = jest.fn().mockResolvedValue({ path: os.tmpdir() });
    const raw = JSON.stringify({ rows: 'x'.repeat(20_000) });
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        workspace: { getInfo } as unknown as PtahAPI['workspace'],
        project: {
          detectMonorepo: jest
            .fn()
            .mockResolvedValue({ rows: 'x'.repeat(20_000) }),
        } as unknown as PtahAPI['project'],
      }),
    });

    await callTool('ptah_project_detect_monorepo', {}, deps, {
      _callerWorkspaceRoot: undefined,
    });

    expect(getInfo).not.toHaveBeenCalled();
    expect(onlySpoolFile()).toBe(raw);
  });

  it('passes the screenshot image block through untouched (only text is budgeted)', async () => {
    const data = 'A'.repeat(40_000);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        browser: {
          screenshot: jest.fn().mockResolvedValue({ data, format: 'png' }),
        } as unknown as PtahAPI['browser'],
      }),
    });

    const res = await callTool('ptah_browser_screenshot', {}, deps);

    const content = (
      res.result as { content: Array<{ type: string; data?: string }> }
    ).content;
    expect(content[0]).toEqual({ type: 'image', data, mimeType: 'image/png' });
    expect(fs.existsSync(spoolDir())).toBe(false);
  });

  // Pins TODAY's behaviour under the ptah_browser_content override (32 KiB +
  // 1 KiB): the formatter caps text and HTML at 32 KiB EACH, so a large page
  // exceeds the override. The Markdown reducer then keeps the text section
  // and replaces the whole HTML code block with an omission line (no line
  // cut is needed after that); the full formatted output is spooled and the
  // trailer names it. Batch 2e follow-up: a later fix to the browser output
  // should show up as a deliberate change to this spec.
  it('ptah_browser_content: a large page loses its HTML block to the override, the full output is spooled, and the trailer names it', async () => {
    const page = {
      text: Array.from(
        { length: 900 },
        (_, i) =>
          `Paragraph ${i}: the quick brown fox jumps over the lazy dog.`,
      ).join('\n'),
      html: Array.from(
        { length: 900 },
        (_, i) => `<p class="para">Paragraph ${i}: the quick brown fox</p>`,
      ).join('\n'),
    };
    const raw = formatBrowserContent(page);
    const budget = getToolResultBudget('ptah_browser_content');
    expect(raw.length).toBeGreaterThan(budget.chars);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        browser: {
          getContent: jest.fn().mockResolvedValue(page),
        } as unknown as PtahAPI['browser'],
      }),
    });

    const text = textOf(await callTool('ptah_browser_content', {}, deps));

    expect(budget.chars).toBe(32 * 1024 + 1024);
    expect(text.length).toBeLessThanOrEqual(budget.chars);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(budget.tokens);
    expect(text).toMatch(
      /\n\n\[reduced: markdown-outline — showing \d+ of \d+ tokens — full output: [^\]]+\]$/,
    );
    expect(text).not.toContain('— partial');
    expect(onlySpoolFile()).toBe(raw);
    // The text section (already capped by the formatter) comes first and
    // survives whole; the HTML section keeps its heading only.
    expect(text).toContain('Paragraph 0: the quick brown fox');
    expect(text).toContain('[...truncated]');
    expect(text).toMatch(/### HTML\n\n\(code block, \d+ lines, omitted\)/);
    expect(text).not.toContain('<p class="para">');
  });

  // TASK_2026_559 Batch 18: an over-budget evaluate value is cut by the
  // formatter so the whole answer fits the budget (the budget step leaves it
  // unchanged and its trailer inline); the full value is spooled under the
  // host-owned spool root and named in that trailer (User Decision 7).
  it('ptah_browser_evaluate: an over-budget value is cut within the budget, spooled whole under the known folder, and named inline', async () => {
    const value = 'v'.repeat(2000) + 'TAIL-MARKER' + 'w'.repeat(60_000);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        browser: {
          evaluate: jest.fn().mockResolvedValue({ value, type: 'string' }),
        } as unknown as PtahAPI['browser'],
      }),
    });

    const text = textOf(
      await callTool('ptah_browser_evaluate', { expression: 'x' }, deps),
    );

    expectWithinDefaultBudget(text);
    expect(text).not.toContain('TAIL-MARKER');
    expect(text).not.toContain('[reduced:');
    expect(onlySpoolFile()).toBe(value);
    const [spooled] = fs.readdirSync(spoolDir());
    expect(text).toContain(
      `; full value: ${path.join(spoolDir(), spooled)} — for page content use ptah_browser_content with a selector]`,
    );
  });

  // Review F1: the declared root is a URL segment (caller input). It decides
  // the spool location only when it canonicalizes to a folder the host knows.
  describe('spool root trust (review F1)', () => {
    let hostRoot: string;
    let outside: string;

    beforeEach(() => {
      hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-2f-host-'));
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-2f-outside-'));
    });

    afterEach(() => {
      fs.rmSync(hostRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    });

    const payload = { rows: 'x'.repeat(20_000) };
    let getInfo: jest.Mock;

    // The production composition: `ptahAPI.workspace.getInfo()` is
    // session-aware and resolves the CALLER's declared root first, so the
    // fake does the same. Only the platform provider (`knownFolders`) is a
    // host-owned record.
    function oversizedDeps(
      overrides: Partial<ProtocolHandlerDependencies> = {},
    ): ProtocolHandlerDependencies {
      getInfo = jest.fn(async () => ({ path: getCallerWorkspaceRoot() }));
      return buildDeps({
        ptahAPI: buildPtahAPIStub({
          workspace: { getInfo } as unknown as PtahAPI['workspace'],
          project: {
            detectMonorepo: jest.fn().mockResolvedValue(payload),
          } as unknown as PtahAPI['project'],
        }),
        workspaceProvider: knownFolders(hostRoot),
        ...overrides,
      });
    }

    async function callWithDeclaredRoot(
      declared: string,
      deps: ProtocolHandlerDependencies = oversizedDeps(),
    ): Promise<void> {
      await callTool('ptah_project_detect_monorepo', {}, deps, {
        _callerWorkspaceRoot: declared,
      });
      expect(getInfo).not.toHaveBeenCalled();
    }

    function expectSpooledUnderHostRoot(): void {
      expect(onlySpoolFile(hostRoot)).toBe(JSON.stringify(payload));
      expect(fs.existsSync(path.join(outside, '.ptah'))).toBe(false);
    }

    it('ignores an unknown absolute declared root, and spools under the known folder', async () => {
      await callWithDeclaredRoot(outside);

      expectSpooledUnderHostRoot();
    });

    it('ignores a declared root whose parent segments leave the known folder, and spools under the known folder', async () => {
      const declared = [hostRoot, '..', path.basename(outside)].join(path.sep);

      await callWithDeclaredRoot(declared);

      expectSpooledUnderHostRoot();
    });

    it('does not trust a subfolder of a known folder, and spools under the known folder', async () => {
      const sub = path.join(hostRoot, 'sub');
      fs.mkdirSync(sub);

      await callWithDeclaredRoot(sub);

      expect(fs.existsSync(path.join(sub, '.ptah'))).toBe(false);
      expectSpooledUnderHostRoot();
    });

    it('does not trust a junction/symlink under a known folder that points outside it', async () => {
      const link = path.join(hostRoot, 'link');
      try {
        fs.symlinkSync(
          outside,
          link,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error: unknown) {
        // Skipped only when the OS refuses to create the link.
        console.warn(
          `skipping junction case: link creation refused (${String(error)})`,
        );
        return;
      }

      await callWithDeclaredRoot(link);

      expectSpooledUnderHostRoot();
    });

    it('never spools to (or touches) a declared UNC share the host does not know', async () => {
      const realpath = jest.spyOn(fs.promises, 'realpath');
      try {
        await callWithDeclaredRoot('\\\\server\\share');
        await callWithDeclaredRoot('\\\\?\\UNC\\server\\share');

        const files = fs.readdirSync(spoolDir(hostRoot));
        expect(files).toHaveLength(2);
        for (const [arg] of realpath.mock.calls) {
          expect(String(arg)).not.toMatch(/server/);
        }
      } finally {
        realpath.mockRestore();
      }
    });

    it('falls back to the system temp directory when the host has no open folder', async () => {
      // Spy on the core module itself: the `import * as os` namespace only
      // exposes non-configurable getters onto it.
      const tmp = jest
        .spyOn(jest.requireActual<typeof os>('os'), 'tmpdir')
        .mockReturnValue(outside);
      try {
        await callWithDeclaredRoot(
          hostRoot,
          oversizedDeps({ workspaceProvider: knownFolders() }),
        );
      } finally {
        tmp.mockRestore();
      }

      expect(onlySpoolFile(outside)).toBe(JSON.stringify(payload));
      expect(fs.existsSync(spoolDir(hostRoot))).toBe(false);
    });

    it('logs a throwing workspace provider at warn and still spools under the system temp directory', async () => {
      const logger = createMockLogger();
      const tmp = jest
        .spyOn(jest.requireActual<typeof os>('os'), 'tmpdir')
        .mockReturnValue(outside);
      try {
        await callWithDeclaredRoot(
          hostRoot,
          oversizedDeps({
            logger: asLogger(logger),
            workspaceProvider: {
              getWorkspaceFolders: () => {
                throw new Error('provider down');
              },
            },
          }),
        );
      } finally {
        tmp.mockRestore();
      }

      expect(onlySpoolFile(outside)).toBe(JSON.stringify(payload));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('workspace provider failed'),
        'CodeExecutionMCP',
      );
    });

    it('never logs the workspace provider error text', async () => {
      const logger = createMockLogger();
      const tmp = jest
        .spyOn(jest.requireActual<typeof os>('os'), 'tmpdir')
        .mockReturnValue(outside);
      try {
        await callWithDeclaredRoot(
          hostRoot,
          oversizedDeps({
            logger: asLogger(logger),
            workspaceProvider: {
              getWorkspaceFolders: () => {
                throw new Error('D:/private/secret-token');
              },
            },
          }),
        );
      } finally {
        tmp.mockRestore();
      }

      const logged = JSON.stringify(
        Object.values(logger).flatMap((fn) =>
          jest.isMockFunction(fn) ? fn.mock.calls : [],
        ),
      );
      expect(logged).not.toContain('secret-token');
    });

    it('still spools under the system temp directory when the warn log throws', async () => {
      const logger = createMockLogger();
      logger.warn.mockImplementation(() => {
        throw new Error('logger down');
      });
      const tmp = jest
        .spyOn(jest.requireActual<typeof os>('os'), 'tmpdir')
        .mockReturnValue(outside);
      try {
        await callWithDeclaredRoot(
          hostRoot,
          oversizedDeps({
            logger: asLogger(logger),
            workspaceProvider: {
              getWorkspaceFolders: () => {
                throw new Error('provider down');
              },
            },
          }),
        );
      } finally {
        tmp.mockRestore();
      }

      expect(onlySpoolFile(outside)).toBe(JSON.stringify(payload));
    });

    it('uses a declared root that canonicalizes to a known folder, as the host recorded it', async () => {
      const deps = oversizedDeps({
        workspaceProvider: knownFolders(hostRoot, spoolRoot),
      });
      const declared = [spoolRoot, 'sub', '..'].join(path.sep) + path.sep;

      await callWithDeclaredRoot(
        process.platform === 'win32' ? declared.toUpperCase() : declared,
        deps,
      );

      expect(onlySpoolFile(spoolRoot)).toBe(JSON.stringify(payload));
      expect(fs.existsSync(spoolDir(hostRoot))).toBe(false);
    });

    (process.platform === 'win32' ? it : it.skip)(
      'matches the \\\\?\\ extended-length spelling of a known folder (win32 only)',
      async () => {
        const deps = oversizedDeps({
          workspaceProvider: knownFolders(hostRoot, spoolRoot),
        });

        await callWithDeclaredRoot(`\\\\?\\${spoolRoot}`, deps);

        expect(onlySpoolFile(spoolRoot)).toBe(JSON.stringify(payload));
        expect(fs.existsSync(spoolDir(hostRoot))).toBe(false);
      },
    );
  });

  // Review F2: approval_prompt is a machine-control response read by the
  // permission machinery — never reduced, and it declares no ceiling.
  it('returns an oversized approval_prompt input whole and does not declare a result ceiling for it', async () => {
    const input = { command: 'y'.repeat(50_000) };
    const res = await callTool(
      'approval_prompt',
      { tool_name: 'Bash', input },
      buildDeps({ webviewManager: undefined }),
    );

    expect(textOf(res)).toBe(
      JSON.stringify({ behavior: 'allow', updatedInput: input }),
    );
    expect(fs.existsSync(spoolDir())).toBe(false);

    const list = await handleMCPRequest(
      makeRequest({ id: 'approval-list', method: 'tools/list' }),
      buildDeps(),
    );
    const approval = (
      list.result as {
        tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
      }
    ).tools.find((tool) => tool.name === 'approval_prompt');
    expect(approval).toBeDefined();
    expect(approval?._meta?.['anthropic/maxResultSizeChars']).toBeUndefined();
  });

  // Review F2: in the mixed screenshot response only the text block is
  // budgeted; the image block stays byte-identical.
  it('budgets the screenshot text block and leaves its image block byte-identical', async () => {
    const data = 'B'.repeat(40_000);
    const filePath = `/shots/${'x'.repeat(20_000)}.png`;
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        browser: {
          screenshot: jest
            .fn()
            .mockResolvedValue({ data, format: 'png', filePath }),
        } as unknown as PtahAPI['browser'],
      }),
    });

    const res = await callTool('ptah_browser_screenshot', {}, deps);

    const content = (
      res.result as {
        content: Array<{ type: string; data?: string; text?: string }>;
      }
    ).content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'image', data, mimeType: 'image/png' });
    const caption = content[1].text ?? '';
    expect(caption.length).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_CHARS,
    );
    expect(caption).toContain('full output: ');
    expect(onlySpoolFile()).toContain(filePath);
  });

  // TASK_2026_559 Batch 17 (User Decision 3): the transcript callback gets a
  // one-line summary, not a second copy of the base64 image.
  describe('ptah_browser_screenshot transcript summary and default format', () => {
    function screenshotDeps(
      screenshot: jest.Mock,
      onToolResult: jest.Mock,
    ): ProtocolHandlerDependencies {
      return buildDeps({
        onToolResult,
        ptahAPI: buildPtahAPIStub({
          browser: { screenshot } as unknown as PtahAPI['browser'],
          workspace: {
            getInfo: jest.fn().mockResolvedValue({ path: spoolRoot }),
          } as unknown as PtahAPI['workspace'],
        }),
      });
    }

    it('hands onToolResult a short summary with no base64 while the image stays inline', async () => {
      const data = 'Q'.repeat(40_000);
      const screenshot = jest.fn().mockResolvedValue({ data, format: 'jpeg' });
      const onToolResult = jest.fn();

      const res = await callTool(
        'ptah_browser_screenshot',
        {},
        screenshotDeps(screenshot, onToolResult),
      );

      expect(onToolResult).toHaveBeenCalledTimes(1);
      const [, text, isError] = onToolResult.mock.calls[0];
      expect(isError).toBe(false);
      expect(text).not.toContain('QQQQ');
      expect(text.length).toBeLessThan(300);
      expect(text).not.toContain('\n');
      expect(text).toBe('Screenshot captured (jpeg, ~29KB)');
      const content = (
        res.result as { content: Array<{ type: string; data?: string }> }
      ).content;
      expect(content[0]).toEqual({
        type: 'image',
        data,
        mimeType: 'image/jpeg',
      });
    });

    it('takes the format of a saveTo extension when no format is given, and names the saved path', async () => {
      const screenshot = jest
        .fn()
        .mockResolvedValue({ data: 'iVBORw0K', format: 'png' });
      const onToolResult = jest.fn();

      await callTool(
        'ptah_browser_screenshot',
        { saveTo: 'home.png' },
        screenshotDeps(screenshot, onToolResult),
      );

      expect(screenshot).toHaveBeenCalledWith({
        format: 'png',
        quality: undefined,
        fullPage: undefined,
      });
      const savedPath = path.join(
        spoolRoot,
        '.ptah',
        'screenshots',
        'home.png',
      );
      expect(fs.existsSync(savedPath)).toBe(true);
      const text = onToolResult.mock.calls[0][1] as string;
      expect(text).toBe(
        `Screenshot captured (png, ~0KB) | Saved to: ${savedPath}`,
      );
    });

    // Batch 17 r1 S1: a png picked by the saveTo extension ignores quality.
    it('captures a saveTo png even with a quality png cannot use', async () => {
      const capture = jest
        .fn()
        .mockResolvedValue({ data: 'iVBORw0K', format: 'png' });
      const capabilities: IBrowserCapabilities = {
        configureSession: jest.fn(),
        navigate: jest.fn(),
        screenshot: capture,
        evaluate: jest.fn(),
        click: jest.fn(),
        type: jest.fn(),
        getContent: jest.fn(),
        getNetworkRequests: jest.fn(),
        close: jest.fn(),
        status: jest.fn(),
        isConnected: jest.fn(),
        startRecording: jest.fn(),
        stopRecording: jest.fn(),
      };
      const browser = buildBrowserNamespace({ capabilities });
      const onToolResult = jest.fn();

      const res = await callTool(
        'ptah_browser_screenshot',
        { saveTo: 'home.png', quality: 50.5 },
        buildDeps({
          onToolResult,
          ptahAPI: buildPtahAPIStub({
            browser,
            workspace: {
              getInfo: jest.fn().mockResolvedValue({ path: spoolRoot }),
            } as unknown as PtahAPI['workspace'],
          }),
        }),
      );

      expect(capture).toHaveBeenCalledWith({
        format: 'png',
        quality: undefined,
        fullPage: undefined,
      });
      const content = (
        res.result as { content: Array<{ type: string; mimeType?: string }> }
      ).content;
      expect(content[0].mimeType).toBe('image/png');
    });

    // Batch 17 r1 M1: the transcript summary stays one line under 300 chars
    // whatever the saved path; the response caption keeps the full path.
    it('bounds a long saved path in the transcript summary and keeps the file name', async () => {
      const filePath = `/shots/${'nested/'.repeat(45)}shot.jpg`;
      const screenshot = jest
        .fn()
        .mockResolvedValue({ data: 'AAAA', format: 'jpeg', filePath });
      const onToolResult = jest.fn();

      const res = await callTool(
        'ptah_browser_screenshot',
        {},
        screenshotDeps(screenshot, onToolResult),
      );

      const text = onToolResult.mock.calls[0][1] as string;
      expect(text.length).toBeLessThan(300);
      expect(text).toMatch(
        /^Screenshot captured \(jpeg, ~0KB\) \| Saved to: \/shots\/nested\/.*….*\/shot\.jpg$/,
      );
      const caption = (res.result as { content: Array<{ text?: string }> })
        .content[1].text;
      expect(caption).toContain(filePath);
    });

    it('keeps the transcript summary on one line when the saved path has line breaks', async () => {
      const screenshot = jest.fn().mockResolvedValue({
        data: 'AAAA',
        format: 'jpeg',
        filePath: '/shots/a\nb\r\tc.jpg',
      });
      const onToolResult = jest.fn();

      await callTool(
        'ptah_browser_screenshot',
        {},
        screenshotDeps(screenshot, onToolResult),
      );

      expect(onToolResult.mock.calls[0][1]).toBe(
        'Screenshot captured (jpeg, ~0KB) | Saved to: /shots/a?b??c.jpg',
      );
    });

    it('bounds the transcript summary even when the file name alone is too long', async () => {
      const filePath = `/shots/${'n'.repeat(400)}.jpg`;
      const screenshot = jest
        .fn()
        .mockResolvedValue({ data: 'AAAA', format: 'jpeg', filePath });
      const onToolResult = jest.fn();

      await callTool(
        'ptah_browser_screenshot',
        {},
        screenshotDeps(screenshot, onToolResult),
      );

      const text = onToolResult.mock.calls[0][1] as string;
      expect(text.length).toBeLessThan(300);
      expect(text).toContain('…');
      expect(text.endsWith('nnn.jpg')).toBe(true);
    });

    it.each([
      ['shot.jpg', 'jpeg'],
      ['shot.JPEG', 'jpeg'],
      ['shot.webp', 'webp'],
      ['shot', undefined],
      ['shot.bmp', undefined],
    ])(
      'maps saveTo %p to format %p when no format is given',
      async (saveTo, expected) => {
        const screenshot = jest
          .fn()
          .mockResolvedValue({ data: 'AAAA', format: expected ?? 'jpeg' });

        await callTool(
          'ptah_browser_screenshot',
          { saveTo },
          screenshotDeps(screenshot, jest.fn()),
        );

        expect(screenshot.mock.calls[0][0].format).toBe(expected);
      },
    );

    it('honours an explicit format over the saveTo extension', async () => {
      const screenshot = jest
        .fn()
        .mockResolvedValue({ data: 'AAAA', format: 'png' });

      await callTool(
        'ptah_browser_screenshot',
        { format: 'png', saveTo: 'shot.jpg' },
        screenshotDeps(screenshot, jest.fn()),
      );

      expect(screenshot.mock.calls[0][0].format).toBe('png');
    });

    it('leaves the error path unchanged', async () => {
      const screenshot = jest
        .fn()
        .mockResolvedValue({ data: '', format: 'jpeg', error: 'no page' });
      const onToolResult = jest.fn();

      const res = await callTool(
        'ptah_browser_screenshot',
        {},
        screenshotDeps(screenshot, onToolResult),
      );

      const text = textOf(res);
      expect(text).toContain('Screenshot Failed');
      expect(text).toContain('no page');
      expect(onToolResult).toHaveBeenCalledWith(
        'budget-ptah_browser_screenshot',
        text,
        false,
      );
    });

    it('states the jpeg / quality 60 default in the tool description', () => {
      const tool = buildBrowserScreenshotTool();
      const props = tool.inputSchema.properties as Record<
        string,
        { description: string }
      >;
      expect(tool.description).toContain('jpeg at quality 60');
      expect(props['format'].description).toBe(
        'Image format (default: "jpeg")',
      );
      expect(props['quality'].description).toContain('(default: 60)');
    });
  });

  // Review F3: a throwing observer never replaces the outcome it observes.
  it('keeps a screenshot success (with its image) when the transcript callback throws', async () => {
    const data = 'C'.repeat(1_000);
    const deps = buildDeps({
      onToolResult: () => {
        throw new Error('observer failed');
      },
      ptahAPI: buildPtahAPIStub({
        browser: {
          screenshot: jest.fn().mockResolvedValue({ data, format: 'png' }),
        } as unknown as PtahAPI['browser'],
      }),
    });

    const res = await callTool('ptah_browser_screenshot', {}, deps);

    const result = res.result as {
      content: Array<{ type: string; data?: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({
      type: 'image',
      data,
      mimeType: 'image/png',
    });
  });

  it('keeps the actionable execute_code error when the transcript callback throws', async () => {
    const deps = buildDeps({
      onToolResult: () => {
        throw new Error('observer failed');
      },
    });

    const res = await callTool(
      'execute_code',
      { code: 'return new Promise(() => undefined);', timeout: 50 },
      deps,
    );

    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Execution timeout (50ms)');
    expect(result.content[0].text).toContain(
      'Try breaking the operation into smaller steps',
    );
    expect(result.content[0].text).not.toContain('observer failed');
  });

  // TASK_2026_559 Batch 11b (r1 Minor): the ptah_search_files truncation
  // notice precedes the list so the budget cannot drop it. Pinned through
  // both oversized paths: the Markdown reducer and the plain prefix cut.
  it.each([
    ['the Markdown reducer', 1_000, /^\[reduced: markdown-outline — /m],
    ['a prefix cut', 10_000, /^\[reduced: \S+ — partial, cut /m],
  ])(
    'keeps the search_files truncation notice through %s (%i files over the limit)',
    async (_path, limit, trailer) => {
      const matched = Array.from(
        { length: limit + 1 },
        (_, i) => `libs/group-${i % 9}/src/lib/file-${i}.service.ts`,
      );
      const findFiles = jest.fn().mockResolvedValue(matched);
      const deps = buildDeps({
        ptahAPI: buildPtahAPIStub({
          search: { findFiles } as unknown as PtahAPI['search'],
        }),
      });

      const text = textOf(
        await callTool(
          'ptah_search_files',
          { pattern: '**/*.ts', limit },
          deps,
        ),
      );

      const raw = formatSearchFiles(matched.slice(0, limit), true);
      expect(raw.length).toBeGreaterThan(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
      expectWithinDefaultBudget(text);
      expect(text).toContain(
        `Found: more than ${limit} files (showing first ${limit}; narrow the pattern or raise limit)`,
      );
      expect(text).toMatch(trailer);
      expect(onlySpoolFile()).toBe(raw);
    },
  );
});

// ---------------------------------------------------------------------------
// tools/list — result budget declaration (TASK_2026_559 Task 2f.2)
// ---------------------------------------------------------------------------

describe('protocol-handlers › tools/list maxResultSizeChars (TASK_2026_559 2f.2)', () => {
  const ALL_CAPABILITIES: Partial<ProtocolHandlerDependencies> = {
    hasIDECapabilities: true,
    hasSqliteLayer: true,
  };

  async function listResult(
    overrides: Partial<ProtocolHandlerDependencies> = ALL_CAPABILITIES,
  ): Promise<{
    tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
  }> {
    const res = await handleMCPRequest(
      makeRequest({ id: 'budget-list', method: 'tools/list' }),
      buildDeps(overrides),
    );
    return res.result as {
      tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
    };
  }

  it('declares every listed tool except approval_prompt at its budget-table char ceiling', async () => {
    const { tools } = await listResult();

    expect(tools.length).toBeGreaterThan(50);
    for (const tool of tools) {
      expect(tool._meta?.['anthropic/maxResultSizeChars']).toBe(
        tool.name === 'approval_prompt'
          ? undefined
          : getToolResultBudget(tool.name).chars,
      );
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(
      byName.get('ptah_browser_content')?._meta?.[
        'anthropic/maxResultSizeChars'
      ],
    ).toBe(32 * 1024 + 1024);
    expect(
      byName.get('ptah_search_files')?._meta?.['anthropic/maxResultSizeChars'],
    ).toBe(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
  });

  it('keeps the existing alwaysLoad key on eager tools', async () => {
    const { tools } = await listResult();
    const diagnostics = tools.find((t) => t.name === 'ptah_get_diagnostics');

    expect(diagnostics?._meta).toEqual({
      'anthropic/alwaysLoad': true,
      'anthropic/maxResultSizeChars': DEFAULT_TOOL_RESULT_BUDGET_CHARS,
    });
  });

  it('is byte-stable across two calls', async () => {
    for (const overrides of [{}, ALL_CAPABILITIES]) {
      const first = JSON.stringify(await listResult(overrides));
      const second = JSON.stringify(await listResult(overrides));
      expect(second).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Caller identity — tools/list, tools/call context, telemetry (TASK_2026_559 Batch 3)
//
// Every caller kind gets the same tool list (User Decision 6: no per-caller
// narrowing), byte for byte, so the prompt cache holds across callers. The
// telemetry line carries the caller KIND only — never an id or a root.
// ---------------------------------------------------------------------------

describe('protocol-handlers › caller identity (TASK_2026_559 Batch 3)', () => {
  const WS_ROOT = 'D:\\projects\\caller-ws';

  /** The `_caller*` fields the HTTP handler stamps for each URL shape. */
  const CALLERS: ReadonlyArray<{
    kind: string;
    fields: Partial<MCPRequest>;
  }> = [
    {
      kind: 'agent',
      fields: {
        _callerAgentId: 'agent-secret-id',
        _callerWorkspaceRoot: WS_ROOT,
      },
    },
    {
      kind: 'session',
      fields: {
        _callerSessionId: 'session-secret-id',
        _callerWorkspaceRoot: WS_ROOT,
      },
    },
    { kind: 'workspace', fields: { _callerWorkspaceRoot: WS_ROOT } },
    { kind: 'anonymous', fields: {} },
  ];

  const LIST_CONFIGS: ReadonlyArray<Partial<ProtocolHandlerDependencies>> = [
    {},
    { hasIDECapabilities: true, hasSqliteLayer: true },
    { hasIDECapabilities: true, disabledMcpNamespaces: ['browser', 'git'] },
  ];

  async function listJson(
    fields: Partial<MCPRequest>,
    overrides: Partial<ProtocolHandlerDependencies>,
  ): Promise<string> {
    const res = await handleMCPRequest(
      makeRequest({ id: 'caller-list', method: 'tools/list', ...fields }),
      buildDeps(overrides),
    );
    expect(res.error).toBeUndefined();
    return JSON.stringify(res.result);
  }

  it('returns a byte-identical tools/list for all four caller kinds and across repeated calls', async () => {
    for (const overrides of LIST_CONFIGS) {
      const reference = await listJson({}, overrides);
      for (const { fields } of CALLERS) {
        expect(await listJson(fields, overrides)).toBe(reference);
        expect(await listJson(fields, overrides)).toBe(reference);
      }
    }
  });

  it('returns the same derived instructions from initialize for all four caller kinds (Batch 4)', async () => {
    const initialize = async (fields: Partial<MCPRequest>): Promise<string> => {
      const res = await handleMCPRequest(
        makeRequest({
          id: 'caller-init',
          method: 'initialize',
          params: { clientInfo: { name: 'codex-mcp-client', version: '1' } },
          ...fields,
        }),
        buildDeps(),
      );
      expect(res.error).toBeUndefined();
      return (res.result as { instructions: string }).instructions;
    };

    const reference = await initialize({});
    expect(reference).toBe(buildServerInstructions());
    expect(reference.length).toBeLessThanOrEqual(512);
    expect(reference.endsWith('ptah.help()')).toBe(true);
    for (const { fields } of CALLERS) {
      expect(await initialize(fields)).toBe(reference);
    }
  });

  it('gives a malformed caller (blank or non-string fields) the same list, not a different identity’s', async () => {
    const overrides = { hasIDECapabilities: true, hasSqliteLayer: true };
    const reference = await listJson({}, overrides);
    const malformed = [
      { _callerAgentId: '   ' },
      { _callerSessionId: '' },
      { _callerWorkspaceRoot: '\t' },
      { _callerAgentId: 7 } as unknown as Partial<MCPRequest>,
    ];

    for (const fields of malformed) {
      expect(await listJson(fields, overrides)).toBe(reference);
    }
  });

  it('gives the anonymous caller the full default set (no narrowing)', async () => {
    const names = listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'caller-anon', method: 'tools/list' }),
        buildDeps({ hasIDECapabilities: true, hasSqliteLayer: true }),
      ),
    );

    for (const name of [
      'ptah_workspace_analyze',
      'execute_code',
      'approval_prompt',
      'ptah_task_create',
      'ptah_lsp_references',
      'ptah_agent_spawn',
      'ptah_agent_report',
      'ptah_git_worktree_add',
      'ptah_json_validate',
      'ptah_browser_navigate',
      'ptah_harness_propose_config',
      'ptah_code_search_symbols',
      'ptah_code_reindex',
    ]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('binds the resolved agent id in the tools/call context beside the raw session and workspace fields', async () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        tasks: {
          check: jest.fn(async () => {
            seen.push({
              agent: getCallerAgentId(),
              session: getCallerSessionId(),
              workspace: getCallerWorkspaceRoot(),
            });
            return { ok: true };
          }),
        },
      }),
    });
    const call = (fields: Partial<MCPRequest>): Promise<MCPResponse> =>
      handleMCPRequest(
        makeRequest({
          id: 'caller-ctx',
          method: 'tools/call',
          params: { name: 'ptah_task_check', arguments: {} },
          ...fields,
        }),
        deps,
      );

    await call({ _callerAgentId: 'agent-1', _callerWorkspaceRoot: WS_ROOT });
    await call({ _callerAgentId: '  ', _callerSessionId: 'tab-abc' });
    await call({});

    expect(seen).toEqual([
      { agent: 'agent-1', session: undefined, workspace: WS_ROOT },
      { agent: undefined, session: 'tab-abc', workspace: undefined },
      { agent: undefined, session: undefined, workspace: undefined },
    ]);
  });

  it('logs the caller kind on the telemetry line, and never a caller id or the declared root', async () => {
    for (const { kind, fields } of CALLERS) {
      const logger = createMockLogger();
      const deps = buildDeps({
        logger: asLogger(logger),
        ptahAPI: buildPtahAPIStub({
          tasks: { check: jest.fn().mockResolvedValue({ ok: true }) },
        }),
      });

      await handleMCPRequest(
        makeRequest({
          id: `caller-telemetry-${kind}`,
          method: 'tools/call',
          params: { name: 'ptah_task_check', arguments: {} },
          ...fields,
        }),
        deps,
      );

      const lines = logger.debug.mock.calls.filter(
        (call) => call[0] === '[MCP] tool result',
      );
      expect(lines).toHaveLength(1);
      expect(lines[0][2]).toMatchObject({
        tool: 'ptah_task_check',
        callerKind: kind,
        isError: false,
      });
      const everything = JSON.stringify([
        logger.debug.mock.calls,
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ]);
      expect(everything).not.toContain('agent-secret-id');
      expect(everything).not.toContain('session-secret-id');
      expect(everything).not.toContain('caller-ws');
    }
  });
});

// ---------------------------------------------------------------------------
// ptah_code_reindex and lazy index freshness (TASK_2026_559 Batch 6)
// ---------------------------------------------------------------------------

describe('protocol-handlers › ptah_code_reindex and index freshness (TASK_2026_559 Batch 6)', () => {
  function callTool(
    name: string,
    args: Record<string, unknown>,
    overrides: Partial<ProtocolHandlerDependencies> = {},
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: `b6-${name}`,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      buildDeps(overrides),
    );
  }

  function resultOf(res: MCPResponse): { text: string; isError: boolean } {
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    return { text: result.content[0].text, isError: result.isError === true };
  }

  async function listNames(
    overrides: Partial<ProtocolHandlerDependencies> = {},
  ): Promise<string[]> {
    return listedToolNames(
      await handleMCPRequest(
        makeRequest({ id: 'b6-list', method: 'tools/list' }),
        buildDeps(overrides),
      ),
    );
  }

  /** Lets fire-and-forget chains run. */
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('lists ptah_code_reindex right after ptah_code_search_symbols, under the code namespace only', async () => {
    const names = await listNames();
    const search = names.indexOf('ptah_code_search_symbols');
    expect(search).toBeGreaterThanOrEqual(0);
    expect(names[search + 1]).toBe('ptah_code_reindex');

    const otherGroupsOff = await listNames({
      hasIDECapabilities: true,
      disabledMcpNamespaces: [
        'ide',
        'agent',
        'git',
        'json',
        'browser',
        'harness',
      ],
    });
    expect(otherGroupsOff).toContain('ptah_code_reindex');

    expect(await listNames({ disabledMcpNamespaces: ['code'] })).not.toContain(
      'ptah_code_reindex',
    );
  });

  it('does not mark ptah_code_reindex eager, even with the SQLite layer', async () => {
    const res = await handleMCPRequest(
      makeRequest({ id: 'b6-eager', method: 'tools/list' }),
      buildDeps({ hasSqliteLayer: true, hasIDECapabilities: true }),
    );
    const tools = (
      res.result as {
        tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
      }
    ).tools;
    const tool = tools.find((t) => t.name === 'ptah_code_reindex');
    expect(tool).toBeDefined();
    expect(tool?._meta?.['anthropic/alwaysLoad']).toBeUndefined();
  });

  it('starts a full reindex and returns the started block', async () => {
    const reindex = jest.fn().mockResolvedValue({
      started: true,
      symbolCount: 0,
      indexAgeMs: null,
      reindexInFlight: true,
    });
    const res = await callTool(
      'ptah_code_reindex',
      {},
      { ptahAPI: buildPtahAPIStub({ code: { reindex } }) },
    );

    expect(reindex).toHaveBeenCalledWith({});
    const { text, isError } = resultOf(res);
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      started: true,
      symbolCount: 0,
      indexAgeMs: null,
      reindexInFlight: true,
    });
  });

  it('reindexes one absolute file and returns its stats', async () => {
    const file = path.resolve('/ws/src/auth.ts');
    const stats = {
      filesScanned: 1,
      symbolsIndexed: 3,
      errors: 0,
      durationMs: 9,
    };
    const reindex = jest.fn().mockResolvedValue(stats);
    const res = await callTool(
      'ptah_code_reindex',
      { filePath: file },
      { ptahAPI: buildPtahAPIStub({ code: { reindex } }) },
    );

    expect(reindex).toHaveBeenCalledWith({ filePath: file });
    expect(JSON.parse(resultOf(res).text)).toEqual(stats);
  });

  it('rejects a relative or non-string filePath without calling reindex', async () => {
    const reindex = jest.fn();
    for (const filePath of ['src/auth.ts', 42, '']) {
      const res = await callTool(
        'ptah_code_reindex',
        { filePath },
        { ptahAPI: buildPtahAPIStub({ code: { reindex } }) },
      );
      expect(resultOf(res).isError).toBe(true);
    }
    expect(reindex).not.toHaveBeenCalled();
  });

  it('returns a graceful error result where there is no indexer (VS Code)', async () => {
    const code = buildCodeNamespace({
      getMemorySearch: () => undefined,
      getSymbolIndexer: () => undefined,
      getWorkspaceRoot: () => '/ws',
      getHostWorkspaceRoots: () => ['/ws'],
      logger: { warn: jest.fn() },
    });
    const res = await callTool(
      'ptah_code_reindex',
      {},
      { ptahAPI: buildPtahAPIStub({ code }) },
    );

    const { text, isError } = resultOf(res);
    expect(isError).toBe(true);
    expect(text).toContain('CodeSymbolIndexer not available');
  });

  it('returns an error result when the code namespace is absent', async () => {
    const res = await callTool('ptah_code_reindex', {});
    expect(resultOf(res).isError).toBe(true);
  });

  it('ptah_code_search_symbols runs the freshness check and surfaces the index block', async () => {
    const indexWorkspace = jest.fn(() => new Promise<never>(() => undefined));
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockResolvedValue({ hits: [], bm25Only: false }),
      getIndexFreshness: jest
        .fn()
        .mockResolvedValue({ symbolCount: 0, newestUpdatedAt: null }),
    };
    const code = buildCodeNamespace({
      getCodeSymbolSearch: () => reader,
      getMemorySearch: () => undefined,
      getSymbolIndexer: () =>
        ({ indexWorkspace }) as unknown as CodeSymbolIndexer,
      getWorkspaceRoot: () => '/ws',
      getHostWorkspaceRoots: () => ['/ws'],
      logger: { warn: jest.fn() },
    });

    const res = await callTool(
      'ptah_code_search_symbols',
      { query: 'login' },
      { ptahAPI: buildPtahAPIStub({ code }) },
    );
    await flush();

    expect(reader.getIndexFreshness).toHaveBeenCalledWith('/ws');
    expect(indexWorkspace).toHaveBeenCalledWith('/ws', {
      userInitiated: false,
    });
    const body = JSON.parse(resultOf(res).text) as { index: unknown };
    expect(body.index).toEqual({
      symbolCount: 0,
      indexAgeMs: null,
      reindexStarted: true,
      reindexInFlight: true,
    });
  });
});

describe('protocol-handlers › ptah_get_symbol_index paging (TASK_2026_559 Batch 9)', () => {
  /** A worktree-length root, so entry paths are as long as on this repo (135 chars on average). */
  const ROOT =
    'D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract';
  /** Symbols per file, cycled: median 1, 90th percentile 8, as on this repo's own index. */
  const SYMBOL_COUNTS = [1, 1, 1, 2, 1, 3, 1, 8, 1, 2];

  let spoolRoot: string;

  beforeEach(() => {
    spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b9-'));
  });

  afterEach(() => {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  });

  /** A 2,655-file index (the audited size), inserted out of path order. */
  function auditSizedIndex(): SymbolIndexEntry[] {
    return Array.from({ length: 2_655 }, (_, i) => {
      const n = 2_654 - i;
      const id = String(n).padStart(4, '0');
      return {
        file: `${ROOT}/libs/backend/library-${n % 23}/src/lib/feature-${n % 7}/component-${id}.service.ts`,
        symbols: Array.from(
          { length: SYMBOL_COUNTS[n % SYMBOL_COUNTS.length] },
          (_, s) => `ComponentService${id}Export${s}`,
        ),
      };
    });
  }

  type SymbolIndexDependencies = PtahAPI['dependencies'] & {
    getSymbolIndex: jest.Mock;
    getGraphCoverage: jest.Mock;
  };

  function dependenciesOver(
    entries: SymbolIndexEntry[],
    coverage?: { graphedFiles: number; discoveredFiles: number },
  ): SymbolIndexDependencies {
    return {
      isBuilt: jest.fn().mockResolvedValue(true),
      getSymbolIndex: jest.fn(
        async (_root: string | undefined, query: ParsedSymbolIndexQuery) =>
          pageSymbolIndex(entries, query, ROOT),
      ),
      getGraphCoverage: jest.fn().mockResolvedValue(coverage),
    } as unknown as SymbolIndexDependencies;
  }

  function callTool(
    args: Record<string, unknown>,
    dependencies: PtahAPI['dependencies'],
    getInfo: jest.Mock = jest.fn().mockResolvedValue({ path: ROOT }),
  ): Promise<MCPResponse> {
    return handleMCPRequest(
      makeRequest({
        id: 'b9-symbol-index',
        method: 'tools/call',
        params: { name: 'ptah_get_symbol_index', arguments: args },
        _callerWorkspaceRoot: spoolRoot,
      }),
      buildDeps({
        workspaceProvider: knownFolders(spoolRoot),
        ptahAPI: buildPtahAPIStub({
          workspace: { getInfo } as unknown as PtahAPI['workspace'],
          dependencies,
        }),
      }),
    );
  }

  function resultOf(res: MCPResponse): { text: string; isError: boolean } {
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    return { text: result.content[0].text, isError: result.isError === true };
  }

  interface PageBody {
    count: number;
    total: number;
    offset: number;
    nextOffset?: number;
    files: SymbolIndexEntry[];
  }

  it('keeps a default call on a 2,655-file index within both budget limits, whole and unreduced', async () => {
    const { text, isError } = resultOf(
      await callTool({}, dependenciesOver(auditSizedIndex())),
    );

    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
    );
    expect(text).not.toContain('[reduced:');
    const body = JSON.parse(text) as PageBody;
    expect(body.count).toBe(SYMBOL_INDEX_DEFAULT_LIMIT);
    expect(body.total).toBe(2_655);
    expect(body.offset).toBe(0);
    expect(body.nextOffset).toBe(SYMBOL_INDEX_DEFAULT_LIMIT);
    const files = body.files.map((entry) => entry.file);
    expect(files).toEqual([...files].sort());
  });

  it('passes the defaults to the namespace when the tool gets no arguments', async () => {
    const dependencies = dependenciesOver(auditSizedIndex());
    await callTool({}, dependencies);
    expect(dependencies.getSymbolIndex).toHaveBeenCalledWith(undefined, {
      limit: SYMBOL_INDEX_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it('passes a normalised prefix, the limit and the offset to the namespace', async () => {
    const dependencies = dependenciesOver(auditSizedIndex());
    await callTool(
      { pathPrefix: '.\\libs\\backend\\\\library-1\\', limit: 5, offset: 10 },
      dependencies,
    );
    expect(dependencies.getSymbolIndex).toHaveBeenCalledWith(undefined, {
      pathPrefix: 'libs/backend/library-1/',
      limit: 5,
      offset: 10,
    });
  });

  it('ends a page early at the budget, with count and nextOffset recomputed, so paging continues where it stopped', async () => {
    const heavy = Array.from({ length: 100 }, (_, i) => ({
      file: `${ROOT}/libs/heavy/file-${String(i).padStart(3, '0')}.ts`,
      symbols: Array.from({ length: 40 }, (_, s) => `HeavyExport${i}x${s}`),
    }));
    const dependencies = dependenciesOver(heavy);

    const firstText = resultOf(
      await callTool({ limit: 50 }, dependencies),
    ).text;
    expect(firstText).not.toContain('[reduced:');
    const first = JSON.parse(firstText) as PageBody;
    expect(first.count).toBeGreaterThanOrEqual(1);
    expect(first.count).toBeLessThan(50);
    expect(first.files).toHaveLength(first.count);
    expect(first.nextOffset).toBe(first.count);
    expect(first.total).toBe(100);

    const secondText = resultOf(
      await callTool({ limit: 50, offset: first.nextOffset }, dependencies),
    ).text;
    expect(secondText.length).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_CHARS,
    );
    const second = JSON.parse(secondText) as PageBody;
    expect(second.offset).toBe(first.nextOffset);
    expect(second.files[0].file).toBe(heavy[first.count].file);
  });

  // Batch 9 revision round 1 (review F1): a file whose entry alone is over the
  // budget no longer reaches the budget's cut, which made the page invalid JSON.
  interface OversizedBody {
    file: string;
    symbolCount: number;
    truncated: true;
    symbolsFile?: string;
    symbolsFileError?: string;
    symbols: string[];
  }

  const hugeEntry = (name: string): SymbolIndexEntry => ({
    file: `${ROOT}/libs/huge/${name}.ts`,
    symbols: Array.from({ length: 1_500 }, (_, s) => `HugeExport${s}`),
  });

  /** A page's text, asserted to be one unreduced, in-budget JSON value. */
  function parsedPage(text: string): PageBody {
    expect(text).not.toContain('[reduced:');
    expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
    );
    return JSON.parse(text) as PageBody;
  }

  /** Every page from offset 0 until nextOffset is absent. */
  async function allPages(
    dependencies: PtahAPI['dependencies'],
  ): Promise<PageBody[]> {
    const pages: PageBody[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined && pages.length < 50) {
      const page = parsedPage(
        resultOf(await callTool({ offset }, dependencies)).text,
      );
      pages.push(page);
      offset = page.nextOffset;
    }
    return pages;
  }

  it('returns an oversized entry in the middle as valid JSON, and paging continues past it with its symbols recoverable', async () => {
    const entries = [
      { file: `${ROOT}/libs/huge/a-before.ts`, symbols: ['Before'] },
      hugeEntry('m-middle'),
      { file: `${ROOT}/libs/huge/z-after.ts`, symbols: ['After'] },
    ];
    const pages = await allPages(dependenciesOver(entries));

    // Every file is visited once, in order.
    expect(pages.flatMap((page) => page.files.map((f) => f.file))).toEqual(
      entries.map((entry) => entry.file),
    );
    const withHuge = pages.find((page) =>
      page.files.some((f) => f.file === entries[1].file),
    ) as PageBody;
    expect(withHuge.count).toBe(1);
    expect(withHuge.files).toHaveLength(1);
    expect(withHuge.nextOffset).toBe(withHuge.offset + 1);
    const huge = withHuge.files[0] as unknown as OversizedBody;
    expect(huge.truncated).toBe(true);
    expect(huge.symbolCount).toBe(1_500);
    expect(huge.symbols.length).toBeGreaterThan(0);
    expect(huge.symbols.length).toBeLessThan(1_500);
    expect(huge.symbols).toEqual(
      entries[1].symbols.slice(0, huge.symbols.length),
    );
    expect(huge.symbolsFileError).toBeUndefined();

    // The whole entry is recoverable from the named file, under the spool root.
    const symbolsFile = huge.symbolsFile as string;
    expect(path.resolve(symbolsFile).startsWith(path.resolve(spoolRoot))).toBe(
      true,
    );
    expect(JSON.parse(fs.readFileSync(symbolsFile, 'utf8'))).toEqual(
      entries[1],
    );
  });

  it('returns an oversized final entry as valid JSON with no nextOffset, its symbols recoverable', async () => {
    const entries = [
      { file: `${ROOT}/libs/huge/a-first.ts`, symbols: ['First'] },
      hugeEntry('z-last'),
    ];
    const dependencies = dependenciesOver(entries);

    const first = parsedPage(resultOf(await callTool({}, dependencies)).text);
    expect(first.files.map((f) => f.file)).toEqual([entries[0].file]);
    expect(first.nextOffset).toBe(1);

    const last = parsedPage(
      resultOf(await callTool({ offset: first.nextOffset }, dependencies)).text,
    );
    expect(last).toMatchObject({ count: 1, total: 2, offset: 1 });
    expect(last).not.toHaveProperty('nextOffset');
    const huge = last.files[0] as unknown as OversizedBody;
    expect(huge.file).toBe(entries[1].file);
    expect(huge.symbolCount).toBe(1_500);
    expect(
      JSON.parse(fs.readFileSync(huge.symbolsFile as string, 'utf8')),
    ).toEqual(entries[1]);
  });

  it('returns a lone oversized entry as valid JSON', async () => {
    const page = parsedPage(
      resultOf(await callTool({}, dependenciesOver([hugeEntry('only')]))).text,
    );
    expect(page).toMatchObject({ count: 1, total: 1, offset: 0 });
    expect(page).not.toHaveProperty('nextOffset');
    expect((page.files[0] as unknown as OversizedBody).truncated).toBe(true);
  });

  it('names the spool failure inside a valid page when the symbols cannot be saved', async () => {
    // A file where the spool directory's parent must be: the save fails.
    fs.writeFileSync(path.join(spoolRoot, '.ptah'), 'not a directory');
    const page = parsedPage(
      resultOf(await callTool({}, dependenciesOver([hugeEntry('only')]))).text,
    );
    const huge = page.files[0] as unknown as OversizedBody;
    expect(huge.truncated).toBe(true);
    expect(huge.symbolCount).toBe(1_500);
    expect(huge.symbolsFile).toBeUndefined();
    expect(huge.symbolsFileError).toMatch(/^[A-Za-z]+$/);
    expect(huge.symbols.length).toBeGreaterThan(0);
  });

  // Round 2 review R2-M1: the reviewer's token-heavy path (6,485 chars, under
  // the char ceiling but over the token ceiling even with no symbols).
  const tokenHeavyEntry = (): SymbolIndexEntry => ({
    file: 'C:/' + Array(810).fill('deepabc').join('/') + '.ts',
    symbols: ['S'],
  });

  interface SkippedBody extends PageBody {
    error?: string;
    symbolsFile?: string;
    symbolsFileError?: string;
  }

  it('skips an entry whose metadata alone is over the budget with a valid JSON error, and paging advances (spool fails)', async () => {
    fs.writeFileSync(path.join(spoolRoot, '.ptah'), 'not a directory');
    const heavy = tokenHeavyEntry();
    expect(heavy.file.length).toBeLessThan(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    const entries = [heavy, { file: 'C:/z-after.ts', symbols: ['After'] }];
    const dependencies = dependenciesOver(entries, {
      graphedFiles: 5_000,
      discoveredFiles: 5_354,
    });

    const first = parsedPage(
      resultOf(await callTool({}, dependencies)).text,
    ) as SkippedBody;
    expect(first).toMatchObject({
      count: 0,
      total: 2,
      offset: 0,
      nextOffset: 1,
      files: [],
      incomplete: true,
      graphedFiles: 5_000,
      discoveredFiles: 5_354,
    });
    expect(first.error).toMatch(/skipped/);
    expect(first.symbolsFile).toBeUndefined();
    expect(first.symbolsFileError).toMatch(/^[A-Za-z]+$/);

    const second = parsedPage(
      resultOf(await callTool({ offset: first.nextOffset }, dependencies)).text,
    );
    expect(second.files).toEqual([entries[1]]);
    expect(second).not.toHaveProperty('nextOffset');
  });

  it('names the saved entry when a metadata-only-oversized entry was spooled', async () => {
    const heavy = tokenHeavyEntry();
    const page = parsedPage(
      resultOf(await callTool({}, dependenciesOver([heavy]))).text,
    ) as SkippedBody;
    expect(page).toMatchObject({ count: 0, total: 1, offset: 0, files: [] });
    expect(page).not.toHaveProperty('nextOffset');
    expect(page.error).toMatch(/skipped/);
    expect(
      JSON.parse(fs.readFileSync(page.symbolsFile as string, 'utf8')),
    ).toEqual(heavy);
  });

  // Batch 9 revision round 1 (review F3, User Decision 14).
  it('adds no completeness fields when the graph covers every discovered file', async () => {
    const dependencies = dependenciesOver(auditSizedIndex(), {
      graphedFiles: 2_655,
      discoveredFiles: 2_655,
    });
    const page = parsedPage(resultOf(await callTool({}, dependencies)).text);
    expect(dependencies.getGraphCoverage).toHaveBeenCalledWith(undefined);
    expect(page).not.toHaveProperty('incomplete');
    expect(page).not.toHaveProperty('graphedFiles');
    expect(page).not.toHaveProperty('discoveredFiles');
  });

  it('says incomplete, with both counts, when the graph cap dropped files', async () => {
    const page = parsedPage(
      resultOf(
        await callTool(
          {},
          dependenciesOver(auditSizedIndex(), {
            graphedFiles: 5_000,
            discoveredFiles: 5_354,
          }),
        ),
      ).text,
    );
    expect(page).toMatchObject({
      count: SYMBOL_INDEX_DEFAULT_LIMIT,
      nextOffset: SYMBOL_INDEX_DEFAULT_LIMIT,
      incomplete: true,
      graphedFiles: 5_000,
      discoveredFiles: 5_354,
    });
  });

  it('keeps the completeness fields on an empty page', async () => {
    const page = parsedPage(
      resultOf(
        await callTool(
          { pathPrefix: 'apps/' },
          dependenciesOver(auditSizedIndex(), {
            graphedFiles: 5_000,
            discoveredFiles: 5_354,
          }),
        ),
      ).text,
    );
    expect(page).toEqual({
      count: 0,
      total: 0,
      offset: 0,
      incomplete: true,
      graphedFiles: 5_000,
      discoveredFiles: 5_354,
      files: [],
    });
  });

  it('answers a prefix that matches nothing with an empty page and no nextOffset', async () => {
    const { text, isError } = resultOf(
      await callTool(
        { pathPrefix: 'apps/' },
        dependenciesOver(auditSizedIndex()),
      ),
    );
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      count: 0,
      total: 0,
      offset: 0,
      files: [],
    });
  });

  it.each([
    ['limit 0', { limit: 0 }, '"limit"'],
    ['a limit over the max', { limit: SYMBOL_INDEX_MAX_LIMIT + 1 }, '"limit"'],
    ['a fractional limit', { limit: 2.5 }, '"limit"'],
    ['a string limit', { limit: '10' }, '"limit"'],
    ['a negative offset', { offset: -1 }, '"offset"'],
    ['a fractional offset', { offset: 1.5 }, '"offset"'],
    ['a non-string prefix', { pathPrefix: 5 }, '"pathPrefix"'],
    ['a .. prefix', { pathPrefix: '../outside' }, '".."'],
    ['.. inside a Windows prefix', { pathPrefix: 'libs\\..\\..\\x' }, '".."'],
    ['a drive-relative prefix', { pathPrefix: 'C:libs' }, 'drive-relative'],
  ])('rejects %s before building the graph', async (_label, args, expected) => {
    const getInfo = jest.fn();
    const dependencies = dependenciesOver(auditSizedIndex());
    const { text, isError } = resultOf(
      await callTool(args, dependencies, getInfo),
    );
    expect(isError).toBe(true);
    expect(text).toContain(expected);
    expect(getInfo).not.toHaveBeenCalled();
    expect(dependencies.getSymbolIndex).not.toHaveBeenCalled();
  });
});

describe('protocol-handlers › dependency graph background build (TASK_2026_559 Batch 9b)', () => {
  /** The bound a cold call is held to (the acceptance criterion). */
  const BOUNDED_WAIT_MS = 2_000;
  const root = path.resolve('/ws-9b');

  /** Only the timers: the detached build chain is flushed with setImmediate. */
  const FAKE_TIMERS_ONLY = {
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'queueMicrotask',
      'performance',
      'Date',
      'hrtime',
    ] as Array<
      | 'nextTick'
      | 'setImmediate'
      | 'clearImmediate'
      | 'queueMicrotask'
      | 'performance'
      | 'Date'
      | 'hrtime'
    >,
  };

  interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
  }

  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  interface BuildSummary {
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    builtAt: number;
    error?: string;
  }

  const BUILT: BuildSummary = {
    nodeCount: 2,
    edgeCount: 1,
    unresolvedCount: 0,
    builtAt: 1,
  };

  /**
   * A dependencies namespace whose every build waits on a deferred the test
   * settles. A build that settles without `error` publishes the graph while
   * its reserved generation is still the root's (the service's rule);
   * `evict()` drops the generation and the graph, as the service does.
   */
  function harness(options: { built?: boolean } = {}) {
    const state = {
      built: options.built === true,
      generation: undefined as number | undefined,
      lastGeneration: 0,
    };
    const builds: Array<Deferred<BuildSummary>> = [];
    const buildGraph = jest.fn(
      (
        _files: string[],
        _root: string,
        _discovered?: number,
        buildOptions?: { yieldToForeground?: boolean; generation?: number },
      ) => {
        const build = deferred<BuildSummary>();
        builds.push(build);
        return build.promise.then((summary) => {
          if (
            summary.error === undefined &&
            buildOptions?.generation === state.generation
          ) {
            state.built = true;
          }
          return summary;
        });
      },
    );
    const findFiles = jest.fn().mockResolvedValue(['src/a.ts', 'src/b.ts']);
    const getInfo = jest.fn().mockResolvedValue({ path: root });
    const logger = createMockLogger();
    const ptahAPI = buildPtahAPIStub({
      workspace: { getInfo } as unknown as PtahAPI['workspace'],
      search: { findFiles } as unknown as PtahAPI['search'],
      dependencies: {
        isBuilt: jest.fn(async () => state.built),
        reserveGraphBuild: jest.fn(() => {
          state.lastGeneration += 1;
          state.generation = state.lastGeneration;
          return state.generation;
        }),
        getGraphBuildState: jest.fn(() => ({
          generation: state.generation,
          building: false,
        })),
        buildGraph,
        getDependents: jest.fn().mockResolvedValue([path.join(root, 'b.ts')]),
        getDependencies: jest.fn().mockResolvedValue([path.join(root, 'c.ts')]),
        getGraphCoverageForFile: jest.fn().mockResolvedValue(undefined),
        getSymbolIndex: jest.fn(
          async (_root: string | undefined, query: ParsedSymbolIndexQuery) =>
            pageSymbolIndex(
              [{ file: path.join(root, 'src/a.ts'), symbols: ['A'] }],
              query,
              root,
            ),
        ),
        getGraphCoverage: jest.fn().mockResolvedValue(undefined),
      } as unknown as PtahAPI['dependencies'],
    });
    const deps = buildDeps({ ptahAPI, logger: asLogger(logger) });
    return {
      state,
      builds,
      buildGraph,
      findFiles,
      getInfo,
      logger,
      deps,
      evict(): void {
        state.generation = undefined;
        state.built = false;
      },
    };
  }

  interface ToolResult {
    body: Record<string, unknown>;
    text: string;
    isError: boolean;
  }

  function toResult(res: MCPResponse): ToolResult {
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const text = result.content[0].text;
    return {
      body: JSON.parse(text) as Record<string, unknown>,
      text,
      isError: result.isError === true,
    };
  }

  /** Let the detached build chain run to its next wait. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  describe.each([
    ['ptah_get_dependents', { file: 'src/a.ts' }, 'dependents'],
    ['ptah_get_dependencies', { file: 'src/a.ts' }, 'dependencies'],
    ['ptah_get_symbol_index', {}, 'files'],
  ])('%s', (toolName, args, answerField) => {
    function call(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<MCPResponse> {
      return handleMCPRequest(
        makeRequest({
          id,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
        deps,
      );
    }

    /** One call, with the fake clock moved past the bounded wait. */
    async function callPastWait(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<ToolResult> {
      const pending = call(deps, id);
      // The build starts on a later macrotask (a real setImmediate), as in
      // production, long before the bound's timer fires.
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      return toResult(await pending);
    }

    beforeEach(() => {
      jest.useFakeTimers(FAKE_TIMERS_ONLY);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('answers a cold call with a small building status within the bounded wait', async () => {
      const h = harness();
      const { body, text, isError } = await callPastWait(h.deps, 'cold');

      expect(isError).toBe(false);
      expect(Object.keys(body)[0]).toBe('status');
      expect(body).toEqual({
        status: 'building',
        retryAfterMs: expect.any(Number),
        filesDiscovered: 2,
        message: expect.stringContaining('retryAfterMs'),
      });
      expect(body['retryAfterMs']).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(
        getToolResultBudget(toolName).chars,
      );
      // The build runs in the background, governed, under the read root and
      // the generation reserved before discovery.
      expect(h.buildGraph).toHaveBeenCalledWith(
        [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
        root,
        2,
        { yieldToForeground: true, generation: 1 },
      );
    });

    it('answers normally once the background build has finished', async () => {
      const h = harness();
      expect((await callPastWait(h.deps, 'first')).body['status']).toBe(
        'building',
      );

      h.builds[0].resolve(BUILT);
      await flush();
      const { body, isError } = toResult(await call(h.deps, 'later'));

      expect(isError).toBe(false);
      expect(body).not.toHaveProperty('status');
      expect(body).toHaveProperty(answerField);
      expect(h.buildGraph).toHaveBeenCalledTimes(1);
    });

    it('answers on the first call when the build finishes inside the wait', async () => {
      const h = harness();
      const pending = call(h.deps, 'small');
      await flush();
      h.builds[0].resolve(BUILT);
      const { body } = toResult(await pending);

      expect(body).not.toHaveProperty('status');
      expect(body).toHaveProperty(answerField);
    });

    it('starts exactly one build for concurrent cold calls', async () => {
      const h = harness();
      const pending = Array.from({ length: 5 }, (_, i) =>
        call(h.deps, `concurrent-${i}`),
      );
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      const results = (await Promise.all(pending)).map(toResult);

      for (const { body } of results) {
        expect(body['status']).toBe('building');
      }
      expect(h.findFiles).toHaveBeenCalledTimes(1);
      expect(h.buildGraph).toHaveBeenCalledTimes(1);
    });

    it('answers a warm graph at once without starting a build', async () => {
      const h = harness({ built: true });
      // No clock movement: a warm call must not wait on any timer.
      const { body } = toResult(await call(h.deps, 'warm'));

      expect(body).not.toHaveProperty('status');
      expect(body).toHaveProperty(answerField);
      expect(h.buildGraph).not.toHaveBeenCalled();
      expect(h.findFiles).not.toHaveBeenCalled();
    });

    it('reports a failed build to the waiting call, then rebuilds on the next call', async () => {
      const h = harness();
      const pending = call(h.deps, 'fails');
      await flush();
      h.builds[0].resolve({ ...BUILT, error: `EACCES ${root}/secret.ts` });
      const failed = toResult(await pending);

      expect(failed.isError).toBe(true);
      expect(Object.keys(failed.body)[0]).toBe('status');
      expect(failed.body['status']).toBe('failed');
      // Fixed text: neither the raw error nor a path reaches the caller or the log.
      expect(failed.text).not.toContain('EACCES');
      expect(failed.text).not.toContain('secret');
      const warn = h.logger.warn.mock.calls.find(
        (c) => c[0] === '[MCP] background dependency-graph build failed',
      );
      expect(warn).toBeDefined();
      expect(JSON.stringify(warn)).not.toContain('secret');

      // The latch is clear: the next call starts a new build.
      const retried = await callPastWait(h.deps, 'retry');
      expect(retried.body['status']).toBe('building');
      expect(h.buildGraph).toHaveBeenCalledTimes(2);
    });

    it('reports a failure that ended between calls once, then rebuilds', async () => {
      const h = harness();
      expect((await callPastWait(h.deps, 'cold')).body['status']).toBe(
        'building',
      );
      h.builds[0].reject(new Error(`boom at ${root}`));
      await flush();

      const reported = await callPastWait(h.deps, 'reported');
      expect(reported.isError).toBe(true);
      expect(reported.body['status']).toBe('failed');
      expect(h.buildGraph).toHaveBeenCalledTimes(1);

      const rebuilt = await callPastWait(h.deps, 'rebuilt');
      expect(rebuilt.body['status']).toBe('building');
      expect(h.buildGraph).toHaveBeenCalledTimes(2);
    });

    it('reports a failed discovery as a failed build', async () => {
      const h = harness();
      h.findFiles.mockRejectedValueOnce(new Error('glob failed'));
      const { body, isError } = await callPastWait(h.deps, 'discovery');

      expect(isError).toBe(true);
      expect(body['status']).toBe('failed');
      expect(h.buildGraph).not.toHaveBeenCalled();
    });

    // Review r1 F4: reads use the caller-aware read root, as every other
    // read tool does; only spool writes are held to host-opened folders.
    it('builds and answers under a declared worktree root the host did not open', async () => {
      const h = harness();
      const worktree = path.resolve('/ws-9b-worktree');
      // The caller-aware root (`workspace.getInfo`) resolves the declaration.
      h.getInfo.mockResolvedValue({ path: worktree });
      const pending = handleMCPRequest(
        makeRequest({
          id: 'declared-worktree',
          method: 'tools/call',
          params: { name: toolName, arguments: args },
          _callerWorkspaceRoot: worktree,
        }),
        // The host opened only the parent repository.
        { ...h.deps, workspaceProvider: knownFolders(root) },
      );
      await flush();
      h.builds[0].resolve(BUILT);
      const { body, isError } = toResult(await pending);

      expect(isError).toBe(false);
      expect(body).not.toHaveProperty('status');
      expect(body).toHaveProperty(answerField);
      expect(h.findFiles).toHaveBeenCalledTimes(1);
      const [files, graphRoot] = h.buildGraph.mock.calls[0];
      expect(graphRoot).toBe(worktree);
      expect(files[0]).toBe(path.join(worktree, 'src/a.ts'));
      if (answerField !== 'files') {
        // A relative query resolves against the same root.
        expect(body['file']).toBe(path.join(worktree, 'src/a.ts'));
      }
    });
  });

  it('returns a cold call within the bound in real time while the build never ends', async () => {
    const h = harness();
    const started = Date.now();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'real-time',
        method: 'tools/call',
        params: { name: 'ptah_get_dependents', arguments: { file: 'a.ts' } },
      }),
      h.deps,
    );

    expect(Date.now() - started).toBeLessThanOrEqual(BOUNDED_WAIT_MS);
    expect(toResult(res).body['status']).toBe('building');
  });

  describe('job lifecycle (review r1)', () => {
    function callDependents(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<MCPResponse> {
      return handleMCPRequest(
        makeRequest({
          id,
          method: 'tools/call',
          params: { name: 'ptah_get_dependents', arguments: { file: 'a.ts' } },
        }),
        deps,
      );
    }

    async function callPastWait(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<ToolResult> {
      const pending = callDependents(deps, id);
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      return toResult(await pending);
    }

    beforeEach(() => {
      jest.useFakeTimers(FAKE_TIMERS_ONLY);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('keys the latch by the normalized read root: two spellings share one build', async () => {
      const h = harness();
      h.getInfo
        .mockResolvedValueOnce({ path: root })
        .mockResolvedValueOnce({ path: `${root}${path.sep}` });
      const first = callDependents(h.deps, 'spelling-1');
      const second = callDependents(h.deps, 'spelling-2');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);

      expect(toResult(await first).body['status']).toBe('building');
      expect(toResult(await second).body['status']).toBe('building');
      expect(h.findFiles).toHaveBeenCalledTimes(1);
      expect(h.buildGraph).toHaveBeenCalledTimes(1);
    });

    // Review r1 F5: an eviction drops the dispatcher's job at once, and the
    // obsolete job's late failure does not touch its replacement.
    it('replaces a job obsoleted by an eviction, and ignores its late failure', async () => {
      const h = harness();
      expect((await callPastWait(h.deps, 'before')).body['status']).toBe(
        'building',
      );

      h.evict();
      const replaced = await callPastWait(h.deps, 'after-evict');
      expect(replaced.body['status']).toBe('building');
      expect(h.findFiles).toHaveBeenCalledTimes(2);
      expect(h.buildGraph).toHaveBeenCalledTimes(2);

      // The obsolete build fails late: nothing is reported for it.
      h.builds[0].reject(new Error('late failure'));
      await flush();
      const joined = await callPastWait(h.deps, 'joined');
      expect(joined.isError).toBe(false);
      expect(joined.body['status']).toBe('building');
      expect(h.buildGraph).toHaveBeenCalledTimes(2);

      // The replacement publishes and answers.
      h.builds[1].resolve(BUILT);
      await flush();
      const answered = toResult(await callDependents(h.deps, 'answered'));
      expect(answered.body).not.toHaveProperty('status');
      expect(answered.body).toHaveProperty('dependents');
    });

    it('does not report the failure of a build an eviction superseded', async () => {
      const h = harness();
      await callPastWait(h.deps, 'cold');
      h.builds[0].reject(new Error('failed'));
      await flush();
      h.evict();

      const next = await callPastWait(h.deps, 'after-evict');
      expect(next.isError).toBe(false);
      expect(next.body['status']).toBe('building');
      expect(h.buildGraph).toHaveBeenCalledTimes(2);
    });
  });

  // Review r1 F3: synchronous parsing must not hold the call past its bound.
  it('answers within the bound while every file costs synchronous CPU, and the host keeps ticking', async () => {
    const PARSE_COST_MS = 130;
    const busy = (ms: number): void => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // Burn CPU on the host thread, as a synchronous parse does.
      }
    };
    const analyzeSource = jest.fn(async () => {
      busy(PARSE_COST_MS);
      return Result.ok({
        imports: [],
        exports: [{ name: 'A', kind: 'function' }],
        functions: [],
        classes: [],
      });
    });
    const graph = new DependencyGraphService(
      { analyzeSource } as unknown as AstAnalysisService,
      {
        readFile: jest.fn(async () => 'source'),
      } as unknown as FileSystemService,
      asLogger(createMockLogger()),
    );
    const files = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        workspace: {
          getInfo: jest.fn().mockResolvedValue({ path: root }),
        } as unknown as PtahAPI['workspace'],
        search: {
          findFiles: jest.fn().mockResolvedValue(files),
        } as unknown as PtahAPI['search'],
        dependencies: buildDependencyNamespace({
          dependencyGraph: graph,
          workspaceProvider: { getWorkspaceRoot: () => root },
        } as unknown as AnalysisNamespaceDependencies),
      }),
    });

    // An independent heartbeat: the longest the host went without a timer.
    let last = Date.now();
    let maxGap = 0;
    const heartbeat = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const started = Date.now();
    let elapsed = 0;
    try {
      const res = await handleMCPRequest(
        makeRequest({
          id: 'cpu-bound',
          method: 'tools/call',
          params: { name: 'ptah_get_dependents', arguments: { file: 'a.ts' } },
        }),
        deps,
      );
      elapsed = Date.now() - started;
      expect(toResult(res).body['status']).toBe('building');
    } finally {
      clearInterval(heartbeat);
      // Stop the build at its next file, and let it wind down.
      graph.evict(root);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 3 * PARSE_COST_MS),
      );
    }

    expect(elapsed).toBeLessThanOrEqual(BOUNDED_WAIT_MS);
    // One or two parses between ticks, never the whole build (40 × 130 ms).
    expect(maxGap).toBeLessThan(5 * PARSE_COST_MS);
    // It was really parsing while the call waited, and stopped when evicted.
    expect(analyzeSource.mock.calls.length).toBeGreaterThan(2);
    expect(analyzeSource.mock.calls.length).toBeLessThan(files.length);
  }, 15_000);

  /**
   * Eviction and an explicit rebuild while a background build is in flight:
   * the real graph service and namespace; only the parser and file reads are
   * stubbed, and every read waits on a gate until the test opens it.
   */
  describe('with the real graph service', () => {
    function realSetup() {
      const gate = deferred<void>();
      let gated = true;
      const readFile = jest.fn(async () => {
        if (gated) await gate.promise;
        return 'source';
      });
      const graph = new DependencyGraphService(
        {
          analyzeSource: jest.fn(async () =>
            Result.ok({
              imports: [],
              exports: [{ name: 'A', kind: 'function' }],
              functions: [],
              classes: [],
            }),
          ),
        } as unknown as AstAnalysisService,
        { readFile } as unknown as FileSystemService,
        asLogger(createMockLogger()),
      );
      const dependencies = buildDependencyNamespace({
        dependencyGraph: graph,
        workspaceProvider: { getWorkspaceRoot: () => root },
      } as unknown as AnalysisNamespaceDependencies);
      const findFiles = jest.fn().mockResolvedValue(['src/a.ts', 'src/b.ts']);
      const deps = buildDeps({
        ptahAPI: buildPtahAPIStub({
          workspace: {
            getInfo: jest.fn().mockResolvedValue({ path: root }),
          } as unknown as PtahAPI['workspace'],
          search: { findFiles } as unknown as PtahAPI['search'],
          dependencies,
        }),
      });
      return {
        graph,
        deps,
        findFiles,
        readFile,
        openGate(): void {
          gated = false;
          gate.resolve();
        },
        /** Later reads pass; a read already waiting stays stuck forever. */
        ungateNewReads(): void {
          gated = false;
        },
      };
    }

    function callSymbolIndex(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<MCPResponse> {
      return handleMCPRequest(
        makeRequest({
          id,
          method: 'tools/call',
          params: { name: 'ptah_get_symbol_index', arguments: {} },
        }),
        deps,
      );
    }

    function callDependents(
      deps: ProtocolHandlerDependencies,
      id: string,
    ): Promise<MCPResponse> {
      return handleMCPRequest(
        makeRequest({
          id,
          method: 'tools/call',
          params: { name: 'ptah_get_dependents', arguments: { file: 'a.ts' } },
        }),
        deps,
      );
    }

    beforeEach(() => {
      jest.useFakeTimers(FAKE_TIMERS_ONLY);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not publish a build whose root was evicted mid-build, and the next call rebuilds', async () => {
      const s = realSetup();
      const cold = callDependents(s.deps, 'evict-cold');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await cold).body['status']).toBe('building');

      s.graph.evict(root);
      s.openGate();
      await flush();
      // The stale build finished but did not publish; its latch is clear.
      expect(s.graph.isBuilt(root)).toBe(false);

      const next = callDependents(s.deps, 'evict-next');
      await flush();
      const { body } = toResult(await next);
      expect(body).not.toHaveProperty('status');
      expect(s.findFiles).toHaveBeenCalledTimes(2);
      expect(s.graph.isBuilt(root)).toBe(true);
    });

    it('keeps an explicit rebuild made during a background build, and answers from it', async () => {
      const s = realSetup();
      const cold = callDependents(s.deps, 'rebuild-cold');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await cold).body['status']).toBe('building');

      // An execute_code build of one file, started after the background one.
      const explicit = s.deps.ptahAPI.dependencies.buildGraph(
        [path.join(root, 'src/only.ts')],
        root,
      );
      s.openGate();
      await explicit;
      await flush();

      // The background build (two files) started earlier, so its finished
      // graph did not replace the explicit one.
      expect(s.graph.getCoverage(root)).toEqual({
        graphedFiles: 1,
        discoveredFiles: 1,
      });
      const { body } = toResult(await callDependents(s.deps, 'rebuild-next'));
      expect(body).not.toHaveProperty('status');
      expect(s.findFiles).toHaveBeenCalledTimes(1);
    });

    // Review r1 F1: the generation is reserved before discovery, so an
    // eviction while discovery is pending stops the build before it starts.
    it('does not build or publish when the root is evicted while discovery is pending', async () => {
      const s = realSetup();
      s.openGate();
      const discovery = deferred<string[]>();
      s.findFiles.mockReturnValueOnce(discovery.promise);
      const cold = callDependents(s.deps, 'discover-evict');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await cold).body['status']).toBe('building');

      s.graph.evict(root);
      discovery.resolve(['src/a.ts', 'src/b.ts']);
      await flush();
      expect(s.readFile).not.toHaveBeenCalled();
      expect(s.graph.isBuilt(root)).toBe(false);

      // The next call rediscovers and builds afresh.
      const next = callDependents(s.deps, 'discover-evict-next');
      await flush();
      expect(toResult(await next).body).not.toHaveProperty('status');
      expect(s.findFiles).toHaveBeenCalledTimes(2);
      expect(s.graph.isBuilt(root)).toBe(true);
    });

    // Review r1 F1: an explicit build started while discovery is pending
    // supersedes the background request, whose older list never replaces it.
    it('keeps an explicit build made while discovery is pending', async () => {
      const s = realSetup();
      s.openGate();
      const discovery = deferred<string[]>();
      s.findFiles.mockReturnValueOnce(discovery.promise);
      const cold = callDependents(s.deps, 'discover-explicit');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await cold).body['status']).toBe('building');

      await s.deps.ptahAPI.dependencies.buildGraph(
        [path.join(root, 'src/only.ts')],
        root,
      );
      discovery.resolve(['src/a.ts', 'src/b.ts']);
      await flush();

      expect(s.graph.getCoverage(root)).toEqual({
        graphedFiles: 1,
        discoveredFiles: 1,
      });
      // Only the explicit build read a file.
      expect(s.readFile).toHaveBeenCalledTimes(1);
      const { body } = toResult(
        await callDependents(s.deps, 'discover-explicit-next'),
      );
      expect(body).not.toHaveProperty('status');
      expect(s.findFiles).toHaveBeenCalledTimes(1);
    });

    // Review r1 F5: with the obsolete job's read stuck for ever, an eviction
    // still lets the next call start and finish a replacement build.
    it('starts a replacement build after an eviction while the old read never settles', async () => {
      const s = realSetup();
      const cold = callDependents(s.deps, 'stuck-cold');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await cold).body['status']).toBe('building');

      s.graph.evict(root);
      s.ungateNewReads();
      const next = callDependents(s.deps, 'stuck-next');
      await flush();
      const { body } = toResult(await next);

      expect(body).not.toHaveProperty('status');
      expect(body).toHaveProperty('dependents');
      expect(s.findFiles).toHaveBeenCalledTimes(2);
      expect(s.graph.isBuilt(root)).toBe(true);
    });

    // Review r1 F2: an empty graph answers, but does not hide a source file
    // created after it.
    it('finds a source file created after an empty graph was built', async () => {
      const s = realSetup();
      s.openGate();
      s.findFiles.mockResolvedValueOnce([]);
      const empty = callSymbolIndex(s.deps, 'empty');
      await flush();
      const emptyBody = toResult(await empty).body;
      expect(emptyBody).not.toHaveProperty('status');
      expect(emptyBody['total']).toBe(0);
      expect(s.graph.isBuilt(root)).toBe(true);

      // A source file appears; the default discovery now lists it.
      s.findFiles.mockResolvedValue(['src/new.ts']);
      const later = callSymbolIndex(s.deps, 'after-create');
      await flush();
      const { body } = toResult(await later);

      expect(body).not.toHaveProperty('status');
      expect(body['total']).toBe(1);
      expect(JSON.stringify(body['files'])).toContain('new.ts');
      expect(s.findFiles).toHaveBeenCalledTimes(2);
    });

    /** Build and answer the empty graph (discovery finds no source file). */
    async function publishEmptyGraph(
      s: ReturnType<typeof realSetup>,
    ): Promise<void> {
      s.openGate();
      s.findFiles.mockResolvedValueOnce([]);
      const empty = callSymbolIndex(s.deps, 'empty-first');
      await flush();
      expect(toResult(await empty).body['total']).toBe(0);
    }

    // Review r2 R2-B1: a refresh of an empty graph whose discovery has not
    // settled has not confirmed the graph is still empty.
    it('answers building, not the empty graph, while its refresh is still discovering', async () => {
      const s = realSetup();
      await publishEmptyGraph(s);

      const discovery = deferred<string[]>();
      s.findFiles.mockReturnValueOnce(discovery.promise);
      const held = callSymbolIndex(s.deps, 'empty-held');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      const heldResult = toResult(await held);
      expect(Object.keys(heldResult.body)[0]).toBe('status');
      expect(heldResult.body['status']).toBe('building');
      expect(heldResult.isError).toBe(false);

      discovery.resolve(['src/new.ts']);
      await flush();
      const { body } = toResult(
        await callSymbolIndex(s.deps, 'empty-released'),
      );
      expect(body).not.toHaveProperty('status');
      expect(body['total']).toBe(1);
      expect(JSON.stringify(body['files'])).toContain('new.ts');
    });

    // Review r2 R2-B1: an explicit build running over the empty graph is a
    // pending replacement, so the empty graph does not answer.
    it('answers building while an explicit build replaces the empty graph', async () => {
      const s = realSetup();
      await publishEmptyGraph(s);

      const explicitRead = deferred<void>();
      s.readFile.mockImplementationOnce(async () => {
        await explicitRead.promise;
        return 'source';
      });
      const explicit = s.deps.ptahAPI.dependencies.buildGraph(
        [path.join(root, 'src/only.ts')],
        root,
      );
      await flush();
      expect(s.graph.getBuildState(root).building).toBe(true);

      const during = callSymbolIndex(s.deps, 'empty-explicit');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      const duringResult = toResult(await during);
      expect(Object.keys(duringResult.body)[0]).toBe('status');
      expect(duringResult.body['status']).toBe('building');
      // It did not supersede the explicit build with a background one.
      expect(s.findFiles).toHaveBeenCalledTimes(1);

      explicitRead.resolve();
      await explicit;
      await flush();
      const { body } = toResult(
        await callSymbolIndex(s.deps, 'empty-explicit-done'),
      );
      expect(body['total']).toBe(1);
      expect(JSON.stringify(body['files'])).toContain('only.ts');
    });

    // Review r3 R3-S1: an empty build that finishes after the bounded wait is
    // delivered to the next call, which does not start another discovery;
    // the call after that rediscovers as before.
    it('delivers a slow empty build to the next call, then rediscovers', async () => {
      const s = realSetup();
      s.openGate();
      const slowEmpty = deferred<string[]>();
      s.findFiles.mockReturnValueOnce(slowEmpty.promise);
      const first = callSymbolIndex(s.deps, 'slow-empty-first');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await first).body['status']).toBe('building');

      slowEmpty.resolve([]);
      await flush();
      expect(s.graph.isBuilt(root)).toBe(true);

      // Every later discovery is slow too (held until the end).
      const heldRediscovery = deferred<string[]>();
      s.findFiles.mockReturnValue(heldRediscovery.promise);
      const second = callSymbolIndex(s.deps, 'slow-empty-second');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      const secondResult = toResult(await second);
      expect(secondResult.isError).toBe(false);
      expect(secondResult.body).not.toHaveProperty('status');
      expect(secondResult.body['total']).toBe(0);
      expect(s.findFiles).toHaveBeenCalledTimes(1);

      const third = callSymbolIndex(s.deps, 'slow-empty-third');
      await flush();
      await jest.advanceTimersByTimeAsync(BOUNDED_WAIT_MS);
      expect(toResult(await third).body['status']).toBe('building');
      expect(s.findFiles).toHaveBeenCalledTimes(2);

      heldRediscovery.resolve([]);
      await flush();
    });

    // Review r2 R2-M2: the waiting caller of a job a newer build superseded
    // is answered from the current graph, never with the old job's failure.
    it('answers a caller waiting on a superseded discovery from the newer graph when that discovery fails', async () => {
      const s = realSetup();
      s.openGate();
      const discovery = deferred<string[]>();
      s.findFiles.mockReturnValueOnce(discovery.promise);
      const waiting = callDependents(s.deps, 'obsolete-waiter');
      await flush();

      await s.deps.ptahAPI.dependencies.buildGraph(
        [path.join(root, 'src/only.ts')],
        root,
      );
      discovery.reject(new Error('discovery failed'));
      await flush();

      const result = toResult(await waiting);
      expect(result.isError).toBe(false);
      expect(result.body).not.toHaveProperty('status');
      expect(result.body).toHaveProperty('dependents');
      // Nothing is left for a later call to report either.
      const next = toResult(await callDependents(s.deps, 'obsolete-next'));
      expect(next.isError).toBe(false);
      expect(next.body).not.toHaveProperty('status');
    });
  });
});

// ---------------------------------------------------------------------------
// ptah_agent_status repeat throttle and ptah_agent_read window
// (TASK_2026_559 Batch 13). The clock is injected through `deps.now`.
// ---------------------------------------------------------------------------

describe('protocol-handlers › agent status throttle and read window (TASK_2026_559 Batch 13)', () => {
  const T0 = Date.parse('2026-09-26T10:00:00.000Z');
  const SESSION_A: Partial<MCPRequest> = { _callerSessionId: 'session-a' };
  const SESSION_B: Partial<MCPRequest> = { _callerSessionId: 'session-b' };

  function runningAgent(overrides: Record<string, unknown> = {}) {
    return {
      agentId: 'lane-1',
      cli: 'codex',
      task: 'review batch 13',
      workingDirectory: 'D:\\projects\\ws',
      status: 'running',
      startedAt: '2026-09-26T09:59:00.000Z',
      ...overrides,
    };
  }

  function statusHarness(status: jest.Mock) {
    const clock = { now: T0 };
    const deps = buildDeps({
      ptahAPI: buildPtahAPIStub({
        agent: { status } as unknown as PtahAPI['agent'],
      }),
      now: () => clock.now,
    });
    const call = (
      id: string,
      caller: Partial<MCPRequest> = SESSION_A,
      args: Record<string, unknown> = { agentId: 'lane-1' },
    ) =>
      handleMCPRequest(
        makeRequest({
          id,
          method: 'tools/call',
          params: { name: 'ptah_agent_status', arguments: args },
          ...caller,
        }),
        deps,
      );
    return { clock, call };
  }

  function textOf(res: MCPResponse): string {
    return (res.result as { content: Array<{ text: string }> }).content[0].text;
  }

  const unchangedLine = (iso: string, status: string) =>
    `Status unchanged since ${iso} (${status}). Wait for <agent-lane-completed> instead of polling.`;

  it('answers a repeat status call for the same agent within 60 s with one line, and the full body again after 60 s', async () => {
    const status = jest.fn().mockResolvedValue(runningAgent());
    const h = statusHarness(status);

    const first = textOf(await h.call('s1'));
    expect(first).toContain('## Agent Status');
    expect(first).toContain('**Status:** running');

    h.clock.now = T0 + 30_000;
    expect(textOf(await h.call('s2'))).toBe(
      unchangedLine('2026-09-26T10:00:00.000Z', 'running'),
    );

    // A throttled answer does not extend the window.
    h.clock.now = T0 + 60_001;
    expect(textOf(await h.call('s3'))).toContain('## Agent Status');
    expect(status).toHaveBeenCalledTimes(3);
  });

  it('returns the full body when the status changed inside the window', async () => {
    const status = jest
      .fn()
      .mockResolvedValueOnce(runningAgent())
      .mockResolvedValueOnce(
        runningAgent({ status: 'completed', exitCode: 0 }),
      );
    const h = statusHarness(status);

    await h.call('c1');
    h.clock.now = T0 + 5_000;
    const second = textOf(await h.call('c2'));
    expect(second).toContain('**Status:** completed');
    expect(second).toContain('**Exit Code:** 0');
  });

  it('returns the full body when a CLI session id appeared inside the window', async () => {
    const status = jest
      .fn()
      .mockResolvedValueOnce(runningAgent())
      .mockResolvedValueOnce(runningAgent({ cliSessionId: 'sess-42' }));
    const h = statusHarness(status);

    await h.call('i1');
    h.clock.now = T0 + 5_000;
    expect(textOf(await h.call('i2'))).toContain('**CLI Session ID:** sess-42');
  });

  it('never throttles an exited agent', async () => {
    const status = jest
      .fn()
      .mockResolvedValue(runningAgent({ status: 'failed', exitCode: 1 }));
    const h = statusHarness(status);

    for (const [i, offset] of [0, 1_000, 2_000].entries()) {
      h.clock.now = T0 + offset;
      const text = textOf(await h.call(`e${i}`));
      expect(text).toContain('**Status:** failed');
      expect(text).toContain('**Exit Code:** 1');
    }
  });

  it('never hides an error behind the throttle', async () => {
    const status = jest
      .fn()
      .mockResolvedValueOnce(runningAgent())
      .mockRejectedValueOnce(new Error('No agent found with id lane-1'));
    const h = statusHarness(status);

    await h.call('x1');
    h.clock.now = T0 + 1_000;
    const res = await h.call('x2');
    expect((res.result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toContain('No agent found with id lane-1');
  });

  it('throttles per caller: another session or agent asking about the same agent gets the full body', async () => {
    const status = jest.fn().mockResolvedValue(runningAgent());
    const h = statusHarness(status);

    await h.call('p1', SESSION_A);
    h.clock.now = T0 + 10_000;
    expect(textOf(await h.call('p2', SESSION_B))).toContain('## Agent Status');
    expect(textOf(await h.call('p3', SESSION_A))).toBe(
      unchangedLine('2026-09-26T10:00:00.000Z', 'running'),
    );
    expect(
      textOf(await h.call('p4', { _callerAgentId: 'parent-lane' })),
    ).toContain('## Agent Status');
    expect(textOf(await h.call('p5', { _callerAgentId: 'parent-lane' }))).toBe(
      unchangedLine('2026-09-26T10:00:10.000Z', 'running'),
    );
  });

  it('does not throttle a caller without an agent or session identity, nor the all-agents form', async () => {
    const status = jest.fn().mockResolvedValue(runningAgent());
    const h = statusHarness(status);

    await h.call('n1', {});
    h.clock.now = T0 + 1_000;
    expect(textOf(await h.call('n2', {}))).toContain('## Agent Status');

    status.mockResolvedValue([runningAgent()]);
    await h.call('n3', SESSION_A, {});
    expect(textOf(await h.call('n4', SESSION_A, {}))).toContain(
      '## Agent Status',
    );
  });

  describe('ptah_agent_read', () => {
    let spoolRoot: string;

    beforeEach(() => {
      spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b13-'));
    });

    afterEach(() => {
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    });

    /** `count` short lines `[<tag><n>] ok`, 1-based. */
    function shortLines(count: number, tag = 'L'): string[] {
      return Array.from({ length: count }, (_, i) => `[${tag}${i + 1}] ok`);
    }

    /**
     * `count` 200-char lines `[L<n>] …`; the last one carries FINAL_FAILURE,
     * the line a read-once-at-the-end caller must never lose.
     */
    function longLines(count: number): string[] {
      return Array.from({ length: count }, (_, i) => {
        const head =
          i === count - 1
            ? `[L${i + 1}] FINAL_FAILURE exit 1 `
            : `[L${i + 1}] step ok `;
        return head + 'x'.repeat(200 - head.length);
      });
    }

    /**
     * A `read` that windows each stream separately, the way
     * `AgentProcessManager.readOutput` does: the last 200 lines of each by
     * default, or `tail` lines starting at `offset`.
     */
    function streamReader(streams: { stdout: string[]; stderr?: string[] }) {
      const window = (lines: string[], tail?: number, offset?: number) => {
        const size = tail ?? 200;
        const start = offset ?? Math.max(0, lines.length - size);
        const shown = lines.slice(start, start + size);
        return {
          text: shown.length > 0 ? shown.join('\n') + '\n' : '',
          count: shown.length,
        };
      };
      return jest.fn(
        async (agentId: string, tail?: number, offset?: number) => {
          const stderrLines = streams.stderr ?? [];
          const out = window(streams.stdout, tail, offset);
          const err = window(stderrLines, tail, offset);
          const total = streams.stdout.length + stderrLines.length;
          return {
            agentId,
            stdout: out.text,
            stderr: err.text,
            lineCount: out.count + err.count,
            totalLines: total,
            omittedLines: total - out.count - err.count,
            stdoutTotalLines: streams.stdout.length,
            stderrTotalLines: stderrLines.length,
            truncated: false,
          };
        },
      );
    }

    const bufferReader = (total: number) =>
      streamReader({ stdout: shortLines(total) });

    /**
     * The `[<tag><n>]` markers visible in `text`, and every stated range
     * `Showing lines A-B of N` for that stream section.
     */
    function visibleMarkers(text: string, tag = 'L'): number[] {
      return [...text.matchAll(new RegExp(`\\[${tag}(\\d+)\\]`, 'g'))].map(
        (m) => Number(m[1]),
      );
    }

    function statedRanges(text: string): Array<[number, number, number]> {
      return [...text.matchAll(/Showing lines (\d+)-(\d+) of (\d+)/g)].map(
        (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
      );
    }

    /** A range covers exactly the markers shown, in order, with nothing else. */
    function expectExactRange(
      markers: number[],
      [first, last]: [number, number, number],
    ): void {
      expect(markers).toEqual(
        Array.from({ length: last - first + 1 }, (_, i) => first + i),
      );
    }

    function callRead(read: jest.Mock, args: Record<string, unknown>) {
      return handleMCPRequest(
        makeRequest({
          id: 'read-1',
          method: 'tools/call',
          params: { name: 'ptah_agent_read', arguments: args },
          _callerWorkspaceRoot: spoolRoot,
        }),
        buildDeps({
          ptahAPI: buildPtahAPIStub({
            agent: { read } as unknown as PtahAPI['agent'],
          }),
          workspaceProvider: knownFolders(spoolRoot),
        }),
      );
    }

    it('passes offset through to the agent namespace and renders the window', async () => {
      const read = bufferReader(500);
      const text = textOf(
        await callRead(read, { agentId: 'lane-1', offset: 100, tail: 50 }),
      );
      expect(read).toHaveBeenCalledWith('lane-1', 50, 100);
      expect(text).toContain(
        'Showing lines 101-150 of 500 (450 omitted; pass offset/tail to page)',
      );
    });

    it('rejects a non-numeric or negative offset instead of reading it as zero', async () => {
      for (const offset of ['100', -1]) {
        const read = bufferReader(10);
        const res = await callRead(read, { agentId: 'lane-1', offset });
        expect((res.result as { isError?: boolean }).isError).toBe(true);
        expect(textOf(res)).toContain('invalid ptah_agent_read arguments');
        expect(textOf(res)).toContain('offset');
        expect(read).not.toHaveBeenCalled();
      }
    });

    it('renders the omitted-lines line on the default call', async () => {
      const read = bufferReader(300);
      const text = textOf(await callRead(read, { agentId: 'lane-1' }));
      expect(text).toContain(
        'Showing lines 101-300 of 300 (100 omitted; pass offset/tail to page)',
      );
    });

    /** Within both limits, and left alone by the budget layer (no cut trailer). */
    function expectFitsUntouched(text: string): void {
      expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
        DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
      );
      expect(text).not.toContain('[reduced:');
    }

    /**
     * Review r2 R2-S1: a read that narrowed a stream's window names, in that
     * stream's notice, a spool file holding the whole window; returns the
     * spooled text. The file is under the injected temp root only.
     */
    function spooledWindow(text: string, range: string): string {
      const named = new RegExp(`Lines ${range} in full: (\\S+)`).exec(text);
      expect(named).not.toBeNull();
      const file = named?.[1] ?? '';
      expect(path.dirname(file)).toBe(
        path.join(spoolRoot, '.ptah', 'tmp', 'mcp-out'),
      );
      return fs.readFileSync(file, 'utf8');
    }

    function expectNoSpool(): void {
      expect(fs.existsSync(path.join(spoolRoot, '.ptah'))).toBe(false);
    }

    // Review r1 B1: the default read keeps the NEWEST lines that fit, and
    // the stated range is exactly what is shown.
    it.each([5_000, 200])(
      'keeps the final line of a %i-line buffer of long lines inline, with an exact range',
      async (total) => {
        const read = streamReader({ stdout: longLines(total) });
        const text = textOf(await callRead(read, { agentId: 'lane-1' }));

        expectFitsUntouched(text);
        expect(text).toContain(`[L${total}] FINAL_FAILURE`);
        const ranges = statedRanges(text);
        expect(ranges).toHaveLength(1);
        const [first, last, of] = ranges[0];
        expect([last, of]).toEqual([total, total]);
        expect(first).toBeGreaterThan(total - 200);
        expect(text).toContain(
          `Showing lines ${first}-${total} of ${total} (${
            first - 1
          } omitted; pass offset/tail to page)`,
        );
        expectExactRange(visibleMarkers(text), ranges[0]);
        expect(text).toContain(`**Lines:** ${total - first + 1} of ${total} |`);
        // Review r2 R2-S1: the narrowed window is spooled byte-equal.
        const window = longLines(total).slice(-200);
        expect(spooledWindow(text, `${total - 199}-${total}`)).toBe(
          window.join('\n') + '\n',
        );
      },
    );

    it('does not spool a read that shows its whole window', async () => {
      const read = streamReader({ stdout: shortLines(300) });
      const text = textOf(await callRead(read, { agentId: 'lane-1' }));
      expectFitsUntouched(text);
      expect(text).not.toContain('in full:');
      expectNoSpool();
    });

    it('keeps the first lines of a forward page and states where the next page starts', async () => {
      const read = streamReader({ stdout: longLines(5_000) });
      const text = textOf(
        await callRead(read, { agentId: 'lane-1', offset: 1_000 }),
      );

      expectFitsUntouched(text);
      const ranges = statedRanges(text);
      expect(ranges).toHaveLength(1);
      expect(ranges[0][0]).toBe(1_001);
      expectExactRange(visibleMarkers(text), ranges[0]);
      expect(spooledWindow(text, '1001-1200')).toBe(
        longLines(5_000).slice(1_000, 1_200).join('\n') + '\n',
      );
    });

    it('shows the end of a single line too long for the budget, and says so', async () => {
      const huge = `[L1] start ${'y'.repeat(20_000)} FINAL_FAILURE`;
      const read = streamReader({ stdout: [huge] });
      const text = textOf(await callRead(read, { agentId: 'lane-1' }));

      expectFitsUntouched(text);
      expect(text).toContain('FINAL_FAILURE');
      const stated =
        /Showing the last (\d+) of (\d+) chars of line 1 of 1 \(0 other lines omitted/.exec(
          text,
        );
      expect(stated).not.toBeNull();
      expect(Number(stated?.[2])).toBe(huge.length);
      expect(text).toContain(huge.slice(huge.length - Number(stated?.[1])));
      expect(text).not.toContain('[L1] start');
    });

    // Review r2 R2-S1: the middle of a clipped line is reachable, in the
    // spool the notice names, for a tail and for a forward page.
    it.each([{}, { offset: 0, tail: 1 }])(
      'spools the whole window when a line is clipped (%o), so its middle is reachable',
      async (paging) => {
        const line =
          'BEGIN ' +
          'a'.repeat(20_000) +
          ' MIDDLE_FAILURE ' +
          'b'.repeat(20_000) +
          ' END';
        const read = streamReader({ stdout: [line] });
        const text = textOf(
          await callRead(read, { agentId: 'lane-1', ...paging }),
        );

        expectFitsUntouched(text);
        expect(text).not.toContain('MIDDLE_FAILURE');
        expect(spooledWindow(text, '1-1')).toBe(`${line}\n`);
      },
    );

    // Review r2 R2-S2: a huge peer stream must not clip a final line that
    // fits on its own; checked with the huge line in either stream.
    it.each(['stdout', 'stderr'] as const)(
      'keeps the whole final line of the short stream when the %s peer holds one huge line',
      async (hugeStream) => {
        const short =
          'FINAL_FAILURE ' + 'summary details; '.repeat(110) + ' OUT_END';
        const huge = 'y'.repeat(30_000) + ' ERR_END';
        const read = streamReader(
          hugeStream === 'stderr'
            ? { stdout: [short], stderr: [huge] }
            : { stdout: [huge], stderr: [short] },
        );
        const text = textOf(await callRead(read, { agentId: 'lane-1' }));

        expectFitsUntouched(text);
        expect(text).toContain(short);
        expect(text).toContain('ERR_END');
        expect(text).toMatch(
          /Showing the last \d+ of 30008 chars of line 1 of 1/,
        );
        expect(spooledWindow(text, '1-1')).toBe(`${huge}\n`);
      },
    );

    // Review r1 S2: each stream states its own range; no combined interval.
    it('states a separate, exact range for each stream', async () => {
      const read = streamReader({
        stdout: shortLines(300, 'O'),
        stderr: shortLines(250, 'E'),
      });
      const paged = textOf(
        await callRead(read, { agentId: 'lane-1', offset: 100, tail: 2 }),
      );
      expect(paged).toContain(
        'Showing lines 101-102 of 300 (298 omitted; pass offset/tail to page)',
      );
      expect(paged).toContain(
        'Showing lines 101-102 of 250 (248 omitted; pass offset/tail to page)',
      );
      expect(paged).not.toMatch(/Showing lines \d+-\d+ of 550/);
      expect(paged).toContain('**Lines:** 4 of 550 |');

      const tail = textOf(
        await callRead(read, { agentId: 'lane-1', tail: 50 }),
      );
      expect(tail).toContain(
        'Showing lines 251-300 of 300 (250 omitted; pass offset/tail to page)',
      );
      expect(tail).toContain(
        'Showing lines 201-250 of 250 (200 omitted; pass offset/tail to page)',
      );
      expect(tail).toContain('[O300] ok');
      expect(tail).toContain('[E250] ok');
    });
  });
});
