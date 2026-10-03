const mockProbeCliVersion = jest.fn();
jest.mock('../cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('../cli-adapter.utils')>(
    '../cli-adapter.utils',
  );
  return {
    ...actual,
    probeCliVersion: (...args: unknown[]) => mockProbeCliVersion(...args),
  };
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveCodexNativeBinaryInfo } from './codex-native-binary';

/**
 * A synthetic packaged-Electron tree: `<resources>/app.asar.unpacked/
 * node_modules/@openai/codex-win32-x64/vendor/<triple>/bin/codex.exe`, the
 * first candidate the resolver probes on win32/x64.
 */
describe('resolveCodexNativeBinaryInfo', () => {
  type ResourcesProcess = NodeJS.Process & { resourcesPath?: string };
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalResourcesPath = (process as ResourcesProcess).resourcesPath;
  let resources: string;
  let packageRoot: string;
  let binaryPath: string;

  function stub(key: 'platform' | 'arch', value: string): void {
    Object.defineProperty(process, key, { value, configurable: true });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    stub('platform', 'win32');
    stub('arch', 'x64');
    resources = mkdtempSync(path.join(tmpdir(), 'codex-native-binary-'));
    (process as ResourcesProcess).resourcesPath = resources;
    packageRoot = path.join(
      resources,
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-win32-x64',
    );
    const binDir = path.join(
      packageRoot,
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
    );
    mkdirSync(binDir, { recursive: true });
    binaryPath = path.join(binDir, 'codex.exe');
    writeFileSync(binaryPath, '');
  });

  afterEach(() => {
    stub('platform', originalPlatform);
    stub('arch', originalArch);
    if (originalResourcesPath === undefined) {
      delete (process as ResourcesProcess).resourcesPath;
    } else {
      (process as ResourcesProcess).resourcesPath = originalResourcesPath;
    }
    rmSync(resources, { recursive: true, force: true });
  });

  it('reads the version from the owning platform package, without probing', async () => {
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openai/codex-win32-x64',
        version: '0.155.1-win32-x64',
      }),
    );

    await expect(resolveCodexNativeBinaryInfo()).resolves.toEqual({
      path: binaryPath,
      version: '0.155.1',
    });
    expect(mockProbeCliVersion).not.toHaveBeenCalled();
  });

  it('falls back to one cached probe of that binary when package.json is missing', async () => {
    mockProbeCliVersion.mockResolvedValue('codex-cli 0.160.2');

    const first = await resolveCodexNativeBinaryInfo();
    const second = await resolveCodexNativeBinaryInfo();

    expect(first).toEqual({ path: binaryPath, version: '0.160.2' });
    expect(second).toEqual(first);
    expect(mockProbeCliVersion).toHaveBeenCalledTimes(1);
    expect(mockProbeCliVersion).toHaveBeenCalledWith(binaryPath);
  });

  it('falls back to the probe when package.json holds no version', async () => {
    writeFileSync(path.join(packageRoot, 'package.json'), '{ not json');
    mockProbeCliVersion.mockResolvedValue(undefined);

    await expect(resolveCodexNativeBinaryInfo()).resolves.toEqual({
      path: binaryPath,
      version: undefined,
    });
    expect(mockProbeCliVersion).toHaveBeenCalledWith(binaryPath);
  });
});
