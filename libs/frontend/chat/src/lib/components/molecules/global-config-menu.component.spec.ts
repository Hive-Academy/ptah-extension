import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
} from '@ptah-extension/core';
import { NativeDropdownComponent } from '@ptah-extension/ui';
import { GlobalConfigMenuComponent } from './global-config-menu.component';

describe('GlobalConfigMenuComponent', () => {
  let fixture: ComponentFixture<GlobalConfigMenuComponent>;
  const ids: ConfigurationSurfaceId[] = [
    'thoth',
    'setup-hub',
    'marketplace',
    'settings',
  ];
  const appState = {
    openConfigurationSurface: signal<ConfigurationSurfaceId | null>(null),
    thothFirstRunDismissed: signal(false),
    dismissThothFirstRun: jest.fn(),
    setCurrentView: jest.fn<void, [ConfigurationSurfaceId]>(),
  };

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function trigger(): HTMLButtonElement {
    return host().querySelector<HTMLButtonElement>(
      '[data-test="config-menu-trigger"]',
    )!;
  }

  function items(): HTMLButtonElement[] {
    return Array.from(
      host().querySelectorAll<HTMLButtonElement>(
        '[data-test^="config-menu-item-"]',
      ),
    );
  }

  function dropdown() {
    return fixture.debugElement.query(By.directive(NativeDropdownComponent));
  }

  function openMenu(): void {
    trigger().click();
    fixture.detectChanges();
    dropdown().triggerEventHandler('opened');
  }

  function pressKey(target: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  beforeEach(async () => {
    appState.openConfigurationSurface.set(null);
    appState.thothFirstRunDismissed.set(false);
    appState.setCurrentView.mockReset();
    appState.dismissThothFirstRun.mockReset().mockImplementation(() => {
      appState.thothFirstRunDismissed.set(true);
    });
    await TestBed.configureTestingModule({
      imports: [GlobalConfigMenuComponent],
      providers: [{ provide: AppStateManager, useValue: appState }],
    }).compileComponents();
    fixture = TestBed.createComponent(GlobalConfigMenuComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('renders exactly four action buttons in the required order', () => {
    openMenu();
    expect(items().map((item) => item.textContent?.trim())).toEqual([
      'Thoth',
      'Setup hub',
      'Marketplace',
      'Settings',
    ]);
    expect(items().map((item) => item.getAttribute('data-test'))).toEqual(
      ids.map((id) => `config-menu-item-${id}`),
    );
    expect(items().every((item) => item.type === 'button')).toBe(true);
    expect(items()[0].title).toBe('Thoth — agentic platform');
    expect(host().querySelector('.dropdown-panel')?.hasAttribute('role')).toBe(
      false,
    );
  });

  it('names the trigger Configuration and reflects click toggles in aria-expanded', () => {
    expect(trigger().type).toBe('button');
    expect(trigger().getAttribute('aria-label')).toBe('Configuration');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.dropdown-panel')).toBeNull();
    openMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(host().querySelector('.dropdown-panel')).not.toBeNull();
    trigger().click();
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.dropdown-panel')).toBeNull();
  });

  it('focuses the first item when the dropdown emits opened', () => {
    openMenu();
    expect(document.activeElement).toBe(items()[0]);
  });

  it.each(ids)(
    'selects %s, closes, and refocuses the trigger before navigation',
    (id) => {
      openMenu();
      const item = items()[ids.indexOf(id)];
      item.focus();
      appState.setCurrentView.mockImplementation(() => {
        expect(document.activeElement).toBe(trigger());
        fixture.detectChanges();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
      });
      item.click();
      fixture.detectChanges();
      expect(appState.setCurrentView).toHaveBeenCalledTimes(1);
      expect(appState.setCurrentView).toHaveBeenCalledWith(id);
      expect(host().querySelector('.dropdown-panel')).toBeNull();
      expect(document.activeElement).toBe(trigger());
      if (id !== 'thoth') {
        expect(appState.dismissThothFirstRun).not.toHaveBeenCalled();
      }
    },
  );

  it('dismisses the Thoth hint once and before setCurrentView', () => {
    openMenu();
    items()[0].click();
    fixture.detectChanges();
    expect(appState.dismissThothFirstRun).toHaveBeenCalledTimes(1);
    expect(
      appState.dismissThothFirstRun.mock.invocationCallOrder[0],
    ).toBeLessThan(appState.setCurrentView.mock.invocationCallOrder[0]);
    openMenu();
    items()[0].click();
    fixture.detectChanges();
    expect(appState.dismissThothFirstRun).toHaveBeenCalledTimes(1);
    expect(appState.setCurrentView).toHaveBeenCalledTimes(2);
  });

  it('does not dismiss an already dismissed Thoth hint', () => {
    appState.thothFirstRunDismissed.set(true);
    openMenu();
    items()[0].click();
    fixture.detectChanges();
    expect(appState.dismissThothFirstRun).not.toHaveBeenCalled();
    expect(appState.setCurrentView).toHaveBeenCalledWith('thoth');
  });

  it('closes on Escape and refocuses the trigger', () => {
    openMenu();
    pressKey(items()[0], 'Escape');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.dropdown-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(appState.setCurrentView).not.toHaveBeenCalled();
  });

  it('roves with ArrowDown and ArrowUp, prevents scrolling, and wraps both ends', () => {
    openMenu();
    const buttons = items();
    for (const nextIndex of [1, 2, 3, 0]) {
      const event = pressKey(
        document.activeElement as HTMLElement,
        'ArrowDown',
      );
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[nextIndex]);
    }
    for (const nextIndex of [3, 2, 1, 0]) {
      const event = pressKey(document.activeElement as HTMLElement, 'ArrowUp');
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[nextIndex]);
    }
    expect(appState.setCurrentView).not.toHaveBeenCalled();
  });

  it('closes and refocuses the trigger when the dropdown emits closed', () => {
    openMenu();
    dropdown().triggerEventHandler('closed');
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.dropdown-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a backdrop click and refocuses the trigger', () => {
    openMenu();
    host().querySelector<HTMLElement>('[role="presentation"]')!.click();
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.dropdown-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('updates aria-current and item and trigger highlights from the settled surface signal', () => {
    openMenu();
    for (const surface of [null, ...ids, null]) {
      appState.openConfigurationSurface.set(surface);
      fixture.detectChanges();
      expect(trigger().classList.contains('text-primary')).toBe(
        surface !== null,
      );
      expect(trigger().classList.contains('bg-base-300')).toBe(
        surface !== null,
      );
      items().forEach((item, index) => {
        const isCurrent = ids[index] === surface;
        expect(item.getAttribute('aria-current')).toBe(
          isCurrent ? 'true' : null,
        );
        expect(item.classList.contains('text-primary')).toBe(isCurrent);
        expect(item.classList.contains('bg-base-300')).toBe(isCurrent);
      });
    }
  });

  it('closes when navigation is a no-op and preserves the settled active indication', () => {
    appState.openConfigurationSurface.set('settings');
    openMenu();
    items()[2].click();
    fixture.detectChanges();
    expect(appState.setCurrentView).toHaveBeenCalledWith('marketplace');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    expect(appState.openConfigurationSurface()).toBe('settings');
    openMenu();
    expect(items()[3].getAttribute('aria-current')).toBe('true');
    expect(items()[2].getAttribute('aria-current')).toBeNull();
  });

  it('delegates a re-click on the active Thoth surface after dismissing its hint', () => {
    appState.openConfigurationSurface.set('thoth');
    openMenu();
    items()[0].click();
    fixture.detectChanges();
    expect(appState.setCurrentView).toHaveBeenCalledWith('thoth');
    expect(
      appState.dismissThothFirstRun.mock.invocationCallOrder[0],
    ).toBeLessThan(appState.setCurrentView.mock.invocationCallOrder[0]);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });
});
