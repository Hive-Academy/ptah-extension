import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  inject,
  DestroyRef,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorComponent } from 'ngx-monaco-editor-v2';
import { MarkdownComponent } from 'ngx-markdown';
import { LucideAngularModule, Eye, Code } from 'lucide-angular';
import { VimModeService } from '../services/vim-mode.service';
import { EditorService } from '../services/editor.service';

/**
 * CodeEditorComponent - Monaco editor wrapper with language detection and save support.
 *
 * Complexity Level: 2 (Medium - Monaco integration, keyboard shortcuts, language detection)
 * Patterns: Standalone component, signal-based state, computed properties
 *
 * Features:
 * - Monaco editor with vs-dark theme and automatic layout
 * - Language auto-detection from file extension
 * - Ctrl+S / Cmd+S keyboard shortcut for saving (scoped to active file)
 * - Content change events for parent synchronization
 * - Empty state when no file is open
 * - Reactive content sync via effect() watching content/filePath inputs
 */
@Component({
  selector: 'ptah-code-editor',
  standalone: true,
  imports: [
    FormsModule,
    EditorComponent,
    MarkdownComponent,
    LucideAngularModule,
  ],
  template: `
    @if (filePath()) {
      <div class="h-full w-full flex flex-col">
        <div
          class="flex items-center gap-2 px-3 py-1.5 bg-base-300 border-b border-base-300 text-xs"
        >
          <span class="opacity-60 truncate" [attr.title]="filePath()">{{
            fileName()
          }}</span>
          @if (isDirty()) {
            <span class="badge badge-xs badge-warning">Modified</span>
          }
          <div class="ml-auto flex items-center">
            @if (isMarkdownFile()) {
              <button
                class="btn btn-ghost btn-xs gap-1"
                [attr.aria-label]="
                  showPreview() ? 'Switch to editor' : 'Switch to preview'
                "
                [title]="showPreview() ? 'Edit markdown' : 'Preview markdown'"
                (click)="togglePreview()"
              >
                <lucide-angular
                  [img]="showPreview() ? CodeIcon : EyeIcon"
                  class="w-3.5 h-3.5"
                />
                <span>{{ showPreview() ? 'Edit' : 'Preview' }}</span>
              </button>
            }
          </div>
        </div>
        <div class="flex-1 min-h-0">
          @if (showPreview() && isMarkdownFile()) {
            <div
              class="h-full overflow-y-auto bg-base-100 p-6 prose prose-invert max-w-none"
            >
              <markdown [data]="editorContent" />
            </div>
          } @else {
            <ngx-monaco-editor
              class="h-full"
              [options]="editorOptions()"
              [(ngModel)]="editorContent"
              (ngModelChange)="onContentChange()"
              (onInit)="onEditorInit($event)"
            />
          }
        </div>
        @if (vimModeService.enabled() && isFocused()) {
          <div
            #vimStatusBar
            class="h-6 bg-base-300 border-t border-base-content/10 text-xs px-2 flex items-center font-mono text-base-content/70 flex-shrink-0"
            aria-label="Vim status"
          ></div>
        }
      </div>
    } @else {
      <div class="h-full w-full flex items-center justify-center bg-base-100">
        <div class="text-center opacity-40">
          <p class="text-lg mb-2">No file open</p>
          <p class="text-sm">
            Select a file from the explorer to start editing
          </p>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
    ngx-monaco-editor {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeEditorComponent implements OnInit {
  readonly filePath = input<string | undefined>(undefined);
  readonly content = input<string>('');

  /**
   * Whether this editor pane currently has focus.
   * When false, vim mode is detached from this instance.
   * Defaults to true for non-split (single pane) usage.
   */
  readonly isFocused = input(true);

  readonly contentChanged = output<string>();
  readonly fileSaved = output<{ filePath: string; content: string }>();

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vimModeService = inject(VimModeService);
  private readonly editorService = inject(EditorService);

  /** Reference to the vim status bar DOM element. */
  @ViewChild('vimStatusBar') vimStatusBarRef?: ElementRef<HTMLElement>;

  /** The Monaco editor instance, captured from onEditorInit. */
  private monacoEditor: unknown = null;

  protected editorContent = '';
  private lastSavedContent = '';

  readonly isDirty = signal(false);
  readonly showPreview = signal(false);

  // Icons
  readonly EyeIcon = Eye;
  readonly CodeIcon = Code;

  /** Whether the current file is a markdown file */
  readonly isMarkdownFile = computed(() => {
    const path = this.filePath();
    if (!path) return false;
    return path.toLowerCase().endsWith('.md');
  });

  readonly fileName = computed(() => {
    const path = this.filePath();
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  });

  readonly editorOptions = computed(() => ({
    theme: 'vs-dark',
    language: this.detectLanguage(this.filePath()),
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: true },
    fontSize: 14,
    wordWrap: 'on' as const,
    readOnly: false,
  }));

  constructor() {
    effect(() => {
      const newContent = this.content();
      const newPath = this.filePath();
      // Only update if we have a path (skip initial empty state)
      if (newPath !== undefined) {
        this.editorContent = newContent;
        this.lastSavedContent = newContent;
        this.isDirty.set(false);
        // Reset preview when switching files
        this.showPreview.set(false);
      }
    });

    // Vim mode attachment effect: watch enabled state AND isFocused state.
    // Vim mode only attaches to the focused pane's editor. When isFocused becomes
    // false (e.g., user clicks the other split pane), vim detaches from this instance.
    // The @ViewChild inside @if means vimStatusBarRef is only available after the @if renders,
    // so we use a microtask to wait for the DOM update.
    effect(() => {
      const enabled = this.vimModeService.enabled();
      const focused = this.isFocused();
      if (enabled && focused && this.monacoEditor) {
        // Defer to allow the @if block to render the #vimStatusBar element
        Promise.resolve().then(() => {
          if (this.vimStatusBarRef?.nativeElement && this.monacoEditor) {
            this.vimModeService.attachToEditor(
              this.monacoEditor,
              this.vimStatusBarRef.nativeElement,
            );
          }
        });
      } else if (!enabled || !focused) {
        this.vimModeService.detach();
      }
    });

    // Clean up vim mode when the component is destroyed
    this.destroyRef.onDestroy(() => {
      this.vimModeService.detach();
    });

    // Watch targetLine from EditorService and reveal line in Monaco when set.
    // This is a one-shot signal: read it, reveal, then clear.
    effect(() => {
      const line = this.editorService.targetLine();
      if (line !== undefined && this.monacoEditor) {
        const editor = this.monacoEditor as {
          revealLineInCenter: (line: number) => void;
          setPosition: (pos: { lineNumber: number; column: number }) => void;
        };
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        this.editorService.clearTargetLine();
      }
    });
  }

  ngOnInit(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        // Only handle save when this pane has focus and has an active file
        if (this.isFocused() && this.filePath()) {
          event.preventDefault();
          this.saveFile();
        }
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    this.destroyRef.onDestroy(() => {
      if (this.keydownHandler) {
        document.removeEventListener('keydown', this.keydownHandler);
      }
    });
  }

  protected togglePreview(): void {
    this.showPreview.update((v) => !v);
  }

  protected onEditorInit(editor: unknown): void {
    // Capture the Monaco editor instance for vim mode attachment
    this.monacoEditor = editor;

    // If vim mode is already enabled and this pane is focused,
    // attach immediately once the status bar element is available
    if (this.vimModeService.enabled() && this.isFocused()) {
      Promise.resolve().then(() => {
        if (this.vimStatusBarRef?.nativeElement && this.monacoEditor) {
          this.vimModeService.attachToEditor(
            this.monacoEditor,
            this.vimStatusBarRef.nativeElement,
          );
        }
      });
    }
  }

  /**
   * Called when ngModel value changes (content edited by user).
   * Updates the dirty state and emits content change events.
   */
  protected onContentChange(): void {
    this.isDirty.set(this.editorContent !== this.lastSavedContent);
    this.contentChanged.emit(this.editorContent);
  }

  private saveFile(): void {
    const path = this.filePath();
    if (!path) return;

    this.lastSavedContent = this.editorContent;
    this.isDirty.set(false);
    this.fileSaved.emit({ filePath: path, content: this.editorContent });
  }

  private detectLanguage(filePath?: string): string {
    if (!filePath) return 'plaintext';
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      svg: 'xml',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      ps1: 'powershell',
      dockerfile: 'dockerfile',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      env: 'dotenv',
      graphql: 'graphql',
      gql: 'graphql',
      r: 'r',
      lua: 'lua',
      dart: 'dart',
      vue: 'html',
      svelte: 'html',
    };
    return languageMap[ext ?? ''] ?? 'plaintext';
  }
}
