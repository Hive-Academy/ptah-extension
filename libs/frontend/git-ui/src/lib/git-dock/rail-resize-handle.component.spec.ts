import { TestBed } from '@angular/core/testing';
import { RailResizeHandleComponent } from './rail-resize-handle.component';

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  const event = new MouseEvent(type, init) as PointerEvent;
  Object.defineProperty(event, 'pointerId', {
    value: init.pointerId ?? 1,
  });
  return event;
}

describe('RailResizeHandleComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RailResizeHandleComponent] });
  });

  afterEach(() => TestBed.resetTestingModule());

  function mount(width = 256) {
    const fixture = TestBed.createComponent(RailResizeHandleComponent);
    fixture.componentRef.setInput('width', width);
    fixture.componentRef.setInput('min', 160);
    fixture.componentRef.setInput('max', 480);
    fixture.detectChanges();
    const separator = fixture.nativeElement.querySelector(
      '[role="separator"]',
    ) as HTMLElement;
    return { fixture, separator };
  }

  it('exposes the accessible value contract', () => {
    const { separator } = mount();
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuenow')).toBe('256');
    expect(separator.getAttribute('aria-valuemin')).toBe('160');
    expect(separator.getAttribute('aria-valuemax')).toBe('480');
    expect(separator.tabIndex).toBe(0);
  });

  it('clamps pointer movement and commits on pointerup', () => {
    const { fixture, separator } = mount();
    const widths: number[] = [];
    let commits = 0;
    fixture.componentInstance.widthChange.subscribe((width) =>
      widths.push(width),
    );
    fixture.componentInstance.widthCommit.subscribe(() => commits++);
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, clientX: 100 }),
    );
    document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 1, clientX: 900 }),
    );
    document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 1, clientX: 900 }),
    );
    expect(widths.at(-1)).toBe(480);
    expect(commits).toBe(1);
  });

  it('ignores a second pointer and tolerates pointer-capture failure', () => {
    const { fixture, separator } = mount(256);
    const widths: number[] = [];
    fixture.componentInstance.widthChange.subscribe((width) =>
      widths.push(width),
    );
    Object.defineProperty(separator, 'setPointerCapture', {
      configurable: true,
      value: () => {
        throw new Error('capture unavailable');
      },
    });

    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, clientX: 100 }),
    );
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 2, clientX: 400 }),
    );
    document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 1, clientX: 116 }),
    );

    expect(widths.at(-1)).toBe(272);
  });

  it('ignores a second pointer and tolerates pointer-capture failure', () => {
    const { fixture, separator } = mount(256);
    const widths: number[] = [];
    fixture.componentInstance.widthChange.subscribe((width) =>
      widths.push(width),
    );
    Object.defineProperty(separator, 'setPointerCapture', {
      configurable: true,
      value: jest.fn(() => {
        throw new Error('capture unavailable');
      }),
    });
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, clientX: 100 }),
    );
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 2, clientX: 300 }),
    );
    document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 1, clientX: 116 }),
    );
    expect(widths.at(-1)).toBe(272);
  });

  it.each([
    [
      'Escape',
      () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ],
    ['blur', () => window.dispatchEvent(new Event('blur'))],
    [
      'pointercancel',
      () =>
        document.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 })),
    ],
    [
      'lostpointercapture',
      (separator: HTMLElement) =>
        separator.dispatchEvent(
          pointerEvent('lostpointercapture', { pointerId: 1 }),
        ),
    ],
  ])('restores the starting width on %s', (_name, cancel) => {
    const { fixture, separator } = mount(240);
    const widths: number[] = [];
    fixture.componentInstance.widthChange.subscribe((width) =>
      widths.push(width),
    );
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, clientX: 100 }),
    );
    cancel(separator);
    expect(widths.at(-1)).toBe(240);
  });

  it.each([
    ['ArrowLeft', 240],
    ['ArrowRight', 272],
    ['Home', 160],
    ['End', 480],
  ])('handles %s and commits', (key, expected) => {
    const { fixture, separator } = mount();
    const widths: number[] = [];
    let commits = 0;
    fixture.componentInstance.widthChange.subscribe((width) =>
      widths.push(width),
    );
    fixture.componentInstance.widthCommit.subscribe(() => commits++);
    separator.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
    expect(widths).toEqual([expected]);
    expect(commits).toBe(1);
  });

  it('removes drag listeners on destroy', () => {
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    const removeWindow = jest.spyOn(window, 'removeEventListener');
    const { fixture, separator } = mount();
    separator.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, clientX: 100 }),
    );
    fixture.destroy();
    expect(removeDocument).toHaveBeenCalledWith(
      'pointermove',
      expect.any(Function),
    );
    expect(removeDocument).toHaveBeenCalledWith(
      'pointerup',
      expect.any(Function),
    );
    expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
    removeDocument.mockRestore();
    removeWindow.mockRestore();
  });
});
