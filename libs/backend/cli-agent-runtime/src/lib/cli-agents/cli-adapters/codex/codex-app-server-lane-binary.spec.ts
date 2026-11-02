import 'reflect-metadata';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { findCodexExecutablePin } from '@ptah-extension/codex-runtime';
import { probeCliVersion } from '../cli-adapter.utils';
import { NativeCodexLaneBinaryProbe } from './codex-app-server-lane-binary';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
    '@ptah-extension/codex-runtime',
  ),
  findCodexExecutablePin: jest.fn(),
}));
jest.mock('../cli-adapter.utils', () => ({
  probeCliVersion: jest.fn(),
}));
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, createReadStream: jest.fn(actual.createReadStream) };
});

describe('NativeCodexLaneBinaryProbe', () => {
  let root: string;
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
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

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codex-lane-bin-'));
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: root });
    const digest = createHash('sha256').update('fixture').digest('hex');
    jest.mocked(findCodexExecutablePin).mockReturnValue({
      platform: process.platform, arch: process.arch, pinnedVersion: '0.165.0',
      version: 'codex-cli 0.165.0', binarySha256: digest, schemaSha256: digest,
    });
    jest.mocked(probeCliVersion).mockResolvedValue('codex-cli 0.165.0\n');
    jest.mocked(fs.createReadStream).mockClear();
  });
  afterEach(async () => {
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
    else Reflect.deleteProperty(process, 'resourcesPath');
    await rm(root, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  async function packagedBinary(layout: 'bin' | 'codex'): Promise<string> {
    const directory = path.join(root, 'app.asar.unpacked', 'node_modules', '@openai',
      platformPackage, 'vendor', triple, layout);
    await mkdir(directory, { recursive: true });
    const binary = path.join(directory, binaryName);
    await writeFile(binary, 'fixture');
    return binary;
  }

  it.each(['bin', 'codex'] as const)(
    'finds packaged Electron root and the %s vendor layout', async (layout) => {
      const binary = await packagedBinary(layout);
      await expect(new NativeCodexLaneBinaryProbe().resolve()).resolves.toEqual({
        path: binary, version: '0.165.0',
      });
      expect(probeCliVersion).toHaveBeenCalledWith(binary);
    },
  );

  it('validates an explicit path and rejects a missing or changed binary before spawn', async () => {
    const binary = await packagedBinary('bin');
    const probe = new NativeCodexLaneBinaryProbe();
    await expect(probe.resolve(binary)).resolves.toMatchObject({ path: binary });
    jest.mocked(probeCliVersion).mockClear();
    await writeFile(binary, 'changed binary');
    await expect(probe.resolve(binary)).rejects.toThrow('pin mismatch');
    expect(probeCliVersion).not.toHaveBeenCalled();
    await expect(probe.resolve(path.join(root, 'missing', binaryName)))
      .rejects.toThrow('path is unavailable');
  });

  it('reuses a verified realpath and rehashes when its mtime changes', async () => {
    const binary = await packagedBinary('bin');
    const probe = new NativeCodexLaneBinaryProbe();
    await probe.resolve(binary);
    await probe.resolve(binary);
    expect(fs.createReadStream).toHaveBeenCalledTimes(1);
    expect(probeCliVersion).toHaveBeenCalledTimes(1);
    await writeFile(binary, 'changed');
    const changedAt = new Date('2020-01-01T00:00:00.000Z');
    await utimes(binary, changedAt, changedAt);
    await expect(probe.resolve(binary)).rejects.toThrow('pin mismatch');
    expect(fs.createReadStream).toHaveBeenCalledTimes(2);
    expect(probeCliVersion).toHaveBeenCalledTimes(1);
  });
});
