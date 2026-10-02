/**
 * Pins `materializedBaseSlug` to the slug `SkillMdGenerator.promoteToActive`
 * actually writes (TASK_2026_578, Batch 9 decision 2).
 *
 * The reconcile derives the directory a legacy accepted suggestion was
 * materialized under from its name. That rule is a copy of the generator's
 * private `sanitizeSlug`; if the two drift, the reconcile fails closed but
 * silently strands legacy skills. These cases drive the REAL generator, so a
 * change to either side fails here.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillMdGenerator, SKILLS_ROOT_KEY } from '../skill-md-generator';
import { materializedBaseSlug } from './adoptable-slug';

function workspaceAt(root: string): IWorkspaceProvider {
  return {
    getWorkspaceRoot: () => '',
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      (key === SKILLS_ROOT_KEY ? root : fallback) as T,
  } as unknown as IWorkspaceProvider;
}

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };

describe('materializedBaseSlug pinned to SkillMdGenerator.promoteToActive', () => {
  let root: string;
  let md: SkillMdGenerator;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-adoptable-slug-'));
    md = new SkillMdGenerator(logger as never, workspaceAt(root));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function materialize(name: string): string {
    return md.promoteToActive({ slug: name, description: 'd', body: '# B' })
      .slug;
  }

  it.each([
    ['plain kebab', 'deploy-flow'],
    ['spaces', 'deploy the service'],
    ['uppercase', 'Deploy The SERVICE'],
    ['punctuation', 'Foo Bar! (v2): fix/build.step_one'],
    ['leading and trailing separators', '--x--'],
    ['accented letters', 'café crème deploy'],
    ['mixed unicode and ascii', 'deploy 🚀 to 東京'],
    ['a 70-character name', 'a'.repeat(70)],
    ['a long name cut at a separator', `${'x'.repeat(59)} tail`],
    [
      'a long name with spaces',
      'Run the full release checklist for every service in the monorepo today',
    ],
  ])(
    '%s: the generator writes <root>/<materializedBaseSlug(name)>',
    (_label, name) => {
      const expected = materializedBaseSlug(name);
      expect(expected).not.toBeNull();

      const written = materialize(name);

      expect(written).toBe(expected);
      expect(fs.existsSync(path.join(root, written, 'SKILL.md'))).toBe(true);
    },
  );

  it.each([
    ['only non-ascii letters', '日本語のスキル'],
    ['only punctuation', '!!! ??? ...'],
  ])(
    '%s: null, where the generator falls back to a time-based slug no reconcile can predict',
    (_label, name) => {
      expect(materializedBaseSlug(name)).toBeNull();
      expect(materialize(name)).toMatch(/^skill-[0-9a-z]+$/);
    },
  );
});
