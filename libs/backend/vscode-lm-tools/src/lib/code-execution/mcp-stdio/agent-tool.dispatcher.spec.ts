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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import { countTokensPiecewise } from '@ptah-extension/tool-output-reducers';
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
import {
  formatAgentMessage,
  formatAgentStop,
} from '../mcp-core/mcp-response-formatter';
import { getToolResultBudget } from '../mcp-core/tool-result-budget';
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

describe('AgentToolDispatcher — result budget', () => {
  // Every spooling call is pointed at a throw-away root through the
  // dispatcher's own `spoolRoot` argument; nothing is written to the
  // system temp directory's .ptah or to the repository's.
  let spoolRoot: string;

  beforeEach(() => {
    spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-stdio-budget-'));
  });

  afterEach(() => {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  });

  type StopResult = Parameters<typeof formatAgentStop>[0];

  function createStopHarness(stop: jest.Mock): AgentToolDispatcher {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const ptahAPI = { agent: { stop } } as unknown as PtahAPI;
    return new AgentToolDispatcher(
      ptahAPI,
      logger,
      undefined,
      undefined,
      () => Date.now(),
      () => spoolRoot,
    );
  }

  function textOf(response: MCPResponse | null): string {
    const result = (response?.result ?? {}) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return result.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  function spoolFiles(): string[] {
    const dir = path.join(spoolRoot, '.ptah', 'tmp', 'mcp-out');
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((n) => n !== '.gitignore').map((name) => path.join(dir, name))
      : [];
  }

  it('bounds an oversized success to the declared budget, names the reducer and spool file, and spools the raw text byte-equal', async () => {
    const stopped = {
      agentId: 'a1',
      cli: 'claude',
      status: 'stopped',
      cliSessionId: `MARK-${'c'.repeat(200_000)}`,
    } as unknown as StopResult;
    const dispatcher = createStopHarness(jest.fn().mockResolvedValue(stopped));

    const response = await dispatcher.dispatch('agent_stop', request, {
      agentId: 'a1',
    });

    const text = textOf(response);
    const budget = getToolResultBudget('ptah_agent_stop');
    expect(toolResult(response).isError).toBeUndefined();
    expect(text.length).toBeLessThanOrEqual(budget.chars);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(budget.tokens);
    expect(text).toMatch(/\[reduced: [^\]]+ — full output: [^\]]+\]$/);
    const files = spoolFiles();
    expect(files).toHaveLength(1);
    expect(text).toContain(path.basename(files[0]));
    expect(fs.readFileSync(files[0], 'utf8')).toBe(formatAgentStop(stopped));
    // Structured data is passed through unchanged, as before.
    expect(toolResult(response).structuredContent).toEqual({
      agentId: 'a1',
      cli: 'claude',
      status: 'stopped',
    });
  });

  it('returns a success within the budget byte-for-byte and spools nothing', async () => {
    const stopped = {
      agentId: 'a1',
      cli: 'claude',
      status: 'stopped',
      exitCode: 0,
    } as unknown as StopResult;
    const dispatcher = createStopHarness(jest.fn().mockResolvedValue(stopped));

    const response = await dispatcher.dispatch('agent_stop', request, {
      agentId: 'a1',
    });

    expect(textOf(response)).toBe(formatAgentStop(stopped));
    expect(spoolFiles()).toHaveLength(0);
  });

  it('leaves an error result un-budgeted, as the HTTP surface does', async () => {
    const detail = 'e'.repeat(20_000);
    const dispatcher = createStopHarness(
      jest.fn().mockRejectedValue(new Error(detail)),
    );

    const response = await dispatcher.dispatch('agent_stop', request, {
      agentId: 'a1',
    });

    expect(toolResult(response).isError).toBe(true);
    expect(textOf(response)).toBe(`agent_stop failed: ${detail}`);
    expect(spoolFiles()).toHaveLength(0);
  });
});

describe('AgentToolDispatcher — oversized replies (review r3: R3-01, R3-05)', () => {
  let spoolRoot: string;

  beforeEach(() => {
    spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-stdio-reply-'));
  });

  afterEach(() => {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  });

  function createDispatcher(agent: Partial<PtahAPI['agent']>): {
    dispatcher: AgentToolDispatcher;
  } {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const ptahAPI = { agent } as unknown as PtahAPI;
    return {
      dispatcher: new AgentToolDispatcher(
        ptahAPI,
        logger,
        undefined,
        undefined,
        () => Date.now(),
        () => spoolRoot,
      ),
    };
  }

  function resultOf(response: MCPResponse | null): {
    text: string;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  } {
    const result = (response?.result ?? {}) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    return {
      text: result.content?.find((c) => c.type === 'text')?.text ?? '',
      isError: result.isError,
      structuredContent: result.structuredContent,
    };
  }

  /** Ordinary prose paragraphs — the shape of a real agent reply. */
  function paragraphs(chars: number): string {
    const sentence =
      'The reviewer traced the budget layer and confirmed the reply keeps its substance. ';
    const out: string[] = [];
    let length = 0;
    while (length < chars) {
      const paragraph = sentence.repeat(4).trimEnd();
      out.push(paragraph);
      length += paragraph.length + 2;
    }
    return out.join('\n\n');
  }

  function messageText(agentId: string, detail: string): string {
    return formatAgentMessage({ agentId, mode: 'steer', detail });
  }

  const budget = getToolResultBudget('ptah_agent_message');

  describe('R3-01: an agent reply is preformatted text, not outlined Markdown', () => {
    it('keeps the marker and a prefix of a 20 KB single-run detail (the reviewer probe)', async () => {
      const detail = 'MARK-small-' + 'e'.repeat(20_000);
      const message = jest.fn().mockResolvedValue({ mode: 'steer', detail });
      const { dispatcher } = createDispatcher({ message });

      const { text, isError } = resultOf(
        await dispatcher.dispatch('agent_message', request, {
          agentId: 'a1',
          message: 'hi',
        }),
      );

      const raw = messageText('a1', detail);
      expect(isError).toBeUndefined();
      expect(text.length).toBeLessThanOrEqual(budget.chars);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(budget.tokens);
      expect(text).toContain('MARK-small-');
      // A single 20,000-char run counts one token per byte, so the token
      // budget, not the char budget, sizes this prefix.
      const markerEnd = raw.indexOf('MARK-small-') + 'MARK-small-'.length;
      expect(text.startsWith(raw.slice(0, markerEnd + 1000))).toBe(true);
      expect(text).toMatch(/\[reduced: none — partial, cut [^\]]+\]$/);
    });

    it('keeps a budget-sized prefix of a 20 KB prose reply, and spools the raw text byte-equal', async () => {
      const detail = `MARK-prose ${paragraphs(20_000)}`;
      const message = jest.fn().mockResolvedValue({ mode: 'steer', detail });
      const { dispatcher } = createDispatcher({ message });

      const { text } = resultOf(
        await dispatcher.dispatch('agent_message', request, {
          agentId: 'a1',
          message: 'hi',
        }),
      );

      const raw = messageText('a1', detail);
      expect(text.length).toBeLessThanOrEqual(budget.chars);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(budget.tokens);
      expect(text).toContain('MARK-prose');
      // Most of the 8,000-char budget is the reply itself, not an outline.
      expect(text.startsWith(raw.slice(0, 5000))).toBe(true);
      expect(text).toMatch(/\[reduced: none — partial, cut [^\]]+\]$/);
      const dir = path.join(spoolRoot, '.ptah', 'tmp', 'mcp-out');
      const textSpool = fs
        .readdirSync(dir)
        .map((name) => path.join(dir, name))
        .find((file) => text.includes(path.basename(file)));
      expect(textSpool).toBeDefined();
      expect(fs.readFileSync(textSpool as string, 'utf8')).toBe(raw);
    });

    it('still bounds a reply above the outline cap (300 KB), marker kept', async () => {
      const detail = `MARK-large ${paragraphs(300_000)}`;
      const message = jest.fn().mockResolvedValue({ mode: 'steer', detail });
      const { dispatcher } = createDispatcher({ message });

      const { text } = resultOf(
        await dispatcher.dispatch('agent_message', request, {
          agentId: 'a1',
          message: 'hi',
        }),
      );

      expect(text.length).toBeLessThanOrEqual(budget.chars);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(budget.tokens);
      expect(text).toContain('MARK-large');
      expect(text).toMatch(/\[reduced: none — partial, cut [^\]]+\]$/);
    });
  });

  describe('R3-05: structuredContent is held to the same budget', () => {
    /** The bounded structured result: valid JSON, within the budget, recoverable. */
    function expectBoundedStructured(
      structured: Record<string, unknown> | undefined,
      original: Record<string, unknown>,
    ): Record<string, unknown> {
      expect(structured).toBeDefined();
      const value = structured as Record<string, unknown>;
      const json = JSON.stringify(value);
      expect(json.length).toBeLessThanOrEqual(budget.chars);
      expect(countTokensPiecewise(json)).toBeLessThanOrEqual(budget.tokens);
      const note = value['ptah_truncation'] as Record<string, unknown>;
      expect(note).toMatchObject({
        truncated: true,
        limitChars: budget.chars,
      });
      const fullStructured = note['fullStructuredContent'];
      expect(typeof fullStructured).toBe('string');
      expect(
        JSON.parse(fs.readFileSync(fullStructured as string, 'utf8')),
      ).toEqual(original);
      return value;
    }

    it('agent_message: keeps agentId and mode, cuts the long detail to a prefix, names both spool files', async () => {
      const detail = 'MARK-small-' + 'e'.repeat(20_000);
      const message = jest.fn().mockResolvedValue({ mode: 'steer', detail });
      const { dispatcher } = createDispatcher({ message });

      const { text, structuredContent } = resultOf(
        await dispatcher.dispatch('agent_message', request, {
          agentId: 'a1',
          message: 'hi',
        }),
      );

      const value = expectBoundedStructured(structuredContent, {
        agentId: 'a1',
        mode: 'steer',
        detail,
      });
      expect(value).toMatchObject({ agentId: 'a1', mode: 'steer' });
      const shownDetail = value['detail'] as string;
      expect(shownDetail.startsWith('MARK-small-')).toBe(true);
      expect(detail.startsWith(shownDetail)).toBe(true);
      const note = value['ptah_truncation'] as Record<string, unknown>;
      expect(note['omittedFields']).toEqual([]);
      expect(note['cutFields']).toEqual({
        detail: { shown: shownDetail.length, total: detail.length },
      });
      expect(typeof note['fullText']).toBe('string');
      expect(text).toContain(path.basename(note['fullText'] as string));
    });

    it('agent_status: keeps each shown agent’s identifiers and the shown/total counts', async () => {
      const agents = Array.from({ length: 400 }, (_, i) => ({
        agentId: `agent-${i}`,
        cli: 'claude',
        status: 'running',
        task: 't'.repeat(200),
        startedAt: new Date(0).toISOString(),
        messagingMode: 'steer',
      }));
      const status = jest.fn().mockResolvedValue(agents);
      const { dispatcher } = createDispatcher({ status });

      const { structuredContent } = resultOf(
        await dispatcher.dispatch('agent_status', request, {}),
      );

      const value = expectBoundedStructured(structuredContent, { agents });
      const shown = value['agents'] as Array<Record<string, unknown>>;
      expect(shown.length).toBeGreaterThan(0);
      expect(shown[0]).toMatchObject({
        agentId: 'agent-0',
        cli: 'claude',
        status: 'running',
      });
      // The 200-char task is not an identifier and is left to the spool.
      expect(shown[0]).not.toHaveProperty('task');
      const note = value['ptah_truncation'] as Record<string, unknown>;
      expect(note['lists']).toEqual({
        agents: { shown: shown.length, total: 400 },
      });
    });

    it('agent_list: keeps total and roles, and bounds the agents array', async () => {
      const agents = Array.from({ length: 2000 }, (_, i) => ({
        cli: `cli-${i}`,
        installed: true,
        messagingMode: 'steer',
        providerName: 'p'.repeat(80),
      }));
      const list = jest.fn().mockResolvedValue(agents);
      const listRoles = jest.fn().mockResolvedValue(['reviewer']);
      const { dispatcher } = createDispatcher({ list, listRoles });

      const { structuredContent } = resultOf(
        await dispatcher.dispatch('agent_list', request, {}),
      );

      const value = expectBoundedStructured(structuredContent, {
        agents,
        total: 2000,
        roles: ['reviewer'],
      });
      expect(value['total']).toBe(2000);
      expect(value['roles']).toEqual(['reviewer']);
      const shown = value['agents'] as Array<Record<string, unknown>>;
      expect(shown[0]).toMatchObject({ cli: 'cli-0', installed: true });
      const note = value['ptah_truncation'] as Record<string, unknown>;
      expect(note['lists']).toEqual({
        agents: { shown: shown.length, total: 2000 },
        roles: { shown: 1, total: 1 },
      });
    });

    it('agent_spawn with two long fields: the omitted field is disclosed and the JSON stays within both limits (review r4 R4-02: was 2,002 tokens)', async () => {
      const spawned = {
        agentId: 'a1',
        cli: 'ptah-cli',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        ptahCliId: 'p1',
        ptahCliName: 'MARK-name-' + 'n'.repeat(20_000),
        role: 'r'.repeat(200),
      };
      const spawn = jest.fn().mockResolvedValue(spawned);
      const { dispatcher } = createDispatcher({ spawn });

      const { isError, structuredContent } = resultOf(
        await dispatcher.dispatch('agent_spawn', request, {
          task: 'Do the thing',
          ptahCliId: 'p1',
        }),
      );

      expect(isError).toBeUndefined();
      const spawnBudget = getToolResultBudget('ptah_agent_spawn');
      const value = structuredContent as Record<string, unknown>;
      const json = JSON.stringify(value);
      expect(json.length).toBeLessThanOrEqual(spawnBudget.chars);
      expect(countTokensPiecewise(json)).toBeLessThanOrEqual(
        spawnBudget.tokens,
      );
      expect(JSON.parse(json)).toEqual(value);
      expect(value).toMatchObject({
        agentId: 'a1',
        status: 'running',
        ptahCliId: 'p1',
      });
      const note = value['ptah_truncation'] as Record<string, unknown>;
      const omitted = note['omittedFields'] as string[];
      const cut = note['cutFields'] as Record<string, unknown>;
      for (const key of ['ptahCliName', 'role']) {
        expect(key in cut || omitted.includes(key)).toBe(true);
      }
      expect(
        JSON.parse(
          fs.readFileSync(note['fullStructuredContent'] as string, 'utf8'),
        ),
      ).toEqual(spawned);
    });

    it('leaves a small result’s structuredContent unchanged and spools nothing', async () => {
      const message = jest
        .fn()
        .mockResolvedValue({ mode: 'steer', detail: 'delivered' });
      const { dispatcher } = createDispatcher({ message });

      const { structuredContent } = resultOf(
        await dispatcher.dispatch('agent_message', request, {
          agentId: 'a1',
          message: 'hi',
        }),
      );

      expect(structuredContent).toEqual({
        agentId: 'a1',
        mode: 'steer',
        detail: 'delivered',
      });
      expect(fs.existsSync(path.join(spoolRoot, '.ptah'))).toBe(false);
    });
  });
});
