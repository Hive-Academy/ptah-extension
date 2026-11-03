import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { findCodexExecutablePin } from './codex-executable-pin';
import { verifyCodexBinary } from './codex-protocol-manifest';

export interface CodexExecutableInspection {
  readonly executablePath: string;
  readonly sha256: string;
  readonly versionOutput: string;
}

export type CodexExecutableInspectionErrorCode =
  | 'codex-executable-missing'
  | 'codex-pin-unavailable'
  | 'codex-digest-mismatch';

export class CodexExecutableInspectionError extends Error {
  constructor(
    message: string,
    readonly code: CodexExecutableInspectionErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CodexExecutableInspectionError';
  }
}

interface CachedInspection {
  readonly key: string;
  readonly digest: Promise<string>;
  defaultInspection?: Promise<CodexExecutableInspection>;
  readonly versionInspections: WeakMap<
    (path: string) => Promise<string>,
    Promise<CodexExecutableInspection>
  >;
}

const inspections = new Map<string, CachedInspection>();
const MAX_CACHED_REALPATHS = 8;

/** Cache by file identity and reviewed pin, including work still in flight. */
export async function inspectCodexExecutable(
  executablePath: string,
  platform: { readonly platform: string; readonly arch: string },
  options?: { readonly readVersion?: (path: string) => Promise<string> },
): Promise<CodexExecutableInspection> {
  const pin = findCodexExecutablePin(platform.platform, platform.arch);
  if (!pin) {
    throw new CodexExecutableInspectionError(
      'No reviewed Codex executable pin for this platform',
      'codex-pin-unavailable',
    );
  }

  let resolvedPath: string;
  let size: number;
  let mtimeMs: number;
  try {
    resolvedPath = await realpath(executablePath);
    const file = await stat(resolvedPath);
    if (!file.isFile()) {
      throw new Error('Codex executable path is not a file');
    }
    size = file.size;
    mtimeMs = file.mtimeMs;
  } catch (cause) {
    throw new CodexExecutableInspectionError(
      'Codex executable is missing or is not a file',
      'codex-executable-missing',
      { cause },
    );
  }

  const key = JSON.stringify([
    resolvedPath,
    size,
    mtimeMs,
    pin.binarySha256,
    pin.pinnedVersion,
  ]);
  let cached = inspections.get(resolvedPath);
  if (!cached || cached.key !== key) {
    const digest = (async (): Promise<string> => {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(resolvedPath)) {
        hash.update(chunk);
      }
      const sha256 = hash.digest('hex');
      if (sha256.toLowerCase() !== pin.binarySha256.toLowerCase()) {
        throw new CodexExecutableInspectionError(
          'Codex executable digest does not match the reviewed pin',
          'codex-digest-mismatch',
        );
      }
      return sha256;
    })();
    cached = { key, digest, versionInspections: new WeakMap() };
    inspections.delete(resolvedPath);
    inspections.set(resolvedPath, cached);
    if (inspections.size > MAX_CACHED_REALPATHS) {
      const oldest = inspections.keys().next().value;
      if (oldest !== undefined) inspections.delete(oldest);
    }
    const entry = cached;
    // degradation-audit: reported - the digest rejection reaches inspection callers; evict it for retry.
    void digest.catch(() => {
      if (inspections.get(resolvedPath) === entry) inspections.delete(resolvedPath);
    });
  }

  const entry = cached;
  const readVersion = options?.readVersion;
  const previous = readVersion
    ? entry.versionInspections.get(readVersion)
    : entry.defaultInspection;
  if (previous) return previous;

  const promise = (async (): Promise<CodexExecutableInspection> => {
    const sha256 = await entry.digest;
    const versionOutput = readVersion
      ? await readVersion(resolvedPath)
      : `codex-cli ${pin.pinnedVersion}`;
    const verification = verifyCodexBinary(
      { executablePath: resolvedPath, sha256, versionOutput, ...platform },
      pin,
    );
    if (verification.status !== 'ok') {
      throw new Error(`Codex executable identity failed pin verification: ${verification.reason}`);
    }
    return { executablePath: resolvedPath, sha256, versionOutput };
  })();
  if (readVersion) entry.versionInspections.set(readVersion, promise);
  else entry.defaultInspection = promise;
  // degradation-audit: reported - the rejection reaches the caller; evict the failed version mode for retry.
  void promise.catch(() => {
    if (readVersion && entry.versionInspections.get(readVersion) === promise) {
      entry.versionInspections.delete(readVersion);
    } else if (!readVersion && entry.defaultInspection === promise) {
      entry.defaultInspection = undefined;
    }
  });
  return promise;
}
