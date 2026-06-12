/**
 * Unit tests for `ptah skill-synthesis` command.
 *
 * Coverage:
 *   - list: dispatches skillSynthesis:listCandidates; --status validation
 *   - get / promote / reject: UsageError without id; dispatch + emit
 *   - reject: forwards optional --reason
 *   - invocations: UsageError without skillId; forwards --limit
 *   - stats: dispatches skillSynthesis:stats
 *   - error mapping: RPC failure (success:false) bubbles via task.error
 *   - human output: --human mode drives the same notifications
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './skill-synthesis.js';
import type {
  SkillSynthesisExecuteHooks,
  SkillSynthesisOptions,
} from './skill-synthesis.js';
import { ExitCode } from '../jsonrpc/types.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
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

interface MockEngine {
  withEngine: SkillSynthesisExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
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

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: SkillSynthesisExecuteHooks;
} {
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

function findNotification(
  trace: FormatterTrace,
  method: string,
): { method: string; params?: unknown } | undefined {
  return trace.notifications.find((n) => n.method === method);
}

describe('ptah skill-synthesis list', () => {
  it('dispatches skillSynthesis:listCandidates with status/limit', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:listCandidates', {
      success: true,
      data: { candidates: [{ id: 's1' }] },
    });
    const exit = await execute(
      {
        subcommand: 'list',
        status: 'candidate',
        limit: 5,
      } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'skillSynthesis:listCandidates',
    );
    expect(call?.params).toEqual({ status: 'candidate', limit: 5 });
    const note = findNotification(formatterTrace, 'skill_synthesis.list');
    expect(note?.params).toMatchObject({ candidates: [{ id: 's1' }] });
  });

  it('exits 2 (UsageError) on an invalid --status', async () => {
    const { engine, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'list', status: 'bogus' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--status must be one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});

describe('ptah skill-synthesis get / promote / reject', () => {
  it.each(['get', 'promote', 'reject'] as const)(
    'exits 2 (UsageError) when id is missing (%s)',
    async (subcommand) => {
      const { hooks, engine } = buildHooks();
      const exit = await execute(
        { subcommand } satisfies SkillSynthesisOptions,
        baseGlobals,
        hooks,
      );
      expect(exit).toBe(ExitCode.UsageError);
      expect(engine.rpcCalls).toHaveLength(0);
    },
  );

  it('get dispatches skillSynthesis:getCandidate', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:getCandidate', {
      success: true,
      data: { candidate: { id: 's1' } },
    });
    const exit = await execute(
      { subcommand: 'get', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'skillSynthesis:getCandidate')
        ?.params,
    ).toEqual({ id: 's1' });
    const note = findNotification(formatterTrace, 'skill_synthesis.candidate');
    expect(note?.params).toMatchObject({ id: 's1' });
  });

  it('promote dispatches skillSynthesis:promote and emits the result', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:promote', {
      success: true,
      data: { promoted: true, reason: null, filePath: '/tmp/x/SKILL.md' },
    });
    const exit = await execute(
      { subcommand: 'promote', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'skill_synthesis.promoted');
    expect(note?.params).toMatchObject({
      id: 's1',
      promoted: true,
      filePath: '/tmp/x/SKILL.md',
    });
  });

  it('reject forwards an optional --reason', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:reject', {
      success: true,
      data: { rejected: true },
    });
    const exit = await execute(
      {
        subcommand: 'reject',
        id: 's1',
        reason: 'too narrow',
      } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'skillSynthesis:reject',
    );
    expect(call?.params).toEqual({ id: 's1', reason: 'too narrow' });
    const note = findNotification(formatterTrace, 'skill_synthesis.rejected');
    expect(note?.params).toMatchObject({ id: 's1', rejected: true });
  });

  it('reject exits 2 (UsageError) on a rejected:false result after emitting it', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:reject', {
      success: true,
      data: { rejected: false },
    });
    const exit = await execute(
      { subcommand: 'reject', id: 's1' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    const note = findNotification(formatterTrace, 'skill_synthesis.rejected');
    expect(note?.params).toMatchObject({ id: 's1', rejected: false });
  });
});

describe('ptah skill-synthesis invocations', () => {
  it('exits 2 (UsageError) without a skillId', async () => {
    const { engine, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'invocations' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<skillId> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches skillSynthesis:invocations with limit', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:invocations', {
      success: true,
      data: { invocations: [] },
    });
    const exit = await execute(
      {
        subcommand: 'invocations',
        skillId: 'my-skill',
        limit: 10,
      } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'skillSynthesis:invocations',
    );
    expect(call?.params).toEqual({ skillId: 'my-skill', limit: 10 });
    const note = findNotification(
      formatterTrace,
      'skill_synthesis.invocations',
    );
    expect(note?.params).toMatchObject({ skillId: 'my-skill' });
  });
});

describe('ptah skill-synthesis stats', () => {
  it('dispatches skillSynthesis:stats and emits the counts', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:stats', {
      success: true,
      data: {
        totalCandidates: 3,
        totalPromoted: 1,
        totalRejected: 0,
        totalInvocations: 9,
        activeSkills: 1,
      },
    });
    const exit = await execute(
      { subcommand: 'stats' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'skillSynthesis:stats',
      params: {},
    });
    const note = findNotification(formatterTrace, 'skill_synthesis.stats');
    expect(note?.params).toMatchObject({ totalCandidates: 3, activeSkills: 1 });
  });
});

describe('ptah skill-synthesis error mapping', () => {
  it('bubbles a stats RPC failure as task.error (exit 5)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillSynthesis:stats', {
      success: false,
      error: 'store unavailable',
    });
    const exit = await execute(
      { subcommand: 'stats' } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ message: 'store unavailable' });
  });
});

describe('ptah skill-synthesis human output', () => {
  it('renders list notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({
      human: true,
      noColor: true,
      writer,
    });
    const engine = makeEngine();
    engine.scripted.set('skillSynthesis:listCandidates', {
      success: true,
      data: { candidates: [] },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies SkillSynthesisOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/skill_synthesis\.list/);
  });
});

describe('ptah skill-synthesis unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'bogus' as unknown as 'list',
      } satisfies SkillSynthesisOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
