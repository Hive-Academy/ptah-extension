/**
 * Workspace fingerprint — stable identity for a workspace across rename/move.
 *
 * Strategy (first non-empty wins):
 *   1. Git remote URL + HEAD SHA  → most stable across renames, moves, forks-at-snapshot
 *   2. package.json `name + repository.url`
 *   3. Absolute path (fallback) — fp will not survive moves; caller logs an info line
 *
 * Returns a 16-hex-char prefix of SHA-256 — small enough to live in the
 * `<!-- ptah-seed:hash=…;fp=…;v=1 -->` content prefix; collision odds across one
 * user's workspaces are vanishingly small.
 *
 * Pure function. No DI, no state, no side effects beyond the FS reads through
 * the injected provider.
 */

import { join } from 'path';
import { createHash } from 'crypto';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

export type FingerprintSource = 'git' | 'package' | 'path';

export interface FingerprintResult {
  fp: string;
  source: FingerprintSource;
}

const HEX16 = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

export async function deriveWorkspaceFingerprint(
  workspaceRoot: string,
  fs: IFileSystemProvider,
): Promise<FingerprintResult> {
  // 1. Git: read .git/config + HEAD
  try {
    const cfg = await safeReadText(fs, join(workspaceRoot, '.git', 'config'));
    if (cfg) {
      const remoteMatch = /\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/.exec(cfg);
      const headRaw = await safeReadText(
        fs,
        join(workspaceRoot, '.git', 'HEAD'),
      );
      const refMatch =
        headRaw && /ref:\s*(refs\/heads\/.+)/.exec(headRaw.trim());
      let headSha: string | null = null;
      if (refMatch) {
        const refContent = await safeReadText(
          fs,
          join(workspaceRoot, '.git', refMatch[1].trim()),
        );
        headSha = refContent?.trim().slice(0, 40) ?? null;
      } else if (headRaw && /^[a-f0-9]{40}$/i.test(headRaw.trim())) {
        headSha = headRaw.trim();
      }
      if (remoteMatch && headSha) {
        const url = remoteMatch[1]
          .trim()
          .toLowerCase()
          .replace(/\.git$/, '');
        return { fp: HEX16(`git:${url}:${headSha}`), source: 'git' };
      }
      if (remoteMatch) {
        const url = remoteMatch[1]
          .trim()
          .toLowerCase()
          .replace(/\.git$/, '');
        return { fp: HEX16(`git-remote:${url}`), source: 'git' };
      }
    }
  } catch {
    /* fall through to package.json */
  }

  // 2. package.json
  try {
    const pkgRaw = await safeReadText(fs, join(workspaceRoot, 'package.json'));
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        repository?: { url?: string } | string;
      };
      const name = pkg.name ?? '';
      const repo =
        typeof pkg.repository === 'string'
          ? pkg.repository
          : (pkg.repository?.url ?? '');
      if (name || repo) {
        return { fp: HEX16(`pkg:${name}:${repo}`), source: 'package' };
      }
    }
  } catch {
    /* fall through to path */
  }

  // 3. Path fallback — does NOT survive moves; caller should log a warning.
  return { fp: HEX16(`path:${workspaceRoot}`), source: 'path' };
}

/**
 * Derive the raw 40-char git HEAD SHA for a workspace.
 *
 * Reads `.git/HEAD` and:
 *   - If HEAD contains `ref: refs/heads/<branch>`, resolves the ref file.
 *   - If HEAD contains a raw 40-hex SHA (detached HEAD), returns it directly.
 *   - Returns `null` when `.git/HEAD` is absent (non-git workspace) or the
 *     resolved ref file is missing or malformed.
 *
 * Pure function, no side effects beyond the FS reads through the injected
 * provider. Does NOT modify `deriveWorkspaceFingerprint()` in any way.
 */
export async function deriveGitHeadSha(
  workspaceRoot: string,
  fs: IFileSystemProvider,
): Promise<string | null> {
  const headRaw = await safeReadText(fs, join(workspaceRoot, '.git', 'HEAD'));
  if (!headRaw) return null;

  const refMatch = /ref:\s*(refs\/heads\/.+)/.exec(headRaw.trim());
  if (refMatch) {
    const refContent = await safeReadText(
      fs,
      join(workspaceRoot, '.git', refMatch[1].trim()),
    );
    const sha = refContent?.trim().slice(0, 40) ?? null;
    return sha && /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
  }

  const trimmed = headRaw.trim();
  return /^[a-f0-9]{40}$/i.test(trimmed) ? trimmed : null;
}

async function safeReadText(
  fs: IFileSystemProvider,
  path: string,
): Promise<string | null> {
  try {
    return await fs.readFile(path);
  } catch {
    return null;
  }
}
