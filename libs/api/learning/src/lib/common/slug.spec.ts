import {
  FALLBACK_COURSE_SLUG_STEM,
  FALLBACK_LESSON_SLUG_STEM,
  FALLBACK_MODULE_SLUG_STEM,
  MAX_SLUG_STEM_LENGTH,
  buildSlug,
  resolveSlugCollision,
  slugify,
} from './slug';

describe('slugify', () => {
  it('lowercases and collapses every non-alphanumeric run to a single hyphen', () => {
    expect(slugify('Getting Started: Part 1!', FALLBACK_LESSON_SLUG_STEM)).toBe(
      'getting-started-part-1',
    );
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Intro--  ', FALLBACK_LESSON_SLUG_STEM)).toBe('intro');
  });

  it('truncates to the cap BEFORE trimming, so a cut mid-separator leaves no dangling hyphen', () => {
    // The 80th character lands inside the separator run, so a trim-then-cut
    // implementation would return a slug ending in `-`.
    const title = `${'a'.repeat(MAX_SLUG_STEM_LENGTH - 1)} tail`;
    const slug = slugify(title, FALLBACK_LESSON_SLUG_STEM);

    expect(slug).toHaveLength(MAX_SLUG_STEM_LENGTH - 1);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('never exceeds the stem cap', () => {
    expect(
      slugify('word '.repeat(60), FALLBACK_LESSON_SLUG_STEM).length,
    ).toBeLessThanOrEqual(MAX_SLUG_STEM_LENGTH);
  });

  it('falls back for a title that normalises to nothing', () => {
    // Without the fallback the first such row silently takes `""` as its
    // permanent public identifier and the second is suffixed into `-2`.
    for (const title of ['???', '—', '🎬🎬', 'مرحبا']) {
      expect(slugify(title, FALLBACK_LESSON_SLUG_STEM)).toBe('lesson');
    }
  });

  it('uses the caller-supplied stem, so the three models are distinguishable', () => {
    expect(slugify('###', FALLBACK_COURSE_SLUG_STEM)).toBe('course');
    expect(slugify('###', FALLBACK_MODULE_SLUG_STEM)).toBe('module');
    expect(slugify('###', FALLBACK_LESSON_SLUG_STEM)).toBe('lesson');
  });

  it('is deterministic and pure', () => {
    const a = slugify('Shipping Fast', FALLBACK_COURSE_SLUG_STEM);
    const b = slugify('Shipping Fast', FALLBACK_COURSE_SLUG_STEM);

    expect(a).toBe(b);
  });
});

describe('resolveSlugCollision', () => {
  it('returns the stem itself when free', () => {
    expect(resolveSlugCollision('intro', new Set())).toBe('intro');
  });

  it('suffixes from 2, not 1 — the unsuffixed slug IS the first', () => {
    expect(resolveSlugCollision('intro', new Set(['intro']))).toBe('intro-2');
  });

  it('skips occupied suffixes', () => {
    expect(
      resolveSlugCollision('intro', new Set(['intro', 'intro-2', 'intro-3'])),
    ).toBe('intro-4');
  });

  it('may exceed the stem cap by the width of the suffix, deliberately', () => {
    // Truncating the stem to make room would make two different long titles
    // collide MORE often, which is the opposite of what the suffix is for.
    const stem = 'a'.repeat(MAX_SLUG_STEM_LENGTH);
    const resolved = resolveSlugCollision(stem, new Set([stem]));

    expect(resolved).toBe(`${stem}-2`);
    expect(resolved.length).toBeGreaterThan(MAX_SLUG_STEM_LENGTH);
  });

  it('terminates against a pathological taken-set rather than looping forever', () => {
    const always = { has: () => true } as unknown as ReadonlySet<string>;

    expect(() => resolveSlugCollision('intro', always)).toThrow(
      /Could not resolve a free slug/,
    );
  });
});

describe('buildSlug', () => {
  it('normalises BEFORE suffixing', () => {
    expect(
      buildSlug('Intro!', FALLBACK_LESSON_SLUG_STEM, new Set(['intro'])),
    ).toBe('intro-2');
  });

  it('applies the fallback stem and then the collision rule to it', () => {
    // Two lessons whose titles both normalise to nothing must still get
    // distinct slugs.
    const taken = new Set<string>();
    const first = buildSlug('???', FALLBACK_LESSON_SLUG_STEM, taken);
    taken.add(first);
    const second = buildSlug('🎬', FALLBACK_LESSON_SLUG_STEM, taken);

    expect(first).toBe('lesson');
    expect(second).toBe('lesson-2');
  });

  it('🔴 a COURSE-WIDE taken-set keeps `courses/:slug/lessons/:lessonSlug` unambiguous', () => {
    // `@@unique([moduleId, slug])` would let module 2 hold `intro` while module
    // 1 already does — legal in the database, ambiguous in the URL. Feeding the
    // resolver the course-wide set (a superset of the module-wide one) means
    // the returned slug is free in the module as well, so the unique index
    // still decides and nothing about the P2002 mapping changes.
    const courseWide = new Set(['intro', 'intro-2']);

    expect(buildSlug('Intro', FALLBACK_LESSON_SLUG_STEM, courseWide)).toBe(
      'intro-3',
    );
  });
});
