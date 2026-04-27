import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Placement } from '@floating-ui/dom';
import * as FloatingDom from '@floating-ui/dom';
import { NativePopoverComponent } from './native-popover.component';

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
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="placement()"
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
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  };

  it('should create', () => {
    expect(host).toBeTruthy();
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

  describe('ngOnDestroy', () => {
    it('should cleanup without throwing', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      expect(() => fixture.destroy()).not.toThrow();
    });
  });
});
