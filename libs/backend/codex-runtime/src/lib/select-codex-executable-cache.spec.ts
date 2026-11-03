import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCodexExecutableProbes, parseCodexVersion } from './select-codex-executable';

jest.mock('node:child_process', () => ({
  execFile: jest.fn((
    _path: string,
    _args: readonly string[],
    _options: object,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => callback(null, { stdout: 'codex-cli 0.165.0', stderr: '' })),
}));

describe('native Codex version probe cache', () => {
  it('reuses a canonical path while metadata is stable and re-probes an upgraded binary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptah-codex-version-'));
    const binary = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    try {
      await writeFile(binary, 'old');
      const probes = createNodeCodexExecutableProbes(async () => undefined);
      const first = await probes.readVersion(binary, 7000);
      const cached = await probes.readVersion(binary, 7000);
      expect(parseCodexVersion(first)).toBe('0.165.0');
      expect(cached).toBe(first);
      expect(jest.mocked(execFile)).toHaveBeenCalledTimes(1);

      await writeFile(binary, 'new native binary with a different size');
      expect(await probes.readVersion(binary, 7000)).toBe(first);
      expect(jest.mocked(execFile)).toHaveBeenCalledTimes(2);
    } finally {
      await unlink(binary);
      await rmdir(directory);
    }
  });
});
