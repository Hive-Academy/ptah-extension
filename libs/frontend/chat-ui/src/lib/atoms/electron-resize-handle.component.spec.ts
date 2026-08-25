import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ElectronResizeHandleComponent } from './electron-resize-handle.component';

describe('ElectronResizeHandleComponent', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let rafSpy: jest.SpyInstance;

  function tickFrame(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(performance.now());
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

    await TestBed.configureTestingModule({
      imports: [ElectronResizeHandleComponent],
    }).compileComponents();
  });

  afterEach(() => {
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('creates with default direction "left"', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.direction()).toBe('left');
    expect(
      fixture.nativeElement.querySelector('.resize-handle'),
    ).not.toBeNull();
  });

  it('emits dragStarted/dragMoved/dragEnded across a mouse interaction (left)', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.componentRef.setInput('direction', 'left');
    fixture.detectChanges();

    const events: { started: number; moved: number[]; ended: number } = {
      started: 0,
      moved: [],
      ended: 0,
    };
    fixture.componentInstance.dragStarted.subscribe(() => events.started++);
    fixture.componentInstance.dragMoved.subscribe((w) => events.moved.push(w));
    fixture.componentInstance.dragEnded.subscribe(() => events.ended++);

    const handle = fixture.nativeElement.querySelector(
      '.resize-handle',
    ) as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(events.started).toBe(1);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));
    tickFrame();
    expect(events.moved).toContain(250);

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(events.ended).toBe(1);
  });

  it('inverts width calculation when direction is "right"', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.componentRef.setInput('direction', 'right');
    fixture.detectChanges();

    let lastWidth = -1;
    fixture.componentInstance.dragMoved.subscribe((w) => (lastWidth = w));

    fixture.nativeElement
      .querySelector('.resize-handle')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
    tickFrame();
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(lastWidth).toBe(window.innerWidth - 100);
  });

  it('cleans up listeners on destroy', () => {
    const fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// TASK_2026_176 — drag coalescing + blur/Escape teardown
//
// The move listener used to re-enter the Angular zone once per native
// mousemove, forcing a change-detection pass and layout write per event. It
// now records only the latest event and arms a single requestAnimationFrame,
// so at most one emit lands per frame. mouseup cancels the pending frame and
// still applies the release position; window blur and Escape restore the
// original width and tear everything down.
// -----------------------------------------------------------------------------
describe('ElectronResizeHandleComponent — drag coalescing and teardown (TASK_2026_176)', () => {
  let fixture: ComponentFixture<ElectronResizeHandleComponent>;
  let component: ElectronResizeHandleComponent;
  let handle: HTMLElement;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;

  function tickFrame(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(performance.now());
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

    await TestBed.configureTestingModule({
      imports: [ElectronResizeHandleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ElectronResizeHandleComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('direction', 'left');
    fixture.detectChanges();
    handle = fixture.nativeElement.querySelector(
      '.resize-handle',
    ) as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('arms exactly one frame for a burst of mousemove events and emits only the latest width', () => {
    const moved: number[] = [];
    component.dragMoved.subscribe((w) => moved.push(w));

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, bubbles: true }),
    );
    rafSpy.mockClear();
    frames.clear();

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 220 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 280 }));

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(moved).toEqual([]);

    tickFrame();
    expect(moved).toEqual([280]);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }));
    expect(rafSpy).toHaveBeenCalledTimes(2);

    tickFrame();
    expect(moved).toEqual([280, 320]);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('cancels the pending frame on mouseup and still applies the release width', () => {
    const moved: number[] = [];
    component.dragMoved.subscribe((w) => moved.push(w));

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 290 }));
    expect(frames.size).toBe(1);

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(moved).toEqual([290]);

    // A move after release must not re-arm a frame.
    rafSpy.mockClear();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
    expect(rafSpy).not.toHaveBeenCalled();
    expect(moved).toEqual([290]);
  });

  it('restores the original width and emits dragEnded on window blur', () => {
    const moved: number[] = [];
    let ended = 0;
    component.dragMoved.subscribe((w) => moved.push(w));
    component.dragEnded.subscribe(() => ended++);

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));

    window.dispatchEvent(new Event('blur'));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(moved).toContain(200);
    expect(ended).toBe(1);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('restores the original width and emits dragEnded on Escape', () => {
    const moved: number[] = [];
    let ended = 0;
    component.dragMoved.subscribe((w) => moved.push(w));
    component.dragEnded.subscribe(() => ended++);

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(frames.size).toBe(0);
    expect(moved).toContain(200);
    expect(ended).toBe(1);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('cancels a pending frame on destroy so no update lands after teardown', () => {
    const moved: number[] = [];
    component.dragMoved.subscribe((w) => moved.push(w));

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 200, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
    expect(frames.size).toBe(1);

    fixture.destroy();

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(moved).toEqual([]);
  });
});
