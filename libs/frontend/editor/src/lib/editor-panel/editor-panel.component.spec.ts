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
});

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
  return {
    isLoading,
    activeFilePath,
    activeFileContent: signal(''),
    hasActiveFile: computed(() => !!activeFilePath()),
    activeDiffTab: signal<unknown>(null),
    isActiveFileImage: signal(false),
    openTabs: signal<unknown[]>([]),
    splitActive: signal(false),
    focusedPane: signal<'left' | 'right'>('left'),
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
    hasUnabsorbedPeerEdit: jest.Mock;
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

  function mouseDownOn(label: string): void {
    const handle: HTMLElement = fixture.nativeElement.querySelector(
      `[role="separator"][aria-label="${label}"]`,
    );
    expect(handle).toBeTruthy();
    // Angular's own rendering can arm frames (afterNextRender); zero the
    // counters here so every assertion below counts drag-armed frames only.
    rafSpy.mockClear();
    frames.clear();
    handle.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function moveTo(x: number, y = 100): void {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
    );
  }

  function releaseMouse(): void {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
    mouseDownOn('Resize sidebar');

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

    releaseMouse();
  });

  it('cancels the pending frame on mouseup and still applies the release position', () => {
    mouseDownOn('Resize sidebar');

    moveTo(150);
    moveTo(190);
    expect(frames.size).toBe(1);

    releaseMouse();

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
    mouseDownOn('Resize sidebar');
    moveTo(5000);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(480);

    moveTo(-5000);
    tickFrame();
    expect(readSignal('sidebarWidth')).toBe(160);

    releaseMouse();
  });

  it('cancels a pending frame on destroy so no update lands after teardown', () => {
    mouseDownOn('Resize sidebar');
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

    mouseDownOn('Resize terminal');
    moveTo(100, 90);
    moveTo(100, 80);
    moveTo(100, 70);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(editor.setTerminalHeight).not.toHaveBeenCalled();

    tickFrame();
    expect(editor.setTerminalHeight).toHaveBeenCalledTimes(1);

    releaseMouse();
  });

  it('coalesces the split divider drag the same way', () => {
    editor.splitActive.set(true);
    fixture.detectChanges();

    mouseDownOn('Resize split panes');
    moveTo(150);
    moveTo(200);
    moveTo(250);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(readSignal('splitLeftPercent')).toBe(50);

    tickFrame();
    // jsdom reports a zero-width container, so any rightward drag saturates the
    // clamp — what matters here is that exactly one update landed for three events.
    expect(readSignal('splitLeftPercent')).toBe(80);

    releaseMouse();
  });

  // ---------------------------------------------------------------------------
  // TASK_2026_176 — blur + Escape interruption (folded here from Task 4.4)
  // ---------------------------------------------------------------------------

  it('restores the sidebar width and cancels the frame on window blur', () => {
    mouseDownOn('Resize sidebar');
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
    mouseDownOn('Resize sidebar');
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

    mouseDownOn('Resize terminal');
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

    mouseDownOn('Resize split panes');
    moveTo(5000);
    expect(frames.size).toBe(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(readSignal('splitLeftPercent')).toBe(50);
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
