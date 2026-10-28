import { replyExcerpt, toSpokenText } from './spoken-text';

describe('toSpokenText', () => {
  it('keeps conversational text and drops code, diffs, tools and raw links', () => {
    const input =
      'I finished the review.\n```ts\nconst secret = 1;\n```\nTool result: 42\n@@ -1 +1 @@\n+const x = 1\n\nSee https://example.com/details for details.';
    const spoken = toSpokenText(input);
    expect(spoken).toContain('I finished the review.');
    expect(spoken).not.toMatch(/secret|Tool|const|https|example/);
  });

  it('filters secret-shaped tokens', () => {
    // Built at runtime so secret scanners do not flag a fake key literal.
    const fakeKey = ['sk', 'live', '1234567890'.repeat(3)].join('_');
    const spoken = toSpokenText(`Done. ${fakeKey} is private.`);
    expect(spoken).toContain('Done.');
    expect(spoken).not.toContain('sk_live_');
  });

  it('keeps markdown bullet content', () => {
    const spoken = toSpokenText('Done.\n- item one\n- item two');
    expect(spoken).toContain('item one');
    expect(spoken).toContain('item two');
  });

  it('removes an unfenced unified diff but keeps adjacent prose', () => {
    const spoken = toSpokenText(
      'I fixed it.\ndiff --git a/file.ts b/file.ts\nindex abc123..def456 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old line\n+new line\n\nThe change is ready.',
    );
    expect(spoken).toContain('I fixed it.');
    expect(spoken).toContain('The change is ready.');
    expect(spoken).not.toMatch(/diff --git|index|file\.ts|old line|new line/);
  });

  it('caps replies at four sentences and 600 characters with a cue', () => {
    expect(toSpokenText('One. Two. Three. Four. Five.')).toBe(
      'One. Two. Three. Four. See text for the rest',
    );
    const long = toSpokenText('word '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(600);
    expect(long).toContain('See text for the rest');
  });

  it('caps status at 180 characters', () => {
    const spoken = toSpokenText('running '.repeat(100), 'status');
    expect(spoken.length).toBeLessThanOrEqual(180);
    expect(spoken).toContain('See text for the rest');
  });
});

describe('replyExcerpt', () => {
  it('keeps only the first prose sentence of a reply', () => {
    expect(
      replyExcerpt('The change is ready. Review it.\n```ts\nconst a = 1;\n```'),
    ).toBe('The change is ready.');
  });

  it('truncates a long sentence with an ellipsis', () => {
    const excerpt = replyExcerpt('word '.repeat(80));
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('returns nothing for a reply without prose', () => {
    expect(replyExcerpt('```ts\nconst a = 1;\n```')).toBe('');
  });
});
