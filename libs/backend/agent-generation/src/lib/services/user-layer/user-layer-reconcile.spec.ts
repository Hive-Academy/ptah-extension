import 'reflect-metadata';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  readdir,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

import { UserLayerMirrorService } from './user-layer-mirror.service';
import {
  ORIGIN_SIDECAR_FILENAME,
  DEFAULT_HISTORY_DIR,
} from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';
import { computeSourceHash } from './source-hash';

interface MockLogger {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
}

function makeLogger(): MockLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSidecarDir(dir: string): Promise<OriginSidecar> {
  const raw = await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8');
  return JSON.parse(raw) as OriginSidecar;
}

async function readSidecarFile(path: string): Promise<OriginSidecar> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as OriginSidecar;
}

describe('source-hash .history skip', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-hash-'));
  });
  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('hash is stable after a .history snapshot dir is added', async () => {
    const dir = join(workRoot, 'skill');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), '# body', 'utf8');

    const before = await computeSourceHash(dir);

    const histDir = join(dir, DEFAULT_HISTORY_DIR, '12345');
    await mkdir(histDir, { recursive: true });
    await writeFile(join(histDir, 'SKILL.md'), '# old snapshot', 'utf8');

    const after = await computeSourceHash(dir);
    expect(after).toBe(before);
  });
});

describe('UserLayerMirrorService.reconcile', () => {
  let workRoot: string;
  let pluginRoot: string;
  let synthRoot: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-recon-'));
    fakeHome = join(workRoot, 'home');
    pluginRoot = join(workRoot, 'plugins');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    await mkdir(fakeHome, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  async function seedPluginSkill(
    pluginId: string,
    slug: string,
    body: string,
  ): Promise<string> {
    const dir = join(pluginRoot, pluginId, 'skills', slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
    return join(pluginRoot, pluginId);
  }

  async function writeSourceSkill(
    pluginPath: string,
    slug: string,
    body: string,
  ): Promise<void> {
    await writeFile(join(pluginPath, 'skills', slug, 'SKILL.md'), body, 'utf8');
  }

  it('Case A: source unchanged → no-op', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.noop).toBe(1);
    expect(res.fastForwarded).toBe(0);
    expect(res.diverged).toBe(0);
  });

  it('Case B: source changed, clone untouched → fast-forward + snapshot first', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    await writeSourceSkill(pluginPath, 'dr', '# v2 upstream');

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.fastForwarded).toBe(1);
    expect(res.diverged).toBe(0);

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    const body = await readFile(join(cloneDir, 'SKILL.md'), 'utf8');
    expect(body).toBe('# v2 upstream');

    const histRoot = join(cloneDir, DEFAULT_HISTORY_DIR);
    const snaps = await readdir(histRoot);
    expect(snaps.length).toBe(1);
    const snapBody = await readFile(
      join(histRoot, snaps[0], 'SKILL.md'),
      'utf8',
    );
    expect(snapBody).toBe('# v1');

    const sidecar = await readSidecarDir(cloneDir);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();
    expect(sidecar.currentContentHash).toBe(sidecar.sourceHash);
  });

  it('Case B snapshot is taken BEFORE overwrite (snapshot has the OLD content)', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# OLD');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    await writeSourceSkill(pluginPath, 'dr', '# NEW');

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    const cloneFile = join(cloneDir, 'SKILL.md');

    const realCopyTree = (
      service as unknown as {
        copyTree: (s: string, t: string) => Promise<void>;
      }
    ).copyTree.bind(service);
    let snapshotContentAtOverwrite: string | null = null;
    (
      service as unknown as {
        copyTree: (s: string, t: string) => Promise<void>;
      }
    ).copyTree = async (src: string, dst: string) => {
      const histRoot = join(cloneDir, DEFAULT_HISTORY_DIR);
      const snaps = await readdir(histRoot);
      snapshotContentAtOverwrite = await readFile(
        join(histRoot, snaps[0], 'SKILL.md'),
        'utf8',
      );
      return realCopyTree(src, dst);
    };

    await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(snapshotContentAtOverwrite).toBe('# OLD');
    expect(await readFile(cloneFile, 'utf8')).toBe('# NEW');
  });

  it('Case C: source changed AND clone edited → diverged, clone untouched', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.skills, 'dr', 'SKILL.md');
    await writeFile(cloneFile, '# user edited', 'utf8');

    await writeSourceSkill(pluginPath, 'dr', '# v2 upstream');

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(res.diverged).toBe(1);
    expect(res.fastForwarded).toBe(0);
    expect(await readFile(cloneFile, 'utf8')).toBe('# user edited');

    const sidecar = await readSidecarDir(join(roots.skills, 'dr'));
    expect(sidecar.diverged).toBe(true);
    expect(sidecar.pendingSourceHash).toMatch(/^sha256:/);

    expect(res.divergedSlugs).toEqual([
      {
        kind: 'skill',
        slug: 'dr',
        pendingSourceHash: sidecar.pendingSourceHash,
      },
    ]);

    const histRoot = join(roots.skills, 'dr', DEFAULT_HISTORY_DIR);
    expect(await fileExists(histRoot)).toBe(false);
  });

  it('Case B fast-forward removes upstream-deleted orphan files (true replace, no phantom divergence)', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await writeFile(
      join(pluginPath, 'skills', 'dr', 'EXTRA.md'),
      '# extra v1',
      'utf8',
    );
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    expect(await fileExists(join(cloneDir, 'EXTRA.md'))).toBe(true);

    await rm(join(pluginPath, 'skills', 'dr', 'EXTRA.md'), { force: true });
    await writeSourceSkill(pluginPath, 'dr', '# v2 upstream');

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.fastForwarded).toBe(1);
    expect(res.diverged).toBe(0);

    expect(await fileExists(join(cloneDir, 'EXTRA.md'))).toBe(false);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# v2 upstream',
    );

    const cloneHash = await computeSourceHash(cloneDir);
    const sourceHash = await computeSourceHash(
      join(pluginPath, 'skills', 'dr'),
    );
    expect(cloneHash).toBe(sourceHash);

    const histRoot = join(cloneDir, DEFAULT_HISTORY_DIR);
    const snaps = await readdir(histRoot);
    expect(snaps.length).toBe(1);
    expect(await fileExists(join(histRoot, snaps[0], 'EXTRA.md'))).toBe(true);
    expect(await readFile(join(histRoot, snaps[0], 'EXTRA.md'), 'utf8')).toBe(
      '# extra v1',
    );

    const res2 = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res2.noop).toBe(1);
    expect(res2.diverged).toBe(0);
    expect(res2.fastForwarded).toBe(0);
  });

  it('makeUniqueHistoryDir produces distinct dirs for same ts (collision-safe)', async () => {
    const roots = service.getUserLayerRoots();
    const parent = join(roots.skills, 'collide', DEFAULT_HISTORY_DIR);
    const make = (
      service as unknown as {
        makeUniqueHistoryDir: (p: string, ts: string) => Promise<string>;
      }
    ).makeUniqueHistoryDir.bind(service);

    const first = await make(parent, '99999');
    const second = await make(parent, '99999');

    expect(first).not.toBe(second);
    expect(await fileExists(first)).toBe(true);
    expect(await fileExists(second)).toBe(true);
    const dirs = await readdir(parent);
    expect(dirs.length).toBe(2);
  });

  it('missing sidecar → re-seeds, counts missingSidecar, never overwrites', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    await rm(join(cloneDir, ORIGIN_SIDECAR_FILENAME), { force: true });
    await writeFile(join(cloneDir, 'SKILL.md'), '# user content', 'utf8');

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(res.missingSidecar).toBe(1);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# user content',
    );
    expect(await fileExists(join(cloneDir, ORIGIN_SIDECAR_FILENAME))).toBe(
      true,
    );
  });

  it('clone absent → skips (nothing to reconcile)', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.noop).toBe(0);
    expect(res.fastForwarded).toBe(0);
    expect(res.diverged).toBe(0);
    expect(res.missingSidecar).toBe(0);
  });

  it('reconciles flat command clones (Case B fast-forward)', async () => {
    const pluginPath = join(pluginRoot, 'p');
    await mkdir(join(pluginPath, 'commands'), { recursive: true });
    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review v1',
      'utf8',
    );
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review v2',
      'utf8',
    );

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.fastForwarded).toBe(1);

    const roots = service.getUserLayerRoots();
    expect(await readFile(join(roots.commands, 'review.md'), 'utf8')).toBe(
      '# review v2',
    );
    const histRoot = join(roots.commands, DEFAULT_HISTORY_DIR, 'review');
    const snaps = await readdir(histRoot);
    expect(snaps.length).toBe(1);
  });

  it('flat command Case C diverged keeps the clone', async () => {
    const pluginPath = join(pluginRoot, 'p');
    await mkdir(join(pluginPath, 'commands'), { recursive: true });
    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review v1',
      'utf8',
    );
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.commands, 'review.md');
    await writeFile(cloneFile, '# user review', 'utf8');
    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review v2',
      'utf8',
    );

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(res.diverged).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# user review');

    const sidecar = await readSidecarFile(
      join(roots.commands, 'review.ptah-origin.json'),
    );
    expect(sidecar.diverged).toBe(true);
    expect(sidecar.pendingSourceHash).toMatch(/^sha256:/);
  });

  it('reconcile never writes under ~/.ptah/plugins/', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    await writeSourceSkill(pluginPath, 'dr', '# v2');

    await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const pluginsBase = join(fakeHome, '.ptah', 'plugins');
    expect(await fileExists(pluginsBase)).toBe(false);
  });

  it('withSlugLock serializes concurrent same-slug operations', async () => {
    const order: string[] = [];
    const lock = (
      service as unknown as {
        withSlugLock: (
          kind: string,
          slug: string,
          fn: () => Promise<void>,
        ) => Promise<void>;
      }
    ).withSlugLock.bind(service);

    const a = lock('skill', 'x', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
    });
    const b = lock('skill', 'x', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('withSlugLock allows different slugs to overlap', async () => {
    const order: string[] = [];
    const lock = (
      service as unknown as {
        withSlugLock: (
          kind: string,
          slug: string,
          fn: () => Promise<void>,
        ) => Promise<void>;
      }
    ).withSlugLock.bind(service);

    const a = lock('skill', 'x', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
    });
    const b = lock('skill', 'y', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order[0]).toBe('a-start');
    expect(order).toContain('b-end');
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });
});
