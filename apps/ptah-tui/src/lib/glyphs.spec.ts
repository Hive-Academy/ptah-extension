import { prefersAsciiGlyphs, resolveGlyphSet } from './glyphs.js';

describe('prefersAsciiGlyphs', () => {
  it('honours an explicit ASCII request above everything else', () => {
    expect(
      prefersAsciiGlyphs(
        { PTAH_TUI_ASCII: '1', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' },
        'linux',
      ),
    ).toBe(true);
  });

  it('honours an explicit unicode request on an otherwise hostile terminal', () => {
    expect(
      prefersAsciiGlyphs({ PTAH_TUI_UNICODE: '1', TERM: 'dumb' }, 'linux'),
    ).toBe(false);
  });

  it('falls back to ASCII on dumb and linux consoles', () => {
    expect(prefersAsciiGlyphs({ TERM: 'dumb' }, 'linux')).toBe(true);
    expect(prefersAsciiGlyphs({ TERM: 'linux' }, 'linux')).toBe(true);
  });

  it('falls back to ASCII on a non-UTF-8 locale', () => {
    expect(prefersAsciiGlyphs({ LANG: 'C' }, 'linux')).toBe(true);
    expect(prefersAsciiGlyphs({ LC_ALL: 'POSIX' }, 'linux')).toBe(true);
  });

  it('keeps unicode on a UTF-8 locale regardless of case', () => {
    expect(prefersAsciiGlyphs({ LANG: 'en_US.utf8' }, 'linux')).toBe(false);
    expect(prefersAsciiGlyphs({ LC_CTYPE: 'en_GB.UTF-8' }, 'darwin')).toBe(
      false,
    );
  });

  it('treats an unset locale as modern', () => {
    expect(prefersAsciiGlyphs({}, 'darwin')).toBe(false);
  });

  it('requires a modern host signal on Windows', () => {
    expect(prefersAsciiGlyphs({}, 'win32')).toBe(true);
    expect(prefersAsciiGlyphs({ WT_SESSION: 'abc' }, 'win32')).toBe(false);
    expect(prefersAsciiGlyphs({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(false);
    expect(prefersAsciiGlyphs({ TERM: 'xterm-256color' }, 'win32')).toBe(false);
  });
});

describe('resolveGlyphSet', () => {
  it('returns an all-ASCII set when ASCII is preferred', () => {
    const set = resolveGlyphSet({ PTAH_TUI_ASCII: '1' }, 'linux');
    expect(set.unicode).toBe(false);
    for (const [key, value] of Object.entries(set)) {
      if (key === 'unicode') continue;
      expect(String(value)).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('returns box-drawing glyphs on a modern terminal', () => {
    const set = resolveGlyphSet(
      { LANG: 'en_US.UTF-8', TERM: 'xterm-256color' },
      'linux',
    );
    expect(set.unicode).toBe(true);
    expect(set.ok).toBe('✓');
  });

  it('never emits an astral-plane code point, which most terminals cannot draw', () => {
    for (const env of [{ PTAH_TUI_ASCII: '1' }, { PTAH_TUI_UNICODE: '1' }]) {
      const set = resolveGlyphSet(env, 'linux');
      for (const [key, value] of Object.entries(set)) {
        if (key === 'unicode') continue;
        for (const char of String(value)) {
          expect(char.codePointAt(0) ?? 0).toBeLessThan(0x10000);
        }
      }
    }
  });

  it('keeps every glyph a single column wide', () => {
    for (const env of [{ PTAH_TUI_ASCII: '1' }, { PTAH_TUI_UNICODE: '1' }]) {
      const set = resolveGlyphSet(env, 'linux');
      for (const [key, value] of Object.entries(set)) {
        if (key === 'unicode') continue;
        expect([...String(value)]).toHaveLength(1);
      }
    }
  });
});
