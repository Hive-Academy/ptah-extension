import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from '../../services/ptah-ui-host-sources';
import {
  PTAH_UI_DISPLAY_DOCK,
  displayFenceKey,
  type PtahUiDisplayDock,
  type PtahUiDisplayFenceStatus,
} from '../../services/ptah-ui-display-dock';
import { PtahUiDisplayChipComponent } from './ptah-ui-display-chip.component';

const KEY = displayFenceKey('m1', 'n1', 0);
const APPLIED: PtahUiDisplayFenceStatus = {
  kind: 'applied',
  surfaceKey: 'id:release',
  title: 'Release',
  description: null,
};

class Dock implements PtahUiDisplayDock {
  readonly status = signal<PtahUiDisplayFenceStatus | null>(null);
  fenceStatus(
    tabId: string,
    fenceKey: string,
  ): PtahUiDisplayFenceStatus | null {
    expect([tabId, fenceKey]).toEqual(['tab-1', KEY]);
    return this.status();
  }
  openSurface = jest.fn();
}

@Component({
  standalone: true,
  imports: [PtahUiDisplayChipComponent],
  template: `<ptah-ui-display-chip
    raw="fence"
    [ordinal]="0"
    messageId="m1"
    nodeId="n1"
    (openInDisplayRequested)="opened.push($event)"
  />`,
})
class Host {
  readonly opened: string[] = [];
}

describe('inline display status and action', () => {
  let fixture: ComponentFixture<Host>;
  let dock: Dock;
  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const status = (): string =>
    root()
      .querySelector('[data-testid="ptah-ui-display-chip-state"]')
      ?.textContent?.trim() ?? '';
  const action = (): HTMLButtonElement | null =>
    root().querySelector('[data-testid="ptah-ui-display-chip-open"]');
  const settle = (): void => fixture.detectChanges();

  function create(withDock = true): void {
    dock = new Dock();
    const hostSources: PtahUiHostSources = {
      tabId: signal('tab-1'),
      sessionId: signal('session-1'),
      turnFacts: signal([]),
      turnIndexOf: () => null,
      capacities: signal([]),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PTAH_UI_HOST_SOURCES, useValue: hostSources },
        ...(withDock
          ? [{ provide: PTAH_UI_DISPLAY_DOCK, useValue: dock }]
          : []),
      ],
    });
    fixture = TestBed.createComponent(Host);
    settle();
  }

  it('keeps pending identity until the feed publishes a status', () => {
    create();
    expect(status()).toBe('Pending display');
    expect(action()).toBeNull();
    dock.status.set(APPLIED);
    settle();
    expect(status()).toBe('In display');
  });

  it('emits the current surface key for sheet navigation', () => {
    create();
    dock.status.set(APPLIED);
    settle();
    action()?.click();
    expect(fixture.componentInstance.opened).toEqual(['id:release']);
    expect(dock.openSurface).not.toHaveBeenCalled();
  });

  it.each(['superseded', 'evicted'] as const)(
    'reports %s without changing the fence instance',
    (kind) => {
      create();
      dock.status.set(APPLIED);
      settle();
      const chip = fixture.debugElement.query(
        By.directive(PtahUiDisplayChipComponent),
      ).componentInstance;
      dock.status.set({ ...APPLIED, kind });
      settle();
      expect(status()).toBe(
        kind === 'superseded' ? 'Updated later' : 'No longer in display',
      );
      expect(
        fixture.debugElement.query(By.directive(PtahUiDisplayChipComponent))
          .componentInstance,
      ).toBe(chip);
      if (kind === 'evicted') expect(action()).toBeNull();
      else {
        action()?.click();
        expect(fixture.componentInstance.opened).toEqual(['id:release']);
      }
    },
  );

  it('reports invalid status without exposing the raw reason', () => {
    create();
    dock.status.set({ kind: 'invalid', reason: 'reserved display id' });
    settle();
    expect(status()).toBe('Not in display');
    expect(action()).toBeNull();
  });

  it('renders safely when the host has no dock', () => {
    create(false);
    expect(
      root().querySelector('[data-testid="ptah-ui-display-chip"]'),
    ).toBeNull();
    expect(action()).toBeNull();
  });
});
