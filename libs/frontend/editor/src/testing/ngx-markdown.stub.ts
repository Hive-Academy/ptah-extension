/**
 * Test stub for `ngx-markdown`.
 *
 * ngx-markdown ships ESM (and pulls in `marked`, also ESM `.js`) that the
 * editor Jest transform (`transformIgnorePatterns: node_modules/(?!.*\.mjs$)`)
 * cannot compile, so any spec whose module graph reaches
 * `CodeEditorComponent` (which imports `MarkdownComponent`) fails to load.
 *
 * Wired via `moduleNameMapper` in `jest.config.ts` so it applies at module
 * resolution time regardless of `jest.mock` hoisting order — the only piece
 * `code-editor.component.ts` actually imports is `MarkdownComponent`, so a
 * lightweight standalone component is enough.
 */
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div></div>',
})
export class MarkdownComponent {
  @Input() data: string | null | undefined = '';
}

export class MarkdownModule {}

export const provideMarkdown = (): unknown[] => [];
export const MARKED_OPTIONS = 'MARKED_OPTIONS';
export const CLIPBOARD_OPTIONS = 'CLIPBOARD_OPTIONS';
export const MARKED_EXTENSIONS = 'MARKED_EXTENSIONS';
export const MERMAID_OPTIONS = 'MERMAID_OPTIONS';
export const SANITIZE = 'SANITIZE';
