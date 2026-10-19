/**
 * Sidebar Tab Component
 *
 * A vertical full-height toggle button for sidebar panels.
 * Always visible — acts as the primary open/close affordance
 * for its associated sidebar content.
 *
 * - Left tabs: text reads bottom-to-top (transform: rotate(180deg))
 * - Right tabs: text reads top-to-bottom (default writing-mode)
 * - Active indicator line on the sidebar-facing edge when open; the open
 *   label is full `base-content` (`text-primary` failed 4.5:1 on the tab in
 *   both anubis themes), the closed label is `base-content-muted`
 * - Focus outline is inset (`-outline-offset-2`) so a slot or a neighbouring
 *   panel cannot clip it
 * - Optional badge dot for status indicators (warning/info/neutral)
 * - Optional "n new" text badge (`newCount`), also in the accessible name
 * - `aria-expanded` follows `isOpen`
 */

import {
  Component,
  computed,
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
             transition-colors duration-200 cursor-pointer
             focus-visible:-outline-offset-2"
      [class.w-8]="size() === 'default'"
      [class.w-6]="size() === 'sm'"
      [class.border-l]="side() === 'right'"
      [class.border-r]="side() === 'left'"
      [class.border-base-content/10]="true"
      [title]="(isOpen() ? 'Hide ' : 'Show ') + label()"
      [attr.aria-label]="accessibleName()"
      [attr.aria-expanded]="isOpen()"
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
        [class.text-base-content]="isOpen()"
        [class.text-base-content-muted]="!isOpen()"
        [class.group-hover:text-base-content]="!isOpen()"
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

      <!-- New-content count: text, not colour alone (R1.8); the button's
           accessible name carries it, so the visible badge is aria-hidden. -->
      @if (newText(); as text) {
        <span
          class="tab-label tab-label--sm absolute bottom-2 left-1/2 -translate-x-1/2
                 rounded-sm bg-primary text-primary-content font-semibold
                 whitespace-nowrap leading-none px-0.5 py-1 select-none"
          aria-hidden="true"
          data-testid="sidebar-tab-new"
          >{{ text }}</span
        >
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

  /**
   * Content that arrived while the panel was held closed (the Display dock's
   * `newCount`, R1.8). Above 0 it shows the text badge "n new" and joins the
   * accessible name: "Toggle Display panel, 1 new".
   */
  readonly newCount = input(0);

  /** Emits when the tab is clicked to toggle the panel */
  readonly toggled = output<void>();

  /** "n new", or `null` when there is nothing new. */
  protected readonly newText = computed(() => {
    const count = this.newCount();
    return count > 0 ? `${count} new` : null;
  });

  protected readonly accessibleName = computed(() => {
    const name = `Toggle ${this.label()} panel`;
    const text = this.newText();
    return text === null ? name : `${name}, ${text}`;
  });
}
