/**
 * SkillMdGenerator unit tests.
 *
 * Pure file-system contract — verifies frontmatter shape, slug-collision
 * retry, and the candidate vs. active root layout.
 */
// `writeFileSync`/`rmSync` are real by default; two cases swap in a failing
// implementation to prove the partial-write cleanup. A spy on the imported
// namespace cannot do this (its bindings are non-configurable getters).
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: jest.fn(actual.writeFileSync),
    rmSync: jest.fn(actual.rmSync),
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillMdGenerator } from './skill-md-generator';

const actualFs = jest.requireActual<typeof import('node:fs')>('node:fs');
const writeFileSyncMock = fs.writeFileSync as unknown as jest.Mock;
const rmSyncMock = fs.rmSync as unknown as jest.Mock;

/** Real writes, except the reference named `second` fails. */
function failSecondReferenceWrite(): void {
  writeFileSyncMock.mockImplementation(
    (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith(`${path.sep}second.md`)) {
        throw new Error('disk full');
      }
      return (actualFs.writeFileSync as (...a: unknown[]) => void)(
        file,
        ...rest,
      );
    },
  );
}

function restoreFsMocks(): void {
  writeFileSyncMock.mockImplementation(actualFs.writeFileSync);
  rmSyncMock.mockImplementation(actualFs.rmSync);
}

interface MockLogger {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
}

const makeLogger = (): MockLogger => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
});

describe('SkillMdGenerator', () => {
  let tmpRoot: string;
  let gen: SkillMdGenerator;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-skill-md-'));
    gen = new SkillMdGenerator(makeLogger() as never);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes a candidate with the plugin frontmatter shape', () => {
    const result = gen.writeCandidate(
      {
        slug: 'extract-route-handler',
        description: 'Refactor an Express route handler into a service',
        body: '## Steps\n\n1. Identify route\n2. Extract service\n3. Wire DI',
      },
      tmpRoot,
    );
    expect(result.slug).toBe('extract-route-handler');
    expect(result.filePath.endsWith('SKILL.md')).toBe(true);

    const content = fs.readFileSync(result.filePath, 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('name: extract-route-handler');
    expect(content).toContain(
      'description: Refactor an Express route handler into a service',
    );
    expect(content).toContain('## Steps');
  });

  it('retries with -2..-5 on slug collision and finally throws', () => {
    const baseSlug = 'duplicate-skill';
    const first = gen.writeCandidate(
      { slug: baseSlug, description: 'first', body: 'one' },
      tmpRoot,
    );
    expect(first.slug).toBe(baseSlug);

    const second = gen.writeCandidate(
      { slug: baseSlug, description: 'second', body: 'two' },
      tmpRoot,
    );
    expect(second.slug).toBe(`${baseSlug}-2`);

    const third = gen.writeCandidate(
      { slug: baseSlug, description: 'third', body: 'three' },
      tmpRoot,
    );
    expect(third.slug).toBe(`${baseSlug}-3`);

    // Pre-create -4 and -5 manually so retry exhausts.
    fs.mkdirSync(path.join(tmpRoot, `${baseSlug}-4`), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, `${baseSlug}-5`), { recursive: true });

    expect(() =>
      gen.writeCandidate(
        { slug: baseSlug, description: 'fourth', body: 'four' },
        tmpRoot,
      ),
    ).toThrow(/slug collision/);
  });

  it('overwriteCandidate rewrites in place with no collision suffix', () => {
    // The opposite question to `writeCandidate`'s. A candidate re-drafted from
    // a session that GREW is colliding with its own directory, so suffixing
    // mints a second copy of one skill and leaves the row addressing the stale
    // first — which is how one session reached `…-5` and then failed outright.
    const slug = 'recover-a-stacked-branch';
    const first = gen.writeCandidate(
      { slug, description: 'first', body: 'one' },
      tmpRoot,
    );

    const again = gen.overwriteCandidate(
      { slug, description: 'second', body: 'two' },
      tmpRoot,
    );

    expect(again.slug).toBe(slug);
    expect(again.filePath).toBe(first.filePath);
    expect(fs.readdirSync(tmpRoot)).toEqual([slug]);
    const content = fs.readFileSync(again.filePath, 'utf8');
    expect(content).toContain('description: second');
    expect(content).toContain('two');
    expect(content).not.toContain('one');
  });

  it('overwriteCandidate creates the directory when there is none yet', () => {
    // A row whose SKILL.md was deleted under it must still get a file back
    // rather than a throw into a background stage.
    const result = gen.overwriteCandidate(
      { slug: 'never-written', description: 'd', body: 'b' },
      tmpRoot,
    );

    expect(result.slug).toBe('never-written');
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it('overwriteCandidate refuses references before touching the disk', () => {
    expect(() =>
      gen.overwriteCandidate(
        {
          slug: 'with-refs',
          description: 'd',
          body: 'b',
          references: [{ name: 'ref', body: 'r' }],
        },
        tmpRoot,
      ),
    ).toThrow(/does not write references/);
    expect(fs.existsSync(path.join(tmpRoot, 'with-refs'))).toBe(false);
  });

  it('sanitizes a noisy slug input into kebab-case', () => {
    const result = gen.writeCandidate(
      {
        slug: 'My Cool Skill!! (v2)',
        description: 'noise',
        body: 'body',
      },
      tmpRoot,
    );
    expect(result.slug).toMatch(/^my-cool-skill-v2/);
  });

  it('escapes quotes and newlines in description (frontmatter safety)', () => {
    const result = gen.writeCandidate(
      {
        slug: 'safe-desc',
        description: 'Has "quotes"\nand newlines',
        body: 'body',
      },
      tmpRoot,
    );
    const content = fs.readFileSync(result.filePath, 'utf8');
    expect(content).toContain("description: Has 'quotes' and newlines");
    expect(content.split('description:')[1].split('\n')[0]).not.toContain('\n');
  });

  describe('promoteToActive', () => {
    let activeGen: SkillMdGenerator;
    let logger: MockLogger;

    beforeEach(() => {
      const workspace = { getConfiguration: () => tmpRoot };
      logger = makeLogger();
      activeGen = new SkillMdGenerator(logger as never, workspace as never);
    });

    it('skips a slug the database already holds even with no directory on disk', () => {
      const taken = new Set(['foo']);
      const result = activeGen.promoteToActive(
        { slug: 'foo', description: 'd', body: 'b' },
        undefined,
        { isSlugTaken: (slug) => taken.has(slug) },
      );
      expect(result.slug).toBe('foo-2');
      expect(result.dir).toBe(path.join(tmpRoot, 'foo-2'));
      expect(fs.existsSync(path.join(tmpRoot, 'foo'))).toBe(false);
      expect(fs.readFileSync(result.filePath, 'utf8')).toContain('name: foo-2');
    });

    it('throws when the DB and the disk together exhaust -2..-5', () => {
      fs.mkdirSync(path.join(tmpRoot, 'foo'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'foo-3'), { recursive: true });
      const taken = new Set(['foo-2', 'foo-4', 'foo-5']);
      expect(() =>
        activeGen.promoteToActive(
          { slug: 'foo', description: 'd', body: 'b' },
          undefined,
          { isSlugTaken: (slug) => taken.has(slug) },
        ),
      ).toThrow(/slug collision/);
    });

    it('writes each reference to references/<name>.md', () => {
      const result = activeGen.promoteToActive({
        slug: 'umbrella',
        description: 'd',
        body: 'b',
        references: [
          { name: 'variant-one', body: '# One\n\nfirst' },
          { name: 'variant-2', body: 'second' },
        ],
      });
      const refsDir = path.join(result.dir, 'references');
      expect(fs.readdirSync(refsDir).sort()).toEqual([
        'variant-2.md',
        'variant-one.md',
      ]);
      expect(
        fs.readFileSync(path.join(refsDir, 'variant-one.md'), 'utf8'),
      ).toBe('# One\n\nfirst\n');
    });

    it('does not create references/ when there are none', () => {
      const result = activeGen.promoteToActive({
        slug: 'plain',
        description: 'd',
        body: 'b',
      });
      expect(fs.existsSync(path.join(result.dir, 'references'))).toBe(false);
    });

    it.each(['../x', 'a/b', 'a\\b', '', 'Upper', '-lead'])(
      'throws on reference name %j and writes nothing',
      (name) => {
        expect(() =>
          activeGen.promoteToActive({
            slug: 'evil',
            description: 'd',
            body: 'b',
            references: [{ name, body: 'x' }],
          }),
        ).toThrow(/invalid reference name/);
        expect(fs.existsSync(path.join(tmpRoot, 'evil'))).toBe(false);
        expect(fs.existsSync(path.join(tmpRoot, 'x.md'))).toBe(false);
      },
    );

    it('throws on a duplicate reference name', () => {
      expect(() =>
        activeGen.promoteToActive({
          slug: 'dup',
          description: 'd',
          body: 'b',
          references: [
            { name: 'same', body: '1' },
            { name: 'same', body: '2' },
          ],
        }),
      ).toThrow(/duplicate reference name/);
    });

    it.each(['con', 'prn', 'aux', 'nul', 'com1', 'com0', 'lpt9'])(
      'throws on Windows reserved reference name %j and writes nothing',
      (name) => {
        expect(() =>
          activeGen.promoteToActive({
            slug: 'reserved',
            description: 'd',
            body: 'b',
            references: [{ name, body: 'x' }],
          }),
        ).toThrow(/reserved reference name/);
        expect(fs.existsSync(path.join(tmpRoot, 'reserved'))).toBe(false);
      },
    );

    it('accepts names that only start like a reserved device name', () => {
      const result = activeGen.promoteToActive({
        slug: 'not-reserved',
        description: 'd',
        body: 'b',
        references: [
          { name: 'console', body: 'c' },
          { name: 'com10', body: 'c' },
        ],
      });
      expect(
        fs.readdirSync(path.join(result.dir, 'references')).sort(),
      ).toEqual(['com10.md', 'console.md']);
    });

    it('removes the skill directory and rethrows when a reference write fails', () => {
      failSecondReferenceWrite();
      try {
        expect(() =>
          activeGen.promoteToActive({
            slug: 'partial',
            description: 'd',
            body: 'b',
            references: [
              { name: 'first', body: '1' },
              { name: 'second', body: '2' },
            ],
          }),
        ).toThrow('disk full');
      } finally {
        restoreFsMocks();
      }
      expect(fs.existsSync(path.join(tmpRoot, 'partial'))).toBe(false);
    });

    it('rethrows the original write error even when cleanup also fails', () => {
      failSecondReferenceWrite();
      rmSyncMock.mockImplementation(() => {
        throw new Error('locked');
      });
      try {
        expect(() =>
          activeGen.promoteToActive({
            slug: 'partial-locked',
            description: 'd',
            body: 'b',
            references: [
              { name: 'first', body: '1' },
              { name: 'second', body: '2' },
            ],
          }),
        ).toThrow('disk full');
      } finally {
        restoreFsMocks();
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('partially written skill directory'),
        expect.objectContaining({ slug: 'partial-locked', error: 'locked' }),
      );
    });

    it('removeActive refuses a directory outside the active root and deletes nothing', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-outside-'));
      try {
        expect(() =>
          activeGen.removeActive({
            slug: 'x',
            dir: outside,
            filePath: path.join(outside, 'SKILL.md'),
          }),
        ).toThrow(/outside the active root/);
        expect(fs.existsSync(outside)).toBe(true);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('removeActive refuses the active root itself and deletes nothing', () => {
      const kept = activeGen.promoteToActive({
        slug: 'keep-me',
        description: 'd',
        body: 'b',
      });
      expect(() =>
        activeGen.removeActive({
          slug: '',
          dir: tmpRoot,
          filePath: path.join(tmpRoot, 'SKILL.md'),
        }),
      ).toThrow(/outside the active root/);
      expect(() =>
        activeGen.removeActive({
          slug: '',
          dir: `${tmpRoot}${path.sep}`,
          filePath: path.join(tmpRoot, 'SKILL.md'),
        }),
      ).toThrow(/outside the active root/);
      expect(fs.existsSync(kept.filePath)).toBe(true);
    });

    it('removeActive removes the skill directory including references/', () => {
      const result = activeGen.promoteToActive({
        slug: 'to-remove',
        description: 'd',
        body: 'b',
        references: [{ name: 'ref', body: 'r' }],
      });
      expect(fs.existsSync(path.join(result.dir, 'references', 'ref.md'))).toBe(
        true,
      );
      activeGen.removeActive(result);
      expect(fs.existsSync(result.dir)).toBe(false);
    });
  });
});
