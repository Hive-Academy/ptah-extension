import { TestBed } from '@angular/core/testing';

import {
  MEMBER_THEME_DARK,
  MEMBER_THEME_LIGHT,
  MEMBER_THEME_STORAGE_KEY,
  MemberThemeService,
} from './member-theme.service';

describe('MemberThemeService', () => {
  function create(): MemberThemeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(MemberThemeService);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the dark member theme', () => {
    expect(create().theme()).toBe(MEMBER_THEME_DARK);
  });

  it('reads a persisted light preference on construction', () => {
    localStorage.setItem(MEMBER_THEME_STORAGE_KEY, MEMBER_THEME_LIGHT);
    expect(create().theme()).toBe(MEMBER_THEME_LIGHT);
  });

  it('persists the choice so it survives a reload', () => {
    const service = create();
    service.setTheme(MEMBER_THEME_LIGHT);

    expect(localStorage.getItem(MEMBER_THEME_STORAGE_KEY)).toBe(
      MEMBER_THEME_LIGHT,
    );
    // A second instance is what the next page load actually constructs.
    expect(create().theme()).toBe(MEMBER_THEME_LIGHT);
  });

  it('toggles between exactly the two member themes', () => {
    const service = create();
    expect(service.isDark()).toBe(true);

    service.toggle();
    expect(service.theme()).toBe(MEMBER_THEME_LIGHT);
    expect(service.isDark()).toBe(false);

    service.toggle();
    expect(service.theme()).toBe(MEMBER_THEME_DARK);
  });

  it('falls back to dark for an unrecognised stored value', () => {
    // An unknown name reaching `data-theme` renders the daisyUI default and the
    // panel silently loses every token, so a bad value must never pass through.
    localStorage.setItem(MEMBER_THEME_STORAGE_KEY, 'operator-nonsense');
    expect(create().theme()).toBe(MEMBER_THEME_DARK);
  });

  it('never emits the admin theme', () => {
    const service = create();
    const seen = [service.theme()];
    service.toggle();
    seen.push(service.theme());
    service.toggle();
    seen.push(service.theme());

    expect(seen).not.toContain('operator-admin');
    expect(new Set(seen)).toEqual(
      new Set([MEMBER_THEME_DARK, MEMBER_THEME_LIGHT]),
    );
  });

  it('survives localStorage throwing (hardened / private-mode browsers)', () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    const service = create();
    expect(service.theme()).toBe(MEMBER_THEME_DARK);
    expect(() => service.toggle()).not.toThrow();
    // Persistence is lost, the in-session switch is not.
    expect(service.theme()).toBe(MEMBER_THEME_LIGHT);

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('labels the toggle by its destination, not its current state', () => {
    const service = create();
    expect(service.toggleLabel()).toBe('Switch to light theme');
    service.toggle();
    expect(service.toggleLabel()).toBe('Switch to dark theme');
  });
});
