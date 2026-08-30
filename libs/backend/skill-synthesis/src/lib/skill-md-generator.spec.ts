/**
 * SkillMdGenerator unit tests.
 *
 * Pure file-system contract — verifies frontmatter shape, slug-collision
 * retry, and the candidate vs. active root layout.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillMdGenerator } from './skill-md-generator';

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
});
