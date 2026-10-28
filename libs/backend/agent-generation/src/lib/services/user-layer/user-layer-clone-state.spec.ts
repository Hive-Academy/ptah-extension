import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readCloneEditStateIn } from './user-layer-clone-state';
import { computeSourceHash } from './source-hash';
import type { OriginSidecar, UserLayerRoots } from './origin-sidecar.types';
import { ORIGIN_SIDECAR_FILENAME } from './origin-sidecar.types';

/** TASK_2026_701 B10 — the read API for one clone's edit state (A21 digest). */

describe('readCloneEditStateIn', () => {
  let root: string;
  let roots: UserLayerRoots;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ptah-clone-state-'));
    roots = {
      skills: join(root, 'skills'),
      agents: join(root, 'agents', 'ws-key'),
      commands: join(root, 'commands'),
    };
  });

  afterEach(async () => {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort; cleanup never decides a test.
    }
  });

  function sidecar(over: Partial<OriginSidecar>): OriginSidecar {
    return {
      kind: 'agent',
      slug: 'reviewer',
      pluginId: 'ptah-core',
      version: null,
      sourceHash: 'sha256:none',
      clonedAt: 1,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: '.history',
      ...over,
    };
  }

  async function seedFileClone(
    rootDir: string,
    slug: string,
    body: string,
    over: Partial<OriginSidecar> = {},
  ): Promise<string> {
    await mkdir(rootDir, { recursive: true });
    const bodyPath = join(rootDir, `${slug}.md`);
    await writeFile(bodyPath, body, 'utf8');
    const sourceHash = await computeSourceHash(bodyPath);
    await writeFile(
      join(rootDir, `${slug}.ptah-origin.json`),
      JSON.stringify(sidecar({ slug, sourceHash, ...over })),
      'utf8',
    );
    return sourceHash;
  }

  it('an untouched agent clone is not edited and reports its live digest', async () => {
    const hash = await seedFileClone(roots.agents, 'reviewer', '# v1', {
      sourceRef: 'ptah:ptah-core',
      sourceLabel: 'Ptah Core',
    });

    await expect(
      readCloneEditStateIn(roots, 'agent', 'reviewer'),
    ).resolves.toEqual({
      exists: true,
      edited: false,
      pluginId: 'ptah-core',
      sourceRef: 'ptah:ptah-core',
      sourceLabel: 'Ptah Core',
      contentDigest: hash,
    });
  });

  it('a hand edit is edited even though currentContentHash was never updated', async () => {
    const hash = await seedFileClone(roots.commands, 'review', '# v1', {
      kind: 'command',
      currentContentHash: 'sha256:stale',
    });
    await writeFile(join(roots.commands, 'review.md'), '# mine', 'utf8');

    const state = await readCloneEditStateIn(roots, 'command', 'review');

    expect(state?.edited).toBe(true);
    expect(state?.contentDigest).not.toBe(hash);
    expect(state?.contentDigest).toBe(
      await computeSourceHash(join(roots.commands, 'review.md')),
    );
  });

  it('the digest changes on every edit (A → B is visible)', async () => {
    await seedFileClone(roots.agents, 'reviewer', '# v1');
    await writeFile(join(roots.agents, 'reviewer.md'), '# edit A', 'utf8');
    const a = await readCloneEditStateIn(roots, 'agent', 'reviewer');
    await writeFile(join(roots.agents, 'reviewer.md'), '# edit B', 'utf8');
    const b = await readCloneEditStateIn(roots, 'agent', 'reviewer');

    expect(a?.edited).toBe(true);
    expect(b?.edited).toBe(true);
    expect(a?.contentDigest).not.toBe(b?.contentDigest);
  });

  it('reads a skill directory clone, ignoring its sidecar and history', async () => {
    const cloneDir = join(roots.skills, 'deep-research');
    await mkdir(join(cloneDir, '.history', '1'), { recursive: true });
    await writeFile(join(cloneDir, 'SKILL.md'), '# skill', 'utf8');
    await writeFile(join(cloneDir, '.history', '1', 'SKILL.md'), '# old', 'utf8');
    const sourceHash = await computeSourceHash(cloneDir);
    await writeFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify(
        sidecar({ kind: 'skill', slug: 'deep-research', sourceHash }),
      ),
      'utf8',
    );

    await expect(
      readCloneEditStateIn(roots, 'skill', 'deep-research'),
    ).resolves.toMatchObject({ exists: true, edited: false, contentDigest: sourceHash });

    await writeFile(join(cloneDir, 'notes.md'), 'extra', 'utf8');
    await expect(
      readCloneEditStateIn(roots, 'skill', 'deep-research'),
    ).resolves.toMatchObject({ edited: true });
  });

  it('a sidecar whose body is gone reports exists: false with no digest', async () => {
    await seedFileClone(roots.agents, 'reviewer', '# v1');
    await rm(join(roots.agents, 'reviewer.md'));

    await expect(
      readCloneEditStateIn(roots, 'agent', 'reviewer'),
    ).resolves.toEqual({
      exists: false,
      edited: false,
      pluginId: 'ptah-core',
      contentDigest: null,
    });
  });

  it('returns null for a user-authored file with no sidecar', async () => {
    await mkdir(roots.agents, { recursive: true });
    await writeFile(join(roots.agents, 'mine.md'), '# mine', 'utf8');

    await expect(readCloneEditStateIn(roots, 'agent', 'mine')).resolves.toBeNull();
  });

  it('returns null for a malformed sidecar or one of another kind', async () => {
    await mkdir(roots.agents, { recursive: true });
    await writeFile(join(roots.agents, 'bad.md'), '# x', 'utf8');
    await writeFile(join(roots.agents, 'bad.ptah-origin.json'), '{not json', 'utf8');
    await seedFileClone(roots.agents, 'other', '# x', { kind: 'command' });

    await expect(readCloneEditStateIn(roots, 'agent', 'bad')).resolves.toBeNull();
    await expect(readCloneEditStateIn(roots, 'agent', 'other')).resolves.toBeNull();
  });

  it.each(['../escape', 'a/b', '..', '', '.hidden'])(
    'returns null for the unsafe slug %p without touching disk',
    async (slug) => {
      await expect(readCloneEditStateIn(roots, 'agent', slug)).resolves.toBeNull();
    },
  );
});
