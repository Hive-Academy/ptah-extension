/**
 * Sidebar Tab Component
 *
 * A vertical full-height toggle button for sidebar panels.
 * Always visible — acts as the primary open/close affordance
 * for its associated sidebar content.
 *
 * - Left tabs: text reads bottom-to-top (transform: rotate(180deg))
 * - Right tabs: text reads top-to-bottom (default writing-mode)
 * - Active indicator line on the sidebar-facing edge when open
 * - Optional badge dot for status indicators (warning/info/neutral)
 */

import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  selector: 'ptah-sidebar-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-shrink: 0;
    }

    .tab-label {
      writing-mode: vertical-rl;
    }

    .tab-label--flip {
      transform: rotate(180deg);
    }

    .tab-label--sm {
      font-size: 9px;
      letter-spacing: 0.08em;
    }
  `,
  template: `
    <button
      type="button"
      class="group relative flex items-center justify-center h-full
             bg-base-200/60 hover:bg-base-300/80
             transition-colors duration-200 cursor-pointer"
      [class.w-8]="size() === 'default'"
      [class.w-6]="size() === 'sm'"
      [class.border-l]="side() === 'right'"
      [class.border-r]="side() === 'left'"
      [class.border-base-content/10]="true"
      [title]="(isOpen() ? 'Hide ' : 'Show ') + label()"
      [attr.aria-label]="'Toggle ' + label() + ' panel'"
      (click)="toggled.emit()"
    >
      <!-- Active indicator line (on sidebar-facing edge) -->
      @if (isOpen()) {
        <span
          class="absolute top-0 bottom-0 w-0.5 bg-primary"
          [class.right-0]="side() === 'left'"
          [class.left-0]="side() === 'right'"
        ></span>
      }

      <!-- Rotated label -->
      <span
        class="tab-label whitespace-nowrap tracking-widest uppercase
               text-[10px] font-semibold select-none transition-colors duration-200"
        [class.tab-label--flip]="side() === 'left'"
        [class.tab-label--sm]="size() === 'sm'"
        [class.text-primary]="isOpen()"
        [class.text-base-content/40]="!isOpen()"
        [class.group-hover:text-base-content/70]="!isOpen()"
      >
        {{ label() }}
      </span>

      <!-- Status badge dot -->
      @if (badgeType()) {
        <span
          class="absolute top-2.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
          [class.bg-warning]="badgeType() === 'warning'"
          [class.bg-info]="badgeType() === 'info'"
          [class.bg-base-content/30]="badgeType() === 'neutral'"
          [class.animate-pulse]="
            badgeType() === 'warning' || badgeType() === 'info'
          "
        ></span>
      }
    </button>
  `,
})
export class SidebarTabComponent {
  /** Text label displayed vertically */
  readonly label = input.required<string>();

  /** Which side of the layout this tab sits on */
  readonly side = input.required<'left' | 'right'>();

  /** Whether the associated panel is currently open */
  readonly isOpen = input.required<boolean>();

  /** Tab size: 'default' (32px) for spacious layouts, 'sm' (24px) for constrained panels */
  readonly size = input<'sm' | 'default'>('default');

  /** Optional status badge: 'warning' (yellow pulse), 'info' (blue pulse), 'neutral' (gray) */
  readonly badgeType = input<'warning' | 'info' | 'neutral' | null>(null);

  /** Emits when the tab is clicked to toggle the panel */
  readonly toggled = output<void>();
}
