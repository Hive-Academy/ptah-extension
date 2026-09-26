import { Component, signal } from '@angular/core';

jest.mock('ngx-markdown', () => {
  class MarkdownModule {}
  class MarkdownComponent {}
  class MarkdownService {}
  return {
    MarkdownModule,
    MarkdownComponent,
    MarkdownService,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ElectronResizeHandleComponent } from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  ElectronLayoutService,
  VSCodeService,
} from '@ptah-extension/core';
import { AppsSessionService } from '../services/apps-session.service';
import {
  APPS_PAGE_STYLES,
  APPS_STACK_BELOW_WIDTH,
  AppsPageComponent,
} from './apps-page.component';
import { AppsSurfacePanelComponent } from './apps-surface-panel.component';
import { AppsTranscriptComponent } from './apps-transcript.component';

/**
 * Batch 20 splitter pins, kept apart from `apps-page.component.spec.ts`
 * (at its size limit). The page is mounted with a stub session and stub
 * children; `ElectronLayoutService` is the real one, so set/commit/persist
 * run for real against a `VSCodeService.setState` spy.
 */

@Component({ selector: 'ptah-apps-transcript', standalone: true, template: '' })
class StubTranscriptComponent {}

@Component({
  selector: 'ptah-apps-surface-panel',
  standalone: true,
  template: '',
})
class StubSurfacePanelComponent {}

/** A ResizeObserver the test drives by hand. */
class FakeResizeObserver {
  public static instances: FakeResizeObserver[] = [];
  public observed: Element[] = [];
  public disconnected = false;
  public constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  public observe(target: Element): void {
    this.observed.push(target);
  }
  public unobserve(): void {
    /* not used by the page */
  }
  public disconnect(): void {
    this.disconnected = true;
  }
  public resize(width: number): void {
    this.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const LEFT = 200;
const LAYOUT_KEY = 'electron-layout';

describe('AppsPageComponent — splitter (B20)', () => {
  let fixture: ComponentFixture<AppsPageComponent>;
  let layout: ElectronLayoutService;
  let setState: jest.Mock;
  let frames: FrameRequestCallback[];
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
    frames = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      /* frames are flushed by hand */
    });
    setState = jest.fn();
    TestBed.configureTestingModule({
      imports: [AppsPageComponent],
      providers: [
        {
          provide: VSCodeService,
          useValue: { isElectron: false, setState, getState: jest.fn() },
        },
        { provide: AppStateManager, useValue: {} },
        { provide: ClaudeRpcService, useValue: {} },
        {
          provide: AppsSessionService,
          useValue: {
            isActive: signal(false),
            isProcessing: signal(false),
            error: signal(null),
            notice: signal(null),
            lastFocusKey: signal(null),
            recordFocusKey: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(AppsPageComponent, {
      remove: { imports: [AppsTranscriptComponent, AppsSurfacePanelComponent] },
      add: { imports: [StubTranscriptComponent, StubSurfacePanelComponent] },
    });
    layout = TestBed.inject(ElectronLayoutService);
  });

  afterEach(() => {
    const element = fixture?.nativeElement as HTMLElement | undefined;
    fixture?.destroy();
    element?.remove();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      originalResizeObserver;
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function mount(containerWidth: number | null = 1400): HTMLElement {
    fixture = TestBed.createComponent(AppsPageComponent);
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: LEFT,
      top: 0,
      right: LEFT + (containerWidth ?? 0),
      bottom: 800,
      width: containerWidth ?? 0,
      height: 800,
      x: LEFT,
      y: 0,
      toJSON: () => ({}),
    });
    fixture.detectChanges();
    if (containerWidth !== null) resize(containerWidth);
    return element;
  }

  function resize(width: number): void {
    const observer = FakeResizeObserver.instances.at(-1);
    if (!observer) throw new Error('page did not observe its host');
    observer.resize(width);
    fixture.detectChanges();
  }

  function separator(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="apps-split-handle-slot"]',
    );
  }

  function must<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('missing');
    return value;
  }

  function grip(): HTMLElement {
    return must(separator()?.querySelector<HTMLElement>('.resize-handle'));
  }

  function press(clientX: number): void {
    grip().dispatchEvent(
      new MouseEvent('mousedown', { clientX, bubbles: true, cancelable: true }),
    );
  }

  function moveTo(clientX: number): void {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX }));
    const pending = frames;
    frames = [];
    for (const frame of pending) frame(0);
    fixture.detectChanges();
  }

  function release(): void {
    document.dispatchEvent(new MouseEvent('mouseup'));
    fixture.detectChanges();
  }

  function escape(): void {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    );
    fixture.detectChanges();
  }

  function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): boolean {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    must(separator()).dispatchEvent(event);
    fixture.detectChanges();
    return event.defaultPrevented;
  }

  function layoutColumn(): string {
    const grid = must(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.apps-layout',
      ),
    );
    return grid.style.getPropertyValue('--apps-conversation-width');
  }

  it('renders a focusable, labelled vertical separator with its value range', () => {
    mount(1000);
    const handle = must(separator());
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe(
      'Resize the conversation column',
    );
    expect(handle.getAttribute('aria-controls')).toBe(
      'apps-conversation-column',
    );
    expect(handle.getAttribute('aria-keyshortcuts')).toBe(
      'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight',
    );
    expect(handle.getAttribute('aria-valuenow')).toBe('360');
    expect(handle.getAttribute('aria-valuemin')).toBe('240');
    // 1000 - 6 (handle) - 360 (surface floor)
    expect(handle.getAttribute('aria-valuemax')).toBe('634');
    expect(handle.querySelector('ptah-electron-resize-handle')).not.toBeNull();
    expect(layoutColumn()).toBe('360px');
  });

  it("subtracts the container's left edge and the grab point from the pointer X", () => {
    mount();
    // Grabbed 3px into the 6px handle, which starts at LEFT + 360.
    press(LEFT + 363);
    moveTo(LEFT + 503);
    expect(layout.appsSplitWidth()).toBe(500);
    expect(layoutColumn()).toBe('500px');
    expect(must(separator()).getAttribute('aria-valuenow')).toBe('500');
    release();
  });

  it('clamps drags to [240, container - 6 - 360] and ignores non-finite X', () => {
    mount(1000);
    press(LEFT + 360);
    moveTo(LEFT + 5000);
    expect(layout.appsSplitWidth()).toBe(634);
    moveTo(LEFT - 500);
    expect(layout.appsSplitWidth()).toBe(240);
    moveTo(LEFT + 400);
    const handle = fixture.debugElement.query(
      By.directive(ElectronResizeHandleComponent),
    ).componentInstance as ElectronResizeHandleComponent;
    handle.dragMoved.emit(Number.NaN);
    handle.dragMoved.emit(Number.POSITIVE_INFINITY);
    expect(layout.appsSplitWidth()).toBe(400);
    release();
  });

  it('persists on drag end only, never on a drag frame', () => {
    mount();
    press(LEFT + 360);
    moveTo(LEFT + 400);
    moveTo(LEFT + 450);
    moveTo(LEFT + 470);
    expect(setState).not.toHaveBeenCalled();
    release();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith(
      LAYOUT_KEY,
      expect.objectContaining({ appsSplitWidth: 470 }),
    );
  });

  it("keeps the handle's Escape restore exact and writes nothing", () => {
    mount();
    press(LEFT + 364);
    moveTo(LEFT + 604);
    expect(layout.appsSplitWidth()).toBe(600);
    escape();
    expect(layout.appsSplitWidth()).toBe(360);
    expect(layoutColumn()).toBe('360px');
    expect(setState).not.toHaveBeenCalled();
  });

  it('resizes with Left/Right (16px) and Shift (64px), persisting on key release', () => {
    mount();
    expect(key('keydown', { key: 'ArrowRight' })).toBe(true);
    expect(layout.appsSplitWidth()).toBe(376);
    expect(key('keydown', { key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(layout.appsSplitWidth()).toBe(440);
    expect(key('keydown', { key: 'ArrowLeft' })).toBe(true);
    expect(layout.appsSplitWidth()).toBe(424);
    expect(must(separator()).getAttribute('aria-valuenow')).toBe('424');
    expect(setState).not.toHaveBeenCalled();

    key('keyup', { key: 'ArrowLeft' });
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith(
      LAYOUT_KEY,
      expect.objectContaining({ appsSplitWidth: 424 }),
    );
  });

  it('clamps key resizes and leaves other keys alone', () => {
    mount(700); // max = 700 - 6 - 360 = 334; stored 360 is shown as 334
    key('keydown', { key: 'ArrowRight', shiftKey: true });
    // At the max nothing visibly moves, so the stored 360 is kept (fix 1).
    expect(must(separator()).getAttribute('aria-valuenow')).toBe('334');
    expect(layout.appsSplitWidth()).toBe(360);
    for (let i = 0; i < 10; i++)
      key('keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(layout.appsSplitWidth()).toBe(240);
    expect(key('keydown', { key: 'ArrowUp' })).toBe(false);
    expect(key('keydown', { key: 'Enter' })).toBe(false);
    expect(layout.appsSplitWidth()).toBe(240);
  });

  it('persists a pending key resize when focus leaves mid key-repeat', () => {
    mount();
    key('keydown', { key: 'ArrowRight', repeat: true });
    must(separator()).dispatchEvent(new FocusEvent('blur'));
    expect(setState).toHaveBeenCalledTimes(1);
    must(separator()).dispatchEvent(new FocusEvent('blur'));
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('lays out the restored service width, clamped to what the container fits', () => {
    layout.setAppsSplitWidth(900);
    mount(1400);
    expect(layoutColumn()).toBe('900px');
    resize(1000);
    expect(layoutColumn()).toBe('634px');
    expect(must(separator()).getAttribute('aria-valuenow')).toBe('634');
    // The window shrink does not rewrite the stored preference.
    expect(layout.appsSplitWidth()).toBe(900);
    expect(setState).not.toHaveBeenCalled();
  });

  /**
   * R10 visual review, Serious #2 and #3: the page stacks below 240 + 6 + 360
   * = 606px, and the container query is the only stacking decision. The
   * measured width must never add or remove the splitter (a DOM change one
   * ResizeObserver task behind the CSS was the torn frame).
   */
  it('stacks below 606px through the container query alone', () => {
    expect(APPS_STACK_BELOW_WIDTH).toBe(layout.appsSplitMinWidth + 6 + 360);
    expect(APPS_STACK_BELOW_WIDTH).toBe(606);
    const queries = APPS_PAGE_STYLES.match(/@container[^{]*/g) ?? [];
    expect(queries.map((query) => query.trim())).toEqual([
      '@container apps-page (width < 606px)',
    ]);
    expect(APPS_PAGE_STYLES).toMatch(
      /\(width < 606px\) \{[^@]*\.apps-split-handle-slot \{\s*display: none;/,
    );

    mount(1000);
    for (const width of [400, 605, 606, 480, 1000]) {
      resize(width);
      expect(separator()).not.toBeNull();
      expect(
        separator()?.querySelector('ptah-electron-resize-handle'),
      ).not.toBeNull();
    }
  });

  it('exposes exactly one separator to assistive technology (R10 moderate)', () => {
    mount(1000);
    const page = fixture.nativeElement as HTMLElement;
    const exposed = Array.from(
      page.querySelectorAll('[role="separator"]'),
    ).filter((node) => node.closest('[aria-hidden="true"]') === null);
    expect(exposed).toEqual([separator()]);
    const handle = must(page.querySelector('ptah-electron-resize-handle'));
    expect(handle.getAttribute('aria-hidden')).toBe('true');
    // Nothing focusable hides under aria-hidden; the grip stays draggable.
    expect(handle.querySelector('[tabindex], button, a, input')).toBeNull();
    expect(handle.querySelector('.resize-handle')).not.toBeNull();
  });

  it('observes its own host and disconnects on destroy', () => {
    const element = mount();
    const observer = must(FakeResizeObserver.instances.at(-1));
    expect(observer.observed).toEqual([element]);
    fixture.destroy();
    expect(observer.disconnected).toBe(true);
  });

  /**
   * Fix round 1 (code-logic S-1 / antigravity MOD-1, MOD-2, MIN-1, subagent
   * M-3). Interactions work from the DISPLAYED width; one that does not
   * visibly change it never overwrites the stored preference, and a gesture
   * that ends where it started writes nothing.
   */
  describe('stored preference wider than the container (900 shown as 334)', () => {
    function mountClamped(containerWidth = 700): void {
      layout.setAppsSplitWidth(900);
      mount(containerWidth);
    }

    it('ArrowRight at the max keeps the stored 900 and persists nothing', () => {
      mountClamped();
      expect(must(separator()).getAttribute('aria-valuenow')).toBe('334');
      expect(key('keydown', { key: 'ArrowRight' })).toBe(true);
      key('keydown', { key: 'ArrowRight', shiftKey: true });
      key('keyup', { key: 'ArrowRight' });
      must(separator()).dispatchEvent(new FocusEvent('blur'));
      expect(layout.appsSplitWidth()).toBe(900);
      expect(setState).not.toHaveBeenCalled();
      resize(1400);
      expect(layoutColumn()).toBe('900px');
    });

    it('ArrowLeft is a visible change: 334 -> 318 is set and persisted', () => {
      mountClamped();
      key('keydown', { key: 'ArrowLeft' });
      expect(layout.appsSplitWidth()).toBe(318);
      key('keyup', { key: 'ArrowLeft' });
      expect(setState).toHaveBeenCalledTimes(1);
      expect(setState).toHaveBeenCalledWith(
        LAYOUT_KEY,
        expect.objectContaining({ appsSplitWidth: 318 }),
      );
    });

    it('a drag with no visible change keeps the stored 900 and writes nothing', () => {
      mountClamped(1000); // shown as 634
      press(LEFT + 634);
      moveTo(LEFT + 5000); // clamps to 634: no visible change
      expect(layout.appsSplitWidth()).toBe(900);
      moveTo(LEFT + 500); // visible change...
      expect(layout.appsSplitWidth()).toBe(500);
      moveTo(LEFT + 634); // ...then back to the start: the preference returns
      expect(layout.appsSplitWidth()).toBe(900);
      release();
      expect(setState).not.toHaveBeenCalled();
    });

    it('a real drag sets and persists the new width once', () => {
      mountClamped(1000);
      press(LEFT + 634);
      moveTo(LEFT + 500);
      release();
      expect(layout.appsSplitWidth()).toBe(500);
      expect(setState).toHaveBeenCalledTimes(1);
      expect(setState).toHaveBeenCalledWith(
        LAYOUT_KEY,
        expect.objectContaining({ appsSplitWidth: 500 }),
      );
    });

    it('Escape after a visible drag restores the stored 900, not the shown 634', () => {
      mountClamped(1000);
      press(LEFT + 634);
      moveTo(LEFT + 500);
      escape();
      expect(layout.appsSplitWidth()).toBe(900);
      expect(setState).not.toHaveBeenCalled();
    });
  });

  describe('gesture end writes only a changed width', () => {
    it('a window blur cancel writes nothing', () => {
      mount();
      press(LEFT + 360);
      moveTo(LEFT + 480);
      window.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(layout.appsSplitWidth()).toBe(360);
      expect(setState).not.toHaveBeenCalled();
    });

    it('a plain click without movement writes nothing', () => {
      mount();
      press(LEFT + 362);
      release();
      expect(layout.appsSplitWidth()).toBe(360);
      expect(setState).not.toHaveBeenCalled();
    });

    it('a key run that ends where it started writes nothing', () => {
      mount();
      key('keydown', { key: 'ArrowRight' });
      key('keydown', { key: 'ArrowLeft' });
      key('keyup', { key: 'ArrowLeft' });
      expect(layout.appsSplitWidth()).toBe(360);
      expect(setState).not.toHaveBeenCalled();
    });

    it('destroying the page mid-drag persists a changed width', () => {
      mount();
      press(LEFT + 360);
      moveTo(LEFT + 420);
      fixture.destroy();
      expect(setState).toHaveBeenCalledTimes(1);
      expect(setState).toHaveBeenCalledWith(
        LAYOUT_KEY,
        expect.objectContaining({ appsSplitWidth: 420 }),
      );
    });

    it('destroying the page mid-drag with no change writes nothing', () => {
      mount();
      press(LEFT + 360);
      fixture.destroy();
      expect(setState).not.toHaveBeenCalled();
    });
  });
});
