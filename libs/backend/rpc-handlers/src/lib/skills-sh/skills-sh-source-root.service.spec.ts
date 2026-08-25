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
 * What it pins:
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
import { SkillsShSourceRootService } from './skills-sh-source-root.service';
import {
  SKILLS_SH_METADATA_FILE,
  SkillsShRootMetadataSchema,
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
  it('writes the skill under ~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>', async () => {
    stageWrites(['frontend-design']);

    const outcome = await service.install({
      source: 'anthropics/skills',
      skillId: 'frontend-design',
    });

    expect(outcome).toEqual({
      success: true,
      rootId: ROOT_ID,
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
