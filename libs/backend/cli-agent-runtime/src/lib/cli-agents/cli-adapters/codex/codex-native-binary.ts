/**
 * The Codex native binary a lane runs, and its version (TASK_2026_597, F2).
 *
 * The version is the one of the binary the lane actually executes. `detect()`
 * probes the global `codex` on PATH, which can be another release than the
 * bundled `@openai/codex-<platform>` binary lanes run, so it is not used here.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import { probeCliVersion } from '../cli-adapter.utils';

/** `major.minor.patch` at the start of a version string. */
const SEMVER_CORE = /\d+\.\d+\.\d+/;

/**
 * One probe per binary path for the life of the process: the binary at a path
 * does not change under a running host, and a probe spawns a process.
 */
const probedVersions = new Map<string, Promise<string | undefined>>();

export interface CodexNativeBinaryInfo {
  /** Absolute path of the native binary. */
  readonly path: string;
  /** `major.minor.patch`, or `undefined` when neither source answered. */
  readonly version: string | undefined;
}

/**
 * The native binary a lane will run and its version, or `undefined` when no
 * native binary exists (the SDK then resolves its own, as before).
 */
export async function resolveCodexNativeBinaryInfo(
  detectedCliPath?: string,
): Promise<CodexNativeBinaryInfo | undefined> {
  const binaryPath = resolveCodexNativeBinaryPath(detectedCliPath);
  if (binaryPath === undefined) return undefined;
  return { path: binaryPath, version: await codexBinaryVersion(binaryPath) };
}

/**
 * The version from the `package.json` of the platform package that owns the
 * binary, four levels above `vendor/<triple>/<layout>/<binary>` (the
 * `relsFromPkg` layout above). That file reads e.g. `0.155.1-win32-x64`, so
 * only the `major.minor.patch` core is kept. When the file is missing or holds
 * no version, one cached `--version` probe of the binary answers instead.
 */
async function codexBinaryVersion(
  binaryPath: string,
): Promise<string | undefined> {
  const fromPackage = await platformPackageVersion(
    path.join(binaryPath, '..', '..', '..', '..', 'package.json'),
  );
  if (fromPackage !== undefined) return fromPackage;

  let probe = probedVersions.get(binaryPath);
  if (probe === undefined) {
    probe = probeCliVersion(binaryPath).then(
      (output) => SEMVER_CORE.exec(output ?? '')?.[0],
    );
    probedVersions.set(binaryPath, probe);
  }
  return probe;
}

async function platformPackageVersion(
  packageJsonPath: string,
): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(packageJsonPath, 'utf-8');
  } catch {
    // degradation-audit: optional-capability - a binary outside an npm
    // platform package (a global install, a custom layout) has no such file;
    // the caller falls back to probing the binary itself.
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // degradation-audit: optional-capability - an unparsable manifest is
    // treated like a missing one; the caller probes the binary instead.
    return undefined;
  }
  const version =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as { version?: unknown }).version
      : undefined;
  return typeof version === 'string'
    ? SEMVER_CORE.exec(version)?.[0]
    : undefined;
}
