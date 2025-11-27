import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';

/**
 * MarkdownBlockComponent - Renders markdown content with syntax highlighting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Uses ngx-markdown for rich content rendering with code highlighting.
 */
@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  imports: [MarkdownModule],
  template: `
    <markdown
      [data]="content()"
      class="prose prose-sm prose-invert max-w-none"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownBlockComponent {
  readonly content = input.required<string>();
}
