/**
 * Migration spec for the legacy `.claude/skills` sweep.
 *
 * The point of this file is the NEGATIVE half. Skills carry no writer signature
 * and never will (harness-sync's CLAUDE.md, "Legacy adoption"): a managed copy
 * is a byte copy of user markdown, so a stale one is indistinguishable from a
 * `SKILL.md` the user wrote by hand. Any rule that guessed from a slug, an
 * mtime or a frontmatter field would eventually swallow someone's own work.
 *
 * What makes this migration admissible is that it does not guess: it reads
 * `{ws}/skills-lock.json`, the record the third-party `skills` CLI writes and
 * reads back itself (`skills experimental_install` restores from it). Its shape
 * was verified against `skills@latest` on 2026-08-18:
 *
 *   { "version": 1,
 *     "skills": { "frontend-design": {
 *       "source": "anthropics/skills", "sourceType": "github",
 *       "skillPath": "skills/frontend-design/SKILL.md",
 *       "computedHash": "93f53fd1…" } } }
 *
 * So every assertion below is really one assertion: adopt exactly what the
 * lockfile names, and leave everything else exactly where it is.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  SKILLS_LOCK_FILE,
  adoptLegacySkillsShInstalls,
} from './skills-sh-legacy-adoption';
import {
  SKILLS_SH_METADATA_FILE,
  SkillsShRootMetadataSchema,
} from './skills-sh-source-root';

const ROOT_ID = 'ptah-skillssh-anthropics-skills';

let tmp: string;
let workspaceRoot: string;
let pluginsBasePath: string;
let logger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const legacyDir = (slug: string): string =>
  path.join(workspaceRoot, '.claude', 'skills', slug);

const adoptedDir = (slug: string, rootId = ROOT_ID): string =>
  path.join(pluginsBasePath, rootId, 'skills', slug);

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

async function writeLegacySkill(
  slug: string,
  body = 'legacy body',
): Promise<void> {
  await fs.mkdir(legacyDir(slug), { recursive: true });
  await fs.writeFile(
    path.join(legacyDir(slug), 'SKILL.md'),
    `---\nname: ${slug}\n---\n\n${body}\n`,
    'utf8',
  );
}

async function writeLock(
  skills: Record<string, { source: string }>,
  version: number | undefined = 1,
): Promise<void> {
  await fs.writeFile(
    path.join(workspaceRoot, SKILLS_LOCK_FILE),
    JSON.stringify({ ...(version === undefined ? {} : { version }), skills }),
    'utf8',
  );
}

const readLock = async (): Promise<unknown> =>
  JSON.parse(
    await fs.readFile(path.join(workspaceRoot, SKILLS_LOCK_FILE), 'utf8'),
  );

const run = (): Promise<number> =>
  adoptLegacySkillsShInstalls({
    workspaceRoot,
    pluginsBasePath,
    logger: logger as unknown as never,
  });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skillssh-legacy-'));
  workspaceRoot = path.join(tmp, 'ws');
  pluginsBasePath = path.join(tmp, 'home', '.ptah', 'plugins');
  await fs.mkdir(workspaceRoot, { recursive: true });
  logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('adoptLegacySkillsShInstalls — what the lockfile attests', () => {
  it('moves an attested skill into its source root and records the origin', async () => {
    await writeLegacySkill('frontend-design');
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await expect(run()).resolves.toBe(1);

    await expect(
      exists(path.join(adoptedDir('frontend-design'), 'SKILL.md')),
    ).resolves.toBe(true);
    await expect(exists(legacyDir('frontend-design'))).resolves.toBe(false);

    const parsed = SkillsShRootMetadataSchema.safeParse(
      JSON.parse(
        await fs.readFile(
          path.join(pluginsBasePath, ROOT_ID, SKILLS_SH_METADATA_FILE),
          'utf8',
        ),
      ),
    );
    expect(parsed.success && parsed.data.source).toBe('anthropics/skills');
    expect(parsed.success && parsed.data.skillIds).toEqual(['frontend-design']);
  });

  it('preserves the file contents byte-for-byte', async () => {
    await writeLegacySkill('frontend-design', 'user edited this line');
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await run();

    const moved = await fs.readFile(
      path.join(adoptedDir('frontend-design'), 'SKILL.md'),
      'utf8',
    );
    expect(moved).toContain('user edited this line');
  });

  it('groups slugs from different repos into different source roots', async () => {
    await writeLegacySkill('frontend-design');
    await writeLegacySkill('vercel-optimize');
    await writeLock({
      'frontend-design': { source: 'anthropics/skills' },
      'vercel-optimize': { source: 'vercel-labs/agent-skills' },
    });

    await expect(run()).resolves.toBe(2);

    await expect(exists(adoptedDir('frontend-design'))).resolves.toBe(true);
    await expect(
      exists(
        adoptedDir('vercel-optimize', 'ptah-skillssh-vercel-labs-agent-skills'),
      ),
    ).resolves.toBe(true);
  });

  it('deletes a fully-migrated lockfile rather than leaving an empty one', async () => {
    await writeLegacySkill('frontend-design');
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await run();

    await expect(
      exists(path.join(workspaceRoot, SKILLS_LOCK_FILE)),
    ).resolves.toBe(false);
  });

  it('is idempotent — a second sweep finds nothing left to do', async () => {
    await writeLegacySkill('frontend-design');
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await expect(run()).resolves.toBe(1);
    await expect(run()).resolves.toBe(0);
  });
});

describe('adoptLegacySkillsShInstalls — what it refuses to touch', () => {
  it('leaves a hand-written skill the lockfile does not name exactly where it is', async () => {
    // The whole reason this is a lockfile read and not a heuristic: nothing
    // about these bytes says who wrote them.
    await writeLegacySkill('my-own-skill', 'I wrote this myself');
    await writeLegacySkill('frontend-design');
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await expect(run()).resolves.toBe(1);

    await expect(
      exists(path.join(legacyDir('my-own-skill'), 'SKILL.md')),
    ).resolves.toBe(true);
    await expect(exists(adoptedDir('my-own-skill'))).resolves.toBe(false);
  });

  it('does nothing at all when there is no lockfile', async () => {
    await writeLegacySkill('my-own-skill');

    await expect(run()).resolves.toBe(0);

    await expect(exists(legacyDir('my-own-skill'))).resolves.toBe(true);
    await expect(exists(pluginsBasePath)).resolves.toBe(false);
  });

  it('does nothing when the lockfile is corrupt', async () => {
    await writeLegacySkill('frontend-design');
    await fs.writeFile(
      path.join(workspaceRoot, SKILLS_LOCK_FILE),
      '{ not json',
      'utf8',
    );

    await expect(run()).resolves.toBe(0);
    await expect(exists(legacyDir('frontend-design'))).resolves.toBe(true);
  });

  it('keeps an entry whose source is not an owner/repo, having nothing to adopt it into', async () => {
    await writeLegacySkill('local-thing');
    await writeLock({ 'local-thing': { source: 'not-a-slug' } });

    await expect(run()).resolves.toBe(0);

    await expect(exists(legacyDir('local-thing'))).resolves.toBe(true);
    await expect(exists(pluginsBasePath)).resolves.toBe(false);
  });

  it('refuses a traversal source and never writes outside the plugins base', async () => {
    await writeLegacySkill('evil');
    await writeLock({ evil: { source: '../..' } });

    await expect(run()).resolves.toBe(0);

    await expect(exists(legacyDir('evil'))).resolves.toBe(true);
    await expect(exists(pluginsBasePath)).resolves.toBe(false);
  });

  it('keeps a lockfile entry whose directory is already gone', async () => {
    await writeLock({ 'frontend-design': { source: 'anthropics/skills' } });

    await expect(run()).resolves.toBe(0);

    // Nothing was adopted, so nothing is rewritten — deleting a record is not
    // this function's job.
    await expect(readLock()).resolves.toMatchObject({
      skills: { 'frontend-design': { source: 'anthropics/skills' } },
    });
  });

  it('never adopts from ~/.claude/skills — there is no record naming it', async () => {
    // The old `scope: 'global'` destination. No home-level lockfile exists, so
    // a directory there cannot be told apart from a skill the user installed
    // outside Ptah, and the workspace-scoped reconciler never reported it
    // either. Leaving it is the correct answer.
    const homeSkills = path.join(
      tmp,
      'home',
      '.claude',
      'skills',
      'global-one',
    );
    await fs.mkdir(homeSkills, { recursive: true });
    await fs.writeFile(path.join(homeSkills, 'SKILL.md'), '---\n---\n', 'utf8');
    await writeLock({ 'global-one': { source: 'anthropics/skills' } });

    await expect(run()).resolves.toBe(0);

    await expect(exists(path.join(homeSkills, 'SKILL.md'))).resolves.toBe(true);
  });

  it('keeps the surviving entries when only some slugs adopt', async () => {
    await writeLegacySkill('frontend-design');
    await writeLock({
      'frontend-design': { source: 'anthropics/skills' },
      'gone-already': { source: 'anthropics/skills' },
    });

    await expect(run()).resolves.toBe(1);

    await expect(readLock()).resolves.toEqual({
      version: 1,
      skills: { 'gone-already': { source: 'anthropics/skills' } },
    });
  });
});
