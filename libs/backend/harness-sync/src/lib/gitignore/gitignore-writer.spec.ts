/**
 * E23 — the `.gitignore` managed block.
 *
 * The four properties the edge case names, plus the two that make them safe:
 * the block is added once, content outside it is preserved, a user deletion is
 * respected forever, and the setting turns it off.
 *
 * Every test gets its own `mkdtemp` directory. Nothing here may touch the
 * developer's real home or repo — this writer's whole job is editing a
 * `.gitignore`, and a spec that got the root wrong would edit THIS one.
 */

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  GITIGNORE_BEGIN,
  GITIGNORE_END,
  HarnessGitignoreWriter,
} from './gitignore-writer';
import { harnessStatePath, HarnessStateStore } from './harness-state-store';

const DIRS = ['.claude/skills', '.claude/commands', '.agents/skills'] as const;

/** What a full detection emits on this repo: `DIRS` plus the Codex agent dir. */
const DIRS_WITH_AGENTS = [...DIRS, '.codex/agents'] as const;

/**
 * The `.claude` section of THIS repo's own `.gitignore`, verbatim.
 *
 * It is a negation ladder — ignore everything, re-include the skills directory,
 * re-ignore its contents, un-ignore the one skill that is tracked — and it is
 * the exact shape that broke the literal line match. Kept as a fixture rather
 * than paraphrased, because a paraphrase would stop reproducing the defect the
 * moment someone "simplified" it.
 */
const NEGATION_LADDER = [
  'node_modules',
  '',
  '.claude/*',
  '',
  '!.claude/skills/',
  '.claude/skills/*',
  '!.claude/skills/video-showcase/',
  '!.claude/skills/video-showcase/**',
  '',
].join('\n');

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('HarnessGitignoreWriter (E23)', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'ptah-gitignore-'));
  });

  afterEach(() => {
    try {
      rmSync(ws, { recursive: true, force: true });
    } catch {
      // A locked file on Windows must not fail the suite.
    }
  });

  const gitignore = (): string => readFileSync(join(ws, '.gitignore'), 'utf-8');
  /** The patterns INSIDE the managed block, markers and preamble stripped. */
  const blockPatterns = (): string[] => {
    const text = gitignore();
    const start = text.indexOf(GITIGNORE_BEGIN);
    const end = text.indexOf(GITIGNORE_END);
    return text
      .slice(start + GITIGNORE_BEGIN.length, end)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  };
  const writer = (
    readManageGitignore?: () => boolean | undefined,
  ): HarnessGitignoreWriter =>
    new HarnessGitignoreWriter(
      fakeLogger(),
      readManageGitignore === undefined ? {} : { readManageGitignore },
    );

  describe('adding the block', () => {
    it('creates .gitignore with the block when none exists', () => {
      const result = writer().apply(ws, DIRS);

      expect(result.outcome).toBe('written');
      expect(result.patterns).toEqual([
        '.agents/skills/',
        '.claude/commands/',
        '.claude/skills/',
      ]);
      const text = gitignore();
      expect(text).toContain(GITIGNORE_BEGIN);
      expect(text).toContain(GITIGNORE_END);
      expect(text).toContain('.claude/skills/');
    });

    it('is idempotent — a second pass rewrites nothing', () => {
      writer().apply(ws, DIRS);
      const afterFirst = gitignore();

      const second = writer().apply(ws, DIRS);

      expect(second.outcome).toBe('unchanged');
      expect(gitignore()).toBe(afterFirst);
    });

    it('does not mistake its OWN entries for entries the user already ignored', () => {
      // The regression this guards: presence is tested against the file, so a
      // naive second pass finds every pattern present (it wrote them) and
      // empties the block it just created.
      writer().apply(ws, DIRS);
      writer().apply(ws, DIRS);

      expect(gitignore()).toContain('.claude/skills/');
    });

    it('sorts patterns so target iteration order is not a diff', () => {
      const forward = writer().apply(ws, ['.claude/skills', '.agents/skills']);
      const reverse = writer().apply(ws, ['.agents/skills', '.claude/skills']);

      expect(forward.patterns).toEqual(reverse.patterns);
    });

    it('writes nothing when there are no directories to ignore', () => {
      const result = writer().apply(ws, []);

      expect(result.outcome).toBe('nothing-to-ignore');
      expect(() => gitignore()).toThrow();
    });
  });

  describe('preserving what the user wrote', () => {
    it('keeps existing content byte-for-byte, including CRLF and no trailing newline', () => {
      const original = 'node_modules\r\ndist\r\n*.log';
      writeFileSync(join(ws, '.gitignore'), original, 'utf-8');

      writer().apply(ws, DIRS);

      const text = gitignore();
      expect(text.startsWith(original)).toBe(true);
      // The file is predominantly CRLF, so the block joins with CRLF too.
      expect(text).toContain(`${GITIGNORE_BEGIN}\r\n`);
    });

    it('leaves an LF file on LF', () => {
      writeFileSync(join(ws, '.gitignore'), 'dist\nbuild\n', 'utf-8');

      writer().apply(ws, DIRS);

      expect(gitignore()).not.toContain('\r\n');
    });

    it('skips a pattern the user already ignores, with or without a trailing slash', () => {
      writeFileSync(
        join(ws, '.gitignore'),
        'dist\n.claude/skills\n.agents/skills/\n',
        'utf-8',
      );

      const result = writer().apply(ws, DIRS);

      expect(result.patterns).toEqual(['.claude/commands/']);
      expect(result.outcome).toBe('written');
    });

    it('refuses to touch a file whose block was cut in half', () => {
      writeFileSync(
        join(ws, '.gitignore'),
        `dist\n${GITIGNORE_BEGIN}\n.claude/skills/\n`,
        'utf-8',
      );
      const before = gitignore();

      const result = writer().apply(ws, DIRS);

      expect(result.outcome).toBe('unchanged');
      expect(gitignore()).toBe(before);
    });

    it('replaces only the block when the directory set changes', () => {
      writeFileSync(join(ws, '.gitignore'), 'dist\n', 'utf-8');
      writer().apply(ws, DIRS);

      writer().apply(ws, ['.claude/skills']);

      const text = gitignore();
      expect(text).toContain('dist');
      expect(text).toContain('.claude/skills/');
      expect(text).not.toContain('.agents/skills/');
      // Exactly one block, never two.
      expect(text.split(GITIGNORE_BEGIN)).toHaveLength(2);
    });
  });

  /**
   * The presence test compares rule PATHS, not literal lines.
   *
   * The defect this section pins was found on this very repo. Its `.gitignore`
   * re-includes the tracked `.claude/skills/video-showcase` skill through a
   * `.claude/*` + negation ladder, and no line in it read exactly
   * `.claude/skills/` — so the old literal match appended one. A blanket
   * directory rule placed AFTER those negations re-ignores the whole subtree,
   * because git cannot re-include a file whose parent directory is excluded,
   * and a tracked skill silently dropped out of `git status`. The writer whose
   * job is to keep derived copies out of the diff had removed real source from
   * it.
   *
   * So the comparison runs in BOTH directions: an existing rule ABOVE the
   * candidate makes the line redundant, and an existing rule INSIDE the
   * candidate makes it dangerous. Both answers are "do not write it".
   */
  describe('rules that already talk about the path', () => {
    it('adds only what this repo does not already cover', () => {
      writeFileSync(join(ws, '.gitignore'), NEGATION_LADDER, 'utf-8');

      const result = writer().apply(ws, DIRS_WITH_AGENTS);

      // `.claude/*` covers both Claude dirs; the other two are genuinely new.
      expect(result.patterns).toEqual(['.agents/skills/', '.codex/agents/']);
      expect(blockPatterns()).toEqual(['.agents/skills/', '.codex/agents/']);
      // And the ladder itself is untouched, which is the whole point.
      expect(gitignore().startsWith(NEGATION_LADDER)).toBe(true);
    });

    it.each([
      '.claude/skills',
      '.claude/skills/',
      '.claude/skills/*',
      '.claude/skills/**',
      '.claude',
      '.claude/',
      '.claude/*',
      '.claude/**',
    ])('treats %s as already covering .claude/skills', (rule) => {
      const original = `dist\n${rule}\n`;
      writeFileSync(join(ws, '.gitignore'), original, 'utf-8');

      const result = writer().apply(ws, ['.claude/skills']);

      expect(result.patterns).toEqual([]);
      expect(result.outcome).toBe('nothing-to-ignore');
      expect(gitignore()).toBe(original);
    });

    it.each([
      '!.claude/skills/video-showcase/**',
      '!.claude/skills/video-showcase/',
      '.claude/skills/video-showcase/build/',
    ])('refuses to write a blanket rule over %s', (rule) => {
      // A rule mentioning something INSIDE the candidate means that subtree is
      // being managed deliberately. Appending `.claude/skills/` after it wins
      // by being later and defeats the intent, so the writer stays out.
      const original = `${rule}\n`;
      writeFileSync(join(ws, '.gitignore'), original, 'utf-8');

      const result = writer().apply(ws, ['.claude/skills']);

      expect(result.patterns).toEqual([]);
      expect(gitignore()).toBe(original);
    });

    it('is not fooled by a rule whose name merely starts the same way', () => {
      // The boundary is a path separator, not a string prefix: `.claude-worktrees`
      // has nothing to do with `.claude/skills`, and treating it as coverage
      // would leave derived copies in `git status` forever.
      writeFileSync(
        join(ws, '.gitignore'),
        '.claude-worktrees/\n.claudette\nclaude\nskills-lock.json\ndist\n',
        'utf-8',
      );

      const result = writer().apply(ws, ['.claude/skills']);

      expect(result.patterns).toEqual(['.claude/skills/']);
    });

    it('does not let a commented-out rule block a pattern', () => {
      writeFileSync(join(ws, '.gitignore'), '# .claude/skills/\n', 'utf-8');

      expect(writer().apply(ws, ['.claude/skills']).patterns).toEqual([
        '.claude/skills/',
      ]);
    });

    it('keeps the block stable on a second pass over the ladder', () => {
      // The block subtraction has to survive the path comparison, and it is
      // MORE load-bearing now than it was under the literal match: the block's
      // own `.agents/skills/` line does not merely equal the candidate, it
      // covers it. Without subtracting our own block first, pass two would find
      // every pattern covered, empty the block, and pass three would write it
      // again — a two-line diff oscillating forever.
      writeFileSync(join(ws, '.gitignore'), NEGATION_LADDER, 'utf-8');
      const first = writer().apply(ws, DIRS_WITH_AGENTS);
      expect(first.outcome).toBe('written');
      const afterFirst = gitignore();

      const second = writer().apply(ws, DIRS_WITH_AGENTS);

      expect(second.outcome).toBe('unchanged');
      expect(second.patterns).toEqual(first.patterns);
      expect(gitignore()).toBe(afterFirst);
    });
  });

  describe('respecting a user deletion', () => {
    it('records the deletion and never re-adds the block', () => {
      writer().apply(ws, DIRS);
      writeFileSync(join(ws, '.gitignore'), 'dist\n', 'utf-8');

      const noticed = writer().apply(ws, DIRS);
      expect(noticed.outcome).toBe('removed-by-user');

      const later = writer().apply(ws, DIRS);
      expect(later.outcome).toBe('removed-by-user');
      expect(gitignore()).toBe('dist\n');

      const state = new HarnessStateStore().load(ws);
      expect(state.gitignoreBlockRemovedByUser).toBe(true);
    });

    it('does not read a first run as a deletion', () => {
      writeFileSync(join(ws, '.gitignore'), 'dist\n', 'utf-8');

      expect(writer().apply(ws, DIRS).outcome).toBe('written');
    });

    it('forgets the deletion when the setting is toggled off and back on', () => {
      let enabled = true;
      const read = (): boolean => enabled;

      writer(read).apply(ws, DIRS);
      writeFileSync(join(ws, '.gitignore'), 'dist\n', 'utf-8');
      expect(writer(read).apply(ws, DIRS).outcome).toBe('removed-by-user');

      enabled = false;
      expect(writer(read).apply(ws, DIRS).outcome).toBe('disabled');

      enabled = true;
      expect(writer(read).apply(ws, DIRS).outcome).toBe('written');
      expect(gitignore()).toContain('.claude/skills/');
    });
  });

  describe('the harness.manageGitignore setting', () => {
    it('writes nothing when the setting is off', () => {
      const result = writer(() => false).apply(ws, DIRS);

      expect(result.outcome).toBe('disabled');
      expect(() => gitignore()).toThrow();
    });

    it('treats an unset setting as on', () => {
      expect(writer(() => undefined).apply(ws, DIRS).outcome).toBe('written');
    });

    it('treats a throwing reader as on rather than failing the pass', () => {
      const result = writer(() => {
        throw new Error('settings unavailable');
      }).apply(ws, DIRS);

      expect(result.outcome).toBe('written');
    });
  });

  describe('failure handling', () => {
    it('reports rather than throws when .gitignore is a directory', () => {
      mkdirSync(join(ws, '.gitignore'));

      const result = writer().apply(ws, DIRS);

      expect(result.outcome).toBe('failed');
      expect(result.reason).toBeDefined();
    });

    it('reads a corrupt state file as the default state', () => {
      mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
      writeFileSync(harnessStatePath(ws), '{ not json', 'utf-8');

      expect(writer().apply(ws, DIRS).outcome).toBe('written');
    });
  });
});
