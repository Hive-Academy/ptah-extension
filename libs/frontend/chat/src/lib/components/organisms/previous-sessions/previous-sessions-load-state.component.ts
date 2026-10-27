/**
 * PreviousSessionsLoadStateComponent — the stand-in surface the shell shows
 * while the deferred Previous sessions modal chunk is slow or failed to load
 * (TASK_2026_679, Fix round P3, D73).
 *
 * The shell row is inert as soon as the modal opens (DP-8), and the real
 * modal's close and Escape live in the deferred chunk. This surface sits
 * outside that row and gives a reachable Close: it takes focus after render,
 * Escape closes (and does not reach the shell shortcuts, R4), and Tab stays on
 * it. Closing goes through `PreviousSessionsDialogService`, which returns
 * focus to the opener after the close renders. No Retry: Angular keeps a
 * failed defer load per template, so only a window reload refetches it.
 *
 * While loading, four shimmer rows stand in for the session list
 * (TASK_2026_721, 11d). The copy stays as the dialog's description, read by
 * screen readers only; the rows are decorative and hold still under
 * `prefers-reduced-motion`.
 *
 * Internal to the chat lib; rendered only by the shell's `@loading` and
 * `@error` blocks, and not exported from the barrel.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { History, LucideAngularModule, X } from 'lucide-angular';
import { PreviousSessionsDialogService } from '../../../services/session-list/previous-sessions-dialog.service';
import { wrapTabWithin } from '../../../utils/focus-wrap.utils';

const SKELETON_ROWS: readonly {
  readonly id: number;
  readonly width: string;
  readonly delay: string;
}[] = [
  { id: 0, width: '78%', delay: '0ms' },
  { id: 1, width: '62%', delay: '120ms' },
  { id: 2, width: '70%', delay: '240ms' },
  { id: 3, width: '54%', delay: '360ms' },
];

@Component({
  selector: 'ptah-previous-sessions-load-state',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: contents;
      }

      .psl-shimmer {
        opacity: 0.55;
      }

      @media (prefers-reduced-motion: no-preference) {
        .psl-shimmer {
          animation: psl-shimmer 1.4s ease-in-out infinite;
        }
      }

      @keyframes psl-shimmer {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 0.8;
        }
      }
    `,
  ],
  template: `
    <!-- Same layer as the modal: daisyUI's fixed .modal at z 990, under the
         editor and the confirm dialog. The panel is the dialog. -->
    <div
      class="modal modal-open z-[990] items-center"
      role="presentation"
      data-testid="previous-sessions-load-state"
      (keydown)="onKeydown($event)"
    >
      <div
        #panel
        id="previous-sessions-dialog"
        class="relative flex flex-col gap-3 w-[min(360px,calc(100vw-32px))] p-4 bg-surface-0 text-base-content rounded-xl border border-[color:var(--surface-border-strong)] elev-3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="psl-title"
        aria-describedby="psl-message"
      >
        <div class="flex items-center gap-2">
          <h2
            id="psl-title"
            class="flex flex-1 min-w-0 items-center gap-2 text-sm font-semibold"
          >
            <lucide-angular
              [img]="HistoryIcon"
              class="w-4 h-4 shrink-0 text-base-content-muted"
              aria-hidden="true"
            />
            <span class="truncate">Previous sessions</span>
          </h2>
          <button
            #closeButton
            type="button"
            class="btn btn-ghost btn-sm btn-square text-base-content-muted hover:text-base-content"
            aria-label="Close previous sessions"
            data-testid="previous-sessions-load-close"
            (click)="close()"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        @if (state() === 'loading') {
          <div
            class="flex flex-col gap-3"
            role="status"
            aria-busy="true"
            data-testid="previous-sessions-load-skeleton"
          >
            <p id="psl-message" class="sr-only">Loading previous sessions...</p>
            @for (row of skeletonRows; track row.id) {
              <div
                class="psl-shimmer flex items-center gap-3"
                [style.animation-delay]="row.delay"
                aria-hidden="true"
                data-testid="previous-sessions-skeleton-row"
              >
                <span
                  class="w-4 h-4 shrink-0 rounded-full bg-base-content/15"
                ></span>
                <span class="flex flex-1 min-w-0 flex-col gap-1.5">
                  <span
                    class="h-2.5 rounded-full bg-base-content/15"
                    [style.width]="row.width"
                  ></span>
                  <span class="h-2 w-1/3 rounded-full bg-base-content/10"></span>
                </span>
              </div>
            }
          </div>
        } @else {
          <p id="psl-message" class="text-sm text-base-content">
            Previous sessions could not load. Close this and reload the window
            to try again.
          </p>
        }
      </div>
    </div>
  `,
})
export class PreviousSessionsLoadStateComponent {
  private readonly dialog = inject(PreviousSessionsDialogService);

  /** Which deferred-load outcome the surface reports. */
  readonly state = input.required<'loading' | 'error'>();

  private readonly panel =
    viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  /** Varied widths so the rows read as a list, not a block; staggered pulse. */
  protected readonly skeletonRows = SKELETON_ROWS;

  protected readonly HistoryIcon = History;
  protected readonly XIcon = X;

  constructor() {
    // Bound to this view: a surface destroyed before its first render (the
    // chunk arrived) never pulls focus.
    afterNextRender(() => this.closeButton().nativeElement.focus());
  }

  protected close(): void {
    this.dialog.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    wrapTabWithin(this.panel().nativeElement, event);
  }
}
