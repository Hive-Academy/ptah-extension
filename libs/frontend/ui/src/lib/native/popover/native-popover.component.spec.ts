import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Placement } from '@floating-ui/dom';
import * as FloatingDom from '@floating-ui/dom';
import {
  NativePopoverComponent,
  POPOVER_POSITION_TIMEOUT_MS,
} from './native-popover.component';
import { FloatingUIService } from '../shared';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

@Component({
  standalone: true,
  imports: [NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="placement()"
      [anchor]="anchor()"
      [offset]="offsetValue()"
      [hasBackdrop]="hasBackdrop()"
      [backdropClass]="backdropClass()"
      (opened)="onOpened()"
      (closed)="onClosed()"
      (backdropClicked)="onBackdropClicked()"
    >
      <button trigger id="trigger-btn">Open</button>
      <div content class="settings-panel">
        <button id="first-btn">First</button>
      </div>
    </ptah-native-popover>
  `,
})
class HostComponent {
  isOpen = signal(false);
  placement = signal<Placement>('bottom');
  anchor = signal<HTMLElement | null>(null);
  offsetValue = signal(8);
  hasBackdrop = signal(true);
  backdropClass = signal<'transparent' | 'dark'>('dark');

  openedCount = 0;
  closedCount = 0;
  backdropClickedCount = 0;

  onOpened(): void {
    this.openedCount++;
  }
  onClosed(): void {
    this.closedCount++;
  }
  onBackdropClicked(): void {
    this.backdropClickedCount++;
  }
}

describe('NativePopoverComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const mockedCompute = FloatingDom.computePosition as unknown as jest.Mock;
  const mockedAutoUpdate = FloatingDom.autoUpdate as unknown as jest.Mock;

  beforeEach(async () => {
    mockedCompute.mockClear();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const flushAll = async () => {
    await new Promise((r) => queueMicrotask(() => r(null)));
    // The bounded positioning race adds a few promise hops before `opened`.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    fixture.detectChanges();
  };

  it('should create', () => {
    expect(host).toBeTruthy();
  });

  it('positions from the projected trigger by default', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushAll();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('.popover-trigger');
    expect(mockedCompute.mock.calls[0][0]).toBe(trigger);
  });

  it('positions from an external anchor when supplied', async () => {
    const external = document.createElement('button');
    document.body.appendChild(external);
    try {
      host.anchor.set(external);
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();
      expect(mockedCompute.mock.calls[0][0]).toBe(external);
    } finally {
      external.remove();
    }
  });

  it('falls back to the projected trigger when an external anchor is detached', async () => {
    const detached = document.createElement('button');
    host.anchor.set(detached);
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushAll();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('.popover-trigger');
    expect(mockedCompute.mock.calls[0][0]).toBe(trigger);
    expect(host.openedCount).toBe(1);
  });

  it('reposition() recomputes the live position after the next render', () => {
    const debug = fixture.debugElement.query(
      By.directive(NativePopoverComponent),
    );
    const update = jest.spyOn(debug.injector.get(FloatingUIService), 'update');
    (debug.componentInstance as NativePopoverComponent).reposition();
    expect(update).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('a reposition() scheduled before close has no effect: update() is a no-op after cleanup', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushAll();
    const debug = fixture.debugElement.query(
      By.directive(NativePopoverComponent),
    );
    const service = debug.injector.get(FloatingUIService);
    const update = jest.spyOn(service, 'update');
    const computes = mockedCompute.mock.calls.length;
    (debug.componentInstance as NativePopoverComponent).reposition();
    host.isOpen.set(false);
    fixture.detectChanges();
    await flushAll();
    expect(update).toHaveBeenCalled();
    expect(mockedCompute.mock.calls.length).toBe(computes);
  });

  it('should always render the trigger', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#trigger-btn')).toBeTruthy();
  });

  it('should NOT render panel when isOpen is false', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.popover-panel')).toBeFalsy();
    expect(compiled.querySelector('.settings-panel')).toBeFalsy();
  });

  it('should render panel and projected content when isOpen is true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.popover-panel')).toBeTruthy();
    expect(compiled.querySelector('.settings-panel')).toBeTruthy();
  });

  it('should render backdrop by default (hasBackdrop defaults to true)', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop).toBeTruthy();
  });

  it('should apply dark backdrop class by default', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop?.classList.contains('bg-black/50')).toBe(true);
  });

  it('should NOT apply dark class when backdropClass is transparent', () => {
    host.backdropClass.set('transparent');
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop?.classList.contains('bg-black/50')).toBe(false);
  });

  it('should NOT render backdrop when hasBackdrop is false', () => {
    host.hasBackdrop.set(false);
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop).toBeFalsy();
  });

  it('should emit backdropClicked AND closed when backdrop is clicked', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    backdrop.click();

    expect(host.backdropClickedCount).toBe(1);
    expect(host.closedCount).toBe(1);
  });

  it('should emit opened event after async positioning completes', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushAll();

    expect(host.openedCount).toBe(1);
  });

  it('should call computePosition when opened', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushAll();

    expect(mockedCompute).toHaveBeenCalled();
  });

  describe('Escape key handling', () => {
    it('should emit closed on Escape when popover is open', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      const popoverEl = (fixture.nativeElement as HTMLElement).querySelector(
        'ptah-native-popover',
      ) as HTMLElement;
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      popoverEl.dispatchEvent(event);

      expect(host.closedCount).toBe(1);
    });

    it('should NOT emit closed on Escape when popover is not open', () => {
      const popoverEl = (fixture.nativeElement as HTMLElement).querySelector(
        'ptah-native-popover',
      ) as HTMLElement;
      popoverEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(host.closedCount).toBe(0);
    });

    it('should NOT close on non-Escape keys', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      const popoverEl = (fixture.nativeElement as HTMLElement).querySelector(
        'ptah-native-popover',
      ) as HTMLElement;
      popoverEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(host.closedCount).toBe(0);
    });
  });

  describe('Focus management', () => {
    it('should restore focus to previously-focused element when popover closes', async () => {
      const triggerBtn = (fixture.nativeElement as HTMLElement).querySelector(
        '#trigger-btn',
      ) as HTMLButtonElement;
      // Attach to body so focus works reliably in JSDOM
      document.body.appendChild(fixture.nativeElement);
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();

      // Close the popover
      host.isOpen.set(false);
      fixture.detectChanges();

      expect(document.activeElement).toBe(triggerBtn);
    });
  });

  describe('Positioning failure and stale opens', () => {
    const microtasks = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    const panel = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '.popover-panel',
      ) as HTMLElement;
    const focusTrigger = () => {
      document.body.appendChild(fixture.nativeElement);
      const triggerBtn = (fixture.nativeElement as HTMLElement).querySelector(
        '#trigger-btn',
      ) as HTMLButtonElement;
      triggerBtn.focus();
      return triggerBtn;
    };
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {
        /* the dev-mode diagnostic is asserted, not printed */
      });
    });
    afterEach(() => consoleError.mockRestore());

    it('shows the panel unpositioned, focuses it and emits opened when positioning rejects; Escape still closes and restores focus', async () => {
      mockedCompute.mockRejectedValueOnce(new Error('no layout'));
      const triggerBtn = focusTrigger();

      host.isOpen.set(true);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();

      expect(panel().style.visibility).toBe('visible');
      expect(document.activeElement).toBe(panel());
      expect(host.openedCount).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('positioning failed'),
      );

      // The fallback panel is dismissable like a positioned one.
      panel().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(host.closedCount).toBe(1);
      host.isOpen.set(false);
      fixture.detectChanges();
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('shows the panel unpositioned once positioning overruns its bound', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
      try {
        mockedCompute.mockReturnValueOnce(new Promise(() => undefined));
        host.isOpen.set(true);
        fixture.detectChanges();
        await microtasks();

        expect(panel().style.visibility).toBe('hidden');
        expect(host.openedCount).toBe(0);

        jest.advanceTimersByTime(POPOVER_POSITION_TIMEOUT_MS);
        await microtasks();

        expect(panel().style.visibility).toBe('visible');
        expect(host.openedCount).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('positioning timed out'),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not focus or emit opened when closed before positioning resolves', async () => {
      let resolvePosition: (value: { x: number; y: number }) => void = () =>
        undefined;
      mockedCompute.mockReturnValueOnce(
        new Promise((resolve) => (resolvePosition = resolve)),
      );
      const triggerBtn = focusTrigger();

      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();
      expect(mockedCompute).toHaveBeenCalledTimes(1);

      host.isOpen.set(false);
      fixture.detectChanges();
      expect(document.activeElement).toBe(triggerBtn);
      const autoUpdatesBefore = mockedAutoUpdate.mock.calls.length;

      resolvePosition({ x: 0, y: 0 });
      await settle();

      expect(host.openedCount).toBe(0);
      expect(document.activeElement).toBe(triggerBtn);
      // The cancelled position never starts an auto-update.
      expect(mockedAutoUpdate.mock.calls.length).toBe(autoUpdatesBefore);
    });

    it('close during a pending position leaves no auto-update after it resolves', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
      try {
        let resolvePosition: (value: { x: number; y: number }) => void = () =>
          undefined;
        mockedCompute.mockReturnValueOnce(
          new Promise((resolve) => (resolvePosition = resolve)),
        );
        host.isOpen.set(true);
        fixture.detectChanges();
        await microtasks();

        // The bound overruns: the panel opens unpositioned.
        jest.advanceTimersByTime(POPOVER_POSITION_TIMEOUT_MS);
        await microtasks();
        expect(host.openedCount).toBe(1);

        host.isOpen.set(false);
        fixture.detectChanges();
        const autoUpdatesBefore = mockedAutoUpdate.mock.calls.length;

        resolvePosition({ x: 0, y: 0 });
        await microtasks();

        expect(mockedAutoUpdate.mock.calls.length).toBe(autoUpdatesBefore);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('ngOnDestroy', () => {
    it('should cleanup without throwing', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      expect(() => fixture.destroy()).not.toThrow();
    });
  });
});
