import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '@ptah-extension/i18n';
import {
  loadScopeTranslations,
  provideI18nTesting,
} from '@ptah-extension/i18n/testing';
import { UI_I18N_SCOPE } from '@ptah-web/ui';

import panelUiAr from '../i18n/ar.json';
import panelUiEn from '../i18n/en.json';
import type { PanelNavGroup } from '../panel-nav.types';
import { PanelLayout } from './panel-layout';

/**
 * The owning shell translates its own nav labels and title (plan Component 5,
 * rule 4), so this host swaps them on a language switch exactly as
 * `member-layout` and `admin-layout` do. The labels themselves are stand-ins,
 * not keys: panel-ui never translates them.
 */
@Component({
  standalone: true,
  imports: [PanelLayout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-panel-layout
      [navGroups]="groups()"
      [title]="title()"
      badgeLabel="Restricted"
    >
      <ng-container panelTopBar>
        <span data-topbar>member&#64;example.com</span>
      </ng-container>
    </ptah-panel-layout>
  `,
})
class HostComponent {
  private readonly i18n = inject(I18nService);
  private readonly ar = computed(() => this.i18n.lang() === 'ar');

  protected readonly title = computed(() =>
    this.ar() ? 'لوحة التحكم' : 'Admin Dashboard',
  );

  /** The conditional trailing flat group both real shells append. */
  public readonly showTrailing = signal(true);

  protected readonly groups = computed<PanelNavGroup[]>(() => [
    ...this.baseGroups(),
    ...(this.showTrailing()
      ? [
          {
            label: this.ar() ? 'الإدارة' : 'Admin',
            flat: true,
            items: [{ label: 'Admin', route: '/admin', primary: true }],
          },
        ]
      : []),
  ]);

  private readonly baseGroups = computed<PanelNavGroup[]>(() => [
    {
      label: this.ar() ? 'نظرة عامة' : 'Overview',
      flat: true,
      items: [{ label: 'Home', route: '/home', primary: true }],
    },
    {
      label: this.ar() ? 'الأشخاص' : 'People',
      items: [
        { label: 'Users', route: '/users', primary: true },
        { label: 'Invites', route: '/invites', primary: false },
      ],
    },
    {
      label: this.ar() ? 'الفوترة' : 'Billing',
      items: [
        { label: 'Plans', route: '/plans', primary: true },
        { label: 'Refunds', route: '/refunds', primary: false },
      ],
    },
  ]);
}

describe('PanelLayout', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  const groupButton = (index: number): HTMLButtonElement => {
    const buttons = host.querySelectorAll<HTMLButtonElement>(
      'nav button[aria-expanded]',
    );
    const button = buttons.item(index);
    if (!button) throw new Error(`group toggle ${index} not rendered`);
    return button;
  };

  const chevron = (index: number): Element | null =>
    groupButton(index).querySelector('lucide-angular');

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    const ui = await loadScopeTranslations(UI_I18N_SCOPE);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideI18nTesting({
          translations: {
            en: { panelUi: panelUiEn, ui: ui.en },
            ar: { panelUi: panelUiAr, ui: ui.ar },
          },
        }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host.remove();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  describe('header (design-spec §2.4)', () => {
    it('wraps the outer header and truncates the title on one line', () => {
      const header = host.querySelector('header');
      expect(header?.classList).toContain('flex-wrap');
      expect(header?.firstElementChild?.classList).toContain('min-w-0');
      expect(host.querySelector('h1')?.classList).toContain('truncate');

      const badge = host.querySelector('h1 + .badge');
      expect(badge?.classList).toContain('shrink-0');
      expect(badge?.classList).toContain('whitespace-nowrap');
    });

    it('renders the language switch after the projected top bar', () => {
      const cluster = host.querySelector('header')?.lastElementChild;
      const topbar = cluster?.querySelector('[data-topbar]');
      const switcher = cluster?.querySelector('ptah-language-switch');

      expect(topbar).not.toBeNull();
      expect(switcher?.querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(cluster?.lastElementChild).toBe(switcher);
      expect(
        topbar &&
          switcher &&
          topbar.compareDocumentPosition(switcher) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('names the drawer toggle from panelUi keys with the given title', async () => {
      const toggle = (): Element | null => host.querySelector('header label');
      expect(toggle()?.getAttribute('aria-label')).toBe(
        'Open Admin Dashboard menu',
      );

      await TestBed.inject(I18nService).setLanguage('ar');
      await settle();

      expect(toggle()?.getAttribute('aria-label')).toBe(
        'افتح قائمة لوحة التحكم',
      );
      expect(
        host.querySelector('.drawer-overlay')?.getAttribute('aria-label'),
      ).toBe('أغلق القائمة');
    });
  });

  describe('group collapse', () => {
    it('rotates the collapsed chevron both ways, never when expanded', () => {
      expect(chevron(0)?.classList).not.toContain('-rotate-90');
      expect(chevron(0)?.classList).not.toContain('rtl:rotate-90');

      groupButton(0).click();
      fixture.detectChanges();

      expect(chevron(0)?.classList).toContain('-rotate-90');
      expect(chevron(0)?.classList).toContain('rtl:rotate-90');
    });

    it('keeps collapse state across a switch with a trailing flat group toggling', async () => {
      // The trailing flat group is rendered and has no disclosure toggle.
      expect(host.querySelector('a[href="/admin"]')).not.toBeNull();
      expect(host.querySelectorAll('nav button[aria-expanded]').length).toBe(2);

      groupButton(0).click();
      fixture.detectChanges();

      await TestBed.inject(I18nService).setLanguage('ar');
      fixture.componentInstance.showTrailing.set(false);
      await settle();

      expect(host.querySelector('a[href="/admin"]')).toBeNull();
      expect(groupButton(0).textContent?.trim()).toBe('الأشخاص');
      expect(groupButton(0).getAttribute('aria-expanded')).toBe('false');
      expect(groupButton(1).getAttribute('aria-expanded')).toBe('true');
      expect(host.textContent).not.toContain('Invites');
      expect(host.textContent).toContain('Refunds');

      fixture.componentInstance.showTrailing.set(true);
      await TestBed.inject(I18nService).setLanguage('en');
      await settle();

      expect(host.querySelector('a[href="/admin"]')).not.toBeNull();
      expect(groupButton(0).textContent?.trim()).toBe('People');
      expect(groupButton(0).getAttribute('aria-expanded')).toBe('false');
      expect(groupButton(1).getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps a collapsed group collapsed across a language switch', async () => {
      groupButton(1).click();
      fixture.detectChanges();
      expect(groupButton(1).getAttribute('aria-expanded')).toBe('false');
      expect(host.textContent).not.toContain('Refunds');
      expect(host.textContent).toContain('Invites');

      await TestBed.inject(I18nService).setLanguage('ar');
      await settle();

      expect(groupButton(1).textContent?.trim()).toBe('الفوترة');
      expect(groupButton(1).getAttribute('aria-expanded')).toBe('false');
      expect(groupButton(0).getAttribute('aria-expanded')).toBe('true');
      expect(host.textContent).not.toContain('Refunds');
      expect(host.textContent).toContain('Invites');
    });
  });
});
