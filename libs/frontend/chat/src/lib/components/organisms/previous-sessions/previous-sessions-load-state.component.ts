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
          <p
            id="psl-message"
            class="flex items-center gap-2 text-sm text-base-content-muted"
          >
            <span
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            Loading previous sessions...
          </p>
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
