import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { MemberSessionStore } from '@ptah-web/core';

import { AdminLayout } from './admin-layout';
import { ADMIN_MEMBER_NAV_GROUP, ADMIN_NAV_GROUPS } from './admin-nav.config';

/**
 * The admin panel's cross-panel Member Panel link.
 *
 * ⚠️ GATED ON ENTITLEMENT, NOT ON ADMIN-NESS, AND THE DISTINCTION IS THE WHOLE
 * TEST. Everyone rendering this sidebar is already an admin, so `isAdmin` would
 * gate on nothing; `/members` is guarded by `MemberGuard`, which turns on
 * entitlement alone. An admin holding only a free `community` license — the
 * founder's real account — must not be shown a link that dumps them on
 * `/pricing`.
 */
describe('AdminLayout — the Member Panel nav item', () => {
  let fixture: ComponentFixture<AdminLayout>;
  let store: MemberSessionStore;

  beforeEach(() => {
    // No auth hint → `AuthService.getCurrentUser()` short-circuits with no
    // request, so this suite needs no HTTP expectations.
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    store = TestBed.inject(MemberSessionStore);
  });

  afterEach(() => store.clear());

  function render(): void {
    fixture = TestBed.createComponent(AdminLayout);
    fixture.detectChanges();
  }

  function navHrefs(): string[] {
    return fixture.debugElement
      .queryAll(By.css('nav ul a[href]'))
      .map((el) => el.nativeElement.getAttribute('href') as string);
  }

  it('is NOT baked into ADMIN_NAV_GROUPS — the config stays unconditional data', () => {
    const routes = ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.route));
    expect(routes).not.toContain('/members');
    expect(ADMIN_MEMBER_NAV_GROUP.items[0].route).toBe('/members');
  });

  it('renders for an admin who IS an entitled member', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: true });
    render();

    const hrefs = navHrefs();
    expect(hrefs).toContain('/members');
    // Last: an escape hatch out of the operator IA, not a seventh operator task.
    expect(hrefs[hrefs.length - 1]).toBe('/members');
  });

  it('is HIDDEN for an admin with no Builders entitlement', () => {
    // MemberGuard would bounce this operator to /pricing. A link that reliably
    // fails is worse than no link.
    store.set({ entitled: false, cohorts: [], isAdmin: true });
    render();

    expect(navHrefs()).not.toContain('/members');
  });

  it('is HIDDEN when entitlement is not yet known (cold /admin load)', () => {
    // The store is seeded by the post-login probe and by MemberGuard, neither of
    // which has run on a fresh tab against an existing cookie. Fail closed: an
    // absent affordance, never a bad bounce.
    render();

    expect(navHrefs()).not.toContain('/members');
  });

  it('appears as soon as the entitlement probe seeds the store', () => {
    render();
    expect(navHrefs()).not.toContain('/members');

    store.set({ entitled: true, cohorts: [], isAdmin: true });
    fixture.detectChanges();

    expect(navHrefs()).toContain('/members');
  });
});
