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

async function readSidecarJson(dir: string): Promise<OriginSidecar> {
  const raw = await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8');
  return JSON.parse(raw) as OriginSidecar;
}

async function readSidecarFileJson(path: string): Promise<OriginSidecar> {
  const raw = await readFile(path, 'utf8');
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

describe('UserLayerMirrorService.rebaseClone / keepClone', () => {
  let workRoot: string;
  let pluginRoot: string;
  let synthRoot: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-resolve-'));
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

  async function seedAndMirrorSkill(
    pluginId: string,
    slug: string,
    body: string,
  ): Promise<{ pluginPath: string; sourceDir: string }> {
    const pluginPath = join(pluginRoot, pluginId);
    const sourceDir = join(pluginPath, 'skills', slug);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'SKILL.md'), body, 'utf8');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    return { pluginPath, sourceDir };
  }

  it('rebaseClone overwrites a diverged clone from the backup, snapshots prior content, clears diverged', async () => {
    const { sourceDir } = await seedAndMirrorSkill(
      'plugin-a',
      'deep-research',
      '# original',
    );
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'deep-research');
    const cloneSkill = join(cloneDir, 'SKILL.md');

    await writeFile(cloneSkill, '# user edits', 'utf8');
    const divergedSidecar = await readSidecarJson(cloneDir);
    await writeFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify({
        ...divergedSidecar,
        diverged: true,
        pendingSourceHash: 'sha256:upstream',
      }),
      'utf8',
    );

    await writeFile(join(sourceDir, 'SKILL.md'), '# upstream v2', 'utf8');

    const result = await service.rebaseClone({
      kind: 'skill',
      slug: 'deep-research',
      sourceDir,
    });

    expect(await readFile(cloneSkill, 'utf8')).toBe('# upstream v2');
    const sidecar = await readSidecarJson(cloneDir);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();
    expect(sidecar.sourceHash).toBe(result.sourceHash);
    expect(sidecar.currentContentHash).toBe(result.sourceHash);

    expect(result.snapshotPath).not.toBeNull();
    const historySkill = join(result.snapshotPath as string, 'SKILL.md');
    expect(await readFile(historySkill, 'utf8')).toBe('# user edits');
  });

  it('keepClone leaves clone bytes unchanged and adopts pendingSourceHash as the new baseline', async () => {
    const { sourceDir } = await seedAndMirrorSkill(
      'plugin-a',
      'deep-research',
      '# original',
    );
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'deep-research');
    const cloneSkill = join(cloneDir, 'SKILL.md');

    await writeFile(cloneSkill, '# user edits', 'utf8');

    await writeFile(sourceDir + '/SKILL.md', '# upstream v2', 'utf8');
    const upstreamHash = await computeSourceHash(sourceDir);

    const baseSidecar = await readSidecarJson(cloneDir);
    await writeFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify({
        ...baseSidecar,
        diverged: true,
        pendingSourceHash: upstreamHash,
      }),
      'utf8',
    );

    const result = await service.keepClone({
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(await readFile(cloneSkill, 'utf8')).toBe('# user edits');
    const sidecar = await readSidecarJson(cloneDir);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();
    expect(sidecar.sourceHash).toBe(upstreamHash);
    expect(result.sourceHash).toBe(upstreamHash);

    const reconcile = await service.reconcile({
      pluginPaths: [join(pluginRoot, 'plugin-a')],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(reconcile.noop).toBe(1);
    expect(reconcile.diverged).toBe(0);
  });

  it('keepClone is a safe no-op when the clone is not diverged', async () => {
    await seedAndMirrorSkill('plugin-a', 'deep-research', '# original');
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'deep-research');
    const before = await readSidecarJson(cloneDir);

    const result = await service.keepClone({
      kind: 'skill',
      slug: 'deep-research',
    });

    const after = await readSidecarJson(cloneDir);
    expect(after.sourceHash).toBe(before.sourceHash);
    expect(after.diverged).toBe(false);
    expect(result.sourceHash).toBe(before.sourceHash);
  });

  it('rebaseClone is a no-op when the source backup is missing (clone untouched, diverged unchanged)', async () => {
    const { sourceDir } = await seedAndMirrorSkill(
      'plugin-a',
      'deep-research',
      '# original',
    );
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'deep-research');
    const cloneSkill = join(cloneDir, 'SKILL.md');

    await writeFile(cloneSkill, '# user edits', 'utf8');
    const divergedSidecar = await readSidecarJson(cloneDir);
    await writeFile(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify({
        ...divergedSidecar,
        diverged: true,
        pendingSourceHash: 'sha256:upstream',
      }),
      'utf8',
    );

    await rm(sourceDir, { recursive: true, force: true });

    const result = await service.rebaseClone({
      kind: 'skill',
      slug: 'deep-research',
      sourceDir,
    });

    expect(result.failed).toBe(true);
    expect(result.reason).toBe('source-missing');
    expect(result.snapshotPath).toBeNull();

    expect(await readFile(cloneSkill, 'utf8')).toBe('# user edits');
    const sidecar = await readSidecarJson(cloneDir);
    expect(sidecar.diverged).toBe(true);
    expect(sidecar.pendingSourceHash).toBe('sha256:upstream');
    expect(await fileExists(join(cloneDir, DEFAULT_HISTORY_DIR))).toBe(false);
  });

  async function seedAndMirrorCommand(
    pluginId: string,
    slug: string,
    body: string,
  ): Promise<{ pluginPath: string; sourceFile: string }> {
    const pluginPath = join(pluginRoot, pluginId);
    const commandsDir = join(pluginPath, 'commands');
    await mkdir(commandsDir, { recursive: true });
    const sourceFile = join(commandsDir, `${slug}.md`);
    await writeFile(sourceFile, body, 'utf8');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    return { pluginPath, sourceFile };
  }

  it('rebaseClone (command flat file) overwrites from backup, snapshots, clears diverged', async () => {
    const { sourceFile } = await seedAndMirrorCommand(
      'plugin-a',
      'review',
      '# review v1',
    );
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.commands, 'review.md');
    const sidecarPath = join(roots.commands, 'review.ptah-origin.json');

    await writeFile(cloneFile, '# user review edits', 'utf8');
    const base = await readSidecarFileJson(sidecarPath);
    await writeFile(
      sidecarPath,
      JSON.stringify({
        ...base,
        diverged: true,
        pendingSourceHash: 'sha256:upstream',
      }),
      'utf8',
    );

    await writeFile(sourceFile, '# review v2 upstream', 'utf8');

    const result = await service.rebaseClone({
      kind: 'command',
      slug: 'review',
      sourceDir: sourceFile,
    });

    expect(result.kind).toBe('command');
    expect(result.failed).toBeFalsy();
    expect(await readFile(cloneFile, 'utf8')).toBe('# review v2 upstream');
    const sidecar = await readSidecarFileJson(sidecarPath);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();
    expect(sidecar.sourceHash).toBe(result.sourceHash);

    expect(result.snapshotPath).not.toBeNull();
    const snapFile = join(result.snapshotPath as string, 'review.md');
    expect(await readFile(snapFile, 'utf8')).toBe('# user review edits');
  });

  it('rebaseClone (command flat file) is a no-op when the source backup is missing', async () => {
    const { sourceFile } = await seedAndMirrorCommand(
      'plugin-a',
      'review',
      '# review v1',
    );
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.commands, 'review.md');
    await writeFile(cloneFile, '# user review edits', 'utf8');

    await rm(sourceFile, { force: true });

    const result = await service.rebaseClone({
      kind: 'command',
      slug: 'review',
      sourceDir: sourceFile,
    });

    expect(result.failed).toBe(true);
    expect(result.reason).toBe('source-missing');
    expect(await readFile(cloneFile, 'utf8')).toBe('# user review edits');
  });

  async function seedAndMirrorAgent(
    slug: string,
    body: string,
  ): Promise<{ agentSourceDir: string; sourceFile: string }> {
    const agentSourceDir = join(workRoot, 'ws', '.claude', 'agents');
    await mkdir(agentSourceDir, { recursive: true });
    const sourceFile = join(agentSourceDir, `${slug}.md`);
    await writeFile(sourceFile, body, 'utf8');
    await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
      agentSourceDir,
    });
    return { agentSourceDir, sourceFile };
  }

  it('keepClone (agent flat file) leaves clone bytes unchanged and adopts pendingSourceHash', async () => {
    const { sourceFile } = await seedAndMirrorAgent(
      'backend-dev',
      '# agent v1',
    );
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.agents, 'backend-dev.md');
    const sidecarPath = join(roots.agents, 'backend-dev.ptah-origin.json');

    await writeFile(cloneFile, '# user agent edits', 'utf8');

    await writeFile(sourceFile, '# agent v2 upstream', 'utf8');
    const upstreamHash = await computeSourceHash(sourceFile);

    const base = await readSidecarFileJson(sidecarPath);
    await writeFile(
      sidecarPath,
      JSON.stringify({
        ...base,
        diverged: true,
        pendingSourceHash: upstreamHash,
      }),
      'utf8',
    );

    const result = await service.keepClone({
      kind: 'agent',
      slug: 'backend-dev',
    });

    expect(result.kind).toBe('agent');
    expect(await readFile(cloneFile, 'utf8')).toBe('# user agent edits');
    const sidecar = await readSidecarFileJson(sidecarPath);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();
    expect(sidecar.sourceHash).toBe(upstreamHash);
    expect(result.sourceHash).toBe(upstreamHash);
  });
});
