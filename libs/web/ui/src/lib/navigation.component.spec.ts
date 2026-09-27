import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { I18nService } from '@ptah-extension/i18n';
import { provideI18nTesting } from '@ptah-extension/i18n/testing';
import { AuthService, SubscriptionStateService } from '@ptah-web/core';

import uiAr from './i18n/ar.json';
import uiEn from './i18n/en.json';
import { NavigationComponent } from './navigation.component';

describe('NavigationComponent — language switcher', () => {
  let fixture: ComponentFixture<NavigationComponent>;
  let host: HTMLElement;

  const query = <E extends Element = HTMLElement>(selector: string): E | null =>
    host.querySelector<E>(selector);

  const trigger = (): HTMLButtonElement => {
    const button = query<HTMLButtonElement>('#lang-menu-trigger');
    if (!button) throw new Error('language trigger not rendered');
    return button;
  };

  const menuOptions = (): HTMLButtonElement[] =>
    Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '#lang-menu [role="menuitemradio"]',
      ),
    );

  const mobileOptions = (): HTMLButtonElement[] =>
    Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '#mobile-menu [role="group"] [role="menuitemradio"]',
      ),
    );

  const openLanguageMenu = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  /** `setLanguage` awaits its scope loads before it applies. */
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavigationComponent],
      providers: [
        provideRouter([]),
        // ui renders only its own scope's keys, so `ui` is the one scope here.
        provideI18nTesting({
          translations: { en: { ui: uiEn }, ar: { ui: uiAr } },
        }),
        {
          provide: AuthService,
          useValue: { isAuthenticated: () => of(false), logout: () => of() },
        },
        {
          provide: SubscriptionStateService,
          useValue: { fetchSubscriptionState: () => of(null) },
        },
      ],
    });
    fixture = TestBed.createComponent(NavigationComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host.remove();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('names the trigger with its visible code first (label in name)', () => {
    expect(trigger().textContent?.trim()).toBe('EN');
    expect(trigger().getAttribute('aria-label')).toBe('EN — Language: English');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(query('[data-i18n-switcher] #lang-menu-trigger')).not.toBeNull();
  });

  it('labels each option in its own language, with its own lang and dir', () => {
    openLanguageMenu();

    const [en, ar] = menuOptions();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(en.textContent?.trim()).toBe('English');
    expect(en.getAttribute('lang')).toBe('en');
    expect(en.getAttribute('dir')).toBe('ltr');
    expect(en.getAttribute('aria-checked')).toBe('true');
    expect(ar.textContent?.trim()).toBe('العربية');
    expect(ar.getAttribute('lang')).toBe('ar');
    expect(ar.getAttribute('dir')).toBe('rtl');
    expect(ar.getAttribute('aria-checked')).toBe('false');
  });

  it('switches to Arabic, closes the menu and returns focus to the trigger', async () => {
    openLanguageMenu();
    menuOptions()[1].click();
    await settle();

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(query('#lang-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().textContent?.trim()).toBe('AR');
    expect(trigger().getAttribute('aria-label')).toBe('AR — اللغة: العربية');
    expect(query('nav')?.getAttribute('aria-label')).toBe('التنقل الرئيسي');
  });

  it('closes on Escape without changing the language, refocusing the trigger', () => {
    const i18n = TestBed.inject(I18nService);
    openLanguageMenu();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(query('#lang-menu')).toBeNull();
    expect(i18n.lang()).toBe('en');
    expect(document.documentElement.dir).not.toBe('rtl');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on an outside click without changing the language', () => {
    const i18n = TestBed.inject(I18nService);
    openLanguageMenu();

    document.body.click();
    fixture.detectChanges();

    expect(query('#lang-menu')).toBeNull();
    expect(i18n.lang()).toBe('en');
  });

  it('keeps one menu open at a time', () => {
    query<HTMLButtonElement>('#product-menu-trigger')?.click();
    fixture.detectChanges();
    openLanguageMenu();

    expect(query('#product-menu')).toBeNull();
    expect(query('#lang-menu')).not.toBeNull();
  });

  it('offers a segmented language row in the mobile menu', async () => {
    query<HTMLButtonElement>('[aria-controls="mobile-menu"]')?.click();
    fixture.detectChanges();

    const group = query('#mobile-menu [role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Language');
    expect(group?.hasAttribute('data-i18n-switcher')).toBe(true);
    const [en, ar] = mobileOptions();
    expect(en.getAttribute('lang')).toBe('en');
    expect(ar.getAttribute('lang')).toBe('ar');
    expect(ar.getAttribute('dir')).toBe('rtl');

    ar.click();
    await settle();

    expect(document.documentElement.dir).toBe('rtl');
    const [enAfter, arAfter] = mobileOptions();
    expect(arAfter.getAttribute('aria-checked')).toBe('true');
    expect(enAfter.getAttribute('aria-checked')).toBe('false');
    expect(
      query('#mobile-menu [role="group"]')?.getAttribute('aria-label'),
    ).toBe('اللغة');
  });

  it('mirrors both LogOut icons through a wrapper, never on lucide-angular itself', () => {
    // lucide-angular copies its host's static classes onto the inner <svg>, so
    // a flip on the host is applied twice and cancels (batches.md, "Icon
    // mirroring mechanism"). The flip must sit on a plain wrapper.
    fixture.componentInstance.isAuthenticated.set(true);
    fixture.detectChanges();
    query<HTMLButtonElement>('#user-menu-trigger')?.click();
    query<HTMLButtonElement>('[aria-controls="mobile-menu"]')?.click();
    fixture.detectChanges();

    const logoutButtons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    ).filter((button) => button.textContent?.trim() === 'Logout');
    expect(logoutButtons.length).toBe(2);

    for (const button of logoutButtons) {
      const icon = button.querySelector('lucide-angular');
      const wrapper = icon?.parentElement;
      expect(wrapper?.tagName).toBe('SPAN');
      expect(wrapper?.classList).toContain('rtl:scale-x-[-1]');
      expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.classList).not.toContain('rtl:scale-x-[-1]');
      expect(icon?.querySelector('svg')?.classList).not.toContain(
        'rtl:scale-x-[-1]',
      );
    }
  });
});
