import { extractVideoId, VIDEO_ID_PATTERN } from './extract-video-id';

/** The id used throughout: 11 chars, exercises both `_`/`-`-free and mixed. */
const ID = 'dQw4w9WgXcQ';

describe('extractVideoId', () => {
  describe('every URL form yields the same id', () => {
    const forms: Array<[string, string]> = [
      ['a bare id', ID],
      ['watch?v=', `https://www.youtube.com/watch?v=${ID}`],
      ['watch?v= with no www', `https://youtube.com/watch?v=${ID}`],
      ['watch?v= on m.', `https://m.youtube.com/watch?v=${ID}`],
      ['watch?v= on music.', `https://music.youtube.com/watch?v=${ID}`],
      [
        'watch?v= with a leading param',
        `https://www.youtube.com/watch?app=desktop&v=${ID}`,
      ],
      [
        'watch?v= with trailing params',
        `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`,
      ],
      ['youtu.be', `https://youtu.be/${ID}`],
      ['youtu.be with params', `https://youtu.be/${ID}?si=abcdefg&t=42`],
      ['/embed/', `https://www.youtube.com/embed/${ID}`],
      [
        '/embed/ with params',
        `https://www.youtube.com/embed/${ID}?rel=0&modestbranding=1`,
      ],
      ['/shorts/', `https://www.youtube.com/shorts/${ID}`],
      ['/live/', `https://www.youtube.com/live/${ID}`],
      ['/v/ (the legacy flash path)', `https://www.youtube.com/v/${ID}`],
      [
        'the nocookie embed host we ourselves render',
        `https://www.youtube-nocookie.com/embed/${ID}`,
      ],
      ['http rather than https', `http://www.youtube.com/watch?v=${ID}`],
      ['no scheme at all (a mobile share sheet)', `youtu.be/${ID}`],
      ['no scheme, watch form', `www.youtube.com/watch?v=${ID}`],
      ['a trailing slash', `https://www.youtube.com/embed/${ID}/`],
      ['surrounding whitespace', `   https://youtu.be/${ID}   `],
      ['an uppercase host', `https://WWW.YOUTUBE.COM/watch?v=${ID}`],
    ];

    it.each(forms)('accepts %s', (_label, input) => {
      expect(extractVideoId(input)).toBe(ID);
    });
  });

  describe('rejects anything that is not a canonical id', () => {
    const rejected: Array<[string, string]> = [
      ['the empty string', ''],
      ['whitespace only', '   '],
      ['a 10-character id', 'dQw4w9WgXc'],
      ['a 12-character id', 'dQw4w9WgXcQZ'],
      [
        'a 10-character id inside a watch URL',
        'https://www.youtube.com/watch?v=dQw4w9WgXc',
      ],
      [
        'a 12-character id inside a watch URL',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQZ',
      ],
      ['a channel URL', 'https://www.youtube.com/@RickAstleyYT'],
      [
        'a playlist URL with no v',
        'https://www.youtube.com/playlist?list=PL1234567890',
      ],
      ['a watch URL with no v parameter', 'https://www.youtube.com/watch?t=42'],
      ['a bare /embed with no id', 'https://www.youtube.com/embed/'],
      [
        'a non-YouTube host serving the same path',
        `https://evil.example.com/watch?v=${ID}`,
      ],
      ['a lookalike host', `https://youtube.com.evil.example/watch?v=${ID}`],
      ['plain prose', '5 minutes'],
      ['a sentence containing an id', `watch this: ${ID} it is great`],
    ];

    it.each(rejected)('rejects %s', (_label, input) => {
      expect(extractVideoId(input)).toBeNull();
    });

    // Base64 confusion is the realistic wrong input: something upstream
    // re-encoded the id with the STANDARD alphabet instead of the URL-safe one.
    it.each([
      ['+', 'dQw4w9W+XcQ'],
      ['/', 'dQw4w9W/XcQ'],
      ['=', 'dQw4w9WgXc='],
      ['a space', 'dQw4w9W XcQ'],
    ])(
      'rejects an 11-character id containing %s (base64 confusion)',
      (_label, input) => {
        expect(input).toHaveLength(11);
        expect(extractVideoId(input)).toBeNull();
      },
    );
  });

  it('does not throw on input that is not a URL at all', () => {
    expect(() => extractVideoId('://////')).not.toThrow();
    expect(extractVideoId('://////')).toBeNull();
  });

  it('does not re-scheme input that already carries one', () => {
    // Prefixing `https://` blindly would make this parseable; refusing to
    // re-scheme keeps the rejection deliberate rather than accidental.
    expect(extractVideoId(`javascript:alert(1)/watch?v=${ID}`)).toBeNull();
  });
});

describe('VIDEO_ID_PATTERN', () => {
  it('is anchored at both ends', () => {
    expect(VIDEO_ID_PATTERN.test(`x${ID}`)).toBe(false);
    expect(VIDEO_ID_PATTERN.test(`${ID}x`)).toBe(false);
  });

  it('carries no `g` flag, so repeated tests do not alternate', () => {
    // A module-level RegExp with /g holds lastIndex between calls: the second
    // .test() of the same string returns false. Batch 10 imports this constant
    // and calls it once per render.
    expect(VIDEO_ID_PATTERN.global).toBe(false);
    expect(VIDEO_ID_PATTERN.test(ID)).toBe(true);
    expect(VIDEO_ID_PATTERN.test(ID)).toBe(true);
    expect(VIDEO_ID_PATTERN.test(ID)).toBe(true);
  });

  it('accepts the URL-safe alphabet and rejects the standard-base64 extras', () => {
    expect(VIDEO_ID_PATTERN.test('-_-_-_-_-_-')).toBe(true);
    expect(VIDEO_ID_PATTERN.test('AAAAAAAAAA+')).toBe(false);
    expect(VIDEO_ID_PATTERN.test('AAAAAAAAAA/')).toBe(false);
  });
});
