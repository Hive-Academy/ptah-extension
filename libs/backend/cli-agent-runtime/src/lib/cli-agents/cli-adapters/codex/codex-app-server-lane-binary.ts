import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { realpath, stat } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import { findCodexExecutablePin } from '@ptah-extension/codex-runtime';
import { probeCliVersion } from '../cli-adapter.utils';

export interface CodexLaneBinary {
  readonly path: string;
  readonly version: string;
}

export interface CodexLaneBinaryProbe {
  resolve(explicitPath?: string): Promise<CodexLaneBinary | undefined>;
}

const versionSchema = z.string().regex(/^codex-cli \d+\.\d+\.\d+$/);

/** Checks the reviewed executable's bytes before starting even a version probe. */
export class NativeCodexLaneBinaryProbe implements CodexLaneBinaryProbe {
  private readonly verified = new Map<string, {
    readonly size: number;
    readonly mtimeMs: number;
    readonly pinHash: string;
    readonly pinVersion: string;
    readonly result: CodexLaneBinary;
  }>();

  async resolve(explicitPath?: string): Promise<CodexLaneBinary | undefined> {
    const candidate = explicitPath ?? resolveCodexNativeBinaryPath();
    if (!candidate) return undefined;
    let resolved: string;
    let size: number;
    let mtimeMs: number;
    try {
      resolved = await realpath(candidate);
      const metadata = await stat(resolved);
      if (!metadata.isFile()) throw new Error('not a file');
      size = metadata.size;
      mtimeMs = metadata.mtimeMs;
    } catch (error: unknown) {
      if (explicitPath === undefined) return undefined;
      throw new Error('Codex executable path is unavailable', { cause: error });
    }
    const pin = findCodexExecutablePin(process.platform, process.arch);
    if (!pin) throw new Error('Codex executable pin is unavailable for this platform');
    if (path.basename(resolved) !== (process.platform === 'win32' ? 'codex.exe' : 'codex'))
      throw new Error('Codex executable path is not a native binary');
    const cached = this.verified.get(resolved);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs &&
      cached.pinHash === pin.binarySha256 && cached.pinVersion === pin.pinnedVersion)
      return cached.result;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(resolved)) hash.update(chunk);
    if (hash.digest('hex').toLowerCase() !== pin.binarySha256.toLowerCase())
      throw new Error('Codex executable pin mismatch');
    const output = versionSchema.safeParse((await probeCliVersion(resolved))?.trim());
    if (!output.success || output.data !== `codex-cli ${pin.pinnedVersion}`)
      throw new Error('Codex executable version mismatch');
    const result = { path: resolved, version: pin.pinnedVersion };
    this.verified.set(resolved, {
      size, mtimeMs, pinHash: pin.binarySha256, pinVersion: pin.pinnedVersion, result,
    });
    return result;
  }
}
