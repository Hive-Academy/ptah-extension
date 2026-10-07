import {
  hostLaunchRows,
  runMetadata,
  startHost,
  type HostRecord,
} from './bench-hosts';
import {
  HostLaunchError,
  type HostExit,
  type LaunchedHost,
} from './transport/host-launcher';
import { McpHttpClient } from './transport/mcp-client';
import { BenchHeldRealStateError } from './transport/real-state-guard';

jest.mock('@ptah-extension/platform-core', () => ({
  killProcessTree: jest.fn(),
}));

const CRASH: HostExit = {
  kind: 'exited-early',
  exitCode: 3221226505,
  signal: null,
  detail: 'the host ended before stop() (exit code 0xC0000409 (3221226505))',
};
const CLEAN: HostExit = { kind: 'clean', exitCode: 0, signal: null };
const target = { host: 'cli-headless', electronMode: 'launch' } as const;

function fakeLaunched(): LaunchedHost {
  const client = new McpHttpClient({
    baseUrl: 'http://localhost:1/workspace/x',
  });
  jest
    .spyOn(client, 'listTools')
    .mockResolvedValue([{ name: 'ptah_search_files' }]);
  return {
    baseUrl: 'http://localhost:1/workspace/x',
    port: 1,
    pid: 42,
    ready: {
      port: 1,
      workspaceRoot: '/x',
      homedir: '/h',
      userDataPath: '/h/.ptah',
      dbPath: '/h/.ptah/state/ptah.sqlite',
    },
    tempHome: '/h',
    coldStartMs: 10,
    client,
    guardMode: 'hash',
    exitedEarly: () => undefined,
    stop: async () => ({
      exit: CLEAN,
      isolatedDbCreated: true,
      guard: { mode: 'hash', before: [], after: [] } as never,
    }),
  };
}

const crash = (): HostLaunchError =>
  new HostLaunchError(
    'bench host exited (code 3221226505) before ready; stderr: ',
    CRASH,
  );

describe('startHost', () => {
  it('retries a host that dies before ready once, logs each attempt and records the failure', async () => {
    const records: HostRecord[] = [];
    const lines: string[] = [];
    const launch = jest
      .fn()
      .mockRejectedValueOnce(crash())
      .mockResolvedValueOnce(fakeLaunched());

    const host = await startHost(
      target,
      '/corpus/attrs',
      'polyglot python-attrs',
      records,
      null,
      (line) => lines.push(line),
      launch,
    );
    await host.stop();

    expect(launch).toHaveBeenCalledTimes(2);
    expect(lines[0]).toBe(
      '[host] polyglot python-attrs starting on /corpus/attrs',
    );
    expect(
      lines.some((line) =>
        line.includes(
          'failed before ready (attempt 1): exited-early, exit 3221226505',
        ),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.endsWith('(retry 1)'))).toBe(true);
    expect(records[0]).toMatchObject({ started: true, exit: CLEAN });
    expect(records[0].launchFailures).toHaveLength(1);
    const rows = hostLaunchRows(records);
    expect(rows).toEqual([
      expect.objectContaining({
        scenario: 'host-launch:polyglot python-attrs',
        tool: 'bench-host',
        pass: true,
      }),
    ]);
    expect(rows[0].detail).toContain('started after a retry');
    expect(runMetadata(records).hostExit.detail).toContain(
      'polyglot python-attrs launch attempt 1: exited-early, exit 3221226505',
    );
  });

  it('rethrows after the retry also dies, and the record says it never started', async () => {
    const records: HostRecord[] = [];
    const launch = jest.fn().mockRejectedValue(crash());

    await expect(
      startHost(
        target,
        '/corpus',
        'lifecycle',
        records,
        null,
        () => undefined,
        launch,
      ),
    ).rejects.toBeInstanceOf(HostLaunchError);

    expect(launch).toHaveBeenCalledTimes(2);
    expect(records[0]).toMatchObject({ started: false, exit: CRASH });
    expect(hostLaunchRows(records)[0]).toMatchObject({ pass: false });
    expect(hostLaunchRows(records)[0].detail).toContain('never started');
  });

  it('does not retry an error that is not a launch failure', async () => {
    const launch = jest.fn().mockRejectedValue(new Error('guard tripped'));
    await expect(
      startHost(target, '/corpus', 'main', [], null, () => undefined, launch),
    ).rejects.toThrow('guard tripped');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('stops a host whose tools/list fails after launch, records it and retries once', async () => {
    const records: HostRecord[] = [];
    const broken = fakeLaunched();
    jest
      .spyOn(broken.client, 'listTools')
      .mockRejectedValue(new Error('tools/list transport error TIMEOUT'));
    const stopBroken = jest.spyOn(broken, 'stop');
    const launch = jest
      .fn()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(fakeLaunched());

    const host = await startHost(
      target,
      '/corpus',
      'main',
      records,
      null,
      () => undefined,
      launch,
    );
    await host.stop();

    expect(stopBroken).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(records[0].launchFailures[0].message).toContain(
      'tools/list failed after the host was ready: tools/list transport error TIMEOUT',
    );
    expect(records[0].started).toBe(true);
  });

  it('lets a guard error from that cleanup stop win, with no retry', async () => {
    const guard = new BenchHeldRealStateError([
      { pid: 9, name: 'node.exe', path: 'C:/Users/u/.ptah/state/ptah.sqlite' },
    ]);
    const broken = fakeLaunched();
    jest
      .spyOn(broken.client, 'listTools')
      .mockRejectedValue(new Error('bad body'));
    jest.spyOn(broken, 'stop').mockRejectedValue(guard);
    const launch = jest.fn().mockResolvedValue(broken);

    await expect(
      startHost(target, '/corpus', 'main', [], null, () => undefined, launch),
    ).rejects.toBe(guard);
    expect(guard.cause).toEqual(new Error('bad body'));
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
