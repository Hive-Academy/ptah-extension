/**
 * ThemeService specs — signal-based theme state with VS Code state persistence
 * and `data-theme` DOM sync effect.
 *
 * Coverage:
 *   - Initial theme: (1) persisted value wins, (2) falls back to VS Code theme
 *     kind when persisted is missing, (3) defaults to 'anubis' otherwise.
 *   - Invalid persisted theme is rejected.
 *   - `setTheme` updates the signal and persists via `VSCodeService.setState`.
 *   - `toggleTheme` flips between 'anubis' and 'anubis-light'.
 *   - `isDarkMode` computed matches the dark-theme allowlist.
 *   - `effect()` on `currentTheme` writes `document.documentElement` attribute.
 */

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from './vscode.service';
import { DAISYUI_THEMES, ThemeService, type ThemeName } from './theme.service';

interface MockVSCodeService {
  getState: jest.Mock<unknown, [string]>;
  setState: jest.Mock<void, [string, unknown]>;
  config: jest.Mock<{ theme: 'light' | 'dark' | 'high-contrast' }, []>;
}

function createMockVscode(
  options: {
    persisted?: string | undefined;
    themeKind?: 'light' | 'dark' | 'high-contrast';
  } = {},
): MockVSCodeService {
  const { persisted, themeKind = 'dark' } = options;
  const persistedStore: Record<string, unknown> = {};
  if (persisted !== undefined) {
    persistedStore.theme = persisted;
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
    document.getElementById('ptah-theme-extra')?.remove();
    document.getElementById('test-app-styles')?.remove();
    deferredSheetLink()?.remove();
    localStorage.removeItem('ptah-theme');
  });

  describe('initial theme resolution', () => {
    it('uses the persisted theme when VSCodeService.getState returns a valid name', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('dracula');
      expect(mock.getState).toHaveBeenCalledWith('theme');
    });

    it('ignores invalid persisted values and falls back to VS Code theme kind', () => {
      const mock = createMockVscode({
        persisted: 'not-a-real-theme',
        themeKind: 'light',
      });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('anubis-light');
    });

    it('defaults to "anubis" when VS Code theme kind is dark and nothing is persisted', () => {
      const mock = createMockVscode({ themeKind: 'dark' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('anubis');
    });

    it('switches to "anubis-light" on first launch when VS Code theme kind is light', () => {
      const mock = createMockVscode({ themeKind: 'light' });
      const service = configure(mock);

      expect(service.currentTheme()).toBe('anubis-light');
    });
  });

  describe('setTheme()', () => {
    it('updates the signal and persists via VSCodeService.setState', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      service.setTheme('synthwave');

      expect(service.currentTheme()).toBe('synthwave');
      expect(mock.setState).toHaveBeenCalledWith('theme', 'synthwave');
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
    it('toggles anubis → anubis-light and back', () => {
      const mock = createMockVscode();
      const service = configure(mock);

      expect(service.currentTheme()).toBe('anubis');
      service.toggleTheme();
      expect(service.currentTheme()).toBe('anubis-light');
      service.toggleTheme();
      expect(service.currentTheme()).toBe('anubis');
    });

    it('toggling from a non-anubis theme sends it to "anubis"', () => {
      const mock = createMockVscode({ persisted: 'dracula' });
      const service = configure(mock);

      service.toggleTheme();
      // Non-'anubis' starting point falls into the else branch: → 'anubis'
      expect(service.currentTheme()).toBe('anubis');
    });
  });

  describe('deferred theme sheet (theme-extra.css)', () => {
    it('mirrors the theme into localStorage so index.html can read it pre-paint', () => {
      const service = configure(createMockVscode());

      service.setTheme('anubis-light');

      expect(localStorage.getItem('ptah-theme')).toBe('anubis-light');
    });

    it('re-arms the localStorage mirror from persisted state on construction', () => {
      configure(createMockVscode({ persisted: 'nord' }));

      expect(localStorage.getItem('ptah-theme')).toBe('nord');
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
      expect(service.currentTheme()).toBe('anubis');

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
