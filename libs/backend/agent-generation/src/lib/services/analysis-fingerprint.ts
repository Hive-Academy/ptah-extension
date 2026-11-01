import { createHash } from 'crypto';
import { join } from 'path';
import picomatch from 'picomatch';
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

type IgnoreRule = {
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
  matches: (path: string) => boolean;
};

/** Parse root .gitignore rules; nested ignore files are outside this bounded check. */
export function parseRootGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    // Git discards unescaped trailing spaces but preserves escaped spaces.
    const line = raw.replace(/(?<!\\) +$/, '');
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    let pattern = negated ? line.slice(1) : line;
    const directoryOnly = pattern.endsWith('/') && !pattern.endsWith('\\/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.startsWith('/') || pattern.includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (!pattern) continue;
    const matcher = picomatch(pattern, { dot: true });
    const contentsOf = pattern.endsWith('/**') ? pattern.slice(0, -3) : null;
    rules.push({
      negated,
      directoryOnly,
      anchored,
      matches: (path) => path !== contentsOf && matcher(path),
    });
  }
  return rules;
}

/** Apply root rules in order, including negation, to a workspace-relative path. */
export function isRootGitignored(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let parentIgnored = false;
  for (let depth = 1; depth <= segments.length; depth++) {
    const path = segments.slice(0, depth).join('/');
    const directory = depth < segments.length || isDirectory;
    let ignored: boolean = parentIgnored;
    for (const rule of rules) {
      if (rule.directoryOnly && !directory) continue;
      const matches = rule.anchored
        ? rule.matches(path)
        : rule.matches(segments[depth - 1]);
      if (matches && (!rule.negated || !parentIgnored)) ignored = !rule.negated;
    }
    parentIgnored = ignored;
  }
  return parentIgnored;
}

export async function readRootGitignore(
  workspaceRoot: string,
  fs: IFileSystemProvider,
): Promise<IgnoreRule[]> {
  return parseRootGitignore(await fs.readFile(join(workspaceRoot, '.gitignore')));
}

/** A one-level scan excludes empty directories and direct ignored-only contents. */
async function hasTransportableContent(
  workspaceRoot: string,
  name: string,
  fs: IFileSystemProvider,
  rules: IgnoreRule[],
): Promise<boolean> {
  try {
    const children = await fs.readDirectory(join(workspaceRoot, name));
    return children.some((child) =>
      !isRootGitignored(`${name}/${child.name}`, child.type === FileType.Directory, rules),
    );
  } catch {
    // degradation-audit: optional-capability — unreadable directories retain
    // their name in the fingerprint to avoid falsely treating them as empty.
    return true;
  }
}

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
  algorithm: WorkspaceFingerprint['algorithm'] = 'sha256-v2',
): Promise<WorkspaceFingerprint> {
  const entries = (await fs.readDirectory(workspaceRoot))
    .filter((entry) => !EXCLUDED_TOP_LEVEL_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const hash = createHash('sha256');
  hash.update(`${algorithm}\0`);
  if (algorithm === 'sha256-v1') {
    for (const entry of entries) {
      hashPart(hash, Buffer.from(entry.name, 'utf8'));
      hashPart(hash, Buffer.from(String(entry.type), 'utf8'));
      if (entry.type === FileType.File && ROOT_METADATA_FILES.has(entry.name)) {
        hashPart(hash, await fs.readFileBytes(join(workspaceRoot, entry.name)));
      }
    }
  } else {
    let rules: IgnoreRule[] = [];
    try {
      rules = await readRootGitignore(workspaceRoot, fs);
    } catch {
      // degradation-audit: optional-capability — an absent or unreadable root
      // .gitignore leaves directory names unfiltered.
    }
    for (const entry of entries) {
      if (
        entry.type === FileType.Directory &&
        !entry.name.startsWith('.') &&
        !isRootGitignored(entry.name, true, rules) &&
        await hasTransportableContent(workspaceRoot, entry.name, fs, rules)
      ) {
        hashPart(hash, Buffer.from(entry.name, 'utf8'));
      }
      if (entry.type === FileType.File && ROOT_METADATA_FILES.has(entry.name)) {
        hashPart(hash, Buffer.from(entry.name, 'utf8'));
        hashPart(
          hash,
          normalizeEolBytes(await fs.readFileBytes(join(workspaceRoot, entry.name))),
        );
      }
    }
  }
  return {
    algorithm,
    digest: hash.digest('hex'),
    capturedAt: new Date().toISOString(),
  };
}

/** Replace CRLF byte pairs without decoding binary lockfiles. */
export function normalizeEolBytes(bytes: Uint8Array): Uint8Array {
  return Buffer.from(
    Buffer.from(bytes).toString('latin1').replace(/\r\n/g, '\n'),
    'latin1',
  );
}

/** Return the SHA-256 hex digest of bytes or text. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Return null when a file cannot be read; the caller treats that as a hash mismatch. */
export async function hashFileOrNull(
  fs: IFileSystemProvider,
  path: string,
  normalizeEol = false,
): Promise<string | null> {
  try {
    const bytes = await fs.readFileBytes(path);
    return sha256Hex(normalizeEol ? normalizeEolBytes(bytes) : bytes);
  } catch {
    // degradation-audit: optional-capability - unreadable output is a hash
    // mismatch: resume reruns the phase and freshness reports stale; null is never success.
    return null;
  }
}
