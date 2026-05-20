/**
 * Unit tests for `ptah quality` command.
 *
 * Coverage:
 *   - assessment: dispatches quality:getAssessment, emits quality.assessment
 *   - history: forwards --limit, emits quality.history
 *   - export --out: writes content to --out path; deletes side-effect file
 *     created by the backend's CliSaveDialog when it differs
 *   - export (no --out): streams content to stdout AFTER the notification
 *   - RPC failure bubbles as task.error + exit 5
 *   - unknown sub-command: exit 2
 */

import { execute } from './quality.js';
import type { QualityExecuteHooks, QualityOptions } from './quality.js';
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

function makeStdout(): { stdout: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stdout: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: QualityExecuteHooks['withEngine'];
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
  }) as unknown as QualityExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

describe('ptah quality assessment', () => {
  it('dispatches quality:getAssessment and emits quality.assessment', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('quality:getAssessment', {
      success: true,
      data: {
        intelligence: { qualityAssessment: { score: 85, antiPatterns: [] } },
        fromCache: false,
      },
    });

    const exit = await execute(
      { subcommand: 'assessment', id: 'abc' } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'quality:getAssessment',
      params: {},
    });
    expect(formatterTrace.notifications[0]?.method).toBe('quality.assessment');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      id: 'abc',
      fromCache: false,
    });
  });

  it('bubbles RPC failure as task.error + exit 5', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('quality:getAssessment', {
      success: false,
      error: 'No workspace folder open',
    });

    const exit = await execute(
      { subcommand: 'assessment' } satisfies QualityOptions,
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

describe('ptah quality history', () => {
  it('forwards --limit and emits quality.history', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('quality:getHistory', {
      success: true,
      data: { entries: [{ id: 'h1' }, { id: 'h2' }] },
    });

    const exit = await execute(
      { subcommand: 'history', limit: 5 } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'quality:getHistory',
      params: { limit: 5 },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('quality.history');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      limit: 5,
      entries: [{ id: 'h1' }, { id: 'h2' }],
    });
  });

  it('omits limit when not provided', async () => {
    const engine = makeEngine();
    engine.scripted.set('quality:getHistory', {
      success: true,
      data: { entries: [] },
    });
    await execute(
      { subcommand: 'history' } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
      },
    );
    expect(engine.rpcCalls[0]).toEqual({
      method: 'quality:getHistory',
      params: {},
    });
  });
});

describe('ptah quality export', () => {
  it('writes content to --out and deletes the backend side-effect file', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('quality:export', {
      success: true,
      data: {
        content: '{"score": 85}',
        filename: 'quality-report-2026-04-26.json',
        mimeType: 'application/json',
        saved: true,
        filePath: 'D:/tmp/ws/quality-report-2026-04-26.json',
      },
    });

    const writes: Array<{ path: string; data: string }> = [];
    const mkdirs: string[] = [];
    const unlinks: string[] = [];
    const writeFile = jest.fn(async (p: string, d: string) => {
      writes.push({ path: p, data: d });
    });
    const mkdir = jest.fn(async (p: string) => {
      mkdirs.push(p);
    });
    const unlink = jest.fn(async (p: string) => {
      unlinks.push(p);
    });

    const exit = await execute(
      {
        subcommand: 'export',
        out: 'D:/tmp/out/report.json',
      } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        writeFile,
        mkdir,
        unlink,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'quality:export',
      params: { format: 'json' },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toBe('{"score": 85}');
    expect(unlinks).toEqual(['D:/tmp/ws/quality-report-2026-04-26.json']);

    const completion = formatterTrace.notifications.find(
      (n) => n.method === 'quality.export.complete',
    );
    expect(completion?.params).toMatchObject({
      savedBytes: Buffer.byteLength('{"score": 85}', 'utf8'),
      filename: 'quality-report-2026-04-26.json',
    });
  });

  it('streams content to stdout when --out omitted (notification first)', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('quality:export', {
      success: true,
      data: {
        content: '{"k":"v"}',
        filename: 'q.json',
        mimeType: 'application/json',
        saved: true,
        filePath: 'D:/tmp/ws/q.json',
      },
    });
    const stdoutTrace = makeStdout();

    const order: string[] = [];
    formatterTrace.formatter.writeNotification = jest.fn(
      async (method: string, params?: unknown) => {
        order.push(`notif:${method}`);
        formatterTrace.notifications.push({ method, params });
      },
    );
    stdoutTrace.stdout.write.mockImplementation(() => {
      order.push('stdout:write');
      return true;
    });

    const exit = await execute(
      { subcommand: 'export' } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        stdout: stdoutTrace.stdout,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(order).toEqual(['notif:quality.export.complete', 'stdout:write']);
    expect(stdoutTrace.stdout.write).toHaveBeenCalledWith('{"k":"v"}');
  });

  it('does NOT delete side-effect file when --out matches the side-effect path', async () => {
    const engine = makeEngine();
    engine.scripted.set('quality:export', {
      success: true,
      data: {
        content: 'x',
        filename: 'q.json',
        mimeType: 'application/json',
        saved: true,
        filePath: 'D:/tmp/ws/q.json',
      },
    });
    const unlink = jest.fn(async () => undefined);

    await execute(
      {
        subcommand: 'export',
        out: 'D:/tmp/ws/q.json',
      } satisfies QualityOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        writeFile: jest.fn(async () => undefined),
        mkdir: jest.fn(async () => undefined),
        unlink,
      },
    );

    expect(unlink).not.toHaveBeenCalled();
  });
});

describe('ptah quality unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const stderrTrace = makeStderr();
    const exit = await execute(
      { subcommand: 'bogus' as never } satisfies QualityOptions,
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
