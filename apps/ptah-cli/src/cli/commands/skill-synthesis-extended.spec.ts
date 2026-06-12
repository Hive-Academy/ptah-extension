import { execute } from './skill-synthesis.js';
import type {
  SkillSynthesisExecuteHooks,
  SkillSynthesisOptions,
} from './skill-synthesis.js';
import { ExitCode } from '../jsonrpc/types.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { StdoutWriter } from '../io/stdout-writer.js';

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

type ScriptedResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string; errorCode?: string };

function makeEngine(): {
  withEngine: SkillSynthesisExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
} {
  const rpcCalls: Array<{ method: string; params: unknown }> = [];
  const scripted: Map<string, ScriptedResponse> = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: {} };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve hit — skill-synthesis cmd should not reach DI',
      );
    }),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as SkillSynthesisExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks() {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: SkillSynthesisExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah skill-synthesis — exit-code contract for transport failures', () => {
  it.each([
    ['list', { subcommand: 'list' as const }, 'skillSynthesis:listCandidates'],
    [
      'get',
      { subcommand: 'get' as const, id: 's1' },
      'skillSynthesis:getCandidate',
    ],
    [
      'invocations',
      { subcommand: 'invocations' as const, skillId: 'my-skill' },
      'skillSynthesis:invocations',
    ],
    ['stats', { subcommand: 'stats' as const }, 'skillSynthesis:stats'],
  ] as const)(
    '%s transport failure → InternalFailure',
    async (_name, opts, rpcMethod) => {
      const { engine, hooks, formatterTrace } = buildHooks();
      engine.scripted.set(rpcMethod, {
        success: false,
        error: `${rpcMethod} unavailable`,
      });
      const exit = await execute(
        opts as SkillSynthesisOptions,
        baseGlobals,
        hooks,
      );
      expect(exit).toBe(ExitCode.InternalFailure);
      const last =
        formatterTrace.notifications[formatterTrace.notifications.length - 1];
      expect(last?.method).toBe('task.error');
    },
  );

  it('promote transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('skillSynthesis:promote', {
      success: false,
      error: 'promote failed',
    });
    const exit = await execute(
      { subcommand: 'promote', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('reject transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('skillSynthesis:reject', {
      success: false,
      error: 'reject rpc error',
    });
    const exit = await execute(
      { subcommand: 'reject', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah skill-synthesis promote — promoted:false exits UsageError', () => {
  it('promote returns ExitCode.UsageError when promoted:false (symmetric with reject)', async () => {
    const { engine, formatterTrace, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:promote', {
      success: true,
      data: { promoted: false, reason: 'below threshold' },
    });
    const exit = await execute(
      { subcommand: 'promote', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    const note = formatterTrace.notifications.find(
      (n) => n.method === 'skill_synthesis.promoted',
    );
    expect(note?.params).toMatchObject({ id: 's1', promoted: false });
  });

  it('promote emits skill_synthesis.promoted with reason even when promoted:false', async () => {
    const { engine, formatterTrace, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:promote', {
      success: true,
      data: { promoted: false, reason: 'below threshold' },
    });
    const exit = await execute(
      { subcommand: 'promote', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    const note = formatterTrace.notifications.find(
      (n) => n.method === 'skill_synthesis.promoted',
    );
    expect(note?.params).toMatchObject({
      id: 's1',
      promoted: false,
      reason: 'below threshold',
    });
  });
});

describe('ptah skill-synthesis invocations — limit forwarding', () => {
  it('defaults limit when not supplied', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:invocations', {
      success: true,
      data: { invocations: [] },
    });
    const exit = await execute(
      {
        subcommand: 'invocations',
        skillId: 'my-skill',
      } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'skillSynthesis:invocations',
    );
    expect((call?.params as { skillId: string }).skillId).toBe('my-skill');
  });
});

describe('ptah skill-synthesis stats — --human rendering', () => {
  it('renders skill_synthesis.stats in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({ human: true, noColor: true, writer });
    const engine = makeEngine();
    engine.scripted.set('skillSynthesis:stats', {
      success: true,
      data: {
        totalCandidates: 0,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
    });
    const exit = await execute(
      { subcommand: 'stats' } satisfies SkillSynthesisOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/skill_synthesis\.stats/);
  });

  it('renders skill_synthesis.invocations in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({ human: true, noColor: true, writer });
    const engine = makeEngine();
    engine.scripted.set('skillSynthesis:invocations', {
      success: true,
      data: { invocations: [] },
    });
    const exit = await execute(
      {
        subcommand: 'invocations',
        skillId: 'my-skill',
      } satisfies SkillSynthesisOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/skill_synthesis\.invocations/);
  });

  it('renders skill_synthesis.promoted in --human mode', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({ human: true, noColor: true, writer });
    const engine = makeEngine();
    engine.scripted.set('skillSynthesis:promote', {
      success: true,
      data: { promoted: true, reason: null, filePath: '/tmp/SKILL.md' },
    });
    const exit = await execute(
      { subcommand: 'promote', id: 's1' } satisfies SkillSynthesisOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/skill_synthesis\.promoted/);
  });

  it('renders skill_synthesis.rejected in --human mode', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({ human: true, noColor: true, writer });
    const engine = makeEngine();
    engine.scripted.set('skillSynthesis:reject', {
      success: true,
      data: { rejected: true },
    });
    const exit = await execute(
      { subcommand: 'reject', id: 's1' } satisfies SkillSynthesisOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/skill_synthesis\.rejected/);
  });
});
