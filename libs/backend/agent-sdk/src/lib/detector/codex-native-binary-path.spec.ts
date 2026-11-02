const mockExistsSync = jest.fn();
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { readFileSync } from 'fs';
import path from 'path';
import { resolveCodexNativeBinaryPath } from './codex-native-binary-path';

describe('resolveCodexNativeBinaryPath', () => {
  type ResourcesProcess = NodeJS.Process & { resourcesPath?: string };
  const originalResourcesPath = (process as ResourcesProcess).resourcesPath;
  const platformPackage = process.platform === 'win32'
    ? (process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64')
    : process.platform === 'darwin'
      ? (process.arch === 'arm64' ? 'codex-darwin-arm64' : 'codex-darwin-x64')
      : (process.arch === 'arm64' ? 'codex-linux-arm64' : 'codex-linux-x64');
  const triple = process.platform === 'win32'
    ? (process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc')
    : process.platform === 'darwin'
      ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
      : (process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl');
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';

  beforeEach(() => {
    jest.clearAllMocks();
    delete (process as ResourcesProcess).resourcesPath;
  });

  afterEach(() => {
    if (originalResourcesPath === undefined) {
      delete (process as ResourcesProcess).resourcesPath;
    } else {
      (process as ResourcesProcess).resourcesPath = originalResourcesPath;
    }
  });

  it('falls back to the CLI package node_modules root', () => {
    const platformPkgJsonPath = require.resolve(
      `@openai/${platformPackage}/package.json`,
    );
    const platformCandidate = path.join(
      path.dirname(platformPkgJsonPath),
      'vendor',
      triple,
      'bin',
      binaryName,
    );
    const cliPkgJsonPath = require.resolve('@openai/codex/package.json');
    const nodeModulesRoot = path.resolve(cliPkgJsonPath, '..', '..', '..');
    const cliCandidate = path.join(
      nodeModulesRoot,
      '@openai',
      platformPackage,
      'vendor',
      triple,
      'bin',
      binaryName,
    );
    mockExistsSync
      .mockReturnValueOnce(false)
      .mockImplementation((candidate: string) => candidate === cliCandidate);

    expect(resolveCodexNativeBinaryPath()).toBe(cliCandidate);
    const probed = mockExistsSync.mock.calls.map(([candidate]) => candidate);
    expect(probed[0]).toBe(platformCandidate);
    // The platform package's legacy vendor layout is probed before the CLI
    // root, so the CLI candidate is found later in the probe order.
    expect(probed.indexOf(cliCandidate, 1)).toBeGreaterThan(0);
  });

  it('resolves only the direct CLI and platform packages', () => {
    const source = readFileSync(
      path.join(__dirname, 'codex-native-binary-path.ts'),
      'utf8',
    );

    expect(source).toContain("require.resolve('@openai/codex/package.json')");
    expect(source).not.toContain('@openai/codex-sdk');
  });
});
