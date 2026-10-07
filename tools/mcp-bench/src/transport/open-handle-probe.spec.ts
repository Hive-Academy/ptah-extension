import {
  parseWindowsTreeReply,
  processTree,
  type ProcessEntry,
} from './open-handle-probe';

const entry = (
  pid: number,
  ppid: number,
  createdMs: number | null,
): ProcessEntry => ({ pid, ppid, name: `process-${pid}`, createdMs });

describe('processTree creation-time guard', () => {
  it('does not adopt an old process whose parent pid was reused by the host tree', () => {
    expect(
      processTree(10, [entry(10, 1, 2_000), entry(20, 10, 1_000)]),
    ).toEqual(new Set([10]));
  });

  it('adopts a child created after its parent', () => {
    expect(
      processTree(10, [entry(10, 1, 1_000), entry(20, 10, 2_000)]),
    ).toEqual(new Set([10, 20]));
  });

  it('falls back to the parent-pid rule when creation times are unavailable', () => {
    expect(
      processTree(10, [entry(10, 1, null), entry(20, 10, null)]),
    ).toEqual(new Set([10, 20]));
  });

  it('preserves Windows creation time and command line while null keeps the ppid fallback', () => {
    const result = parseWindowsTreeReply(
      10,
      JSON.stringify({
        processes: [
          { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
          { pid: 20, ppid: 10, name: 'child.exe', createdMs: null, commandLine: 'child --work' },
        ],
        open: [],
        unprobed: [],
      }),
    );

    expect(result.tree).toEqual([
      { pid: 10, ppid: 1, name: 'host.exe', createdMs: 1_000, commandLine: 'host --serve' },
      { pid: 20, ppid: 10, name: 'child.exe', createdMs: null, commandLine: 'child --work' },
    ]);
  });

  it('excludes a process older than the root host', () => {
    expect(
      processTree(10, [
        entry(10, 1, 2_000),
        entry(11, 10, 2_100),
        entry(20, 11, 1_000),
      ]),
    ).toEqual(new Set([10, 11]));
  });
});
