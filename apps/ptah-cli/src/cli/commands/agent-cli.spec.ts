/**
 * Unit tests for `ptah agent-cli` command.
 *
 * Selector contract (TASK_2026_297 phase 2 — there is no allowlist any more):
 *   - `resolveCliAgentSelector` accepts every member of `SYSTEM_CLI_TYPES`, plus
 *     `ptah-cli`, plus the deprecated `glm` alias. Everything else → null.
 *   - The accepted set is DERIVED from `SYSTEM_CLI_TYPES`, and the tests below
 *     assert the derivation rather than a hand-written list — a seventh adapter
 *     must not be unreachable from this CLI the way the first six were.
 *   - An unknown selector still emits `task.error` with
 *     `ptah_code: 'cli_agent_unavailable'` and `ExitCode.AuthRequired = 3`. That
 *     code is the documented wire contract and survives the rename.
 *   - **CRITICAL**: `process.env.PTAH_AGENT_CLI_OVERRIDE` is still never read.
 *     Nothing is gated now, so there is nothing for it to loosen; the test keeps
 *     it inert so it cannot come back as a side channel.
 *
 * Coverage:
 *   - selector set derived from SYSTEM_CLI_TYPES; every member resolves
 *   - unknown ids (gemini, windsurf, 'GLM', 'glm ', '') rejected
 *   - detect, config get, config set, models list happy paths
 *   - models list --cli codex issues a REAL scoped query (used to exit 3)
 *   - models list --cli glm / ptah-cli reports supported:false, not a bare []
 *   - resume --cli codex reaches the system-CLI path with cli: 'codex'
 *   - resume --cli glm still routes to ptah-cli AND warns on stderr
 *   - --ptah-cli-id refused against a system CLI target
 *
 * **The wire payload is validated by the REAL boundary schema.** Every other
 * assertion in this file runs against a mocked transport, which is exactly why
 * `resume` could send `cli: 'glm'` — a value no `CliType` admits — and stay
 * green while the command threw "glm CLI is not installed" for its entire life.
 * `AgentResumeCliSessionParamsSchema` is the schema the backend actually parses
 * with, so parsing the CLI's own payload with it closes the gap a transport mock
 * structurally cannot cover. Every SELECTOR is run through it, not just `glm`.
 */

import {
  CLI_AGENT_SELECTORS,
  buildResumeCliSessionParams,
  execute,
  resolveCliAgentSelector,
  resolveCliAgentTarget,
  type AgentCliExecuteHooks,
  type AgentCliOptions,
} from './agent-cli.js';
import { AgentResumeCliSessionParamsSchema } from '@ptah-extension/rpc-handlers';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

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
// Selector contract — pure function tests
// ---------------------------------------------------------------------------

describe('CLI_AGENT_SELECTORS contract', () => {
  it('is DERIVED from SYSTEM_CLI_TYPES, not a hand-written list', () => {
    // The assertion is written against SYSTEM_CLI_TYPES itself so it keeps
    // holding when a seventh adapter lands. A literal expectation here would be
    // the same mistake as the list it replaced: it went stale the moment the
    // adapter set moved and nobody noticed for six adapters.
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(CLI_AGENT_SELECTORS).toContain(cli);
    }
    // Plus the non-system target and the one deprecated alias, and nothing else.
    expect(CLI_AGENT_SELECTORS).toEqual([
      ...SYSTEM_CLI_TYPES,
      'ptah-cli',
      'glm',
    ]);
  });

  it('resolves every system CLI — none of them is blocked', () => {
    // The defect in one assertion: all six of these used to return null and
    // exit 3, while CliDetectionService registered a working adapter for each.
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(resolveCliAgentSelector(cli)).toBe(cli);
    }
  });

  it('resolves ptah-cli and the deprecated glm alias', () => {
    expect(resolveCliAgentSelector('ptah-cli')).toBe('ptah-cli');
    expect(resolveCliAgentSelector('glm')).toBe('glm');
  });

  it('rejects ids that name no target', () => {
    for (const id of [
      'gemini', // removed from CliType by 2ef1abdde
      'claude',
      'anthropic',
      'openai',
      'windsurf',
      'GLM', // case-sensitive
      'Codex',
      '',
      ' ',
      'glm ',
      'gemini-2',
    ]) {
      expect(resolveCliAgentSelector(id)).toBeNull();
    }
  });

  it('rejects undefined', () => {
    expect(resolveCliAgentSelector(undefined)).toBeNull();
  });

  it('IGNORES PTAH_AGENT_CLI_OVERRIDE env var', () => {
    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      // Nothing is gated any more, so the env var has nothing to loosen. It
      // stays inert so it cannot reappear as a side channel.
      expect(resolveCliAgentSelector('gemini')).toBeNull();
      expect(resolveCliAgentSelector('windsurf')).toBeNull();
      expect(resolveCliAgentSelector('codex')).toBe('codex');
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
    const clis = [{ type: 'codex', available: true, version: '1.0' }];
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
  it('reports all six system CLIs when --cli omitted', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:listCliModels', {
      success: true,
      data: {
        codex: ['c1'],
        copilot: ['cp1'],
        cursor: ['cu1'],
        antigravity: ['ag1'],
        opencode: ['oc1'],
        pi: ['pi1'],
      },
    });

    const code = await execute({ subcommand: 'models-list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.Success);
    // Previously this dropped cursor/antigravity/opencode/pi on the floor.
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.models',
      params: {
        codex: ['c1'],
        copilot: ['cp1'],
        cursor: ['cu1'],
        antigravity: ['ag1'],
        opencode: ['oc1'],
        pi: ['pi1'],
      },
    });
  });

  it('defaults every system CLI to [] when the RPC returns nothing', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute({ subcommand: 'models-list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]?.params).toEqual({
      codex: [],
      copilot: [],
      cursor: [],
      antigravity: [],
      opencode: [],
      pi: [],
    });
  });

  it('--cli gemini rejected with cli_agent_unavailable + exit 3', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'models-list', cli: 'gemini' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.AuthRequired);
    expect(code).toBe(3);
    expect(engine.invoked.count).toBe(0);

    expect(ft.notifications).toHaveLength(1);
    expect(ft.notifications[0]?.method).toBe('task.error');
    const payload = ft.notifications[0]?.params as {
      ptah_code: string;
      data: { requested_cli: string; allowed: string[] };
    };
    // The wire code is unchanged by the rename — it is documented.
    expect(payload.ptah_code).toBe('cli_agent_unavailable');
    expect(payload.data.requested_cli).toBe('gemini');
    // What `allowed` reports changed from one unroutable label to every target.
    expect(payload.data.allowed).toEqual([...CLI_AGENT_SELECTORS]);
  });

  it.each([...SYSTEM_CLI_TYPES])(
    '--cli %s issues a REAL scoped query and reports that CLI models',
    async (cli) => {
      const ft = makeFormatter();
      const st = makeStderr();
      const engine = makeEngine();
      engine.scripted.set('agent:listCliModels', {
        success: true,
        data: {
          codex: ['codex-m'],
          copilot: ['copilot-m'],
          cursor: ['cursor-m'],
          antigravity: ['antigravity-m'],
          opencode: ['opencode-m'],
          pi: ['pi-m'],
        },
      });

      const code = await execute(
        { subcommand: 'models-list', cli },
        baseGlobals,
        {
          formatter: ft.formatter,
          stderr: st.stderr,
          withEngine: engine.withEngine,
        },
      );

      // Every one of these used to exit 3 before the RPC could be asked.
      expect(code).toBe(ExitCode.Success);
      expect(engine.rpcCalls.map((c) => c.method)).toEqual([
        'agent:listCliModels',
      ]);
      expect(ft.notifications[0]).toEqual({
        method: 'agent_cli.models',
        params: { cli, models: [`${cli}-m`], supported: true },
      });
      expect(st.buffer).toBe('');
    },
  );

  it('--cli codex reports [] without claiming unsupported when the RPC is silent', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'models-list', cli: 'codex' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    // `supported: true` with an empty list means "asked, nothing installed" —
    // a different fact from the ptah-cli branch's "cannot be asked".
    expect(ft.notifications[0]?.params).toEqual({
      cli: 'codex',
      models: [],
      supported: true,
    });
  });

  it.each(['ptah-cli', 'glm'])(
    '--cli %s marks the emptiness UNSUPPORTED rather than reporting no models',
    async (cli) => {
      const ft = makeFormatter();
      const st = makeStderr();
      const engine = makeEngine();

      const code = await execute(
        { subcommand: 'models-list', cli },
        baseGlobals,
        {
          formatter: ft.formatter,
          stderr: st.stderr,
          withEngine: engine.withEngine,
        },
      );

      expect(code).toBe(ExitCode.Success);
      // The distinction is the whole point: `models: []` alone read as "this
      // provider has no models". `supported: false` says the RPC cannot answer.
      const params = ft.notifications[0]?.params as {
        cli: string;
        models: unknown[];
        supported: boolean;
        reason: string;
        hint: string;
      };
      expect(ft.notifications[0]?.method).toBe('agent_cli.models');
      expect(params.cli).toBe(cli);
      expect(params.models).toEqual([]);
      expect(params.supported).toBe(false);
      expect(params.reason).toContain('Ptah CLI provider');
      expect(params.hint).toContain('agent-cli detect');

      // Nothing in the reply would have been used; it used to pay for a full
      // engine boot and an RPC round trip and then discard the result.
      expect(engine.invoked.count).toBe(0);
      expect(engine.rpcCalls).toEqual([]);
    },
  );

  it('--cli glm warns on stderr and --cli ptah-cli does not', async () => {
    const glm = makeStderr();
    const ptahCli = makeStderr();
    const engine = makeEngine();

    await execute({ subcommand: 'models-list', cli: 'glm' }, baseGlobals, {
      formatter: makeFormatter().formatter,
      stderr: glm.stderr,
      withEngine: engine.withEngine,
    });
    await execute({ subcommand: 'models-list', cli: 'ptah-cli' }, baseGlobals, {
      formatter: makeFormatter().formatter,
      stderr: ptahCli.stderr,
      withEngine: engine.withEngine,
    });

    expect(glm.buffer).toContain('deprecated');
    expect(glm.buffer).toContain('--cli ptah-cli');
    // The counterexample is what gives the assertion meaning: the notice is
    // attached to the ALIAS, not to the ptah-cli target it resolves to.
    expect(ptahCli.buffer).toBe('');
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
      { subcommand: 'stop', cli: 'glm' },
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

  it('--cli gemini rejected with exit 3 — even with PTAH_AGENT_CLI_OVERRIDE set', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      const code = await execute(
        { subcommand: 'stop', agentId: 'fake-id', cli: 'gemini' },
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
      expect(payload.data.requested_cli).toBe('gemini');
    } finally {
      if (prev === undefined) delete process.env.PTAH_AGENT_CLI_OVERRIDE;
      else process.env.PTAH_AGENT_CLI_OVERRIDE = prev;
    }
  });

  it('--cli copilot is accepted and echoed — it was never blocked downstream', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:stop', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'stop', agentId: 'agent-7', cli: 'copilot' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    // README and SKILL.md claimed copilot and cursor were "blocked due to
    // Windows spawn issues". CliDetectionService registers both, with a
    // dedicated CopilotPermissionBridge. Nothing was ever blocked but this.
    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:stop',
      params: { agentId: 'agent-7' },
    });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.stopped',
      params: { agentId: 'agent-7', cli: 'copilot' },
    });
  });

  it('succeeds with --cli omitted entirely, and omits cli from the notification', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:stop', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'stop', agentId: 'x' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    // `agent:stop` takes `{ agentId }` only — `cli` never reaches the wire, so
    // forcing the user to supply it gated a working call behind a flag that
    // reached nothing (TASK_2026_297).
    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:stop',
      params: { agentId: 'x' },
    });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.stopped',
      params: { agentId: 'x' },
    });
    expect(
      (ft.notifications[0]?.params as Record<string, unknown>)['cli'],
    ).toBeUndefined();
  });

  it('--cli glm happy path emits agent_cli.stopped and still never sends cli', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();
    engine.scripted.set('agent:stop', {
      success: true,
      data: { success: true },
    });

    const code = await execute(
      { subcommand: 'stop', agentId: 'agent-42', cli: 'glm' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(st.buffer).toContain('deprecated');
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:stop',
      params: { agentId: 'agent-42' },
    });
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.stopped',
      params: { agentId: 'agent-42', cli: 'glm' },
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
      { subcommand: 'resume', cli: 'glm' },
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

  it('--cli windsurf rejected with exit 3 — even with PTAH_AGENT_CLI_OVERRIDE set', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const prev = process.env.PTAH_AGENT_CLI_OVERRIDE;
    process.env.PTAH_AGENT_CLI_OVERRIDE = '1';
    try {
      const code = await execute(
        { subcommand: 'resume', cliSessionId: 'sess-1', cli: 'windsurf' },
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
      expect(payload.data.requested_cli).toBe('windsurf');
      expect(payload.data.allowed).toEqual([...CLI_AGENT_SELECTORS]);
    } finally {
      if (prev === undefined) delete process.env.PTAH_AGENT_CLI_OVERRIDE;
      else process.env.PTAH_AGENT_CLI_OVERRIDE = prev;
    }
  });

  it.each([...SYSTEM_CLI_TYPES])(
    '--cli %s reaches the system-CLI path with its own name on the wire',
    async (cli) => {
      const ft = makeFormatter();
      const st = makeStderr();
      const engine = makeEngine();
      engine.scripted.set('agent:resumeCliSession', {
        success: true,
        data: { success: true, agentId: `agent-${cli}` },
      });

      const code = await execute(
        {
          subcommand: 'resume',
          cliSessionId: 'sess-1',
          cli,
          task: 'finish the migration',
        },
        baseGlobals,
        {
          formatter: ft.formatter,
          stderr: st.stderr,
          withEngine: engine.withEngine,
        },
      );

      // `--cli codex` used to exit 3 here without ever reaching the transport.
      // A system CLI's selector IS its wire value — no translation, no ptahCliId.
      expect(code).toBe(ExitCode.Success);
      expect(engine.rpcCalls[0]).toEqual({
        method: 'agent:resumeCliSession',
        params: {
          cliSessionId: 'sess-1',
          cli,
          task: 'finish the migration',
        },
      });
      expect(ft.notifications[0]).toEqual({
        method: 'agent_cli.resumed',
        params: {
          cliSessionId: 'sess-1',
          cli,
          agentId: `agent-${cli}`,
        },
      });
      expect(st.buffer).toBe('');
    },
  );

  it('--ptah-cli-id against a system CLI is a usage error, not a silently dropped flag', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-1',
        cli: 'codex',
        task: 'go',
        ptahCliId: 'provider-abc',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--ptah-cli-id only applies to --cli ptah-cli');
    expect(engine.invoked.count).toBe(0);
  });

  it('rejects an absent --cli as a usage error, not a fabricated empty request', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'resume', cliSessionId: 'sess-1', task: 'go' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    // Used to emit cli_agent_unavailable with `requested_cli: ''`, reporting a
    // rejection of a value the user never supplied.
    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--cli is required');
    expect(ft.notifications).toHaveLength(0);
    expect(engine.invoked.count).toBe(0);
  });

  it('rejects a missing --task with UsageError instead of inventing an empty one', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'resume', cliSessionId: 'sess-1', cli: 'glm' },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    // Used to send `task: opts.task ?? ''`, which the boundary schema rejects.
    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--task is required');
    expect(engine.invoked.count).toBe(0);
  });

  it('rejects a whitespace-only --task', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-1',
        cli: 'glm',
        task: '   ',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--task is required');
    expect(engine.invoked.count).toBe(0);
  });

  it('rejects a present-but-empty --ptah-cli-id', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-1',
        cli: 'glm',
        task: 'go',
        ptahCliId: '',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    // Omitting the flag means "let the backend choose". Passing it empty is a
    // caller that lost its value, and `.min(1)` would reject it downstream.
    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('--ptah-cli-id must not be empty');
    expect(engine.invoked.count).toBe(0);
  });

  it('--cli glm still resolves to ptah-cli AND warns that it is deprecated', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();
    engine.scripted.set('agent:resumeCliSession', {
      success: true,
      data: { success: true, agentId: 'new-agent-7' },
    });

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-9',
        cli: 'glm',
        task: 'continue',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.Success);
    // Kept working, but says so: the alias survives only because it is
    // documented in four places, one of which ships to users as a skill.
    expect(st.buffer).toContain('deprecated');
    expect(st.buffer).toContain('--cli ptah-cli [--ptah-cli-id <id>]');
    // The bug in one assertion: this used to be `cli: 'glm'`, which no CliType
    // admits, so AgentProcessManager threw "glm CLI is not installed".
    // `ptahCliId` is ABSENT so resolveDefaultPtahCliId() runs on the backend.
    expect(engine.rpcCalls[0]).toEqual({
      method: 'agent:resumeCliSession',
      params: {
        cliSessionId: 'sess-9',
        cli: 'ptah-cli',
        task: 'continue',
      },
    });
    expect(
      (engine.rpcCalls[0]?.params as Record<string, unknown>)['ptahCliId'],
    ).toBeUndefined();

    // The notification still speaks the user's vocabulary.
    expect(ft.notifications[0]).toEqual({
      method: 'agent_cli.resumed',
      params: {
        cliSessionId: 'sess-9',
        cli: 'glm',
        agentId: 'new-agent-7',
      },
    });
  });

  it('--cli ptah-cli is the non-deprecated spelling and warns about nothing', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();
    engine.scripted.set('agent:resumeCliSession', {
      success: true,
      data: { success: true, agentId: 'new-agent-9' },
    });

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-9',
        cli: 'ptah-cli',
        task: 'continue',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(st.buffer).toBe('');
    expect(engine.rpcCalls[0]?.params).toEqual({
      cliSessionId: 'sess-9',
      cli: 'ptah-cli',
      task: 'continue',
    });
  });

  it('--ptah-cli-id pins a provider and is echoed back', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('agent:resumeCliSession', {
      success: true,
      data: { success: true, agentId: 'new-agent-8' },
    });

    const code = await execute(
      {
        subcommand: 'resume',
        cliSessionId: 'sess-9',
        cli: 'glm',
        task: 'continue',
        ptahCliId: 'provider-abc',
      },
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({
      cliSessionId: 'sess-9',
      cli: 'ptah-cli',
      task: 'continue',
      ptahCliId: 'provider-abc',
    });
    expect(ft.notifications[0]?.params).toEqual({
      cliSessionId: 'sess-9',
      cli: 'glm',
      ptahCliId: 'provider-abc',
      agentId: 'new-agent-8',
    });
  });
});

// ---------------------------------------------------------------------------
// Label -> wire vocabulary translation (the cast this task deleted)
// ---------------------------------------------------------------------------

describe('resolveCliAgentTarget', () => {
  it('maps every selector to a real CliType', () => {
    // Total by construction — the table is a Record<CliAgentSelector, _>, so
    // this loop cannot find a selector without a mapping. The accepted SET is
    // derived; each selector's wire MEANING is still a DECISION, not a cast.
    for (const selector of CLI_AGENT_SELECTORS) {
      const target = resolveCliAgentTarget(selector);
      expect([...SYSTEM_CLI_TYPES, 'ptah-cli']).toContain(target.cli);
      expect(target.ptahCliId).toBeUndefined();
    }
  });

  it('maps each system CLI to itself — a binary name is its own wire value', () => {
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(resolveCliAgentTarget(cli)).toEqual({ cli });
    }
  });

  it('maps ptah-cli to itself with no invented provider id', () => {
    expect(resolveCliAgentTarget('ptah-cli')).toEqual({ cli: 'ptah-cli' });
  });

  it('maps the glm alias to ptah-cli and carries the deprecation notice', () => {
    const target = resolveCliAgentTarget('glm');
    expect(target.cli).toBe('ptah-cli');
    expect(target.ptahCliId).toBeUndefined();
    expect(target.deprecation).toContain('--cli ptah-cli');
  });

  it('marks glm as the ONLY deprecated selector', () => {
    const deprecated = CLI_AGENT_SELECTORS.filter(
      (s) => resolveCliAgentTarget(s).deprecation !== undefined,
    );
    expect(deprecated).toEqual(['glm']);
  });
});

// ---------------------------------------------------------------------------
// THE WIRE PAYLOAD, JUDGED BY THE SCHEMA THAT ACTUALLY JUDGES IT
//
// Every other test in this file runs against a mocked transport. That is
// exactly how `cli: 'glm'` survived: the mock accepted a value the real
// boundary rejects. These parse the CLI's own payload with the backend's
// AgentResumeCliSessionParamsSchema.
// ---------------------------------------------------------------------------

describe('buildResumeCliSessionParams satisfies AgentResumeCliSessionParamsSchema', () => {
  it('accepts the default-provider payload (no ptahCliId)', () => {
    const params = buildResumeCliSessionParams({
      cliSessionId: 'sess-9',
      task: 'continue',
      target: resolveCliAgentTarget('glm'),
    });

    const parsed = AgentResumeCliSessionParamsSchema.safeParse(params);
    expect(parsed.success).toBe(true);
    expect(params.cli).toBe('ptah-cli');
    // Absent, not present-and-undefined: the backend only runs
    // resolveDefaultPtahCliId() when the key is genuinely missing.
    expect(Object.prototype.hasOwnProperty.call(params, 'ptahCliId')).toBe(
      false,
    );
  });

  it('accepts the pinned-provider payload', () => {
    const params = buildResumeCliSessionParams({
      cliSessionId: 'sess-9',
      task: 'continue',
      target: resolveCliAgentTarget('glm'),
      ptahCliId: 'provider-abc',
    });

    expect(AgentResumeCliSessionParamsSchema.safeParse(params).success).toBe(
      true,
    );
  });

  it('produces a schema-valid payload for EVERY selector', () => {
    // The acceptance property of phase 2: widening the accepted set cannot
    // introduce a target whose payload the boundary refuses. Driven off
    // CLI_AGENT_SELECTORS, which is itself derived from SYSTEM_CLI_TYPES, so a
    // seventh adapter is covered the day it is added.
    for (const selector of CLI_AGENT_SELECTORS) {
      const params = buildResumeCliSessionParams({
        cliSessionId: 'sess-1',
        task: 'work',
        target: resolveCliAgentTarget(selector),
      });
      const parsed = AgentResumeCliSessionParamsSchema.safeParse(params);
      expect(parsed.success).toBe(true);
    }
  });

  it('never leaks the deprecation notice into the wire payload', () => {
    const params = buildResumeCliSessionParams({
      cliSessionId: 'sess-1',
      task: 'work',
      target: resolveCliAgentTarget('glm'),
    });
    // The schema is `.passthrough()`, so an extra key would sail through
    // validation and land in the backend's params untouched.
    expect(Object.keys(params).sort()).toEqual(['cli', 'cliSessionId', 'task']);
  });

  it("rejects the payload the CLI used to send (cli: 'glm')", () => {
    // Regression pin for the defect itself. If this ever passes, the wire
    // vocabulary has been widened to swallow a provider label and the
    // "glm CLI is not installed" failure is back.
    const parsed = AgentResumeCliSessionParamsSchema.safeParse({
      cliSessionId: 'sess-9',
      cli: 'glm',
      task: 'continue',
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects the empty task the CLI used to invent (task: '')", () => {
    const parsed = AgentResumeCliSessionParamsSchema.safeParse({
      cliSessionId: 'sess-9',
      cli: 'ptah-cli',
      task: '',
    });
    expect(parsed.success).toBe(false);
  });
});
