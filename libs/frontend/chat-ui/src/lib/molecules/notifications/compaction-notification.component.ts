import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';

/**
 * In-flight compaction notice. Presentational: the host passes the in-flight
 * flag. The finished result is the compaction marker chip, not this card.
 */
@Component({
  selector: 'ptah-compaction-notification',
  imports: [LucideAngularModule],
  template: `
    @if (isCompacting()) {
      <div
        class="surface-2 mx-2 my-1 rounded-lg border-warning text-xs"
        role="status"
        aria-live="polite"
        data-testid="compaction-notification"
      >
        <div class="flex items-start gap-2 px-2.5 pt-2">
          <lucide-angular
            [img]="RefreshCwIcon"
            class="mt-0.5 h-4 w-4 shrink-0 text-warning animate-spin"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <div class="font-semibold leading-5" data-testid="compaction-title">
              Compacting context
            </div>
            <div
              class="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-base-300"
              role="progressbar"
              aria-valuetext="Compaction in progress"
              data-testid="compaction-progress"
            >
              <div
                class="absolute inset-y-0 left-0 w-1/3 rounded-full bg-warning animate-indeterminate"
              ></div>
            </div>
          </div>
        </div>
        <p
          class="mt-1.5 px-2.5 pb-2 leading-relaxed text-base-content-muted"
          data-testid="compaction-body"
        >
          Summarizing conversation history to continue.
        </p>
      </div>
    }
  `,
  styles: `
    /* Transform only, so the compositor can run the indeterminate bar. */
    @keyframes indeterminate {
      0% {
        transform: translateX(-100%);
      }
      50% {
        transform: translateX(200%);
      }
      100% {
        transform: translateX(400%);
      }
    }
    .animate-indeterminate {
      animation: indeterminate 1.8s ease-in-out infinite;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionNotificationComponent {
  /** True between compaction start and compaction complete. */
  readonly isCompacting = input(false);

  protected readonly RefreshCwIcon = RefreshCw;
}
