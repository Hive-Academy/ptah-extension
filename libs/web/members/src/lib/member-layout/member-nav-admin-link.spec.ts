import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { MemberSessionStore } from '@ptah-web/core';

import { MemberLayout } from './member-layout';
import {
  MEMBER_ADMIN_NAV_GROUP,
  MEMBER_NAV_GROUPS,
} from '../member-nav.config';
import { MemberNotificationsStore } from '../state/member-notifications.store';

/**
 * The member panel's cross-panel Admin link.
 *
 * Visibility is decided by a `computed()` in `MemberLayout` that rebuilds the
 * nav array — the same mechanism Batch 15 is committed to for the Notifications
 * `badgeCount`, and the reason `member-nav.config.ts` stays static data. The
 * first test asserts that shape directly, because "the config is data" is the
 * property R9.3 protects and it is not observable from the rendered DOM.
 */
describe('MemberLayout — the Admin nav item', () => {
  let fixture: ComponentFixture<MemberLayout>;
  let store: MemberSessionStore;

  beforeEach(() => {
    // No auth hint → `AuthService.getCurrentUser()` short-circuits to `of(null)`
    // and issues no request, so nothing here needs an HTTP expectation.
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // 🔴 SUPPLIED AS THE `/members` ROUTE SUPPLIES IT (Batch 15). The
        // layout now injects the notifications store to bind the Notifications
        // `badgeCount` — the same computed this file is about. The store is
        // NOT `providedIn: 'root'` on purpose (RISK-AM: a 60 s poll in a root
        // singleton outlives sign-out), so a direct `createComponent` of the
        // shell has to provide it exactly as the route does.
        MemberNotificationsStore,
      ],
    });

    store = TestBed.inject(MemberSessionStore);
  });

  afterEach(() => store.clear());

  /** Renders the shell with the store already seeded, as the guard leaves it. */
  function render(): void {
    fixture = TestBed.createComponent(MemberLayout);
    fixture.detectChanges();
  }

  /**
   * Every NAV link's href, in render order.
   *
   * Scoped to `ul` deliberately: the membership card projected into
   * `[panelSidebarFooter]` also sits inside `<nav>` and carries its own
   * "Account settings" anchor, which is not a nav item and would otherwise
   * always be last.
   */
  function navHrefs(): string[] {
    return fixture.debugElement
      .queryAll(By.css('nav ul a[href]'))
      .map((el) => el.nativeElement.getAttribute('href') as string);
  }

  it('is NOT baked into MEMBER_NAV_GROUPS — the config stays unconditional data', () => {
    // If this ever fails, the conditional has moved into the config file and
    // there are now two mechanisms for conditionally shaped nav (R9.3).
    const routes = MEMBER_NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => i.route),
    );
    expect(routes).not.toContain('/admin');
    expect(MEMBER_ADMIN_NAV_GROUP.items[0].route).toBe('/admin');
  });

  it('is hidden for a non-admin member', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: false });
    render();

    expect(navHrefs()).not.toContain('/admin');
  });

  it('is hidden when the store is empty, rather than defaulting to visible', () => {
    render();

    expect(navHrefs()).not.toContain('/admin');
  });

  it('renders for an admin, linking to /admin', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: true });
    render();

    expect(navHrefs()).toContain('/admin');

    const adminLink = fixture.debugElement
      .queryAll(By.css('nav ul a[href]'))
      .find((el) => el.nativeElement.getAttribute('href') === '/admin');
    expect(adminLink?.nativeElement.textContent.trim()).toBe('Admin');
  });

  it('appends the link last, leaving the member IA in front of it', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: true });
    render();

    const hrefs = navHrefs();
    // An escape hatch out of the panel, not a seventh member task.
    expect(hrefs[hrefs.length - 1]).toBe('/admin');
    expect(hrefs.filter((h) => h === '/admin')).toHaveLength(1);
  });

  it('reacts to the flag flipping without a re-render', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: false });
    render();
    expect(navHrefs()).not.toContain('/admin');

    // `MemberGuard` re-seeds the store on EVERY /members activation, so this is
    // the live path for an admin allowlist change taking effect mid-session.
    store.set({ entitled: true, cohorts: [], isAdmin: true });
    fixture.detectChanges();

    expect(navHrefs()).toContain('/admin');
  });
});
