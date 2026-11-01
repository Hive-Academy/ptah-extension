/**
 * Lifecycle spec for `SkillsShSourceRootService` — the one writer of
 * `~/.ptah/plugins/ptah-skillssh-*`.
 *
 * Runs against a REAL temp directory, passed as the service's `homeDir`
 * argument, because the whole claim under test is about what ends up on disk and
 * where: a mocked `fs` would happily agree with a service that wrote to the
 * wrong path. The third-party CLI is the only thing stubbed — `stageSkillsInstall`
 * is replaced by a function that populates the staging directory the way the
 * real `npx skills add … --agent claude-code --copy -y` was measured to
 * (`{cwd}/.claude/skills/<slug>/SKILL.md`), so the move-and-record half of
 * `install` is exercised for real.
 *
 * What it pins (see also the TASK_2026_853 D-3 blocks at the end):
 *   - an install LANDS in `~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>`,
 *     which is what makes `resolveCurrentPluginPaths` pick it up as overlay
 *     desired state with no new writer and no new manifest;
 *   - it does NOT touch `~/.ptah/user/skills` — a user-layer clone would
 *     survive uninstall and propagate forever;
 *   - uninstall removes the slug, and the root with the last slug, so the
 *     reconciler's removal sweep has something to reap from;
 *   - a hostile `source`/`skillId` never reaches the filesystem;
 *   - a CLI run that reports success but writes nothing installs nothing.
 */

import 'reflect-metadata';

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const stageSkillsInstallMock = jest.fn();

jest.mock('../utils/skills-sh-cli', () => {
  const actual = jest.requireActual('../utils/skills-sh-cli');
  return {
    ...actual,
    stageSkillsInstall: (...args: unknown[]) => stageSkillsInstallMock(...args),
  };
});

import {
  STAGED_SKILLS_REL,
  type SkillInstallRequest,
} from '../utils/skills-sh-cli';
import {
  SKILLS_SH_OWNER_MARKER,
  SKILLS_SH_RETIRED_FILE,
} from '@ptah-extension/shared';
import {
  SkillsShSourceRootService,
  type SkillsShMakeGlobalHooks,
  type SkillsShMakeGlobalPhase,
} from './skills-sh-source-root.service';
import {
  SKILLS_SH_METADATA_FILE,
  SKILLS_SH_NO_WORKSPACE_ERROR,
  SkillsShRootMetadataSchema,
  type SkillsShRootMetadata,
  verifyOwnedRoot,
} from './skills-sh-source-root';

const ROOT_ID = 'ptah-skillssh-anthropics-skills';

let homeDir: string;
let service: SkillsShSourceRootService;
let logger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

/** Absolute path a slug is expected to live at once installed. */
const slugPath = (slug: string, rootId = ROOT_ID): string =>
  path.join(homeDir, '.ptah', 'plugins', rootId, 'skills', slug);

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Make `stageSkillsInstall` behave like the measured CLI: write each slug under
 * `{stagingDir}/.claude/skills/<slug>/SKILL.md` and report success.
 */
function stageWrites(slugs: string[], body = 'body'): void {
  stageSkillsInstallMock.mockImplementation(
    async (_request: SkillInstallRequest, stagingDir: string) => {
      for (const slug of slugs) {
        const dir = path.join(stagingDir, ...STAGED_SKILLS_REL, slug);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, 'SKILL.md'),
          `---\nname: ${slug}\ndescription: ${slug} description\n---\n\n${body}\n`,
          'utf8',
        );
      }
      return { success: true };
    },
  );
}

/** Put a slug in its source root without going through `install`. */
async function seed(slug: string, source = 'anthropics/skills'): Promise<void> {
  const dir = slugPath(slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\ndescription: ${slug} description\n---\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(homeDir, '.ptah', 'plugins', ROOT_ID, SKILLS_SH_METADATA_FILE),
    JSON.stringify({
      version: 1,
      source,
      skillIds: [slug],
      installedAt: '2026-08-18T00:00:00.000Z',
    }),
    'utf8',
  );
}

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillssh-spec-'));
  logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  service = new SkillsShSourceRootService(logger as unknown as never, homeDir);
  stageSkillsInstallMock.mockReset();
});

afterEach(async () => {
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('SkillsShSourceRootService — install lands in the source root', () => {
  jest.setTimeout(30_000);
  it('writes the skill under ~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>', async () => {
    stageWrites(['frontend-design']);

    const outcome = await service.install({
      source: 'anthropics/skills',
      skillId: 'frontend-design',
    });

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      rootDir: path.join(homeDir, '.ptah', 'plugins', ROOT_ID),
      scope: 'global',
      slugs: ['frontend-design'],
    });
    await expect(
      exists(path.join(slugPath('frontend-design'), 'SKILL.md')),
    ).resolves.toBe(true);
  });

  it('is overlay-only — nothing is mirrored into ~/.ptah/user/skills', async () => {
    stageWrites(['frontend-design']);

    await service.install({ source: 'anthropics/skills' });

    // A user-layer clone is create-if-absent and the user layer is the desired
    // state's BASE, so a copy there would outlive uninstall and keep
    // propagating into every target forever.
    await expect(
      exists(path.join(homeDir, '.ptah', 'user', 'skills')),
    ).resolves.toBe(false);
  });

  it('records the exact owner/repo, which the directory name cannot round-trip', async () => {
    stageWrites(['frontend-design']);

    await service.install({ source: 'anthropics/skills' });

    const raw = await fs.readFile(
      path.join(homeDir, '.ptah', 'plugins', ROOT_ID, SKILLS_SH_METADATA_FILE),
      'utf8',
    );
    const parsed = SkillsShRootMetadataSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.source).toBe('anthropics/skills');
    expect(parsed.success && parsed.data.skillIds).toEqual(['frontend-design']);
  });

  it('writes every slug of a whole-repo install and unions the record on re-install', async () => {
    stageWrites(['a', 'b', 'c']);
    await service.install({ source: 'anthropics/skills' });

    stageWrites(['c', 'd']);
    const second = await service.install({ source: 'anthropics/skills' });

    expect(second).toEqual({
      success: true,
      rootId: ROOT_ID,
      rootDir: path.join(homeDir, '.ptah', 'plugins', ROOT_ID),
      scope: 'global',
      slugs: ['c', 'd'],
    });
    const listed = await service.listInstalled();
    // `a` and `b` survive a later single-skill install of the same source.
    expect(listed.map((s) => s.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves no staging directory behind', async () => {
    stageWrites(['frontend-design']);

    await service.install({ source: 'anthropics/skills' });

    const tmp = path.join(homeDir, '.ptah', 'tmp');
    const leftovers = await fs.readdir(tmp).catch(() => []);
    expect(leftovers).toEqual([]);
  });

  it('installs nothing when the CLI reports success but wrote no readable skill', async () => {
    stageSkillsInstallMock.mockResolvedValue({ success: true });

    const outcome = await service.install({ source: 'anthropics/skills' });

    expect(outcome.success).toBe(false);
    await expect(
      exists(path.join(homeDir, '.ptah', 'plugins', ROOT_ID)),
    ).resolves.toBe(false);
  });

  it('surfaces a CLI failure without creating a root', async () => {
    stageSkillsInstallMock.mockResolvedValue({
      success: false,
      error: 'network down',
    });

    const outcome = await service.install({ source: 'anthropics/skills' });

    expect(outcome).toEqual({ success: false, error: 'network down' });
    await expect(
      exists(path.join(homeDir, '.ptah', 'plugins', ROOT_ID)),
    ).resolves.toBe(false);
  });
});

/**
 * `source` becomes a directory name AND a spawned process argument. This block
 * is the service-level half of that guarantee; the RPC boundary has its own.
 */
describe('SkillsShSourceRootService — hostile input never reaches the filesystem', () => {
  it.each([
    ['traversal that SAFE_SOURCE_PATTERN alone accepts', '../..'],
    ['deeper traversal', '../../../../etc/passwd'],
    ['no separator at all', 'not-a-slug'],
    ['a leading separator', '/etc/passwd'],
    ['a shell metacharacter', 'owner/repo; rm -rf ~'],
    ['an empty string', ''],
  ])('refuses %s', async (_label, source) => {
    const outcome = await service.install({ source });

    expect(outcome.success).toBe(false);
    expect(stageSkillsInstallMock).not.toHaveBeenCalled();
    await expect(exists(path.join(homeDir, '.ptah', 'plugins'))).resolves.toBe(
      false,
    );
  });

  // `skillId` is guarded one layer down, inside `stageSkillsInstall`, where it
  // is checked against the SAME rule immediately before the spawn. That layer
  // is stubbed here on purpose, so its rejections are pinned against the real
  // code in `skills-sh-cli.spec.ts` rather than against this stub.
});

describe('SkillsShSourceRootService — uninstall reaps', () => {
  it('removes the slug and, with the last one, the whole root', async () => {
    await seed('frontend-design');

    const outcome = await service.uninstall('frontend-design');

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      removedRoot: true,
    });
    await expect(
      exists(path.join(homeDir, '.ptah', 'plugins', ROOT_ID)),
    ).resolves.toBe(false);
  });

  it('keeps the root and the remaining slugs when more than one is installed', async () => {
    stageWrites(['a', 'b']);
    await service.install({ source: 'anthropics/skills' });

    const outcome = await service.uninstall('a');

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      removedRoot: false,
    });
    await expect(exists(slugPath('a'))).resolves.toBe(false);
    await expect(exists(slugPath('b'))).resolves.toBe(true);
    expect((await service.listInstalled()).map((s) => s.name)).toEqual(['b']);
  });

  it('reports a miss instead of deleting something else', async () => {
    await seed('frontend-design');

    const outcome = await service.uninstall('never-installed');

    expect(outcome.success).toBe(false);
    await expect(exists(slugPath('frontend-design'))).resolves.toBe(true);
  });
});

describe('SkillsShSourceRootService — reading', () => {
  it('reports installs from the source roots, not from .claude/skills', async () => {
    // A skill sitting in the managed output directory must not be reported as
    // installed: `.claude/skills` is where a reconciled COPY lands.
    await fs.mkdir(path.join(homeDir, '.claude', 'skills', 'hand-written'), {
      recursive: true,
    });
    await seed('frontend-design');

    const installed = await service.listInstalled();

    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      name: 'frontend-design',
      source: 'anthropics/skills',
      description: 'frontend-design description',
      path: slugPath('frontend-design'),
      scope: 'global',
      agents: [],
    });
  });

  it('returns an empty set rather than throwing when nothing is installed', async () => {
    await expect(service.listInstalled()).resolves.toEqual([]);
    await expect(service.installedSlugs()).resolves.toEqual(new Set());
  });

  it('hides a retired global root kept on disk, as the plugin loader does', async () => {
    await seed('legacy');
    await writeRetired();

    await expect(service.listInstalled()).resolves.toEqual([]);
    await expect(service.installedSlugs()).resolves.toEqual(new Set());
    // The raw root listing still sees it (uninstall can still reach it).
    expect((await service.listRoots()).map((r) => r.id)).toEqual([ROOT_ID]);
  });

  it('never hides a workspace root whose id is in the retired registry', async () => {
    await installWorkspace(['a']);
    await writeRetired();

    const listed = await service.listInstalled(workspaceDir());

    expect(listed.map((s) => [s.name, s.scope])).toEqual([['a', 'workspace']]);
    await expect(service.installedSlugs(workspaceDir())).resolves.toEqual(
      new Set(['a']),
    );
  });

  it('an unreadable retired registry hides nothing and is logged', async () => {
    await seed('legacy');
    // A directory at the registry path makes the read fail with EISDIR.
    await fs.mkdir(path.join(globalPlugins(), SKILLS_SH_RETIRED_FILE), {
      recursive: true,
    });

    const listed = await service.listInstalled();

    expect(listed.map((s) => [s.name, s.scope])).toEqual([
      ['legacy', 'global'],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[skills.sh] Could not read the retired registry',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('lower-cases the install-badge lookup', async () => {
    await seed('Frontend-Design');

    await expect(service.installedSlugs()).resolves.toEqual(
      new Set(['frontend-design']),
    );
  });

  it('falls back to the slug when the record is unreadable, and keeps the skill', async () => {
    await seed('frontend-design');
    await fs.writeFile(
      path.join(homeDir, '.ptah', 'plugins', ROOT_ID, SKILLS_SH_METADATA_FILE),
      '{ not json',
      'utf8',
    );

    const installed = await service.listInstalled();

    expect(installed).toHaveLength(1);
    expect(installed[0].source).toBe('frontend-design');
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_853 D-3: scope roots, v2 ownership proof and Make global (D-D9)
// ---------------------------------------------------------------------------

const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const skillMd = (slug: string, body = 'body'): string =>
  `---\nname: ${slug}\ndescription: ${slug} description\n---\n\n${body}\n`;

/** An isolated workspace folder inside the temp home. */
const workspaceDir = (): string => path.join(homeDir, 'workspace');
const globalPlugins = (): string => path.join(homeDir, '.ptah', 'plugins');
const workspaceRootDir = (rootId = ROOT_ID): string =>
  path.join(workspaceDir(), '.ptah', 'plugins', rootId);
const globalRootDir = (rootId = ROOT_ID): string =>
  path.join(globalPlugins(), rootId);

async function readMeta(rootDir: string): Promise<SkillsShRootMetadata> {
  const raw = await fs.readFile(
    path.join(rootDir, SKILLS_SH_METADATA_FILE),
    'utf8',
  );
  return SkillsShRootMetadataSchema.parse(JSON.parse(raw));
}

async function writeMeta(rootDir: string, value: unknown): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, SKILLS_SH_METADATA_FILE),
    JSON.stringify(value),
    'utf8',
  );
}

async function installWorkspace(slugs: string[]): Promise<void> {
  stageWrites(slugs);
  const outcome = await service.install(
    { source: 'anthropics/skills' },
    { scope: 'workspace', workspaceRoot: workspaceDir() },
  );
  expect(outcome.success).toBe(true);
}

async function writeRetired(rootId = ROOT_ID): Promise<void> {
  await fs.mkdir(globalPlugins(), { recursive: true });
  await fs.writeFile(
    path.join(globalPlugins(), SKILLS_SH_RETIRED_FILE),
    JSON.stringify({
      version: 1,
      roots: { [rootId]: { retiredAt: '2026-10-01T00:00:00.000Z' } },
    }),
    'utf8',
  );
}

async function retiredIds(): Promise<string[]> {
  try {
    const raw = JSON.parse(
      await fs.readFile(
        path.join(globalPlugins(), SKILLS_SH_RETIRED_FILE),
        'utf8',
      ),
    ) as { roots: Record<string, unknown> };
    return Object.keys(raw.roots);
  } catch {
    return [];
  }
}

/** Entries directly under `~/.ptah/plugins` that look like staging leftovers. */
async function stagingLeftovers(): Promise<string[]> {
  try {
    return (await fs.readdir(globalPlugins())).filter((entry) =>
      entry.startsWith('.staging-'),
    );
  } catch {
    return [];
  }
}

interface RecordingHooks extends SkillsShMakeGlobalHooks {
  phases: SkillsShMakeGlobalPhase[];
  /** Every `keepSelected` call, in order. */
  kept: string[][];
}

function hooks(
  overrides: {
    register?: () => Promise<{ userLayerRefreshed: boolean }>;
    discovered?: boolean;
    keepSelected?: () => Promise<boolean>;
  } = {},
): RecordingHooks {
  const phases: SkillsShMakeGlobalPhase[] = [];
  const kept: string[][] = [];
  return {
    phases,
    kept,
    keepSelected: async (slugs) => {
      kept.push([...slugs]);
      return overrides.keepSelected ? overrides.keepSelected() : true;
    },
    propagate: async (phase) => {
      phases.push(phase);
      if (phase === 'register' && overrides.register) {
        return overrides.register();
      }
      return { userLayerRefreshed: true };
    },
    isDiscovered: async (dir) => (overrides.discovered ?? true) && exists(dir),
  };
}

/** Expect the workspace install to be intact, proven and listed. */
async function expectWorkspaceIntact(slug = 'a'): Promise<void> {
  const proof = await verifyOwnedRoot(workspaceRootDir());
  expect(proof.status).toBe('owned');
  const listed = await service.listInstalled(workspaceDir());
  expect(listed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: slug, scope: 'workspace' }),
    ]),
  );
}

describe('SkillsShSourceRootService — workspace and global roots (D-3)', () => {
  jest.setTimeout(30_000);

  it('installs into workspacePluginsDir(ws)/ptah-skillssh-<id> with v2 workspace metadata hashed from the written bytes', async () => {
    stageWrites(['a'], 'hello');

    const outcome = await service.install(
      { source: 'anthropics/skills' },
      { scope: 'workspace', workspaceRoot: workspaceDir() },
    );

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      rootDir: workspaceRootDir(),
      scope: 'workspace',
      slugs: ['a'],
    });
    expect(await readMeta(workspaceRootDir())).toEqual({
      version: 2,
      owner: 'ptah',
      ownerMarker: SKILLS_SH_OWNER_MARKER,
      source: 'anthropics/skills',
      skillIds: ['a'],
      installedAt: expect.any(String),
      scope: 'workspace',
      files: { 'skills/a/SKILL.md': sha256(skillMd('a', 'hello')) },
    });
    await expect(exists(globalRootDir())).resolves.toBe(false);
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual(
      expect.objectContaining({ status: 'owned' }),
    );
  });

  it('refuses a workspace install with no workspace open, with the exact copy, and stages nothing', async () => {
    stageWrites(['a']);

    const outcome = await service.install(
      { source: 'anthropics/skills' },
      { scope: 'workspace', workspaceRoot: undefined },
    );

    expect(outcome).toEqual({
      success: false,
      error:
        'No workspace is open. Nothing was installed. Choose All workspaces to install for every workspace.',
    });
    expect(SKILLS_SH_NO_WORKSPACE_ERROR).toBe(
      'No workspace is open. Nothing was installed. Choose All workspaces to install for every workspace.',
    );
    expect(stageSkillsInstallMock).not.toHaveBeenCalled();
  });

  it('writes owned v2 metadata for a global install too', async () => {
    stageWrites(['a']);
    await service.install({ source: 'anthropics/skills' });

    const proof = await verifyOwnedRoot(globalRootDir());
    expect(proof.status).toBe('owned');
    expect(proof.status === 'owned' && proof.metadata.scope).toBe('global');
  });

  it('never stages under the workspace plugins dir, so no extra ptah-skillssh-* root appears there', async () => {
    let stagedAt = '';
    stageSkillsInstallMock.mockImplementation(
      async (_request: SkillInstallRequest, stagingDir: string) => {
        stagedAt = stagingDir;
        const dir = path.join(stagingDir, ...STAGED_SKILLS_REL, 'a');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'SKILL.md'), skillMd('a'), 'utf8');
        return { success: true };
      },
    );

    await service.install(
      { source: 'anthropics/skills' },
      { scope: 'workspace', workspaceRoot: workspaceDir() },
    );

    expect(
      stagedAt.startsWith(path.join(workspaceDir(), '.ptah', 'plugins')),
    ).toBe(false);
    expect(
      await fs.readdir(path.join(workspaceDir(), '.ptah', 'plugins')),
    ).toEqual([ROOT_ID]);
  });

  it('lists workspace and global roots, each with its scope, and only the given workspace', async () => {
    await installWorkspace(['a']);
    stageWrites(['b']);
    await service.install({ source: 'other/repo' });

    const listed = await service.listInstalled(workspaceDir());
    expect(listed.map((s) => [s.name, s.scope]).sort()).toEqual([
      ['a', 'workspace'],
      ['b', 'global'],
    ]);
    expect((await service.listInstalled()).map((s) => s.name)).toEqual(['b']);
    const roots = await service.listRoots(workspaceDir());
    expect(roots.map((r) => r.metadata?.version)).toEqual([2, 2]);
  });

  it('reads a v1 root (provenance only) next to v2 roots', async () => {
    await seed('legacy');
    const [root] = await service.listRoots();
    expect(root.metadata).toEqual({
      version: 1,
      source: 'anthropics/skills',
      skillIds: ['legacy'],
      installedAt: '2026-08-18T00:00:00.000Z',
    });
    await expect(verifyOwnedRoot(root.dir)).resolves.toEqual({
      status: 'unproven',
      reason: 'legacy-v1',
    });
  });

  it('a global install over a retired id clears that id from the retired registry', async () => {
    await writeRetired();
    stageWrites(['a']);

    await service.install({ source: 'anthropics/skills' });

    expect(await retiredIds()).toEqual([]);
  });

  it('a re-install over a v1 root hashes only what it wrote and leaves the legacy files unlisted (unproven)', async () => {
    await seed('legacy');
    stageWrites(['fresh']);

    await service.install({ source: 'anthropics/skills' });

    const meta = await readMeta(globalRootDir());
    expect(meta.version === 2 && Object.keys(meta.files)).toEqual([
      'skills/fresh/SKILL.md',
    ]);
    await expect(verifyOwnedRoot(globalRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'unlisted-file',
      path: 'skills/legacy/SKILL.md',
    });
  });

  it('uninstall from a workspace root keeps the v2 record consistent', async () => {
    await installWorkspace(['a', 'b']);

    const outcome = await service.uninstall('a', {
      scope: 'workspace',
      workspaceRoot: workspaceDir(),
    });

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      removedRoot: false,
    });
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual(
      expect.objectContaining({ status: 'owned' }),
    );
  });
});

describe('verifyOwnedRoot — ownership is proven only by v2 metadata and every hash (D-D8)', () => {
  jest.setTimeout(30_000);

  beforeEach(async () => {
    await installWorkspace(['a']);
  });

  it('is owned for v2 + owner + marker + all hashes and no extras', async () => {
    const proof = await verifyOwnedRoot(workspaceRootDir());
    expect(proof.status).toBe('owned');
  });

  it('is unproven without the marker', async () => {
    const rest: Record<string, unknown> = {
      ...(await readMeta(workspaceRootDir())),
    };
    delete rest['ownerMarker'];
    await writeMeta(workspaceRootDir(), rest);
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'metadata-invalid',
    });
  });

  it('is unproven with a wrong marker or a wrong owner', async () => {
    const meta = await readMeta(workspaceRootDir());
    await writeMeta(workspaceRootDir(), {
      ...meta,
      ownerMarker: 'someone.else',
    });
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'wrong-marker',
    });
    await writeMeta(workspaceRootDir(), { ...meta, owner: 'skills-cli' });
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'wrong-owner',
    });
  });

  it('is unproven for v1 metadata', async () => {
    await writeMeta(workspaceRootDir(), {
      version: 1,
      source: 'anthropics/skills',
      skillIds: ['a'],
      installedAt: '2026-08-18T00:00:00.000Z',
    });
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'legacy-v1',
    });
  });

  it('is unproven when one listed file was edited', async () => {
    await fs.writeFile(
      path.join(workspaceRootDir(), 'skills', 'a', 'SKILL.md'),
      'edited by the user',
      'utf8',
    );
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'hash-mismatch',
      path: 'skills/a/SKILL.md',
    });
  });

  it('is unproven with one unlisted file', async () => {
    await fs.writeFile(
      path.join(workspaceRootDir(), 'skills', 'a', 'notes.md'),
      'mine',
      'utf8',
    );
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'unlisted-file',
      path: 'skills/a/notes.md',
    });
  });

  it('is unproven when a symlink sits under the root', async () => {
    await fs.symlink(
      path.join(workspaceRootDir(), 'skills', 'a', 'SKILL.md'),
      path.join(workspaceRootDir(), 'skills', 'a', 'link.md'),
    );
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'not-regular-file',
      path: 'skills/a/link.md',
    });
  });

  it('is unproven when a listed file was replaced by a symlink with identical content', async () => {
    const target = path.join(workspaceRootDir(), 'skills', 'a', 'SKILL.md');
    const outside = path.join(homeDir, 'outside.md');
    await fs.copyFile(target, outside);
    await fs.rm(target);
    await fs.symlink(outside, target);
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'not-regular-file',
      path: 'skills/a/SKILL.md',
    });
  });

  it('is unproven when the root itself is a symlink to an owned root', async () => {
    const linked = path.join(homeDir, 'linked-root');
    await fs.symlink(workspaceRootDir(), linked);
    await expect(verifyOwnedRoot(linked)).resolves.toEqual({
      status: 'unproven',
      reason: 'root-not-directory',
    });
  });

  it('is unproven for an escaping metadata path', async () => {
    const meta = await readMeta(workspaceRootDir());
    await writeMeta(workspaceRootDir(), {
      ...meta,
      files: { '../outside.md': sha256('x') },
    });
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'unsafe-path',
      path: '../outside.md',
    });
  });

  it('never infers ownership from the directory name or a user-layer clone sidecar', async () => {
    await fs.rm(path.join(workspaceRootDir(), SKILLS_SH_METADATA_FILE));
    const clone = path.join(homeDir, '.ptah', 'user', 'skills', 'a');
    await fs.mkdir(clone, { recursive: true });
    await fs.writeFile(
      path.join(clone, '.ptah-origin.json'),
      JSON.stringify({ sourceRef: `skills-sh:${ROOT_ID}` }),
      'utf8',
    );
    await expect(verifyOwnedRoot(workspaceRootDir())).resolves.toEqual({
      status: 'unproven',
      reason: 'metadata-missing',
    });
  });
});

/** Service whose filesystem steps can be made to fail one at a time. */
class FaultyService extends SkillsShSourceRootService {
  failMetadataIn: ((rootDir: string) => boolean) | null = null;
  failRemoveOf: ((dir: string) => boolean) | null = null;

  protected override async writeMetadata(
    rootDir: string,
    metadata: SkillsShRootMetadata,
  ): Promise<void> {
    if (this.failMetadataIn?.(rootDir)) {
      throw new Error('injected metadata write failure');
    }
    return super.writeMetadata(rootDir, metadata);
  }

  protected override async removeRootDir(dir: string): Promise<void> {
    if (this.failRemoveOf?.(dir)) {
      throw new Error('injected removal failure');
    }
    return super.removeRootDir(dir);
  }
}

describe('SkillsShSourceRootService.makeGlobal — D-D9 order, rollback and resume', () => {
  jest.setTimeout(30_000);

  let faulty: FaultyService;

  beforeEach(async () => {
    faulty = new FaultyService(logger as unknown as never, homeDir);
    await installWorkspace(['a', 'b']);
  });

  it('converts the whole workspace root: global root owned, registered while the workspace root still exists, workspace root removed last', async () => {
    const seenDuringRegister: boolean[] = [];
    const h = hooks({
      register: async () => {
        seenDuringRegister.push(
          await exists(workspaceRootDir()),
          await exists(globalRootDir()),
        );
        return { userLayerRefreshed: true };
      },
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
      globalRootDir: globalRootDir(),
      convertedSkills: ['a', 'b'],
      resumed: false,
      workspaceRootRemoved: true,
    });
    expect(seenDuringRegister).toEqual([true, true]);
    expect(h.phases).toEqual(['register', 'workspace-removed']);
    const proof = await verifyOwnedRoot(globalRootDir());
    expect(proof.status === 'owned' && proof.metadata.scope).toBe('global');
    await expect(exists(workspaceRootDir())).resolves.toBe(false);
    expect(await stagingLeftovers()).toEqual([]);
  });

  it('global metadata write failure: staging discarded, workspace intact, nothing global, retry succeeds', async () => {
    faulty.failMetadataIn = (dir) =>
      path.basename(dir).startsWith('.staging-ptah-skillssh-');
    const h = hooks();

    const outcome = await faulty.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'metadata-write-failed',
        error: 'Could not change where a is installed.',
      }),
    );
    expect(h.phases).toEqual([]);
    await expect(exists(globalRootDir())).resolves.toBe(false);
    expect(await stagingLeftovers()).toEqual([]);
    await expectWorkspaceIntact();

    faulty.failMetadataIn = null;
    const retry = await faulty.makeGlobal('a', workspaceDir(), hooks());
    expect(retry).toEqual(expect.objectContaining({ success: true }));
  });

  it('propagation rejection: global root rolled back, retired entry restored, workspace intact, retry succeeds', async () => {
    await writeRetired();
    const h = hooks({
      register: async () => {
        throw new Error('reconcile crashed');
      },
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'propagation-failed',
        rollbackComplete: true,
      }),
    );
    expect(h.phases).toEqual(['register', 'rollback']);
    await expect(exists(globalRootDir())).resolves.toBe(false);
    expect(await retiredIds()).toEqual([ROOT_ID]);
    await expectWorkspaceIntact();

    const retry = await service.makeGlobal('a', workspaceDir(), hooks());
    expect(retry).toEqual(expect.objectContaining({ success: true }));
    expect(await retiredIds()).toEqual([]);
  });

  it('propagation that leaves the user layer unrefreshed counts as a failure and rolls back', async () => {
    await writeRetired();
    const h = hooks({ register: async () => ({ userLayerRefreshed: false }) });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'propagation-failed',
        rollbackComplete: true,
      }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(false);
    expect(await retiredIds()).toEqual([ROOT_ID]);
    await expectWorkspaceIntact();
  });

  it('validation failure (loader does not discover the root): rolled back, workspace intact, retry succeeds', async () => {
    const outcome = await service.makeGlobal(
      'a',
      workspaceDir(),
      hooks({ discovered: false }),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'validation-failed',
        rollbackComplete: true,
      }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(false);
    await expectWorkspaceIntact();

    const retry = await service.makeGlobal('a', workspaceDir(), hooks());
    expect(retry).toEqual(
      expect.objectContaining({ success: true, workspaceRootRemoved: true }),
    );
  });

  it('rollback failure leaves an owned, complete global root and the next call resumes at step 6', async () => {
    faulty.failRemoveOf = (dir) => dir === globalRootDir();

    const outcome = await faulty.makeGlobal(
      'a',
      workspaceDir(),
      hooks({ discovered: false }),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'validation-failed',
        rollbackComplete: false,
      }),
    );
    await expect(verifyOwnedRoot(globalRootDir())).resolves.toEqual(
      expect.objectContaining({ status: 'owned' }),
    );
    await expectWorkspaceIntact();

    faulty.failRemoveOf = null;
    const h = hooks();
    const retry = await faulty.makeGlobal('a', workspaceDir(), h);
    expect(retry).toEqual(
      expect.objectContaining({
        success: true,
        resumed: true,
        workspaceRootRemoved: true,
      }),
    );
    expect(h.phases).toEqual(['register', 'workspace-removed']);
  });

  it('workspace-root removal failure is reported done; the retry removes only the workspace root', async () => {
    faulty.failRemoveOf = (dir) => dir === workspaceRootDir();

    const outcome = await faulty.makeGlobal('a', workspaceDir(), hooks());

    expect(outcome).toEqual(
      expect.objectContaining({
        success: true,
        resumed: false,
        workspaceRootRemoved: false,
      }),
    );
    await expectWorkspaceIntact();
    const globalBefore = await readMeta(globalRootDir());

    faulty.failRemoveOf = null;
    const retry = await faulty.makeGlobal('a', workspaceDir(), hooks());

    expect(retry).toEqual(
      expect.objectContaining({
        success: true,
        resumed: true,
        workspaceRootRemoved: true,
      }),
    );
    await expect(exists(workspaceRootDir())).resolves.toBe(false);
    // The global root was reused, not rewritten.
    expect(await readMeta(globalRootDir())).toEqual(globalBefore);
  });

  it('a workspace root edited during the conversion is kept, never removed', async () => {
    const h = hooks({
      register: async () => {
        await fs.writeFile(
          path.join(workspaceRootDir(), 'skills', 'a', 'SKILL.md'),
          'edited mid-conversion',
          'utf8',
        );
        return { userLayerRefreshed: true };
      },
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({ success: true, workspaceRootRemoved: false }),
    );
    await expect(
      fs.readFile(
        path.join(workspaceRootDir(), 'skills', 'a', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('edited mid-conversion');
  });

  it('keeps the moved slugs selected in the workspace before removing the workspace root', async () => {
    const h = hooks({
      keepSelected: async () => {
        // Called while the workspace root still exists (step 8, before removal).
        await expectWorkspaceIntact();
        return true;
      },
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({ success: true, workspaceRootRemoved: true }),
    );
    // The whole root converts, so every slug it holds stays selected.
    expect(h.kept).toEqual([['a', 'b']]);
    expect(h.phases).toEqual(['register', 'workspace-removed']);
  });

  it('a selection that cannot be recorded keeps the workspace root; the retry finishes', async () => {
    const h = hooks({ keepSelected: async () => false });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({ success: true, workspaceRootRemoved: false }),
    );
    expect(h.phases).toEqual(['register']);
    await expectWorkspaceIntact();
    await expect(
      verifyOwnedRoot(globalRootDir()),
    ).resolves.toEqual(expect.objectContaining({ status: 'owned' }));

    const retry = await service.makeGlobal('a', workspaceDir(), hooks());
    expect(retry).toEqual(
      expect.objectContaining({
        success: true,
        resumed: true,
        workspaceRootRemoved: true,
      }),
    );
  });

  it('refuses when a different owned global install exists, changing nothing', async () => {
    stageWrites(['a'], 'a different global body');
    await service.install({ source: 'anthropics/skills' });
    const before = await readMeta(globalRootDir());

    const h = hooks();
    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual(
      expect.objectContaining({ success: false, code: 'global-collision' }),
    );
    expect(h.phases).toEqual([]);
    expect(await readMeta(globalRootDir())).toEqual(before);
    await expectWorkspaceIntact();
    expect(await stagingLeftovers()).toEqual([]);
  });

  it('refuses when an unproven (legacy v1) global root exists', async () => {
    await seed('a');

    const outcome = await service.makeGlobal('a', workspaceDir(), hooks());

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'global-collision',
        reason: 'legacy-v1',
      }),
    );
    await expectWorkspaceIntact();
  });

  it('resumes from an owned global root with equal hashes instead of refusing', async () => {
    await fs.mkdir(globalPlugins(), { recursive: true });
    await fs.cp(workspaceRootDir(), globalRootDir(), { recursive: true });
    const meta = await readMeta(globalRootDir());
    await writeMeta(globalRootDir(), { ...meta, scope: 'global' });

    const outcome = await service.makeGlobal('a', workspaceDir(), hooks());

    expect(outcome).toEqual(
      expect.objectContaining({
        success: true,
        resumed: true,
        workspaceRootRemoved: true,
      }),
    );
  });

  it('propagation failure over a pre-existing matching global root keeps that global root', async () => {
    await fs.mkdir(globalPlugins(), { recursive: true });
    await fs.cp(workspaceRootDir(), globalRootDir(), { recursive: true });
    const meta = await readMeta(globalRootDir());
    await writeMeta(globalRootDir(), { ...meta, scope: 'global' });
    const globalBefore = await readMeta(globalRootDir());
    const h = hooks({
      register: async () => {
        throw new Error('reconcile crashed at /secret/path');
      },
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), h);

    expect(outcome).toEqual({
      success: false,
      code: 'propagation-failed',
      error: 'Could not change where a is installed.',
      rootId: ROOT_ID,
      rollbackComplete: true,
    });
    expect(h.phases).toEqual(['register', 'rollback']);
    await expect(verifyOwnedRoot(globalRootDir())).resolves.toEqual(
      expect.objectContaining({ status: 'owned' }),
    );
    expect(await readMeta(globalRootDir())).toEqual(globalBefore);
    await expectWorkspaceIntact();
  });

  it('validation failure over a pre-existing matching global root keeps that global root', async () => {
    await fs.mkdir(globalPlugins(), { recursive: true });
    await fs.cp(workspaceRootDir(), globalRootDir(), { recursive: true });
    const meta = await readMeta(globalRootDir());
    await writeMeta(globalRootDir(), { ...meta, scope: 'global' });

    const outcome = await service.makeGlobal(
      'a',
      workspaceDir(),
      hooks({ discovered: false }),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'validation-failed',
        rollbackComplete: true,
      }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(true);
    await expectWorkspaceIntact();
  });

  it('refuses an unproven workspace root (extra file) and writes nothing', async () => {
    await fs.writeFile(
      path.join(workspaceRootDir(), 'skills', 'a', 'mine.md'),
      'x',
      'utf8',
    );

    const outcome = await service.makeGlobal('a', workspaceDir(), hooks());

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'workspace-root-unproven',
        reason: 'unlisted-file',
      }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(false);
    expect(await stagingLeftovers()).toEqual([]);
  });

  it('refuses a v1 workspace root and writes nothing', async () => {
    await writeMeta(workspaceRootDir(), {
      version: 1,
      source: 'anthropics/skills',
      skillIds: ['a', 'b'],
      installedAt: '2026-08-18T00:00:00.000Z',
    });

    const outcome = await service.makeGlobal('a', workspaceDir(), hooks());

    expect(outcome).toEqual(
      expect.objectContaining({
        success: false,
        code: 'workspace-root-unproven',
        reason: 'legacy-v1',
      }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(false);
  });

  it('reports no-workspace and not-installed without touching anything', async () => {
    await expect(service.makeGlobal('a', undefined, hooks())).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'no-workspace' }),
    );
    await expect(
      service.makeGlobal('missing', workspaceDir(), hooks()),
    ).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'not-installed' }),
    );
    await expect(exists(globalRootDir())).resolves.toBe(false);
  });
});
