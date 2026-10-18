import { type WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabViewMode } from '@ptah-extension/chat-types';
import { InspectorOpenStateService } from './inspector-open-state.service';
import {
  INSPECTOR_CLOSE_ATTR,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_LARGE_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_WIDE_DEFAULT_WIDTH,
  InspectorShellController,
  inspectorBandFor,
  inspectorDefaultWidthFor,
  inspectorDockWidth,
  inspectorMaxWidthFor,
} from './inspector-shell.controller';
import { SessionInspectorStore } from './session-inspector.store';

interface FakeTab {
  readonly viewMode: TabViewMode;
  readonly workflow?: string;
}

/** jsdom has no layout: give an element a non-null `offsetParent`. */
function markVisible<T extends HTMLElement>(element: T): T {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  return markVisible(element);
}

describe('InspectorShellController', () => {
  const originalResizeObserver = global.ResizeObserver;
  let resizeCallbacks: ResizeObserverCallback[];
  let tabs: WritableSignal<Record<string, FakeTab>>;
  let tabId: WritableSignal<string | null>;
  let needsYouCount: WritableSignal<number>;
  let controller: InspectorShellController;
  let openState: InspectorOpenStateService;
  let shell: HTMLElement;
  let headerToggle: HTMLButtonElement;
  let title: HTMLHeadingElement;
  let shellRectWidth: number;

  function emitWidth(width: number): void {
    const entry = { contentRect: { width } } as ResizeObserverEntry;
    for (const callback of resizeCallbacks) {
      callback([entry], {} as ResizeObserver);
    }
    TestBed.tick();
  }

  function attach(): void {
    controller.attach(
      shell,
      () => headerToggle,
      () => title,
    );
    TestBed.tick();
  }

  function setup(initialWidth = 1200, tab: FakeTab = { viewMode: 'full' }): void {
    resizeCallbacks = [];
    global.ResizeObserver = jest
      .fn()
      .mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallbacks.push(callback);
        return { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
      }) as unknown as typeof ResizeObserver;

    tabs = signal<Record<string, FakeTab>>({
      'tab-1': tab,
      'tab-2': { viewMode: 'full' },
    });
    tabId = signal<string | null>('tab-1');
    needsYouCount = signal(0);
    shellRectWidth = initialWidth;

    shell = document.createElement('div');
    shell.getBoundingClientRect = () =>
      ({ width: shellRectWidth }) as DOMRect;
    headerToggle = button('Show session details');
    title = document.createElement('h1');
    title.tabIndex = -1;
    document.body.append(headerToggle, title, shell);

    TestBed.configureTestingModule({
      providers: [
        InspectorShellController,
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) => {
              const found = tabs()[id];
              return found ? { tab: found } : null;
            },
            onTabClosed: () => () => undefined,
          },
        },
        {
          provide: SessionInspectorStore,
          useValue: {
            modelFor: () => signal({ needsYouCount: needsYouCount() }),
          },
        },
      ],
    });
    controller = TestBed.inject(InspectorShellController);
    openState = TestBed.inject(InspectorOpenStateService);
    controller.bindTab(() => tabId());
    attach();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    if (originalResizeObserver) {
      global.ResizeObserver = originalResizeObserver;
    } else {
      delete (global as Record<string, unknown>)['ResizeObserver'];
    }
  });

  describe('width band', () => {
    it.each([
      [960, 'docked'],
      [959, 'sheet'],
      [640, 'sheet'],
      [639, 'full-sheet'],
    ] as const)('%p px is %p', (width, band) => {
      setup();
      emitWidth(width);
      expect(controller.band()).toBe(band);
      expect(inspectorBandFor(width)).toBe(band);
    });

    it('a zero width keeps the last real band', () => {
      setup();
      emitWidth(800);
      emitWidth(0);
      expect(controller.band()).toBe('sheet');
    });
  });

  describe('shellWidth', () => {
    it('reads the initial measurement on attach', () => {
      setup(1124);
      expect(controller.shellWidth()).toBe(1124);
    });

    it('follows observer updates and keeps the last width on 0', () => {
      setup(1124);
      emitWidth(1500);
      expect(controller.shellWidth()).toBe(1500);
      emitWidth(0);
      expect(controller.shellWidth()).toBe(1500);
    });

    it('stays 0 for an unmeasured shell', () => {
      setup(0);
      expect(controller.shellWidth()).toBe(0);
      expect(controller.band()).toBe('docked');
    });

    it('is seeded from the shell rect without ResizeObserver', () => {
      setup(1200);
      TestBed.resetTestingModule();
      delete (global as Record<string, unknown>)['ResizeObserver'];
      TestBed.configureTestingModule({
        providers: [
          InspectorShellController,
          {
            provide: TabManagerService,
            useValue: {
              findTabByIdAcrossWorkspaces: () => null,
              onTabClosed: () => () => undefined,
            },
          },
          { provide: SessionInspectorStore, useValue: { modelFor: jest.fn() } },
        ],
      });
      const fresh = TestBed.inject(InspectorShellController);
      shellRectWidth = 1300;
      fresh.attach(shell, () => null, () => null);
      expect(fresh.shellWidth()).toBe(1300);
      expect(fresh.band()).toBe('docked');
    });
  });

  describe('docked <-> sheet (AC 5.4)', () => {
    it('docked -> sheet starts closed and keeps the docked choice', () => {
      setup();
      expect(controller.isOpen()).toBe(true);
      emitWidth(800);
      expect(controller.isOpen()).toBe(false);
      expect(controller.isModal()).toBe(false);
      emitWidth(1200);
      expect(controller.isOpen()).toBe(true);
    });

    it('sheet -> docked with the sheet open keeps the inspector open', () => {
      setup(1200, { viewMode: 'compact' });
      emitWidth(800);
      controller.toggle();
      expect(controller.isModal()).toBe(true);
      emitWidth(1200);
      expect(controller.isModal()).toBe(false);
      expect(controller.isOpen()).toBe(true);
      expect(openState.dockedOpen('tab-1', 'compact', null)).toBe(true);
    });

    it('the sheet never writes the docked choice', () => {
      setup(1200, { viewMode: 'compact' });
      emitWidth(800);
      controller.toggle();
      controller.closeInsp('opener');
      emitWidth(1200);
      expect(controller.isOpen()).toBe(false);
    });
  });

  describe('modal sheet (AC 5.3)', () => {
    it('focuses the close button after opening', () => {
      setup();
      const close = button('Close session details');
      close.setAttribute(INSPECTOR_CLOSE_ATTR, '');
      shell.append(close);
      emitWidth(800);
      controller.toggle();
      TestBed.tick();
      expect(document.activeElement).toBe(close);
    });

    it('closeReady focuses a late-mounted close button only while pending', () => {
      setup();
      emitWidth(800);
      controller.toggle();
      TestBed.tick();
      const close = button('Close session details');
      shell.append(close);
      controller.closeReady(close);
      expect(document.activeElement).toBe(close);

      headerToggle.focus();
      controller.closeReady(close);
      expect(document.activeElement).toBe(headerToggle);
    });

    it('Tab and Shift+Tab wrap inside the sheet', () => {
      setup();
      emitWidth(800);
      controller.toggle();
      TestBed.tick();
      const first = button('first');
      const last = button('last');
      shell.append(first, last);
      shell.addEventListener('keydown', (event) =>
        controller.onSheetKeydown(event),
      );

      last.focus();
      const forward = new KeyboardEvent('keydown', {
        key: 'Tab',
        cancelable: true,
      });
      shell.dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      const backward = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        cancelable: true,
      });
      shell.dispatchEvent(backward);
      expect(backward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it('Esc closes the sheet and returns focus to the opener', () => {
      setup();
      emitWidth(800);
      headerToggle.focus();
      controller.toggle();
      TestBed.tick();
      shell.addEventListener('keydown', (event) =>
        controller.onSheetKeydown(event),
      );
      const esc = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });
      shell.dispatchEvent(esc);
      expect(esc.defaultPrevented).toBe(true);
      expect(controller.isModal()).toBe(false);
      TestBed.tick();
      expect(document.activeElement).toBe(headerToggle);
    });

    it('Esc already handled inside the sheet leaves it open', () => {
      setup();
      emitWidth(800);
      controller.toggle();
      const esc = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });
      esc.preventDefault();
      shell.addEventListener('keydown', (event) =>
        controller.onSheetKeydown(event),
      );
      shell.dispatchEvent(esc);
      expect(controller.isModal()).toBe(true);
    });
  });

  it('a tab switch closes the sheet (AC 5.5)', () => {
    setup();
    emitWidth(800);
    controller.toggle();
    expect(controller.isModal()).toBe(true);
    tabId.set('tab-2');
    TestBed.tick();
    expect(controller.isModal()).toBe(false);
    expect(controller.isOpen()).toBe(false);
  });

  describe('toggle opener (AC 1.6)', () => {
    let tabButton: HTMLButtonElement;

    beforeEach(() => {
      setup(1200, { viewMode: 'compact' });
      tabButton = markVisible(button('Session'));
      document.body.append(tabButton);
    });

    it('docked: closeInsp returns focus to the tab that opened it', () => {
      controller.toggle(tabButton);
      expect(controller.isOpen()).toBe(true);
      title.focus();
      controller.closeInsp('opener');
      TestBed.tick();
      expect(controller.isOpen()).toBe(false);
      expect(document.activeElement).toBe(tabButton);
    });

    it('sheet: closeInsp returns focus to the tab over the header toggle', () => {
      emitWidth(800);
      controller.toggle(tabButton);
      expect(controller.isModal()).toBe(true);
      controller.closeInsp('opener');
      TestBed.tick();
      expect(document.activeElement).toBe(tabButton);
    });

    it('docked close through toggle forgets the opener', () => {
      controller.toggle(tabButton);
      tabButton.focus();
      controller.toggle(tabButton);
      expect(controller.isOpen()).toBe(false);
      TestBed.tick();
      expect(document.activeElement).toBe(tabButton);

      controller.toggle();
      controller.closeInsp('opener');
      TestBed.tick();
      expect(document.activeElement).toBe(headerToggle);
    });

    it('toggle() without an opener uses the header toggle (Rail board)', () => {
      emitWidth(800);
      title.focus();
      controller.toggle();
      controller.closeInsp('opener');
      TestBed.tick();
      expect(document.activeElement).toBe(headerToggle);
    });

    it('falls back to the title, never body, when no opener is visible', () => {
      controller.toggle(tabButton);
      tabButton.remove();
      headerToggle.remove();
      (document.activeElement as HTMLElement | null)?.blur();
      controller.closeInsp('opener');
      TestBed.tick();
      expect(document.activeElement).toBe(title);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  describe('showDot', () => {
    it('shows `need` while closed with requests waiting', () => {
      setup(1200, { viewMode: 'compact' });
      expect(controller.showDot()).toBeNull();
      needsYouCount.set(2);
      expect(controller.showDot()).toBe('need');
      controller.toggle();
      expect(controller.showDot()).toBeNull();
    });
  });

  describe('width functions', () => {
    it.each([
      [0, INSPECTOR_MAX_WIDTH],
      [Number.NaN, INSPECTOR_MAX_WIDTH],
      [800, INSPECTOR_MIN_WIDTH],
      [960, 336],
      [1124, 500],
      [1440, INSPECTOR_MAX_WIDTH],
    ])('inspectorMaxWidthFor(%p) = %p', (shellWidth, expected) => {
      expect(inspectorMaxWidthFor(shellWidth)).toBe(expected);
    });

    it.each([
      [0, INSPECTOR_DEFAULT_WIDTH],
      [Number.NaN, INSPECTOR_DEFAULT_WIDTH],
      [960, INSPECTOR_DEFAULT_WIDTH],
      [1099, INSPECTOR_DEFAULT_WIDTH],
      [1100, INSPECTOR_LARGE_DEFAULT_WIDTH],
      [1124, INSPECTOR_LARGE_DEFAULT_WIDTH],
      [1499, INSPECTOR_LARGE_DEFAULT_WIDTH],
      [1500, INSPECTOR_WIDE_DEFAULT_WIDTH],
    ])('inspectorDefaultWidthFor(%p) = %p', (shellWidth, expected) => {
      expect(inspectorDefaultWidthFor(shellWidth)).toBe(expected);
    });

    it.each([
      [null, 0, 336],
      [null, 960, 336],
      [null, 1124, 400],
      [null, 1500, 448],
      [900, 1124, 500],
      [900, 1600, 560],
      [900, 0, 560],
      [100, 1124, 300],
      [420.6, 1600, 421],
      [Number.NaN, 1124, 400],
      [Number.POSITIVE_INFINITY, 1124, 400],
    ])(
      'inspectorDockWidth(%p, %p) = %p',
      (preference, shellWidth, expected) => {
        expect(inspectorDockWidth(preference, shellWidth)).toBe(expected);
      },
    );
  });
});
