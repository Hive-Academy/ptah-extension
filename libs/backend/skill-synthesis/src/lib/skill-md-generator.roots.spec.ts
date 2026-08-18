/**
 * TASK_2026_278 batch 1b — the unified skills root.
 *
 * `activeRoot()` hard-coded `~/.ptah/skills` while `candidatesRoot()` honoured
 * `skillSynthesis.candidatesDir`, and the user-layer mirror was told a third
 * root by its caller. Three producers, three opinions, and a promoted skill
 * that landed somewhere the mirror never looked.
 *
 * `skillSynthesis.skillsRoot` is now the one root both halves derive from, and
 * `resolveSkillsRoot` is exported so the host activation glue derives the
 * mirror's `synthesizedSkillsRoot` from it too.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SkillMdGenerator,
  resolveSkillsRoot,
  resolveCandidatesRoot,
  CANDIDATES_DIR_NAME,
  SKILLS_ROOT_KEY,
} from './skill-md-generator';

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
});

function makeWorkspace(
  values: Record<string, unknown>,
  onGet?: () => void,
): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_section: string, key: string, fallback?: T): T => {
      onGet?.();
      return (values[key] as T) ?? (fallback as T);
    },
  } as unknown as IWorkspaceProvider;
}

const DEFAULT_ROOT = path.join(os.homedir(), '.ptah', 'skills');

describe('resolveSkillsRoot', () => {
  it('is ~/.ptah/skills with no workspace provider at all', () => {
    expect(resolveSkillsRoot(null)).toBe(DEFAULT_ROOT);
  });

  it('is ~/.ptah/skills when the key is unset (the registered default is empty)', () => {
    expect(resolveSkillsRoot(makeWorkspace({}))).toBe(DEFAULT_ROOT);
  });

  it('honours an explicit skillSynthesis.skillsRoot', () => {
    const root = resolveSkillsRoot(
      makeWorkspace({ [SKILLS_ROOT_KEY]: '/data/ptah-skills' }),
    );
    expect(root).toBe('/data/ptah-skills');
  });

  it('treats a whitespace-only value as unset rather than as a relative root', () => {
    expect(resolveSkillsRoot(makeWorkspace({ [SKILLS_ROOT_KEY]: '   ' }))).toBe(
      DEFAULT_ROOT,
    );
  });

  it('falls back rather than propagating a settings read failure', () => {
    const throwing = {
      getConfiguration: () => {
        throw new Error('settings.json is unreadable');
      },
    } as unknown as IWorkspaceProvider;
    expect(resolveSkillsRoot(throwing)).toBe(DEFAULT_ROOT);
  });
});

describe('resolveCandidatesRoot', () => {
  it('follows the skills root by default — the two can no longer disagree', () => {
    const ws = makeWorkspace({ [SKILLS_ROOT_KEY]: '/data/ptah-skills' });
    expect(resolveCandidatesRoot(ws)).toBe(
      path.join('/data/ptah-skills', CANDIDATES_DIR_NAME),
    );
  });

  it('still lets an explicit candidatesDir override win', () => {
    const ws = makeWorkspace({ [SKILLS_ROOT_KEY]: '/data/ptah-skills' });
    expect(resolveCandidatesRoot(ws, '/scratch/cands')).toBe('/scratch/cands');
  });

  it('ignores an empty override (an unset setting is not a root)', () => {
    expect(resolveCandidatesRoot(null, '')).toBe(
      path.join(DEFAULT_ROOT, CANDIDATES_DIR_NAME),
    );
  });
});

describe('SkillMdGenerator root wiring', () => {
  it('derives BOTH roots from the one setting', () => {
    const gen = new SkillMdGenerator(
      makeLogger() as never,
      makeWorkspace({ [SKILLS_ROOT_KEY]: '/data/ptah-skills' }),
    );
    expect(gen.activeRoot()).toBe('/data/ptah-skills');
    expect(gen.candidatesRoot()).toBe(
      path.join('/data/ptah-skills', CANDIDATES_DIR_NAME),
    );
  });

  it('keeps the pre-existing behaviour when constructed without a workspace', () => {
    const gen = new SkillMdGenerator(makeLogger() as never);
    expect(gen.activeRoot()).toBe(DEFAULT_ROOT);
    expect(gen.candidatesRoot()).toBe(
      path.join(DEFAULT_ROOT, CANDIDATES_DIR_NAME),
    );
  });

  it('promoteToActive writes under the configured root, not under ~/.ptah/skills', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-root-unify-'));
    try {
      const gen = new SkillMdGenerator(
        makeLogger() as never,
        makeWorkspace({ [SKILLS_ROOT_KEY]: tmpRoot }),
      );
      const result = gen.promoteToActive({
        slug: 'unified',
        description: 'one root',
        body: '# body',
      });
      expect(result.dir).toBe(path.join(tmpRoot, 'unified'));
      expect(fs.existsSync(result.filePath)).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
