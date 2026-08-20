import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** daisyUI theme applied to the member shell in dark mode. */
export const MEMBER_THEME_DARK = 'operator-member';
/** daisyUI theme applied to the member shell in light mode. */
export const MEMBER_THEME_LIGHT = 'operator-member-light';

export type MemberTheme = typeof MEMBER_THEME_DARK | typeof MEMBER_THEME_LIGHT;

/**
 * `localStorage` key. Namespaced to the member panel on purpose (AD-13): the
 * admin panel is dark-only and must not inherit a member's light preference if
 * it ever gains a toggle.
 */
export const MEMBER_THEME_STORAGE_KEY = 'ptah.members.theme';

/**
 * MemberThemeService — owns which of the two member themes is active (R9.6).
 *
 * Persisted in `localStorage`, not on the server (AD-13). A theme preference is
 * device-shaped, not account-shaped: the same member wants dark on a laptop at
 * night and light on a bright monitor, and a server round-trip would also mean
 * the shell renders in the wrong theme for the duration of that request.
 *
 * The value is bound straight to `PanelLayout`'s `theme` input, which puts it
 * on `data-theme`. There is no second mechanism, no `class="dark"`, and no
 * document-level side effect — the shell root is the only thing that switches.
 */
@Injectable({ providedIn: 'root' })
export class MemberThemeService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _theme = signal<MemberTheme>(this.readPersisted());

  public readonly theme = this._theme.asReadonly();

  public readonly isDark = computed(() => this._theme() === MEMBER_THEME_DARK);

  /** Label for the toggle control — describes the DESTINATION, not the state. */
  public readonly toggleLabel = computed(() =>
    this.isDark() ? 'Switch to light theme' : 'Switch to dark theme',
  );

  /**
   * The visible text on the toggle. Also the DESTINATION, so it agrees with
   * {@link toggleLabel} rather than contradicting it — a control captioned
   * "Dark" while announcing "Switch to light theme" is two different promises
   * about the same click.
   *
   * ⚠️ IT IS A SUBSTRING OF {@link toggleLabel}, AND THAT IS THE POINT (WCAG
   * 2.5.3, Label in Name). The `aria-label` REPLACES the visible text as the
   * accessible name, so a speech-input user saying "click Light theme" only
   * matches if the announced name still contains what they can read. Changing
   * one of these two strings without the other silently breaks that.
   */
  public readonly destinationLabel = computed(() =>
    this.isDark() ? 'Light theme' : 'Dark theme',
  );

  public setTheme(theme: MemberTheme): void {
    this._theme.set(theme);
    this.persist(theme);
  }

  public toggle(): void {
    this.setTheme(this.isDark() ? MEMBER_THEME_LIGHT : MEMBER_THEME_DARK);
  }

  /**
   * Dark is the default. Both reference screens exist, but the dark one is the
   * primary in `docs/design-system/stitch_ptah_builders_member_home/` and is the
   * ladder `panel-theme-spec.md` derives from; light is the alternate.
   *
   * A malformed or unknown stored value falls back to the default rather than
   * being written through to `data-theme` — an unknown theme name renders the
   * daisyUI default and the panel would silently lose every token.
   */
  private readPersisted(): MemberTheme {
    if (!this.isBrowser) return MEMBER_THEME_DARK;
    try {
      const stored = localStorage.getItem(MEMBER_THEME_STORAGE_KEY);
      return stored === MEMBER_THEME_LIGHT
        ? MEMBER_THEME_LIGHT
        : MEMBER_THEME_DARK;
    } catch {
      // Private-mode Safari and hardened browsers throw on `localStorage`
      // access rather than returning null. A theme preference is never worth
      // breaking the panel over.
      return MEMBER_THEME_DARK;
    }
  }

  private persist(theme: MemberTheme): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(MEMBER_THEME_STORAGE_KEY, theme);
    } catch {
      // See readPersisted. The in-memory signal still switched, so the toggle
      // works for this session; only persistence is lost.
    }
  }
}
