import {
  clampTranscript,
  CURATOR_TRANSCRIPT_MAX_CHARS,
} from './clamp-transcript';

/** `n` blank-line-separated records, each tagged so a cut is locatable. */
function records(n: number, bodyChars: number): string {
  return Array.from(
    { length: n },
    (_, i) => `USER: r${i} ${'x'.repeat(bodyChars)}`,
  ).join('\n\n');
}

describe('clampTranscript', () => {
  describe('below the cap', () => {
    it('returns the input untouched and reports no loss', () => {
      const text = records(5, 10);
      const out = clampTranscript(text, 10_000);

      expect(out.text).toBe(text);
      expect(out.clamped).toBe(false);
      expect(out.droppedChars).toBe(0);
      expect(out.droppedRecords).toBe(0);
      expect(out.keptChars).toBe(text.length);
      expect(out.originalChars).toBe(text.length);
    });

    it('treats a text of exactly the cap as below it', () => {
      const text = 'a'.repeat(500);
      expect(clampTranscript(text, 500).clamped).toBe(false);
    });
  });

  describe('above the cap', () => {
    it('never returns more characters than the cap', () => {
      const text = records(400, 200);
      for (const cap of [200, 1_000, 4_096, 20_000]) {
        const out = clampTranscript(text, cap);
        expect(out.text.length).toBeLessThanOrEqual(cap);
        expect(out.keptChars).toBe(out.text.length);
      }
    });

    it('keeps the head, the tail and an elision marker between them', () => {
      const text = records(300, 200);
      const out = clampTranscript(text, 8_000);

      expect(out.clamped).toBe(true);
      // The head is the START of the session — the user's stated intent, which
      // a tail-only window would discard first.
      expect(out.text.startsWith('USER: r0 ')).toBe(true);
      // The tail is the END — the outcome, plus the already-summarised sections
      // `composeTranscript` appends after the excerpt.
      expect(out.text.endsWith(text.slice(-50))).toBe(true);
      expect(out.text).toContain('elided by the memory curator');
    });

    it('reports the real dropped counts in the marker and the result', () => {
      const text = records(300, 200);
      const out = clampTranscript(text, 8_000);

      const [head, rest] = out.text.split('\n\n[…');
      const tail = rest.split('…]\n\n')[1];

      expect(out.text).toContain(`${out.droppedRecords} records`);
      expect(out.droppedRecords).toBeGreaterThan(0);
      // `droppedChars` counts INPUT characters that survive nowhere in the
      // output — the marker is not input, so it must not be netted off.
      expect(out.droppedChars).toBe(
        out.originalChars - head.length - tail.length,
      );
      expect(out.text).toContain(`${out.droppedChars} characters`);
    });

    it('is deterministic — the same input yields the same output', () => {
      const text = records(300, 137);
      expect(clampTranscript(text, 6_000).text).toBe(
        clampTranscript(text, 6_000).text,
      );
    });

    it('weights the tail more heavily than the head', () => {
      const text = records(300, 200);
      const out = clampTranscript(text, 8_000);
      const [head, rest] = out.text.split('\n\n[…');
      const tail = rest.split('…]\n\n')[1];

      expect(tail.length).toBeGreaterThan(head.length);
    });

    it('clamps a text with no record boundaries at all', () => {
      const text = 'x'.repeat(50_000);
      const out = clampTranscript(text, 4_000);

      expect(out.text.length).toBeLessThanOrEqual(4_000);
      expect(out.clamped).toBe(true);
      expect(out.droppedRecords).toBe(1);
    });

    it('degrades to a bare tail when the cap cannot hold the marker', () => {
      const text = records(50, 100);
      const out = clampTranscript(text, 40);

      expect(out.text.length).toBe(40);
      expect(out.text).toBe(text.slice(-40));
      expect(out.clamped).toBe(true);
    });

    it('falls back to the default cap for a nonsensical one', () => {
      const text = 'y'.repeat(CURATOR_TRANSCRIPT_MAX_CHARS * 2);
      for (const cap of [0, -1, Number.NaN]) {
        expect(clampTranscript(text, cap).text.length).toBeLessThanOrEqual(
          CURATOR_TRANSCRIPT_MAX_CHARS,
        );
      }
    });
  });

  describe('the regression it exists to stop', () => {
    /**
     * `tmp/logs/log.log:1017` — `promptLength: 170655`. The memory boot scan
     * read a whole 268-turn session with no `tailBytes` and skipped
     * `composeTranscript`, the only clamp on the live path.
     */
    it('cuts a 170 KB session transcript to the 32 KB default', () => {
      const out = clampTranscript(records(268, 640));

      expect(out.originalChars).toBeGreaterThan(170_000);
      expect(out.text.length).toBeLessThanOrEqual(CURATOR_TRANSCRIPT_MAX_CHARS);
      expect(out.droppedChars).toBeGreaterThan(130_000);
    });
  });
});
