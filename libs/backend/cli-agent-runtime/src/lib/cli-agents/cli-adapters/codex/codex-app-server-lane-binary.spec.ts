import { CodexSelectionSnapshot, type CodexExecutableProbes } from '@ptah-extension/codex-runtime';
import { NativeCodexLaneBinaryProbe } from './codex-app-server-lane-binary';

describe('NativeCodexLaneBinaryProbe', () => {
  const installed = process.platform === 'win32' ? 'C:\\codex.exe' : '/usr/bin/codex';
  const bundled = process.platform === 'win32' ? 'C:\\bundle\\codex.exe' : '/bundle/codex';
  const probes = (installedVersion: string): CodexExecutableProbes => ({
    installedCandidates: async () => [installed],
    bundledCandidate: async () => bundled,
    canonicalNativePath: async (candidate) => candidate,
    readVersion: async (candidate) =>
      candidate === installed ? `codex-cli ${installedVersion}` : 'codex-cli 0.165.0',
  });

  it('prefers a supported installed executable', async () => {
    const probe = new NativeCodexLaneBinaryProbe(new CodexSelectionSnapshot(probes('0.170.0')));
    await expect(probe.resolve()).resolves.toMatchObject({
      path: installed, version: '0.170.0', source: 'installed',
    });
  });

  it('selects the bundle when installed Codex is below the minimum', async () => {
    const probe = new NativeCodexLaneBinaryProbe(new CodexSelectionSnapshot(probes('0.160.0')));
    await expect(probe.resolve()).resolves.toMatchObject({
      path: bundled, version: '0.165.0', source: 'bundled',
    });
  });

  it('rejects an explicit path different from the selected executable', async () => {
    const probe = new NativeCodexLaneBinaryProbe(new CodexSelectionSnapshot(probes('0.170.0')));
    await expect(probe.resolve(bundled)).rejects.toThrow('selected executable');
  });
});
