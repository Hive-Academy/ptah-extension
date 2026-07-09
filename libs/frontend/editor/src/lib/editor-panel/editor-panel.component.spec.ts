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
  readonly filePath = input<string | undefined>(undefined);
  readonly originalContent = input<string>('');
  readonly modifiedContent = input<string>('');
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
  readonly diffRequested = output<string>();
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
