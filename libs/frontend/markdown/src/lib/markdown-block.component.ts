import {
  Component,
  computed,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';

/**
 * MarkdownBlockComponent - Renders markdown content with syntax highlighting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Uses ngx-markdown for rich content rendering with code highlighting.
 *
 * This is the ONLY markdown renderer in the web tree. Every body — AI output,
 * forum post, lesson comment — goes through it, so the DOMPurify configuration
 * in `provide-markdown-rendering.ts` is a single chokepoint rather than a
 * convention. Never bind `[innerHTML]` as a shortcut around it.
 */
@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  imports: [MarkdownModule],
  template: ` <markdown [data]="content()" [class]="proseClass()" /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownBlockComponent {
  public readonly content = input.required<string>();

  /**
   * Prose colour scheme.
   *
   * - `'invert'` (default) — always light-on-dark. The webview and the chat
   *   surfaces are dark-only, and this is what they have always rendered, so
   *   the default is unchanged and no existing consumer moves.
   * - `'auto'` — follows the colour scheme. Required by any surface that has a
   *   light theme: the hardcoded `prose-invert` renders near-white body text on
   *   the near-white `base-200` of `operator-member-light`, which is NFR-U5's
   *   exact failure mode.
   */
  public readonly variant = input<'invert' | 'auto'>('invert');

  /** Literal class strings so Tailwind's scanner keeps both variants. */
  protected readonly proseClass = computed<string>(() =>
    this.variant() === 'auto'
      ? 'prose prose-sm dark:prose-invert max-w-none'
      : 'prose prose-sm prose-invert max-w-none',
  );
}
