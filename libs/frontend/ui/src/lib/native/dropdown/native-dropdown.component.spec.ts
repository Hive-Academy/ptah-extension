import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Placement } from '@floating-ui/dom';
import * as FloatingDom from '@floating-ui/dom';
import {
  DROPDOWN_POSITION_TIMEOUT_MS,
  NativeDropdownComponent,
} from './native-dropdown.component';

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
  imports: [NativeDropdownComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      [placement]="placement()"
      [offset]="offsetValue()"
      [hasBackdrop]="hasBackdrop()"
      [backdropClass]="backdropClass()"
      [closeOnBackdropClick]="closeOnBackdropClick()"
      (opened)="onOpened()"
      (closed)="onClosed()"
      (backdropClicked)="onBackdropClicked()"
    >
      <button trigger id="trigger-btn">Toggle</button>
      <div content class="menu-panel">
        <button class="menu-item">Item 1</button>
      </div>
    </ptah-native-dropdown>
  `,
})
class HostComponent {
  isOpen = signal(false);
  placement = signal<Placement>('bottom-start');
  offsetValue = signal(8);
  hasBackdrop = signal(true);
  backdropClass = signal<'transparent' | 'dark'>('transparent');
  closeOnBackdropClick = signal(true);

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

describe('NativeDropdownComponent', () => {
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

  const flushMicrotasks = () =>
    new Promise((r) => queueMicrotask(() => r(null)));

  /** The open microtask plus the bounded positioning race's promise hops. */
  const flushAll = async () => {
    await flushMicrotasks();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  const panel = () =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '.dropdown-panel',
    ) as HTMLElement;

  it('should create', () => {
    expect(host).toBeTruthy();
  });

  it('should always render the trigger content', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#trigger-btn')).toBeTruthy();
  });

  it('should NOT render panel or backdrop when isOpen is false', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.menu-panel')).toBeFalsy();
    expect(compiled.querySelector('[role="presentation"]')).toBeFalsy();
  });

  it('should render panel and backdrop when isOpen is true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.dropdown-panel')).toBeTruthy();
    expect(compiled.querySelector('[role="presentation"]')).toBeTruthy();
    expect(compiled.querySelector('.menu-panel')).toBeTruthy();
  });

  it('should give the panel role="listbox" by default', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '.dropdown-panel',
    );
    expect(panel?.getAttribute('role')).toBe('listbox');
  });

  it('should NOT render backdrop when hasBackdrop is false', () => {
    host.hasBackdrop.set(false);
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="presentation"]')).toBeFalsy();
    expect(compiled.querySelector('.dropdown-panel')).toBeTruthy();
  });

  it('should apply dark backdrop class when backdropClass is "dark"', () => {
    host.backdropClass.set('dark');
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop?.classList.contains('bg-black/20')).toBe(true);
  });

  it('should emit backdropClicked AND closed when backdrop clicked with closeOnBackdropClick=true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    backdrop.click();

    expect(host.backdropClickedCount).toBe(1);
    expect(host.closedCount).toBe(1);
  });

  it('should emit only backdropClicked when closeOnBackdropClick=false', () => {
    host.closeOnBackdropClick.set(false);
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    backdrop.click();

    expect(host.backdropClickedCount).toBe(1);
    expect(host.closedCount).toBe(0);
  });

  it('should emit opened event after positioning completes', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    // Wait for microtask + async positioning
    await flushAll();

    expect(host.openedCount).toBe(1);
  });

  it('should invoke computePosition from Floating UI when opened', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    await flushMicrotasks();
    await Promise.resolve();

    expect(mockedCompute).toHaveBeenCalled();
  });

  describe('top-layer shell', () => {
    const proto = HTMLElement.prototype;

    function installPopoverApi(
      show: (this: HTMLElement) => void,
      hide: (this: HTMLElement) => void,
    ): () => void {
      const previous = {
        show: Object.getOwnPropertyDescriptor(proto, 'showPopover'),
        hide: Object.getOwnPropertyDescriptor(proto, 'hidePopover'),
      };
      Object.defineProperty(proto, 'showPopover', { configurable: true, value: show });
      Object.defineProperty(proto, 'hidePopover', { configurable: true, value: hide });
      return () => {
        if (previous.show) Object.defineProperty(proto, 'showPopover', previous.show);
        else Reflect.deleteProperty(proto, 'showPopover');
        if (previous.hide) Object.defineProperty(proto, 'hidePopover', previous.hide);
        else Reflect.deleteProperty(proto, 'hidePopover');
      };
    }

    it('wraps backdrop and panel in a manual popover shell only while open', () => {
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[popover]')).toBeNull();
      host.isOpen.set(true);
      fixture.detectChanges();
      const shell = root.querySelector('[popover="manual"]');
      expect(shell).not.toBeNull();
      expect(shell?.querySelector('.dropdown-panel')).not.toBeNull();
      expect(shell?.querySelector('[role="presentation"]')).not.toBeNull();
    });

    const shell = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[popover="manual"]',
      ) as HTMLElement;

    it('promotes the shell before positioning and hides it on close', async () => {
      const order: string[] = [];
      const shown: HTMLElement[] = [];
      const hidden: HTMLElement[] = [];
      mockedCompute.mockImplementationOnce(async () => {
        order.push('compute');
        return { x: 0, y: 0 };
      });
      const restore = installPopoverApi(
        function (this: HTMLElement) {
          order.push('show');
          shown.push(this);
        },
        function (this: HTMLElement) {
          hidden.push(this);
        },
      );
      try {
        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();
        expect(order).toEqual(['show', 'compute']);
        expect(shown).toHaveLength(1);
        expect(shown[0].getAttribute('popover')).toBe('manual');
        // Promoted: no in-page display override.
        expect(shown[0].style.display).toBe('');

        host.isOpen.set(false);
        fixture.detectChanges();
        expect(hidden).toEqual(shown);
      } finally {
        restore();
      }
    });

    it('keeps the shell visible in place and positions when the Popover API is missing', async () => {
      const previous = Object.getOwnPropertyDescriptor(proto, 'showPopover');
      Reflect.deleteProperty(proto, 'showPopover');
      try {
        expect(typeof proto.showPopover).not.toBe('function');
        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();
        expect(shell().style.display).toBe('block');
        expect(mockedCompute).toHaveBeenCalled();
        expect(panel().style.visibility).toBe('visible');
      } finally {
        if (previous) Object.defineProperty(proto, 'showPopover', previous);
      }
    });

    it('keeps the shell visible in place when showPopover throws', async () => {
      const restore = installPopoverApi(
        () => {
          throw new DOMException('not connected', 'InvalidStateError');
        },
        () => undefined,
      );
      try {
        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();
        expect(shell().style.display).toBe('block');
        expect(panel().style.visibility).toBe('visible');
        expect(host.openedCount).toBe(1);
      } finally {
        restore();
      }
    });
  });

  describe('initial positioning failure and cancellation', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    it('reveals the panel under the trigger when positioning rejects', async () => {
      mockedCompute.mockRejectedValueOnce(new Error('compute failed'));
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();

      expect(panel().style.visibility).toBe('visible');
      // Only the fallback writes top/left; the service writes them after a compute.
      expect(panel().style.top).toBe('0px');
      expect(panel().style.left).toBe('0px');
      expect(host.openedCount).toBe(1);
    });

    it('reveals the panel under the trigger once positioning overruns its bound', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
      try {
        mockedCompute.mockReturnValueOnce(new Promise(() => undefined));
        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();

        expect(panel().style.visibility).toBe('hidden');
        expect(host.openedCount).toBe(0);

        jest.advanceTimersByTime(DROPDOWN_POSITION_TIMEOUT_MS);
        await flushAll();

        expect(panel().style.visibility).toBe('visible');
        expect(host.openedCount).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not emit opened when closed before positioning resolves', async () => {
      let resolvePosition: (value: { x: number; y: number }) => void = () =>
        undefined;
      mockedCompute.mockReturnValueOnce(
        new Promise((resolve) => (resolvePosition = resolve)),
      );
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();
      expect(mockedCompute).toHaveBeenCalledTimes(1);

      host.isOpen.set(false);
      fixture.detectChanges();
      resolvePosition({ x: 0, y: 0 });
      await settle();

      expect(host.openedCount).toBe(0);
    });

    it('emits opened once for a reopen while the first position is pending', async () => {
      let resolveFirst: (value: { x: number; y: number }) => void = () =>
        undefined;
      mockedCompute.mockReturnValueOnce(
        new Promise((resolve) => (resolveFirst = resolve)),
      );
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();

      host.isOpen.set(false);
      fixture.detectChanges();
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();
      expect(host.openedCount).toBe(1);

      resolveFirst({ x: 0, y: 0 });
      await settle();
      expect(host.openedCount).toBe(1);
    });

    it('does not emit opened when destroyed before positioning resolves', async () => {
      let resolvePosition: (value: { x: number; y: number }) => void = () =>
        undefined;
      mockedCompute.mockReturnValueOnce(
        new Promise((resolve) => (resolvePosition = resolve)),
      );
      host.isOpen.set(true);
      fixture.detectChanges();
      await flushAll();

      fixture.destroy();
      resolvePosition({ x: 0, y: 0 });
      await settle();

      expect(host.openedCount).toBe(0);
    });

    it('clears the positioning bound on close and destroy', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
      try {
        mockedCompute
          .mockReturnValueOnce(new Promise(() => undefined))
          .mockReturnValueOnce(new Promise(() => undefined));
        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();
        expect(jest.getTimerCount()).toBe(1);

        host.isOpen.set(false);
        fixture.detectChanges();
        expect(jest.getTimerCount()).toBe(0);

        host.isOpen.set(true);
        fixture.detectChanges();
        await flushAll();
        expect(jest.getTimerCount()).toBe(1);

        fixture.destroy();
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('document click outside (no backdrop)', () => {
    beforeEach(() => {
      host.hasBackdrop.set(false);
      host.isOpen.set(true);
      fixture.detectChanges();
    });

    it('should emit closed when clicking outside trigger and panel', () => {
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);

      outsideEl.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(1);
      outsideEl.remove();
    });

    it('should NOT emit closed when clicking inside panel', () => {
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '.menu-panel',
      ) as HTMLElement;

      panel.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(0);
    });

    it('should NOT emit closed when clicking trigger', () => {
      const trigger = (fixture.nativeElement as HTMLElement).querySelector(
        '#trigger-btn',
      ) as HTMLElement;

      trigger.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(0);
    });
  });

  it('should not trigger document-click close when isOpen is false', () => {
    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    outsideEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(host.closedCount).toBe(0);
    outsideEl.remove();
  });
});
