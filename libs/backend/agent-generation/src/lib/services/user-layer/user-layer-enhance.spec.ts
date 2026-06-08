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

function makeLogger() {
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

async function readSidecar(dir: string): Promise<OriginSidecar> {
  return JSON.parse(
    await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8'),
  ) as OriginSidecar;
}

describe('UserLayerMirrorService enhance/revert/history', () => {
  let workRoot: string;
  let service: UserLayerMirrorService;
  let skillDir: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-enhance-'));
    fakeHome = join(workRoot, 'home');
    skillDir = join(fakeHome, '.ptah', 'user', 'skills', 'deep-research');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), 'original body', 'utf8');
    const sidecar: OriginSidecar = {
      kind: 'skill',
      slug: 'deep-research',
      pluginId: 'ptah-core',
      version: null,
      sourceHash: 'sha256:orig',
      clonedAt: 1,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: 'sha256:orig',
    };
    await writeFile(
      join(skillDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify(sidecar),
      'utf8',
    );
    service = new UserLayerMirrorService(makeLogger() as never);
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('writeEnhancedSkill snapshots prior body before writing, atomically', async () => {
    const result = await service.writeEnhancedSkill({
      slug: 'deep-research',
      newBody: 'enhanced body',
    });
    expect(result.historyTs).not.toBeNull();
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'enhanced body',
    );
    const historyFile = join(
      skillDir,
      DEFAULT_HISTORY_DIR,
      result.historyTs as string,
      'SKILL.md',
    );
    expect(await readFile(historyFile, 'utf8')).toBe('original body');
    const sidecar = await readSidecar(skillDir);
    expect(sidecar.lastEnhancedAt).not.toBeNull();
    expect(sidecar.currentContentHash).toBe(result.currentContentHash);
    const tmps = (await readdir(skillDir)).filter((n) => n.endsWith('.tmp'));
    expect(tmps).toHaveLength(0);
  });

  it('writeEnhancedSkill HARD GUARD: never writes outside ~/.ptah/user/', async () => {
    expect(
      service.getUserLayerRoots().skills.includes(join('.ptah', 'user')),
    ).toBe(true);
  });

  it('writeEnhancedSkill THROWS via assertUnderUserLayer for an out-of-user-layer slug; no write', async () => {
    const escapeSlug = join('..', '..', '..', 'escapee');
    const escapeTarget = join(
      service.getUserLayerRoots().skills,
      escapeSlug,
      'SKILL.md',
    );
    await expect(
      service.writeEnhancedSkill({ slug: escapeSlug, newBody: 'evil' }),
    ).rejects.toThrow(/outside ~\/\.ptah\/user/);
    expect(await fileExists(escapeTarget)).toBe(false);
  });

  it('writeEnhancedSkill THROWS for a slug landing under ~/.ptah/plugins/; no write', async () => {
    const pluginSlug = join('..', '..', 'plugins', 'ptah-core');
    const pluginTarget = join(
      fakeHome,
      '.ptah',
      'plugins',
      'ptah-core',
      'SKILL.md',
    );
    await expect(
      service.writeEnhancedSkill({ slug: pluginSlug, newBody: 'evil' }),
    ).rejects.toThrow(/refusing to write/);
    expect(await fileExists(pluginTarget)).toBe(false);
  });

  it('revert THROWS via assertUnderUserLayer for an out-of-user-layer slug; clone untouched', async () => {
    const escapeSlug = join('..', '..', '..', 'escapee');
    await expect(
      service.revert({ kind: 'skill', slug: escapeSlug, historyTs: '123' }),
    ).rejects.toThrow(/outside ~\/\.ptah\/user/);
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'original body',
    );
  });

  it('listHistory returns timestamps newest-first; empty when none', async () => {
    expect(await service.listHistory('skill', 'deep-research')).toEqual([]);
    await service.writeEnhancedSkill({
      slug: 'deep-research',
      newBody: 'v2',
    });
    await new Promise((r) => setTimeout(r, 5));
    await service.writeEnhancedSkill({
      slug: 'deep-research',
      newBody: 'v3',
    });
    const history = await service.listHistory('skill', 'deep-research');
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.every((h) => h.hasSkillMd)).toBe(true);
    const tsValues = history.map((h) => h.ts);
    const sorted = [...tsValues].sort((a, b) => b.localeCompare(a));
    expect(tsValues).toEqual(sorted);
  });

  it('revert restores a prior body and is itself revertible', async () => {
    const first = await service.writeEnhancedSkill({
      slug: 'deep-research',
      newBody: 'enhanced body',
    });
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'enhanced body',
    );

    const reverted = await service.revert({
      kind: 'skill',
      slug: 'deep-research',
      historyTs: first.historyTs as string,
    });
    expect(reverted.restored).toBe(true);
    expect(reverted.newHistoryTs).not.toBeNull();
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'original body',
    );

    const enhancedSnapshot = join(
      skillDir,
      DEFAULT_HISTORY_DIR,
      reverted.newHistoryTs as string,
      'SKILL.md',
    );
    expect(await readFile(enhancedSnapshot, 'utf8')).toBe('enhanced body');
  });

  it('revert is a no-op (restored=false) when the history ts is missing', async () => {
    const result = await service.revert({
      kind: 'skill',
      slug: 'deep-research',
      historyTs: 'does-not-exist',
    });
    expect(result.restored).toBe(false);
    expect(await fileExists(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'original body',
    );
  });

  it('revert (skill) THROWS via assertUnderUserLayer for a traversal historyTs; no copy, clone untouched', async () => {
    const historyTs = join('..', '..', '..', '..', '..', '..', 'etc');
    await expect(
      service.revert({ kind: 'skill', slug: 'deep-research', historyTs }),
    ).rejects.toThrow(/outside ~\/\.ptah\/user/);
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      'original body',
    );
  });

  it('revert (agent/file) THROWS via assertUnderUserLayer for a traversal historyTs; clone untouched', async () => {
    const agentsRoot = service.getUserLayerRoots().agents;
    await mkdir(agentsRoot, { recursive: true });
    await writeFile(join(agentsRoot, 'my-agent.md'), 'agent body', 'utf8');
    const historyTs = join('..', '..', '..', '..', '..', '..', 'etc');
    await expect(
      service.revert({ kind: 'agent', slug: 'my-agent', historyTs }),
    ).rejects.toThrow(/outside ~\/\.ptah\/user/);
    expect(await readFile(join(agentsRoot, 'my-agent.md'), 'utf8')).toBe(
      'agent body',
    );
  });

  it('writeEnhancedFileClone (agent) snapshots prior body before atomic overwrite + refreshes sidecar', async () => {
    const agentsRoot = service.getUserLayerRoots().agents;
    await mkdir(agentsRoot, { recursive: true });
    await writeFile(join(agentsRoot, 'my-agent.md'), 'original agent', 'utf8');
    const sidecar: OriginSidecar = {
      kind: 'agent',
      slug: 'my-agent',
      pluginId: null,
      version: null,
      sourceHash: 'sha256:orig',
      clonedAt: 1,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: 'sha256:orig',
    };
    await writeFile(
      join(agentsRoot, `my-agent${'.ptah-origin.json'}`),
      JSON.stringify(sidecar),
      'utf8',
    );

    const result = await service.writeEnhancedFileClone({
      kind: 'agent',
      slug: 'my-agent',
      newBody: 'enhanced agent',
    });

    expect(result.historyTs).not.toBeNull();
    expect(await readFile(join(agentsRoot, 'my-agent.md'), 'utf8')).toBe(
      'enhanced agent',
    );
    const historyFile = join(
      agentsRoot,
      DEFAULT_HISTORY_DIR,
      'my-agent',
      result.historyTs as string,
      'my-agent.md',
    );
    expect(await readFile(historyFile, 'utf8')).toBe('original agent');
    const refreshed = JSON.parse(
      await readFile(
        join(agentsRoot, `my-agent${'.ptah-origin.json'}`),
        'utf8',
      ),
    ) as OriginSidecar;
    expect(refreshed.lastEnhancedAt).not.toBeNull();
    expect(refreshed.currentContentHash).toBe(result.currentContentHash);
    const tmps = (await readdir(agentsRoot)).filter((n) => n.endsWith('.tmp'));
    expect(tmps).toHaveLength(0);
  });

  it('writeEnhancedFileClone (command) writes clone + sidecar when absent (no prior snapshot)', async () => {
    const commandsRoot = service.getUserLayerRoots().commands;
    const result = await service.writeEnhancedFileClone({
      kind: 'command',
      slug: 'my-command',
      newBody: 'command body without frontmatter',
    });
    expect(result.historyTs).toBeNull();
    expect(await readFile(join(commandsRoot, 'my-command.md'), 'utf8')).toBe(
      'command body without frontmatter',
    );
    const sidecar = JSON.parse(
      await readFile(
        join(commandsRoot, `my-command${'.ptah-origin.json'}`),
        'utf8',
      ),
    ) as OriginSidecar;
    expect(sidecar.kind).toBe('command');
    expect(sidecar.currentContentHash).toBe(result.currentContentHash);
  });

  it('writeEnhancedFileClone THROWS via assertUnderUserLayer for an out-of-user-layer slug; no write', async () => {
    const escapeSlug = join('..', '..', '..', 'escapee');
    await expect(
      service.writeEnhancedFileClone({
        kind: 'agent',
        slug: escapeSlug,
        newBody: 'evil',
      }),
    ).rejects.toThrow(/outside ~\/\.ptah\/user/);
  });
});
