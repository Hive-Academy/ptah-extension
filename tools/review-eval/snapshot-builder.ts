import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { type FixturePr } from './fixture-manifest.schema';

export interface SnapshotGit { run(cwd: string, args: readonly string[]): Promise<string>; }
export interface SnapshotFs {
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}
export interface SnapshotIdentity { head: string; snapshotSha256: string; reachableCommitsSha256: string; }

function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function lines(value: string): string[] { return value.trim().split(/\r?\n/).filter(Boolean); }

/** Build from a local repository only; no origin ref, tag, alternate or post-head object is imported. */
export async function buildSnapshot(pr: FixturePr, sourceRepo: string, destination: string, git: SnapshotGit, fs: SnapshotFs): Promise<SnapshotIdentity> {
  if (pr.head.status !== 'ready') throw new Error('Pre-fix head is pending');
  if (!isAbsolute(sourceRepo) || !isAbsolute(destination)) throw new Error('Snapshot paths must be absolute');
  if (resolve(sourceRepo) === resolve(destination) || await fs.exists(destination)) throw new Error('Snapshot destination must be fresh');
  const head = pr.head.value;
  const sourceType = (await git.run(sourceRepo, ['cat-file', '-t', head])).trim();
  if (sourceType !== 'commit') throw new Error('Pre-fix head must name a commit');
  await fs.mkdir(destination);
  await git.run(destination, ['init', '--bare']);
  await git.run(destination, ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', sourceRepo, head]);
  const importedType = (await git.run(destination, ['cat-file', '-t', head])).trim();
  if (importedType !== 'commit') throw new Error('Imported head is not a commit');
  await git.run(destination, ['update-ref', 'refs/heads/replay', head]);
  const refs = lines(await git.run(destination, ['for-each-ref', '--format=%(refname) %(objectname)']));
  if (refs.length !== 1 || refs[0] !== `refs/heads/replay ${head}`) throw new Error('Snapshot contains an unexpected ref');
  if (lines(await git.run(destination, ['remote'])).length) throw new Error('Snapshot contains a remote');
  if (await fs.exists(resolve(destination, 'objects/info/alternates'))) throw new Error('Snapshot contains alternates');
  const reachable = lines(await git.run(destination, ['rev-list', '--all'])).sort();
  const expected = lines(await git.run(sourceRepo, ['rev-list', head])).sort();
  if (reachable.join('\n') !== expected.join('\n')) throw new Error('Snapshot reachability differs from pre-fix head');
  const fsck = await git.run(destination, ['fsck', '--full', '--no-reflogs', '--unreachable']);
  if (fsck.trim()) throw new Error('Snapshot contains unreachable or invalid objects');
  const objectList = lines(await git.run(destination, ['rev-list', '--objects', '--all'])).sort();
  const sourceObjects = lines(await git.run(sourceRepo, ['rev-list', '--objects', head])).sort();
  if (objectList.join('\n') !== sourceObjects.join('\n')) throw new Error('Snapshot object set differs from pre-fix head');
  // A deterministic bundle is the portable snapshot artifact. Its only advertised ref is replay.
  const bundle = resolve(destination, '..', `pr-${pr.number}-${head}.bundle`);
  if (await fs.exists(bundle)) throw new Error('Snapshot bundle already exists');
  await git.run(destination, ['bundle', 'create', bundle, 'refs/heads/replay']);
  const bytes = await fs.read(bundle);
  return { head, snapshotSha256: hash(bytes), reachableCommitsSha256: hash(reachable.join('\n') + '\n') };
}
