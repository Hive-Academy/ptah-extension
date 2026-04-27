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

describe('ThemeService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.removeAttribute('data-theme');
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
  });
});
