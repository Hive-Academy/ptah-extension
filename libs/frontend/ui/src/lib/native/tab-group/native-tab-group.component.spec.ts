import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  NativeTab,
  NativeTabGroupComponent,
} from './native-tab-group.component';

@Component({
  standalone: true,
  imports: [NativeTabGroupComponent],
  template: `
    <ptah-native-tab-group
      [tabs]="tabs()"
      [(activeId)]="activeId"
      [ariaLabel]="'Library sections'"
      (tabSelected)="onSelected($event)"
    >
      <p data-testid="panel-content">{{ activeId() }}</p>
    </ptah-native-tab-group>
  `,
})
class HostComponent {
  tabs = signal<readonly NativeTab[]>([
    { id: 'skill', label: 'Skills', count: 12 },
    { id: 'agent', label: 'Agents', count: 4 },
    { id: 'command', label: 'Commands', count: 0 },
  ]);
  activeId = signal<string | null>(null);
  selections: string[] = [];

  onSelected(id: string): void {
    this.selections.push(id);
  }
}

describe('NativeTabGroupComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const tabs = (): HTMLButtonElement[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="native-tab"]',
      ),
    );

  const tablist = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="native-tablist"]',
    ) as HTMLElement;

  /**
   * Keys are handled on the tab buttons (they are the focusable elements), so
   * the event is dispatched on whichever tab currently holds the roving
   * tabindex — exactly where a real keypress would land.
   */
  const press = (key: string): void => {
    const focused =
      tabs().find((t) => t.getAttribute('tabindex') === '0') ?? tabs()[0];
    focused.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders one tab per entry with the correct ARIA roles', () => {
    expect(tablist().getAttribute('role')).toBe('tablist');
    expect(tablist().getAttribute('aria-label')).toBe('Library sections');
    expect(tabs().length).toBe(3);
    expect(tabs().every((t) => t.getAttribute('role') === 'tab')).toBe(true);

    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="native-tabpanel"]',
    ) as HTMLElement;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0].id);
    expect(tabs()[0].getAttribute('aria-controls')).toBe(panel.id);
  });

  it('falls back to the first enabled tab when activeId is null', () => {
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('skips disabled tabs when resolving the fallback', () => {
    host.tabs.set([
      { id: 'skill', label: 'Skills', disabled: true },
      { id: 'agent', label: 'Agents' },
    ]);
    fixture.detectChanges();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].disabled).toBe(true);
  });

  it('renders a count badge for numeric counts including zero', () => {
    const badges = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="native-tab-count"]',
      ),
    );
    expect(badges.map((b) => b.textContent?.trim())).toEqual(['12', '4', '0']);
  });

  it('renders no badge when count is null or omitted', () => {
    host.tabs.set([
      { id: 'skill', label: 'Skills' },
      { id: 'agent', label: 'Agents', count: null },
    ]);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="native-tab-count"]',
      ).length,
    ).toBe(0);
  });

  it('updates the two-way bound activeId and emits tabSelected on click', () => {
    tabs()[1].click();
    fixture.detectChanges();
    expect(host.activeId()).toBe('agent');
    expect(host.selections).toEqual(['agent']);
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="panel-content"]',
      )?.textContent,
    ).toBe('agent');
  });

  it('does not re-emit when the already-active tab is clicked', () => {
    tabs()[0].click();
    fixture.detectChanges();
    expect(host.selections).toEqual([]);
  });

  it('uses a roving tabindex so only the active tab is in the tab order', () => {
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
    tabs()[2].click();
    fixture.detectChanges();
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
    ]);
  });

  it('moves selection with ArrowRight / ArrowLeft and wraps', () => {
    press('ArrowRight');
    expect(host.activeId()).toBe('agent');
    press('ArrowRight');
    expect(host.activeId()).toBe('command');
    press('ArrowRight');
    expect(host.activeId()).toBe('skill');
    press('ArrowLeft');
    expect(host.activeId()).toBe('command');
  });

  it('jumps to the first/last enabled tab with Home / End', () => {
    press('End');
    expect(host.activeId()).toBe('command');
    press('Home');
    expect(host.activeId()).toBe('skill');
  });

  it('skips disabled tabs during arrow navigation', () => {
    host.tabs.set([
      { id: 'skill', label: 'Skills' },
      { id: 'agent', label: 'Agents', disabled: true },
      { id: 'command', label: 'Commands' },
    ]);
    fixture.detectChanges();
    press('ArrowRight');
    expect(host.activeId()).toBe('command');
  });

  it('moves DOM focus along with arrow-key selection', () => {
    press('ArrowRight');
    expect(document.activeElement).toBe(tabs()[1]);
  });

  it('ignores unrelated keys', () => {
    press('a');
    expect(host.activeId()).toBeNull();
  });

  it('recovers when the bound activeId points at a tab that no longer exists', () => {
    host.activeId.set('agent');
    fixture.detectChanges();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');

    host.tabs.set([{ id: 'skill', label: 'Skills' }]);
    fixture.detectChanges();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });
});
