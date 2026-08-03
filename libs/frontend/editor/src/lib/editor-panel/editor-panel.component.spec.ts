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
  } as unknown as EditorService & {
    isLoading: ReturnType<typeof signal<boolean>>;
    activeFilePath: ReturnType<typeof signal<string | undefined>>;
    terminalVisible: ReturnType<typeof signal<boolean>>;
    splitActive: ReturnType<typeof signal<boolean>>;
    setTerminalHeight: jest.Mock;
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
});
