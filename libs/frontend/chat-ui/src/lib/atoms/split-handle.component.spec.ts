import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SplitHandleComponent,
  type SplitHandleAppearance,
  type SplitHandleOrientation,
} from './split-handle.component';

@Component({
  selector: 'ptah-split-handle-host',
  standalone: true,
  imports: [SplitHandleComponent],
  template: `
    @if (shown()) {
      <ptah-split-handle
        [orientation]="orientation()"
        [size]="size()"
        [min]="min"
        [max]="max"
        [label]="'Resize session details'"
        [inverted]="inverted()"
        [appearance]="appearance()"
        (sizeChange)="onSizeChange($event)"
        (sizeCommit)="log.push('commit')"
        (sizeCancel)="log.push('cancel')"
        (sizeReset)="log.push('reset')"
        (draggingChange)="log.push('dragging:' + $event)"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly shown = signal(true);
  readonly orientation: WritableSignal<SplitHandleOrientation> =
    signal('vertical');
  readonly size = signal(400);
  readonly inverted = signal(false);
  readonly appearance: WritableSignal<SplitHandleAppearance> = signal('line');
  readonly min = 300;
  readonly max = 560;
  readonly log: string[] = [];

  onSizeChange(value: number): void {
    this.log.push(`size:${value}`);
    this.size.set(value);
  }
}

function pointerEvent(
  type: string,
  init: { clientX?: number; clientY?: number; pointerId?: number } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  return event as PointerEvent;
}

describe('SplitHandleComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;
  const setCapture = jest.fn();
  const releaseCapture = jest.fn();

  function tickFrame(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(performance.now());
  }

  function separator(): HTMLElement {
    return fixture.nativeElement.querySelector(
      '[role="separator"]',
    ) as HTMLElement;
  }

  function handleHost(): HTMLElement {
    return fixture.nativeElement.querySelector(
      'ptah-split-handle',
    ) as HTMLElement;
  }

  function render(): void {
    fixture.detectChanges();
  }

  function startDrag(clientX = 100): void {
    separator().dispatchEvent(pointerEvent('pointerdown', { clientX }));
  }

  function moveTo(clientX: number): void {
    document.dispatchEvent(pointerEvent('pointermove', { clientX }));
    tickFrame();
  }

  function key(name: string, shiftKey = false): KeyboardEvent {
    render(); // bind the size the previous step emitted
    const event = new KeyboardEvent('keydown', {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    separator().dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    frames = new Map();
    nextFrameId = 1;
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, cb);
        return id;
      });
    cafSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        frames.delete(id);
      });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: setCapture,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: releaseCapture,
      configurable: true,
      writable: true,
    });

    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    render();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>)
      .releasePointerCapture;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    jest.clearAllMocks();
  });

  describe('accessibility', () => {
    it('exposes separator semantics and the current value', () => {
      const sep = separator();
      expect(sep.getAttribute('tabindex')).toBe('0');
      expect(sep.getAttribute('aria-orientation')).toBe('vertical');
      expect(sep.getAttribute('aria-label')).toBe('Resize session details');
      expect(sep.getAttribute('aria-valuenow')).toBe('400');
      expect(sep.getAttribute('aria-valuemin')).toBe('300');
      expect(sep.getAttribute('aria-valuemax')).toBe('560');
    });

    it('rounds aria-valuenow', () => {
      host.size.set(401.6);
      render();
      expect(separator().getAttribute('aria-valuenow')).toBe('402');
    });
  });

  describe('pointer drag', () => {
    it('grows the pane before the handle by the drag distance', () => {
      startDrag(100);
      moveTo(140);
      expect(host.log).toContain('size:440');
    });

    it('shrinks the pane after the handle when inverted', () => {
      host.inverted.set(true);
      render();
      startDrag(100);
      moveTo(140);
      expect(host.log).toContain('size:360');
    });

    it('emits at most one sizeChange per animation frame', () => {
      startDrag(100);
      document.dispatchEvent(pointerEvent('pointermove', { clientX: 110 }));
      document.dispatchEvent(pointerEvent('pointermove', { clientX: 120 }));
      document.dispatchEvent(pointerEvent('pointermove', { clientX: 130 }));
      tickFrame();
      expect(host.log.filter((e) => e.startsWith('size:'))).toEqual([
        'size:430',
      ]);
    });

    it('clamps the dragged size to min and max', () => {
      startDrag(100);
      moveTo(1000);
      expect(host.log).toContain('size:560');
      moveTo(-1000);
      expect(host.log).toContain('size:300');
    });

    it('commits on pointerup without cancelling', () => {
      startDrag(100);
      moveTo(120);
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 130 }));
      expect(host.log).toEqual([
        'dragging:true',
        'size:420',
        'size:430',
        'dragging:false',
        'commit',
      ]);
    });

    it('ignores events from another pointer', () => {
      startDrag(100);
      document.dispatchEvent(
        pointerEvent('pointermove', { clientX: 200, pointerId: 2 }),
      );
      tickFrame();
      document.dispatchEvent(
        pointerEvent('pointerup', { clientX: 200, pointerId: 2 }),
      );
      expect(host.log).toEqual(['dragging:true']);
    });

    it('sets and restores the body cursor and user-select', () => {
      startDrag(100);
      expect(document.body.style.cursor).toBe('col-resize');
      expect(document.body.style.userSelect).toBe('none');
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 100 }));
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
    });

    it('uses the row-resize cursor for a horizontal handle', () => {
      host.orientation.set('horizontal');
      render();
      separator().dispatchEvent(pointerEvent('pointerdown', { clientY: 50 }));
      expect(document.body.style.cursor).toBe('row-resize');
      document.dispatchEvent(pointerEvent('pointermove', { clientY: 70 }));
      tickFrame();
      expect(host.log).toContain('size:420');
    });

    it('captures and releases the pointer', () => {
      startDrag(100);
      expect(setCapture).toHaveBeenCalledWith(1);
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 100 }));
      expect(releaseCapture).toHaveBeenCalledWith(1);
    });

    it('removes document listeners after the drag ends', () => {
      startDrag(100);
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 100 }));
      host.log.length = 0;
      moveTo(200);
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 200 }));
      expect(host.log).toEqual([]);
    });
  });

  describe('cancel', () => {
    it('Escape restores the start size, then emits sizeCancel and no commit', () => {
      startDrag(100);
      moveTo(150);
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(host.log).toEqual([
        'dragging:true',
        'size:450',
        'size:400',
        'dragging:false',
        'cancel',
      ]);
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
    });

    it('window blur cancels the drag', () => {
      startDrag(100);
      moveTo(130);
      window.dispatchEvent(new Event('blur'));
      expect(host.log.slice(-3)).toEqual([
        'size:400',
        'dragging:false',
        'cancel',
      ]);
      expect(host.log).not.toContain('commit');
    });

    it('pointercancel and lost capture cancel the drag', () => {
      startDrag(100);
      document.dispatchEvent(pointerEvent('pointercancel'));
      expect(host.log).toContain('cancel');

      host.log.length = 0;
      startDrag(100);
      separator().dispatchEvent(pointerEvent('lostpointercapture'));
      expect(host.log).toEqual([
        'dragging:true',
        'size:400',
        'dragging:false',
        'cancel',
      ]);
    });

    it('Escape outside a drag does nothing', () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(host.log).toEqual([]);
    });
  });

  describe('keyboard', () => {
    it('steps by 16 and commits, without cancelling', () => {
      const event = key('ArrowRight');
      expect(event.defaultPrevented).toBe(true);
      key('ArrowLeft');
      expect(host.log).toEqual(['size:416', 'commit', 'size:400', 'commit']);
    });

    it('swaps the arrow keys when inverted', () => {
      host.inverted.set(true);
      render();
      key('ArrowLeft');
      expect(host.log).toEqual(['size:416', 'commit']);
      key('ArrowRight');
      expect(host.log.slice(-2)).toEqual(['size:400', 'commit']);
    });

    it('Shift triples the step for every consumer', () => {
      host.inverted.set(true);
      render();
      key('ArrowLeft', true);
      expect(host.log).toEqual(['size:448', 'commit']);

      host.inverted.set(false);
      render();
      key('ArrowRight', true);
      expect(host.log.slice(-2)).toEqual(['size:496', 'commit']);
    });

    it('uses ArrowUp/ArrowDown for a horizontal handle', () => {
      host.orientation.set('horizontal');
      render();
      key('ArrowDown');
      expect(host.log).toEqual(['size:416', 'commit']);
      key('ArrowRight');
      expect(host.log).toEqual(['size:416', 'commit']);
    });

    it('Home and End jump to min and max, even when inverted', () => {
      host.inverted.set(true);
      render();
      key('Home');
      key('End');
      expect(host.log).toEqual(['size:300', 'commit', 'size:560', 'commit']);
    });

    it('clamps key steps', () => {
      host.size.set(550);
      render();
      key('ArrowRight', true);
      expect(host.log).toEqual(['size:560', 'commit']);
    });

    it('ignores unrelated keys', () => {
      const event = key('a');
      expect(event.defaultPrevented).toBe(false);
      expect(host.log).toEqual([]);
    });
  });

  it('double-click emits sizeReset', () => {
    separator().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.log).toEqual(['reset']);
  });

  describe('appearance', () => {
    it('keeps the default line markup and host size classes', () => {
      // Today's rendering: Angular reads the host key `class.w-1.5` as the
      // class `w-1` (it stops at the dot). Pinned so `line` stays unchanged.
      const el = handleHost();
      expect([...el.classList]).toEqual(['block', 'shrink-0', 'w-1', 'h-full']);
      expect(separator().className).toBe(
        'group flex h-full w-full touch-none items-center justify-center outline-none focus-visible:bg-primary/20 cursor-col-resize',
      );
      const line = separator().firstElementChild as HTMLElement;
      expect(line.className).toBe(
        'rounded-full bg-base-content/15 transition-colors group-hover:bg-primary/60 group-active:bg-primary h-full w-px',
      );
      expect(separator().children).toHaveLength(1);
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="split-handle-grip"]',
        ),
      ).toBeNull();
    });

    it('keeps the line host height class for a horizontal handle', () => {
      host.orientation.set('horizontal');
      render();
      expect([...handleHost().classList]).toEqual([
        'block',
        'shrink-0',
        'h-1',
        'w-full',
      ]);
    });

    it('renders the grip, line and a hidden readout without host size classes', () => {
      host.appearance.set('grip');
      host.inverted.set(true);
      render();
      const el = handleHost();
      expect([...el.classList]).toEqual(['block', 'shrink-0', 'h-full']);

      const sep = separator();
      expect(sep.classList).toContain('focus-visible:outline-base-content');
      expect(sep.classList).toContain('focus-visible:-outline-offset-1');
      expect(sep.classList).toContain('focus-visible:bg-base-content/[0.08]');
      expect(sep.classList).toContain('cursor-col-resize');
      expect(sep.getAttribute('role')).toBe('separator');
      expect(sep.getAttribute('aria-valuenow')).toBe('400');

      const grip = el.querySelector(
        '[data-testid="split-handle-grip"]',
      ) as HTMLElement;
      expect(grip.classList).toContain('w-1');
      expect(grip.classList).toContain('h-8');
      expect(grip.classList).toContain('bg-base-content/60');

      const line = el.querySelector(
        '[data-testid="split-handle-line"]',
      ) as HTMLElement;
      expect(line.classList).toContain('left-0');
      expect(line.classList).toContain('bg-base-content/15');

      const readout = el.querySelector(
        '[data-testid="split-handle-readout"]',
      ) as HTMLElement;
      expect(readout.getAttribute('aria-hidden')).toBe('true');
      expect(readout.textContent?.trim()).toBe('400 px');
      expect(readout.classList).toContain('hidden');
      expect(readout.classList).toContain('group-focus-visible:block');
      expect(readout.classList).toContain('tabular-nums');
    });

    it('shows the dragging state in grip mode', () => {
      host.appearance.set('grip');
      render();
      startDrag(100);
      moveTo(140);
      render();

      const el = handleHost();
      const grip = el.querySelector(
        '[data-testid="split-handle-grip"]',
      ) as HTMLElement;
      const readout = el.querySelector(
        '[data-testid="split-handle-readout"]',
      ) as HTMLElement;
      expect(separator().classList).toContain('bg-primary/20');
      expect(grip.classList).toContain('bg-base-content');
      expect(grip.classList).not.toContain('bg-base-content/60');
      expect(readout.classList).toContain('block');
      expect(readout.classList).not.toContain('hidden');
      expect(readout.textContent?.trim()).toBe('440 px');

      document.dispatchEvent(pointerEvent('pointerup', { clientX: 140 }));
      render();
      expect(grip.classList).toContain('bg-base-content/60');
      expect(readout.classList).toContain('hidden');
    });
  });

  describe('destroy mid-drag (R1)', () => {
    it('restores body styles, releases listeners and emits nothing', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
        // Captured for the assertion below.
      });
      try {
        startDrag(100);
        moveTo(130);
        host.log.length = 0;

        host.shown.set(false);
        render();

        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
        expect(releaseCapture).toHaveBeenCalledWith(1);
        expect(host.log).toEqual([]);
        expect(warn).not.toHaveBeenCalled();

        moveTo(200);
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 200 }));
        window.dispatchEvent(new Event('blur'));
        expect(host.log).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('does not touch body styles when destroyed outside a drag', () => {
      document.body.style.cursor = 'wait';
      host.shown.set(false);
      render();
      expect(document.body.style.cursor).toBe('wait');
    });
  });
});
