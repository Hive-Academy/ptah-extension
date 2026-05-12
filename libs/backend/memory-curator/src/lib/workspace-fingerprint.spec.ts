import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  deriveWorkspaceFingerprint,
  deriveGitHeadSha,
} from './workspace-fingerprint';

function makeFs(map: Record<string, string>): IFileSystemProvider {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const lookup = new Map(
    Object.entries(map).map(([k, v]) => [norm(k), v] as const),
  );
  return {
    readFile: jest.fn(async (path: string) => {
      const v = lookup.get(norm(path));
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    }),
  } as unknown as IFileSystemProvider;
}

const HEX16_RE = /^[a-f0-9]{16}$/;

describe('deriveWorkspaceFingerprint', () => {
  const root = '/workspace/foo';

  it('fingerprint-from-git: derives from origin remote + branch SHA', async () => {
    const fs = makeFs({
      [`${root}/.git/config`]:
        '[remote "origin"]\n\turl = https://github.com/acme/foo.git\n',
      [`${root}/.git/HEAD`]: 'ref: refs/heads/main\n',
      [`${root}/.git/refs/heads/main`]:
        'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4\n',
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('git');
    expect(result.fp).toMatch(HEX16_RE);
    // Stable across repeated calls.
    const again = await deriveWorkspaceFingerprint(root, fs);
    expect(again.fp).toBe(result.fp);
  });

  it('fingerprint-from-git: handles detached HEAD (raw SHA in HEAD file)', async () => {
    const fs = makeFs({
      [`${root}/.git/config`]:
        '[remote "origin"]\n\turl = git@github.com:acme/foo.git\n',
      [`${root}/.git/HEAD`]: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4\n',
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('git');
    expect(result.fp).toMatch(HEX16_RE);
  });

  it('fingerprint-from-git-remote-only: HEAD unreadable, falls back to remote-only fp', async () => {
    const fs = makeFs({
      [`${root}/.git/config`]:
        '[remote "origin"]\n\turl = https://github.com/acme/foo.git\n',
      // HEAD missing → safeReadText returns null
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('git');
    expect(result.fp).toMatch(HEX16_RE);
  });

  it('fingerprint-from-package: object-shaped repository', async () => {
    const fs = makeFs({
      [`${root}/package.json`]: JSON.stringify({
        name: '@acme/foo',
        repository: { url: 'https://github.com/acme/foo.git' },
      }),
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('package');
    expect(result.fp).toMatch(HEX16_RE);
  });

  it('fingerprint-from-package: string-shaped repository', async () => {
    const fs = makeFs({
      [`${root}/package.json`]: JSON.stringify({
        name: 'foo',
        repository: 'github:acme/foo',
      }),
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('package');
    expect(result.fp).toMatch(HEX16_RE);
  });

  it('fingerprint-from-package: name only (no repository)', async () => {
    const fs = makeFs({
      [`${root}/package.json`]: JSON.stringify({ name: 'standalone-pkg' }),
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('package');
    expect(result.fp).toMatch(HEX16_RE);
  });

  it('fingerprint-from-path-fallback: no git, no package.json', async () => {
    const fs = makeFs({});

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('path');
    expect(result.fp).toMatch(HEX16_RE);
    // Same path → same fp.
    const again = await deriveWorkspaceFingerprint(root, fs);
    expect(again.fp).toBe(result.fp);
    // Different path → different fp.
    const other = await deriveWorkspaceFingerprint('/workspace/bar', fs);
    expect(other.fp).not.toBe(result.fp);
  });

  it('fingerprint-from-path-fallback: empty package.json (no name, no repo)', async () => {
    const fs = makeFs({
      [`${root}/package.json`]: JSON.stringify({ version: '1.0.0' }),
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('path');
  });

  it('fingerprint-from-path-fallback: corrupt package.json JSON', async () => {
    const fs = makeFs({
      [`${root}/package.json`]: '{ not valid json',
    });

    const result = await deriveWorkspaceFingerprint(root, fs);

    expect(result.source).toBe('path');
  });

  it('git fp normalises trailing .git and lowercases URL', async () => {
    const a = makeFs({
      [`${root}/.git/config`]:
        '[remote "origin"]\n\turl = https://GitHub.com/Acme/Foo.git\n',
    });
    const b = makeFs({
      [`${root}/.git/config`]:
        '[remote "origin"]\n\turl = https://github.com/acme/foo\n',
    });

    const ra = await deriveWorkspaceFingerprint(root, a);
    const rb = await deriveWorkspaceFingerprint(root, b);

    expect(ra.fp).toBe(rb.fp);
  });
});

describe('deriveGitHeadSha', () => {
  const root = '/workspace/sha-test';
  const VALID_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';

  it('returns null when .git/HEAD is absent (non-git workspace)', async () => {
    const fs = makeFs({});
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBeNull();
  });

  it('returns raw SHA when HEAD is a detached commit', async () => {
    const fs = makeFs({
      [`${root}/.git/HEAD`]: `${VALID_SHA}\n`,
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBe(VALID_SHA);
  });

  it('resolves ref pointer and returns branch SHA', async () => {
    const fs = makeFs({
      [`${root}/.git/HEAD`]: 'ref: refs/heads/main\n',
      [`${root}/.git/refs/heads/main`]: `${VALID_SHA}\n`,
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBe(VALID_SHA);
  });

  it('returns null when HEAD contains ref but ref file is missing', async () => {
    const fs = makeFs({
      [`${root}/.git/HEAD`]: 'ref: refs/heads/feature/does-not-exist\n',
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBeNull();
  });

  it('returns null when HEAD content is malformed (not SHA, not ref)', async () => {
    const fs = makeFs({
      [`${root}/.git/HEAD`]: 'not-a-valid-sha-or-ref\n',
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBeNull();
  });

  it('returns null when ref file contains malformed content', async () => {
    const fs = makeFs({
      [`${root}/.git/HEAD`]: 'ref: refs/heads/main\n',
      [`${root}/.git/refs/heads/main`]: 'not-a-sha\n',
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBeNull();
  });

  it('handles packed-refs gracefully (ref file missing — returns null)', async () => {
    // packed-refs is not supported in this helper; absence of the ref file
    // signals a lookup failure, so null is the correct safe return value.
    const fs = makeFs({
      [`${root}/.git/HEAD`]: 'ref: refs/heads/packed-branch\n',
    });
    const result = await deriveGitHeadSha(root, fs);
    expect(result).toBeNull();
  });
});
