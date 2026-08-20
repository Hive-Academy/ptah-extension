import type { SearchExcerpt } from '@ptah-contracts/community';

import { HighlightTextPipe } from './highlight-text.pipe';

describe('HighlightTextPipe', () => {
  const pipe = new HighlightTextPipe();

  const excerpt = (
    text: string,
    matches: SearchExcerpt['matches'],
  ): SearchExcerpt => ({ text, matches });

  /** Reassembling the segments must always reproduce the input exactly. */
  function joined(segments: readonly { text: string }[]): string {
    return segments.map((s) => s.text).join('');
  }

  it('splits one match into before / match / after', () => {
    expect(
      pipe.transform(
        excerpt('the bug in the parser', [{ start: 4, length: 3 }]),
      ),
    ).toEqual([
      { text: 'the ', match: false },
      { text: 'bug', match: true },
      { text: ' in the parser', match: false },
    ]);
  });

  it('handles MULTIPLE matches in one excerpt', () => {
    const segments = pipe.transform(
      excerpt('bug here and bug there', [
        { start: 0, length: 3 },
        { start: 13, length: 3 },
      ]),
    );

    expect(segments).toEqual([
      { text: 'bug', match: true },
      { text: ' here and ', match: false },
      { text: 'bug', match: true },
      { text: ' there', match: false },
    ]);
    expect(joined(segments)).toBe('bug here and bug there');
  });

  it('handles a match at the very start and one at the very end', () => {
    expect(
      joined(
        pipe.transform(
          excerpt('abcdef', [
            { start: 0, length: 2 },
            { start: 4, length: 2 },
          ]),
        ),
      ),
    ).toBe('abcdef');
  });

  it('returns ONE unmatched segment when there are zero matches', () => {
    // Valid and normal: a hit can match on a field that is not the one
    // excerpted (`matches: []` is documented as legal).
    expect(pipe.transform(excerpt('nothing matched here', []))).toEqual([
      { text: 'nothing matched here', match: false },
    ]);
  });

  it('returns nothing for an empty, null or undefined excerpt', () => {
    expect(pipe.transform(excerpt('', [{ start: 0, length: 1 }]))).toEqual([]);
    expect(pipe.transform(null)).toEqual([]);
    expect(pipe.transform(undefined)).toEqual([]);
  });

  describe('malformed offsets degrade to plain text — they never throw', () => {
    // ⚠️ A pipe that can crash a page on a boundary case is strictly worse than
    // one that renders the excerpt un-highlighted. Every case below returns the
    // WHOLE text as one unmatched segment, so the member still reads the result.
    const text = 'the bug in the parser';
    const plain = [{ text, match: false }];

    it('a match running past the end of the text', () => {
      expect(
        pipe.transform(excerpt(text, [{ start: 18, length: 50 }])),
      ).toEqual(plain);
    });

    it('a negative start', () => {
      expect(pipe.transform(excerpt(text, [{ start: -1, length: 3 }]))).toEqual(
        plain,
      );
    });

    it('a zero or negative length', () => {
      expect(pipe.transform(excerpt(text, [{ start: 4, length: 0 }]))).toEqual(
        plain,
      );
      expect(pipe.transform(excerpt(text, [{ start: 4, length: -3 }]))).toEqual(
        plain,
      );
    });

    it('OVERLAPPING matches', () => {
      expect(
        pipe.transform(
          excerpt(text, [
            { start: 4, length: 3 },
            { start: 5, length: 3 },
          ]),
        ),
      ).toEqual(plain);
    });

    it('matches out of ascending order', () => {
      expect(
        pipe.transform(
          excerpt(text, [
            { start: 8, length: 2 },
            { start: 4, length: 3 },
          ]),
        ),
      ).toEqual(plain);
    });

    it('a non-integer offset', () => {
      expect(
        pipe.transform(excerpt(text, [{ start: 4.5, length: 3 }])),
      ).toEqual(plain);
    });

    it('rejects the WHOLE list when one entry is bad, not just that entry', () => {
      // Dropping only the bad entry would highlight a DIFFERENT set of
      // characters than the server intended while looking entirely correct — a
      // silent wrong answer. Plain text is a visible, honest degradation.
      expect(
        pipe.transform(
          excerpt(text, [
            { start: 4, length: 3 },
            { start: 100, length: 3 },
          ]),
        ),
      ).toEqual(plain);
    });
  });

  it('NEVER emits an HTML string — no tags, no entities, anywhere (R1.7.5)', () => {
    // ⚠️ This is the security property the whole offsets-not-markup design
    // exists for. The excerpt below contains text that LOOKS like markup; the
    // pipe must carry it through untouched as text, never wrap it, and never
    // build a string containing a tag of its own.
    const hostile = 'a <script>alert(1)</script> & <mark>bug</mark> here';
    const segments = pipe.transform(
      excerpt(hostile, [{ start: 41, length: 3 }]),
    );

    // Reassembly is byte-identical: nothing was inserted or escaped.
    expect(joined(segments)).toBe(hostile);
    // And the pipe added no markup of its own.
    for (const segment of segments) {
      expect(segment).toEqual({
        text: expect.any(String),
        match: expect.any(Boolean),
      });
    }
    expect(segments.some((s) => s.text.includes('<mark>bug</mark>'))).toBe(
      false,
    );
  });

  it('reassembly is lossless for every well-formed input', () => {
    // The invariant behind all of the above: segments partition the text.
    const cases: SearchExcerpt[] = [
      excerpt('abc', []),
      excerpt('abc', [{ start: 0, length: 3 }]),
      excerpt('abcdef', [
        { start: 1, length: 1 },
        { start: 3, length: 2 },
      ]),
      excerpt('  padded  ', [{ start: 2, length: 6 }]),
    ];

    for (const input of cases) {
      expect(joined(pipe.transform(input))).toBe(input.text);
    }
  });
});
