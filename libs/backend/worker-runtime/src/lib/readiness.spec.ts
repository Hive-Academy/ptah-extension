import { checkWorkerReadiness, type ReadinessPorts } from './readiness';

function ports(): ReadinessPorts {
  return {
    platform: () => 'linux',
    nodeVersion: () => 'v22.0.0',
    sqliteMemory: async () => undefined,
    ptahVersion: () => '1.2.3',
    listener: () => ({ host: '127.0.0.1', port: 41873 }),
    workspaces: () => [{ workspaceId: 'ws_1', name: 'one', path: '/one' }],
    exists: async () => true,
    claudeCli: async () => ({
      available: true,
      detail: 'Claude CLI available.',
    }),
    authRoute: async () => ({ ready: true, detail: 'Claude CLI signed in.' }),
    driverLock: async () => ({ available: true, stranded: false }),
  };
}

describe('checkWorkerReadiness', () => {
  it('reports all seven checks with the bundled runtime and lock scope', async () => {
    const report = await checkWorkerReadiness(ports());
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      'os',
      'runtime',
      'version',
      'listener',
      'workspaces',
      'provider',
      'driver-lock',
    ]);
    expect(report.checks[6].detail).toContain(
      'applies to Claude and native Codex sessions; this worker drives Claude sessions only',
    );
  });
  it('refuses a missing SQLite load and directs an update of the desktop package', async () => {
    const input = {
      ...ports(),
      nodeVersion: () => 'v20.0.0',
      sqliteMemory: async () => {
        throw new Error('native module failed');
      },
    };
    const report = await checkWorkerReadiness(input);
    expect(report.ready).toBe(false);
    expect(report.checks[1].detail).toContain('v20.0.0');
    expect(report.checks[1].fix).toMatch(/update the Ptah desktop package/i);
    expect(JSON.stringify(report)).not.toContain('native module failed');
  });
  it('fails provider, workspace and stranded lock checks', async () => {
    const input = {
      ...ports(),
      exists: async () => false,
      authRoute: async () => ({
        ready: false,
        detail: 'Claude CLI needs sign-in.',
      }),
      driverLock: async () => ({ available: true, stranded: true }),
    };
    const report = await checkWorkerReadiness(input);
    expect(
      report.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.id),
    ).toEqual(['workspaces', 'provider', 'driver-lock']);
  });
});
