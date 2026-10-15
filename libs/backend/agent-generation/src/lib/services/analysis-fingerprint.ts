import { createHash } from 'crypto';
import { join } from 'path';
import {
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type { WorkspaceFingerprint } from '@ptah-extension/shared';

const ROOT_METADATA_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'Pipfile',
  'Pipfile.lock',
  'requirements.txt',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'deno.json',
  'deno.jsonc',
  'deno.lock',
]);
const EXCLUDED_TOP_LEVEL_NAMES = new Set([
  '.ptah',
  '.claude',
  '.codex',
  '.github',
  '.cursor',
  '.opencode',
  '.agents',
  '.vscode',
  '.gitignore',
  '.mcp.json',
  'opencode.json',
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.nx',
  '.turbo',
  '.cache',
  '.yarn',
  '.pnpm-store',
]);

function hashPart(
  hash: ReturnType<typeof createHash>,
  value: Uint8Array,
): void {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.byteLength);
  hash.update(length);
  hash.update(value);
}

/** Hash bounded root metadata without walking dependency or generated trees. */
export async function computeWorkspaceFingerprint(
  workspaceRoot: string,
  fs: IFileSystemProvider,
): Promise<WorkspaceFingerprint> {
  const entries = (await fs.readDirectory(workspaceRoot))
    .filter((entry) => !EXCLUDED_TOP_LEVEL_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const hash = createHash('sha256');
  hash.update('sha256-v1\0');
  for (const entry of entries) {
    hashPart(hash, Buffer.from(entry.name, 'utf8'));
    hashPart(hash, Buffer.from(String(entry.type), 'utf8'));
    if (entry.type === FileType.File && ROOT_METADATA_FILES.has(entry.name)) {
      hashPart(hash, await fs.readFileBytes(join(workspaceRoot, entry.name)));
    }
  }
  return {
    algorithm: 'sha256-v1',
    digest: hash.digest('hex'),
    capturedAt: new Date().toISOString(),
  };
}

/** Return the SHA-256 hex digest of bytes or text. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Return null when a file cannot be read; the caller treats that as a hash mismatch. */
export async function hashFileOrNull(
  fs: IFileSystemProvider,
  path: string,
): Promise<string | null> {
  try {
    return sha256Hex(await fs.readFileBytes(path));
  } catch {
    // degradation-audit: optional-capability - unreadable output is a hash
    // mismatch: resume reruns the phase and freshness reports stale; null is never success.
    return null;
  }
}
