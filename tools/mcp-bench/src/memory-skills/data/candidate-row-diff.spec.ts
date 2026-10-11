import { appendFileSync, existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  diffCandidateRows,
  runCandidateRowDiff,
  sha256File,
  withReadonlySnapshot,
  type CandidateRowDiff,
} from './candidate-row-diff';

interface WritableDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

function createSnapshot(
  path: string,
  names: { id: string; name: string; status: string }[],
): void {
  const Database = require('better-sqlite3') as new (
    file: string,
  ) => WritableDb;
  const db = new Database(path);
  db.exec(
    'CREATE TABLE skill_candidates (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body_path TEXT NOT NULL)',
  );
  const insert = db.prepare(
    'INSERT INTO skill_candidates (id, name, status, body_path) VALUES (?, ?, ?, ?)',
  );
  for (const row of names)
    insert.run(
      row.id,
      row.name,
      row.status,
      `C:\\home\\.ptah\\skills\\_candidates\\${row.name}\\SKILL.md`,
    );
  db.close();
}

describe('diffCandidateRows', () => {
  it('reports rows without dirs, dirs without rows and empty dirs', () => {
    const rows = [
      {
        id: '1',
        name: 'alpha',
        status: 'candidate',
        bodyPath: '/x/alpha/SKILL.md',
      },
      {
        id: '2',
        name: 'beta',
        status: 'promoted',
        bodyPath: '/x/beta/SKILL.md',
      },
      {
        id: '3',
        name: 'gamma',
        status: 'rejected',
        bodyPath: '/x/other/SKILL.md',
      },
      {
        id: '4',
        name: 'delta',
        status: 'candidate',
        bodyPath: '/x/delta/SKILL.md',
      },
    ];
    const dirs = new Map([
      ['alpha', true],
      ['gamma', true],
      ['delta', false],
      ['orphan', true],
    ]);
    const diff: CandidateRowDiff = diffCandidateRows(rows, dirs, {
      snapshotSha256: 'h',
      copyDir: '/c',
    });
    expect(diff.matched).toBe(2);
    expect(diff.rowsWithoutDir).toEqual([
      { id: '2', name: 'beta', status: 'promoted' },
    ]);
    expect(diff.rowsWithoutDirByStatus).toEqual({ promoted: 1 });
    expect(diff.dirsWithoutRow).toEqual(['orphan']);
    expect(diff.dirsWithoutSkillMd).toEqual(['delta']);
    expect(diff.bodyPathMismatches).toEqual([{ id: '3', name: 'gamma' }]);
  });
});

describe('runCandidateRowDiff', () => {
  let benchDataDir: string;
  beforeEach(async () => {
    benchDataDir = await mkdtemp(join(tmpdir(), 'ptah-620-rowdiff-'));
    const snapshots = join(benchDataDir, 'snapshots');
    await mkdir(join(snapshots, 'cands', 'alpha'), { recursive: true });
    await writeFile(join(snapshots, 'cands', 'alpha', 'SKILL.md'), 'a', 'utf8');
    await mkdir(join(snapshots, 'cands', 'orphan'));
    await writeFile(
      join(snapshots, 'cands', 'orphan', 'SKILL.md'),
      'o',
      'utf8',
    );
    createSnapshot(join(snapshots, 'snap.sqlite'), [
      { id: '1', name: 'alpha', status: 'candidate' },
      { id: '2', name: 'missing-body', status: 'rejected' },
    ]);
  });
  afterEach(async () => {
    await rm(benchDataDir, { recursive: true, force: true });
  });

  it('opens the snapshot read-only, leaves it unchanged and writes the report only under the bench dir', async () => {
    const snapshot = join(benchDataDir, 'snapshots', 'snap.sqlite');
    const before = await sha256File(snapshot);
    const { diff, reportPath } = await runCandidateRowDiff({
      benchDataDir,
      snapshotFile: 'snap.sqlite',
      candidatesName: 'cands',
      expectedSnapshotSha256: before,
    });
    expect(diff.snapshotSha256).toBe(before);
    expect(await sha256File(snapshot)).toBe(before);
    for (const suffix of ['-wal', '-shm', '-journal'])
      expect(existsSync(snapshot + suffix)).toBe(false);
    expect(diff.rowsWithoutDir.map((r) => r.name)).toEqual(['missing-body']);
    expect(diff.dirsWithoutRow).toEqual(['orphan']);
    expect(relative(benchDataDir, reportPath).startsWith('reports')).toBe(true);
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(diff);
    expect((await readdir(benchDataDir)).sort()).toEqual([
      'reports',
      'snapshots',
    ]);
  });

  it('refuses a snapshot whose hash is not the pinned value', async () => {
    await expect(
      runCandidateRowDiff({
        benchDataDir,
        snapshotFile: 'snap.sqlite',
        candidatesName: 'cands',
        expectedSnapshotSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow('not the frozen value');
  });

  it('fails when the snapshot changes while it is read', async () => {
    const snapshot = join(benchDataDir, 'snapshots', 'snap.sqlite');
    await expect(
      withReadonlySnapshot(snapshot, () => {
        // Simulates another writer touching the file during the read.
        appendFileSync(snapshot, 'x');
        return 0;
      }),
    ).rejects.toThrow('Snapshot changed while it was read');
  });

  it('never creates a missing snapshot', async () => {
    const missing = join(benchDataDir, 'snapshots', 'absent.sqlite');
    await expect(withReadonlySnapshot(missing, () => 0)).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
