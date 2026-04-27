// Jest mock for ngx-markdown to avoid loading the `.mjs` ESM bundle + `marked`
// dependency during setup-wizard tests. The MarkdownBlockComponent from
// @ptah-extension/chat is pulled in through the chat barrel (used by
// WizardStreamAccumulator for type-only imports), but Jest still loads the
// real ngx-markdown module at runtime and fails on `ɵcmp` resolution because
// its Angular metadata is not registered. This stub provides a minimal,
// standalone `MarkdownComponent` and `MarkdownModule` that compile cleanly
// with Angular's testing harness.

import {
  Component,
  NgModule,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- must match real ngx-markdown selector for mock to work
  selector: 'markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div></div>`,
})
export class MarkdownComponent {
  public readonly data = input<string | null | undefined>('');
}

@NgModule({
  imports: [MarkdownComponent],
  exports: [MarkdownComponent],
})
export class MarkdownModule {
  public static forRoot() {
    return { ngModule: MarkdownModule, providers: [] };
  }
  public static forChild() {
    return { ngModule: MarkdownModule, providers: [] };
  }
}

export class MarkdownService {}
export class MarkdownPipe {}
export const provideMarkdown = () => [];
export const MARKED_OPTIONS = 'MARKED_OPTIONS';
export const CLIPBOARD_OPTIONS = 'CLIPBOARD_OPTIONS';
export const MARKED_EXTENSIONS = 'MARKED_EXTENSIONS';
export const MERMAID_OPTIONS = 'MERMAID_OPTIONS';
export const SANITIZE = 'SANITIZE';
