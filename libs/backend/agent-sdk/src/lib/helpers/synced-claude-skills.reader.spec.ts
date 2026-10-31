/**
 * Specs for the claude.ai account-synced skill reader (TASK_2026_853,
 * Phase B, Batch 9). Every case runs against a temp fixture config dir; the
 * developer's own `~/.claude` is never read or written.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearSyncedClaudeSkillsCache,
  readSyncedClaudeSkills,
  resolveClaudeConfigDir,
  syncedSkillApproxTokens,
  syncedSkillFromSkillFile,
  syncedSkillsFromManifest,
} from './synced-claude-skills.reader';

const ACCOUNT_A =
  '09058677-0000-4000-8000-000000000001_6563c852-0000-4000-8000-000000000001';
const ACCOUNT_B =
  '30263845-0000-4000-8000-000000000002_bf8d1b74-0000-4000-8000-000000000002';

let configDir: string;
const debug = jest.fn();
const logger = { debug };

function accountDir(account: string): string {
  const dir = join(configDir, 'skills', 'synced', account);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(
  account: string,
  skills: ReadonlyArray<{ name: string; description?: string }>,
): string {
  const file = join(accountDir(account), 'manifest.json');
  writeFileSync(
    file,
    JSON.stringify({
      lastUpdated: 1,
      skills: skills.map((skill) => ({
        skillId: skill.name,
        source: 'anthropic',
        updatedAt: '2026-10-30T00:00:00Z',
        ...skill,
      })),
    }),
  );
  return file;
}

function writeSkillFile(account: string, dir: string, text: string): string {
  const skillDir = join(accountDir(account), dir);
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, 'SKILL.md');
  writeFileSync(file, text);
  return file;
}

/** Every file and directory name under the fixture, to prove no write. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'ptah-synced-skills-'));
  clearSyncedClaudeSkillsCache();
  debug.mockReset();
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe('readSyncedClaudeSkills', () => {
  it('reads a manifest into qualified ids with descriptions and costs', async () => {
    writeManifest(ACCOUNT_A, [
      { name: 'pdf', description: 'Work with PDF files.' },
      { name: 'docs', description: 'Editable docs.' },
    ]);
    const skills = await readSyncedClaudeSkills(configDir, logger);
    expect(skills).toEqual([
      {
        id: 'anthropic-skills:docs',
        name: 'docs',
        description: 'Editable docs.',
        approxTokens: Math.ceil(
          '- anthropic-skills:docs: Editable docs.'.length / 2.64,
        ),
      },
      {
        id: 'anthropic-skills:pdf',
        name: 'pdf',
        description: 'Work with PDF files.',
        approxTokens: Math.ceil(
          '- anthropic-skills:pdf: Work with PDF files.'.length / 2.64,
        ),
      },
    ]);
  });

  it('never returns a bare name', async () => {
    writeManifest(ACCOUNT_A, [{ name: 'docs' }, { name: 'pdf' }]);
    const skills = await readSyncedClaudeSkills(configDir, logger);
    for (const skill of skills) {
      expect(skill.id.startsWith('anthropic-skills:')).toBe(true);
      expect(skill.id).toBe(`anthropic-skills:${skill.name}`);
    }
  });

  it('falls back to SKILL.md frontmatter when the manifest is missing', async () => {
    writeSkillFile(
      ACCOUNT_A,
      'docx',
      '---\nname: docx\ndescription: Word documents.\n---\n# body\n',
    );
    // Claude Code tolerates an unquoted colon; so does the fallback.
    writeSkillFile(
      ACCOUNT_A,
      'pptx',
      '---\nname: pptx\ndescription: Decks: slides and more\n---\n',
    );
    // No frontmatter name: the directory name is the skill name.
    writeSkillFile(ACCOUNT_A, 'xlsx', '---\ndescription: Sheets.\n---\n');
    // A directory without SKILL.md is not a skill.
    mkdirSync(join(accountDir(ACCOUNT_A), 'assets'), { recursive: true });
    const skills = await readSyncedClaudeSkills(configDir, logger);
    expect(skills.map((skill) => [skill.id, skill.description])).toEqual([
      ['anthropic-skills:docx', 'Word documents.'],
      ['anthropic-skills:pptx', 'Decks: slides and more'],
      ['anthropic-skills:xlsx', 'Sheets.'],
    ]);
  });

  it('dedupes the same skill across two accounts, first account folder wins', async () => {
    writeManifest(ACCOUNT_B, [
      { name: 'pdf', description: 'From B.' },
      { name: 'morning', description: 'Only in B.' },
    ]);
    writeManifest(ACCOUNT_A, [{ name: 'pdf', description: 'From A.' }]);
    const skills = await readSyncedClaudeSkills(configDir, logger);
    expect(skills.map((skill) => [skill.id, skill.description])).toEqual([
      ['anthropic-skills:morning', 'Only in B.'],
      ['anthropic-skills:pdf', 'From A.'],
    ]);
  });

  it('ignores the .bucket marker files next to the account folders', async () => {
    writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
    writeFileSync(
      join(configDir, 'skills', 'synced', `.bucket-${ACCOUNT_A}`),
      '',
    );
    const skills = await readSyncedClaudeSkills(configDir, logger);
    expect(skills.map((skill) => skill.id)).toEqual(['anthropic-skills:pdf']);
  });

  it('skips a name it cannot key exactly', async () => {
    writeManifest(ACCOUNT_A, [
      { name: 'pdf' },
      { name: 'has space' },
      { name: 'a:b' },
      { name: '' },
    ]);
    const skills = await readSyncedClaudeSkills(configDir, logger);
    expect(skills.map((skill) => skill.id)).toEqual(['anthropic-skills:pdf']);
  });

  it('missing synced directory → [] with a debug log', async () => {
    await expect(readSyncedClaudeSkills(configDir, logger)).resolves.toEqual(
      [],
    );
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('missing config directory → []', async () => {
    await expect(
      readSyncedClaudeSkills(join(configDir, 'nope'), logger),
    ).resolves.toEqual([]);
  });

  it.each([
    ['invalid JSON', '{ not json'],
    ['no skills array', JSON.stringify({ lastUpdated: 1 })],
    ['a skill without a name', JSON.stringify({ skills: [{ skillId: 'x' }] })],
    [
      'a non-string description',
      JSON.stringify({ skills: [{ name: 'pdf', description: 3 }] }),
    ],
  ])('malformed manifest (%s) → [] with a debug log', async (_case, body) => {
    writeManifest(ACCOUNT_B, [{ name: 'docs' }]);
    writeFileSync(join(accountDir(ACCOUNT_A), 'manifest.json'), body);
    await expect(readSyncedClaudeSkills(configDir, logger)).resolves.toEqual(
      [],
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Could not read'),
      { errorCode: 'EMANIFEST' },
    );
  });

  it('a SKILL.md without frontmatter → []', async () => {
    writeSkillFile(ACCOUNT_A, 'docx', '# no frontmatter\n');
    await expect(readSyncedClaudeSkills(configDir, logger)).resolves.toEqual(
      [],
    );
    expect(debug).toHaveBeenCalledWith(expect.any(String), {
      errorCode: 'EFRONTMATTER',
    });
  });

  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (process.platform === 'win32' || asRoot ? it.skip : it)(
    'a read error → [] and never throws',
    async () => {
      const synced = join(configDir, 'skills', 'synced');
      writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
      chmodSync(synced, 0o000);
      try {
        await expect(
          readSyncedClaudeSkills(configDir, logger),
        ).resolves.toEqual([]);
        expect(debug).toHaveBeenCalledWith(expect.any(String), {
          errorCode: 'EACCES',
        });
      } finally {
        chmodSync(synced, 0o755);
      }
    },
  );

  it('never writes, moves or deletes anything under the config dir', async () => {
    writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
    writeSkillFile(ACCOUNT_A, 'pdf', '---\nname: pdf\n---\n');
    writeSkillFile(ACCOUNT_B, 'docs', '---\nname: docs\n---\n');
    const before = tree(configDir);
    await readSyncedClaudeSkills(configDir, logger);
    await readSyncedClaudeSkills(configDir, logger);
    expect(tree(configDir)).toEqual(before);
  });

  describe('mtime cache per config dir', () => {
    it('reuses the result while the manifest is unchanged, re-reads after a change', async () => {
      const file = writeManifest(ACCOUNT_A, [
        { name: 'pdf', description: 'one' },
      ]);
      const stamp = new Date('2026-01-01T00:00:00Z');
      utimesSync(file, stamp, stamp);
      const first = await readSyncedClaudeSkills(configDir, logger);
      // Same size and mtime: the cached result is served, not the new text.
      writeManifest(ACCOUNT_A, [{ name: 'pdf', description: 'two' }]);
      utimesSync(file, stamp, stamp);
      expect(await readSyncedClaudeSkills(configDir, logger)).toEqual(first);
      // A real change moves the mtime: the manifest is read again.
      const later = new Date('2026-01-02T00:00:00Z');
      utimesSync(file, later, later);
      const third = await readSyncedClaudeSkills(configDir, logger);
      expect(third[0].description).toBe('two');
    });

    it('keeps one entry per config dir', async () => {
      writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
      const other = mkdtempSync(join(tmpdir(), 'ptah-synced-skills-other-'));
      try {
        mkdirSync(join(other, 'skills', 'synced', ACCOUNT_B), {
          recursive: true,
        });
        writeFileSync(
          join(other, 'skills', 'synced', ACCOUNT_B, 'manifest.json'),
          JSON.stringify({ skills: [{ name: 'docs' }] }),
        );
        expect(
          (await readSyncedClaudeSkills(configDir, logger)).map((s) => s.id),
        ).toEqual(['anthropic-skills:pdf']);
        expect(
          (await readSyncedClaudeSkills(other, logger)).map((s) => s.id),
        ).toEqual(['anthropic-skills:docs']);
        expect(
          (await readSyncedClaudeSkills(configDir, logger)).map((s) => s.id),
        ).toEqual(['anthropic-skills:pdf']);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    it('notices a new account folder', async () => {
      writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
      await readSyncedClaudeSkills(configDir, logger);
      writeManifest(ACCOUNT_B, [{ name: 'docs' }]);
      expect(
        (await readSyncedClaudeSkills(configDir, logger)).map((s) => s.id),
      ).toEqual(['anthropic-skills:docs', 'anthropic-skills:pdf']);
    });

    it('returns a copy, so a caller cannot change the cache', async () => {
      writeManifest(ACCOUNT_A, [{ name: 'pdf' }]);
      const first = await readSyncedClaudeSkills(configDir, logger);
      first.length = 0;
      expect(await readSyncedClaudeSkills(configDir, logger)).toHaveLength(1);
    });
  });
});

describe('synced reader pure helpers', () => {
  it('syncedSkillApproxTokens is ceil(listing chars / 2.64)', () => {
    expect(syncedSkillApproxTokens('anthropic-skills:a', '')).toBe(
      Math.ceil('- anthropic-skills:a: '.length / 2.64),
    );
  });

  it('syncedSkillsFromManifest keeps extra fields out of the result', () => {
    expect(
      syncedSkillsFromManifest({
        lastUpdated: 1,
        skills: [{ skillId: 'pdf', name: 'pdf', source: 'anthropic' }],
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'anthropic-skills:pdf',
        description: '',
      }),
    ]);
  });

  it('syncedSkillFromSkillFile prefers the frontmatter name', () => {
    expect(
      syncedSkillFromSkillFile('dir-name', '---\nname: real\n---\n')?.id,
    ).toBe('anthropic-skills:real');
  });
});

describe('resolveClaudeConfigDir', () => {
  it('takes the first non-blank CLAUDE_CONFIG_DIR in order', () => {
    expect(
      resolveClaudeConfigDir(
        [
          undefined,
          { CLAUDE_CONFIG_DIR: '  ' },
          { CLAUDE_CONFIG_DIR: '/named' },
          { CLAUDE_CONFIG_DIR: '/process' },
        ],
        '/home/u',
      ),
    ).toBe('/named');
  });

  it('falls back to <home>/.claude', () => {
    expect(resolveClaudeConfigDir([{}, undefined], '/home/u')).toBe(
      join('/home/u', '.claude'),
    );
  });
});
