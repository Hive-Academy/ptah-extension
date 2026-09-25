import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';

/** Per-instance suffix for the heading id. */
let nextInspectorId = 0;

/**
 * The detail pane docked beside a list at wide layouts: an `<aside>` named by
 * its heading, a close button and a scrolling body holding one projected
 * `ng-content`.
 *
 * Unlike `NativeDrawerComponent` (`native-drawer.component.ts`), which is
 * modal and traps focus, this pane sits next to the list the user is working
 * in, so it NEVER moves focus: not when it appears, not when the heading or
 * the projected content changes. Selecting another row keeps focus on that
 * row. The parent owns visibility and closes it on `closed`.
 *
 * @example
 * ```html
 * <ptah-docked-inspector [heading]="row.title" (closed)="clearSelection()">
 *   <router-outlet />
 * </ptah-docked-inspector>
 * ```
 */
@Component({
  selector: 'ptah-docked-inspector',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  template: `
    <aside
      class="flex h-full min-h-0 flex-col border-l border-base-300 bg-base-100"
      [attr.aria-labelledby]="headingId"
      data-testid="docked-inspector"
    >
      <div
        class="flex flex-shrink-0 items-center gap-2 border-b border-base-300 px-4 py-3"
      >
        <h2
          [id]="headingId"
          class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content"
          [attr.title]="heading()"
          data-testid="docked-inspector-heading"
        >
          {{ heading() }}
        </h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square -mr-1 flex-shrink-0"
          [attr.aria-label]="closeLabel()"
          data-testid="docked-inspector-close"
          (click)="closed.emit()"
        >
          <lucide-angular [img]="XIcon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div
        class="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        data-testid="docked-inspector-body"
      >
        <ng-content />
      </div>
    </aside>
  `,
})
export class DockedInspectorComponent {
  /** Names the pane; rendered as its `<h2>`. */
  public readonly heading = input.required<string>();

  /** Accessible name of the close button. @default 'Close details' */
  public readonly closeLabel = input<string>('Close details');

  /** The user asked to close the pane. The parent must hide it. */
  public readonly closed = output<void>();

  protected readonly XIcon = X;
  protected readonly headingId = `ptah-docked-inspector-${nextInspectorId++}`;
}
