import 'reflect-metadata';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
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
import type { MirrorSources } from './user-layer-mirror.service';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';
import {
  classifyUpstream,
  UserLayerOrphanReaper,
} from './user-layer-orphan-reaper';
import type { UpstreamLiveness } from './user-layer-orphan-reaper';
import { UserLayerFsOps } from './user-layer-fs-ops';
import { computeSourceHash } from './source-hash';
import type { SkillsShRetiredRegistry } from '@ptah-extension/shared';

/**
 * TASK_2026_278 batch 1b — edge case E8, "upstream deleted".
 *
 * Before this, `mirrorAll` and `reconcile` both walked SOURCE slugs, so a skill
 * removed upstream stayed in `~/.ptah/user/` forever and kept being propagated
 * to every CLI target. The sweep walks clones instead, and the whole risk of
 * doing so is deleting something it should not have: these tests are mostly
 * about what must SURVIVE.
 */

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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSidecarDir(dir: string): Promise<OriginSidecar> {
  return JSON.parse(
    await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8'),
  ) as OriginSidecar;
}

async function readSidecarFile(path: string): Promise<OriginSidecar> {
  return JSON.parse(await readFile(path, 'utf8')) as OriginSidecar;
}

describe('classifyUpstream (pure)', () => {
  function liveness(over: Partial<UpstreamLiveness> = {}): UpstreamLiveness {
    return {
      scannedPluginIds: new Set<string>(),
      pluginsBasePath: '/plugins',
      skillSlugs: new Set<string>(),
      commandSlugs: new Set<string>(),
      agentSlugs: new Set<string>(),
      synthScanned: false,
      agentSourceScanned: false,
      ...over,
    };
  }

  function sidecar(over: Partial<OriginSidecar> = {}): OriginSidecar {
    return {
      kind: 'skill',
      slug: 'dr',
      pluginId: 'p',
      version: null,
      sourceHash: 'sha256:x',
      clonedAt: 0,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      ...over,
    };
  }

  it('a scanned plugin that still ships the slug is live', () => {
    expect(
      classifyUpstream(
        sidecar(),
        liveness({
          scannedPluginIds: new Set(['p']),
          skillSlugs: new Set(['dr']),
        }),
      ),
    ).toBe('live');
  });

  it('a scanned plugin that dropped the slug is an orphan', () => {
    expect(
      classifyUpstream(
        sidecar(),
        liveness({ scannedPluginIds: new Set(['p']) }),
      ),
    ).toBe('orphan');
  });

  it('another plugin still shipping the slug keeps it live (slug sets are global)', () => {
    expect(
      classifyUpstream(
        sidecar({ pluginId: 'p' }),
        liveness({
          scannedPluginIds: new Set(['p', 'other']),
          skillSlugs: new Set(['dr']),
        }),
      ),
    ).toBe('live');
  });

  it('an unscanned plugin needs a disk probe, never a guess', () => {
    expect(classifyUpstream(sidecar(), liveness())).toBe('check-plugin-dir');
  });

  it('with no plugins base path at all the verdict is unknown, not orphan', () => {
    expect(
      classifyUpstream(sidecar(), liveness({ pluginsBasePath: null })),
    ).toBe('unknown');
  });

  it('a synth skill is unknown until the synth root has actually been scanned', () => {
    const synth = sidecar({ pluginId: null });
    expect(classifyUpstream(synth, liveness())).toBe('unknown');
    expect(classifyUpstream(synth, liveness({ synthScanned: true }))).toBe(
      'orphan',
    );
    expect(
      classifyUpstream(
        synth,
        liveness({ synthScanned: true, skillSlugs: new Set(['dr']) }),
      ),
    ).toBe('live');
  });

  it('an agent is unknown until an agent source dir was supplied', () => {
    const agent = sidecar({ kind: 'agent', pluginId: null });
    expect(classifyUpstream(agent, liveness())).toBe('unknown');
    expect(
      classifyUpstream(agent, liveness({ agentSourceScanned: true })),
    ).toBe('orphan');
  });

  it('a command with no plugin id has no nameable upstream', () => {
    expect(
      classifyUpstream(
        sidecar({ kind: 'command', pluginId: null }),
        liveness({ synthScanned: true, agentSourceScanned: true }),
      ),
    ).toBe('unknown');
  });
});

describe('UserLayerMirrorService.reconcileAll — deleted-upstream reap (E8)', () => {
  let workRoot: string;
  let pluginRoot: string;
  let synthRoot: string;
  let agentSourceDir: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-reap-'));
    fakeHome = join(workRoot, 'home');
    // The plugins base the reaper probes for "still installed?".
    pluginRoot = join(fakeHome, 'plugins-base');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    agentSourceDir = join(workRoot, 'workspace', '.claude', 'agents');
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

  async function seedPluginCommand(
    pluginId: string,
    slug: string,
    body: string,
  ): Promise<string> {
    const dir = join(pluginRoot, pluginId, 'commands');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${slug}.md`), body, 'utf8');
    return join(pluginRoot, pluginId);
  }

  async function seedSynthSkill(slug: string, body: string): Promise<void> {
    const dir = join(synthRoot, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
  }

  async function seedAgent(slug: string, body: string): Promise<void> {
    await mkdir(agentSourceDir, { recursive: true });
    await writeFile(join(agentSourceDir, `${slug}.md`), body, 'utf8');
  }

  function sources(over: Partial<MirrorSources> = {}): MirrorSources {
    return {
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
      ...over,
    };
  }

  it('reaps a non-diverged clone whose plugin dropped the slug, snapshotting first', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    expect(await exists(cloneDir)).toBe(true);

    await rm(join(pluginPath, 'skills', 'dr'), {
      recursive: true,
      force: true,
    });

    const result = await service.reconcileAll(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.reaped).toBe(1);
    expect(result.orphaned).toBe(0);
    expect(result.reapedClones).toEqual([{ kind: 'skill', slug: 'dr' }]);
    expect(await exists(cloneDir)).toBe(false);

    // The snapshot lives at the ROOT's .history, not inside the clone we just
    // deleted — otherwise the reap would take the backup with it.
    const histParent = join(roots.skills, DEFAULT_HISTORY_DIR, 'dr');
    const [ts] = await import('fs/promises').then((m) => m.readdir(histParent));
    expect(await readFile(join(histParent, ts, 'SKILL.md'), 'utf8')).toBe(
      '# v1',
    );
  });

  it('keeps a DIVERGED clone and flags it orphaned instead of deleting it', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    const sidecar = await readSidecarDir(cloneDir);
    await writeFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify({ ...sidecar, diverged: true }),
      'utf8',
    );

    await rm(join(pluginPath, 'skills', 'dr'), {
      recursive: true,
      force: true,
    });

    const result = await service.reconcileAll(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.orphaned).toBe(1);
    expect(result.reaped).toBe(0);
    expect(result.orphanedClones).toEqual([{ kind: 'skill', slug: 'dr' }]);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe('# v1');
    expect((await readSidecarDir(cloneDir)).orphaned).toBe(true);
  });

  it('keeps an EDITED-but-not-flagged clone: local work is a hash comparison, not just the flag', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    // What writeEnhancedSkill leaves behind: new bytes, diverged still false.
    await writeFile(join(cloneDir, 'SKILL.md'), '# enhanced body', 'utf8');
    expect((await readSidecarDir(cloneDir)).diverged).toBe(false);

    await rm(join(pluginPath, 'skills', 'dr'), {
      recursive: true,
      force: true,
    });

    const result = await service.reconcileAll(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.reaped).toBe(0);
    expect(result.orphaned).toBe(1);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# enhanced body',
    );
  });

  it('NEVER touches a clone with no sidecar (user-authored)', async () => {
    const roots = service.getUserLayerRoots();
    const mine = join(roots.skills, 'my-own-skill');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '# hand written', 'utf8');

    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    const result = await service.reconcileAll(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.reaped).toBe(0);
    expect(result.orphaned).toBe(0);
    expect(await readFile(join(mine, 'SKILL.md'), 'utf8')).toBe(
      '# hand written',
    );
    expect(await exists(join(mine, ORIGIN_SIDECAR_FILENAME))).toBe(false);
  });

  it('keeps clones of a DISABLED plugin (dir still on disk, just not scanned)', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    // Next activation: the user disabled the plugin, so it is not in
    // resolvePluginPaths() any more — but it is still installed.
    const result = await service.reconcileAll(
      sources({ pluginPaths: [], pluginsBasePath: pluginRoot }),
    );

    expect(result.reaped).toBe(0);
    expect(result.orphaned).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'dr'))).toBe(true);
  });

  it('reaps clones of an UNINSTALLED plugin (dir gone from the plugins base)', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    await rm(pluginPath, { recursive: true, force: true });

    const result = await service.reconcileAll(
      sources({ pluginPaths: [], pluginsBasePath: pluginRoot }),
    );

    expect(result.reaped).toBe(1);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'dr'))).toBe(false);
  });

  it('reaps a synth clone whose ~/.ptah/skills/<slug> disappeared', async () => {
    await seedSynthSkill('promoted-thing', '# synth v1');
    await service.mirrorAll(sources());

    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'promoted-thing'))).toBe(true);

    await rm(join(synthRoot, 'promoted-thing'), {
      recursive: true,
      force: true,
    });

    const result = await service.reconcileAll(sources());
    expect(result.reaped).toBe(1);
    expect(await exists(join(roots.skills, 'promoted-thing'))).toBe(false);
  });

  it('does NOT reap synth clones when the synth root itself is missing (cold first run)', async () => {
    await seedSynthSkill('promoted-thing', '# synth v1');
    await service.mirrorAll(sources());
    await rm(synthRoot, { recursive: true, force: true });

    const result = await service.reconcileAll(sources());

    expect(result.reaped).toBe(0);
    expect(result.orphaned).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'promoted-thing'))).toBe(true);
  });

  it('reaps an agent clone when its .claude/agents source file is gone', async () => {
    await seedAgent('backend-developer', '# agent v1');
    await service.mirrorAll(sources({ agentSourceDir }));

    const roots = service.getUserLayerRoots();
    await rm(join(agentSourceDir, 'backend-developer.md'), { force: true });

    const result = await service.reconcileAll(sources({ agentSourceDir }));

    expect(result.reaped).toBe(1);
    expect(await exists(join(roots.agents, 'backend-developer.md'))).toBe(
      false,
    );
    expect(
      await exists(join(roots.agents, 'backend-developer.ptah-origin.json')),
    ).toBe(false);
  });

  it('does NOT reap agent clones when no workspace supplied an agent source dir', async () => {
    await seedAgent('backend-developer', '# agent v1');
    await service.mirrorAll(sources({ agentSourceDir }));
    await rm(agentSourceDir, { recursive: true, force: true });

    const result = await service.reconcileAll(sources());

    expect(result.reaped).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.agents, 'backend-developer.md'))).toBe(true);
  });

  it('reaps a command clone and its named sidecar together', async () => {
    const pluginPath = await seedPluginCommand('p', 'review', '# review v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    await rm(join(pluginPath, 'commands', 'review.md'), { force: true });

    const result = await service.reconcileAll(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.reaped).toBe(1);
    expect(await exists(join(roots.commands, 'review.md'))).toBe(false);
    expect(await exists(join(roots.commands, 'review.ptah-origin.json'))).toBe(
      false,
    );
    const histParent = join(roots.commands, DEFAULT_HISTORY_DIR, 'review');
    expect(await exists(histParent)).toBe(true);
  });

  it('clears `orphaned` the moment the upstream comes back', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    await writeFile(join(cloneDir, 'SKILL.md'), '# my edit', 'utf8');
    await rm(join(pluginPath, 'skills', 'dr'), {
      recursive: true,
      force: true,
    });

    await service.reconcileAll(sources({ pluginPaths: [pluginPath] }));
    expect((await readSidecarDir(cloneDir)).orphaned).toBe(true);

    // Plugin re-downloaded.
    await seedPluginSkill('p', 'dr', '# v1');
    await service.reconcileAll(sources({ pluginPaths: [pluginPath] }));

    expect((await readSidecarDir(cloneDir)).orphaned).toBe(false);
  });

  it('reconcile() alone never reaps — only reconcileAll() sweeps', async () => {
    const pluginPath = await seedPluginSkill('p', 'dr', '# v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));
    await rm(join(pluginPath, 'skills', 'dr'), {
      recursive: true,
      force: true,
    });

    const result = await service.reconcile(
      sources({ pluginPaths: [pluginPath] }),
    );

    expect(result.reaped).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'dr'))).toBe(true);
  });

  it('surfaces orphaned on listClones and readCloneOrigin', async () => {
    const pluginPath = await seedPluginCommand('p', 'review', '# review v1');
    await service.mirrorAll(sources({ pluginPaths: [pluginPath] }));

    const roots = service.getUserLayerRoots();
    await writeFile(join(roots.commands, 'review.md'), '# edited', 'utf8');
    await rm(join(pluginPath, 'commands', 'review.md'), { force: true });
    await service.reconcileAll(sources({ pluginPaths: [pluginPath] }));

    const entry = await service.readCloneOrigin('command', 'review');
    expect(entry).toMatchObject({ slug: 'review', orphaned: true });

    const listed = await service.listClones();
    expect(listed.find((c) => c.slug === 'review')?.orphaned).toBe(true);

    expect(
      (await readSidecarFile(join(roots.commands, 'review.ptah-origin.json')))
        .orphaned,
    ).toBe(true);
  });

  describe('skills.sh source roots (TASK_2026_701 A-reap)', () => {
    const rootId = 'ptah-skillssh-acme-tools';

    function skillsShSources(over: Partial<MirrorSources> = {}): MirrorSources {
      return sources({ pluginsBasePath: pluginRoot, ...over });
    }

    it('reaps an unedited clone when its skills.sh root vanishes, like a harness root', async () => {
      const skillsShRoot = await seedPluginSkill(rootId, 'scroll', '# v1');
      await service.mirrorAll(
        skillsShSources({ harnessPluginRoots: [skillsShRoot] }),
      );
      const cloneDir = join(service.getUserLayerRoots().skills, 'scroll');
      expect((await readSidecarDir(cloneDir)).pluginId).toBe(rootId);

      // `skillsSh:uninstall` deletes the whole source root.
      await rm(skillsShRoot, { recursive: true, force: true });
      const result = await service.reconcileAll(
        skillsShSources({ harnessPluginRoots: [] }),
      );

      expect(result.reapedClones).toEqual([{ kind: 'skill', slug: 'scroll' }]);
      expect(await exists(cloneDir)).toBe(false);
    });

    it('keeps an edited clone of a vanished skills.sh root as orphaned, with its source fields', async () => {
      const skillsShRoot = await seedPluginSkill(rootId, 'scroll', '# v1');
      const pluginDescriptors = {
        [skillsShRoot]: {
          sourceRef: `skills-sh:${rootId}`,
          label: 'Acme Tools',
        },
      };
      await service.mirrorAll(
        skillsShSources({
          harnessPluginRoots: [skillsShRoot],
          pluginDescriptors,
        }),
      );
      const cloneDir = join(service.getUserLayerRoots().skills, 'scroll');
      await writeFile(join(cloneDir, 'SKILL.md'), '# my edit', 'utf8');

      await rm(skillsShRoot, { recursive: true, force: true });
      const result = await service.reconcileAll(
        skillsShSources({ harnessPluginRoots: [] }),
      );

      expect(result.orphanedClones).toEqual([
        { kind: 'skill', slug: 'scroll' },
      ]);
      expect(await readSidecarDir(cloneDir)).toMatchObject({
        orphaned: true,
        pluginId: rootId,
        sourceRef: `skills-sh:${rootId}`,
        sourceLabel: 'Acme Tools',
      });
    });
  });

  it('an orphaned command keeps sourceRef and sourceLabel', async () => {
    const pluginPath = await seedPluginCommand('p', 'review', '# review v1');
    const pluginDescriptors = {
      [pluginPath]: { sourceRef: 'ptah:p', label: 'Plugin P' },
    };
    await service.mirrorAll(
      sources({ pluginPaths: [pluginPath], pluginDescriptors }),
    );
    const roots = service.getUserLayerRoots();
    const sidecarPath = join(roots.commands, 'review.ptah-origin.json');
    expect(await readSidecarFile(sidecarPath)).toMatchObject({
      sourceRef: 'ptah:p',
      sourceLabel: 'Plugin P',
    });

    await writeFile(join(roots.commands, 'review.md'), '# edited', 'utf8');
    await rm(join(pluginPath, 'commands', 'review.md'), { force: true });
    await service.reconcileAll(sources({ pluginPaths: [pluginPath] }));

    expect(await readSidecarFile(sidecarPath)).toMatchObject({
      orphaned: true,
      sourceRef: 'ptah:p',
      sourceLabel: 'Plugin P',
    });
  });
});

/**
 * TASK_2026_853 D-6 (Batch 32): path-level results for the install-scope
 * migration ledger, and the retired-root clone sweep that reuses the reaper's
 * one deletion rule instead of a second algorithm.
 */
describe('UserLayerOrphanReaper — path results and retired skills.sh clones', () => {
  const rootId = 'ptah-skillssh-acme-tools';
  const sourceRef = `skills-sh:${rootId}`;
  let workRoot: string;
  let userRoots: { skills: string; commands: string; agents: string };
  let pluginsRoot: string;
  let logger: MockLogger;
  let fsOps: UserLayerFsOps;
  let reaper: UserLayerOrphanReaper;

  const registry: SkillsShRetiredRegistry = {
    version: 1,
    roots: { [rootId]: { retiredAt: '2026-10-31T00:00:00.000Z' } },
  };

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-reap-retired-'));
    fakeHome = join(workRoot, 'home');
    const userBase = join(fakeHome, '.ptah', 'user');
    userRoots = {
      skills: join(userBase, 'skills'),
      commands: join(userBase, 'commands'),
      agents: join(userBase, 'agents'),
    };
    pluginsRoot = join(fakeHome, '.ptah', 'plugins');
    await mkdir(userRoots.skills, { recursive: true });
    await mkdir(userRoots.commands, { recursive: true });
    logger = makeLogger();
    fsOps = new UserLayerFsOps(logger as never);
    reaper = new UserLayerOrphanReaper(logger as never, fsOps);
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  function sidecarFor(
    kind: OriginSidecar['kind'],
    slug: string,
    sourceHash: string,
    over: Partial<OriginSidecar> = {},
  ): OriginSidecar {
    return {
      kind,
      slug,
      pluginId: rootId,
      version: null,
      sourceHash,
      clonedAt: 1,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      sourceRef,
      ...over,
    };
  }

  /** The retired source root, which the clone sweep must never touch. */
  async function seedSourceRoot(slug: string, body: string): Promise<string> {
    const dir = join(pluginsRoot, rootId, 'skills', slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
    return dir;
  }

  async function seedSkillClone(
    slug: string,
    body: string,
    over: Partial<OriginSidecar> = {},
  ): Promise<string> {
    const dir = join(userRoots.skills, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
    const hash = await computeSourceHash(dir);
    await writeFile(
      join(dir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify(sidecarFor('skill', slug, hash, over)),
      'utf8',
    );
    return dir;
  }

  async function seedCommandClone(
    slug: string,
    body: string,
    over: Partial<OriginSidecar> = {},
  ): Promise<{ file: string; sidecar: string }> {
    const file = join(userRoots.commands, `${slug}.md`);
    const sidecar = join(userRoots.commands, `${slug}.ptah-origin.json`);
    await writeFile(file, body, 'utf8');
    const hash = await computeSourceHash(file);
    await writeFile(
      sidecar,
      JSON.stringify(sidecarFor('command', slug, hash, over)),
      'utf8',
    );
    return { file, sidecar };
  }

  it('deletes an unchanged, non-diverged clone of a retired root and reports its exact paths; the root survives', async () => {
    const sourceDir = await seedSourceRoot('scroll', '# v1');
    const cloneDir = await seedSkillClone('scroll', '# v1');

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.reapedPaths).toEqual([
      {
        kind: 'skill',
        slug: 'scroll',
        path: cloneDir,
        sourceRef,
        removedPaths: [cloneDir],
      },
    ]);
    expect(result.keptPaths).toEqual([]);
    expect(result.failedPaths).toEqual([]);
    expect(result.reaped).toBe(1);
    expect(result.reapedClones).toEqual([{ kind: 'skill', slug: 'scroll' }]);
    expect(await exists(cloneDir)).toBe(false);
    // Snapshot first, at the root-level history, outside the deleted clone.
    expect(
      await readdir(join(userRoots.skills, DEFAULT_HISTORY_DIR, 'scroll')),
    ).toHaveLength(1);
    // The clone's source root is not the reaper's to delete.
    expect(await readFile(join(sourceDir, 'SKILL.md'), 'utf8')).toBe('# v1');
  });

  it('keeps a diverged clone, reports reason diverged and does not rewrite its sidecar', async () => {
    const cloneDir = await seedSkillClone('scroll', '# v1', { diverged: true });
    const before = await readFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      'utf8',
    );

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.reapedPaths).toEqual([]);
    expect(result.keptPaths).toEqual([
      {
        kind: 'skill',
        slug: 'scroll',
        path: cloneDir,
        sourceRef,
        reason: 'diverged',
      },
    ]);
    expect(result.orphanedClones).toEqual([{ kind: 'skill', slug: 'scroll' }]);
    expect(
      await readFile(join(cloneDir, ORIGIN_SIDECAR_FILENAME), 'utf8'),
    ).toBe(before);
  });

  it('keeps an edited clone (live hash != sourceHash) as edited', async () => {
    const cloneDir = await seedSkillClone('scroll', '# v1');
    await writeFile(join(cloneDir, 'SKILL.md'), '# my edit', 'utf8');

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.keptPaths).toEqual([
      {
        kind: 'skill',
        slug: 'scroll',
        path: cloneDir,
        sourceRef,
        reason: 'edited',
      },
    ]);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# my edit',
    );
  });

  it('keeps a clone that contains a symlink, even though the hash skips links', async () => {
    const outside = join(workRoot, 'outside.md');
    await writeFile(outside, '# not ptah content', 'utf8');
    const cloneDir = await seedSkillClone('scroll', '# v1');
    // Added after the hash: the content hash still matches.
    await symlink(outside, join(cloneDir, 'linked.md'));

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.reapedPaths).toEqual([]);
    expect(result.keptPaths).toEqual([
      {
        kind: 'skill',
        slug: 'scroll',
        path: cloneDir,
        sourceRef,
        reason: 'symlink',
      },
    ]);
    expect(await exists(join(cloneDir, 'linked.md'))).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('# not ptah content');
  });

  it('reports a command clone with both removed paths, and keeps one whose sidecar is a symlink', async () => {
    const plain = await seedCommandClone('review', '# review');
    const realSidecar = join(workRoot, 'linked-sidecar.json');
    const linked = await seedCommandClone('audit', '# audit');
    await writeFile(
      realSidecar,
      await readFile(linked.sidecar, 'utf8'),
      'utf8',
    );
    await rm(linked.sidecar);
    await symlink(realSidecar, linked.sidecar);

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.reapedPaths).toEqual([
      {
        kind: 'command',
        slug: 'review',
        path: plain.file,
        sourceRef,
        removedPaths: [plain.file, plain.sidecar],
      },
    ]);
    expect(result.keptPaths).toEqual([
      {
        kind: 'command',
        slug: 'audit',
        path: linked.file,
        sourceRef,
        reason: 'symlink',
      },
    ]);
    expect(await exists(plain.file)).toBe(false);
    expect(await exists(plain.sidecar)).toBe(false);
    expect(await exists(linked.file)).toBe(true);
    expect(await exists(realSidecar)).toBe(true);
  });

  it('never touches clones of live roots, other source refs, ref-less sidecars or user-authored files', async () => {
    const other = await seedSkillClone('other', '# o', {
      pluginId: 'ptah-skillssh-live',
      sourceRef: 'skills-sh:ptah-skillssh-live',
    });
    const ptah = await seedSkillClone('ptahskill', '# p', {
      sourceRef: 'ptah:p',
    });
    // Same plugin id as the retired root but no sourceRef: fail-open, like the
    // manifest builder's retired filter.
    const refless = await seedSkillClone('refless', '# r', {
      sourceRef: undefined,
    });
    const mine = join(userRoots.skills, 'mine');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '# hand written', 'utf8');

    const result = await reaper.reapRetired(userRoots, registry);

    expect(result.reapedPaths).toEqual([]);
    expect(result.keptPaths).toEqual([]);
    expect(result.failedPaths).toEqual([]);
    for (const dir of [other, ptah, refless, mine]) {
      expect(await exists(dir)).toBe(true);
    }
  });

  it('a null registry retires nothing', async () => {
    const cloneDir = await seedSkillClone('scroll', '# v1');

    const result = await reaper.reapRetired(userRoots, null);

    expect(result).toMatchObject({ reaped: 0, orphaned: 0, errors: 0 });
    expect(result.reapedPaths).toEqual([]);
    expect(await exists(cloneDir)).toBe(true);
  });

  it('reports a failed delete as a failed path; the retry reports it reaped and a third pass is empty', async () => {
    const cloneDir = await seedSkillClone('scroll', '# v1');
    const remove = jest
      .spyOn(fsOps, 'removePath')
      .mockRejectedValueOnce(new Error('EBUSY: resource busy'));

    const first = await reaper.reapRetired(userRoots, registry);

    expect(first.failedPaths).toEqual([
      {
        kind: 'skill',
        slug: 'scroll',
        path: cloneDir,
        sourceRef,
        error: 'EBUSY: resource busy',
      },
    ]);
    expect(first.errors).toBe(1);
    expect(first.reapedPaths).toEqual([]);
    expect(await exists(cloneDir)).toBe(true);

    remove.mockRestore();
    const second = await reaper.reapRetired(userRoots, registry);
    expect(second.reapedPaths.map((r) => r.path)).toEqual([cloneDir]);
    expect(second.failedPaths).toEqual([]);

    const third = await reaper.reapRetired(userRoots, registry);
    expect(third.reapedPaths).toEqual([]);
    expect(third.keptPaths).toEqual([]);
    expect(third.failedPaths).toEqual([]);
  });

  it('the deleted-upstream sweep fills the same path rows and still flags kept clones orphaned', async () => {
    const reapable = await seedSkillClone('gone', '# g');
    const edited = await seedSkillClone('edited', '# e');
    await writeFile(join(edited, 'SKILL.md'), '# mine', 'utf8');
    // The root is installed (scanned) but ships neither slug any more.
    const live: UpstreamLiveness = {
      scannedPluginIds: new Set([rootId]),
      pluginsBasePath: pluginsRoot,
      skillSlugs: new Set<string>(),
      commandSlugs: new Set<string>(),
      agentSlugs: new Set<string>(),
      synthScanned: false,
      agentSourceScanned: false,
    };

    const result = await reaper.reap(userRoots, live);

    expect(result.reapedPaths).toEqual([
      expect.objectContaining({ path: reapable, removedPaths: [reapable] }),
    ]);
    expect(result.keptPaths).toEqual([
      expect.objectContaining({ path: edited, reason: 'edited' }),
    ]);
    expect((await readSidecarDir(edited)).orphaned).toBe(true);
  });
});
