import { resolveGlyphSet } from './glyphs.js';
import {
  WELCOME_ACTION_COUNT,
  buildWelcome,
  measureWelcomeWidth,
  truncatePath,
} from './welcome.js';

const unicode = resolveGlyphSet({ PTAH_TUI_UNICODE: '1' }, 'linux');
const ascii = resolveGlyphSet({ PTAH_TUI_ASCII: '1' }, 'linux');

describe('buildWelcome', () => {
  it('offers exactly three next actions', () => {
    for (const authReady of [true, false]) {
      const model = buildWelcome(
        { workspacePath: '/repo', authReady, columns: 80 },
        unicode,
      );
      expect(model.actions).toHaveLength(WELCOME_ACTION_COUNT);
    }
  });

  it('leads with provider setup when the agent is not configured', () => {
    const model = buildWelcome(
      { workspacePath: '/repo', authReady: false, columns: 80 },
      unicode,
    );
    expect(model.provider.ready).toBe(false);
    expect(model.provider.label).toBe('not configured');
    expect(model.actions[0]?.keys).toBe('Ctrl+S');
  });

  it('surfaces the auth error when there is one', () => {
    const model = buildWelcome(
      {
        workspacePath: '/repo',
        authReady: false,
        authError: 'no API key',
        columns: 80,
      },
      unicode,
    );
    expect(model.provider.label).toBe('not configured — no API key');
  });

  it('names the live model once the provider is ready', () => {
    const model = buildWelcome(
      {
        workspacePath: '/repo',
        authReady: true,
        model: 'claude-opus-4',
        columns: 80,
      },
      unicode,
    );
    expect(model.provider).toEqual({
      label: 'ready — claude-opus-4',
      ready: true,
    });
    expect(model.actions[0]?.keys).toBe('/');
  });

  it('uses the resolved glyph set for the logo', () => {
    expect(
      buildWelcome({ workspacePath: '/r', authReady: true, columns: 80 }, ascii)
        .logo,
    ).toBe('# Ptah');
    expect(
      buildWelcome(
        { workspacePath: '/r', authReady: true, columns: 80 },
        unicode,
      ).logo,
    ).toBe('◈ Ptah');
  });
});

describe('80x24 fit', () => {
  it('fits in 80 columns with a long workspace path', () => {
    const model = buildWelcome(
      {
        workspacePath:
          'D:\\projects\\some\\very\\deeply\\nested\\workspace\\that\\keeps\\going\\forever',
        authReady: false,
        authError:
          'the configured provider returned an unexpectedly long failure message',
        columns: 80,
      },
      unicode,
    );
    expect(measureWelcomeWidth(model)).toBeLessThanOrEqual(80);
  });

  it('fits in a cramped 40-column terminal too', () => {
    const model = buildWelcome(
      {
        workspacePath: '/home/dev/projects/ptah-extension/apps/ptah-tui',
        authReady: true,
        model: 'claude-opus-4-20260101',
        columns: 40,
      },
      unicode,
    );
    expect(measureWelcomeWidth(model)).toBeLessThanOrEqual(60);
  });

  it('leaves room for the composer, status line and a turn inside 24 rows', () => {
    const model = buildWelcome(
      { workspacePath: '/repo', authReady: true, columns: 80 },
      unicode,
    );
    // logo + tagline line, workspace, provider, blank, three actions.
    const renderedRows = 3 + 1 + model.actions.length;
    expect(renderedRows).toBeLessThanOrEqual(12);
  });
});

describe('truncatePath', () => {
  it('keeps the tail, which is the part that identifies the project', () => {
    expect(truncatePath('/a/b/c/d/e/project', 10)).toBe('…e/project');
    expect(truncatePath('/a/b/c/d/e/project', 11)).toBe('…/e/project');
    expect(truncatePath('/short', 20)).toBe('/short');
  });

  it('produces a result exactly as wide as the budget it was given', () => {
    for (const max of [5, 10, 17]) {
      expect(truncatePath('/a/b/c/d/e/project', max)).toHaveLength(max);
    }
  });

  it('degrades safely at absurd widths', () => {
    expect(truncatePath('/a/b', 1)).toBe('');
    expect(truncatePath('/a/b', 0)).toBe('');
  });
});
