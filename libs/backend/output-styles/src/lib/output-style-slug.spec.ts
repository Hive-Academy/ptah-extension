/**
 * Slug safety is a security boundary, so this spec is written as one: every
 * case below is a payload that must not be allowed to become a path.
 */
import {
  MAX_SLUG_LENGTH,
  slugifyStyleName,
  styleFileName,
} from './output-style-slug';

function expectRejected(input: string): string {
  const result = slugifyStyleName(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected rejection');
  expect(result.error.code).toBe('INVALID_NAME');
  expect(result.error.message.length).toBeGreaterThan(0);
  return result.error.message;
}

function expectSlug(input: string): string {
  const result = slugifyStyleName(input);
  if (!result.ok) {
    throw new Error(`expected a slug, got ${result.error.message}`);
  }
  return result.slug;
}

describe('slugifyStyleName', () => {
  describe('path traversal', () => {
    it.each([
      '../evil',
      '..\\evil',
      '../../etc/passwd',
      'styles/../../evil',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'C:\\Windows\\System32',
      'C:/Windows',
      '..',
      '.',
      '..hidden',
    ])('rejects %p', (input) => {
      expectRejected(input);
    });

    it('names the separator rather than silently sanitising it', () => {
      expect(expectRejected('a/b')).toContain('path separator');
    });

    it('rejects a drive colon before normalisation could hide it', () => {
      expect(expectRejected('C:styles')).toContain('colon');
    });
  });

  describe('reserved Windows device names', () => {
    const reserved = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9',
    ];

    it.each(reserved)('rejects %s bare', (name) => {
      expectRejected(name);
    });

    it.each(reserved)('rejects %s with a .md extension', (name) => {
      expectRejected(`${name}.md`);
    });

    it.each(reserved)('rejects %s lower-cased', (name) => {
      expectRejected(name.toLowerCase());
    });

    it('rejects a name that only becomes reserved after normalisation', () => {
      // "con!" survives the raw check and folds to "con".
      expect(expectRejected('con!')).toContain('reserved');
    });

    it('accepts a name that merely contains a device name', () => {
      expect(expectSlug('Console Output')).toBe('console-output');
    });
  });

  describe('normalisation', () => {
    it('lowercases and hyphenates', () => {
      expect(expectSlug('My Great Style')).toBe('my-great-style');
    });

    it('strips unicode accents rather than the whole letter', () => {
      expect(expectSlug('Café Résumé')).toBe('cafe-resume');
    });

    // Written as escapes, not literal marks: an invisible combining character
    // pasted into source is exactly the kind of thing an editor silently eats.
    it.each([
      ['base block (U+0300-U+036F)', String.fromCodePoint(0x0301)],
      ['extended block (U+1AB0-U+1AFF)', String.fromCodePoint(0x1ab0)],
      ['supplement block (U+1DC0-U+1DFF)', String.fromCodePoint(0x1dc0)],
    ])(
      'drops a combining mark from the %s instead of hyphenating it',
      (_label, mark) => {
        expect(expectSlug(`Ter${mark}se Style`)).toBe('terse-style');
      },
    );

    it('collapses runs of separators and trims the edges', () => {
      expect(expectSlug('  ***Hello___World!!!  ')).toBe('hello-world');
    });

    it('keeps digits', () => {
      expect(expectSlug('Style 2 Electric Boogaloo')).toBe(
        'style-2-electric-boogaloo',
      );
    });
  });

  describe('length', () => {
    it(`truncates to ${MAX_SLUG_LENGTH} characters`, () => {
      const slug = expectSlug('a'.repeat(200));
      expect(slug).toHaveLength(MAX_SLUG_LENGTH);
    });

    it('does not leave a trailing separator after truncation', () => {
      // The space becomes the 64th character, so a naive slice would end in "-".
      const input = `${'a'.repeat(MAX_SLUG_LENGTH - 1)} tail`;
      const slug = expectSlug(input);
      expect(slug.endsWith('-')).toBe(false);
      expect(slug).toBe('a'.repeat(MAX_SLUG_LENGTH - 1));
    });
  });

  describe('empty results', () => {
    it.each(['', '   ', '!!!', '---', '???'])(
      'rejects %p because nothing survives slugging',
      (input) => {
        expectRejected(input);
      },
    );
  });

  it('produces a .md basename', () => {
    expect(styleFileName(expectSlug('My Style'))).toBe('my-style.md');
  });
});
