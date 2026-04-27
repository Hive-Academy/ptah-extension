/**
 * Unit tests for `ptah wizard` command — TASK_2026_104 Sub-batch B9c.
 *
 * Coverage:
 *   - submit-selection: --file required; unreadable / invalid JSON / schema-
 *     invalid → exit 2; sync ack failure → task.error + exit 1; happy path
 *     waits for `setup-wizard:generation-complete` event then exits 0;
 *     `success: false` payload → task.error + exit 1.
 *   - cancel: <session-id> required; emits wizard.cancelled with
 *     changed=true|false; always exits 0.
 *   - retry-item: <item-id> required; emits wizard.retry.start +
 *     wizard.retry.complete on success; success: false → task.error + exit 1.
 *   - status: emits wizard.status with last_completed_phase from
 *     WORKSPACE_STATE_STORAGE (null when empty); always exits 0.
 *   - unknown sub-command: exit 2.
 */

import { EventEmitter } from 'events';

import { execute } from './wizard.js';
import type { WizardExecuteHooks, WizardOptions } from './wizard.js';
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

interface StorageStub {
  values: Map<string, unknown>;
  get: jest.Mock;
  update: jest.Mock;
  keys: jest.Mock;
}

function makeStorage(seed: Record<string, unknown> = {}): StorageStub {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    values,
    get: jest.fn((key: string) => values.get(key)),
    update: jest.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    keys: jest.fn(() => Array.from(values.keys())),
  };
}

interface MockEngine {
  withEngine: WizardExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
  pushAdapter: EventEmitter;
  storage: StorageStub;
}

function makeEngine(seedStorage: Record<string, unknown> = {}): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const pushAdapter = new EventEmitter();
  const storage = makeStorage(seedStorage);

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => storage),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: EventEmitter;
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({ container, transport, pushAdapter });
  }) as unknown as WizardExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, pushAdapter, storage };
}

// ---------------------------------------------------------------------------
// submit-selection
// ---------------------------------------------------------------------------

describe('ptah wizard submit-selection', () => {
  it('exits 2 (UsageError) when --file is missing', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'submit-selection' } satisfies WizardOptions,
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

  it('exits 2 when file cannot be read', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/nope.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
        readFile: async () => {
          throw new Error('ENOENT');
        },
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('failed to read');
  });

  it('exits 2 on invalid JSON', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/x.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
        readFile: async () => 'not json',
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('invalid JSON');
  });

  it('exits 2 on schema-invalid file (selectedAgentIds missing)', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/x.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
        readFile: async () => JSON.stringify({}),
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('selectedAgentIds');
  });

  it('emits task.error + exits 1 when the synchronous accept fails', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: false, error: 'concurrent generation' },
    });

    const exit = await execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/x.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readFile: async () => JSON.stringify({ selectedAgentIds: ['agent-a'] }),
      },
    );
    expect(exit).toBe(ExitCode.GeneralError);
    expect(fmt.notifications.map((n) => n.method)).toEqual(['task.error']);
    expect(fmt.notifications[0]?.params).toMatchObject({
      ptah_code: 'generation_failed',
      message: 'concurrent generation',
    });
  });

  it('happy path: forwards completion event and exits 0', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });

    const promise = execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/x.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readFile: async () =>
          JSON.stringify({
            selectedAgentIds: ['agent-a', 'agent-b'],
            threshold: 60,
            analysisDir: 'D:/tmp/analysis',
          }),
      },
    );

    // Emit completion AFTER the listener was registered. Two ticks is enough
    // because the RPC mock resolves synchronously.
    setImmediate(() => {
      engine.pushAdapter.emit('setup-wizard:generation-complete', {
        success: true,
        generatedCount: 2,
      });
    });

    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      {
        method: 'wizard:submit-selection',
        params: {
          selectedAgentIds: ['agent-a', 'agent-b'],
          threshold: 60,
          analysisDir: 'D:/tmp/analysis',
        },
      },
    ]);
    // The command does not re-emit progress/stream/complete frames — those
    // are forwarded by the event-pipe (B9a) independently. So we only
    // expect the absence of task.error here.
    expect(
      fmt.notifications.find((n) => n.method === 'task.error'),
    ).toBeUndefined();
    // Completion listener must be detached afterwards.
    expect(
      engine.pushAdapter.listenerCount('setup-wizard:generation-complete'),
    ).toBe(0);
  });

  it('emits task.error + exits 1 when the completion payload reports success: false', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });

    const promise = execute(
      {
        subcommand: 'submit-selection',
        file: 'D:/x.json',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readFile: async () => JSON.stringify({ selectedAgentIds: ['agent-a'] }),
      },
    );

    setImmediate(() => {
      engine.pushAdapter.emit('setup-wizard:generation-complete', {
        success: false,
        generatedCount: 0,
        errors: ['template missing'],
      });
    });

    const exit = await promise;
    expect(exit).toBe(ExitCode.GeneralError);
    expect(
      fmt.notifications.find((n) => n.method === 'task.error')?.params,
    ).toMatchObject({
      ptah_code: 'generation_failed',
      message: 'template missing',
    });
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('ptah wizard cancel', () => {
  it('exits 2 when <session-id> is missing', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'cancel' } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<session-id> is required');
  });

  it('emits wizard.cancelled with changed=true when handler reports cancelled', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:cancel', {
      success: true,
      data: {
        cancelled: true,
        sessionId: 'sess-9',
        progressSaved: true,
      },
    });

    const exit = await execute(
      {
        subcommand: 'cancel',
        sessionId: 'sess-9',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fmt.notifications).toEqual([
      {
        method: 'wizard.cancelled',
        params: {
          sessionId: 'sess-9',
          changed: true,
          backendSessionId: 'sess-9',
          progressSaved: true,
        },
      },
    ]);
    expect(engine.rpcCalls).toEqual([
      { method: 'wizard:cancel', params: { saveProgress: true } },
    ]);
  });

  it('idempotent: emits changed=false and exits 0 when no active session', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:cancel', {
      success: true,
      data: { cancelled: false },
    });

    const exit = await execute(
      {
        subcommand: 'cancel',
        sessionId: 'sess-missing',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fmt.notifications[0]?.params).toMatchObject({
      sessionId: 'sess-missing',
      changed: false,
      progressSaved: false,
    });
  });
});

// ---------------------------------------------------------------------------
// retry-item
// ---------------------------------------------------------------------------

describe('ptah wizard retry-item', () => {
  it('exits 2 when <item-id> is missing', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'retry-item' } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<item-id> is required');
  });

  it('emits wizard.retry.{start,complete} on success', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:retry-item', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      {
        subcommand: 'retry-item',
        itemId: 'agent-x',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fmt.notifications.map((n) => n.method)).toEqual([
      'wizard.retry.start',
      'wizard.retry.complete',
    ]);
    expect(engine.rpcCalls).toEqual([
      { method: 'wizard:retry-item', params: { itemId: 'agent-x' } },
    ]);
  });

  it('emits task.error + exits 1 when handler reports success: false', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:retry-item', {
      success: true,
      data: { success: false, error: 'template not found' },
    });

    const exit = await execute(
      {
        subcommand: 'retry-item',
        itemId: 'agent-x',
      } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.GeneralError);
    const taskError = fmt.notifications.find((n) => n.method === 'task.error');
    expect(taskError?.params).toMatchObject({
      ptah_code: 'generation_failed',
      message: 'template not found',
    });
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('ptah wizard status', () => {
  it('emits wizard.status with last_completed_phase: null when storage is empty', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();

    const exit = await execute(
      { subcommand: 'status' } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fmt.notifications).toEqual([
      {
        method: 'wizard.status',
        params: {
          last_completed_phase: null,
          namespace_key: 'setup.lastCompletedPhase',
        },
      },
    ]);
    expect(engine.storage.get).toHaveBeenCalledWith('setup.lastCompletedPhase');
  });

  it('emits wizard.status with the stored phase name when present', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine({ 'setup.lastCompletedPhase': 'recommend' });

    const exit = await execute(
      { subcommand: 'status' } satisfies WizardOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fmt.notifications[0]?.params).toMatchObject({
      last_completed_phase: 'recommend',
      namespace_key: 'setup.lastCompletedPhase',
    });
  });
});

// ---------------------------------------------------------------------------
// unknown sub-command
// ---------------------------------------------------------------------------

describe('ptah wizard <unknown>', () => {
  it('exits 2 with helpful error message', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as WizardOptions['subcommand'] },
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine: makeEngine().withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain("unknown sub-command 'bogus'");
  });
});
