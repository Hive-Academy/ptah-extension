/**
 * `CommandDiscoveryService` — skill frontmatter tolerance specs.
 *
 * Two live defects, both observed while running the TUI against a real
 * workspace:
 *
 *  1. `angular-3d-scene-crafter` and `angular-gsap-animation-crafter` have
 *     `description:` values containing unquoted colons — legal for Claude
 *     Code's tolerant reader, a hard js-yaml error ("incomplete explicit
 *     mapping pair; a key node is missed") for gray-matter. The throw was
 *     caught and the skill was DROPPED from discovery entirely.
 *  2. `.claude/skills/dist/` has no SKILL.md, so every scan logged an ENOENT
 *     for a directory that simply is not a skill.
 *
 * `fs/promises` is mocked the same way `command-discovery.service.spec.ts`
 * does it, so no real filesystem is touched.
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
}));

import * as fs from 'fs/promises';

import { CommandDiscoveryService } from './command-discovery.service';

const readdirMock = fs.readdir as unknown as jest.Mock;
const readFileMock = fs.readFile as unknown as jest.Mock;

/**
 * The real description from `angular-3d-scene-crafter/SKILL.md`, abridged.
 * Joined with explicit `\n` so the fixture's line endings never depend on how
 * this source file happens to be checked out.
 */
const UNQUOTED_COLON_SKILL = [
  '---',
  'name: angular-3d-scene-crafter',
  'description: Interactive 3D scene designer for @hive-academy/angular-3d library. Use when users want to: (1) Create new 3D scenes, (2) Design visual effects',
  '---',
  '',
  '# Angular 3D Scene Crafter',
  '',
].join('\n');

function makeService(): CommandDiscoveryService {
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/tmp/ws'),
  };
  const fsProvider = { createFileWatcher: jest.fn() };
  const sentryService = { captureException: jest.fn() };
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(workspaceProvider, fsProvider, sentryService);
}

function dirEntry(name: string): unknown {
  return {
    name,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    isFile: () => false,
  };
}

function enoent(filePath: string): NodeJS.ErrnoException {
  const error = new Error(
    `ENOENT: no such file or directory, open '${filePath}'`,
  ) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

/**
 * Only the skills directory yields entries; every other readdir (custom
 * command dirs) resolves empty so discovery stays focused on skills.
 */
function stubSkillsDir(entries: readonly string[]): void {
  readdirMock.mockImplementation(async (dir: string) => {
    if (String(dir).replace(/\\/g, '/').includes('.claude/skills')) {
      return entries.map(dirEntry);
    }
    return [];
  });
}

describe('CommandDiscoveryService — skill frontmatter tolerance', () => {
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('unquoted colon in description (strict-YAML failure)', () => {
    beforeEach(() => {
      stubSkillsDir(['angular-3d-scene-crafter']);
      readFileMock.mockResolvedValue(UNQUOTED_COLON_SKILL);
    });

    it('still discovers the skill instead of dropping it', async () => {
      const result = await makeService().discoverCommands();

      const skill = result.commands?.find(
        (c) => c.name === 'angular-3d-scene-crafter',
      );
      expect(skill).toBeDefined();
      expect(skill?.scope).toBe('plugin');
    });

    it('recovers the full description verbatim past the colon', async () => {
      const result = await makeService().discoverCommands();

      const skill = result.commands?.find(
        (c) => c.name === 'angular-3d-scene-crafter',
      );
      expect(skill?.description).toContain('Interactive 3D scene designer');
      // Everything after the FIRST colon is taken verbatim — that is exactly
      // what strict YAML refuses to do.
      expect(skill?.description).toContain('Use when users want to: (1)');
    });

    it('reports the fallback at debug level, never as an error', async () => {
      await makeService().discoverCommands();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('using tolerant parse'),
      );
    });

    /**
     * gray-matter writes `matter.cache[content]` with the UNPARSED file object
     * before running the YAML parser, so the first throw poisons the cache
     * with `data: {}` and every later call returns that silently instead of
     * throwing. Discovery re-scans on each file-watcher event, so without the
     * cache opt-out the skill parses once, then degrades to a bare "Skill"
     * description forever — and never reaches the tolerant fallback.
     */
    it('survives a repeated scan of the same content (gray-matter cache poisoning)', async () => {
      const first = await makeService().discoverCommands();
      const second = await makeService().discoverCommands();

      const pick = (r: typeof first): string | undefined =>
        r.commands?.find((c) => c.name === 'angular-3d-scene-crafter')
          ?.description;

      expect(pick(first)).toContain('Interactive 3D scene designer');
      expect(pick(second)).toBe(pick(first));
      expect(pick(second)).not.toBe('Skill');
    });
  });

  describe('directory without SKILL.md', () => {
    beforeEach(() => {
      stubSkillsDir(['dist']);
      readFileMock.mockRejectedValue(
        enoent('D:/tmp/ws/.claude/skills/dist/SKILL.md'),
      );
    });

    it('skips it silently — no ENOENT noise', async () => {
      await makeService().discoverCommands();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot read SKILL.md'),
        expect.anything(),
      );
    });

    it('contributes no command', async () => {
      const result = await makeService().discoverCommands();

      expect(result.commands?.find((c) => c.name === 'dist')).toBeUndefined();
    });

    it('still logs non-ENOENT read failures', async () => {
      readFileMock.mockRejectedValue(new Error('EACCES: permission denied'));

      await makeService().discoverCommands();

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot read SKILL.md'),
        expect.stringContaining('EACCES'),
      );
    });
  });

  describe('well-formed frontmatter is unaffected', () => {
    it('parses a quoted description through the strict path', async () => {
      stubSkillsDir(['tidy-skill']);
      readFileMock.mockResolvedValue(
        [
          '---',
          'name: tidy-skill',
          'description: A plain description',
          '---',
          '',
        ].join('\n'),
      );

      const result = await makeService().discoverCommands();

      const skill = result.commands?.find((c) => c.name === 'tidy-skill');
      expect(skill?.description).toBe('A plain description');
      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('using tolerant parse'),
      );
    });

    it('falls back to the directory name when frontmatter has no name', async () => {
      stubSkillsDir(['nameless']);
      readFileMock.mockResolvedValue(
        ['---', 'description: Something: with a colon', '---', ''].join('\n'),
      );

      const result = await makeService().discoverCommands();

      const skill = result.commands?.find((c) => c.name === 'nameless');
      expect(skill).toBeDefined();
      expect(skill?.description).toBe('Something: with a colon');
    });
  });
});
