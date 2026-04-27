import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  effect,
  OnDestroy,
  NgZone,
  inject,
  afterNextRender,
} from '@angular/core';
import type * as monaco from 'monaco-editor';

type MonacoApi = typeof monaco;

/**
 * DiffViewComponent - Direct Monaco diff editor for side-by-side file comparison.
 *
 * Uses Monaco's createDiffEditor API directly instead of the ngx-monaco-editor-v2
 * wrapper to ensure proper diff decoration rendering (colored highlights for
 * added/removed lines) and full container sizing.
 */
@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  template: `<div #editorContainer class="w-full h-full"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffViewComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);

  readonly filePath = input.required<string>();
  readonly originalContent = input.required<string>();
  readonly modifiedContent = input.required<string>();

  private readonly editorContainer =
    viewChild.required<ElementRef<HTMLElement>>('editorContainer');

  private editor: monaco.editor.IStandaloneDiffEditor | null = null;
  private originalModel: monaco.editor.ITextModel | null = null;
  private modifiedModel: monaco.editor.ITextModel | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly language = computed(() =>
    this.detectLanguage(this.filePath()),
  );

  constructor() {
    afterNextRender(() => {
      this.waitForMonacoAndCreate();
    });

    effect(() => {
      const original = this.originalContent();
      const modified = this.modifiedContent();
      const lang = this.language();
      if (this.editor) {
        this.updateModels(original, modified, lang);
      }
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.disposeModels();
    this.editor?.dispose();
    this.editor = null;
  }

  private waitForMonacoAndCreate(): void {
    const monacoApi = (window as Window & { monaco?: MonacoApi }).monaco;
    if (monacoApi) {
      this.createEditor(monacoApi);
      return;
    }
    // Monaco not loaded yet — poll briefly (should be rare)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const m = (window as Window & { monaco?: MonacoApi }).monaco;
      if (m) {
        clearInterval(interval);
        this.createEditor(m);
      } else if (attempts > 50) {
        clearInterval(interval);
      }
    }, 100);
  }

  private createEditor(monacoApi: MonacoApi): void {
    const container = this.editorContainer().nativeElement;
    const lang = this.language();
    const original = this.originalContent();
    const modified = this.modifiedContent();

    const originalModel = monacoApi.editor.createModel(original, lang);
    const modifiedModel = monacoApi.editor.createModel(modified, lang);
    this.originalModel = originalModel;
    this.modifiedModel = modifiedModel;

    this.ngZone.runOutsideAngular(() => {
      const editor = monacoApi.editor.createDiffEditor(container, {
        theme: 'vs-dark',
        automaticLayout: false,
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        ignoreTrimWhitespace: false,
        minimap: { enabled: false },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      });
      this.editor = editor;

      editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      this.resizeObserver = new ResizeObserver(() => {
        this.editor?.layout();
      });
      this.resizeObserver.observe(container);
    });
  }

  private updateModels(original: string, modified: string, lang: string): void {
    const monacoApi = (window as Window & { monaco?: MonacoApi }).monaco;
    if (!monacoApi) return;

    this.disposeModels();

    const originalModel = monacoApi.editor.createModel(original, lang);
    const modifiedModel = monacoApi.editor.createModel(modified, lang);
    this.originalModel = originalModel;
    this.modifiedModel = modifiedModel;

    this.editor?.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  }

  private disposeModels(): void {
    this.originalModel?.dispose();
    this.modifiedModel?.dispose();
    this.originalModel = null;
    this.modifiedModel = null;
  }

  private detectLanguage(filePath: string): string {
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
