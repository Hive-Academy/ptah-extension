/**
 * AgentToolDispatcher Unit Tests
 *
 * Focused on the `agent_spawn` argument schema, which is the runtime gate that
 * decides whether a `cli` value ever reaches AgentProcessManager. It used to
 * hard-code `['codex','copilot','cursor']`, so the three newer adapters were
 * rejected before dispatch even though CliType and ptah_agent_list knew about
 * them; the enum is now derived from `SYSTEM_CLI_TYPES`.
 */
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPI } from '../types';
import { AgentToolDispatcher } from './agent-tool.dispatcher';

const request: MCPRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
};

/** `MCPResponse.result` is intentionally opaque on the wire type; narrow it. */
function toolResult(response: MCPResponse | null): {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
} {
  return (response?.result ?? {}) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
}

function createHarness(): {
  dispatcher: AgentToolDispatcher;
  spawn: jest.Mock;
} {
  const spawn = jest.fn().mockResolvedValue({
    agentId: 'a1',
    cli: 'antigravity',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
  });
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const ptahAPI = { agent: { spawn } } as unknown as PtahAPI;
  return { dispatcher: new AgentToolDispatcher(ptahAPI, logger), spawn };
}

describe('AgentToolDispatcher — agent_spawn schema', () => {
  it.each([...SYSTEM_CLI_TYPES])('accepts cli: %s', async (cli) => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      cli,
    });

    expect(toolResult(response).isError).toBeUndefined();
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cli }));
  });

  it('accepts cli: antigravity specifically', async () => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      cli: 'antigravity',
    });

    expect(toolResult(response).isError).toBeUndefined();
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ cli: 'antigravity', task: 'Do the thing' }),
    );
  });

  it('rejects an unknown cli without dispatching', async () => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      cli: 'aider',
    });

    expect(toolResult(response).isError).toBe(true);
    expect(toolResult(response).structuredContent).toMatchObject({
      ptah_code: 'mcp_invalid_tool_args',
      tool: 'agent_spawn',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects ptah-cli as a cli value (routed via ptahCliId instead)', async () => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      cli: 'ptah-cli',
    });

    expect(toolResult(response).isError).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });
});
