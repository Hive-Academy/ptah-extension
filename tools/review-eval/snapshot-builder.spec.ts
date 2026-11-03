import { resolve } from 'node:path';
import manifest from './fixture-manifest.json';
import { parseFixtureManifest } from './fixture-manifest.schema';
import { buildSnapshot, type SnapshotGit, type SnapshotFs } from './snapshot-builder';

const head = 'a'.repeat(40);
const source = { url: 'https://api.github.com/repos/Hive-Academy/PtahCode/pulls/730', fetchedAt: '2026-11-03T00:00:00.000Z', sha256: 'b'.repeat(64) };
const pr = parseFixtureManifest(manifest).prs[0];

it('rejects pending heads before invoking git', async () => {
  const git: SnapshotGit = { run: jest.fn() };
  const fs: SnapshotFs = { mkdir: jest.fn(), read: jest.fn(), exists: jest.fn() };
  await expect(buildSnapshot(pr, '/repo', '/snapshot', git, fs)).rejects.toThrow('pending');
  expect(git.run).not.toHaveBeenCalled();
});

it('rejects unexpected refs in an imported snapshot', async () => {
  const readyPr = { ...pr, head: { status: 'ready' as const, value: head, source } };
  const git: SnapshotGit = { run: jest.fn(async (_cwd, args) => {
    if (args[0] === 'cat-file') return 'commit';
    if (args[0] === 'for-each-ref') return `refs/heads/replay ${head}\nrefs/tags/later ${'c'.repeat(40)}`;
    return '';
  }) };
  const fs: SnapshotFs = { mkdir: jest.fn(), read: jest.fn(), exists: jest.fn(async () => false) };
  await expect(buildSnapshot(readyPr, '/repo', '/snapshot', git, fs)).rejects.toThrow('unexpected ref');
});

it('creates one bounded bundle and hashes its reachable commits', async () => {
  const readyPr = { ...pr, head: { status: 'ready' as const, value: head, source } };
  const git: SnapshotGit = { run: jest.fn(async (_cwd, args) => {
    if (args[0] === 'cat-file') return 'commit';
    if (args[0] === 'for-each-ref') return `refs/heads/replay ${head}`;
    if (args[0] === 'rev-list') return args.includes('--objects') ? `${head} path` : head;
    return '';
  }) };
  const fs: SnapshotFs = { mkdir: jest.fn(), read: jest.fn(async () => new Uint8Array([1, 2, 3])), exists: jest.fn(async () => false) };
  const identity = await buildSnapshot(readyPr, '/repo', '/snapshot', git, fs);
  expect(identity.head).toBe(head);
  expect(identity.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(git.run).toHaveBeenCalledWith('/snapshot', ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '/repo', head]);
  expect(git.run).toHaveBeenCalledWith('/snapshot', ['bundle', 'create', resolve('/snapshot', '..', `pr-730-${head}.bundle`), 'refs/heads/replay']);
});
