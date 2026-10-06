import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSafeBenchDataDir,
  computeManifestSha256,
  sha256,
  verifyCandidateManifest,
} from './verify-candidate-manifest';

async function writeCopy(
  benchDataDir: string,
  files: Record<string, string>,
  tamper?: (m: Record<string, unknown>) => void,
): Promise<void> {
  const snapshots = join(benchDataDir, 'snapshots');
  const filesSha256: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    const path = join(snapshots, 'cands', ...rel.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
    filesSha256[rel] = sha256(content);
  }
  const manifest: Record<string, unknown> = {
    source: 'synthetic',
    dirs: new Set(Object.keys(files).map((p) => p.split('/')[0])).size,
    files: Object.keys(files).length,
    manifestSha256: computeManifestSha256(filesSha256),
    files_sha256: filesSha256,
  };
  tamper?.(manifest);
  await writeFile(
    join(snapshots, 'cands.manifest.json'),
    JSON.stringify(manifest, null, 1),
    'utf8',
  );
}

describe('computeManifestSha256', () => {
  it('hashes Python json.dumps(sort_keys=True) of the file map', () => {
    // Python: hashlib.sha256(json.dumps({"b/SKILL.md": "2", "a/SKILL.md": "1"}, sort_keys=True).encode()).hexdigest()
    expect(
      computeManifestSha256({ 'b/SKILL.md': '2', 'a/SKILL.md': '1' }),
    ).toBe(sha256('{"a/SKILL.md": "1", "b/SKILL.md": "2"}'));
  });

  it('escapes non-ASCII as Python does', () => {
    expect(computeManifestSha256({ 'é/SKILL.md': 'x' })).toBe(
      sha256('{"\\u00e9/SKILL.md": "x"}'),
    );
  });
});

describe('verifyCandidateManifest', () => {
  let benchDataDir: string;
  beforeEach(async () => {
    benchDataDir = await mkdtemp(join(tmpdir(), 'ptah-620-manifest-'));
  });
  afterEach(async () => {
    await rm(benchDataDir, { recursive: true, force: true });
  });

  it('verifies every file and the manifest hash of an intact copy', async () => {
    await writeCopy(benchDataDir, {
      'alpha-skill/SKILL.md': 'a',
      'beta-skill/SKILL.md': 'b',
    });
    const report = await verifyCandidateManifest({
      benchDataDir,
      snapshotName: 'cands',
      expectedManifestSha256: null,
    });
    expect(report.ok).toBe(true);
    expect(report.filesVerified).toBe(2);
    expect(report.manifestHashOk).toBe(true);
  });

  it('reports missing, extra and changed files', async () => {
    await writeCopy(benchDataDir, {
      'alpha-skill/SKILL.md': 'a',
      'beta-skill/SKILL.md': 'b',
      'gamma-skill/SKILL.md': 'c',
    });
    const copy = join(benchDataDir, 'snapshots', 'cands');
    await rm(join(copy, 'gamma-skill'), { recursive: true });
    await writeFile(join(copy, 'beta-skill', 'SKILL.md'), 'changed', 'utf8');
    await mkdir(join(copy, 'delta-skill'));
    await writeFile(join(copy, 'delta-skill', 'SKILL.md'), 'd', 'utf8');
    const report = await verifyCandidateManifest({
      benchDataDir,
      snapshotName: 'cands',
      expectedManifestSha256: null,
    });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['gamma-skill/SKILL.md']);
    expect(report.extra).toEqual(['delta-skill/SKILL.md']);
    expect(report.changed.map((c) => c.relPath)).toEqual([
      'beta-skill/SKILL.md',
    ]);
    expect(report.filesVerified).toBe(1);
  });

  it('fails when the declared manifest hash does not match its file map or the frozen pin', async () => {
    await writeCopy(benchDataDir, { 'alpha-skill/SKILL.md': 'a' }, (m) => {
      m['manifestSha256'] = '0'.repeat(64);
    });
    const report = await verifyCandidateManifest({
      benchDataDir,
      snapshotName: 'cands',
      expectedManifestSha256: 'f'.repeat(64),
    });
    expect(report.ok).toBe(false);
    expect(report.manifestHashOk).toBe(false);
    expect(report.problems.join(' ')).toContain('manifestSha256 mismatch');
    expect(report.problems.join(' ')).toContain('not the frozen value');
  });

  it('rejects a manifest that does not match the freeze format', async () => {
    await mkdir(join(benchDataDir, 'snapshots', 'cands'), { recursive: true });
    await writeFile(
      join(benchDataDir, 'snapshots', 'cands.manifest.json'),
      '{"files": 1}',
      'utf8',
    );
    await expect(
      verifyCandidateManifest({ benchDataDir, snapshotName: 'cands' }),
    ).rejects.toThrow();
  });
});

describe('assertSafeBenchDataDir', () => {
  it('refuses ~/.ptah and anything under it, case-folded on Windows', () => {
    const home = join(tmpdir(), 'ptah-620-fake-home');
    const guard = { homeDir: home, repoRoot: null };
    expect(() => assertSafeBenchDataDir(join(home, '.ptah'), guard)).toThrow(
      'real ~/.ptah',
    );
    expect(() =>
      assertSafeBenchDataDir(join(home, '.ptah', 'bench-snapshots'), guard),
    ).toThrow('real ~/.ptah');
    if (process.platform === 'win32') {
      expect(() =>
        assertSafeBenchDataDir(join(home, '.PTAH', 'x'), guard),
      ).toThrow('real ~/.ptah');
    }
    expect(assertSafeBenchDataDir(join(home, '.ptah-bench'), guard)).toContain(
      '.ptah-bench',
    );
  });

  it('defaults to the user home', () => {
    expect(() =>
      assertSafeBenchDataDir(join(homedir(), '.ptah', 'x'), { repoRoot: null }),
    ).toThrow('real ~/.ptah');
  });

  it('refuses a dir inside the repository', () => {
    expect(() =>
      assertSafeBenchDataDir(join(process.cwd(), 'tmp-bench'), {
        repoRoot: process.cwd(),
      }),
    ).toThrow('inside the repository');
  });

  it('refuses relative and empty paths and accepts a temp dir', () => {
    expect(() => assertSafeBenchDataDir('relative/bench')).toThrow('absolute');
    expect(() => assertSafeBenchDataDir(' ')).toThrow('empty');
    expect(
      assertSafeBenchDataDir(join(tmpdir(), 'ptah-620-ok'), { repoRoot: null }),
    ).toContain('ptah-620-ok');
  });
});
