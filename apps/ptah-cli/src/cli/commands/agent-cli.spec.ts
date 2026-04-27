/**
 * Unit tests for `ptah agent-cli` command — TASK_2026_104 B7.
 *
 * Locked allowlist contract:
 *   - `validateCliAgent` accepts ONLY `'glm' | 'gemini'`. Everything else → null.
 *   - Rejection emits `task.error` with `ptah_code: 'cli_agent_unavailable'`,
 *     `data: { requested_cli, allowed: ['glm','gemini'] }`, and returns
 *     `ExitCode.AuthRequired = 3`.
 *   - **CRITICAL**: rejection STILL fires when `process.env.PTAH_AGENT_CLI_OVERRIDE`
 *     is set. The shim never reads env. This test guards against future drift.
 *
 * Coverage:
 *   - validateCliAgent: glm/gemini accepted; copilot/codex/anthropic/'' rejected
 *   - validateCliAgent ignores PTAH_AGENT_CLI_OVERRIDE
 *   - detect, config get, config set, models list happy paths
 *   - models list with --cli copilot rejected (exit 3, task.error payload)
 *   - models list with --cli glm returns empty array
 *   - models list with --cli gemini returns curated gemini models
 *   - stop without --cli rejected (exit 3) — even with override env set
 *   - resume with --cli codex rejected (exit 3) — even with override env set
 *   - stop / resume happy paths with --cli gemini
 */

import {
  CLI_AGENT_ALLOWLIST,
  execute,
  validateCliAgent,
  type AgentCliExecuteHooks,
  type AgentCliOptions,
} from './agent-cli.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: AgentCliExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
  invoked: { count: number };
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const invoked = { count: 0 };

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: undefined };
    }),
  } as unknown as CliMessageTransport;

  const container = { resolve: jest.fn() };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    invoked.count += 1;
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as AgentCliExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, invoked };
}

// ---------------------------------------------------------------------------
// Allowlist contract — pure function tests
// ---------------------------------------------------------------------------

describe('CLI_AGENT_ALLOWLIST contract', () => {
  it('contains exactly two entries: glm and gemini', () => {
    expect(CLI_AGENT_ALLOWLIST).toEqual(['glm', 'gemini']);
  });

  it('validateCliAgent accepts allowlisted ids', () => {
    expect(validateCliAgent('glm')).toBe('glm');
    expect(validateCliAgent('gemini')).toBe('gemini');
  });

  it('validateCliAgent rejects all non-allowlisted ids', () => {
    for (const id of [
      'copilot',
      'codex',
      'claude',
      'anthropic',
      'openai',
      'cursor',
      'windsurf',
      'GLM', // case-sensitive
      'Gemini',
      '',
      ' ',
      'glm ',
      'gemini-2',
    ]) {
      expect(validateCliAgent(id)).toBeNull();
    }
  });

  it('validateCliAgent rejects undefined', () => {
    expect(validateCliAgent(undefined)).toBeNull();
  });

  it('validateCliAgent IGNORES PTAH_AGENT_CLI_OVERRIDE env var (locked)', () => {
    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      // Even with override set, non-allowlisted ids stay rejected.
      expect(validateCliAgent('copilot')).toBeNull();
      expect(validateCliAgent('codex')).toBeNull();
      // Allowlisted ids unchanged.
      expect(validateCliAgent('glm')).toBe('glm');
      expect(validateCliAgent('gemini')).toBe('gemini');
    } finally {
      if (prev === undefined) delete process.env.PTAH_AGENT_CLI_OVERRIDE;
      else process.env.PTAH_AGENT_CLI_OVERRIDE = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

describe('ptah agent-cli detect', () => {
  it('emits agent_cli.detection with clis payload', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    const clis = [{ type: 'gemini', available: true, version: '1.0' }];
    engine.scripted.set('agent:detectClis', {
      success: true,
      data: { clis },
    });

    const code = await execute(
      { subcommand: 'detect' } satisfies AgentCliOptions,
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls.map((c) => c.method)).toEqual(['agent:detectClis']);
    expect(ft.notifications).toEqual([
      { method: 'agent_cli.detection', params: { clis } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// config get / set
// ---------------------------------------------------------------------------

describe('ptah agent-cli config get', () => {
  it('emits agent_cli.config with config payload', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    const config = { defaultModel: 'sonnet-4', maxConcurrentAgents: 3 };
    engine.scripted.set('agent:getConfig', { success: true, data: config });

    const code = await execute({ subcommand: 'config-get' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.config',
      params: { config },
    });
  });
});

describe('ptah agent-cli config set', () => {
  it('rejects missing --key with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'config-set', value: 'x' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--key is required');
    expect(engine.invoked.count).toBe(0);
  });

  it('rejects missing --value with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'config-set', key: 'maxConcurrentAgents' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--value is required');
  });

  it('coerces numeric keys to numbers', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:setConfig', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'config-set', key: 'maxConcurrentAgents', value: '5' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({ maxConcurrentAgents: 5 });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.config.updated',
      params: { key: 'maxConcurrentAgents', value: 5 },
    });
  });

  it('coerces boolean keys to booleans', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:setConfig', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'config-set', key: 'codexAutoApprove', value: 'true' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({ codexAutoApprove: true });
  });

  it('CSV-splits array keys', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:setConfig', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      {
        subcommand: 'config-set',
        key: 'preferredAgentOrder',
        value: 'reviewer, planner ,coder',
      },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({
      preferredAgentOrder: ['reviewer', 'planner', 'coder'],
    });
  });
});

// ---------------------------------------------------------------------------
// models list — allowlist OPTIONAL
// ---------------------------------------------------------------------------

describe('ptah agent-cli models list', () => {
  it('returns full curated payload when --cli omitted', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:listCliModels', {
      success: true,
      data: { gemini: ['g1'], codex: ['c1'], copilot: ['cp1'] },
    });

    const code = await execute({ subcommand: 'models-list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.models',
      params: { gemini: ['g1'], codex: ['c1'], copilot: ['cp1'] },
    });
  });

  it('--cli gemini returns curated gemini models', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:listCliModels', {
      success: true,
      data: { gemini: ['g1', 'g2'], codex: ['c1'], copilot: ['cp1'] },
    });

    const code = await execute(
      { subcommand: 'models-list', cli: 'gemini' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.models',
      params: { cli: 'gemini', models: ['g1', 'g2'] },
    });
  });

  it('--cli glm returns empty models array (not in curated payload)', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:listCliModels', {
      success: true,
      data: { gemini: ['g1'], codex: [], copilot: [] },
    });

    const code = await execute(
      { subcommand: 'models-list', cli: 'glm' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.models',
      params: { cli: 'glm', models: [] },
    });
  });

  it('--cli copilot rejected with cli_agent_unavailable + exit 3', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'models-list', cli: 'copilot' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.AuthRequired);
    expect(code).toBe(3);
    expect(engine.invoked.count).toBe(0); // never bootstraps DI

    expect(ft.notifications).toHaveLength(1);
    expect(ft.notifications[0]?.method).toBe('task.error');
    const payload = ft.notifications[0]?.params as {
      ptah_code: string;
      data: { requested_cli: string; allowed: string[] };
    };
    expect(payload.ptah_code).toBe('cli_agent_unavailable');
    expect(payload.data.requested_cli).toBe('copilot');
    expect(payload.data.allowed).toEqual(['glm', 'gemini']);
  });
});

// ---------------------------------------------------------------------------
// stop <id> --cli — allowlist REQUIRED
// ---------------------------------------------------------------------------

describe('ptah agent-cli stop', () => {
  it('rejects missing <id> with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'stop', cli: 'gemini' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('<id> is required');
  });

  it('--cli copilot rejected with exit 3 — even with PTAH_AGENT_CLI_OVERRIDE set', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      const code = await execute(
        { subcommand: 'stop', agentId: 'fake-id', cli: 'copilot' },
        baseGlobals,
        { formatter: ft.formatter, withEngine: engine.withEngine },
      );

      expect(code).toBe(ExitCode.AuthRequired);
      expect(code).toBe(3);
      expect(engine.invoked.count).toBe(0);

      const err = ft.notifications.find((n) => n.method === 'task.error');
      expect(err).toBeDefined();
      const payload = err?.params as {
        ptah_code: string;
        data: { requested_cli: string };
      };
      expect(payload.ptah_code).toBe('cli_agent_unavailable');
      expect(payload.data.requested_cli).toBe('copilot');
    } finally {
      if (prev === undefined) delete process.env.PTAH_AGENT_CLI_OVERRIDE;
      else process.env.PTAH_AGENT_CLI_OVERRIDE = prev;
    }
  });

  it('rejected with empty string when --cli omitted entirely', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'stop', agentId: 'x' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.AuthRequired);
    const err = ft.notifications.find((n) => n.method === 'task.error');
    const payload = err?.params as { data: { requested_cli: string } };
    expect(payload.data.requested_cli).toBe('');
  });

  it('--cli gemini happy path emits agent_cli.stopped', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:stop', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'stop', agentId: 'agent-42', cli: 'gemini' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:stop',
      params: { agentId: 'agent-42' },
    });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.stopped',
      params: { agentId: 'agent-42', cli: 'gemini' },
    });
  });
});

// ---------------------------------------------------------------------------
// resume <id> --cli — allowlist REQUIRED
// ---------------------------------------------------------------------------

describe('ptah agent-cli resume', () => {
  it('rejects missing session id with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'resume', cli: 'gemini' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('<id> is required');
  });

  it('--cli codex rejected with exit 3 — even with PTAH_AGENT_CLI_OVERRIDE set', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      const code = await execute(
        { subcommand: 'resume', cliSessionId: 'sess-1', cli: 'codex' },
        baseGlobals,
        { formatter: ft.formatter, withEngine: engine.withEngine },
      );

      expect(code).toBe(ExitCode.AuthRequired);
      expect(engine.invoked.count).toBe(0);

      const err = ft.notifications.find((n) => n.method === 'task.error');
      const payload = err?.params as {
        ptah_code: string;
        data: { requested_cli: string; allowed: string[] };
      };
      expect(payload.ptah_code).toBe('cli_agent_unavailable');
      expect(payload.data.requested_cli).toBe('codex');
      expect(payload.data.allowed).toEqual(['glm', 'gemini']);
    } finally {
      if (prev === undefined) delete process.env.PTAH_AGENT_CLI_OVERRIDE;
      else process.env.PTAH_AGENT_CLI_OVERRIDE = prev;
    }
  });

  it('--cli gemini happy path emits agent_cli.resumed', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:resumeCliSession', {
      success: true,
      data: { success: true, agentId: 'new-agent-7' },
    });

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-9',
        cli: 'gemini',
        task: 'continue',
      },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:resumeCliSession',
      params: {
        cliSessionId: 'sess-9',
        cli: 'gemini',
        task: 'continue',
      },
    });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.resumed',
      params: {
        cliSessionId: 'sess-9',
        cli: 'gemini',
        agentId: 'new-agent-7',
      },
    });
  });
});
