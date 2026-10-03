import { registerCustomLanguage, registerCustomTheme } from '@pierre/diffs';
import {
  createPtahDarkTheme,
  createPtahLightTheme,
  labelPierreDiff,
  loadPtahDarkTheme,
  loadPtahLightTheme,
  PIERRE_DARK_THEME,
  PIERRE_HIGHLIGHT_OPTIONS,
  PIERRE_LIGHT_THEME,
  registerPierreResources,
} from './pierre-config';

/** Resolved `pierre-dark` as Shiki normalises it: rules under `settings`. */
const mockPierreDark = {
  name: 'pierre-dark',
  type: 'dark',
  colors: {
    'editor.background': '#0a0a0a',
    'gitDecoration.addedResourceForeground': '#07c480',
  },
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#737373' },
    },
    { scope: ['comment markup.link'], settings: { foreground: '#737373' } },
    { scope: 'keyword', settings: { foreground: '#ff678d' } },
    { scope: ['string'], settings: { foreground: '#5ecc71' } },
  ],
  semanticTokenColors: { comment: '#737373', string: '#5ecc71' },
};

jest.mock('@pierre/diffs', () => ({
  DEFAULT_THEMES: { dark: 'pierre-dark', light: 'pierre-light' },
  registerCustomLanguage: jest.fn(),
  registerCustomTheme: jest.fn(),
  resolveTheme: jest.fn(async () => mockPierreDark),
}));

/** WCAG 2.x contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const mockBaseTheme = {
  name: 'github-light-high-contrast',
  type: 'light',
  colors: { 'editor.background': '#ffffff' },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: '#66707b' },
    },
    { scope: 'keyword', settings: { foreground: '#a0111f' } },
    { scope: ['string'], settings: { foreground: '#032563' } },
  ],
};

jest.mock('shiki/themes/github-light-high-contrast.mjs', () => ({
  default: mockBaseTheme,
}));

/**
 * One Pierre `line-info` separator as `createSeparator` (Pierre 1.5.1) builds
 * it: expand buttons, the "N unmodified lines" text and, for a gap longer
 * than one expansion step, an "Expand all" button.
 */
function separator(
  buttons: ReadonlyArray<'up' | 'down' | 'both'>,
  content: string,
  chunked = false,
): string {
  const icons = buttons
    .map(
      (direction) =>
        `<div role="button" data-expand-button data-expand-${direction}><svg data-icon></svg></div>`,
    )
    .join('');
  const expandAll = chunked
    ? '<div role="button" data-expand-button data-expand-all-button>Expand all</div>'
    : '';
  return (
    `<div data-separator="line-info"><div data-separator-wrapper>${icons}` +
    `<div data-separator-content><span data-unmodified-lines>${content}</span></div>` +
    `${expandAll}</div></div>`
  );
}

function root(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function names(host: HTMLElement): (string | null)[] {
  return Array.from(
    host.querySelectorAll('[data-expand-button]'),
    (button) => button.getAttribute('aria-label') ?? button.textContent,
  );
}

describe('labelPierreDiff — expand buttons (axe aria-command-name)', () => {
  it('names each single-step button with the hidden-line count', () => {
    const host = root(
      separator(['down'], '12 unmodified lines') +
        separator(['both'], '1 unmodified line') +
        separator(['up'], '3 unmodified lines'),
    );

    labelPierreDiff(host, 'a.ts');

    expect(names(host)).toEqual([
      'Show 12 hidden lines',
      'Show 1 hidden line',
      'Show 3 hidden lines',
    ]);
  });

  it('tells the two buttons of a chunked gap apart and leaves "Expand all" as text', () => {
    const host = root(separator(['up', 'down'], '240 unmodified lines', true));

    labelPierreDiff(host, 'a.ts');

    expect(names(host)).toEqual([
      'Show more of 240 hidden lines after the change above',
      'Show more of 240 hidden lines before the change below',
      'Expand all',
    ]);
    expect(
      host
        .querySelector('[data-expand-all-button]')
        ?.hasAttribute('aria-label'),
    ).toBe(false);
  });

  it('falls back to a count-free name when the separator text has no number', () => {
    const host = root(separator(['both'], ''));

    labelPierreDiff(host, 'a.ts');

    expect(names(host)).toEqual(['Show hidden lines']);
  });

  it('updates the name when Pierre re-renders a separator with a new count', () => {
    const host = root(separator(['both'], '9 unmodified lines'));
    labelPierreDiff(host, 'a.ts');
    const text = host.querySelector('[data-unmodified-lines]');
    if (text) text.textContent = '4 unmodified lines';

    labelPierreDiff(host, 'a.ts');

    expect(names(host)).toEqual(['Show 4 hidden lines']);
  });
});

describe('light diff theme (Batch 68 light color-contrast)', () => {
  it('highlights with ptah-dark and ptah-light', () => {
    expect(PIERRE_HIGHLIGHT_OPTIONS.theme).toEqual({
      dark: PIERRE_DARK_THEME,
      light: PIERRE_LIGHT_THEME,
    });
  });

  it('deepens only the comment ink of the base theme and renames it', () => {
    const theme = createPtahLightTheme(mockBaseTheme);

    expect(theme.name).toBe(PIERRE_LIGHT_THEME);
    expect(theme.type).toBe('light');
    expect(theme.tokenColors?.map((rule) => rule.settings.foreground)).toEqual([
      '#4b535d',
      '#a0111f',
      '#032563',
    ]);
    // The source theme object is not mutated.
    expect(mockBaseTheme.tokenColors[0].settings.foreground).toBe('#66707b');
  });

  it('registers the grammars and both themes once, loading GitHub Light High Contrast and pierre-dark', async () => {
    registerPierreResources();
    registerPierreResources();

    expect(jest.mocked(registerCustomTheme)).toHaveBeenCalledTimes(2);
    expect(
      jest.mocked(registerCustomLanguage).mock.calls.length,
    ).toBeGreaterThan(0);
    const calls = jest.mocked(registerCustomTheme).mock.calls;
    expect(calls.map(([name]) => name)).toEqual([
      PIERRE_LIGHT_THEME,
      PIERRE_DARK_THEME,
    ]);
    for (const [name, load] of calls) {
      const theme = await (load as () => Promise<{ name?: string }>)();
      expect(theme.name).toBe(name);
    }
  });

  it('falls back to a plain readable light theme, logged, when the base theme cannot load', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {
      // Expected: the failure is logged.
    });

    const theme = await loadPtahLightTheme(() =>
      Promise.reject(new Error('chunk failed')),
    );

    expect(theme).toMatchObject({
      name: PIERRE_LIGHT_THEME,
      type: 'light',
      tokenColors: [],
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('dark diff theme (cutover visual review N-1, dark color-contrast)', () => {
  /** pierre-dark's row backgrounds as rendered (axe-measured addition row). */
  const ROWS = {
    context: '#0a0a0a',
    addition: '#154b35',
    deletion: '#60171d',
  };

  it('lifts only the comment ink of pierre-dark and renames it', () => {
    const theme = createPtahDarkTheme(mockPierreDark as never) as unknown as {
      name: string;
      type: string;
      colors: Record<string, string>;
      settings: { settings: { foreground: string } }[];
      semanticTokenColors: Record<string, string>;
    };

    expect(theme.name).toBe(PIERRE_DARK_THEME);
    expect(theme.type).toBe('dark');
    expect(theme.colors).toEqual(mockPierreDark.colors);
    const inks = theme.settings.map((rule) => rule.settings.foreground);
    expect(inks.slice(2)).toEqual(['#ff678d', '#5ecc71']);
    expect(inks[0]).toBe(inks[1]);
    expect(theme.semanticTokenColors).toEqual({
      comment: inks[0],
      string: '#5ecc71',
    });
    // The source theme object is not mutated.
    expect(mockPierreDark.settings[0].settings.foreground).toBe('#737373');
  });

  it.each(Object.entries(ROWS))(
    'gives comments at least 4.5:1 on the %s row',
    (_row, background) => {
      const theme = createPtahDarkTheme(mockPierreDark as never) as unknown as {
        settings: { settings: { foreground: string } }[];
      };
      expect(
        contrast(theme.settings[0].settings.foreground, background),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('falls back to a plain readable dark theme, logged, when pierre-dark cannot resolve', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {
      // Expected: the failure is logged.
    });

    const theme = await loadPtahDarkTheme(() =>
      Promise.reject(new Error('no loader')),
    );

    expect(theme).toMatchObject({
      name: PIERRE_DARK_THEME,
      type: 'dark',
      tokenColors: [],
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
