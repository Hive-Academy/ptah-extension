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
import { diffTabKey } from '../services/editor/editor-tab.types';

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
  } as unknown as EditorService & {
    isLoading: ReturnType<typeof signal<boolean>>;
    activeFilePath: ReturnType<typeof signal<string | undefined>>;
    openTabs: ReturnType<typeof signal<unknown[]>>;
    terminalVisible: ReturnType<typeof signal<boolean>>;
    splitActive: ReturnType<typeof signal<boolean>>;
    setTerminalHeight: jest.Mock;
    switchTab: jest.Mock;
    closeTab: jest.Mock;
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
