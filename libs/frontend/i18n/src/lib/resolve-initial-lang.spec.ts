import { resolveInitialLang } from './resolve-initial-lang';

describe('resolveInitialLang', () => {
  it('returns a valid stored language over the browser language', () => {
    expect(resolveInitialLang({ stored: 'ar', languages: ['en-US'] })).toBe(
      'ar',
    );
    expect(resolveInitialLang({ stored: 'en', languages: ['ar-EG'] })).toBe(
      'en',
    );
  });

  it('selects Arabic when the first browser language is Arabic', () => {
    expect(resolveInitialLang({ stored: null, languages: ['ar-EG'] })).toBe(
      'ar',
    );
    expect(resolveInitialLang({ stored: null, languages: ['AR'] })).toBe('ar');
  });

  it('ignores an invalid stored value and falls through to detection', () => {
    expect(resolveInitialLang({ stored: 'xx', languages: ['ar-EG'] })).toBe(
      'ar',
    );
    expect(resolveInitialLang({ stored: 'xx', languages: ['fr-FR'] })).toBe(
      'en',
    );
  });

  it('only looks at the first browser language', () => {
    expect(
      resolveInitialLang({ stored: null, languages: ['fr-FR', 'ar-EG'] }),
    ).toBe('en');
  });

  it('defaults to English with no languages or no navigator', () => {
    expect(resolveInitialLang({ stored: null, languages: [] })).toBe('en');
    expect(resolveInitialLang({ stored: null, languages: undefined })).toBe(
      'en',
    );
  });
});
