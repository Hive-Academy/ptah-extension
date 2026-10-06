import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
} from '@ptah-extension/core';
import { GlobalConfigActionsComponent } from './global-config-actions.component';

describe('GlobalConfigActionsComponent', () => {
  let fixture: ComponentFixture<GlobalConfigActionsComponent>;
  const ids: ConfigurationSurfaceId[] = ['thoth', 'marketplace', 'settings'];
  const appState = {
    openConfigurationSurface: signal<ConfigurationSurfaceId | null>(null),
    thothFirstRunDismissed: signal(false),
    dismissThothFirstRun: jest.fn(),
    setCurrentView: jest.fn<void, [ConfigurationSurfaceId]>(),
  };

  function buttons(): HTMLButtonElement[] {
    return Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('[data-test^="config-menu-item-"]'),
    );
  }

  beforeEach(async () => {
    appState.openConfigurationSurface.set(null);
    appState.thothFirstRunDismissed.set(false);
    appState.setCurrentView.mockReset();
    appState.dismissThothFirstRun.mockReset().mockImplementation(() => {
      appState.thothFirstRunDismissed.set(true);
    });
    await TestBed.configureTestingModule({
      imports: [GlobalConfigActionsComponent],
      providers: [{ provide: AppStateManager, useValue: appState }],
    }).compileComponents();
    fixture = TestBed.createComponent(GlobalConfigActionsComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('renders Thoth, Marketplace and Settings as labelled icon buttons, without a dropdown', () => {
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Thoth',
      'Marketplace',
      'Settings',
    ]);
    expect(buttons().map((b) => b.getAttribute('data-test'))).toEqual(
      ids.map((id) => `config-menu-item-${id}`),
    );
    expect(buttons().every((b) => b.type === 'button')).toBe(true);
    expect(buttons().every((b) => b.textContent?.trim() === '')).toBe(true);
    expect(buttons()[0].title).toBe('Thoth — agentic platform');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-test="config-menu-trigger"]',
      ),
    ).toBeNull();
  });

  it('adds a Setup hub icon button after Thoth when showSetupHub is set', () => {
    fixture.componentRef.setInput('showSetupHub', true);
    fixture.detectChanges();
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Thoth',
      'Setup hub',
      'Marketplace',
      'Settings',
    ]);
    buttons()[1].click();
    expect(appState.setCurrentView).toHaveBeenCalledWith('setup-hub');
    appState.openConfigurationSurface.set('setup-hub');
    fixture.detectChanges();
    expect(buttons()[1].getAttribute('aria-current')).toBe('true');
  });

  it.each(ids)('navigates to %s on click', (id) => {
    buttons()[ids.indexOf(id)].click();
    expect(appState.setCurrentView).toHaveBeenCalledTimes(1);
    expect(appState.setCurrentView).toHaveBeenCalledWith(id);
    if (id !== 'thoth') {
      expect(appState.dismissThothFirstRun).not.toHaveBeenCalled();
    }
  });

  it('dismisses the Thoth hint once and before setCurrentView', () => {
    buttons()[0].click();
    expect(appState.dismissThothFirstRun).toHaveBeenCalledTimes(1);
    expect(
      appState.dismissThothFirstRun.mock.invocationCallOrder[0],
    ).toBeLessThan(appState.setCurrentView.mock.invocationCallOrder[0]);
    buttons()[0].click();
    expect(appState.dismissThothFirstRun).toHaveBeenCalledTimes(1);
    expect(appState.setCurrentView).toHaveBeenCalledTimes(2);
  });

  it('updates aria-current and highlights from the settled surface signal', () => {
    for (const surface of [null, ...ids, 'setup-hub' as const, null]) {
      appState.openConfigurationSurface.set(surface);
      fixture.detectChanges();
      buttons().forEach((button, index) => {
        const isCurrent = ids[index] === surface;
        expect(button.getAttribute('aria-current')).toBe(
          isCurrent ? 'true' : null,
        );
        expect(button.classList.contains('text-primary')).toBe(isCurrent);
        expect(button.classList.contains('bg-base-300')).toBe(isCurrent);
      });
    }
  });
});
