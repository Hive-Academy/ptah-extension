import { homedir } from 'node:os';
import { join } from 'node:path';

import { CliDIContainer, withEngine } from '@ptah-extension/cli-engine';
import { startCodeExecutionMcp } from '@ptah-extension/vscode-core';

import {
  BENCH_BISECT_ENV,
  BenchHostBootError,
  BenchIsolationError,
  assertIsolatedEnvironment,
  bootCodeExecutionHost,
  readBisectFlags,
  type AfterContainerReadyHook,
  type BeforeEngineBootHook,
} from './bench-host-boot';

jest.mock('@ptah-extension/cli-engine', () => ({
  withEngine: jest.fn(),
  CliDIContainer: { setup: jest.fn() },
}));
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: { LOGGER: 'LOGGER', CODE_EXECUTION_MCP: 'CODE_EXECUTION_MCP' },
  startCodeExecutionMcp: jest.fn(),
}));
jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: { WORKSPACE_PROVIDER: 'WORKSPACE_PROVIDER' },
}));

const withEngineMock = jest.mocked(withEngine);
const startMcpMock = jest.mocked(startCodeExecutionMcp);

describe('assertIsolatedEnvironment', () => {
  const home = '/tmp/bench-home';
  const env = {
    PTAH_BENCH_ISOLATED_HOME: home,
    PTAH_CONFIG_PATH: `${home}/.ptah`,
    PTAH_DB_PATH: `${home}/.ptah/state/ptah.sqlite`,
  };
  const probe = { homedir: home, platform: 'linux' as const };

  it('returns the isolated paths', () => {
    expect(assertIsolatedEnvironment(env, probe)).toEqual({
      home,
      userDataPath: env.PTAH_CONFIG_PATH,
      dbPath: env.PTAH_DB_PATH,
    });
  });

  it.each(['PTAH_BENCH_ISOLATED_HOME', 'PTAH_CONFIG_PATH', 'PTAH_DB_PATH'])(
    'refuses when %s is missing',
    (name) => {
      const partial: NodeJS.ProcessEnv = { ...env, [name]: undefined };
      const call = (): unknown => assertIsolatedEnvironment(partial, probe);
      expect(call).toThrow(BenchIsolationError);
      expect(call).toThrow(
        'refusing to boot: PTAH_BENCH_ISOLATED_HOME, PTAH_CONFIG_PATH and PTAH_DB_PATH must all be set by the launcher',
      );
    },
  );

  it('refuses when os.homedir() is not the isolated home', () => {
    expect(() =>
      assertIsolatedEnvironment(env, { ...probe, homedir: '/home/dev' }),
    ).toThrow(
      `refusing to boot: os.homedir() is /home/dev, not the isolated home ${home}`,
    );
  });

  it.each([
    ['config', { PTAH_CONFIG_PATH: '/home/dev/.ptah' }],
    ['db', { PTAH_DB_PATH: '/home/dev/.ptah/state/ptah.sqlite' }],
    ['db equal to the home', { PTAH_DB_PATH: home }],
  ])('refuses when the %s path is not inside the home', (_label, patch) => {
    expect(() =>
      assertIsolatedEnvironment({ ...env, ...patch }, probe),
    ).toThrow(
      'refusing to boot: PTAH_CONFIG_PATH and PTAH_DB_PATH must lie inside the isolated home',
    );
  });

  it('folds case on win32 for the home and the inside checks', () => {
    const winEnv = {
      PTAH_BENCH_ISOLATED_HOME: 'C:\\Temp\\Bench-Home',
      PTAH_CONFIG_PATH: 'c:\\temp\\bench-home\\.ptah',
      PTAH_DB_PATH: 'C:\\TEMP\\BENCH-HOME\\.ptah\\state\\ptah.sqlite',
    };
    expect(
      assertIsolatedEnvironment(winEnv, {
        homedir: 'c:\\temp\\bench-home',
        platform: 'win32',
      }).home,
    ).toBe('C:\\Temp\\Bench-Home');
  });

  it('does not fold case outside win32', () => {
    expect(() =>
      assertIsolatedEnvironment(env, { ...probe, homedir: '/TMP/bench-home' }),
    ).toThrow(BenchIsolationError);
  });
});

describe('bootCodeExecutionHost', () => {
  const workspace = join(homedir(), 'bench-spec-workspace');
  const savedEnv = { ...process.env };
  let events: string[];
  let container: {
    isRegistered: jest.Mock;
    resolve: jest.Mock;
    register: jest.Mock;
  };
  let port: number | null;
  let registered: boolean;

  beforeEach(() => {
    // Paths only: the engine is mocked, nothing is written under the home.
    process.env['PTAH_BENCH_ISOLATED_HOME'] = homedir();
    process.env['PTAH_CONFIG_PATH'] = join(homedir(), '.ptah-bench-spec');
    process.env['PTAH_DB_PATH'] = join(
      homedir(),
      '.ptah-bench-spec',
      'ptah.sqlite',
    );
    events = [];
    port = 4321;
    registered = true;
    const mcp = {
      getPort: () => port,
      disposeAsync: async () => {
        events.push('mcp-dispose');
      },
    };
    const provider = {
      getWorkspaceRoot: () => workspace,
      setConfiguration: async (
        section: string,
        key: string,
        value: unknown,
      ) => {
        events.push(`config:${section}.${key}=${String(value)}`);
      },
    };
    container = {
      isRegistered: jest.fn(() => registered),
      resolve: jest.fn((token: string) => {
        if (token === 'WORKSPACE_PROVIDER') return provider;
        if (token === 'CODE_EXECUTION_MCP') return mcp;
        return {};
      }),
      register: jest.fn(),
    };
    withEngineMock.mockReset();
    withEngineMock.mockImplementation(async (_globals, _opts, fn) => {
      events.push('engine-boot');
      try {
        return await fn({ container } as never);
      } finally {
        await new Promise((done) => setImmediate(done));
        events.push('engine-teardown');
      }
    });
    startMcpMock.mockReset();
    startMcpMock.mockImplementation(async () => {
      events.push('mcp-start');
    });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  const beforeHook: BeforeEngineBootHook = async () => {
    events.push('beforeEngineBoot');
  };
  const afterHook: AfterContainerReadyHook = async () => {
    events.push('afterContainerReady');
  };

  async function bootFailure(
    options: Parameters<typeof bootCodeExecutionHost>[0],
  ): Promise<{ error: unknown; eventsAtRejection: string[] }> {
    try {
      await bootCodeExecutionHost(options);
    } catch (error: unknown) {
      return { error, eventsAtRejection: [...events] };
    }
    throw new Error('expected the boot to fail');
  }

  it('runs the hooks in order around the engine boot and before the MCP start', async () => {
    const host = await bootCodeExecutionHost({
      workspace,
      beforeEngineBoot: beforeHook,
      afterContainerReady: afterHook,
    });

    expect(events).toEqual([
      'beforeEngineBoot',
      'engine-boot',
      'afterContainerReady',
      'config:ptah.mcpPort=0',
      'mcp-start',
    ]);
    expect(withEngineMock).toHaveBeenCalledWith(
      { cwd: workspace, config: join(homedir(), '.ptah-bench-spec') },
      { mode: 'full', requireSdk: false, thoth: 'oneshot' },
      expect.any(Function),
    );
    expect(host.port).toBe(4321);
    expect(host.workspaceRoot).toBe(workspace);
    expect(host.isolation.home).toBe(homedir());
    expect(host.container).toBe(container);

    const stopping = host.stop();
    expect(host.stop()).toBe(stopping);
    await stopping;
    expect(events.slice(-2)).toEqual(['mcp-dispose', 'engine-teardown']);
  });

  it('gives the hooks the isolation paths and the booted container', async () => {
    const before = jest.fn();
    const after = jest.fn();
    const host = await bootCodeExecutionHost({
      workspace,
      beforeEngineBoot: before,
      afterContainerReady: after,
    });
    const isolation = {
      home: homedir(),
      userDataPath: join(homedir(), '.ptah-bench-spec'),
      dbPath: join(homedir(), '.ptah-bench-spec', 'ptah.sqlite'),
    };
    expect(before).toHaveBeenCalledWith({ workspace, isolation });
    expect(after).toHaveBeenCalledWith(container, {
      workspaceRoot: workspace,
      isolation,
    });
    await host.stop();
  });

  it('aborts before the engine when beforeEngineBoot throws', async () => {
    const { error } = await bootFailure({
      workspace,
      beforeEngineBoot: () => {
        throw new Error('seed failed');
      },
      afterContainerReady: afterHook,
    });
    expect(error).toBeInstanceOf(BenchHostBootError);
    expect((error as BenchHostBootError).step).toBe('beforeEngineBoot');
    expect((error as Error).message).toBe(
      'bench host boot failed in beforeEngineBoot: seed failed',
    );
    expect(withEngineMock).not.toHaveBeenCalled();
  });

  it('tears the engine down and never starts the MCP when afterContainerReady rejects', async () => {
    const cause = new Error('double registration failed');
    const { error, eventsAtRejection } = await bootFailure({
      workspace,
      afterContainerReady: async () => {
        throw cause;
      },
    });
    expect(error).toBeInstanceOf(BenchHostBootError);
    expect((error as BenchHostBootError).step).toBe('afterContainerReady');
    expect((error as Error).cause).toBe(cause);
    expect(startMcpMock).not.toHaveBeenCalled();
    expect(eventsAtRejection).toEqual(['engine-boot', 'engine-teardown']);
  });

  it('fails when TOKENS.CODE_EXECUTION_MCP is not registered, after the teardown', async () => {
    registered = false;
    const after = jest.fn();
    const { error, eventsAtRejection } = await bootFailure({
      workspace,
      afterContainerReady: after,
    });
    expect((error as BenchHostBootError).step).toBe('engine-boot');
    expect((error as Error).message).toBe(
      'BLOCKER: TOKENS.CODE_EXECUTION_MCP is not registered in the CLI container',
    );
    expect(after).not.toHaveBeenCalled();
    expect(eventsAtRejection).toEqual(['engine-boot', 'engine-teardown']);
  });

  it('fails when the MCP server has no port, after the teardown', async () => {
    port = null;
    const { error, eventsAtRejection } = await bootFailure({ workspace });
    expect((error as BenchHostBootError).step).toBe('mcp-start');
    expect((error as Error).message).toBe(
      'the code-execution MCP server did not start (see stderr)',
    );
    expect(eventsAtRejection.at(-1)).toBe('engine-teardown');
  });

  it('wraps a failing engine bootstrap', async () => {
    withEngineMock.mockRejectedValueOnce(new Error('migration exploded'));
    const { error } = await bootFailure({ workspace });
    expect((error as BenchHostBootError).step).toBe('engine-boot');
    expect((error as Error).message).toBe(
      'bench host boot failed in engine-boot: migration exploded',
    );
  });

  it('refuses before any hook when the process is not isolated', async () => {
    delete process.env['PTAH_DB_PATH'];
    const before = jest.fn();
    const { error } = await bootFailure({
      workspace,
      beforeEngineBoot: before,
    });
    expect(error).toBeInstanceOf(BenchIsolationError);
    expect(before).not.toHaveBeenCalled();
    expect(withEngineMock).not.toHaveBeenCalled();
  });

  it('rejects a relative workspace', async () => {
    const { error } = await bootFailure({ workspace: 'relative/dir' });
    expect((error as BenchHostBootError).step).toBe('options');
    expect(withEngineMock).not.toHaveBeenCalled();
  });

  describe(`shutdown bisect (${BENCH_BISECT_ENV})`, () => {
    it('refuses an unknown flag before any hook', async () => {
      process.env[BENCH_BISECT_ENV] = 'no-embedder,no-such-flag';
      const before = jest.fn();
      const { error } = await bootFailure({
        workspace,
        beforeEngineBoot: before,
      });
      expect((error as BenchHostBootError).step).toBe('options');
      expect((error as Error).message).toMatch(/unknown flag no-such-flag/);
      expect(before).not.toHaveBeenCalled();
    });

    it('applies each flag to the bootstrap before the engine opens the DB', async () => {
      process.env[BENCH_BISECT_ENV] =
        ' no-embedder , no-sqlite-vec,no-sqlite-close ';
      const factory = { spawn: jest.fn(() => 'worker') };
      const realClose = jest.fn();
      const connection = {
        configure: jest.fn(),
        close: realClose,
        isOpen: true,
        db: { pragma: jest.fn() },
      };
      const booted = {
        isRegistered: () => true,
        resolve: (token: symbol) =>
          token === Symbol.for('PtahEmbedderWorkerProcessFactory')
            ? factory
            : token === Symbol.for('PtahSqliteConnection')
              ? connection
              : {},
      };
      jest
        .mocked(CliDIContainer.setup)
        .mockReturnValue({ container: booted } as never);

      const host = await bootCodeExecutionHost({ workspace });
      const opts = withEngineMock.mock.calls[0][1];
      expect(opts).toMatchObject({
        mode: 'full',
        requireSdk: false,
        thoth: 'oneshot',
      });
      if (opts.bootstrap === undefined) throw new Error('expected a bootstrap');
      opts.bootstrap({});

      expect(() => factory.spawn()).toThrow(
        `disabled by ${BENCH_BISECT_ENV}=no-embedder`,
      );
      expect(connection.configure).toHaveBeenCalledWith({
        vecPathResolver: null,
      });
      connection.close();
      expect(realClose).not.toHaveBeenCalled();
      await host.stop();
    });

    it('parses an unset or empty variable as no flags', () => {
      expect(readBisectFlags({}).size).toBe(0);
      expect(readBisectFlags({ [BENCH_BISECT_ENV]: ' , ' }).size).toBe(0);
      expect([
        ...readBisectFlags({ [BENCH_BISECT_ENV]: 'trace,trace' }),
      ]).toEqual(['trace']);
    });
  });
});
