import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeManifestSha256,
  resolveEntryBenchDataDir,
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

describe('verifyCandidateManifest copy walk', () => {
  let benchDataDir: string;
  beforeEach(async () => {
    benchDataDir = await mkdtemp(join(tmpdir(), 'ptah-620-walk-'));
  });
  afterEach(async () => {
    await rm(benchDataDir, { recursive: true, force: true });
  });

  it('reports an empty dir as a problem and counts it as a top-level dir', async () => {
    await writeCopy(benchDataDir, { 'alpha-skill/SKILL.md': 'a' });
    await mkdir(
      join(benchDataDir, 'snapshots', 'cands', 'hollow-skill', 'references'),
      {
        recursive: true,
      },
    );
    const report = await verifyCandidateManifest({
      benchDataDir,
      snapshotName: 'cands',
      expectedManifestSha256: null,
    });
    expect(report.ok).toBe(false);
    expect(report.dirsOnDisk).toBe(2);
    expect(report.emptyDirs).toEqual([
      'hollow-skill',
      'hollow-skill/references',
    ]);
    expect(report.problems.join(' ')).toContain('hold no file');
    expect(report.filesVerified).toBe(1);
  });

  it('reports a link or junction instead of aborting or following it', async () => {
    await writeCopy(benchDataDir, { 'alpha-skill/SKILL.md': 'a' });
    const outside = join(benchDataDir, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'SKILL.md'), 'x', 'utf8');
    await symlink(
      outside,
      join(benchDataDir, 'snapshots', 'cands', 'linked-skill'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const report = await verifyCandidateManifest({
      benchDataDir,
      snapshotName: 'cands',
      expectedManifestSha256: null,
    });
    expect(report.ok).toBe(false);
    expect(report.nonRegular).toEqual(['linked-skill']);
    expect(report.extra).toEqual([]);
    expect(report.problems.join(' ')).toContain('non-regular');
  });
});

describe('bench data dir rules (619 resolveBenchDataDir)', () => {
  it('refuses a dir under the real ~/.ptah', async () => {
    const home = join(tmpdir(), 'ptah-620-fake-home');
    await expect(
      verifyCandidateManifest({
        benchDataDir: join(home, '.ptah', 'bench'),
        benchDataRules: { realHome: home },
      }),
    ).rejects.toThrow('real Ptah state directory');
  });

  it('refuses a dir inside the repository root it is given', async () => {
    const repo = join(tmpdir(), 'ptah-620-fake-repo');
    await expect(
      verifyCandidateManifest({
        benchDataDir: join(repo, 'bench'),
        benchDataRules: { repoRoot: repo },
      }),
    ).rejects.toThrow('inside it');
  });

  it('refuses a relative dir', async () => {
    await expect(
      verifyCandidateManifest({ benchDataDir: 'relative/bench' }),
    ).rejects.toThrow('absolute');
  });

  it('defaults to resolveBenchDataDir() and lets an explicit dir win', () => {
    const fromEnv = join(tmpdir(), 'ptah-620-env-bench');
    const explicit = join(tmpdir(), 'ptah-620-explicit-bench');
    const rules = {
      env: { PTAH_MCP_BENCH_DATA_DIR: fromEnv },
      repoRoot: join(tmpdir(), 'ptah-620-fake-repo'),
      realHome: join(tmpdir(), 'ptah-620-fake-home'),
    };
    expect(resolveEntryBenchDataDir(undefined, rules)).toBe(fromEnv);
    expect(resolveEntryBenchDataDir(explicit, rules)).toBe(explicit);
  });

  it('applies the default rules when no dir is given (refuses the real ~/.ptah)', async () => {
    const home = join(tmpdir(), 'ptah-620-fake-home');
    await expect(
      verifyCandidateManifest({
        benchDataRules: {
          env: { PTAH_MCP_BENCH_DATA_DIR: join(home, '.ptah', 'bench') },
          realHome: home,
        },
      }),
    ).rejects.toThrow('real Ptah state directory');
  });
});
