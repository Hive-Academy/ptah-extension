
import {
  Component,
  NgModule,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
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
