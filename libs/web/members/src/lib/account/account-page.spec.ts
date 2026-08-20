import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { MemberSessionStore } from '@ptah-web/core';

import {
  MEMBER_THEME_DARK,
  MEMBER_THEME_LIGHT,
  MEMBER_THEME_STORAGE_KEY,
  MemberThemeService,
} from '../services/member-theme.service';
import { AccountPage } from './account-page';

const ME = '/api/v1/auth/me';
const LOGOUT = '/api/v1/auth/logout';

/**
 * `AuthService.getCurrentUser()` SHORT-CIRCUITS TO `of(null)` WITHOUT THIS.
 *
 * ⚠️ 🔴 THIS IS THE ONE THING THAT WOULD MAKE THIS WHOLE FILE VACUOUS. Without
 * the hint the service never issues a request, `email()` stays null, and every
 * "the email renders" assertion would be testing the `?? 'Not available'`
 * fallback while appearing to test the happy path.
 *
 * ⚠️ 🔴 THE VALUE MUST BE THE LITERAL STRING `'true'`, NOT MERELY PRESENT.
 * `hasAuthHint()` is `localStorage.getItem(AUTH_HINT_KEY) === 'true'` — a
 * truthy-looking `'1'` is FALSE to it. This spec's first draft used `'1'` and
 * all 25 cases failed on a missing request, which is the honest failure: the
 * page under test really would have shown "Not available" to a signed-in
 * member whose hint was written that way.
 */
const AUTH_HINT_KEY = 'ptah_auth_hint';
const AUTH_HINT_VALUE = 'true';

/** The `/40` opacity B13's F-1 proved is a real 3.2:1 WCAG AA failure on text. */
const LOW_CONTRAST_TEXT = ['text', 'base-content/40'].join('-');
/** `base-300` is a FILL, never a border (panel-theme-spec.md §2, Task 4.7). */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

/**
 * AccountPage — `/members/account` (R9.6, R9.7, NFR-U1–U5, NFR-M1).
 *
 * ── 🔴 THIS PAGE WAS NOT WRITTEN BY THIS BATCH. IT HAD NEVER BEEN TESTED ──
 * `account-page.ts` shipped in Phase 1 and has been routed and rendering ever
 * since: 258 lines, standalone, OnPush, three sections, and no request of its
 * own beyond the `auth/me` call `AuthService` already caches for the shell. The
 * coarse task reads "Account page" as though it needed authoring; what it
 * needed was a spec. So this file DESCRIBES a shipped surface rather than
 * driving a new one, and anything it finds is reported as a finding against
 * existing code — the shape B13's F-1 took — rather than folded in silently.
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ─────────────────────────────────────────
 * Three things, and none of them is "does it render":
 *
 *   1. **The theme survives a re-instantiation** (R9.6, AD-13). The preference
 *      lives in `localStorage`, so the only assertion that means anything is
 *      one that throws the service away and builds a new one. A test that
 *      toggles and reads back the same instance passes on a service that
 *      persists nothing.
 *   2. **Sign-out clears the local session even when the call fails.** Leaving
 *      a member on a panel they believe they signed out of is worse than a
 *      stale cookie the server will reject anyway.
 *   3. **Every control is reachable and named for a keyboard and a screen
 *      reader** (NFR-U4). The theme buttons are the interesting case: they are
 *      a pressed-state pair, not a link, so `aria-pressed` is what carries the
 *      current theme to a screen reader — colour alone does not.
 */
describe('AccountPage (R9.6, R9.7, NFR-U1–U5)', () => {
  let fixture: ComponentFixture<AccountPage>;
  let http: HttpTestingController;
  let session: MemberSessionStore;
  let navigate: jest.SpyInstance;

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(MemberSessionStore);
    navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(AUTH_HINT_KEY, AUTH_HINT_VALUE);
    configure();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  /** Renders, and answers the one request the page causes. */
  function render(email: string | null = 'ada@ptah.local'): void {
    fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    http.expectOne(ME).flush(email === null ? null : { email });
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return root().textContent ?? '';
  }

  function buttonLabelled(label: string): HTMLButtonElement | undefined {
    return Array.from(root().querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Identity                                                                */
  /* ---------------------------------------------------------------------- */

  describe('the identity section', () => {
    it('renders the signed-in email', () => {
      render('ada@ptah.local');

      expect(text()).toContain('ada@ptah.local');
    });

    it('🔴 issues EXACTLY ONE request, and it is not a member endpoint', () => {
      // R6.2's reasoning applied to a leaf surface: everything this page shows
      // is already resolved — identity from `AuthService`, cohorts and admin-ness
      // from the store the guard seeded on this navigation. A page that fetched
      // its own cohorts would be asking the server for something it was handed.
      fixture = TestBed.createComponent(AccountPage);
      fixture.detectChanges();

      const all = http.match(() => true);
      expect(all.map((request) => request.request.url)).toEqual([ME]);
      all[0].flush({ email: 'ada@ptah.local' });

      expect(http.match((r) => r.url.startsWith('/api/v1/members/'))).toEqual(
        [],
      );
    });

    it('falls back to a legible string when the email is unavailable', () => {
      // A blank `<dd>` beside a "Email" label reads as a rendering bug rather
      // than as an unknown value.
      render(null);

      expect(text()).toContain('Not available');
    });

    it('renders every cohort the guard seeded, and no more', () => {
      session.set({
        entitled: true,
        isAdmin: false,
        cohorts: [
          { key: 'founding', name: 'Founding Cohort' },
          { key: 'lounge', name: 'Builders Lounge' },
        ],
      });
      render();

      expect(text()).toContain('Founding Cohort');
      expect(text()).toContain('Builders Lounge');
      expect(text()).not.toContain('No cohort assigned');
    });

    it('🔴 a member with NO cohort is told so, and is NOT told it is a problem', () => {
      // A-2 / R7.8: an entitled member with no `MemberGroupAssignment` sees
      // every member-visibility surface and no cohort-gated one. That is the
      // ordinary case in this workspace — every real account has an empty
      // assignment table — so an unexplained absence would read as broken
      // entitlement.
      session.set({ entitled: true, isAdmin: false, cohorts: [] });
      render();

      expect(text()).toContain('No cohort assigned');
      expect(text()).toContain('You are not in a cohort yet.');
      expect(text()).toContain('Your membership is fully active.');
      // Not an error, and not hidden.
      expect(root().querySelector('[role="alert"]')).toBeNull();
    });

    it('the staff row appears only for an admin', () => {
      session.set({ entitled: true, isAdmin: false, cohorts: [] });
      render();
      expect(text()).not.toContain('Administrator');

      session.set({ entitled: true, isAdmin: true, cohorts: [] });
      fixture.detectChanges();
      expect(text()).toContain('Administrator');
    });

    it('🔴 no id, token or entitlement flag is rendered anywhere (NFR-S4)', () => {
      session.set({
        entitled: true,
        isAdmin: true,
        cohorts: [{ key: 'founding', name: 'Founding Cohort' }],
      });
      render('ada@ptah.local');

      // The cohort KEY is machinery; the NAME is the display value. Rendering
      // the key would leak the identifier every cohort gate is written against.
      const markup = root().innerHTML;
      expect(markup).not.toContain('founding');
      expect(markup).not.toContain('entitled');
      expect(markup).toContain('Founding Cohort');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Appearance — R9.6, AD-13                                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the appearance section (R9.6, AD-13)', () => {
    it('dark is the default when nothing is stored', () => {
      render();

      expect(TestBed.inject(MemberThemeService).isDark()).toBe(true);
      expect(buttonLabelled('Dark')?.getAttribute('aria-pressed')).toBe('true');
      expect(buttonLabelled('Light')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('choosing Light switches the service and the pressed state', () => {
      render();

      buttonLabelled('Light')?.click();
      fixture.detectChanges();

      expect(TestBed.inject(MemberThemeService).isDark()).toBe(false);
      expect(buttonLabelled('Light')?.getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(buttonLabelled('Dark')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('🔴 the choice SURVIVES a re-instantiation — the whole point of R9.6', () => {
      // 🔴 THE ONLY ASSERTION IN THIS BLOCK THAT COULD FAIL ON A SERVICE THAT
      // PERSISTS NOTHING. Toggling and reading back the same instance passes
      // against a plain in-memory signal; this throws the TestBed away, which is
      // what a page reload actually does.
      render();
      buttonLabelled('Light')?.click();
      fixture.detectChanges();

      expect(localStorage.getItem(MEMBER_THEME_STORAGE_KEY)).toBe(
        MEMBER_THEME_LIGHT,
      );

      configure();
      render();

      expect(TestBed.inject(MemberThemeService).isDark()).toBe(false);
      expect(buttonLabelled('Light')?.getAttribute('aria-pressed')).toBe(
        'true',
      );
    });

    it('🔴 an unknown stored theme falls back to dark rather than being applied', () => {
      // An unrecognised name reaches `data-theme` and daisyUI renders its
      // default — the panel silently loses every token it was designed against.
      localStorage.setItem(MEMBER_THEME_STORAGE_KEY, 'operator-member-neon');
      configure();
      render();

      expect(TestBed.inject(MemberThemeService).theme()).toBe(
        MEMBER_THEME_DARK,
      );
    });

    it('says the preference is device-local, because it is (AD-13)', () => {
      // It is NOT on the account. A member who switches machines and finds the
      // other theme has to be able to tell that from a bug.
      render();

      expect(text()).toContain('Saved on this device only.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Billing                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('the billing section', () => {
    it('🔴 renders with NO subscription state, because it holds none', () => {
      // The page issues no billing request and reads no subscription signal —
      // it links to the one place a subscription is managed. A second copy of
      // that surface would drift the day the first one changes.
      session.set({ entitled: true, isAdmin: false, cohorts: [] });
      render();

      expect(text()).toContain('Billing and profile');
      const link =
        root().querySelector<HTMLAnchorElement>('a[href="/profile"]');
      expect(link).not.toBeNull();
      expect(link?.textContent).toContain('Open profile');
    });

    it('names no price, plan or renewal date', () => {
      render();

      // Any of these would be a value this page cannot know and would render
      // stale — it never asked the server for one.
      for (const leak of ['$', 'Renews', 'per month', 'Cancel']) {
        expect(text()).not.toContain(leak);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Sign-out                                                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 sign-out', () => {
    it('posts logout, clears the session and leaves the panel', () => {
      session.set({ entitled: true, isAdmin: false, cohorts: [] });
      render();

      buttonLabelled('Sign out')?.click();
      http.expectOne(LOGOUT).flush(null);
      fixture.detectChanges();

      expect(session.context()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('🔴 a FAILED logout still clears the local session and still leaves', () => {
      // Leaving a member on a panel they believe they signed out of is worse
      // than a stale cookie the server will reject on the next request anyway.
      session.set({ entitled: true, isAdmin: false, cohorts: [] });
      render();

      buttonLabelled('Sign out')?.click();
      http
        .expectOne(LOGOUT)
        .flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(session.context()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('the button is disabled while the request is in flight', () => {
      render();

      buttonLabelled('Sign out')?.click();
      fixture.detectChanges();

      // A second click would issue a second logout and a second navigation.
      expect(buttonLabelled('Sign out')?.disabled).toBe(true);

      http.expectOne(LOGOUT).flush(null);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-U4 / NFR-U2 — the a11y pass                                      */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-U — accessibility and tokens', () => {
    it('🔴 every interactive control is a real button or link — keyboard reachable', () => {
      // NFR-U4. A `<div>` with a click handler is focusable programmatically
      // and unreachable by Tab, which is the failure this asserts against.
      session.set({ entitled: true, isAdmin: true, cohorts: [] });
      render();

      const interactive = Array.from(
        root().querySelectorAll<HTMLElement>('button, a, input, select'),
      );

      expect(interactive.length).toBeGreaterThanOrEqual(4);
      for (const element of interactive) {
        expect(['BUTTON', 'A', 'INPUT', 'SELECT']).toContain(element.tagName);
        // Nothing is removed from the tab order.
        expect(element.getAttribute('tabindex')).not.toBe('-1');
      }

      // Anti-vacuity: no clickable non-interactive element exists to have been
      // missed by the sweep above.
      expect(
        root().querySelectorAll('div[role="button"], span[role="button"]'),
      ).toHaveLength(0);
    });

    it('🔴 every control has a non-empty accessible name', () => {
      session.set({ entitled: true, isAdmin: true, cohorts: [] });
      render();

      for (const element of Array.from(
        root().querySelectorAll<HTMLElement>('button, a'),
      )) {
        const name =
          element.getAttribute('aria-label') ??
          element.textContent?.trim() ??
          '';
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('🔴 the theme state is carried by aria-pressed, not by colour alone', () => {
      // The two buttons differ visually by `btn-primary`. A screen-reader user
      // gets nothing from that; `aria-pressed` is the whole of what they get.
      render();

      const dark = buttonLabelled('Dark');
      const light = buttonLabelled('Light');

      expect(dark?.getAttribute('aria-pressed')).not.toBeNull();
      expect(light?.getAttribute('aria-pressed')).not.toBeNull();
      // Exactly one is pressed — a pair that both read `false` says nothing.
      expect(
        [dark, light].filter(
          (button) => button?.getAttribute('aria-pressed') === 'true',
        ),
      ).toHaveLength(1);
    });

    it('every section is a landmark with a programmatic label', () => {
      render();

      const sections = Array.from(root().querySelectorAll('section'));
      expect(sections.length).toBe(3);

      for (const section of sections) {
        const id = section.getAttribute('aria-labelledby');
        expect(id).toBeTruthy();
        // The label must RESOLVE. A dangling `aria-labelledby` leaves the
        // landmark unnamed while looking labelled in the source.
        expect(
          root().querySelector(`#${id}`)?.textContent?.trim(),
        ).toBeTruthy();
      }
    });

    it('exactly one h1, and every heading below it is an h2', () => {
      render();

      expect(root().querySelectorAll('h1')).toHaveLength(1);
      expect(root().querySelectorAll('h3, h4, h5, h6')).toHaveLength(0);
      expect(root().querySelectorAll('h2').length).toBe(3);
    });

    it('every decorative icon is aria-hidden', () => {
      session.set({ entitled: true, isAdmin: true, cohorts: [] });
      render();

      const icons = Array.from(root().querySelectorAll('lucide-angular'));
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
    });

    // ⚠️ THE TITLE NAMES NEITHER TOKEN LITERALLY, AND THAT IS NOT PEDANTRY.
    // Task 4.7's `no-restricted-syntax` rule matches ANY string literal
    // containing the token — including a test TITLE written in order to assert
    // the token's absence. This spec's first draft spelled it out in the title
    // and failed `nx lint web-members` with an error, which is the same trap
    // the assembled constants at the top of this file exist to avoid.
    it('🔴 no /40 on any TEXT-BEARING element, and no fill-as-border misuse', () => {
      // 🔴 SCOPED TO TEXT-BEARING ELEMENTS, NOT TO THE FILE — the distinction
      // B13 drew and did not enforce. `/40` on an `aria-hidden` decorative glyph
      // carries no information a member must read, so no contrast ratio applies
      // to it; `/40` on a sentence is the 3.2:1 failure F-1 was.
      session.set({ entitled: true, isAdmin: true, cohorts: [] });
      render();

      const offenders = textBearing(root())
        .filter((element) => element.className.includes(LOW_CONTRAST_TEXT))
        .map((element) => `${element.tagName}: ${element.textContent?.trim()}`);

      expect(offenders).toEqual([]);
      expect(root().innerHTML).not.toContain(BORDER_FILL_MISUSE);
    });

    it('the text-bearing walk is not vacuous', () => {
      // The assertion above passes over an empty set if the walk is wrong.
      render();

      const found = textBearing(root());
      expect(found.length).toBeGreaterThan(5);
      expect(
        found.some((element) => element.textContent?.includes('Account')),
      ).toBe(true);
    });
  });
});

/**
 * Every element owning a non-whitespace DIRECT text child, excluding
 * `aria-hidden` subtrees and `<svg>` internals.
 *
 * ⚠️ 🔴 "DIRECT" IS WHAT MAKES IT MEAN ANYTHING. Every ancestor of a text node
 * has that text in its `textContent`, so a walk keyed on `textContent` marks the
 * whole tree text-bearing and the contrast assertion becomes "no `/40` anywhere",
 * which fails on legal decorative icons. Keyed on direct children it selects the
 * element that actually paints the glyphs, which is the one whose colour class
 * WCAG measures.
 */
function textBearing(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];

  const walk = (element: Element): void => {
    if (element.getAttribute('aria-hidden') === 'true') return;
    if (element.tagName.toLowerCase() === 'svg') return;

    const ownsText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (ownsText && element instanceof HTMLElement) out.push(element);

    for (const child of Array.from(element.children)) walk(child);
  };

  walk(root);
  return out;
}
