import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  DiffEditorComponent,
  type DiffEditorModel,
} from 'ngx-monaco-editor-v2';

/**
 * DiffViewComponent - Monaco diff editor wrapper for side-by-side file comparison.
 *
 * Complexity Level: 1 (Simple - thin wrapper around ngx-monaco-diff-editor)
 * Patterns: Standalone component, signal-based inputs, computed language detection
 *
 * Displays a read-only side-by-side diff of the original (HEAD) content versus
 * the current (working tree) content using Monaco's built-in diff editor.
 */
@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  imports: [DiffEditorComponent],
  template: `
    <ngx-monaco-diff-editor
      class="h-full"
      [options]="diffOptions"
      [originalModel]="originalModel()"
      [modifiedModel]="modifiedModel()"
    />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
    ngx-monaco-diff-editor {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffViewComponent {
  readonly filePath = input.required<string>();
  readonly originalContent = input.required<string>();
  readonly modifiedContent = input.required<string>();

  readonly diffOptions = {
    theme: 'vs-dark',
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
  };

  readonly originalModel = computed(
    (): DiffEditorModel => ({
      code: this.originalContent(),
      language: this.detectLanguage(this.filePath()),
    }),
  );

  readonly modifiedModel = computed(
    (): DiffEditorModel => ({
      code: this.modifiedContent(),
      language: this.detectLanguage(this.filePath()),
    }),
  );

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
