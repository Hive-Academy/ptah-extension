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
import { ORIGIN_SIDECAR_FILENAME } from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';

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

async function readSidecarJson(dir: string): Promise<OriginSidecar> {
  const raw = await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8');
  return JSON.parse(raw) as OriginSidecar;
}

describe('UserLayerMirrorService.mirrorAll', () => {
  let workRoot: string;
  let pluginRoot: string;
  let synthRoot: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-mirror-'));
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

  it('mirrors plugin skills into ~/.ptah/user/skills with a sidecar', async () => {
    const pluginPath = await seedPluginSkill(
      'plugin-a',
      'deep-research',
      '# DR',
    );

    const result = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    const roots = service.getUserLayerRoots();
    const clonedSkill = join(roots.skills, 'deep-research', 'SKILL.md');
    expect(await fileExists(clonedSkill)).toBe(true);
    expect(result.skillsMirrored).toBe(1);

    const sidecar = await readSidecarJson(join(roots.skills, 'deep-research'));
    expect(sidecar.kind).toBe('skill');
    expect(sidecar.slug).toBe('deep-research');
    expect(sidecar.pluginId).toBe('plugin-a');
    expect(sidecar.sourceHash).toMatch(/^sha256:/);
    expect(sidecar.diverged).toBe(false);
  });

  it('never writes under ~/.ptah/plugins/ and leaves the plugin dir untouched', async () => {
    const pluginPath = await seedPluginSkill(
      'plugin-a',
      'deep-research',
      '# DR',
    );
    const originalContent = await readFile(
      join(pluginPath, 'skills', 'deep-research', 'SKILL.md'),
      'utf8',
    );

    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const afterContent = await readFile(
      join(pluginPath, 'skills', 'deep-research', 'SKILL.md'),
      'utf8',
    );
    expect(afterContent).toBe(originalContent);

    const pluginsBase = join(fakeHome, '.ptah', 'plugins');
    expect(await fileExists(pluginsBase)).toBe(false);
  });

  it('is idempotent: a second run no-ops (skips already-cloned slugs)', async () => {
    const pluginPath = await seedPluginSkill(
      'plugin-a',
      'deep-research',
      '# DR',
    );

    const first = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(first.skillsMirrored).toBe(1);

    const second = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(second.skillsMirrored).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('does not clobber a user-edited clone on re-run', async () => {
    const pluginPath = await seedPluginSkill(
      'plugin-a',
      'deep-research',
      '# DR',
    );
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloned = join(roots.skills, 'deep-research', 'SKILL.md');
    await writeFile(cloned, '# DR edited by user', 'utf8');

    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(await readFile(cloned, 'utf8')).toBe('# DR edited by user');
  });

  it('does not let a failed first-writer shadow a valid second source (C1)', async () => {
    const pluginA = await seedPluginSkill('plugin-a', 'shared-slug', '# A');
    const pluginB = await seedPluginSkill('plugin-b', 'shared-slug', '# B');

    const roots = service.getUserLayerRoots();
    const targetSkill = join(roots.skills, 'shared-slug');
    const realCopyTree = (
      service as unknown as {
        copyTree: (s: string, t: string) => Promise<void>;
      }
    ).copyTree.bind(service);
    let calls = 0;
    (
      service as unknown as {
        copyTree: (s: string, t: string) => Promise<void>;
      }
    ).copyTree = async (src: string, dst: string) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('simulated copy failure for first writer');
      }
      return realCopyTree(src, dst);
    };

    const result = await service.mirrorAll({
      pluginPaths: [pluginA, pluginB],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.errors).toBe(1);
    expect(result.skillsMirrored).toBe(1);
    expect(result.conflicts).toBe(0);

    const body = await readFile(join(targetSkill, 'SKILL.md'), 'utf8');
    expect(body).toBe('# B');
    const sidecar = await readSidecarJson(targetSkill);
    expect(sidecar.conflictsWith).toBeUndefined();
  });

  it('does not clobber a pre-existing clone that has NO sidecar (S2)', async () => {
    const pluginPath = await seedPluginSkill(
      'plugin-a',
      'deep-research',
      '# DR',
    );

    const roots = service.getUserLayerRoots();
    const targetDir = join(roots.skills, 'deep-research');
    await mkdir(targetDir, { recursive: true });
    const userFile = join(targetDir, 'SKILL.md');
    await writeFile(userFile, '# user content from crashed run', 'utf8');

    const result = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(await readFile(userFile, 'utf8')).toBe(
      '# user content from crashed run',
    );
    expect(result.skipped).toBe(1);
    expect(result.skillsMirrored).toBe(0);

    const sidecar = await readSidecarJson(targetDir);
    expect(sidecar.slug).toBe('deep-research');
    expect(sidecar.sourceHash).toMatch(/^sha256:/);
  });

  it('does not clobber a pre-existing flat command without a sidecar (S2)', async () => {
    const pluginPath = join(pluginRoot, 'plugin-a');
    await mkdir(join(pluginPath, 'commands'), { recursive: true });
    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# upstream review',
      'utf8',
    );

    const roots = service.getUserLayerRoots();
    await mkdir(roots.commands, { recursive: true });
    const targetFile = join(roots.commands, 'review.md');
    await writeFile(targetFile, '# user-edited review', 'utf8');

    const result = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(await readFile(targetFile, 'utf8')).toBe('# user-edited review');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.commandsMirrored).toBe(0);
    expect(
      await fileExists(join(roots.commands, 'review.ptah-origin.json')),
    ).toBe(true);
  });

  it('rejects a copyFileAtomic target outside the user layer (C2)', async () => {
    const sourceFile = join(workRoot, 'src.md');
    await writeFile(sourceFile, '# src', 'utf8');
    const outsideTarget = join(workRoot, 'escape', 'evil.md');

    await expect(
      (
        service as unknown as {
          copyFileAtomic: (s: string, t: string) => Promise<void>;
        }
      ).copyFileAtomic(sourceFile, outsideTarget),
    ).rejects.toThrow(/refusing to write outside/);

    expect(await fileExists(outsideTarget)).toBe(false);
  });

  it('records conflictsWith on slug collision (first-write wins)', async () => {
    const pluginA = await seedPluginSkill('plugin-a', 'shared-slug', '# A');
    const pluginB = await seedPluginSkill('plugin-b', 'shared-slug', '# B');

    const result = await service.mirrorAll({
      pluginPaths: [pluginA, pluginB],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.conflicts).toBe(1);
    const roots = service.getUserLayerRoots();
    const body = await readFile(
      join(roots.skills, 'shared-slug', 'SKILL.md'),
      'utf8',
    );
    expect(body).toBe('# A');

    const sidecar = await readSidecarJson(join(roots.skills, 'shared-slug'));
    expect(sidecar.conflictsWith).toContain('plugin-b');
  });

  it('skips the _candidates dir under the synthesized skills root', async () => {
    const candidatesDir = join(synthRoot, '_candidates', 'pending');
    await mkdir(candidatesDir, { recursive: true });
    await writeFile(join(candidatesDir, 'SKILL.md'), '# candidate', 'utf8');

    const synthSkill = join(synthRoot, 'real-synth');
    await mkdir(synthSkill, { recursive: true });
    await writeFile(join(synthSkill, 'SKILL.md'), '# synth', 'utf8');

    const result = await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    expect(result.skillsMirrored).toBe(1);
    expect(await fileExists(join(roots.skills, 'real-synth'))).toBe(true);
    expect(await fileExists(join(roots.skills, '_candidates'))).toBe(false);
  });

  it('mirrors commands and agents as flat files with named sidecars', async () => {
    const pluginPath = join(pluginRoot, 'plugin-a');
    await mkdir(join(pluginPath, 'commands'), { recursive: true });
    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review command',
      'utf8',
    );

    const agentSourceDir = join(workRoot, 'ws', '.claude', 'agents');
    await mkdir(agentSourceDir, { recursive: true });
    await writeFile(
      join(agentSourceDir, 'backend-dev.md'),
      '# backend dev agent',
      'utf8',
    );

    const result = await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
      agentSourceDir,
    });

    const roots = service.getUserLayerRoots();
    expect(result.commandsMirrored).toBe(1);
    expect(result.agentsMirrored).toBe(1);
    expect(await fileExists(join(roots.commands, 'review.md'))).toBe(true);
    expect(
      await fileExists(join(roots.commands, 'review.ptah-origin.json')),
    ).toBe(true);
    expect(await fileExists(join(roots.agents, 'backend-dev.md'))).toBe(true);
    expect(
      await fileExists(join(roots.agents, 'backend-dev.ptah-origin.json')),
    ).toBe(true);

    const clones = await service.listClones();
    expect(clones.map((c) => c.kind).sort()).toEqual(['agent', 'command']);
  });
});
