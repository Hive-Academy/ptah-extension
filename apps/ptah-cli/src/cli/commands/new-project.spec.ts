/**
 * Unit tests for `ptah new-project` command — TASK_2026_104 Sub-batch B9b.
 *
 * Coverage:
 *   - select-type: dispatches wizard:new-project-select-type;
 *     missing <type> exits 2 (UsageError)
 *   - submit-answers: validates JSON file, dispatches RPC, emits
 *     new_project.answers.received; success: false → task.error + exit 5;
 *     missing --file / unreadable / invalid JSON / schema-invalid → exit 2
 *   - get-plan: requires <session-id>, emits new_project.plan
 *   - approve-plan: requires <session-id>, emits new_project.plan.approved
 *   - unknown sub-command: exit 2
 */

import { execute } from './new-project.js';
import type {
  NewProjectExecuteHooks,
  NewProjectOptions,
} from './new-project.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/tmp/ws',
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
  withEngine: NewProjectExecuteHooks['withEngine'];
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
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: { __default: method } };
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
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as NewProjectExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

describe('ptah new-project select-type', () => {
  it('exits 2 (UsageError) when <type> is missing', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'select-type' } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<type> is required');
  });

  it('dispatches wizard:new-project-select-type and emits new_project.session.started', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-select-type', {
      success: true,
      data: {
        groups: [
          { id: 'g1', title: 'A', description: '', questions: [] },
          { id: 'g2', title: 'B', description: '', questions: [] },
        ],
      },
    });

    const exit = await execute(
      {
        subcommand: 'select-type',
        projectType: 'full-saas',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'wizard:new-project-select-type',
      params: { projectType: 'full-saas' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe(
      'new_project.session.started',
    );
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      projectType: 'full-saas',
      groupCount: 2,
    });
  });
});

describe('ptah new-project submit-answers', () => {
  it('exits 2 when --file is missing', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'submit-answers' } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--file <path> is required');
  });

  it('exits 2 when file unreadable', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      {
        subcommand: 'submit-answers',
        file: 'D:/tmp/missing.json',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
        readFile: jest.fn(async () => {
          throw new Error('ENOENT');
        }),
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('failed to read');
  });

  it('exits 2 when JSON is invalid', async () => {
    const exit = await execute(
      {
        subcommand: 'submit-answers',
        file: 'D:/tmp/x.json',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: makeStderr().stderr,
        withEngine: makeEngine().withEngine,
        readFile: jest.fn(async () => 'not-valid-json {'),
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('exits 2 when schema invalid (missing projectType)', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      {
        subcommand: 'submit-answers',
        file: 'D:/tmp/x.json',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
        readFile: jest.fn(async () =>
          JSON.stringify({ projectName: 'p', answers: {} }),
        ),
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('projectType');
  });

  it('dispatches wizard:new-project-submit-answers on success', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-submit-answers', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      {
        subcommand: 'submit-answers',
        file: 'D:/tmp/x.json',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readFile: jest.fn(async () =>
          JSON.stringify({
            projectType: 'full-saas',
            projectName: 'My App',
            answers: { stack: 'nestjs', features: ['auth', 'billing'] },
          }),
        ),
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe(
      'wizard:new-project-submit-answers',
    );
    expect(engine.rpcCalls[0]?.params).toMatchObject({
      projectType: 'full-saas',
      projectName: 'My App',
      answers: { stack: 'nestjs', features: ['auth', 'billing'] },
    });
    expect(formatterTrace.notifications[0]?.method).toBe(
      'new_project.answers.received',
    );
  });

  it('emits task.error + exit 5 when backend reports success: false', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-submit-answers', {
      success: true,
      data: { success: false, error: 'Missing required fields: foo' },
    });

    const exit = await execute(
      {
        subcommand: 'submit-answers',
        file: 'D:/tmp/x.json',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readFile: jest.fn(async () =>
          JSON.stringify({
            projectType: 'full-saas',
            projectName: 'P',
            answers: {},
          }),
        ),
      },
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect((last?.params as { ptah_code: string }).ptah_code).toBe(
      'internal_failure',
    );
  });
});

describe('ptah new-project get-plan', () => {
  it('exits 2 when <session-id> missing', async () => {
    const exit = await execute(
      { subcommand: 'get-plan' } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: makeStderr().stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('emits new_project.plan via wizard:new-project-get-plan', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-get-plan', {
      success: true,
      data: {
        plan: {
          projectName: 'P',
          projectType: 'full-saas',
          techStack: [],
          architectureDecisions: [],
          directoryStructure: '',
          phases: [],
          summary: '',
        },
      },
    });

    const exit = await execute(
      { subcommand: 'get-plan', sessionId: 'abc' } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('wizard:new-project-get-plan');
    expect(formatterTrace.notifications[0]?.method).toBe('new_project.plan');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      sessionId: 'abc',
    });
  });
});

describe('ptah new-project approve-plan', () => {
  it('exits 2 when <session-id> missing', async () => {
    const exit = await execute(
      { subcommand: 'approve-plan' } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: makeStderr().stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('emits new_project.plan.approved with planPath', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-approve-plan', {
      success: true,
      data: { success: true, planPath: 'D:/tmp/ws/.ptah/master-plan.md' },
    });

    const exit = await execute(
      {
        subcommand: 'approve-plan',
        sessionId: 'abc',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'wizard:new-project-approve-plan',
      params: { approved: true },
    });
    expect(formatterTrace.notifications[0]?.method).toBe(
      'new_project.plan.approved',
    );
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      sessionId: 'abc',
      planPath: 'D:/tmp/ws/.ptah/master-plan.md',
    });
  });

  it('throws when backend reports success: false', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:new-project-approve-plan', {
      success: true,
      data: { success: false, planPath: '' },
    });

    const exit = await execute(
      {
        subcommand: 'approve-plan',
        sessionId: 'abc',
      } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah new-project unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'bogus' as never } satisfies NewProjectOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown sub-command');
  });
});
