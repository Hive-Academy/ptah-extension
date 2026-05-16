/**
 * Unit tests for `ptah harness` command.
 *
 * Coverage:
 *   - init:
 *       * pure mkdir, no DI
 *       * idempotent — second run reports skipped[] and changed:false
 *   - status:
 *       * pure fs.readdir, no DI
 *       * absent .ptah/ → has_ptah_dir:false
 *       * populated .ptah/ → emits skill / agent / spec / preset arrays
 *   - scan:
 *       * dispatches harness:initialize and emits 4 notifications
 *   - apply:
 *       * UsageError without --preset
 *       * loads presets, finds match, dispatches harness:apply
 *       * unknown preset bubbles via task.error
 *   - preset save:
 *       * UsageError without <name> or --from
 *       * reads JSON config, dispatches harness:save-preset
 *   - preset load: dispatches harness:load-presets
 *   - chat (B10d alias for session start --scope harness-skill):
 *       * delegates to executeSessionStart with scope:harness-skill
 *       * forwards --profile / --session / --task into the delegation
 *       * propagates non-zero exit codes from the underlying session start
 *   - analyze-intent:
 *       * UsageError when --intent < 10 chars
 *       * dispatches harness:analyze-intent
 *   - design-agents:
 *       * generic mode emits agent_design.start + agent_design.complete
 *       * --workspace mode derives persona from harness:initialize
 *   - generate-document:
 *       * UsageError when --kind not in {prd, spec}
 *       * dispatches harness:generate-document and emits start + complete
 *   - unknown sub-command → exit 2
 */

import { execute } from './harness.js';
import type { HarnessExecuteHooks, HarnessOptions } from './harness.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
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
  withEngine: HarnessExecuteHooks['withEngine'];
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
      throw new Error(
        'container.resolve hit — harness cmd should not reach DI directly',
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
  }) as unknown as HarnessExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

interface MockFs {
  mkdir: jest.Mock;
  readdir: jest.Mock;
  stat: jest.Mock;
  readFile: jest.Mock;
}

function makeMockFs(): MockFs {
  return {
    mkdir: jest.fn(async (_p: string, _o: { recursive: boolean }) => undefined),
    readdir: jest.fn(async (_p: string) => [] as string[]),
    stat: jest.fn(async (_p: string) => ({
      isDirectory: () => false,
    })),
    readFile: jest.fn(async (_p: string) => '{}'),
  };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  fs: MockFs;
  hooks: HarnessExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const fs = makeMockFs();
  const hooks: HarnessExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
    mkdir: fs.mkdir,
    readdir: fs.readdir,
    stat: fs.stat,
    readFile: fs.readFile,
  };
  return { formatterTrace, stderrTrace, engine, fs, hooks };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
describe('ptah harness init', () => {
  it('creates the .ptah scaffold and emits changed:true on first run', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.stat.mockRejectedValue(new Error('ENOENT'));

    const exit = await execute(
      { subcommand: 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.mkdir).toHaveBeenCalledTimes(5); // 5 scaffold dirs
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.initialized');
    expect(last?.params).toMatchObject({ changed: true });
    expect(
      (last?.params as { created: string[] }).created.length,
    ).toBeGreaterThan(0);
  });

  it('is idempotent — second run reports skipped[] and changed:false', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.stat.mockResolvedValue({ isDirectory: () => true });

    const exit = await execute(
      { subcommand: 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.mkdir).not.toHaveBeenCalled();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({ changed: false });
    expect((last?.params as { skipped: string[] }).skipped.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
describe('ptah harness status', () => {
  it('emits has_ptah_dir:false when .ptah is missing', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.readdir.mockRejectedValue(new Error('ENOENT'));

    const exit = await execute(
      { subcommand: 'status' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('harness.status');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      has_ptah_dir: false,
      has_skills: false,
    });
  });

  it('emits populated arrays when .ptah/ has children', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.readdir.mockImplementation(async (p: string) => {
      if (p.endsWith('.ptah') || p.endsWith('.ptah/')) {
        return ['skills', 'agents'];
      }
      if (p.endsWith('skills')) return ['skill-a', 'skill-b'];
      if (p.endsWith('agents')) return ['agent-1'];
      return [];
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as {
      has_ptah_dir: boolean;
      has_skills: boolean;
      skills: string[];
      agents: string[];
    };
    expect(params.has_ptah_dir).toBe(true);
    expect(params.has_skills).toBe(true);
    expect(params.skills).toEqual(['skill-a', 'skill-b']);
    expect(params.agents).toEqual(['agent-1']);
  });
});

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------
describe('ptah harness scan', () => {
  it('dispatches harness:initialize and emits 4 notifications', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: { projectName: 'app', projectType: 'node' },
        availableAgents: [{ id: 'a1' }],
        availableSkills: [{ id: 's1' }],
        existingPresets: [],
      },
    });
    const exit = await execute(
      { subcommand: 'scan' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.workspace_context',
      'harness.available_agents',
      'harness.available_skills',
      'harness.existing_presets',
    ]);
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
describe('ptah harness apply', () => {
  it('exits 2 when --preset is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'apply' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--preset <id> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('loads presets, finds match by id, dispatches harness:apply', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: {
        presets: [
          {
            id: 'preset-1',
            name: 'Preset One',
            config: { name: 'Preset One' },
          },
        ],
      },
    });
    engine.scripted.set('harness:apply', {
      success: true,
      data: { appliedPaths: ['.ptah/presets/preset-1.json'], warnings: [] },
    });
    const exit = await execute(
      { subcommand: 'apply', preset: 'preset-1' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.applied');
    expect(last?.params).toMatchObject({ presetId: 'preset-1' });
  });

  it('bubbles unknown preset as task.error', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: { presets: [] },
    });
    const exit = await execute(
      { subcommand: 'apply', preset: 'missing' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

// ---------------------------------------------------------------------------
// preset save / load
// ---------------------------------------------------------------------------
describe('ptah harness preset save', () => {
  it('exits 2 when <name> is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'preset-save', from: 'p.json' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<name> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 when --from is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'preset-save', name: 'p1' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--from <path> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('reads JSON config and dispatches harness:save-preset', async () => {
    const { formatterTrace, engine, fs, hooks } = buildHooks();
    fs.readFile.mockResolvedValue(
      JSON.stringify({ name: 'Preset One', persona: { label: 'l' } }),
    );
    engine.scripted.set('harness:save-preset', {
      success: true,
      data: {
        presetId: 'preset-one',
        presetPath: '.ptah/presets/preset-one.json',
      },
    });
    const exit = await execute(
      {
        subcommand: 'preset-save',
        name: 'Preset One',
        from: 'D:/cfg.json',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.readFile).toHaveBeenCalledWith('D:/cfg.json');
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.preset.saved');
  });
});

describe('ptah harness preset load', () => {
  it('dispatches harness:load-presets and emits harness.preset.list', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: { presets: [{ id: 'p1', name: 'P1' }] },
    });
    const exit = await execute(
      { subcommand: 'preset-load' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('harness.preset.list');
  });
});

// ---------------------------------------------------------------------------
// chat — delegates to `session start --scope harness-skill` via
// `executeSessionStart`. The body is a thin pass-through;
// these tests verify the delegation surface (option forwarding + exit-code
// propagation) without exercising the full session DI bootstrap.
// ---------------------------------------------------------------------------
type DelegateMock = jest.MockedFunction<
  NonNullable<HarnessExecuteHooks['executeSessionStart']>
>;

function makeDelegate(returnCode: number): DelegateMock {
  return jest.fn(async () => returnCode) as unknown as DelegateMock;
}

describe('ptah harness chat (alias for session start --scope harness-skill)', () => {
  it('delegates to executeSessionStart with scope:harness-skill and exits 0 on success', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'hello',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(delegate).toHaveBeenCalledTimes(1);
    const callOpts = delegate.mock.calls[0]?.[0];
    expect(callOpts).toMatchObject({
      task: 'hello',
      scope: 'harness-skill',
      cwd: baseGlobals.cwd,
    });
  });

  it('forwards --profile and --session through the delegation surface', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'follow-up',
        profile: 'enhanced',
        session: 'sdk-session-1',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const callOpts = delegate.mock.calls[0]?.[0];
    expect(callOpts).toMatchObject({
      task: 'follow-up',
      profile: 'enhanced',
      scope: 'harness-skill',
      resumeId: 'sdk-session-1',
    });
  });

  it('propagates a non-zero exit code from executeSessionStart', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(1);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      { subcommand: 'chat', task: 'boom' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
  });
});

// ---------------------------------------------------------------------------
// analyze-intent
// ---------------------------------------------------------------------------
describe('ptah harness analyze-intent', () => {
  it('exits 2 when --intent is missing or shorter than 10 chars', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'analyze-intent',
        intent: 'short',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/min 10 chars/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches harness:analyze-intent and emits harness.intent.analysis', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:analyze-intent', {
      success: true,
      data: {
        persona: { label: 'p', description: 'd', goals: [] },
        suggestedAgents: { 'agent-1': true },
        suggestedSubagents: [],
        suggestedSkills: [],
        suggestedSkillSpecs: [],
        suggestedMcpServers: [],
        summary: 's',
        reasoning: 'r',
      },
    });
    const exit = await execute(
      {
        subcommand: 'analyze-intent',
        intent: 'I want to ship a new feature for my Node app',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('harness:analyze-intent');
    expect(formatterTrace.notifications[0]?.method).toBe(
      'harness.intent.analysis',
    );
  });
});

// ---------------------------------------------------------------------------
// design-agents
// ---------------------------------------------------------------------------
describe('ptah harness design-agents', () => {
  it('emits start + complete notifications in generic mode', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:design-agents', {
      success: true,
      data: { subagents: [{ id: 'sub-1' }], reasoning: 'r' },
    });
    const exit = await execute(
      { subcommand: 'design-agents' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.agent_design.start',
      'harness.agent_design.complete',
    ]);
    // Should NOT call harness:initialize without --workspace.
    expect(
      engine.rpcCalls.find((c) => c.method === 'harness:initialize'),
    ).toBeUndefined();
  });

  it('derives persona from harness:initialize when --workspace is set', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: {
          projectName: 'my-app',
          projectType: 'node',
          frameworks: ['react'],
        },
        availableAgents: [{ id: 'existing-1' }],
      },
    });
    engine.scripted.set('harness:design-agents', {
      success: true,
      data: { subagents: [], reasoning: '' },
    });
    const exit = await execute(
      { subcommand: 'design-agents', workspace: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const initCall = engine.rpcCalls.find(
      (c) => c.method === 'harness:initialize',
    );
    expect(initCall).toBeDefined();
    const startEvt = formatterTrace.notifications[0];
    expect(startEvt?.method).toBe('harness.agent_design.start');
    expect(startEvt?.params).toMatchObject({
      workspace: true,
      persona: { label: 'my-app', goals: ['react'] },
    });
  });
});

// ---------------------------------------------------------------------------
// generate-document
// ---------------------------------------------------------------------------
describe('ptah harness generate-document', () => {
  it('exits 2 when --kind is not in {prd, spec}', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'generate-document',
        kind: 'novel',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--kind must be one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches harness:generate-document and emits start + complete', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: { projectName: 'x', projectType: 'node' },
        availableAgents: [],
        availableSkills: [],
        existingPresets: [],
      },
    });
    engine.scripted.set('harness:generate-document', {
      success: true,
      data: { document: '# PRD', sections: { Overview: 'overview' } },
    });
    const exit = await execute(
      { subcommand: 'generate-document', kind: 'prd' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.document.start',
      'harness.document.complete',
    ]);
  });
});

// ---------------------------------------------------------------------------
// unknown sub-command
// ---------------------------------------------------------------------------
describe('ptah harness unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});

// ---------------------------------------------------------------------------
// Router-level harness chat parser sanity (flag set must mirror
// `session start --scope harness-skill` since the body now delegates).
// ---------------------------------------------------------------------------
describe('ptah harness chat — router parsing', () => {
  it('accepts --task / --profile / --session / --auto-approve without parser error', async () => {
    // We can't instantiate the full router cheaply here, so this test just
    // documents the contract via the harness execute() entry point — any
    // flags on the harness sub-subcommand parser must NOT cause execute()
    // itself to error. The parser surface lives in router.ts and is
    // smoke-tested via `ptah harness chat --help`.
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'a task',
        profile: 'claude_code',
        session: 'sid',
        autoApprove: true,
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(delegate).toHaveBeenCalledTimes(1);
  });
});
