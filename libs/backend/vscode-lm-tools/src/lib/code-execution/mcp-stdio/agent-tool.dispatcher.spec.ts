/**
 * AgentToolDispatcher Unit Tests
 *
 * Focused on the `agent_spawn` argument schema, which is the runtime gate that
 * decides whether a `cli` value ever reaches AgentProcessManager. It used to
 * hard-code `['codex','copilot','cursor']`, so the three newer adapters were
 * rejected before dispatch even though CliType and ptah_agent_list knew about
 * them; the enum is now derived from `SYSTEM_CLI_TYPES`.
 */
// `@ptah-extension/cli-agent-runtime`'s barrel reaches tsyringe decorators on
// import (the dispatcher narrows `AgentMessageError` with `instanceof`).
import 'reflect-metadata';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPI } from '../types';
import {
  AgentRoleError,
  CliCommandLineTooLongError,
  type AgentRoleErrorCode,
} from '@ptah-extension/cli-agent-runtime';
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

const ROLE_ERROR_CODES: readonly AgentRoleErrorCode[] = [
  'invalid_role_name',
  'no_roles',
  'unknown_role',
  'empty_role',
  'role_too_large',
  'role_read_failed',
  'no_workspace',
];

describe('AgentToolDispatcher — agent_spawn role', () => {
  it('forwards role to PtahAPI.agent.spawn', async () => {
    const { dispatcher, spawn } = createHarness();

    await dispatcher.dispatch('agent_spawn', request, {
      task: 'Review',
      role: 'reviewer',
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Review', role: 'reviewer' }),
    );
  });

  it('reports role, roleDelivery and roleChannel in structuredContent', async () => {
    const { dispatcher, spawn } = createHarness();
    spawn.mockResolvedValueOnce({
      agentId: 'a2',
      cli: 'antigravity',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      role: 'reviewer',
      roleDelivery: 'preamble',
      roleChannel: 'task-prompt',
    });

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Review',
      role: 'reviewer',
    });

    expect(toolResult(response).isError).toBeUndefined();
    expect(toolResult(response).structuredContent).toMatchObject({
      agentId: 'a2',
      role: 'reviewer',
      roleDelivery: 'preamble',
      roleChannel: 'task-prompt',
    });
  });

  it('omits role keys on a role-less spawn', async () => {
    const { dispatcher } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
    });

    const structured = toolResult(response).structuredContent ?? {};
    expect(structured).not.toHaveProperty('role');
    expect(structured).not.toHaveProperty('roleDelivery');
    expect(structured).not.toHaveProperty('roleChannel');
  });

  it('rejects an unknown key without dispatching', async () => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      roleDefinition: { name: 'x' },
    });

    expect(toolResult(response).isError).toBe(true);
    expect(toolResult(response).structuredContent).toMatchObject({
      ptah_code: 'mcp_invalid_tool_args',
      tool: 'agent_spawn',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects an empty role without dispatching', async () => {
    const { dispatcher, spawn } = createHarness();

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Do the thing',
      role: '',
    });

    expect(toolResult(response).isError).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([...ROLE_ERROR_CODES])(
    'surfaces AgentRoleError %s with its code and available roles',
    async (code) => {
      const { dispatcher, spawn } = createHarness();
      spawn.mockRejectedValueOnce(
        new AgentRoleError(code, `role failed with ${code}`, ['architect']),
      );

      const response = await dispatcher.dispatch('agent_spawn', request, {
        task: 'Review',
        role: 'reviewer',
      });

      const result = response?.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent?: Record<string, unknown>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        `agent_spawn role ${code}: role failed with ${code}`,
      );
      expect(result.structuredContent).toEqual({
        ptah_code: 'mcp_tool_failed',
        tool: 'agent_spawn',
        state: code,
        availableRoles: ['architect'],
      });
    },
  );

  it('surfaces CliCommandLineTooLongError with the measured size and limit', async () => {
    const { dispatcher, spawn } = createHarness();
    spawn.mockRejectedValueOnce(
      new CliCommandLineTooLongError(40_000, 32_767, 3, 39_000, 'UTF-16 units'),
    );

    const response = await dispatcher.dispatch('agent_spawn', request, {
      task: 'Review',
      role: 'reviewer',
    });

    const result = response?.result as {
      isError?: boolean;
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/40000 against a limit of 32767/);
    expect(result.structuredContent).toMatchObject({
      tool: 'agent_spawn',
      state: 'command_line_too_long',
      measured: 40_000,
      limit: 32_767,
    });
  });
});

function createListHarness(listRoles: jest.Mock): {
  dispatcher: AgentToolDispatcher;
  list: jest.Mock;
  logger: { warn: jest.Mock };
} {
  const list = jest.fn().mockResolvedValue([
    {
      cli: 'antigravity',
      installed: true,
      messagingMode: 'none',
      roleDelivery: 'preamble',
      roleChannel: 'task-prompt',
    },
  ]);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const ptahAPI = { agent: { list, listRoles } } as unknown as PtahAPI;
  return {
    dispatcher: new AgentToolDispatcher(ptahAPI, logger as unknown as Logger),
    list,
    logger,
  };
}

function listResult(response: MCPResponse | null): {
  isError?: boolean;
  text: string;
  structuredContent: Record<string, unknown>;
} {
  const result = response?.result as {
    isError?: boolean;
    content: Array<{ text: string }>;
    structuredContent: Record<string, unknown>;
  };
  return {
    isError: result.isError,
    text: result.content[0].text,
    structuredContent: result.structuredContent,
  };
}

describe('AgentToolDispatcher — agent_list roles', () => {
  it('returns the workspace roles', async () => {
    const { dispatcher } = createListHarness(
      jest.fn().mockResolvedValue(['architect', 'reviewer']),
    );

    const out = listResult(
      await dispatcher.dispatch('agent_list', request, {}),
    );

    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toMatchObject({
      total: 1,
      roles: ['architect', 'reviewer'],
    });
    expect(out.text).toMatch(/Roles in this workspace: architect, reviewer/);
    expect(out.text).toMatch(/role delivery: preamble\/task-prompt/);
  });

  it('returns an empty role list when none were generated', async () => {
    const { dispatcher } = createListHarness(jest.fn().mockResolvedValue([]));

    const out = listResult(
      await dispatcher.dispatch('agent_list', request, {}),
    );

    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toMatchObject({ roles: [] });
    expect(out.text).toMatch(/No agent roles generated for this workspace/);
  });

  it('still lists agents and logs a warning when listRoles rejects', async () => {
    const { dispatcher, logger } = createListHarness(
      jest
        .fn()
        .mockRejectedValue(
          new AgentRoleError('role_read_failed', 'cannot read roles'),
        ),
    );

    const out = listResult(
      await dispatcher.dispatch('agent_list', request, {}),
    );

    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toMatchObject({ total: 1, roles: [] });
    expect(out.text).toMatch(/No agent roles generated for this workspace/);
    expect(logger.warn).toHaveBeenCalledWith(
      '[McpStdio] agent_list could not list roles',
      { error: 'cannot read roles' },
    );
  });

  it('keeps the agent.list failure path unchanged', async () => {
    const listRoles = jest.fn().mockResolvedValue([]);
    const { dispatcher, list } = createListHarness(listRoles);
    list.mockRejectedValueOnce(new Error('detection exploded'));

    const response = await dispatcher.dispatch('agent_list', request, {});

    expect(toolResult(response).isError).toBe(true);
    expect(toolResult(response).structuredContent).toEqual({
      ptah_code: 'mcp_tool_failed',
      tool: 'agent_list',
    });
    expect(listRoles).not.toHaveBeenCalled();
  });
});

/**
 * `agent_message` / `agent_report` — TASK_2026_402 Batch 5.
 *
 * Both surfaces must accept the same argument shape and both must ERROR on a
 * miss rather than fall back, so a stale `instruction` key is corrected rather
 * than silently dropped.
 */
function createMessagingHarness(callerAgentId?: string): {
  dispatcher: AgentToolDispatcher;
  message: jest.Mock;
  report: jest.Mock;
} {
  const message = jest.fn().mockResolvedValue({ mode: 'steer' });
  const report = jest
    .fn()
    .mockResolvedValue({ delivered: true, parentSessionId: 'sess-1' });
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const ptahAPI = { agent: { message, report } } as unknown as PtahAPI;
  return {
    dispatcher: new AgentToolDispatcher(
      ptahAPI,
      logger,
      undefined,
      callerAgentId,
    ),
    message,
    report,
  };
}

describe('AgentToolDispatcher — agent_message', () => {
  it('handles the tool name', () => {
    expect(createMessagingHarness().dispatcher.handles('agent_message')).toBe(
      true,
    );
  });

  it('delegates to PtahAPI.agent.message and returns the mode', async () => {
    const { dispatcher, message } = createMessagingHarness();
    const response = await dispatcher.dispatch('agent_message', request, {
      agentId: 'a1',
      message: 'switch to the other branch',
    });
    expect(message).toHaveBeenCalledWith('a1', 'switch to the other branch');
    expect(toolResult(response).isError).toBeUndefined();
    expect(toolResult(response).structuredContent).toMatchObject({
      agentId: 'a1',
      mode: 'steer',
    });
  });

  it('ERRORS on the retired `instruction` key rather than dropping it', async () => {
    const { dispatcher, message } = createMessagingHarness();
    const response = await dispatcher.dispatch('agent_message', request, {
      agentId: 'a1',
      instruction: 'switch branches',
    });
    expect(message).not.toHaveBeenCalled();
    expect(toolResult(response).isError).toBe(true);
    expect(toolResult(response).structuredContent).toMatchObject({
      ptah_code: 'mcp_invalid_tool_args',
      tool: 'agent_message',
    });
  });

  it('rejects an empty message instead of delivering nothing', async () => {
    const { dispatcher, message } = createMessagingHarness();
    const response = await dispatcher.dispatch('agent_message', request, {
      agentId: 'a1',
      message: '',
    });
    expect(message).not.toHaveBeenCalled();
    expect(toolResult(response).isError).toBe(true);
  });
});

describe('AgentToolDispatcher — agent_report', () => {
  it('handles the tool name', () => {
    expect(createMessagingHarness().dispatcher.handles('agent_report')).toBe(
      true,
    );
  });

  it('identifies the caller from the transport, never from the arguments', async () => {
    const { dispatcher, report } = createMessagingHarness('agent-from-url');
    const response = await dispatcher.dispatch('agent_report', request, {
      message: 'blocked on a missing credential',
    });
    expect(report).toHaveBeenCalledWith({
      agentId: 'agent-from-url',
      message: 'blocked on a missing credential',
      summary: undefined,
    });
    expect(toolResult(response).structuredContent).toMatchObject({
      delivered: true,
      parentSessionId: 'sess-1',
    });
  });

  it('REJECTS a sender-supplied agentId', async () => {
    // Accepting one would let any agent report as any other agent.
    const { dispatcher, report } = createMessagingHarness('agent-from-url');
    const response = await dispatcher.dispatch('agent_report', request, {
      agentId: 'someone-else',
      message: 'not mine to send',
    });
    expect(report).not.toHaveBeenCalled();
    expect(toolResult(response).isError).toBe(true);
    expect(toolResult(response).structuredContent).toMatchObject({
      tool: 'agent_report',
    });
  });

  it('refuses with unattributed-caller when the transport named no agent', async () => {
    const { dispatcher, report } = createMessagingHarness(undefined);
    const response = await dispatcher.dispatch('agent_report', request, {
      message: 'blocked',
    });
    expect(report).not.toHaveBeenCalled();
    expect(toolResult(response).structuredContent).toMatchObject({
      delivered: false,
      reason: 'unattributed-caller',
    });
  });

  it('rejects a summary longer than 200 characters', async () => {
    const { dispatcher, report } = createMessagingHarness('a1');
    const response = await dispatcher.dispatch('agent_report', request, {
      message: 'ok',
      summary: 'x'.repeat(201),
    });
    expect(report).not.toHaveBeenCalled();
    expect(toolResult(response).isError).toBe(true);
  });
});
