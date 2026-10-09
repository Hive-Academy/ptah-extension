import {
  Component,
  computed,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';

/**
 * Compaction notice. Presentational: the host passes the in-flight flag and,
 * when a completion event already carried them, the before/after token counts.
 * It does not read the chat store.
 */
@Component({
  selector: 'ptah-compaction-notification',
  imports: [LucideAngularModule],
  template: `
    @if (visible()) {
      <div
        class="surface-2 mx-2 my-1 rounded-lg text-xs"
        [class.border-warning]="isCompacting()"
        [class.border-success]="!isCompacting()"
        role="status"
        aria-live="polite"
        data-testid="compaction-notification"
      >
        <div class="flex items-start gap-2 px-2.5 pt-2">
          <lucide-angular
            [img]="RefreshCwIcon"
            class="mt-0.5 h-4 w-4 shrink-0"
            [class.text-warning]="isCompacting()"
            [class.text-success]="!isCompacting()"
            [class.animate-spin]="isCompacting()"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <div class="font-semibold leading-5" data-testid="compaction-title">
              {{ isCompacting() ? 'Compacting context' : 'Context compacted' }}
            </div>
            @if (isCompacting()) {
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
            } @else {
              <progress
                class="progress progress-success mt-1.5 h-1.5 w-full"
                value="100"
                max="100"
                aria-label="Compaction finished"
                data-testid="compaction-progress"
              ></progress>
            }
            @if (stats(); as stats) {
              <dl
                class="mt-2 flex flex-wrap gap-x-3 gap-y-1"
                aria-label="Compaction result"
                data-testid="compaction-stats"
              >
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    Before
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="compaction-before"
                  >
                    {{ stats.before }}
                  </dd>
                </div>
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    After
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="compaction-after"
                  >
                    {{ stats.after }}
                  </dd>
                </div>
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    Freed
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="compaction-freed"
                  >
                    {{ stats.freed }}
                  </dd>
                </div>
              </dl>
            }
          </div>
        </div>
        <p
          class="mt-1.5 px-2.5 pb-2 leading-relaxed text-base-content-muted"
          data-testid="compaction-body"
        >
          @if (isCompacting()) {
            Summarizing conversation history to continue.
          } @else if (stats()) {
            The context was summarized so the session can continue.
          } @else {
            Compaction finished. Before and after token counts were not on this
            event.
          }
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

  /** True once a completion marker exists and nothing is in flight. */
  readonly completed = input(false);

  /** Context tokens before compaction, when the event carried them. */
  readonly preTokens = input<number | null>(null);

  /** Context tokens after compaction, when the event carried them. */
  readonly postTokens = input<number | null>(null);

  protected readonly RefreshCwIcon = RefreshCw;

  protected readonly visible = computed(
    () => this.isCompacting() || this.completed(),
  );

  /** Before / after / freed. Hidden unless both counts are usable. */
  protected readonly stats = computed(() => {
    if (this.isCompacting()) return null;
    const before = this.preTokens();
    const after = this.postTokens();
    if (before === null || after === null || before < after) return null;
    return {
      before: formatTokens(before),
      after: formatTokens(after),
      freed: formatTokens(before - after),
    };
  });
}

/** Same scale as the budget card: `14.1M`, `210.0k`, `812`. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}
