/**
 * Unit tests for `ptah skill` command.
 *
 * Coverage:
 *   - search: dispatches skillsSh:search; usage error without query;
 *     RPC `error` field bubbles via task.error
 *   - installed: dispatches skillsSh:listInstalled
 *   - install:
 *       * UsageError when source missing or scope invalid
 *       * first run → `skillsSh:install` + emits `skill.installed { changed: true }`
 *       * second run → skips install RPC + emits `changed: false`
 *   - remove: idempotent — emits `changed: false` when skill absent
 *   - popular / recommended: emit the correct notifications
 *   - create:
 *       * UsageError when --from-spec missing
 *       * UsageError when spec file unreadable, invalid JSON, or schema-invalid
 *       * dispatches harness:create-skill on a valid spec
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './skill.js';
import type { SkillExecuteHooks, SkillOptions } from './skill.js';
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
  withEngine: SkillExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error('container.resolve hit — skill cmd should not reach DI');
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
  }) as unknown as SkillExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(opts: { readSpec?: SkillExecuteHooks['readSpec'] } = {}): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: SkillExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: SkillExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  if (opts.readSpec) hooks.readSpec = opts.readSpec;
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah skill search', () => {
  it('exits 2 (UsageError) when query is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'search' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches skillsSh:search and emits skill.search', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:search', {
      success: true,
      data: {
        skills: [
          {
            source: 'a/b',
            skillId: 'x',
            name: 'X',
            description: '',
            installs: 1,
            isInstalled: false,
          },
        ],
      },
    });
    const exit = await execute(
      { subcommand: 'search', query: 'react' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'skillsSh:search',
      params: { query: 'react' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('skill.search');
  });

  it('bubbles inline `error` field as task.error', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:search', {
      success: true,
      data: { skills: [], error: 'CLI not installed' },
    });
    const exit = await execute(
      { subcommand: 'search', query: 'react' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah skill installed', () => {
  it('emits skill.list via skillsSh:listInstalled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: {
        skills: [
          {
            name: 'foo',
            description: '',
            source: 'a/b',
            path: '/p',
            scope: 'project',
            agents: [],
          },
        ],
      },
    });
    const exit = await execute(
      { subcommand: 'installed' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('skillsSh:listInstalled');
    expect(formatterTrace.notifications[0]?.method).toBe('skill.list');
  });
});

describe('ptah skill install', () => {
  it('exits 2 (UsageError) when source is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'install' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) for invalid --scope', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'install',
        source: 'a/b',
        scope: 'bogus',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits skill.installed { changed: true } on first install', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: { skills: [] },
    });
    engine.scripted.set('skillsSh:install', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      {
        subcommand: 'install',
        source: 'vercel-labs/agent-skills',
        skillId: 'react-best-practices',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const installCall = engine.rpcCalls.find(
      (c) => c.method === 'skillsSh:install',
    );
    expect(installCall).toBeDefined();
    expect(installCall?.params).toMatchObject({
      source: 'vercel-labs/agent-skills',
      skillId: 'react-best-practices',
      scope: 'project',
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('skill.installed');
    expect(last?.params).toMatchObject({ changed: true });
  });

  it('is idempotent — second run emits changed:false and skips skillsSh:install', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: {
        skills: [
          {
            name: 'react-best-practices',
            description: '',
            source: 'vercel-labs/agent-skills',
            path: '/p',
            scope: 'project',
            agents: [],
          },
        ],
      },
    });
    const exit = await execute(
      {
        subcommand: 'install',
        source: 'vercel-labs/agent-skills',
        skillId: 'react-best-practices',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'skillsSh:install'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('skill.installed');
    expect(last?.params).toMatchObject({ changed: false });
  });

  it('bubbles install RPC failure (success:false) as task.error', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: { skills: [] },
    });
    engine.scripted.set('skillsSh:install', {
      success: true,
      data: { success: false, error: 'no workspace' },
    });
    const exit = await execute(
      {
        subcommand: 'install',
        source: 'a/b',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah skill remove', () => {
  it('exits 2 (UsageError) when name is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'remove' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits skill.removed { changed: false } when not installed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: { skills: [] },
    });
    const exit = await execute(
      { subcommand: 'remove', name: 'foo' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'skillsSh:uninstall'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('skill.removed');
    expect(last?.params).toMatchObject({ changed: false });
  });

  it('runs uninstall and emits changed:true when present', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:listInstalled', {
      success: true,
      data: {
        skills: [
          {
            name: 'foo',
            description: '',
            source: 'foo',
            path: '/p',
            scope: 'project',
            agents: [],
          },
        ],
      },
    });
    engine.scripted.set('skillsSh:uninstall', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'remove', name: 'foo' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const uninstall = engine.rpcCalls.find(
      (c) => c.method === 'skillsSh:uninstall',
    );
    expect(uninstall).toBeDefined();
    expect(uninstall?.params).toMatchObject({
      name: 'foo',
      scope: 'project',
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('skill.removed');
    expect(last?.params).toMatchObject({ changed: true });
  });
});

describe('ptah skill popular / recommended', () => {
  it('emits skill.popular via skillsSh:getPopular', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:getPopular', {
      success: true,
      data: { skills: [] },
    });
    const exit = await execute(
      { subcommand: 'popular' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('skillsSh:getPopular');
    expect(formatterTrace.notifications[0]?.method).toBe('skill.popular');
  });

  it('emits skill.recommended via skillsSh:detectRecommended', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('skillsSh:detectRecommended', {
      success: true,
      data: {
        detectedTechnologies: {
          frameworks: ['react'],
          languages: [],
          tools: [],
        },
        recommendedSkills: [],
      },
    });
    const exit = await execute(
      { subcommand: 'recommended' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('skillsSh:detectRecommended');
    expect(formatterTrace.notifications[0]?.method).toBe('skill.recommended');
  });
});

describe('ptah skill create', () => {
  const validSpec = JSON.stringify({
    name: 'my-skill',
    description: 'A test skill',
    content: '# Skill\nDo things.',
    allowedTools: ['Read', 'Edit'],
  });

  it('exits 2 (UsageError) when --from-spec missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'create' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) when spec file is unreadable', async () => {
    const { hooks, engine, stderrTrace } = buildHooks({
      readSpec: jest.fn(async () => {
        throw new Error('ENOENT');
      }),
    });
    const exit = await execute(
      {
        subcommand: 'create',
        fromSpec: 'D:/missing.json',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/failed to read spec/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) on invalid JSON', async () => {
    const { hooks, engine, stderrTrace } = buildHooks({
      readSpec: jest.fn(async () => 'not-json'),
    });
    const exit = await execute(
      {
        subcommand: 'create',
        fromSpec: 'D:/bad.json',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/invalid JSON/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) when spec is missing required fields', async () => {
    const { hooks, engine, stderrTrace } = buildHooks({
      readSpec: jest.fn(async () => JSON.stringify({ name: 'x' })),
    });
    const exit = await execute(
      {
        subcommand: 'create',
        fromSpec: 'D:/incomplete.json',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/spec\.(description|content)/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches harness:create-skill on a valid spec', async () => {
    const { formatterTrace, engine, hooks } = buildHooks({
      readSpec: jest.fn(async () => validSpec),
    });
    engine.scripted.set('harness:create-skill', {
      success: true,
      data: {
        skillId: 'my-skill',
        skillPath: 'D:/proj/.claude/skills/my-skill',
      },
    });
    const exit = await execute(
      {
        subcommand: 'create',
        fromSpec: 'D:/spec.json',
      } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'harness:create-skill',
    );
    expect(call).toBeDefined();
    expect(call?.params).toMatchObject({
      name: 'my-skill',
      description: 'A test skill',
      content: '# Skill\nDo things.',
      allowedTools: ['Read', 'Edit'],
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('skill.created');
    expect(last?.params).toMatchObject({
      skillId: 'my-skill',
      name: 'my-skill',
    });
  });
});

describe('ptah skill unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'search' } satisfies SkillOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
