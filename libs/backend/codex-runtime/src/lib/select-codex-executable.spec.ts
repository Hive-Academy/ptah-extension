import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_MIN_SUPPORTED_VERSION,
  CodexExecutableUnavailableError,
  CodexSelectionSnapshot,
  createNodeCodexExecutableProbes,
  isCodexVersionSupported,
  parseCodexVersion,
  selectCodexExecutable,
  type CodexExecutableProbes,
} from './select-codex-executable';

function probes(installed: readonly string[], versions: Readonly<Record<string, string>>,
  bundled = '/bundle/codex'): CodexExecutableProbes {
  return {
    installedCandidates: jest.fn(async () => installed),
    bundledCandidate: jest.fn(async () => bundled),
    canonicalNativePath: jest.fn(async (candidate) => candidate),
    readVersion: jest.fn(async (candidate) => {
      const version = versions[candidate];
      if (version === undefined) throw new Error('unreadable');
      return version;
    }),
  };
}

describe('Codex executable selection', () => {
  it.each([
    ['codex-cli 0.165.0', '0.165.0'],
    ['  codex v0.166.0-beta.1+build.4\n', '0.166.0'],
    ['codex-cli 1.2.3', '1.2.3'],
    ['codex-cli unknown', undefined],
    ['codex-cli 0.165', undefined],
  ])('parses %s', (output, expected) => {
    expect(parseCodexVersion(output)).toBe(expected);
  });

  it('compares numeric versions and rejects a prerelease at the stable floor', () => {
    expect(CODEX_MIN_SUPPORTED_VERSION).toBe('0.165.0');
    expect(isCodexVersionSupported('0.165.0-beta.1')).toBe(false);
    expect(isCodexVersionSupported('0.166.0-beta.1')).toBe(true);
    expect(isCodexVersionSupported('0.164.99')).toBe(false);
    expect(isCodexVersionSupported('v1.0.0')).toBe(true);
    expect(isCodexVersionSupported('unknown')).toBe(false);
  });

  it('prefers the first supported installed candidate and retains a probed bundle', async () => {
    const probe = probes(['/installed/first', '/installed/second'], {
      '/installed/first': 'codex-cli 0.165.0',
      '/installed/second': 'codex-cli 0.166.0',
      '/bundle/codex': 'codex-cli 0.165.0',
    });
    const result = await selectCodexExecutable(probe);
    expect(result.selected).toMatchObject({ path: '/installed/first', version: '0.165.0', source: 'installed' });
    expect(result.bundledFallback).toMatchObject({ source: 'bundled', version: '0.165.0' });
    expect(probe.readVersion).toHaveBeenCalledWith('/installed/first', 7000);
    expect(probe.readVersion).not.toHaveBeenCalledWith('/installed/second', 7000);
  });

  it('chooses bundle with the supported-minimum reason for an old install', async () => {
    const result = await selectCodexExecutable(probes(['/old'], {
      '/old': 'codex-cli 0.164.0', '/bundle/codex': 'codex-cli 0.165.0',
    }));
    expect(result.selected).toMatchObject({ source: 'bundled', version: '0.165.0' });
    expect(result.selected.reason).toBe('Installed Codex 0.164.0 is below the supported minimum 0.165.0; using bundled Codex 0.165.0.');
  });

  it('chooses bundle when installed is missing or unreadable', async () => {
    const result = await selectCodexExecutable(probes(['/missing'], {
      '/bundle/codex': 'codex-cli 0.165.0',
    }));
    expect(result.selected.reason).toBe('Installed Codex was not found or could not be started; using bundled Codex 0.165.0.');
  });

  it('fails with a safe message when both candidates are unusable', async () => {
    await expect(selectCodexExecutable(probes(['/old'], {
      '/old': 'codex-cli 0.164.0', '/bundle/codex': 'codex-cli 0.164.0',
    }))).rejects.toBeInstanceOf(CodexExecutableUnavailableError);
  });

  it('reprobes on each open and switches only once to the already probed bundle', async () => {
    const versions = { '/installed': 'codex-cli 0.165.0', '/bundle/codex': 'codex-cli 0.165.0' };
    const probe = probes(['/installed'], versions);
    const snapshot = new CodexSelectionSnapshot(probe);
    const first = await snapshot.selectForOpen();
    const fallback = await snapshot.activateFallback(first.selected, 'model/list');
    expect(snapshot.current()).toBe(fallback);
    expect(fallback.reason).toBe('Installed Codex 0.165.0 lacks required method model/list; using bundled Codex 0.165.0.');
    await expect(snapshot.activateFallback(first.selected)).rejects.toBeInstanceOf(CodexExecutableUnavailableError);
    await snapshot.selectForOpen();
    expect(probe.readVersion).toHaveBeenCalledTimes(4);
    expect(snapshot.current()?.source).toBe('installed');
  });

  it('keeps two concurrent lane selections and their fallback budgets independent', async () => {
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    let installedReads = 0;
    const probe: CodexExecutableProbes = {
      ...probes(['/installed'], {
        '/installed': 'codex-cli 0.166.0', '/bundle/codex': 'codex-cli 0.165.0',
      }),
      readVersion: async (path) => {
        if (path === '/installed' && ++installedReads === 1) {
          firstStarted?.();
          await blocked;
        }
        return path === '/installed' ? 'codex-cli 0.166.0' : 'codex-cli 0.165.0';
      },
    };
    const snapshot = new CodexSelectionSnapshot(probe);
    const firstOpen = snapshot.selectForOpen();
    await started;
    const second = await snapshot.selectForOpen();
    releaseFirst?.();
    const first = await firstOpen;
    expect(snapshot.current()).toBe(second.selected);
    expect(first.selected).not.toBe(second.selected);
    await expect(snapshot.activateFallback(first.selected, 'turn/start'))
      .resolves.toMatchObject({ source: 'bundled' });
    await expect(snapshot.activateFallback(second.selected, 'turn/start'))
      .resolves.toMatchObject({ source: 'bundled' });
  });

  it('does not let a concurrent history selection replace an active lane handle', async () => {
    const snapshot = new CodexSelectionSnapshot(probes(['/installed'], {
      '/installed': 'codex-cli 0.166.0', '/bundle/codex': 'codex-cli 0.165.0',
    }));
    const lane = await snapshot.selectForOpen();
    const historyRead = snapshot.selectForOpen();
    const history = await historyRead;
    expect(history.selected).not.toBe(lane.selected);
    await expect(snapshot.activateFallback(lane.selected, 'turn/start'))
      .resolves.toMatchObject({ path: '/bundle/codex' });
    expect(snapshot.current()).toBe(history.selected);
  });

  it('resolves a Windows cmd shim only through a neighboring native exe', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    const dir = await mkdtemp(join(tmpdir(), 'codex-selector-'));
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
      const shim = join(dir, 'codex.cmd');
      const native = join(dir, 'codex.exe');
      await writeFile(shim, '@echo off\r\n');
      await writeFile(native, 'native');
      const probe = createNodeCodexExecutableProbes(async () => undefined);
      expect(await probe.canonicalNativePath(shim)).toBe(native);
      expect(await probe.canonicalNativePath(join(dir, 'missing.cmd'))).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
