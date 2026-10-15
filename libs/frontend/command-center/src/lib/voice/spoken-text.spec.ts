import { toSpokenText } from './spoken-text';

describe('toSpokenText', () => {
  it('keeps conversational text and drops code, diffs, tools and raw links', () => {
    const input =
      'I finished the review.\n```ts\nconst secret = 1;\n```\nTool result: 42\n@@ -1 +1 @@\n+const x = 1\n\nSee https://example.com/details for details.';
    const spoken = toSpokenText(input);
    expect(spoken).toContain('I finished the review.');
    expect(spoken).not.toMatch(/secret|Tool|const|https|example/);
  });

  it('filters secret-shaped tokens', () => {
    const spoken = toSpokenText(
      'Done. sk_live_123456789012345678901234567890 is private.',
    );
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
