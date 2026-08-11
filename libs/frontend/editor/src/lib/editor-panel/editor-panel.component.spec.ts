/**
 * EditorPanelComponent specs — loading-gate does NOT destroy the code editor.
 *
 * TASK_2026_154 Serious #2: opening a never-visited workspace clears
 * activeFilePath and sets isLoading, which previously flipped a structural
 * if/else that DESTROYED the single shared code-editor instance — throwing
 * away the Monaco model/view-state cache for EVERY open workspace. The spinner
 * is now an overlay on top of the always-mounted editor region, so the
 * component instance must survive an isLoading + no-active-file episode.
 *
 * Child components are stubbed so the panel mounts without Monaco / real
 * services; we assert the SAME stub CodeEditor instance persists across the
 * loading episode. ngx-markdown (ESM, pulled in transitively by the real
 * CodeEditor module) is mocked above so the module graph loads under Jest.
 */

import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VSCodeService } from '@ptah-extension/core';
import { EditorPanelComponent } from './editor-panel.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { VimModeService } from '../services/vim-mode.service';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import { CodeEditorComponent } from '../code-editor/code-editor.component';
import { EditorDiffSplitHelper } from '../services/editor/editor-diff-split';
import { EditorTabsHelper } from '../services/editor/editor-tabs';
import type { EditorInternalState } from '../services/editor/editor-internal-state';
import { diffTabKey } from '../services/editor/editor-tab.types';

/**
 * jsdom implements no HTMLDialogElement methods, so the save-conflict dialog's
 * showModal()/close() would throw the moment it opens (TASK_2026_227).
 *
 * The stub reflects the `open` attribute, which is all these specs observe. It
 * cannot stand in for the top layer — jsdom has no layout or hit-testing, which
 * is why the paint-order defect this dialog now carries a fix for was invisible
 * here and had to be caught in a live Electron host.
 */
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }

  // jsdom implements none of the three pointer-capture methods and has no
  // PointerEvent constructor either (TASK_2026_209). The resize drags call
  // setPointerCapture behind a `typeof === 'function'` check, so without this
  // they would silently take the degraded path and the capture assertions
  // would be vacuous. This stands in for the real thing closely enough to be
  // worth asserting against: capture is per element per pointer id, and
  // releasing one that is not held throws NotFoundError.
  if (!Element.prototype.setPointerCapture) {
    const held = new WeakMap<Element, Set<number>>();
    Element.prototype.setPointerCapture = function setPointerCapture(
      this: Element,
      pointerId: number,
    ) {
      const ids = held.get(this) ?? new Set<number>();
      ids.add(pointerId);
      held.set(this, ids);
    };
    Element.prototype.hasPointerCapture = function hasPointerCapture(
      this: Element,
      pointerId: number,
    ) {
      return held.get(this)?.has(pointerId) ?? false;
    };
    Element.prototype.releasePointerCapture = function releasePointerCapture(
      this: Element,
      pointerId: number,
    ) {
      const ids = held.get(this);
      if (!ids?.has(pointerId)) {
        throw new DOMException('no active capture', 'NotFoundError');
      }
      ids.delete(pointerId);
    };
  }
});

/**
 * A pointer event jsdom can dispatch.
 *
 * There is no `PointerEvent` constructor here, so this is a `MouseEvent` of the
 * right type with `pointerId` defined on it — which is the whole of the pointer
 * surface the drag loop reads.
 */
function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
): Event {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, 'pointerId', {
    value: init.pointerId ?? 1,
    configurable: true,
  });
  return event;
}

// ---------------------------------------------------------------------------
// Stub child components (match selectors + bound inputs/outputs)
// ---------------------------------------------------------------------------
@Component({
  selector: 'ptah-code-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubCodeEditorComponent {
  readonly filePath = input<string | undefined>(undefined);
  readonly content = input<string>('');
  readonly isFocused = input(true);
  readonly contentIsPersisted = input<boolean | undefined>(undefined);
  readonly contentChanged = output<string>();
  readonly fileSaved = output<{ filePath: string; content: string }>();
}

@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubDiffViewComponent {
  readonly diffTab = input<unknown>(null);
  readonly openDiffKeys = input<readonly string[]>([]);
  /** D2 — the hunk apply seam the panel binds; exercised in its own spec. */
  readonly applyHunks = input<unknown>(null);
  readonly retryRequested = output<string>();
}

@Component({
  selector: 'ptah-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubSidebarComponent {
  readonly width = input(256);
  readonly files = input<unknown[]>([]);
  readonly activeFilePath = input<string | undefined>(undefined);
  readonly changedFiles = input<unknown[]>([]);
  readonly fileSelected = output<string>();
  readonly diffRequested = output<unknown>();
  readonly searchResultSelected = output<{ filePath: string; line: number }>();
  readonly contextMenuRequested = output<unknown>();
}

@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubGitStatusBarComponent {}

@Component({
  selector: 'ptah-terminal-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubTerminalPanelComponent {}

@Component({
  selector: 'ptah-file-tree-context-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubContextMenuComponent {
  readonly x = input(0);
  readonly y = input(0);
  readonly node = input<unknown>(null);
  readonly action = output<unknown>();
  readonly closed = output<void>();
}

@Component({
  selector: 'ptah-quick-open',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubQuickOpenComponent {
  readonly fileSelected = output<{ filePath: string }>();
  readonly closed = output<void>();
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------
function makeEditorServiceStub() {
  const activeFilePath = signal<string | undefined>(undefined);
  const isLoading = signal(false);
  const splitActive = signal(false);
  const focusedPane = signal<'left' | 'right'>('left');
  return {
    isLoading,
    activeFilePath,
    activeFileContent: signal(''),
    hasActiveFile: computed(() => !!activeFilePath()),
    activeDiffTab: signal<unknown>(null),
    isActiveFileImage: signal(false),
    openTabs: signal<unknown[]>([]),
    splitActive,
    focusedPane,
    // Faithful to EditorDiffSplitHelper.closeSplit, whose LAST act is
    // `focusedPane.set('left')` — the ordering TASK_2026_212 turns on. A
    // jest.fn() that changed nothing would have made those specs vacuous.
    closeSplit: jest.fn(() => {
      splitActive.set(false);
      focusedPane.set('left');
    }),
    splitFilePath: signal<string | undefined>(undefined),
    splitFileContent: signal(''),
    terminalVisible: signal(false),
    terminalHeight: signal(200),
    setTerminalHeight: jest.fn(),
    fileTree: signal<unknown[]>([]),
    error: signal<string | null>(null),
    activeWorkspacePath: '/ws',
    switchWorkspace: jest.fn(),
    startFileTreeWatcher: jest.fn(),
    stopFileTreeWatcher: jest.fn(),
    clearError: jest.fn(),
    switchTab: jest.fn(),
    closeTab: jest.fn(),
    setFocusedPane: jest.fn(),
    saveFile: jest.fn(() => Promise.resolve()),
    markTabClean: jest.fn(),
    updateTabContent: jest.fn(),
    updateSplitContent: jest.fn(),
    hasUnabsorbedPeerEdit: jest.fn(() => false),
    // File-ops seam behind the delete-confirm / name-input dialogs (TASK_2026_216).
    deleteItem: jest.fn(() => Promise.resolve()),
    createFile: jest.fn(() => Promise.resolve()),
    createFolder: jest.fn(() => Promise.resolve()),
    renameItem: jest.fn(() => Promise.resolve()),
    // Read by the REAL CodeEditorComponent (used by the keyboard-save block
    // below, which mounts it instead of the stub).
    targetLine: signal<number | undefined>(undefined),
    clearTargetLine: jest.fn(),
  } as unknown as EditorService & {
    isLoading: ReturnType<typeof signal<boolean>>;
    activeFilePath: ReturnType<typeof signal<string | undefined>>;
    openTabs: ReturnType<typeof signal<unknown[]>>;
    terminalVisible: ReturnType<typeof signal<boolean>>;
    splitActive: ReturnType<typeof signal<boolean>>;
    splitFilePath: ReturnType<typeof signal<string | undefined>>;
    splitFileContent: ReturnType<typeof signal<string>>;
    activeFileContent: ReturnType<typeof signal<string>>;
    focusedPane: ReturnType<typeof signal<'left' | 'right'>>;
    setTerminalHeight: jest.Mock;
    switchTab: jest.Mock;
    closeTab: jest.Mock;
    saveFile: jest.Mock;
    markTabClean: jest.Mock;
    updateTabContent: jest.Mock;
    updateSplitContent: jest.Mock;
    setFocusedPane: jest.Mock;
    closeSplit: jest.Mock;
    hasUnabsorbedPeerEdit: jest.Mock;
    deleteItem: jest.Mock;
    createFile: jest.Mock;
    createFolder: jest.Mock;
    renameItem: jest.Mock;
  };
}

function makeGitStatusStub() {
  return {
    files: signal<unknown[]>([]),
    activeWorkspacePath: signal<string | null>(null),
    switchWorkspace: jest.fn(),
    startListening: jest.fn(),
    stopListening: jest.fn(),
  } as unknown as GitStatusService;
}

function makeVimStub() {
  return {
    enabled: signal(false),
    loadPreference: jest.fn(async () => undefined),
    toggle: jest.fn(async () => undefined),
    // Used by the REAL CodeEditorComponent's attach/detach effect.
    attachToEditor: jest.fn(),
    detach: jest.fn(),
  } as unknown as VimModeService;
}

function makeVscodeStub() {
  return {
    config: signal({ workspaceRoot: '' }),
    isConnected: signal(false),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  } as unknown as VSCodeService;
}

describe('EditorPanelComponent — loading gate keeps the editor mounted (Serious #2)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    // Swap heavy children for lightweight stubs (matching selectors).
    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('does NOT destroy the CodeEditorComponent instance during an isLoading + no-active-file episode', () => {
    const before = fixture.debugElement.query(
      By.directive(StubCodeEditorComponent),
    );
    expect(before).toBeTruthy();
    const instance = before.componentInstance;

    // Simulate opening a never-visited workspace: activeFilePath cleared then
    // isLoading set (EditorWorkspaceHelper's uncached branch).
    editor.activeFilePath.set(undefined);
    editor.isLoading.set(true);
    fixture.detectChanges();

    const during = fixture.debugElement.query(
      By.directive(StubCodeEditorComponent),
    );
    // Editor host is still mounted (spinner is an overlay, not a swap)...
    expect(during).toBeTruthy();
    // ...and it is the SAME instance — its Monaco model cache is preserved.
    expect(during.componentInstance).toBe(instance);

    // Spinner overlay is visible while loading with no active file.
    const spinner = fixture.nativeElement.querySelector('.loading-spinner');
    expect(spinner).toBeTruthy();

    // Loading resolves with a file — still the same editor instance.
    editor.isLoading.set(false);
    editor.activeFilePath.set('/ws/a.ts');
    fixture.detectChanges();

    const after = fixture.debugElement.query(
      By.directive(StubCodeEditorComponent),
    );
    expect(after.componentInstance).toBe(instance);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B5 — drag coalescing (TASK_2026_173)
//
// All three resize drags used to call ngZone.run() once per native `mousemove`,
// which made the surrounding runOutsideAngular pointless: every pointer event
// re-entered the zone and cost a change-detection pass plus a layout write.
// They now record the latest position and arm a single requestAnimationFrame,
// so at most ONE update lands per frame. mouseup cancels the armed frame and
// applies the final position synchronously, and every cleanup path (including
// ngOnDestroy) cancels a pending frame so no callback can fire after teardown.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — resize drags coalesce to one update per frame (B5)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;

  /** Run every armed frame callback, mirroring a single browser frame tick. */
  function tickFrame(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(performance.now());
  }

  function handleFor(label: string): HTMLElement {
    const handle: HTMLElement = fixture.nativeElement.querySelector(
      `[role="separator"][aria-label="${label}"]`,
    );
    expect(handle).toBeTruthy();
    return handle;
  }

  function pointerDownOn(
    label: string,
    pointerId = 1,
    { resetFrames = true } = {},
  ): HTMLElement {
    const handle = handleFor(label);
    if (resetFrames) {
      // Angular's own rendering can arm frames (afterNextRender); zero the
      // counters here so every assertion below counts drag-armed frames only.
      rafSpy.mockClear();
      frames.clear();
    }
    handle.dispatchEvent(
      pointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        cancelable: true,
        pointerId,
      }),
    );
    return handle;
  }

  function moveTo(x: number, y = 100, pointerId = 1): void {
    document.dispatchEvent(
      pointerEvent('pointermove', { clientX: x, clientY: y, pointerId }),
    );
  }

  function releasePointer(pointerId = 1): void {
    document.dispatchEvent(pointerEvent('pointerup', { pointerId }));
  }

  /** Read a protected signal off the component under test. */
  function readSignal(name: 'sidebarWidth' | 'splitLeftPercent'): number {
    const host = fixture.componentInstance as unknown as Record<
      string,
      () => number
    >;
    return host[name]();
  }

  beforeEach(() => {
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

    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('arms exactly one frame for a burst of sidebar mousemove events and applies only the latest position', () => {
    pointerDownOn('Resize sidebar');

    moveTo(120);
    moveTo(140);
    moveTo(160);
    moveTo(180);

    // Four pointer events, ONE armed frame — and nothing applied yet.
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(readSignal('sidebarWidth')).toBe(256);

    tickFrame();

    // Only the latest position is applied: 256 + (180 - 100).
    expect(readSignal('sidebarWidth')).toBe(336);

    // The next burst arms a fresh frame (the handle is released, not latched).
    moveTo(200);
    moveTo(220);
    expect(rafSpy).toHaveBeenCalledTimes(2);

    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(376);

    releasePointer();
  });

  it('cancels the pending frame on mouseup and still applies the release position', () => {
    pointerDownOn('Resize sidebar');

    moveTo(150);
    moveTo(190);
    expect(frames.size).toBe(1);

    releasePointer();

    // Frame cancelled...
    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    // ...yet the final position is not lost: 256 + (190 - 100).
    expect(readSignal('sidebarWidth')).toBe(346);

    // Listeners are gone — further movement changes nothing.
    moveTo(400);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(readSignal('sidebarWidth')).toBe(346);
  });

  it('preserves the 160px/480px sidebar clamp', () => {
    pointerDownOn('Resize sidebar');
    moveTo(5000);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(480);

    moveTo(-5000);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(160);

    releasePointer();
  });

  it('cancels a pending frame on destroy so no update lands after teardown', () => {
    pointerDownOn('Resize sidebar');
    moveTo(200);
    expect(frames.size).toBe(1);

    fixture.destroy();

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    // Nothing left listening either.
    moveTo(400);
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces the terminal resize drag the same way', () => {
    editor.terminalVisible.set(true);
    fixture.detectChanges();

    pointerDownOn('Resize terminal');
    moveTo(100, 90);
    moveTo(100, 80);
    moveTo(100, 70);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(editor.setTerminalHeight).not.toHaveBeenCalled();

    tickFrame();
    expect(editor.setTerminalHeight).toHaveBeenCalledTimes(1);

    releasePointer();
  });

  it('coalesces the split divider drag the same way', () => {
    editor.splitActive.set(true);
    fixture.detectChanges();

    pointerDownOn('Resize split panes');
    moveTo(150);
    moveTo(200);
    moveTo(250);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(readSignal('splitLeftPercent')).toBe(50);

    tickFrame();
    // jsdom reports a zero-width container, so any rightward drag saturates the
    // clamp — what matters here is that exactly one update landed for three events.
    expect(readSignal('splitLeftPercent')).toBe(80);

    releasePointer();
  });

  // ---------------------------------------------------------------------------
  // TASK_2026_176 — blur + Escape interruption (folded here from Task 4.4)
  // ---------------------------------------------------------------------------

  it('restores the sidebar width and cancels the frame on window blur', () => {
    pointerDownOn('Resize sidebar');
    moveTo(5000);
    expect(frames.size).toBe(1);

    window.dispatchEvent(new Event('blur'));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(readSignal('sidebarWidth')).toBe(256);

    moveTo(400);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(readSignal('sidebarWidth')).toBe(256);
  });

  it('restores the sidebar width and cancels the frame on Escape', () => {
    pointerDownOn('Resize sidebar');
    moveTo(5000);
    expect(frames.size).toBe(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(readSignal('sidebarWidth')).toBe(256);
  });

  it('restores the terminal height and ends the drag on blur', () => {
    editor.terminalHeight.set(300);
    editor.terminalVisible.set(true);
    fixture.detectChanges();

    pointerDownOn('Resize terminal');
    moveTo(100, 90);
    moveTo(100, 10);
    expect(frames.size).toBe(1);

    window.dispatchEvent(new Event('blur'));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(editor.setTerminalHeight).toHaveBeenCalledWith(300);

    moveTo(100, 5);
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('restores the split divider percentage and ends the drag on Escape', () => {
    editor.splitActive.set(true);
    fixture.detectChanges();

    pointerDownOn('Resize split panes');
    moveTo(5000);
    expect(frames.size).toBe(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(readSignal('splitLeftPercent')).toBe(50);
  });

  // -------------------------------------------------------------------------
  // TASK_2026_209 — pointer capture + one drag per pointer.
  //
  // Carried over from Batch 4's review, Failure Mode 3, where the reviewer
  // ruled no action was needed for correctness: the loop was safe because
  // there is one mouse, and a second mousedown tore the first drag down before
  // starting a second. Safe by circumstance, not by construction. These pin
  // the construction — the drag owns a pointer id, refuses to be restarted
  // while it holds one, ignores every other pointer, and gives the capture
  // back on every exit including teardown.
  // -------------------------------------------------------------------------

  it('(209-1) takes pointer capture on the handle it was started from, and gives it back on pointerup', () => {
    const handle = pointerDownOn('Resize sidebar', 7);

    expect(handle.hasPointerCapture(7)).toBe(true);

    moveTo(180, 100, 7);
    releasePointer(7);

    expect(handle.hasPointerCapture(7)).toBe(false);
    // The drag still committed its release position: capture is a layer on
    // top of the loop, not a replacement for it.
    expect(readSignal('sidebarWidth')).toBe(336);
  });

  it('(209-2) refuses a second pointer: the live drag stays authoritative and keeps its own baseline', () => {
    pointerDownOn('Resize sidebar', 1);
    moveTo(150);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(306);

    // A second finger presses the same handle. The old loop tore the first
    // drag down and re-baselined `original` to the CURRENT width, so a later
    // Escape would have restored 306 rather than 256.
    pointerDownOn('Resize sidebar', 2, { resetFrames: false });

    // Nothing from the second pointer drives anything.
    const framesBefore = rafSpy.mock.calls.length;
    moveTo(400, 100, 2);
    expect(rafSpy).toHaveBeenCalledTimes(framesBefore);
    expect(readSignal('sidebarWidth')).toBe(306);

    // The first drag is still live, still measuring from where it began.
    moveTo(170);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(326);

    // ...and still restores the width the FIRST pointerdown saw.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(readSignal('sidebarWidth')).toBe(256);
  });

  it('(209-3) a foreign pointer cannot end the drag either', () => {
    pointerDownOn('Resize sidebar', 1);
    moveTo(180);

    releasePointer(2);

    // Still armed, still listening: the stray release changed nothing.
    expect(frames.size).toBe(1);
    moveTo(200);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(356);

    releasePointer(1);
  });

  it('(209-4) pointercancel is an interruption — the UA took the gesture, so the value is restored', () => {
    const handle = pointerDownOn('Resize sidebar', 3);
    moveTo(5000, 100, 3);
    expect(frames.size).toBe(1);

    document.dispatchEvent(pointerEvent('pointercancel', { pointerId: 3 }));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(readSignal('sidebarWidth')).toBe(256);
    expect(handle.hasPointerCapture(3)).toBe(false);

    // Nothing is listening any more.
    moveTo(400, 100, 3);
    expect(readSignal('sidebarWidth')).toBe(256);
  });

  it('(209-5) losing capture ends the drag — the terminal handle can be unmounted mid-drag', () => {
    editor.terminalHeight.set(300);
    editor.terminalVisible.set(true);
    fixture.detectChanges();

    const handle = pointerDownOn('Resize terminal', 4);
    moveTo(100, 10, 4);
    expect(frames.size).toBe(1);

    // What the browser fires when a capturing element leaves the document.
    handle.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 4 }));

    expect(frames.size).toBe(0);
    expect(editor.setTerminalHeight).toHaveBeenCalledWith(300);

    // And the guard is clear, so the handle can start a fresh drag.
    editor.setTerminalHeight.mockClear();
    pointerDownOn('Resize terminal', 5);
    moveTo(100, 90, 5);
    tickFrame();
    expect(editor.setTerminalHeight).toHaveBeenCalledTimes(1);
    releasePointer(5);
  });

  it('(209-6) releases capture on destroy, so a torn-down panel never holds a pointer', () => {
    const handle = pointerDownOn('Resize sidebar', 9);
    expect(handle.hasPointerCapture(9)).toBe(true);

    fixture.destroy();

    expect(handle.hasPointerCapture(9)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// N1 + B1 — the three-layer always-mounted content region (TASK_2026_173)
//
// The content region used to be an @if / @else if / @else chain whose final
// @else WAS <ptah-code-editor>. Activating a diff tab therefore DESTROYED the
// code editor — discarding the Monaco model + view-state cache for every open
// workspace, the TASK_2026_154 teardown reintroduced by template structure —
// and rebuilt the diff editor from scratch on every return switch. Both
// surfaces are now mounted for the life of the panel and only hidden.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — diff and code editor stay mounted together (N1, B1)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  // Never re-derive the key format here — SEQ-1 keeps exactly one definition.
  const DIFF_KEY = diffTabKey('worktree', 'src/a.ts');
  const diffTab = {
    filePath: DIFF_KEY,
    fileName: 'a.ts (working tree)',
    content: 'modified\n',
    isDirty: false,
    diff: { comparison: 'worktree', path: 'src/a.ts', status: 'fresh' },
  };

  function codeEditor() {
    return fixture.debugElement.query(By.directive(StubCodeEditorComponent));
  }

  function diffView() {
    return fixture.debugElement.query(By.directive(StubDiffViewComponent));
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('does NOT destroy the CodeEditorComponent when a diff tab is activated (N1)', () => {
    const instance = codeEditor().componentInstance;
    expect(diffView()).toBeTruthy();

    (editor.activeDiffTab as unknown as { set(v: unknown): void }).set(diffTab);
    editor.activeFilePath.set(DIFF_KEY);
    fixture.detectChanges();

    // Same instance — its Monaco model/view-state cache survived.
    expect(codeEditor().componentInstance).toBe(instance);
    // ...and the diff view was not remounted either.
    expect(diffView()).toBeTruthy();

    (editor.activeDiffTab as unknown as { set(v: unknown): void }).set(null);
    editor.activeFilePath.set('/ws/a.ts');
    fixture.detectChanges();

    expect(codeEditor().componentInstance).toBe(instance);
  });

  it('hides rather than unmounts whichever surface is inactive', () => {
    expect(diffView().nativeElement.classList).toContain('invisible');
    expect(codeEditor().nativeElement.classList).not.toContain('invisible');

    (editor.activeDiffTab as unknown as { set(v: unknown): void }).set(diffTab);
    editor.activeFilePath.set(DIFF_KEY);
    fixture.detectChanges();

    expect(diffView().nativeElement.classList).not.toContain('invisible');
    expect(codeEditor().nativeElement.classList).toContain('invisible');
  });

  /**
   * TASK_2026_196. Both Monaco surfaces are absolutely positioned with z-index
   * auto, so they paint in CSS 2.1 layer 8 while the terminal separator and
   * terminal panel — in-flow siblings of the editor region — paint in layer 4.
   * An unclipped overflow therefore paints over the terminal AND, because
   * hit-testing follows paint order, swallows the mousedown on the resize
   * separator.
   *
   * The assertion walks up from the positioned elements rather than hardcoding
   * a selector, so it also fails if someone introduces a NEW positioned surface
   * into a container that does not clip.
   *
   * Honest limit: jsdom computes no layout, so this proves the guard is
   * DECLARED, not that painting is correct. No automated proof of the paint
   * behaviour exists yet — two attempts at an Electron hit-test both passed
   * with the clip reverted and were deleted rather than kept as false
   * coverage. See TASK_2026_196 for what is still unverified.
   */
  it('clips every absolutely positioned editor surface (TASK_2026_196)', () => {
    const positioned = [
      diffView().nativeElement as HTMLElement,
      codeEditor().nativeElement as HTMLElement,
    ];

    for (const el of positioned) {
      expect(el.classList).toContain('absolute');

      const container = el.parentElement as HTMLElement;
      expect(container).toBeTruthy();
      // The clip is what stops the bleed; `relative` is what makes `inset-0`
      // resolve against this box rather than a distant ancestor.
      expect(container.classList).toContain('overflow-hidden');
      expect(container.classList).toContain('relative');
    }

    // Both surfaces must share the one clipped container — if a future change
    // splits them apart, the pair-wise guarantee above stops meaning much.
    expect(positioned[0].parentElement).toBe(positioned[1].parentElement);
  });

  it('never hands the code editor a diff tab key or an image path', () => {
    (editor.activeDiffTab as unknown as { set(v: unknown): void }).set(diffTab);
    editor.activeFilePath.set(DIFF_KEY);
    editor.activeFileContent.set('modified\n');
    fixture.detectChanges();

    // The always-mounted code editor must not open a model for `diff:...`.
    expect(codeEditor().componentInstance.filePath()).toBeUndefined();
    expect(codeEditor().componentInstance.content()).toBe('');

    (editor.activeDiffTab as unknown as { set(v: unknown): void }).set(null);
    (editor.isActiveFileImage as unknown as { set(v: boolean): void }).set(
      true,
    );
    editor.activeFilePath.set('/ws/logo.png');
    fixture.detectChanges();

    expect(codeEditor().componentInstance.filePath()).toBeUndefined();
    expect(codeEditor().nativeElement.classList).toContain('invisible');
  });

  it('forwards the open diff tab keys so closed pairs can be evicted (B1 AC5)', () => {
    expect(diffView().componentInstance.openDiffKeys()).toEqual([]);

    (editor.openTabs as unknown as { set(v: unknown[]): void }).set([
      { filePath: '/ws/a.ts', fileName: 'a.ts', content: '', isDirty: false },
      diffTab,
    ]);
    fixture.detectChanges();

    expect(diffView().componentInstance.openDiffKeys()).toEqual([DIFF_KEY]);

    (editor.openTabs as unknown as { set(v: unknown[]): void }).set([]);
    fixture.detectChanges();

    expect(diffView().componentInstance.openDiffKeys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D1 — the tab strip has no nested interactive elements (TASK_2026_173)
//
// The tab used to be a <button role="tab"> with the close <button> nested
// INSIDE it. That is invalid HTML: the browser flattens the inner button out
// in the parsed DOM, so the tree a screen reader and hit-testing see never
// matched the template — and `onTabClose` had to call stopPropagation() to
// stop a close from also switching tabs. Both buttons are now siblings inside
// a role="presentation" wrapper, so the isolation is structural and
// stopPropagation is gone. Space and Enter come free from using real buttons;
// the specs below assert exactly that, because the previous shape could not
// deliver it no matter how the handlers were written.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — tab strip controls are siblings, not nested (D1)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  const TABS = [
    { filePath: '/ws/a.ts', fileName: 'a.ts', content: '', isDirty: false },
    { filePath: '/ws/b.ts', fileName: 'b.ts', content: '', isDirty: true },
  ];

  function tabButton(index = 0): HTMLButtonElement {
    const els = fixture.nativeElement.querySelectorAll('[role="tab"]');
    return els[index] as HTMLButtonElement;
  }

  function closeButton(index = 0): HTMLButtonElement {
    const els = fixture.nativeElement.querySelectorAll(
      'button[aria-label^="Close "]',
    );
    return els[index] as HTMLButtonElement;
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();
    editor.openTabs.set(TABS);
    editor.activeFilePath.set('/ws/a.ts');

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('renders no interactive element inside another interactive element (AC1)', () => {
    const interactive = 'a[href], button, input, select, textarea, [tabindex]';
    const nested: string[] = [];
    for (const el of fixture.nativeElement.querySelectorAll(interactive)) {
      // Start the walk at the PARENT: `closest` matches the element itself,
      // so `closest(sel) !== el` can never flag anything. (It cannot — that
      // exact mistake was caught by running the check against the pre-batch-6
      // markup, where it wrongly reported zero nesting.)
      if ((el as HTMLElement).parentElement?.closest(interactive)) {
        nested.push((el as HTMLElement).outerHTML.slice(0, 120));
      }
    }
    expect(nested).toEqual([]);
  });

  it('keeps the tab and its close control as siblings under a presentational wrapper (AC1)', () => {
    const tab = tabButton();
    const close = closeButton();

    expect(tab.tagName).toBe('BUTTON');
    expect(close.tagName).toBe('BUTTON');
    // Siblings, and the wrapper is transparent to ARIA so role="tab" is still
    // effectively owned by role="tablist".
    expect(close.parentElement).toBe(tab.parentElement);
    expect(tab.parentElement?.getAttribute('role')).toBe('presentation');
    expect(tab.parentElement?.parentElement?.getAttribute('role')).toBe(
      'tablist',
    );
    // Neither button can submit a form by accident.
    expect(tab.type).toBe('button');
    expect(close.type).toBe('button');
  });

  it('labels every control distinctly and reflects the selected tab (AC4)', () => {
    expect(tabButton(0).getAttribute('aria-label')).toBe('Switch to a.ts');
    expect(tabButton(0).getAttribute('aria-selected')).toBe('true');
    expect(tabButton(1).getAttribute('aria-label')).toBe('Switch to b.ts');
    expect(tabButton(1).getAttribute('aria-selected')).toBe('false');
    expect(closeButton(0).getAttribute('aria-label')).toBe('Close a.ts');
    expect(closeButton(1).getAttribute('aria-label')).toBe('Close b.ts');
  });

  it('closes a tab WITHOUT switching to it — no stopPropagation involved (AC5)', () => {
    // A real bubbling click, exactly as the browser dispatches one.
    closeButton(1).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(editor.closeTab).toHaveBeenCalledWith('/ws/b.ts');
    expect(editor.switchTab).not.toHaveBeenCalled();
  });

  it('does not suppress propagation — the close click still reaches the pane (AC5)', () => {
    // Proof the isolation is structural rather than a stopped event: the click
    // is allowed to keep bubbling all the way to the pane click handler.
    const seen: EventTarget[] = [];
    fixture.nativeElement.addEventListener('click', (e: Event) => {
      seen.push(e.target as EventTarget);
    });

    closeButton(0).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(seen.length).toBe(1);
    expect(editor.closeTab).toHaveBeenCalledWith('/ws/a.ts');
  });

  it('gives both controls independent keyboard reachability and click activation (AC2)', () => {
    // HONEST SCOPE: jsdom does not implement the user-agent default action
    // that turns Enter/Space on a <button> into a click, so no unit test can
    // observe that key press. What CAN be asserted — and is the entire reason
    // the fix is a real <button> rather than a div with a keydown handler — is
    // that each control is a natively focusable, non-disabled, in-tab-order
    // <button> whose sole activation path is (click). Enter/Space then follow
    // from the user agent, for every <button>, unconditionally.
    for (const el of [tabButton(0), closeButton(0)]) {
      expect(el.tagName).toBe('BUTTON');
      expect(el.hasAttribute('disabled')).toBe(false);
      expect(el.getAttribute('tabindex')).toBeNull();
      el.focus();
      expect(document.activeElement).toBe(el);
    }
    // They focus independently: focusing one does not focus the other.
    tabButton(0).focus();
    expect(document.activeElement).not.toBe(closeButton(0));

    tabButton(1).click();
    expect(editor.switchTab).toHaveBeenCalledWith('/ws/b.ts');
    closeButton(1).click();
    expect(editor.closeTab).toHaveBeenCalledWith('/ws/b.ts');
  });

  it('reveals the hover-gated close control on keyboard focus (AC7)', () => {
    const cls = closeButton(0).className;
    // Hover-only reveal left keyboard users with an invisible control.
    expect(cls).toContain('opacity-0');
    expect(cls).toContain('group-hover:opacity-60');
    expect(cls).toContain('focus-visible:opacity-100');
    // Both controls carry a visible focus ring.
    expect(tabButton(0).className).toContain('focus-visible:outline-2');
    expect(cls).toContain('focus-visible:outline-2');
  });

  it('keeps the dirty dot and the diff status glyph inside the tab button (AC6)', () => {
    editor.openTabs.set([
      {
        filePath: '/ws/b.ts',
        fileName: 'b.ts',
        content: '',
        isDirty: true,
        diff: { comparison: 'worktree', path: 'b.ts', status: 'stale' },
      },
    ]);
    fixture.detectChanges();

    const tab = tabButton();
    const glyph = fixture.nativeElement.querySelector(
      '[data-testid="diff-tab-status-glyph"]',
    );
    expect(glyph).toBeTruthy();
    expect(tab.contains(glyph)).toBe(true);
    expect(glyph.classList).toContain('text-warning');

    const dot = tab.querySelector('[title="Unsaved changes"]');
    expect(dot).toBeTruthy();
    // DOM order is unchanged: filename span → dirty dot → diff glyph.
    expect(
      dot.compareDocumentPosition(glyph) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C2 — split-pane save.
//
// Two things are being pinned here. First, that a save from EITHER pane leaves
// the dirty indicators correct: the split pane never marked the tab clean, so
// the strip kept a dirty dot on a file that was clean on disk. Second — and
// this is the assertion that actually protects the experience — that an
// ORDINARY split-pane save does not prompt. A conflict dialog on every save
// would be worse than the silent behaviour it replaces (R-10).
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — split-pane save (C2)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  function tab(filePath: string, content: string, isDirty: boolean) {
    return {
      filePath,
      fileName: filePath.split('/').pop(),
      content,
      isDirty,
    };
  }

  /** Same file in both panes, one tab record. */
  function shareFileInBothPanes(content = 'v0', isDirty = false): void {
    editor.openTabs.set([tab('/ws/a.ts', content, isDirty)]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    fixture.detectChanges();
  }

  function panes() {
    return fixture.debugElement.queryAll(By.directive(StubCodeEditorComponent));
  }

  function conflictDialog(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[role="alertdialog"]');
  }

  function dialogButton(label: string): HTMLButtonElement | undefined {
    return [
      ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((b) => b.textContent?.trim() === label);
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('(AC4, leg 3) a save from the SPLIT pane marks the tab clean, as the primary pane already did', async () => {
    shareFileInBothPanes();
    const [, right] = panes();

    right.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'v1',
    });
    await Promise.resolve();

    expect(editor.saveFile).toHaveBeenCalledWith('/ws/a.ts', 'v1');
    expect(editor.markTabClean).toHaveBeenCalledWith('/ws/a.ts');
  });

  it('(AC4) a save from the PRIMARY pane still marks the tab clean', async () => {
    editor.activeFilePath.set('/ws/a.ts');
    fixture.detectChanges();
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'v1',
    });
    await Promise.resolve();

    expect(editor.saveFile).toHaveBeenCalledWith('/ws/a.ts', 'v1');
    expect(editor.markTabClean).toHaveBeenCalledWith('/ws/a.ts');
  });

  it('(R-10) an ORDINARY split-pane save completes silently — no dialog', async () => {
    shareFileInBothPanes('v1', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(false);
    const [, right] = panes();

    right.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'v1',
    });
    await Promise.resolve();
    fixture.detectChanges();

    expect(conflictDialog()).toBeNull();
    expect(editor.saveFile).toHaveBeenCalledTimes(1);
  });

  it('(AC5) a save with DIFFERENT files in the two panes never prompts', async () => {
    editor.openTabs.set([
      tab('/ws/a.ts', 'A', true),
      tab('/ws/b.ts', 'B', true),
    ]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/b.ts');
    fixture.detectChanges();
    const [, right] = panes();

    right.componentInstance.fileSaved.emit({
      filePath: '/ws/b.ts',
      content: 'B edited',
    });
    await Promise.resolve();
    fixture.detectChanges();

    expect(conflictDialog()).toBeNull();
    expect(editor.saveFile).toHaveBeenCalledWith('/ws/b.ts', 'B edited');
    // Different files: no C2 gate is armed at all, so both panes keep the
    // legacy "no information" baseline behaviour.
    expect(
      panes().map((p) => p.componentInstance.contentIsPersisted()),
    ).toEqual([undefined, undefined]);
  });

  it('(AC3) a conflicting save prompts and writes NOTHING until the user chooses', async () => {
    shareFileInBothPanes('peer edit', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'my stale text',
    });
    await Promise.resolve();
    fixture.detectChanges();

    const dialog = conflictDialog();
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(editor.saveFile).not.toHaveBeenCalled();
  });

  it('(AC3) Cancel really does abort the write', async () => {
    shareFileInBothPanes('peer edit', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'my stale text',
    });
    await Promise.resolve();
    fixture.detectChanges();

    dialogButton('Cancel')?.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(conflictDialog()).toBeNull();
    expect(editor.saveFile).not.toHaveBeenCalled();
    // The other pane's edits survive untouched in the tab record.
    expect(editor.updateTabContent).not.toHaveBeenCalled();
    expect(editor.markTabClean).not.toHaveBeenCalled();
  });

  it('(AC2) Overwrite writes, and leaves the tab record holding what was actually written', async () => {
    shareFileInBothPanes('peer edit', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'my stale text',
    });
    await Promise.resolve();
    fixture.detectChanges();

    dialogButton('Overwrite')?.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(conflictDialog()).toBeNull();
    // Without this the text the user chose to discard would be mirrored
    // straight back into both panes.
    expect(editor.updateTabContent).toHaveBeenCalledWith(
      '/ws/a.ts',
      'my stale text',
    );
    expect(editor.saveFile).toHaveBeenCalledWith('/ws/a.ts', 'my stale text');
    expect(editor.markTabClean).toHaveBeenCalledWith('/ws/a.ts');
  });

  it('maps Escape to Cancel, the non-destructive choice', async () => {
    shareFileInBothPanes('peer edit', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'my stale text',
    });
    await Promise.resolve();
    fixture.detectChanges();
    expect(conflictDialog()).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(conflictDialog()).toBeNull();
    expect(editor.saveFile).not.toHaveBeenCalled();
  });

  it('moves focus to Cancel when the dialog opens', async () => {
    shareFileInBothPanes('peer edit', true);
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);
    const [left] = panes();

    left.componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'my stale text',
    });
    await Promise.resolve();
    fixture.detectChanges();

    expect(document.activeElement).toBe(dialogButton('Cancel'));
  });

  it('(AC4) hands both panes the tab record dirty state, and only for a shared file', () => {
    shareFileInBothPanes('v0', true);
    expect(
      panes().map((p) => p.componentInstance.contentIsPersisted()),
    ).toEqual([false, false]);

    editor.openTabs.set([tab('/ws/a.ts', 'v0', false)]);
    fixture.detectChanges();
    expect(
      panes().map((p) => p.componentInstance.contentIsPersisted()),
    ).toEqual([true, true]);

    // No split at all: back to the legacy "no information" value.
    editor.splitActive.set(false);
    fixture.detectChanges();
    expect(
      panes().map((p) => p.componentInstance.contentIsPersisted()),
    ).toEqual([undefined]);
  });
});

// ---------------------------------------------------------------------------
// C2 §1.2 — the read-path invariant, pinned at the site where a regression
// would actually be introduced.
//
// `code-editor.component.spec.ts` proves that a pane which is never re-fed its
// own edits issues no pushEditOperations. That is a claim about the component's
// internal mechanism, and it holds only while the PANEL keeps its side of the
// bargain. These tests pin the panel's side: neither pane's `[content]` may be
// derived from the shared tab record while that pane has focus.
//
// This is the exact change `tasks.md` Task 7.2 asks for in its superseded,
// literal wording ("Both panes' [content] inputs derive from the tab record").
// Making it reintroduces a full-model replacement over the buffer the user is
// typing into: cursor to the end, undo stack collapsed. Without these two
// tests that change passes the entire suite.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — focused-pane read path (C2 §1.2 regression guard)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  function tab(filePath: string, content: string, isDirty: boolean) {
    return { filePath, fileName: filePath.split('/').pop(), content, isDirty };
  }

  function panes() {
    return fixture.debugElement.queryAll(By.directive(StubCodeEditorComponent));
  }

  /** Content currently held by the tab record both panes share. */
  function ownerContent(): string {
    const tabs = editor.openTabs() as Array<{
      filePath: string;
      content: string;
    }>;
    return tabs.find((t) => t.filePath === '/ws/a.ts')?.content ?? '';
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();

    // Same file in both panes, with a tab record that behaves like the real
    // one: `updateTabContent` moves the owner on every keystroke.
    editor.updateTabContent.mockImplementation(
      (filePath: string, content: string) => {
        editor.openTabs.update((tabs) =>
          (tabs as Array<{ filePath: string }>).map((t) =>
            t.filePath === filePath ? { ...t, content, isDirty: true } : t,
          ),
        );
      },
    );
    editor.openTabs.set([tab('/ws/a.ts', 'v0', false)]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.activeFileContent.set('v0');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    editor.splitFileContent.set('v0');
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('keeps the focused primary pane OFF the tab record however much is typed into it', () => {
    editor.focusedPane.set('left');
    fixture.detectChanges();
    const [left] = panes();

    let typed = 'v0';
    for (const ch of 'the quick brown fox') {
      typed += ch;
      left.componentInstance.contentChanged.emit(typed);
      fixture.detectChanges();
    }

    // The owner moved with every keystroke...
    expect(ownerContent()).toBe(typed);
    // ...and the focused pane's read surface did NOT follow it. If this
    // binding is ever derived from the tab record, the pane is handed its own
    // lagging text back and syncFile replaces the buffer under the cursor.
    expect(left.componentInstance.content()).toBe('v0');
    expect(left.componentInstance.content()).not.toBe(ownerContent());
  });

  it('binds each pane to its OWN read surface, not to the shared tab record, while it holds focus', () => {
    // Drive the owner away from both pane signals. Value equality normally
    // hides which of the two a binding reads; this state separates them, so a
    // rebinding of either pane changes an observable value.
    editor.openTabs.set([tab('/ws/a.ts', 'OWNER v1', true)]);

    editor.focusedPane.set('left');
    fixture.detectChanges();
    expect(panes()[0].componentInstance.content()).toBe('v0');
    expect(panes()[0].componentInstance.content()).not.toBe(ownerContent());

    editor.focusedPane.set('right');
    fixture.detectChanges();
    expect(panes()[1].componentInstance.content()).toBe('v0');
    expect(panes()[1].componentInstance.content()).not.toBe(ownerContent());
  });
});

// ---------------------------------------------------------------------------
// C2 — conflict dialog keyboard containment (review Serious 2).
//
// The dialog is visually blocking but was not focus-blocking: Tab walked
// straight out of it into the editor behind, and closing it dropped focus to
// the top of the document. Reachable in ordinary keyboard use, in code this
// batch introduced, one batch after this file's accessibility bar was raised.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — save-conflict dialog focus management (C2)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  /** Stands in for the Monaco host whose Ctrl+S raised the dialog. */
  let raiser: HTMLButtonElement;

  function panes() {
    return fixture.debugElement.queryAll(By.directive(StubCodeEditorComponent));
  }

  function dialogButton(label: string): HTMLButtonElement | undefined {
    return [
      ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((b) => b.textContent?.trim() === label);
  }

  function dialogBox(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[role="alertdialog"]');
  }

  async function openConflict(): Promise<void> {
    editor.openTabs.set([
      {
        filePath: '/ws/a.ts',
        fileName: 'a.ts',
        content: 'peer',
        isDirty: true,
      },
    ]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    fixture.detectChanges();
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);

    // Focus starts in the editor that is about to save, as it would after a
    // Ctrl+S landing on the Monaco host.
    raiser.focus();
    expect(document.activeElement).toBe(raiser);

    panes()[0].componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'mine',
    });
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();

    raiser = document.createElement('button');
    raiser.textContent = 'monaco-host';
    document.body.appendChild(raiser);
  });

  afterEach(() => {
    raiser.remove();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('cycles Tab between the two buttons instead of letting focus escape', async () => {
    await openConflict();
    const cancel = dialogButton('Cancel');
    const overwrite = dialogButton('Overwrite');
    expect(document.activeElement).toBe(cancel);

    const tab = (): boolean =>
      dialogBox()?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ) ?? true;

    // Cancel -> Overwrite -> Cancel, and the default action is suppressed each
    // time so the browser never walks focus into the editor behind the modal.
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(overwrite);
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(cancel);
  });

  it('contains Shift+Tab as well — two focusable elements make it the same toggle', async () => {
    await openConflict();
    const overwrite = dialogButton('Overwrite');

    dialogBox()?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.activeElement).toBe(overwrite);
  });

  it('leaves keys other than Tab alone', async () => {
    await openConflict();
    const cancel = dialogButton('Cancel');

    const notPrevented = dialogBox()?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('restores focus to the editor that raised it on Cancel', async () => {
    await openConflict();
    dialogButton('Cancel')?.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(document.activeElement).toBe(raiser);
  });

  it('restores focus to the editor that raised it on Overwrite', async () => {
    await openConflict();
    dialogButton('Overwrite')?.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(document.activeElement).toBe(raiser);
    expect(editor.saveFile).toHaveBeenCalledWith('/ws/a.ts', 'mine');
  });

  it('restores focus on Escape, and still cancels', async () => {
    await openConflict();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(dialogBox()).toBeNull();
    expect(document.activeElement).toBe(raiser);
    expect(editor.saveFile).not.toHaveBeenCalled();
  });

  it('does not throw when the element that raised the dialog has been removed', async () => {
    await openConflict();
    raiser.remove();

    expect(() => dialogButton('Cancel')?.click()).not.toThrow();
    fixture.detectChanges();
    expect(dialogBox()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FOCUSIN — keyboard focus retargets the pane (TASK_2026_173 addendum).
//
// `focusedPane` was written by the pane `(click)` handlers and NOTHING else, so
// it was a mouse-only signal. It gates two things:
//
//   1. the Ctrl+S handler in code-editor.component.ts, which declines unless
//      ITS OWN pane is the focused one — and the listener is attached per pane
//      to that pane's own Monaco host, so the left pane's handler never sees a
//      keystroke aimed at the right one. A keyboard user who tabbed into the
//      split pane could not save from it AT ALL.
//   2. `EditorDiffSplitHelper.setFocusedPane`, which cancels the pending mirror
//      and reconciles both panes against the tab record. For keyboard-only
//      users the reconciliation C2 built to close the split-pane divergence
//      window never ran — the data-integrity half of the same defect.
//
// The fix is `(focusin)` alongside `(click)` on both pane containers, routed to
// the same handler. `focusin` bubbles (`focus` does not), so focus landing on
// Monaco's hidden textarea retargets the pane; the containers are siblings, so
// neither pane's focusin can reach the other.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — keyboard focus retargets the pane (focusin)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  function panes() {
    return fixture.debugElement.queryAll(By.directive(StubCodeEditorComponent));
  }

  /**
   * Focus arriving somewhere inside a pane, exactly as the browser reports it:
   * a bubbling `focusin` dispatched at the element that received focus. No
   * mouse event of any kind is involved.
   */
  function focusInto(pane: 0 | 1): void {
    panes()[pane].nativeElement.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    fixture.detectChanges();
  }

  /** Same target, but the mouse path — proof it is still wired. */
  function clickInto(pane: 0 | 1): void {
    panes()[pane].nativeElement.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  function tabContent(): string {
    const tabs = editor.openTabs() as Array<{
      filePath: string;
      content: string;
    }>;
    return tabs.find((t) => t.filePath === '/ws/a.ts')?.content ?? '';
  }

  /**
   * Same file in both panes with the REAL EditorDiffSplitHelper behind the
   * service stub, so `setFocusedPane` performs its actual mirror-cancel +
   * reconciliation rather than being observed as a spy call. Only the two
   * signals the helper needs are shared with the panel — they are the same
   * signal instances the template binds to.
   */
  function shareFileInBothPanesWithRealHelper(): EditorDiffSplitHelper {
    const state = {
      vscodeService: {} as never,
      fileTree: signal([]),
      activeFilePath: editor.activeFilePath,
      activeFileContent: editor.activeFileContent,
      openTabs: editor.openTabs,
      isLoading: editor.isLoading,
      targetLine: signal<number | undefined>(undefined),
      splitActive: editor.splitActive,
      splitFilePath: editor.splitFilePath,
      splitFileContent: editor.splitFileContent,
      focusedPane: editor.focusedPane,
      workspaceEditorState: new Map(),
      getActiveWorkspacePath: () => '/ws',
      setActiveWorkspacePath: () => undefined,
      showError: jest.fn(),
      clearError: jest.fn(),
    } as unknown as EditorInternalState;

    const tabs = new EditorTabsHelper(state, {
      clearActiveFile: jest.fn(),
      closeSplit: jest.fn(),
    } as unknown as ConstructorParameters<typeof EditorTabsHelper>[1]);
    const helper = new EditorDiffSplitHelper(state, tabs);

    editor.setFocusedPane.mockImplementation((pane: 'left' | 'right') =>
      helper.setFocusedPane(pane),
    );
    editor.updateSplitContent.mockImplementation((content: string) =>
      helper.updateSplitContent(content),
    );
    editor.updateTabContent.mockImplementation(
      (filePath: string, content: string) =>
        tabs.updateTabContent(filePath, content),
    );

    editor.openTabs.set([
      { filePath: '/ws/a.ts', fileName: 'a.ts', content: 'v0', isDirty: false },
    ]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.activeFileContent.set('v0');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    editor.splitFileContent.set('v0');
    fixture.detectChanges();
    return helper;
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();
    // The stub's `setFocusedPane` is a bare jest.fn(); give it the one line the
    // real service performs first, so the template's gate can be observed.
    editor.setFocusedPane.mockImplementation((pane: 'left' | 'right') =>
      editor.focusedPane.set(pane),
    );

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();

    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    editor.activeFilePath.set('/ws/a.ts');
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('focus arriving in the split pane focuses it — with no click anywhere', () => {
    const clicks = jest.fn();
    fixture.nativeElement.addEventListener('click', clicks);
    expect(editor.focusedPane()).toBe('left');

    focusInto(1);

    expect(editor.setFocusedPane).toHaveBeenCalledWith('right');
    expect(editor.focusedPane()).toBe('right');
    // Not a mouse event in sight — this is the path a Tab key produces.
    expect(clicks).not.toHaveBeenCalled();
    // `[isFocused]` is the exact input the Ctrl+S handler gates on, so the save
    // gate is now open for the pane the keyboard is in, and shut for the other.
    expect(panes().map((p) => p.componentInstance.isFocused())).toEqual([
      false,
      true,
    ]);
  });

  it('focus returning to the primary pane focuses it back (both bindings, not just one)', () => {
    focusInto(1);
    expect(editor.focusedPane()).toBe('right');

    focusInto(0);

    expect(editor.focusedPane()).toBe('left');
    expect(panes().map((p) => p.componentInstance.isFocused())).toEqual([
      true,
      false,
    ]);
  });

  it('still focuses a pane on (click) — the keyboard path is added, not substituted', () => {
    clickInto(1);
    expect(editor.focusedPane()).toBe('right');

    clickInto(0);
    expect(editor.focusedPane()).toBe('left');
  });

  it('runs the C2 reconciliation and cancels the pending mirror on a KEYBOARD focus change', () => {
    shareFileInBothPanesWithRealHelper();
    editor.focusedPane.set('right');
    fixture.detectChanges();

    // Timer identity, not fake timers: the helper's setTimeout runs inside the
    // Angular zone, whose patched timer functions are captured before any fake
    // clock could replace them. Spying on the globals observes the real calls.
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

    // The user types in the SPLIT pane. The tab record moves; the left pane is
    // deliberately left behind until the mirror debounce elapses.
    panes()[1].componentInstance.contentChanged.emit('v0 + right pane edit');
    fixture.detectChanges();

    expect(tabContent()).toBe('v0 + right pane edit');
    expect(editor.activeFileContent()).toBe('v0');
    expect(setTimeoutSpy).toHaveBeenCalled();
    const mirrorTimer = setTimeoutSpy.mock.results.at(-1)?.value as unknown;
    clearTimeoutSpy.mockClear();

    // Keyboard focus moves to the primary pane. No click, and no waiting for
    // the debounce: the reconciliation must have already happened.
    focusInto(0);

    expect(editor.focusedPane()).toBe('left');
    expect(editor.activeFileContent()).toBe('v0 + right pane edit');
    // ...and the now-redundant mirror was cancelled rather than left armed.
    expect(clearTimeoutSpy).toHaveBeenCalledWith(mirrorTimer);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// FOCUSIN — the whole keyboard save chain, with the REAL CodeEditorComponent.
//
// The block above pins the binding and the reconciliation against the service.
// This one closes the loop the bug was actually reported as: focus reaches the
// split pane without a click, Ctrl+S on that pane's Monaco host, and the file
// is written with THAT pane's text. Monaco is faked (one editor per `create`
// call, as the two panes really do get) so the component's own keydown gate
// runs for real.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — a keyboard user can save from the split pane', () => {
  interface PaneModel {
    uri: { toString: () => string };
    _value: string;
    getValue: () => string;
    setValue: (v: string) => void;
    getFullModelRange: () => unknown;
    pushEditOperations: (a: unknown, edits: Array<{ text: string }>) => null;
    getLanguageId: () => string;
    onDidChangeContent: () => { dispose: () => void };
    dispose: () => void;
  }

  interface PaneEditor {
    _active: PaneModel | null;
    setModel: (m: PaneModel | null) => void;
    getModel: () => PaneModel | null;
    onDidChangeModelContent: (cb: () => void) => { dispose: () => void };
    saveViewState: () => unknown;
    restoreViewState: (s: unknown) => void;
    revealLineInCenter: (l: number) => void;
    setPosition: (p: unknown) => void;
    layout: () => void;
    updateOptions: (o: unknown) => void;
    dispose: () => void;
    getDomNode: () => HTMLElement;
  }

  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  let editorsByHost: Map<HTMLElement, PaneEditor>;

  function makeMonaco() {
    const registry = new Map<string, PaneModel>();
    editorsByHost = new Map<HTMLElement, PaneEditor>();

    function makeModel(
      value: string,
      lang: string,
      uri: { toString: () => string },
    ): PaneModel {
      const model: PaneModel = {
        uri,
        _value: value,
        getValue: () => model._value,
        setValue: (v: string) => {
          model._value = v;
        },
        getFullModelRange: () => ({}),
        pushEditOperations: (_a, edits) => {
          model._value = edits[0].text;
          return null;
        },
        getLanguageId: () => lang,
        onDidChangeContent: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
      };
      return model;
    }

    return {
      editor: {
        // One editor instance per pane, keyed by the host it was mounted into —
        // the same element the component attaches its keydown listener to.
        create: (host: HTMLElement) => {
          const ed: PaneEditor = {
            _active: null,
            setModel: (m) => {
              ed._active = m;
            },
            getModel: () => ed._active,
            onDidChangeModelContent: () => ({ dispose: () => undefined }),
            saveViewState: () => ({}),
            restoreViewState: () => undefined,
            revealLineInCenter: () => undefined,
            setPosition: () => undefined,
            layout: () => undefined,
            updateOptions: () => undefined,
            dispose: () => undefined,
            getDomNode: () => host,
          };
          editorsByHost.set(host, ed);
          return ed;
        },
        createModel: (
          value: string,
          lang: string,
          uri: { toString: () => string },
        ) => {
          const m = makeModel(value, lang, uri);
          registry.set(uri.toString(), m);
          return m;
        },
        getModel: (uri: { toString: () => string }) =>
          registry.get(uri.toString()) ?? null,
        setModelLanguage: () => undefined,
        setTheme: () => undefined,
      },
      Uri: { parse: (s: string) => ({ toString: () => s }) },
    };
  }

  /** The two Monaco host elements, in DOM order: primary pane, split pane. */
  function monacoHosts(): HTMLElement[] {
    return [
      ...fixture.nativeElement.querySelectorAll<HTMLElement>(
        '[data-testid="editor-monaco"] > div',
      ),
    ];
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  /** Put text in the model of the pane mounted into `host`, as typing would. */
  function typeInto(host: HTMLElement, text: string): void {
    const model = editorsByHost.get(host)?.getModel();
    expect(model).toBeDefined();
    if (model) model._value = text;
  }

  /** Focus lands on Monaco's hidden textarea, which lives inside the host. */
  function tabInto(host: HTMLElement): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    host.appendChild(textarea);
    textarea.focus();
    fixture.detectChanges();
    return textarea;
  }

  function pressCtrlS(host: HTMLElement): void {
    host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
    );
  }

  beforeEach(async () => {
    editor = makeEditorServiceStub();
    editor.setFocusedPane.mockImplementation((pane: 'left' | 'right') =>
      editor.focusedPane.set(pane),
    );

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
        {
          provide: MonacoLoaderService,
          useValue: { load: jest.fn(() => Promise.resolve(makeMonaco())) },
        },
      ],
    });

    // Everything stubbed EXCEPT the code editor — its Ctrl+S gate is the thing
    // under test here.
    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          CodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();

    // One file, open in both panes, keyboard focus starting in the primary one.
    editor.openTabs.set([
      { filePath: '/ws/a.ts', fileName: 'a.ts', content: 'v0', isDirty: false },
    ]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.activeFileContent.set('v0');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    editor.splitFileContent.set('v0');
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await flush();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('Tab into the split pane, Ctrl+S, and THAT pane’s text is written', async () => {
    const [leftHost, rightHost] = monacoHosts();
    expect(editorsByHost.get(rightHost)).toBeDefined();

    // Before the focus moves, a Ctrl+S aimed at the split pane is declined —
    // this is the bug, and it is what makes the assertion after it meaningful.
    typeInto(rightHost, 'typed with the keyboard');
    pressCtrlS(rightHost);
    await flush();
    expect(editor.saveFile).not.toHaveBeenCalled();

    // A keyboard user tabs in. No click of any kind.
    const textarea = tabInto(rightHost);

    expect(document.activeElement).toBe(textarea);
    expect(editor.focusedPane()).toBe('right');

    pressCtrlS(rightHost);
    await flush();

    expect(editor.saveFile).toHaveBeenCalledWith(
      '/ws/a.ts',
      'typed with the keyboard',
    );
    expect(editor.markTabClean).toHaveBeenCalledWith('/ws/a.ts');
    // The primary pane's own handler stayed shut: the save came from the pane
    // the keyboard was actually in, not from whichever pane happened to be
    // marked focused.
    expect(editor.saveFile).toHaveBeenCalledTimes(1);
    expect(leftHost).toBeDefined();
  });

  it('hands the save gate back to the primary pane when focus returns to it', async () => {
    const [leftHost, rightHost] = monacoHosts();

    tabInto(rightHost);
    expect(editor.focusedPane()).toBe('right');

    tabInto(leftHost);
    expect(editor.focusedPane()).toBe('left');

    typeInto(leftHost, 'primary pane text');
    pressCtrlS(leftHost);
    await flush();

    expect(editor.saveFile).toHaveBeenCalledWith(
      '/ws/a.ts',
      'primary pane text',
    );
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_216 — the delete-confirm and name-input dialogs.
//
// These two were the last `<div class="modal modal-open z-50">` wrappers in the
// panel, and they now use the native-dialog + `showModal()` shape TASK_2026_227
// gave the revert and save-conflict dialogs: the top layer is painted after the
// whole document, so reachability stops depending on how a z-index happens to
// resolve inside the gridstack tile.
//
// The carrier claims they shared the revert dialog's mouse-unanswerable defect.
// They did not — they are declared OUTSIDE the `isolation: isolate` wrapper that
// trapped that one, and a live probe on the pre-fix markup found the buttons on
// top rather than the canvas. See the header of
// `apps/ptah-electron-e2e/src/specs/editor/file-ops-dialogs-top-layer.spec.ts`
// for the evidence. What is fixed here is the accessibility shape the task was
// originally filed for, plus that hardening.
//
// What jsdom can hold: that the element IS a `<dialog>`, that `showModal()` is
// what opens it, that `close()` runs while the node is still in the document,
// that the UA's own Escape route is bound, and that the backdrop is inert.
// What jsdom CANNOT hold: the top layer itself. It has no layout, no
// compositing and no hit-testing. The mouse-level check lives in Electron.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — file-ops dialogs live in the top layer (TASK_2026_216)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  let showModalSpy: jest.SpyInstance;
  let closeSpy: jest.SpyInstance;
  /** `isConnected` of each dialog at the instant `close()` was called on it. */
  let connectedAtClose: boolean[];
  /** Stands in for the file-tree row the context menu was raised from. */
  let raiser: HTMLButtonElement;

  const FILE_NODE = { path: '/ws/src/a.ts', name: 'a.ts', type: 'file' };
  const DIR_NODE = { path: '/ws/src', name: 'src', type: 'directory' };

  /** Drive the real path: file-tree context menu → menu action → dialog. */
  function chooseMenuAction(type: string, node: unknown): void {
    const sidebar = fixture.debugElement.query(
      By.directive(StubSidebarComponent),
    );
    sidebar.componentInstance.contextMenuRequested.emit({
      event: new MouseEvent('contextmenu', {
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
      node,
    });
    fixture.detectChanges();

    const menu = fixture.debugElement.query(
      By.directive(StubContextMenuComponent),
    );
    menu.componentInstance.action.emit({ type, node });
    fixture.detectChanges();
  }

  function deleteDialog(): HTMLDialogElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="delete-confirm-dialog"]',
    );
  }

  function nameDialog(): HTMLDialogElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="name-input-dialog"]',
    );
  }

  function byTestId<T extends HTMLElement>(id: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();
    connectedAtClose = [];

    showModalSpy = jest.spyOn(HTMLDialogElement.prototype, 'showModal');
    closeSpy = jest
      .spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        connectedAtClose.push(this.isConnected);
        this.removeAttribute('open');
      } as HTMLDialogElement['close']);

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    raiser = document.createElement('button');
    raiser.textContent = 'file row';
    document.body.appendChild(raiser);
    raiser.focus();

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    raiser.remove();
    showModalSpy.mockRestore();
    closeSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -- delete confirmation ---------------------------------------------------

  it('(216-D1) the delete confirmation is a native <dialog> opened with showModal(), not a positioned div', () => {
    chooseMenuAction('delete', FILE_NODE);

    const dialog = deleteDialog();
    expect(dialog).toBeTruthy();
    expect(dialog?.tagName).toBe('DIALOG');
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    expect(showModalSpy.mock.instances[0]).toBe(dialog);
  });

  it('(216-D2) carries NO modal-open class — daisyUI would re-apply the wrapper scrim over ::backdrop', () => {
    chooseMenuAction('delete', FILE_NODE);

    expect(deleteDialog()?.classList.contains('modal')).toBe(true);
    expect(deleteDialog()?.classList.contains('modal-open')).toBe(false);
    // ...and nowhere else in the panel either.
    expect(fixture.nativeElement.querySelectorAll('.modal-open').length).toBe(
      0,
    );
  });

  it('(216-D3) is an alertdialog that is both named and described', () => {
    chooseMenuAction('delete', DIR_NODE);

    const dialog = deleteDialog();
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog?.getAttribute('aria-labelledby');
    const descId = dialog?.getAttribute('aria-describedby');
    expect(dialog?.querySelector('#' + labelId)?.textContent).toContain(
      'Delete src?',
    );
    expect(dialog?.querySelector('#' + descId)?.textContent).toContain(
      'permanently delete the folder',
    );
  });

  it('(216-D4) opens with focus on Cancel, the non-destructive choice', () => {
    chooseMenuAction('delete', FILE_NODE);

    expect(document.activeElement).toBe(byTestId('delete-confirm-cancel'));
  });

  it('(216-D5) leaves the top layer BEFORE the node is unmounted', () => {
    chooseMenuAction('delete', FILE_NODE);

    byTestId<HTMLButtonElement>('delete-confirm-cancel')?.click();

    // close() ran, and it ran while the element was still in the document: an
    // element removed while still `open` skips its close steps entirely.
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(connectedAtClose).toEqual([true]);

    fixture.detectChanges();
    expect(deleteDialog()).toBeNull();
    expect(editor.deleteItem).not.toHaveBeenCalled();
  });

  it('(216-D6) the backdrop is inert — clicking it cannot answer the confirmation', () => {
    chooseMenuAction('delete', FILE_NODE);

    const backdrop = deleteDialog()?.querySelector('.modal-backdrop');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    // No <form method="dialog"> either: that is daisyUI's click-to-close idiom.
    expect(deleteDialog()?.querySelector('form[method="dialog"]')).toBeNull();

    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(deleteDialog()).not.toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("(216-D7) binds the UA's own close request, so Escape cannot orphan the open state", () => {
    chooseMenuAction('delete', FILE_NODE);

    const event = new Event('cancel', { cancelable: true });
    deleteDialog()?.dispatchEvent(event);
    fixture.detectChanges();

    // Left to the UA this would close the element with deleteTarget still set:
    // a live confirmation the user can no longer see.
    expect(event.defaultPrevented).toBe(true);
    expect(deleteDialog()).toBeNull();
    expect(editor.deleteItem).not.toHaveBeenCalled();
  });

  it('(216-D8) Delete deletes exactly the target and closes', () => {
    chooseMenuAction('delete', DIR_NODE);

    byTestId<HTMLButtonElement>('delete-confirm-accept')?.click();
    fixture.detectChanges();

    expect(editor.deleteItem).toHaveBeenCalledWith('/ws/src', true);
    expect(connectedAtClose).toEqual([true]);
    expect(deleteDialog()).toBeNull();
  });

  it('(216-D9) hands focus back to whatever raised it, and does not throw when that is gone', () => {
    chooseMenuAction('delete', FILE_NODE);
    expect(document.activeElement).not.toBe(raiser);

    byTestId<HTMLButtonElement>('delete-confirm-cancel')?.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(raiser);

    // A file-tree row can be re-rendered out of existence while the dialog is
    // open; the restore is guarded on isConnected rather than assumed.
    raiser.focus();
    chooseMenuAction('delete', FILE_NODE);
    raiser.remove();
    expect(() =>
      byTestId<HTMLButtonElement>('delete-confirm-cancel')?.click(),
    ).not.toThrow();
  });

  // -- name input (new file / new folder / rename) ---------------------------

  it('(216-N1) the name dialog is a native <dialog> opened with showModal()', () => {
    chooseMenuAction('rename', FILE_NODE);

    const dialog = nameDialog();
    expect(dialog?.tagName).toBe('DIALOG');
    expect(dialog?.classList.contains('modal-open')).toBe(false);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    expect(showModalSpy.mock.instances[0]).toBe(dialog);
  });

  it('(216-N2) focuses the input and pre-selects the name stem, without the removed .modal-open lookup', () => {
    chooseMenuAction('rename', FILE_NODE);

    const input = nameDialog()?.querySelector('input');
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe('a.ts');
    // Stem only: typing replaces the name and keeps the extension.
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(1);
  });

  it('(216-N3) leaves the top layer before unmounting, and runs the callback after', () => {
    chooseMenuAction('rename', FILE_NODE);

    const input = nameDialog()?.querySelector('input') as HTMLInputElement;
    input.value = 'b.ts';
    byTestId<HTMLButtonElement>('name-input-accept')?.click();
    fixture.detectChanges();

    expect(connectedAtClose).toEqual([true]);
    expect(nameDialog()).toBeNull();
    expect(editor.renameItem).toHaveBeenCalledWith(
      '/ws/src/a.ts',
      '/ws/src/b.ts',
    );
  });

  it("(216-N4) binds the UA's close request, so Escape closes it without running the callback", () => {
    chooseMenuAction('newFile', DIR_NODE);

    const event = new Event('cancel', { cancelable: true });
    nameDialog()?.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(nameDialog()).toBeNull();
    expect(editor.createFile).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(raiser);
  });

  it('(216-N5) a rejected name leaves the caret where the user left it', () => {
    chooseMenuAction('rename', FILE_NODE);
    const input = nameDialog()?.querySelector('input') as HTMLInputElement;

    input.value = '   ';
    byTestId<HTMLButtonElement>('name-input-accept')?.click();
    fixture.detectChanges();

    expect(nameDialog()).not.toBeNull();
    expect(byTestId('name-input-dialog')?.textContent).toContain(
      'Name cannot be empty.',
    );
    expect(editor.renameItem).not.toHaveBeenCalled();
    // The open-effect must NOT have re-run and re-selected the text the user is
    // in the middle of correcting.
    expect(input.value).toBe('   ');
    expect(showModalSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_212 — closing the split without cancelling the click.
//
// `closeSplit` used to call `stopPropagation()`. The register that filed this
// read it as a leftover on the grounds that the close button is a SIBLING of
// the pane container, the way the tab-strip close button is a sibling of the
// tab button (D1 AC5). It is not: it is a descendant, two levels inside the
// header bar, and the pane container carries `(click)="onPaneClick('right')"`.
//
// So the prescribed one-line deletion was a regression. `closeSplit` on the
// helper ends with `focusedPane.set('left')`, and the click that closed the
// split then bubbled on to `onPaneClick('right')` and put it back — a right
// pane marked focused with no right pane, and a reconcile pass run for it.
// The suppression is gone and the invariant is stated on the receiver instead,
// which also covers routes a stopPropagation on this one handler never could.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — closing the split (TASK_2026_212)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;

  function closeButton(): HTMLButtonElement {
    const button = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[aria-label="Close split pane"]',
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function rightPaneContainer(): HTMLElement {
    // The element that carries the pane-focus handlers: the close button's
    // grandparent. Asserted rather than assumed — the whole task turns on this
    // containment, and a future de-nesting should fail here loudly.
    const container = closeButton().parentElement?.parentElement;
    expect(container).toBeTruthy();
    return container as HTMLElement;
  }

  function openSplit(): void {
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    editor.focusedPane.set('right');
    fixture.detectChanges();
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('(212-1) the close button is INSIDE the pane container that handles pane focus', () => {
    openSplit();

    // The premise the register got wrong, pinned so it cannot rot silently.
    expect(rightPaneContainer().contains(closeButton())).toBe(true);
  });

  it('(212-2) the click is allowed to propagate — nothing is cancelled any more', () => {
    openSplit();

    let reachedContainer = false;
    rightPaneContainer().addEventListener('click', () => {
      reachedContainer = true;
    });

    closeButton().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(editor.closeSplit).toHaveBeenCalledTimes(1);
    expect(reachedContainer).toBe(true);
  });

  it('(212-3) closing does not leave a focused right pane behind', () => {
    openSplit();
    expect(editor.focusedPane()).toBe('right');

    closeButton().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    // closeSplit set it to 'left'; the click that bubbled afterwards must not
    // have put it back.
    expect(editor.splitActive()).toBe(false);
    expect(editor.focusedPane()).toBe('left');
    expect(editor.setFocusedPane).not.toHaveBeenCalledWith('right');
  });

  it('(212-4) an ordinary click in the right pane still focuses it', () => {
    openSplit();
    editor.focusedPane.set('left');

    rightPaneContainer().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    // The guard is about a pane that does not exist, not about suppressing the
    // handler generally.
    expect(editor.setFocusedPane).toHaveBeenCalledWith('right');
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_214 — saying that the panes disagree.
//
// Cancel on the save-conflict dialog writes nothing and reconciles nothing, on
// purpose: reconciling there would destroy the edits Cancel was pressed to
// protect. So the panes are knowingly left holding different text, and the
// only cue was the tab strip's dirty dot — which cannot tell "this pane has
// unsaved edits" apart from "the other pane disagrees with what you are
// looking at".
//
// The register proposed `hasUnabsorbedPeerEdit(splitFilePath(),
// splitFileContent())` as the predicate. TASK_2026_213 — the commit before
// this one — made `splitFileContent` a deliberately stale read surface, so
// that expression is now false-positive by construction: it is true for the
// whole mirror-debounce window after any keystroke in the other pane. The chip
// is gated on a cancelled conflict instead, which is both the narrower thing
// and the thing that was actually filed.
// ---------------------------------------------------------------------------
describe('EditorPanelComponent — diverged split panes (TASK_2026_214)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  /**
   * Backs the stubbed `hasUnabsorbedPeerEdit` with a SIGNAL.
   *
   * The chip is a `computed` over that predicate, and the real implementation
   * reads `splitActive`, `splitFilePath`, `activeFilePath` and `openTabs` — so
   * in production the chip re-evaluates whenever the tab record changes. A
   * `mockReturnValue` has no signal behind it, so a spec built on one would
   * assert that the chip never updates and would have passed against a
   * component that could not clear it.
   */
  let peerEditUnabsorbed: ReturnType<typeof signal<boolean>>;

  function tab(filePath: string, content: string, isDirty: boolean) {
    return {
      filePath,
      fileName: filePath.split('/').pop(),
      content,
      isDirty,
    };
  }

  function shareFileInBothPanes(): void {
    editor.openTabs.set([tab('/ws/a.ts', 'peer edit', true)]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    fixture.detectChanges();
  }

  function chip(): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="split-pane-diverged"]',
    );
  }

  function dialogButton(label: string): HTMLButtonElement | undefined {
    return [
      ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((b) => b.textContent?.trim() === label);
  }

  /** Save from the split pane into a conflict, and answer the dialog. */
  async function conflictThen(answer: 'Cancel' | 'Overwrite'): Promise<void> {
    peerEditUnabsorbed.set(true);
    const panes = fixture.debugElement.queryAll(
      By.directive(StubCodeEditorComponent),
    );
    panes[1].componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'this pane text',
    });
    await Promise.resolve();
    fixture.detectChanges();
    expect(dialogButton(answer)).toBeTruthy();
    dialogButton(answer)?.click();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();
    peerEditUnabsorbed = signal(false);
    editor.hasUnabsorbedPeerEdit.mockImplementation(() => peerEditUnabsorbed());

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('(214-1) an ordinary split session says nothing about divergence', () => {
    shareFileInBothPanes();

    expect(chip()).toBeNull();
  });

  it('(214-2) the raw predicate alone is NOT enough — that is the false positive the register would have shipped', () => {
    shareFileInBothPanes();
    // True for the whole mirror-debounce window after any keystroke in the
    // other pane, which is most of the time while someone is typing.
    peerEditUnabsorbed.set(true);
    fixture.detectChanges();

    expect(chip()).toBeNull();
  });

  it('(214-3) Cancel leaves the panes marked as disagreeing', async () => {
    shareFileInBothPanes();

    await conflictThen('Cancel');

    const badge = chip();
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('Diverged');
    expect(badge?.getAttribute('role')).toBe('status');
    // It says which way round the disagreement runs, since the dirty dot could
    // not.
    expect(badge?.getAttribute('title')).toContain('other pane');
    // Cancel still wrote nothing.
    expect(editor.saveFile).not.toHaveBeenCalled();
  });

  it('(214-4) Overwrite resolves the question, so nothing is marked diverged', async () => {
    shareFileInBothPanes();

    await conflictThen('Overwrite');

    expect(chip()).toBeNull();
    expect(editor.saveFile).toHaveBeenCalledWith('/ws/a.ts', 'this pane text');
  });

  it('(214-5) clears itself once the panes reconcile — no explicit teardown to forget', async () => {
    shareFileInBothPanes();
    await conflictThen('Cancel');
    expect(chip()).toBeTruthy();

    // What a focus change does: both panes brought onto the tab record, so the
    // save path would no longer prompt either.
    peerEditUnabsorbed.set(false);
    fixture.detectChanges();

    expect(chip()).toBeNull();
  });

  it('(214-7) answering a LATER conflict with Overwrite clears an earlier Cancel', async () => {
    shareFileInBothPanes();
    await conflictThen('Cancel');
    expect(chip()).toBeTruthy();

    // The predicate is unchanged by Cancel, so the next save re-prompts — and
    // this time the user overwrites. In production the tab record then goes
    // clean and the predicate falls false on its own; the explicit clear is
    // what makes that independent of the predicate.
    await conflictThen('Overwrite');

    expect(peerEditUnabsorbed()).toBe(true);
    expect(chip()).toBeNull();
  });

  it('(214-6) does not follow the split pane to a different file', async () => {
    shareFileInBothPanes();
    await conflictThen('Cancel');
    expect(chip()).toBeTruthy();

    editor.splitFilePath.set('/ws/other.ts');
    fixture.detectChanges();

    expect(chip()).toBeNull();
  });
});
