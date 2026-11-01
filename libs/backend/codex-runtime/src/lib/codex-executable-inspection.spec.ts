import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCodexExecutablePin } from './codex-executable-pin';
import { inspectCodexExecutable } from './codex-executable-inspection';
import type { CodexExecutableManifestRow } from './codex-runtime-ports';

jest.mock('./codex-executable-pin', () => ({
  findCodexExecutablePin: jest.fn(),
}));

const platform = { platform: 'test-platform', arch: 'test-arch' };
const pinnedVersion = '1.2.3';
const originalBytes = Buffer.from('reviewed Codex fixture');
const originalDigest = createHash('sha256').update(originalBytes).digest('hex');

describe('inspectCodexExecutable', () => {
  let directory: string;
  let executablePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ptah-codex-inspection-'));
    executablePath = join(directory, 'codex');
    await writeFile(executablePath, originalBytes);
    const pin: CodexExecutableManifestRow = {
      ...platform,
      pinnedVersion,
      version: pinnedVersion,
      binarySha256: originalDigest,
      schemaSha256: '0'.repeat(64),
    };
    jest.mocked(findCodexExecutablePin).mockReturnValue(pin);
  });

  afterEach(async () => {
    jest.mocked(findCodexExecutablePin).mockReset();
    await rm(directory, { recursive: true, force: true });
  });

  it('returns the real path, measured digest and pinned version line', async () => {
    const result = await inspectCodexExecutable(executablePath, platform);

    expect(result).toEqual({
      executablePath: await realpath(executablePath),
      sha256: originalDigest,
      versionOutput: `codex-cli ${pinnedVersion}`,
    });
  });

  it('reuses a completed inspection without reading the version again', async () => {
    const readVersion = jest.fn(async () => `codex-cli ${pinnedVersion}`);
    const first = await inspectCodexExecutable(executablePath, platform, { readVersion });
    const second = await inspectCodexExecutable(executablePath, platform, { readVersion });

    expect(second).toBe(first);
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it('keeps a default inspection separate from a later callback inspection', async () => {
    const readVersion = jest.fn(async () => `codex-cli ${pinnedVersion}\n`);
    const defaultResult = await inspectCodexExecutable(executablePath, platform);
    const callbackResult = await inspectCodexExecutable(executablePath, platform, { readVersion });
    const defaultAgain = await inspectCodexExecutable(executablePath, platform);

    expect(defaultResult.versionOutput).toBe(`codex-cli ${pinnedVersion}`);
    expect(callbackResult.versionOutput).toBe(`codex-cli ${pinnedVersion}\n`);
    expect(defaultAgain).toBe(defaultResult);
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it('keeps a callback inspection separate from a later default inspection', async () => {
    const readVersion = jest.fn(async () => `codex-cli ${pinnedVersion}\n`);
    const callbackResult = await inspectCodexExecutable(executablePath, platform, { readVersion });
    const defaultResult = await inspectCodexExecutable(executablePath, platform);
    const callbackAgain = await inspectCodexExecutable(executablePath, platform, { readVersion });

    expect(callbackResult.versionOutput).toBe(`codex-cli ${pinnedVersion}\n`);
    expect(defaultResult.versionOutput).toBe(`codex-cli ${pinnedVersion}`);
    expect(callbackAgain).toBe(callbackResult);
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it('caches version callbacks by their function identity', async () => {
    const firstVersion = jest.fn(async () => `codex-cli ${pinnedVersion}`);
    const secondVersion = jest.fn(async () => `codex-cli ${pinnedVersion}\n`);

    await inspectCodexExecutable(executablePath, platform, { readVersion: firstVersion });
    await inspectCodexExecutable(executablePath, platform, { readVersion: secondVersion });
    await inspectCodexExecutable(executablePath, platform, { readVersion: firstVersion });
    await inspectCodexExecutable(executablePath, platform, { readVersion: secondVersion });

    expect(firstVersion).toHaveBeenCalledTimes(1);
    expect(secondVersion).toHaveBeenCalledTimes(1);
  });

  it('retries a failed version callback without reusing its rejection', async () => {
    let attempts = 0;
    const readVersion = jest.fn(async () => {
      if (attempts++ === 0) throw new Error('version probe failed');
      return `codex-cli ${pinnedVersion}`;
    });

    await expect(inspectCodexExecutable(executablePath, platform, { readVersion }))
      .rejects.toThrow('version probe failed');
    await expect(inspectCodexExecutable(executablePath, platform, { readVersion }))
      .resolves.toMatchObject({ versionOutput: `codex-cli ${pinnedVersion}` });
    expect(readVersion).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight inspection between concurrent callers', async () => {
    let releaseVersion: ((value: string) => void) | undefined;
    let versionStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { versionStarted = resolve; });
    const readVersion = jest.fn(() => new Promise<string>((resolve) => {
      releaseVersion = resolve;
      versionStarted();
    }));
    const first = inspectCodexExecutable(executablePath, platform, { readVersion });
    const second = inspectCodexExecutable(executablePath, platform, { readVersion });
    await started;
    expect(readVersion).toHaveBeenCalledTimes(1);
    releaseVersion?.(`codex-cli ${pinnedVersion}`);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toBe(firstResult);
  });

  it('re-hashes when the executable size changes', async () => {
    await inspectCodexExecutable(executablePath, platform);
    const changedBytes = Buffer.from('different reviewed Codex fixture');
    await writeFile(executablePath, changedBytes);

    await expect(inspectCodexExecutable(executablePath, platform)).rejects.toMatchObject({
      code: 'codex-digest-mismatch',
    });
  });

  it('re-hashes when only the executable modification time changes', async () => {
    await inspectCodexExecutable(executablePath, platform);
    const changedBytes = Buffer.from(originalBytes);
    changedBytes[0] = changedBytes[0] === 65 ? 66 : 65;
    await writeFile(executablePath, changedBytes);
    const changedTime = new Date('2030-01-01T00:00:00.000Z');
    await utimes(executablePath, changedTime, changedTime);

    await expect(inspectCodexExecutable(executablePath, platform)).rejects.toMatchObject({
      code: 'codex-digest-mismatch',
    });
  });

  it('reports a digest mismatch and retries after the file is repaired', async () => {
    const wrongBytes = Buffer.alloc(originalBytes.length, 0);
    const fixedTime = new Date('2020-01-01T00:00:00.000Z');
    await writeFile(executablePath, wrongBytes);
    await utimes(executablePath, fixedTime, fixedTime);
    await expect(inspectCodexExecutable(executablePath, platform)).rejects.toMatchObject({
      code: 'codex-digest-mismatch',
    });
    await writeFile(executablePath, originalBytes);
    await utimes(executablePath, fixedTime, fixedTime);

    await expect(inspectCodexExecutable(executablePath, platform)).resolves.toMatchObject({
      sha256: originalDigest,
    });
  });

  it('reports a missing executable and preserves its cause', async () => {
    await rm(executablePath);

    await expect(inspectCodexExecutable(executablePath, platform)).rejects.toMatchObject({
      code: 'codex-executable-missing',
      cause: expect.objectContaining({ code: 'ENOENT' }),
    });
  });

  it('rejects a directory as a missing executable', async () => {
    await expect(inspectCodexExecutable(directory, platform)).rejects.toMatchObject({
      code: 'codex-executable-missing',
      cause: expect.objectContaining({ message: 'Codex executable path is not a file' }),
    });
  });

  it('reports an unavailable platform pin', async () => {
    jest.mocked(findCodexExecutablePin).mockReturnValue(undefined);

    await expect(inspectCodexExecutable(executablePath, platform)).rejects.toMatchObject({
      code: 'codex-pin-unavailable',
    });
  });

  it('returns a supplied version output', async () => {
    const readVersion = jest.fn(async () => `codex-cli ${pinnedVersion}\n`);

    await expect(inspectCodexExecutable(executablePath, platform, { readVersion }))
      .resolves.toMatchObject({ versionOutput: `codex-cli ${pinnedVersion}\n` });
  });

  it('evicts the oldest realpath after eight cached executables', async () => {
    const readVersion = jest.fn(async () => `codex-cli ${pinnedVersion}`);
    await inspectCodexExecutable(executablePath, platform, { readVersion });
    for (let index = 0; index < 8; index++) {
      const path = join(directory, `codex-${index}`);
      await writeFile(path, originalBytes);
      await inspectCodexExecutable(path, platform, { readVersion });
    }
    await inspectCodexExecutable(executablePath, platform, { readVersion });

    expect(readVersion).toHaveBeenCalledTimes(10);
  });
});
