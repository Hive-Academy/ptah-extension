import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Code2, LucideAngularModule, SquareTerminal } from 'lucide-angular';

/**
 * Small decorative mark for an Open-in target.
 *
 * lucide ships no brand logos, so the editor marks are simplified inline SVG
 * paths bound statically — no `[innerHTML]`. The terminal uses lucide's
 * `SquareTerminal`; an unknown id falls back to a generic code glyph. Always
 * `aria-hidden`: the adjacent label names the target.
 */
@Component({
  selector: 'ptah-editor-brand-icon',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    @switch (target()) {
      @case ('vscode') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="vscode"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="#007ACC"
            d="M17.5 2 8.6 10.2 4.1 6.8 2 7.9v8.2l2.1 1.1 4.5-3.4 8.9 8.2 4.5-2.1V4.1L17.5 2Zm0 5.3v9.4L11.3 12l6.2-4.7ZM4.3 9.6 6.6 12l-2.3 2.4V9.6Z"
          />
        </svg>
      }
      @case ('cursor') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="cursor"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            fill-rule="evenodd"
            d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L5.1 8.1 12 12l6.9-3.9L12 4.3Z"
          />
        </svg>
      }
      @case ('antigravity') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="antigravity"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="#4285F4"
            d="M12 3c-3 0-4.6 3.4-6.3 8.2C4.3 15.2 3 19 2 21h3.2c1.4-3.9 3.7-9 6.8-9s5.4 5.1 6.8 9H22c-1-2-2.3-5.8-3.7-9.8C16.6 6.4 15 3 12 3Z"
          />
        </svg>
      }
      @case ('zed') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="zed"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M3 3h18v3.5L9.2 18H21v3H3v-3.5L14.8 6H3V3Z"
          />
        </svg>
      }
      @case ('kiro') {
        <svg
          viewBox="0 0 24 24"
          class="h-3 w-3"
          data-brand="kiro"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="#9046FF"
            fill-rule="evenodd"
            d="M12 2C7.6 2 5 5.3 5 9.5V20c0 .9 1 1.4 1.7.9l1.8-1.3 1.7 1.3c.5.4 1.2.4 1.7 0l1.7-1.3 1.7 1.3c.5.4 1.2.4 1.7 0l.1-.1c.4-.3.7-.8.7-1.3V9.5C19 5.3 16.4 2 12 2Zm-2 6.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm4 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z"
          />
        </svg>
      }
      @case ('terminal') {
        <lucide-angular
          [img]="TerminalIcon"
          class="h-3 w-3"
          data-brand="terminal"
          aria-hidden="true"
        />
      }
      @default {
        <lucide-angular [img]="CodeIcon" class="h-3 w-3" aria-hidden="true" />
      }
    }
  `,
})
export class EditorBrandIconComponent {
  /** An `EditorTargetId`; typed wide so an id from a newer host still renders. */
  readonly target = input.required<string>();
  protected readonly TerminalIcon = SquareTerminal;
  protected readonly CodeIcon = Code2;
}
