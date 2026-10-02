/**
 * Pins `materializedBaseSlug` to the slug `SkillMdGenerator.promoteToActive`
 * actually writes (TASK_2026_578, Batch 9 decision 2).
 *
 * The reconcile derives the directory a legacy accepted suggestion was
 * materialized under from its name. That rule is a copy of the generator's
 * private `sanitizeSlug`; if the two drift, the reconcile fails closed but
 * silently strands legacy skills. These cases drive the REAL generator, so a
 * change to either side fails here.
 *
 * Also the proof rules (body match; diverged non-plugin row with SKILL.md)
 * and the slug-holder decision added for the two real-data shapes (Batch 15).
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillMdGenerator, SKILLS_ROOT_KEY } from '../skill-md-generator';
import type {
  SkillRegistryEntry,
  SkillRegistryStore,
} from '../skill-registry.store';
import {
  MERGED_INTO_PREFIX,
  RETIRED_UNUSED_REASON,
  type SkillCandidateRow,
  type SkillSuggestionRow,
} from '../types';
import {
  findAdoptableSlug,
  materializedBaseSlug,
  slugHolderDecision,
} from './adoptable-slug';

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

  it('trims a long inner dash run without backtracking (S8786)', () => {
    // `-+$` retried at every dash of a long run that does not reach the end
    // is quadratic; the linear trim finishes well inside the test timeout.
    // The 60-char cut runs after the trim, as in the generator.
    const run = '-'.repeat(200_000);
    expect(materializedBaseSlug(`a${run}b`)).toBe(`a${'-'.repeat(59)}`);
    expect(materializedBaseSlug(`${run}b${run}`)).toBe('b');
  });

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

describe('findAdoptableSlug proofs', () => {
  let root: string;
  const body = '# Deploy\n\nSteps.';
  const suggestion = { name: 'deploy-flow', body } as SkillSuggestionRow;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-adoptable-proof-'));
    logger.warn.mockClear();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function registryOf(
    entries: Record<string, Partial<SkillRegistryEntry>>,
  ): SkillRegistryStore {
    return {
      getBySlug: (_kind: string, slug: string) =>
        entries[slug]
          ? ({
              slug,
              kind: 'skill',
              originPluginId: null,
              diverged: false,
              ...entries[slug],
            } as SkillRegistryEntry)
          : null,
    } as unknown as SkillRegistryStore;
  }

  function writeSkill(slug: string, content: string): void {
    fs.mkdirSync(path.join(root, slug), { recursive: true });
    fs.writeFileSync(path.join(root, slug, 'SKILL.md'), content);
  }

  const find = (entries: Record<string, Partial<SkillRegistryEntry>>) =>
    findAdoptableSlug(suggestion, registryOf(entries), root, logger as never);

  it.each(['synth', 'authored'] as const)(
    'a %s row proves its slug by body equality',
    (cloneStatus) => {
      writeSkill('deploy-flow', `---\nname: x\n---\n\n${body}\n`);
      expect(find({ 'deploy-flow': { cloneStatus } })).toEqual({
        kind: 'found',
        slug: 'deploy-flow',
        filePath: path.join(root, 'deploy-flow', 'SKILL.md'),
        proof: 'body-match',
      });
    },
  );

  it.each([
    ['CRLF line endings', `---\r\nname: x\r\n---\r\n\r\n${body.replaceAll('\n', '\r\n')}\r\n`],
    ['trailing spaces and tabs on the delimiters', `--- \t\nname: x\n---  \n\n${body}\n`],
    ['CRLF plus trailing whitespace', `---  \r\nname: x\r\n---\t\r\n${body}\r\n`],
  ])('a synth row proves its slug by body equality with %s', (_label, content) => {
    writeSkill('deploy-flow', content);
    expect(find({ 'deploy-flow': { cloneStatus: 'synth' } })).toEqual({
      kind: 'found',
      slug: 'deploy-flow',
      filePath: path.join(root, 'deploy-flow', 'SKILL.md'),
      proof: 'body-match',
    });
  });

  it('a synth row with a different body proves nothing', () => {
    writeSkill('deploy-flow', 'Edited.\n');
    expect(find({ 'deploy-flow': { cloneStatus: 'synth' } })).toEqual({
      kind: 'missing',
    });
  });

  it('a diverged non-plugin row proves a suffixed slug by SKILL.md alone', () => {
    writeSkill('deploy-flow-3', 'Edited by the user.\n');
    expect(find({ 'deploy-flow-3': { cloneStatus: 'diverged' } })).toEqual({
      kind: 'found',
      slug: 'deploy-flow-3',
      filePath: path.join(root, 'deploy-flow-3', 'SKILL.md'),
      proof: 'diverged',
    });
  });

  it('a diverged row with no SKILL.md (directory only) proves nothing', () => {
    fs.mkdirSync(path.join(root, 'deploy-flow'), { recursive: true });
    expect(find({ 'deploy-flow': { cloneStatus: 'diverged' } })).toEqual({
      kind: 'missing',
    });
  });

  it.each([
    ['a diverged row with an originPluginId', 'diverged', 'plugin-x'],
    ['a clone row', 'clone', null],
  ] as const)('%s proves nothing', (_label, cloneStatus, originPluginId) => {
    writeSkill('deploy-flow', `${body}\n`);
    expect(find({ 'deploy-flow': { cloneStatus, originPluginId } })).toEqual({
      kind: 'missing',
    });
  });

  it('a slug outside the base and -2..-5 suffixes is never considered', () => {
    writeSkill('deploy-flow-6', 'Edited.\n');
    expect(find({ 'deploy-flow-6': { cloneStatus: 'diverged' } })).toEqual({
      kind: 'missing',
    });
  });

  it('a body-proven and a diverged slug together are ambiguous', () => {
    writeSkill('deploy-flow', `${body}\n`);
    writeSkill('deploy-flow-2', 'Edited.\n');
    expect(
      find({
        'deploy-flow': { cloneStatus: 'synth' },
        'deploy-flow-2': { cloneStatus: 'diverged' },
      }),
    ).toEqual({ kind: 'ambiguous', slugs: ['deploy-flow', 'deploy-flow-2'] });
  });
});

describe('slugHolderDecision', () => {
  const row = (overrides: Partial<SkillCandidateRow>): SkillCandidateRow =>
    ({
      id: 'c1',
      name: 'deploy-flow',
      rejectedReason: null,
      ...overrides,
    }) as SkillCandidateRow;

  it.each([
    ['no row', null, 'new-row'],
    ['a promoted row', row({ status: 'promoted' }), 'link-promoted'],
    [
      'a judge-rejected row',
      row({ status: 'rejected', rejectedReason: 'judge-below-threshold' }),
      'repromote-rejected',
    ],
    [
      'a rejected row with no reason',
      row({ status: 'rejected' }),
      'repromote-rejected',
    ],
    ['a live candidate', row({ status: 'candidate' }), 'blocked'],
    [
      'a retired row',
      row({ status: 'rejected', rejectedReason: RETIRED_UNUSED_REASON }),
      'blocked',
    ],
    [
      'a merged row',
      row({ status: 'rejected', rejectedReason: `${MERGED_INTO_PREFIX}s1` }),
      'blocked',
    ],
  ] as const)('%s → %s', (_label, holder, expected) => {
    expect(slugHolderDecision(holder)).toBe(expected);
  });
});
