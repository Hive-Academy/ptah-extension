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
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorComponent } from 'ngx-monaco-editor-v2';

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
  imports: [FormsModule, EditorComponent],
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
      </div>
      <div class="flex-1 min-h-0">
        <ngx-monaco-editor
          class="h-full"
          [options]="editorOptions()"
          [(ngModel)]="editorContent"
          (ngModelChange)="onContentChange()"
          (onInit)="onEditorInit($event)"
        />
      </div>
    </div>
    } @else {
    <div class="h-full w-full flex items-center justify-center bg-base-100">
      <div class="text-center opacity-40">
        <p class="text-lg mb-2">No file open</p>
        <p class="text-sm">Select a file from the explorer to start editing</p>
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

  readonly contentChanged = output<string>();
  readonly fileSaved = output<{ filePath: string; content: string }>();

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private readonly destroyRef = inject(DestroyRef);

  protected editorContent = '';
  private lastSavedContent = '';

  readonly isDirty = signal(false);

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
      }
    });
  }

  ngOnInit(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        // Only handle save when we have an active file
        if (this.filePath()) {
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

  protected onEditorInit(_editor: unknown): void {
    // Editor initialized; content sync is handled by the effect
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
