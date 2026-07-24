import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CursorSkillInstaller } from './cursor-skill-installer';
import { CodexSkillInstaller } from './codex-skill-installer';
import { CopilotSkillInstaller } from './copilot-skill-installer';
import { AntigravitySkillInstaller } from './antigravity-skill-installer';
import {
  mergeAgentsRegion,
  reapPrefixedHomeEntries,
  readManagedManifest,
  writeManagedManifest,
  CLI_MANAGED_MANIFEST,
  PTAH_AGENTS_REGION_BEGIN,
  PTAH_AGENTS_REGION_END,
} from './skill-sync-utils';

async function makeUserLayer(): Promise<{
  root: string;
  skillsRoot: string;
  commandsRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'ptah-userlayer-'));
  const skillsRoot = join(root, 'skills');
  const commandsRoot = join(root, 'commands');
  await mkdir(join(skillsRoot, 'caveman'), { recursive: true });
  await writeFile(
    join(skillsRoot, 'caveman', 'SKILL.md'),
    '---\nname: caveman\ndescription: talk brief\nallowed-tools: Read\n---\nBody here\n',
    'utf8',
  );
  await mkdir(commandsRoot, { recursive: true });
  await writeFile(
    join(commandsRoot, 'deep-research.md'),
    '---\ndescription: research\n---\nDo the research.\n',
    'utf8',
  );
  return { root, skillsRoot, commandsRoot };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('Workspace skill installers (decision #4)', () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    for (const dir of cleanups.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function workspace(): Promise<string> {
    const ws = await mkdtemp(join(tmpdir(), 'ptah-ws-'));
    cleanups.push(ws);
    return ws;
  }

  it('Cursor: bare-name skills under .cursor/skills/{slug} + name frontmatter is bare', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();
    const installer = new CursorSkillInstaller();

    const status = await installer.install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    expect(status.synced).toBe(true);
    const skillDir = join(ws, '.cursor', 'skills', 'caveman');
    expect(await exists(skillDir)).toBe(true);
    expect(await exists(join(ws, '.cursor', 'skills', 'ptah-caveman'))).toBe(
      false,
    );
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: caveman');
    expect(skillMd).not.toContain('ptah-caveman');
    expect(skillMd).not.toContain('allowed-tools');
  });

  it('Cursor: commands stay .md, skills bare-name under .cursor/skills', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();

    await new CursorSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    expect(await exists(join(ws, '.cursor', 'skills', 'caveman'))).toBe(true);
    expect(
      await exists(join(ws, '.cursor', 'commands', 'deep-research.md')),
    ).toBe(true);
  });

  it('Codex: skills under .agents/skills (NOT .codex/skills); commands SKIPPED', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();

    await new CodexSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    expect(await exists(join(ws, '.agents', 'skills', 'caveman'))).toBe(true);
    expect(await exists(join(ws, '.codex', 'skills'))).toBe(false);
    expect(await exists(join(ws, '.agents', 'commands'))).toBe(false);
  });

  it('Antigravity: skills under .agents/skills (shared w/ Codex); commands SKIPPED', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();
    const installer = new AntigravitySkillInstaller();

    expect(installer.target).toBe('antigravity');
    expect(installer.resolveSkillsTarget(ws)).toBe(
      join(ws, '.agents', 'skills'),
    );
    expect(installer.resolveCommandsTarget()).toBeNull();

    await installer.install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    expect(await exists(join(ws, '.agents', 'skills', 'caveman'))).toBe(true);
    expect(await exists(join(ws, '.agents', 'commands'))).toBe(false);
  });

  it('Copilot: skills under .github/skills; commands SKIPPED', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();

    await new CopilotSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    expect(await exists(join(ws, '.github', 'skills', 'caveman'))).toBe(true);
    expect(await exists(join(ws, '.copilot', 'skills'))).toBe(false);
    expect(await exists(join(ws, '.github', 'commands'))).toBe(false);
  });

  it('No workspace root → no writes anywhere', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const status = await new CursorSkillInstaller().install({
      skillsRoot: layer.skillsRoot,
      commandsRoot: layer.commandsRoot,
    });
    expect(status.synced).toBe(true);
    expect(status.skillCount).toBe(0);
  });

  it("don't-clobber-foreign: skips a same-named skill lacking a managed-manifest entry, never overwrites", async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();
    const skillsTarget = join(ws, '.cursor', 'skills');
    await mkdir(join(skillsTarget, 'caveman'), { recursive: true });
    await writeFile(
      join(skillsTarget, 'caveman', 'SKILL.md'),
      'USER AUTHORED — DO NOT TOUCH',
      'utf8',
    );

    const status = await new CursorSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );

    const preserved = await readFile(
      join(skillsTarget, 'caveman', 'SKILL.md'),
      'utf8',
    );
    expect(preserved).toBe('USER AUTHORED — DO NOT TOUCH');
    expect(status.error).toContain('foreign');
  });

  it('overwrites our own previously-written entry (manifest present)', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();

    await new CursorSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );
    const skillsTarget = join(ws, '.cursor', 'skills');
    const manifest = await readManagedManifest(skillsTarget);
    expect(manifest.skills).toContain('caveman');

    const status = await new CursorSkillInstaller().install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );
    expect(status.synced).toBe(true);
    expect(status.error).toBeUndefined();
  });

  it('uninstall removes managed entries, leaves foreign entries', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();
    const installer = new CursorSkillInstaller();

    await installer.install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );
    const skillsTarget = join(ws, '.cursor', 'skills');
    await mkdir(join(skillsTarget, 'user-authored'), { recursive: true });

    await installer.uninstall(ws);

    expect(await exists(join(skillsTarget, 'caveman'))).toBe(false);
    expect(await exists(join(skillsTarget, 'user-authored'))).toBe(true);
  });

  it('uninstall reaps by EXACT name, never by prefix (caveman vs caveman-notes)', async () => {
    const layer = await makeUserLayer();
    cleanups.push(layer.root);
    const ws = await workspace();
    const installer = new CursorSkillInstaller();

    await installer.install(
      { skillsRoot: layer.skillsRoot, commandsRoot: layer.commandsRoot },
      { workspaceRoot: ws },
    );
    const skillsTarget = join(ws, '.cursor', 'skills');
    await mkdir(join(skillsTarget, 'caveman-notes'), { recursive: true });
    await writeFile(
      join(skillsTarget, 'caveman-notes', 'SKILL.md'),
      'FOREIGN — shares prefix with managed caveman',
      'utf8',
    );

    await installer.uninstall(ws);

    expect(await exists(join(skillsTarget, 'caveman'))).toBe(false);
    expect(await exists(join(skillsTarget, 'caveman-notes'))).toBe(true);
  });
});

describe('mergeAgentsRegion (Codex AGENTS.md)', () => {
  const begin = PTAH_AGENTS_REGION_BEGIN;
  const end = PTAH_AGENTS_REGION_END;

  it('appends a region to existing content without clobbering it', () => {
    const existing = '# My Project\n\nUser rules here.\n';
    const merged = mergeAgentsRegion(existing, [
      { name: 'backend', content: 'Backend body' },
    ]);
    expect(merged).toContain('# My Project');
    expect(merged).toContain('User rules here.');
    expect(merged).toContain(begin);
    expect(merged).toContain('## backend');
    expect(merged).toContain(end);
  });

  it('replaces only the Ptah region on re-run (idempotent, no duplicate region)', () => {
    const existing = '# Keep me\n';
    const first = mergeAgentsRegion(existing, [
      { name: 'a', content: 'old body' },
    ]);
    const second = mergeAgentsRegion(first, [
      { name: 'a', content: 'new body' },
    ]);
    expect(second).toContain('# Keep me');
    expect(second).toContain('new body');
    expect(second).not.toContain('old body');
    expect(second.indexOf(begin)).toBe(second.lastIndexOf(begin));
    expect(second.indexOf(end)).toBe(second.lastIndexOf(end));
  });

  it('writes only the region when there is no existing file', () => {
    const merged = mergeAgentsRegion('', [{ name: 'x', content: 'b' }]);
    expect(merged.startsWith(begin)).toBe(true);
    expect(merged.trimEnd().endsWith(end)).toBe(true);
  });

  it('stray BEGIN-only: appends a fresh region, never slices user content', () => {
    const existing = `# Keep me\n\n${begin}\norphan begin no end\nmore user text\n`;
    const merged = mergeAgentsRegion(existing, [
      { name: 'a', content: 'body' },
    ]);
    expect(merged).toContain('# Keep me');
    expect(merged).toContain('orphan begin no end');
    expect(merged).toContain('more user text');
    expect(merged).toContain('## a');
    expect(merged).toContain(end);
    expect(merged.indexOf(end)).toBe(merged.lastIndexOf(end));
  });

  it('stray END-only: appends a fresh region, never slices user content', () => {
    const existing = `# Keep me\n\nuser text\n${end}\ntrailing user text\n`;
    const merged = mergeAgentsRegion(existing, [
      { name: 'a', content: 'body' },
    ]);
    expect(merged).toContain('# Keep me');
    expect(merged).toContain('user text');
    expect(merged).toContain('trailing user text');
    expect(merged).toContain('## a');
    expect(merged).toContain(begin);
  });
});

describe('reapPrefixedHomeEntries (home reap)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('removes only ptah-/ptahsynth- prefixed entries, keeps user-authored', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ptah-home-'));
    dirs.push(home);
    await mkdir(join(home, 'ptah-caveman'), { recursive: true });
    await mkdir(join(home, 'ptahsynth-foo'), { recursive: true });
    await mkdir(join(home, 'my-own-skill'), { recursive: true });
    await writeFile(join(home, 'ptah-cmd.md'), 'x', 'utf8');

    const removed = await reapPrefixedHomeEntries(home, [
      'ptah-',
      'ptahsynth-',
    ]);

    expect(removed).toBe(3);
    const remaining = await readdir(home);
    expect(remaining).toEqual(['my-own-skill']);
  });

  it('returns 0 for a non-existent dir', async () => {
    const removed = await reapPrefixedHomeEntries(
      join(tmpdir(), 'definitely-not-here-xyz'),
      ['ptah-'],
    );
    expect(removed).toBe(0);
  });
});

describe('managed manifest helpers', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('round-trips a manifest and is empty when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ptah-manifest-'));
    dirs.push(dir);
    expect(await readManagedManifest(dir)).toEqual({});
    await writeManagedManifest(dir, { skills: ['a'], commands: ['b.toml'] });
    expect(await exists(join(dir, CLI_MANAGED_MANIFEST))).toBe(true);
    const back = await readManagedManifest(dir);
    expect(back.skills).toEqual(['a']);
    expect(back.commands).toEqual(['b.toml']);
  });
});
