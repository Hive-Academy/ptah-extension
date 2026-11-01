/**
 * ThemeService specs — signal-based theme state with VS Code state persistence
 * and `data-theme` DOM sync effect.
 *
 * Coverage:
 *   - Initial theme: (1) persisted `theme-v2` value wins, (2) a legacy
 *     `theme` value is migrated onto the glass pair, (3) falls back to VS Code
 *     theme kind, (4) defaults to 'ptah-glass' otherwise.
 *   - Invalid persisted theme is rejected.
 *   - `setTheme` updates the signal and persists via `VSCodeService.setState`.
 *   - `toggleTheme` follows the current theme mode.
 *   - `isDarkMode` computed matches the dark-theme allowlist.
 *   - `effect()` on `currentTheme` writes `document.documentElement` attribute.
 */

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from './vscode.service';
import { DAISYUI_THEMES, DEFAULT_MOTION_STYLE, MOTION_STYLES, ThemeService, type ThemeName, type SceneName, type MotionStyleName } from './theme.service';

interface MockVSCodeService {
  getState: jest.Mock<unknown, [string]>;
  setState: jest.Mock<void, [string, unknown]>;
  config: jest.Mock<{ theme: 'light' | 'dark' | 'high-contrast' }, []>;
}

function createMockVscode(
  options: {
    persisted?: string | undefined;
    /** Value under the pre-glass `theme` key, which is only ever migrated. */
    legacy?: string | undefined;
    themeKind?: 'light' | 'dark' | 'high-contrast';
  } = {},
): MockVSCodeService {
  const { persisted, legacy, themeKind = 'dark' } = options;
  const persistedStore: Record<string, unknown> = {};
  if (persisted !== undefined) {
    persistedStore['theme-v2'] = persisted;
  }
  if (legacy !== undefined) {
    persistedStore['theme'] = legacy;
  }
  return {
    getState: jest.fn((key: string) => persistedStore[key]),
    setState: jest.fn((key: string, value: unknown) => {
      persistedStore[key] = value;
    }),
    config: jest.fn(() => ({ theme: themeKind })),
  };
}

function configure(mock: MockVSCodeService): ThemeService {
  TestBed.configureTestingModule({
    providers: [ThemeService, { provide: VSCodeService, useValue: mock }],
  });
  return TestBed.inject(ThemeService);
}

/**
 * Recreate the non-fetching marker `<link>` that `index.html` puts in `<head>`
 * to carry the deferred sheet's host-resolved URL.
 */
function addDeferredSheetMarker(): void {
  const marker = document.createElement('link');
  marker.id = 'ptah-theme-extra';
  marker.rel = 'ptah-deferred-stylesheet';
  marker.href = 'theme-extra.css';
  document.head.appendChild(marker);
}

function deferredSheetLink(): HTMLLinkElement | null {
  return document.getElementById(
    'ptah-theme-extra-sheet',
  ) as HTMLLinkElement | null;
}

describe('ThemeService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-glass');
    document.documentElement.removeAttribute('data-glass-mode');
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-scene');
    document.documentElement.removeAttribute('data-motion-style');
    document.getElementById('ptah-theme-extra')?.remove();
    document.getElementById('test-app-styles')?.remove();
    deferredSheetLink()?.remove();
    localStorage.removeItem('ptah-theme');
    localStorage.removeItem('ptah-theme-v2');
    localStorage.removeItem('ptah-accent');
    localStorage.removeItem('ptah-scene');
    localStorage.removeItem('ptah-motion-style');
    jest.restoreAllMocks();
  });

  describe('backdrop scenes', () => {
    it.each([
      [undefined, undefined, 'aurora'],
      ['retired', 'invalid', 'aurora'],
      ['ember', 'tide', 'ember'],
      ['aurora', 'horizon', 'aurora'],
      [undefined, 'tide', 'tide'],
      ['retired', 'horizon', 'horizon'],
    ])('reads state %s and mirror %s without writing either scene store', (state, hint, expected) => {
      const mock = createMockVscode();
      mock.getState.mockImplementation((key) => key === 'ptah-scene' ? state : undefined);
      if (hint) localStorage.setItem('ptah-scene', hint);
      const mirrorWrite = jest.spyOn(Storage.prototype, 'setItem');
      const service = configure(mock);
      TestBed.inject(ApplicationRef).tick();
      expect(service.scene()).toBe(expected);
      expect(mock.setState).not.toHaveBeenCalledWith('ptah-scene', expect.anything());
      expect(mirrorWrite).not.toHaveBeenCalledWith('ptah-scene', expect.anything());
      expect(localStorage.getItem('ptah-scene')).toBe(hint ?? null);
    });

    it('shares the choice across the pair and hides the attribute on every other theme', () => {
      const mock = createMockVscode();
      const service = configure(mock);
      const app = TestBed.inject(ApplicationRef);
      service.setScene('ember');
      expect(mock.setState).toHaveBeenCalledWith('ptah-scene', 'ember');
      expect(localStorage.getItem('ptah-scene')).toBe('ember');
      for (const { name } of DAISYUI_THEMES) {
        service.setTheme(name);
        app.tick();
        expect(service.scene()).toBe('ember');
        expect(document.documentElement.getAttribute('data-scene')).toBe(
          name === 'ptah-glass' || name === 'ptah-glass-light' ? 'ember' : null,
        );
      }
      service.setTheme('ptah-glass');
      service.setScene('aurora');
      app.tick();
      expect(document.documentElement.hasAttribute('data-scene')).toBe(false);
      expect(mock.setState).toHaveBeenCalledWith('ptah-scene', 'aurora');
      expect(localStorage.getItem('ptah-scene')).toBe('aurora');
    });

    it('ignores invalid setter input', () => {
      const mock = createMockVscode();
      const service = configure(mock);
      const mirrorWrite = jest.spyOn(Storage.prototype, 'setItem');
      service.setScene('retired' as SceneName);
      expect(service.scene()).toBe('aurora');
      expect(mock.setState).not.toHaveBeenCalled();
      expect(mirrorWrite).not.toHaveBeenCalled();
    });

    it('uses state and still persists user choices when localStorage throws', () => {
      const mock = createMockVscode();
      mock.getState.mockImplementation((key) => key === 'ptah-scene' ? 'tide' : undefined);
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      const service = configure(mock);
      expect(service.scene()).toBe('tide');
      expect(() => service.setScene('horizon')).not.toThrow();
      expect(service.scene()).toBe('horizon');
      expect(mock.setState).toHaveBeenCalledWith('ptah-scene', 'horizon');
    });
  });

  describe('motion style', () => {
    it.each([
      [undefined, undefined, 'rise'],
      ['slide-left', 'scale', 'slide-left'],
      ['rise', 'scale', 'rise'],
      [undefined, 'directional', 'directional'],
      ['retired', 'slide-right', 'slide-right'],
      ['retired', 'none', 'rise'],
    ])('reads state %s then hint %s without writing at boot', (state, hint, expected) => {
      const mock = createMockVscode();
      mock.getState.mockImplementation((key) => key === 'ptah-motion-style' ? state : undefined);
      if (hint) localStorage.setItem('ptah-motion-style', hint);
      const mirrorWrite = jest.spyOn(Storage.prototype, 'setItem');
      const service = configure(mock);
      TestBed.inject(ApplicationRef).tick();
      expect(service.motionStyle()).toBe(expected);
      expect(document.documentElement.getAttribute('data-motion-style')).toBe(expected === DEFAULT_MOTION_STYLE ? null : expected);
      expect(mock.setState).not.toHaveBeenCalled();
      expect(mirrorWrite).not.toHaveBeenCalledWith('ptah-motion-style', expect.anything());
    });

    it('accepts each preset, persists it, and removes the default attribute', () => {
      const mock = createMockVscode();
      const service = configure(mock);
      const app = TestBed.inject(ApplicationRef);
      for (const style of MOTION_STYLES) {
        service.setMotionStyle(style);
        app.tick();
        expect(service.motionStyle()).toBe(style);
        expect(mock.setState).toHaveBeenCalledWith('ptah-motion-style', style);
        expect(localStorage.getItem('ptah-motion-style')).toBe(style);
        expect(document.documentElement.getAttribute('data-motion-style')).toBe(style === DEFAULT_MOTION_STYLE ? null : style);
      }
    });

    it('ignores unknown choices and persists state when the mirror is blocked', () => {
      const mock = createMockVscode();
      const service = configure(mock);
      service.setMotionStyle('none' as MotionStyleName);
      expect(service.motionStyle()).toBe(DEFAULT_MOTION_STYLE);
      expect(mock.setState).not.toHaveBeenCalled();
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      expect(() => service.setMotionStyle('fade')).not.toThrow();
      expect(mock.setState).toHaveBeenCalledWith('ptah-motion-style', 'fade');
    });
  });

  describe('initial theme resolution', () => {
    it('uses the persisted theme when VSCodeService.getState returns a valid name', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('dracula');
      expect(mock.getState).toHaveBeenCalledWith('theme-v2');
    });

    it('ignores invalid persisted values and falls back to VS Code theme kind', () => {
      const mock = createMockVscode({
        persisted: 'not-a-real-theme',
        themeKind: 'light',
      });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('ptah-glass-light');
    });

    it('defaults to Ptah glass when VS Code theme kind is dark and nothing is persisted', () => {
      const mock = createMockVscode({ themeKind: 'dark' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('ptah-glass');
    });

    it('switches to Ptah glass light on first launch when VS Code theme kind is light', () => {
      const mock = createMockVscode({ themeKind: 'light' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('ptah-glass-light');
    });

    /**
     * Regression, TASK_2026_187 Unit 9 / PR #463.
     *
     * `index.html`'s pre-paint script resolves the theme from
     * `vscode.getState()` OR the `localStorage` mirror, whichever answers
     * first, and paints it. This service used to read only the first source.
     * When it came back empty — VS Code discards a disposed webview's state
     * while `localStorage` survives — initialization fell through to the
     * default and the `data-theme` effect repainted the user's theme back to
     * `anubis` one frame after the correct paint. Observed as
     * `expected "anubis-light", received "anubis"` in
     * `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts`.
     */
    describe('when vscode state is empty but the localStorage mirror survives', () => {
      it('adopts the mirrored theme instead of repainting to the default', () => {
        localStorage.setItem('ptah-theme-v2', 'anubis-light');

        const service = configure(createMockVscode({ themeKind: 'dark' }));
        TestBed.inject(ApplicationRef).tick();

        expect(service.currentTheme()).toBe('anubis-light');
        expect(document.documentElement.getAttribute('data-theme')).toBe(
          'anubis-light',
        );
      });

      it('adopts a mirrored DEFERRED theme and requests its sheet', () => {
        addDeferredSheetMarker();
        localStorage.setItem('ptah-theme-v2', 'dracula');

        const service = configure(createMockVscode({ themeKind: 'dark' }));

        expect(service.currentTheme()).toBe('dracula');
        expect(deferredSheetLink()).not.toBeNull();
      });

      it('does not write state at boot when only the v2 mirror is present', () => {
        // Electron state is per workspace and the mirror is origin-wide, so
        // this is every further workspace's first open. A repair write here
        // would replace the whole state record from a possibly stale snapshot
        // (PR #805); the mirror already answers this read and the pre-paint.
        localStorage.setItem('ptah-theme-v2', 'nord');
        const mock = createMockVscode();

        const service = configure(mock);

        expect(service.currentTheme()).toBe('nord');
        expect(mock.setState).not.toHaveBeenCalled();
      });

      it('ignores an unrecognised mirror value and uses the theme kind', () => {
        localStorage.setItem('ptah-theme-v2', 'not-a-real-theme');

        const service = configure(createMockVscode({ themeKind: 'light' }));

        expect(service.currentTheme()).toBe('ptah-glass-light');
      });
    });

    it('prefers the authoritative vscode state over a stale localStorage mirror', () => {
      localStorage.setItem('ptah-theme-v2', 'nord');
      const mock = createMockVscode({ persisted: 'dracula' });

      const service = configure(mock);

      expect(service.currentTheme()).toBe('dracula');
      // Nothing to repair — the authoritative store already answered.
      expect(mock.setState).not.toHaveBeenCalled();
    });
  });

  /**
   * One-time move of upgraded users onto the Ptah glass default. The current
   * keys are versioned (`theme-v2` / `ptah-theme-v2`); a profile with only the
   * pre-glass keys is mapped onto the glass pair by lightness, and nothing is
   * written at boot (a boot write can be lost next to main-process writers,
   * PR #805, so the migration is re-derived until the user picks a theme).
   */
  describe('legacy theme migration', () => {
    it('maps a legacy dark theme to ptah-glass', () => {
      const service = configure(createMockVscode({ legacy: 'anubis' }));

      expect(service.currentTheme()).toBe('ptah-glass');
    });

    it('maps a legacy light theme to ptah-glass-light, regardless of theme kind', () => {
      const service = configure(
        createMockVscode({ legacy: 'cupcake', themeKind: 'dark' }),
      );

      expect(service.currentTheme()).toBe('ptah-glass-light');
    });

    it('keeps a legacy glass choice', () => {
      expect(
        configure(createMockVscode({ legacy: 'ptah-glass-light' })).currentTheme(),
      ).toBe('ptah-glass-light');
      TestBed.resetTestingModule();
      expect(
        configure(
          createMockVscode({ legacy: 'ptah-glass', themeKind: 'light' }),
        ).currentTheme(),
      ).toBe('ptah-glass');
    });

    it('migrates from the legacy localStorage mirror when legacy state is gone', () => {
      localStorage.setItem('ptah-theme', 'dracula');

      const service = configure(createMockVscode({ themeKind: 'light' }));

      expect(service.currentTheme()).toBe('ptah-glass');
    });

    it('lets a v2 value win over the legacy one, including v2 = anubis', () => {
      localStorage.setItem('ptah-theme', 'anubis-light');
      const service = configure(
        createMockVscode({ persisted: 'anubis', legacy: 'anubis-light' }),
      );

      expect(service.currentTheme()).toBe('anubis');
    });

    it('lets a v2 mirror win over legacy state', () => {
      localStorage.setItem('ptah-theme-v2', 'anubis');

      const service = configure(createMockVscode({ legacy: 'anubis-light' }));

      expect(service.currentTheme()).toBe('anubis');
    });

    it('writes no state and no v2 mirror at boot on the migration path', () => {
      localStorage.setItem('ptah-theme', 'dracula');
      const mock = createMockVscode({ legacy: 'dracula' });
      addDeferredSheetMarker();

      configure(mock);

      expect(mock.setState).not.toHaveBeenCalled();
      expect(localStorage.getItem('ptah-theme-v2')).toBeNull();
      // The glass pair is in styles.css: the migrated user never fetches the
      // deferred sheet for the theme they are migrating away from.
      expect(deferredSheetLink()).toBeNull();
    });

    it('takes the v2 mirror over legacy state with no writes (second Electron workspace)', () => {
      // Workspace B still holds the pre-glass `theme` in its own state; the
      // user picked nord in workspace A, which wrote the origin-wide mirror.
      localStorage.setItem('ptah-theme-v2', 'nord');
      const mock = createMockVscode({ legacy: 'anubis' });

      const service = configure(mock);

      expect(service.currentTheme()).toBe('nord');
      expect(mock.setState).not.toHaveBeenCalled();
    });

    it('skips the migration when a v2 state value is present but unknown', () => {
      // A v2 value means the user already chose after the migration, so the
      // legacy value must not come back even if this build cannot apply it.
      const service = configure(
        createMockVscode({
          persisted: 'retired-theme',
          legacy: 'anubis-light',
          themeKind: 'dark',
        }),
      );

      expect(service.currentTheme()).toBe('ptah-glass');
    });

    it('skips the migration when only an unknown v2 mirror is present', () => {
      localStorage.setItem('ptah-theme-v2', 'retired-theme');
      const mock = createMockVscode({ legacy: 'dracula', themeKind: 'light' });

      const service = configure(mock);

      // Theme kind decides, not the dark legacy value.
      expect(service.currentTheme()).toBe('ptah-glass-light');
      expect(mock.setState).not.toHaveBeenCalled();
    });

    it('shadows a choice made in a downgraded build with the older v2 value (accepted)', () => {
      // v2 = nord was picked before a downgrade; the pre-glass build then
      // wrote dracula to the legacy keys only. On re-upgrade v2 still wins.
      // Documented on LEGACY_THEME_STATE_KEY: fixing it needs a boot write.
      localStorage.setItem('ptah-theme', 'dracula');
      const service = configure(
        createMockVscode({ persisted: 'nord', legacy: 'dracula' }),
      );

      expect(service.currentTheme()).toBe('nord');
    });

    it('ignores an unknown legacy value and uses the theme kind', () => {
      const service = configure(
        createMockVscode({ legacy: 'retired-theme', themeKind: 'light' }),
      );

      expect(service.currentTheme()).toBe('ptah-glass-light');
    });
  });

  describe('accent initialization', () => {
    it('adopts a valid stored accent without rewriting the state', () => {
      const mock = createMockVscode();
      mock.getState.mockImplementation(
        (key: string) => (key === 'ptah-accent' ? 'moonstone' : undefined),
      );

      const service = configure(mock);

      expect(service.accent()).toBe('moonstone');
      expect(mock.setState).not.toHaveBeenCalled();
    });

    it('leaves a fresh profile unwritten — an absent accent is the default everywhere', () => {
      const mock = createMockVscode();

      const service = configure(mock);

      expect(service.accent()).toBe('gold');
      // Nothing to repair, so initialization must not replace the state
      // record: a boot write clobbers keys other writers store around
      // Angular bootstrap (Electron webview state, PR #805).
      expect(mock.setState).not.toHaveBeenCalled();
      expect(localStorage.getItem('ptah-accent')).toBe('gold');
    });

    it('does not write state on a second boot when the only hint is default gold', () => {
      const mock = createMockVscode();
      configure(mock);
      expect(localStorage.getItem('ptah-accent')).toBe('gold');
      expect(mock.setState).not.toHaveBeenCalled();

      // New process: the hint the first boot planted is still there, the
      // authoritative key is still absent. Reset the testing module so the
      // next configure() constructs a new ThemeService.
      TestBed.resetTestingModule();
      mock.setState.mockClear();
      const second = configure(mock);

      expect(second.accent()).toBe('gold');
      expect(mock.getState('ptah-accent')).toBeUndefined();
      expect(mock.setState).not.toHaveBeenCalled();
    });

    it('repairs an absent state accent from the localStorage mirror', () => {
      localStorage.setItem('ptah-accent', 'rose');
      const mock = createMockVscode();

      const service = configure(mock);

      expect(service.accent()).toBe('rose');
      expect(mock.setState).toHaveBeenCalledWith('ptah-accent', 'rose');
    });
  });

  describe('setTheme()', () => {
    it('updates the signal and persists via VSCodeService.setState', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      service.setTheme('synthwave');

      expect(service.currentTheme()).toBe('synthwave');
      expect(mock.setState).toHaveBeenCalledWith('theme-v2', 'synthwave');
    });

    it('writes only the versioned keys and leaves the legacy ones untouched', () => {
      localStorage.setItem('ptah-theme', 'anubis');
      const mock = createMockVscode({ legacy: 'anubis' });
      const service = configure(mock);

      service.setTheme('anubis');

      expect(mock.setState.mock.calls).toEqual([['theme-v2', 'anubis']]);
      expect(localStorage.getItem('ptah-theme-v2')).toBe('anubis');
      expect(mock.getState('theme')).toBe('anubis');
      expect(localStorage.getItem('ptah-theme')).toBe('anubis');
    });

    it('keeps a post-migration choice of a legacy theme on the next launch', () => {
      // The migrated user picks anubis again. That choice lives under the
      // versioned keys now, so the migration must not take it back.
      const mock = createMockVscode({ legacy: 'dracula' });
      configure(mock).setTheme('anubis');

      TestBed.resetTestingModule();
      const next = configure(mock);

      expect(next.currentTheme()).toBe('anubis');
    });

    it('accepts every theme declared in DAISYUI_THEMES', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      // Spot-check a handful including custom + prebuilt + dark + light.
      const sample: ThemeName[] = [
        'anubis',
        'anubis-light',
        'dark',
        'light',
        'cupcake',
        'sunset',
      ];
      for (const theme of sample) {
        service.setTheme(theme);
        expect(service.currentTheme()).toBe(theme);
      }
    });
  });

  describe('toggleTheme()', () => {
    it('toggles the Ptah glass pair', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      expect(service.currentTheme()).toBe('ptah-glass');
      service.toggleTheme();
      expect(service.currentTheme()).toBe('ptah-glass-light');
      service.toggleTheme();
      expect(service.currentTheme()).toBe('ptah-glass');
    });

    it('toggles a dark non-pair theme to Ptah glass light', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);

      service.toggleTheme();
      expect(service.currentTheme()).toBe('ptah-glass-light');
    });

    it('toggles a light non-pair theme to Ptah glass dark', () => {
      const service = configure(createMockVscode({ persisted: 'anubis-light' }));
      service.toggleTheme();
      expect(service.currentTheme()).toBe('ptah-glass');
    });
  });

  describe('deferred theme sheet (theme-extra.css)', () => {
    it('mirrors the theme into localStorage so index.html can read it pre-paint', () => {
      const service = configure(createMockVscode());

      service.setTheme('anubis-light');

      expect(localStorage.getItem('ptah-theme-v2')).toBe('anubis-light');
    });

    it('re-arms the localStorage mirror from persisted state on construction', () => {
      configure(createMockVscode({ persisted: 'nord' }));

      expect(localStorage.getItem('ptah-theme-v2')).toBe('nord');
    });

    it('never inserts the sheet for the two themes bundled in styles.css', () => {
      addDeferredSheetMarker();
      const service = configure(createMockVscode());

      service.setTheme('anubis-light');
      service.setTheme('anubis');

      expect(deferredSheetLink()).toBeNull();
      expect(service.currentTheme()).toBe('anubis');
    });

    it('holds the theme back until the sheet loads on the first deferred switch', async () => {
      addDeferredSheetMarker();
      const service = configure(createMockVscode());

      service.setTheme('dracula');

      // Sheet requested, but the theme has NOT been applied yet — applying it
      // early would leave [data-theme=dracula] matching nothing.
      const link = deferredSheetLink();
      expect(link).not.toBeNull();
      expect(link?.rel).toBe('stylesheet');
      expect(service.currentTheme()).toBe('ptah-glass');

      link?.dispatchEvent(new Event('load'));
      await Promise.resolve();

      expect(service.currentTheme()).toBe('dracula');
    });

    it('inserts the deferred sheet BEFORE the app stylesheet', async () => {
      // Order is the whole fix. Both sheets carry (0,1,0) selectors, and
      // `theme-extra.css` opens with daisyUI's `:root` copy of the `light`
      // theme. Appended last, that block outranks `[data-theme=anubis]` in
      // styles.css and repaints both eager themes as `light`.
      addDeferredSheetMarker();
      const appStyles = document.createElement('link');
      appStyles.id = 'test-app-styles';
      appStyles.rel = 'stylesheet';
      appStyles.href = 'styles.css';
      document.head.appendChild(appStyles);

      const service = configure(createMockVscode());
      service.setTheme('dracula');

      const sheets = Array.from(
        document.head.querySelectorAll('link[rel="stylesheet"]'),
      );
      const deferred = deferredSheetLink();
      expect(deferred).not.toBeNull();
      expect(sheets.indexOf(deferred as HTMLLinkElement)).toBeLessThan(
        sheets.indexOf(appStyles),
      );
    });

    it('applies later deferred switches synchronously and reuses one sheet', async () => {
      addDeferredSheetMarker();
      const service = configure(createMockVscode());

      service.setTheme('dracula');
      deferredSheetLink()?.dispatchEvent(new Event('load'));
      await Promise.resolve();

      service.setTheme('nord');

      expect(service.currentTheme()).toBe('nord');
      expect(document.querySelectorAll('#ptah-theme-extra-sheet')).toHaveLength(
        1,
      );
    });

    it('still applies the theme when the sheet fails to load', async () => {
      addDeferredSheetMarker();
      const service = configure(createMockVscode());

      service.setTheme('sunset');
      deferredSheetLink()?.dispatchEvent(new Event('error'));
      await Promise.resolve();

      expect(service.currentTheme()).toBe('sunset');
    });

    it('applies immediately when the document carries no deferred sheet at all', () => {
      // No marker: the extension host fallback HTML, or a unit-test document.
      const service = configure(createMockVscode());

      service.setTheme('dracula');

      expect(service.currentTheme()).toBe('dracula');
      expect(deferredSheetLink()).toBeNull();
    });

    it('treats a sheet already inserted pre-paint as ready and applies synchronously', () => {
      addDeferredSheetMarker();
      const prePaint = document.createElement('link');
      prePaint.id = 'ptah-theme-extra-sheet';
      prePaint.rel = 'stylesheet';
      prePaint.href = 'theme-extra.css';
      document.head.appendChild(prePaint);

      const service = configure(createMockVscode({ persisted: 'dracula' }));
      service.setTheme('nord');

      expect(service.currentTheme()).toBe('nord');
      expect(document.querySelectorAll('#ptah-theme-extra-sheet')).toHaveLength(
        1,
      );
    });
  });

  describe('isDarkMode computed', () => {
    it('matches the dark-theme allowlist from DAISYUI_THEMES', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      for (const info of DAISYUI_THEMES) {
        service.setTheme(info.name);
        expect(service.isDarkMode()).toBe(info.isDark);
      }
    });
  });

  describe('DOM sync effect', () => {
    it('defaults to gold with no accent attribute', () => {
      const service = configure(createMockVscode());
      TestBed.inject(ApplicationRef).tick();
      expect(service.accent()).toBe('gold');
      expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
      expect(document.documentElement.getAttribute('data-glass')).toBe('on');
      expect(document.documentElement.getAttribute('data-glass-mode')).toBe('dark');
    });

    it('persists rose and keeps it across stock theme switches', () => {
      const mock = createMockVscode();
      const service = configure(mock);
      const app = TestBed.inject(ApplicationRef);
      service.setAccent('rose');
      app.tick();
      expect(mock.setState).toHaveBeenCalledWith('ptah-accent', 'rose');
      expect(localStorage.getItem('ptah-accent')).toBe('rose');
      expect(document.documentElement.getAttribute('data-accent')).toBe('rose');
      service.setTheme('light');
      app.tick();
      expect(service.accent()).toBe('rose');
      expect(document.documentElement.hasAttribute('data-glass')).toBe(false);
      expect(document.documentElement.getAttribute('data-accent')).toBe('rose');
      service.setTheme('cupcake');
      app.tick();
      expect(document.documentElement.getAttribute('data-glass-mode')).toBe('light');
    });

    it('rejects unknown stored accents', () => {
      localStorage.setItem('ptah-accent', 'violet');
      const service = configure(createMockVscode());
      TestBed.inject(ApplicationRef).tick();
      expect(service.accent()).toBe('gold');
      expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    });
    it('repairs an invalid accent in VS Code state', () => {
      const mock = createMockVscode();
      mock.getState.mockImplementation((key: string) => key === 'ptah-accent' ? 'violet' : undefined);
      localStorage.setItem('ptah-accent', 'rose');
      const service = configure(mock);
      expect(service.accent()).toBe('rose');
      expect(mock.setState).toHaveBeenCalledWith('ptah-accent', 'rose');
    });
    it('writes data-theme on document.documentElement when the signal updates', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);

      // Effects in Angular 21 zoneless mode run on change detection. Force a
      // flush via ApplicationRef.tick() — this mirrors what the real app does
      // in reaction to user-triggered mutations.
      const appRef = TestBed.inject(ApplicationRef);
      appRef.tick();
      expect(document.documentElement.getAttribute('data-theme')).toBe(
        'dracula',
      );

      service.setTheme('night');
      appRef.tick();
      expect(document.documentElement.getAttribute('data-theme')).toBe('night');
    });

    it('writes data-theme-mode reflecting the light/dark classification', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);
      const appRef = TestBed.inject(ApplicationRef);

      appRef.tick();
      expect(document.documentElement.getAttribute('data-theme-mode')).toBe(
        'dark',
      );

      service.setTheme('cupcake');
      appRef.tick();
      expect(document.documentElement.getAttribute('data-theme-mode')).toBe(
        'light',
      );
    });
  });
});
