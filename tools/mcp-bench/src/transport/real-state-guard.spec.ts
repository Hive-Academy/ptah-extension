import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HandleProbe } from './open-handle-probe';
import { RealStateGuard } from './real-state-guard';

describe('RealStateGuard holder diagnostics', () => {
  it('includes the holder command line and observed parent chain in the error', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ptah-guard-'));
    await mkdir(join(home, '.ptah'), { recursive: true });
    const probe: HandleProbe = {
      platform: process.platform,
      holders: async () => ({ holders: new Map(), processes: [] }),
      treeOpenPaths: async () => ({
        tree: [
          { pid: 100, ppid: 1, name: 'host', createdMs: 1_000 },
          {
            pid: 101,
            ppid: 100,
            name: 'node.exe',
            createdMs: 2_000,
            commandLine: 'node holder.js --real-state',
          },
        ],
        open: [{ pid: 101, path: join(home, '.ptah', 'skills', 'candidate') }],
        unprobed: [],
      }),
    };
    const guard = new RealStateGuard(
      'process-watch',
      home,
      probe,
      [],
      { takenAt: '', files: [] },
      1,
    );
    guard.watch(100);
    await guard.sampleBeforeStop();

    await expect(guard.finish()).rejects.toThrow(
      /command line: node holder\.js --real-state; created: 1970-01-01T00:00:02\.000Z; parent chain: 101 → 100/,
    );
  });
});
