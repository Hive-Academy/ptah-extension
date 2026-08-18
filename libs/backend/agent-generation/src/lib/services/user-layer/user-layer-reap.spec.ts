import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
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
import { classifyUpstream } from './user-layer-orphan-reaper';
import type { UpstreamLiveness } from './user-layer-orphan-reaper';

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
});
