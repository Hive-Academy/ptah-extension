import { appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  ARCHIVE_TABLES,
  diffCandidateRows,
  runCandidateRowDiff,
  sha256File,
  type CandidateRowDiff,
} from './candidate-row-diff';

async function createArchive(
  directory: string,
  names: { id: string; name: string; status: string }[],
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const contents = names.map((row) => JSON.stringify({
    ...row, body_path: `C:\\home\\.ptah\\skills\\_candidates\\${row.name}\\SKILL.md`,
  })).join('\n') + '\n';
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await writeFile(join(directory, 'skill_candidates.jsonl'), contents);
  await writeFile(join(directory, 'receipt.json'), JSON.stringify({
    archivePath: directory,
    tables: ARCHIVE_TABLES.map((table) => table === 'skill_candidates'
      ? { table, present: true, file: 'skill_candidates.jsonl', rows: names.length, sha256 }
      : { table, present: false, file: null, rows: 0, sha256: null }),
  }));
  return sha256;
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
      archiveSha256: 'h',
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
    await createArchive(join(snapshots, 'pre-0057'), [
      { id: '1', name: 'alpha', status: 'candidate' },
      { id: '2', name: 'missing-body', status: 'rejected' },
    ]);
  });
  afterEach(async () => {
    await rm(benchDataDir, { recursive: true, force: true });
  });

  it('reads the verified archive and writes the report only under the bench dir', async () => {
    const archived = join(benchDataDir, 'snapshots', 'pre-0057', 'skill_candidates.jsonl');
    const before = await sha256File(archived);
    const { diff, reportPath } = await runCandidateRowDiff({
      benchDataDir,
      candidatesName: 'cands',
      expectedArchiveSha256: before,
    });
    expect(diff.archiveSha256).toBe(before);
    expect(await sha256File(archived)).toBe(before);
    expect(diff.rowsWithoutDir.map((r) => r.name)).toEqual(['missing-body']);
    expect(diff.dirsWithoutRow).toEqual(['orphan']);
    expect(relative(benchDataDir, reportPath).startsWith('reports')).toBe(true);
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(diff);
    expect((await readdir(benchDataDir)).sort()).toEqual([
      'reports',
      'snapshots',
    ]);
  });

  it('refuses an archive whose hash is not the pinned value', async () => {
    await expect(
      runCandidateRowDiff({
        benchDataDir,
        candidatesName: 'cands',
        expectedArchiveSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow('not the pinned value');
  });

  it('fails when the archive contents change after receipt creation', async () => {
    const archived = join(benchDataDir, 'snapshots', 'pre-0057', 'skill_candidates.jsonl');
    await expect(
      (async () => {
        appendFileSync(archived, '{}\n');
        await runCandidateRowDiff({ benchDataDir, candidatesName: 'cands' });
      })(),
    ).rejects.toThrow('Archive verification failed');
  });

  it('never creates a missing archive', async () => {
    const missing = join(benchDataDir, 'snapshots', 'absent', 'receipt.json');
    await expect(runCandidateRowDiff({ benchDataDir, candidatesName: 'cands', archiveReceiptFile: 'absent/receipt.json' })).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
