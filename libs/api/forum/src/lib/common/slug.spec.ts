import {
  FALLBACK_SLUG_STEM,
  MAX_SLUG_STEM_LENGTH,
  buildSlug,
  resolveSlugCollision,
  slugify,
} from './slug';

describe('slugify — R1.2.2', () => {
  it('lowercases, replaces runs of non-alphanumerics with one hyphen, and trims', () => {
    expect(slugify('  How Do I Use   Ptah?!  ')).toBe('how-do-i-use-ptah');
  });

  it('is deterministic — the same title always yields the same stem', () => {
    // The property the whole design rests on: a slug is generated once and
    // never regenerated, so the generator must not carry hidden state (a
    // counter, a timestamp, a random suffix). If this ever fails, "generated
    // once" has silently become "generated differently each time".
    const title = 'Deploying to production on a Friday';

    expect(slugify(title)).toBe(slugify(title));
    expect(slugify(title)).toBe('deploying-to-production-on-a-friday');
  });

  it('collapses repeats rather than emitting empty segments', () => {
    expect(slugify('a---b___c   d')).toBe('a-b-c-d');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('!!!edge case!!!')).toBe('edge-case');
  });

  it('caps the stem at MAX_SLUG_STEM_LENGTH', () => {
    const stem = slugify('a'.repeat(200));

    expect(stem).toHaveLength(MAX_SLUG_STEM_LENGTH);
  });

  it('never leaves a dangling hyphen when the cap cuts mid-separator', () => {
    // Truncation runs BEFORE the trailing trim precisely so this cannot happen.
    // A slug ending in `-` would render as `/topics/some-title-` and would
    // differ from the visually identical slug without it.
    const title = `${'a'.repeat(MAX_SLUG_STEM_LENGTH - 1)} bbbb`;
    const stem = slugify(title);

    expect(stem.endsWith('-')).toBe(false);
  });

  it('falls back for a title that normalises to nothing', () => {
    // Punctuation-only and non-Latin titles are legal titles. Without the
    // fallback the first one would take the EMPTY slug — accepted by the
    // unique index exactly once, and permanently the topic's public id.
    expect(slugify('???')).toBe(FALLBACK_SLUG_STEM);
    expect(slugify('こんにちは')).toBe(FALLBACK_SLUG_STEM);
    expect(slugify('')).toBe(FALLBACK_SLUG_STEM);
  });

  it('never returns the empty string, for any input in a hostile sample', () => {
    const hostile = ['', ' ', '-', '---', '???', '💥', '\n\t', '...', '/'];

    for (const title of hostile) {
      expect(slugify(title).length).toBeGreaterThan(0);
    }
  });
});

describe('resolveSlugCollision — R1.2.2', () => {
  it('returns the stem unchanged when it is free', () => {
    expect(resolveSlugCollision('my-topic', new Set())).toBe('my-topic');
  });

  it('starts the suffix at 2, because the unsuffixed slug is the first one', () => {
    expect(resolveSlugCollision('my-topic', new Set(['my-topic']))).toBe(
      'my-topic-2',
    );
  });

  it('walks forward past a run of taken suffixes', () => {
    const taken = new Set(['my-topic', 'my-topic-2', 'my-topic-3']);

    expect(resolveSlugCollision('my-topic', taken)).toBe('my-topic-4');
  });

  it('fills a gap rather than always appending at the end', () => {
    // `my-topic-2` was deleted (hard-deleted, or never existed because the
    // titles differed). Reusing the gap keeps slugs short; more importantly it
    // shows the rule is "first free", not "max + 1", which would need a scan
    // of every sibling to compute.
    const taken = new Set(['my-topic', 'my-topic-3']);

    expect(resolveSlugCollision('my-topic', taken)).toBe('my-topic-2');
  });

  it('is not confused by a longer slug that merely starts with the stem', () => {
    // The caller builds `taken` with `slug: { startsWith: stem }`, so unrelated
    // slugs like `my-topic-in-production` ARE in the set. They must not consume
    // a numeric suffix.
    const taken = new Set(['my-topic', 'my-topic-in-production']);

    expect(resolveSlugCollision('my-topic', taken)).toBe('my-topic-2');
  });

  it('lets the suffix push the result past the stem cap, deliberately', () => {
    const stem = 'a'.repeat(MAX_SLUG_STEM_LENGTH);
    const result = resolveSlugCollision(stem, new Set([stem]));

    // Documented in slug.ts: truncating the stem to make room would make two
    // different long titles collide MORE often, which is the opposite of what
    // the suffix is for.
    expect(result).toBe(`${stem}-2`);
    expect(result.length).toBeGreaterThan(MAX_SLUG_STEM_LENGTH);
  });
});

describe('buildSlug — the create path', () => {
  it('normalises before suffixing, never the other way round', () => {
    // Suffixing first would produce `my-topic-2` -> `my-topic-2` as a STEM and
    // bury the counter inside the readable part.
    const taken = new Set(['my-topic']);

    expect(buildSlug('My Topic', taken)).toBe('my-topic-2');
  });

  it('suffixes the fallback stem too, so two unslugables do not collide', () => {
    // Both titles normalise to `topic`. The second must still get a free slug —
    // this is the case the fallback would break if it bypassed collision
    // resolution.
    const first = buildSlug('???', new Set());
    const second = buildSlug('💥', new Set([first]));

    expect(first).toBe(FALLBACK_SLUG_STEM);
    expect(second).toBe(`${FALLBACK_SLUG_STEM}-2`);
  });
});
