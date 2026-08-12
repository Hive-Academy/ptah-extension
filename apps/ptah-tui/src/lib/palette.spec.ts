import { THEMES } from './themes.js';
import {
  ANSI16_DARK,
  ANSI16_LIGHT,
  adaptTheme,
  resolveColorDepth,
} from './palette.js';

describe('resolveColorDepth', () => {
  it('treats NO_COLOR as no colour at all', () => {
    expect(resolveColorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(
      'none',
    );
  });

  it('ignores an empty NO_COLOR, per the informal spec', () => {
    expect(resolveColorDepth({ NO_COLOR: '', COLORTERM: 'truecolor' })).toBe(
      'truecolor',
    );
  });

  it('maps the FORCE_COLOR levels', () => {
    expect(resolveColorDepth({ FORCE_COLOR: '0' })).toBe('none');
    expect(resolveColorDepth({ FORCE_COLOR: '1' })).toBe('ansi16');
    expect(resolveColorDepth({ FORCE_COLOR: '2' })).toBe('truecolor');
    expect(resolveColorDepth({ FORCE_COLOR: '3' })).toBe('truecolor');
  });

  it('lets FORCE_COLOR beat COLORTERM', () => {
    expect(
      resolveColorDepth({ FORCE_COLOR: '1', COLORTERM: 'truecolor' }),
    ).toBe('ansi16');
  });

  it('reads COLORTERM and TERM', () => {
    expect(resolveColorDepth({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(resolveColorDepth({ COLORTERM: '24bit' })).toBe('truecolor');
    expect(resolveColorDepth({ TERM: 'xterm-256color' })).toBe('truecolor');
    expect(resolveColorDepth({ TERM: 'xterm-direct' })).toBe('truecolor');
    expect(resolveColorDepth({ TERM: 'xterm' })).toBe('ansi16');
    expect(resolveColorDepth({ TERM: 'linux' })).toBe('ansi16');
    expect(resolveColorDepth({ TERM: 'dumb' })).toBe('none');
  });

  it('assumes truecolor when nothing is declared', () => {
    expect(resolveColorDepth({})).toBe('truecolor');
  });
});

describe('the 16-colour fallback palettes', () => {
  const palettes: readonly [string, typeof ANSI16_DARK][] = [
    ['dark', ANSI16_DARK],
    ['light', ANSI16_LIGHT],
  ];

  it('keeps the four status colours distinct', () => {
    for (const [name, palette] of palettes) {
      const distinct = new Set(Object.values(palette.status)).size;
      expect({ name, distinct }).toEqual({ name, distinct: 4 });
    }
  });

  it('keeps the three role colours distinct', () => {
    for (const [name, palette] of palettes) {
      const distinct = new Set(Object.values(palette.roles)).size;
      expect({ name, distinct }).toEqual({ name, distinct: 3 });
    }
  });

  it('separates the accent from the dimmed and border colours', () => {
    for (const [name, palette] of palettes) {
      expect({ name, clash: palette.ui.accent === palette.ui.dimmed }).toEqual({
        name,
        clash: false,
      });
      expect({ name, clash: palette.ui.muted === palette.ui.dimmed }).toEqual({
        name,
        clash: false,
      });
    }
  });

  it('uses only names the terminal has, never hex', () => {
    const allowed = new Set([
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'gray',
      'redBright',
      'greenBright',
      'yellowBright',
      'blueBright',
      'magentaBright',
      'cyanBright',
      'whiteBright',
    ]);
    for (const [name, palette] of palettes) {
      const values = [
        ...Object.values(palette.roles),
        ...Object.values(palette.status),
        ...Object.values(palette.ui),
      ];
      const unknown = values.filter((value) => !allowed.has(value));
      expect({ name, unknown }).toEqual({ name, unknown: [] });
    }
  });

  it('never uses white on the light palette, which would be invisible', () => {
    const values = [
      ...Object.values(ANSI16_LIGHT.roles),
      ...Object.values(ANSI16_LIGHT.status),
      ...Object.values(ANSI16_LIGHT.ui),
    ];
    expect(values).not.toContain('white');
    expect(values).not.toContain('whiteBright');
  });
});

describe('adaptTheme', () => {
  it('swaps in the ANSI palette at ansi16, for every shipped theme', () => {
    for (const theme of Object.values(THEMES)) {
      const adapted = adaptTheme(theme, 'ansi16');
      const values = [
        ...Object.values(adapted.roles),
        ...Object.values(adapted.status),
        ...Object.values(adapted.ui),
      ];
      for (const value of values) {
        expect(value).not.toMatch(/^#/);
      }
    }
  });

  it('picks the light palette for a light background', () => {
    expect(adaptTheme(THEMES.light, 'ansi16', 'light')).toBe(ANSI16_LIGHT);
    expect(adaptTheme(THEMES.dark, 'ansi16', 'dark')).toBe(ANSI16_DARK);
  });

  it('passes the theme through untouched at truecolor and none', () => {
    expect(adaptTheme(THEMES.dark, 'truecolor')).toBe(THEMES.dark);
    expect(adaptTheme(THEMES.dark, 'none')).toBe(THEMES.dark);
  });

  it('preserves the theme shape so no component reads undefined', () => {
    for (const theme of Object.values(THEMES)) {
      const adapted = adaptTheme(theme, 'ansi16');
      expect(Object.keys(adapted.ui).sort()).toEqual(
        Object.keys(theme.ui).sort(),
      );
      expect(Object.keys(adapted.roles).sort()).toEqual(
        Object.keys(theme.roles).sort(),
      );
      expect(Object.keys(adapted.status).sort()).toEqual(
        Object.keys(theme.status).sort(),
      );
    }
  });
});
