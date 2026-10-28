import { CURRENT_LEASE_HOST, leaseOwnerGone, processExists } from './provider-account-host';

describe('leaseOwnerGone', () => {
  const current = { pid: 100, machine: 'a'.repeat(64) };
  const owner = (overrides: Partial<{ pid: number | null; machine: string | null; childPid: number | null }> = {}) =>
    ({ pid: 200, machine: current.machine, childPid: null, ...overrides });
  const gone = (): boolean => false;
  const alive = (): boolean => true;
  /** Only `pids` exist. */
  const only = (...pids: number[]) => (pid: number): boolean => pids.includes(pid);

  it('is proved for a gone host on this machine whose child was never recorded', () => {
    expect(leaseOwnerGone(owner(), current, gone)).toBe(true);
    expect(leaseOwnerGone(owner(), current, alive)).toBe(false);
  });

  it('needs the recorded Claude child gone as well as the host', () => {
    expect(leaseOwnerGone(owner({ childPid: 300 }), current, gone)).toBe(true);
    // A crashed host whose child still runs (Windows keeps the orphan alive).
    expect(leaseOwnerGone(owner({ childPid: 300 }), current, only(300))).toBe(false);
    expect(leaseOwnerGone(owner({ childPid: 300 }), current, only(200))).toBe(false);
  });

  it('never judges this process, another machine or a legacy owner', () => {
    expect(leaseOwnerGone(owner({ pid: 100 }), current, gone)).toBe(false);
    expect(leaseOwnerGone(owner({ machine: 'b'.repeat(64) }), current, gone)).toBe(false);
    expect(leaseOwnerGone(owner({ pid: null, machine: null }), current, gone)).toBe(false);
    expect(leaseOwnerGone(owner({ machine: null }), current, gone)).toBe(false);
  });
});

describe('processExists', () => {
  afterEach(() => jest.restoreAllMocks());

  it('finds this process and records a 64-hex machine digest', () => {
    expect(processExists(process.pid)).toBe(true);
    expect(CURRENT_LEASE_HOST).toEqual({ pid: process.pid, machine: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it.each([
    ['ESRCH', false],
    ['EPERM', true],
    ['EINVAL', true],
  ])('reads %s as exists=%s', (code, exists) => {
    jest.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    expect(processExists(4242)).toBe(exists);
  });
});
