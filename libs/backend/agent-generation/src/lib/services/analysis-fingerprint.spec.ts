import { join, resolve } from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { computeWorkspaceFingerprint, isRootGitignored, parseRootGitignore } from './analysis-fingerprint';

const ROOT = resolve('/workspace/project');

describe('computeWorkspaceFingerprint', () => {
  it('applies anchored, recursive, and negated root ignore rules in order', () => {
    const rules = parseRootGitignore('# comment\n/out-local/\n**/cache\n*.log\n!keep.log\n');
    expect(isRootGitignored('out-local', true, rules)).toBe(true);
    expect(isRootGitignored('nested/out-local', true, rules)).toBe(false);
    expect(isRootGitignored('nested/cache', true, rules)).toBe(true);
    expect(isRootGitignored('debug.log', false, rules)).toBe(true);
    expect(isRootGitignored('keep.log', false, rules)).toBe(false);
  });
  it('uses v2 directory names and LF-normalized metadata while ignoring local files', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(join(ROOT, 'package.json'), '{\r\n"name":"project"\r\n}');
    await fs.writeFile(join(ROOT, '.gitignore'), 'ignored/\nignored2\n');
    await fs.createDirectory(join(ROOT, 'src'));
    await fs.writeFile(join(ROOT, 'src', 'main.ts'), 'export {};');
    const original = await computeWorkspaceFingerprint(ROOT, fs);
    expect(original.algorithm).toBe('sha256-v2');
    await fs.writeFile(join(ROOT, 'package.json'), '{\n"name":"project"\n}');
    await fs.writeFile(join(ROOT, '.env'), 'secret');
    await fs.writeFile(join(ROOT, 'notes.txt'), 'notes');
    await fs.createDirectory(join(ROOT, '.idea'));
    await fs.createDirectory(join(ROOT, 'ignored'));
    await fs.createDirectory(join(ROOT, 'ignored2'));
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(original.digest);
    await fs.createDirectory(join(ROOT, 'src2'));
    await fs.writeFile(join(ROOT, 'src2', 'main.ts'), 'export {};');
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).not.toBe(original.digest);
  });

  it('matches a fresh clone despite ignored or empty local directories', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(join(ROOT, 'package.json'), '{}');
    await fs.writeFile(join(ROOT, '.gitignore'), '/tmp/\ndist/\nbuild*\nnode_modules/\n*.log\n');
    await fs.writeFile(join(ROOT, 'src', 'index.ts'), 'source');
    const cloneDigest = (await computeWorkspaceFingerprint(ROOT, fs)).digest;
    for (const name of ['tmp', 'dist', 'build-out', 'node_modules']) {
      await fs.writeFile(join(ROOT, name, 'cache.txt'), 'local');
    }
    await fs.createDirectory(join(ROOT, 'logs'));
    await fs.writeFile(join(ROOT, 'log-cache', 'debug.log'), 'ignored');
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(cloneDigest);
  });

  it('honors negation, comments, and escaped special characters', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(join(ROOT, '.gitignore'), '# comment\nbuild*\n!build-kept/\n\\#cache/\n\\!cache/\n');
    const original = (await computeWorkspaceFingerprint(ROOT, fs)).digest;
    await fs.writeFile(join(ROOT, 'build-out', 'x'), 'ignored');
    await fs.writeFile(join(ROOT, '#cache', 'x'), 'ignored');
    await fs.writeFile(join(ROOT, '!cache', 'x'), 'ignored');
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(original);
    await fs.writeFile(join(ROOT, 'build-kept', 'x'), 'tracked');
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).not.toBe(original);
  });

  it('can reproduce a v1 digest when requested', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(join(ROOT, 'package.json'), '{}');
    const original = await computeWorkspaceFingerprint(ROOT, fs, 'sha256-v1');
    await fs.writeFile(join(ROOT, 'notes.txt'), 'local');
    expect((await computeWorkspaceFingerprint(ROOT, fs, 'sha256-v1')).digest).not.toBe(original.digest);
  });
  it.each([
    '.claude',
    '.codex',
    '.github',
    '.cursor',
    '.opencode',
    '.agents',
    '.vscode',
  ])(
    'ignores generated %s output while detecting source changes',
    async (name) => {
      const fs = createMockFileSystemProvider();
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"project"}');
      const original = await computeWorkspaceFingerprint(ROOT, fs);

      await fs.createDirectory(join(ROOT, name, 'agents'));
      await fs.writeFile(join(ROOT, name, 'agents', 'generated.md'), 'agent');
      const afterOutput = await computeWorkspaceFingerprint(ROOT, fs);
      expect(afterOutput.digest).toBe(original.digest);

      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"changed"}');
      const afterSource = await computeWorkspaceFingerprint(ROOT, fs);
      expect(afterSource.digest).not.toBe(original.digest);
    },
  );

  it.each(['.gitignore', '.mcp.json', 'opencode.json'])(
    'ignores generated root file %s',
    async (name) => {
      const fs = createMockFileSystemProvider();
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"project"}');
      const original = await computeWorkspaceFingerprint(ROOT, fs);

      await fs.writeFile(join(ROOT, name), 'generated');
      expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(
        original.digest,
      );
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"changed"}');
      expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).not.toBe(
        original.digest,
      );
    },
  );
});
