import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CircleAlert,
  LucideAngularModule,
  RefreshCw,
  type LucideIconData,
} from 'lucide-angular';

/** Colour of the card's icon. The value itself stays in the body colour. */
export type StatCardTone =
  | 'primary'
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

/** Per-tone icon classes, kept whole so Tailwind can see them. */
const TONE_CLASSES: Readonly<Record<StatCardTone, string>> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-base-content-muted',
};

/** Per-instance suffix for the label id. */
let nextStatCardId = 0;

/**
 * One KPI tile of the Overview (plan C8 `StatCard`): a label, a value in
 * `tabular-nums`, an optional unit and sub-line, and an icon.
 *
 * `state` drives three shapes: `loading` draws a skeleton in the value's
 * place, `error` shows the message and a Retry button (the `retryRequested`
 * output), `ready` shows the value — "—" when there is none. No sparkline:
 * there is no history on the wire to draw one from.
 *
 * One `ng-content` slot sits under the sub-line for card-specific detail
 * (the Harness card's per-CLI chips).
 *
 * @example
 * ```html
 * <ptah-stat-card
 *   label="Apps & MCP servers"
 *   [value]="rows().length"
 *   [subLine]="blockedCount() + ' blocked'"
 *   [icon]="ServerIcon"
 *   tone="secondary"
 *   [state]="installedState()"
 *   (retryRequested)="inventory.reload('installed')"
 * />
 * ```
 */
@Component({
  selector: 'ptah-stat-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      role="group"
      [attr.aria-labelledby]="labelId"
      [attr.aria-busy]="state() === 'loading'"
      class="flex h-full flex-col gap-1 rounded-xl border border-base-300 bg-base-200 p-4 transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      [attr.data-state]="state()"
      data-testid="stat-card"
    >
      <div class="flex items-start justify-between gap-2">
        <p
          [id]="labelId"
          class="text-xs text-base-content-muted"
          data-testid="stat-card-label"
        >
          {{ label() }}
        </p>
        @if (icon(); as iconData) {
          <!-- lucide-angular owns its host class; the tone sits on a wrapper
               and reaches the stroke through currentColor. -->
          <span
            class="inline-flex shrink-0"
            [class]="toneClass()"
            aria-hidden="true"
            data-testid="stat-card-icon"
          >
            <lucide-angular [img]="iconData" class="h-5 w-5" />
          </span>
        }
      </div>

      @switch (state()) {
        @case ('loading') {
          <div class="space-y-2 pt-1" data-testid="stat-card-skeleton">
            <span class="sr-only">Loading…</span>
            <div class="skeleton h-7 w-16 rounded" aria-hidden="true"></div>
            <div class="skeleton h-3 w-28 rounded" aria-hidden="true"></div>
          </div>
        }
        @case ('error') {
          <div
            class="space-y-2 pt-1"
            role="alert"
            data-testid="stat-card-error"
          >
            <p class="flex items-start gap-1.5 text-xs text-error">
              <lucide-angular
                [img]="ErrorIcon"
                class="mt-px h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{{ errorMessage() || 'Could not load.' }}</span>
            </p>
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1"
              [attr.aria-label]="'Retry ' + label()"
              data-testid="stat-card-retry"
              (click)="retryRequested.emit()"
            >
              <lucide-angular
                [img]="RetryIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />
              Retry
            </button>
          </div>
        }
        @default {
          <p class="flex items-baseline gap-1">
            <span
              class="text-2xl font-semibold tabular-nums text-base-content"
              data-testid="stat-card-value"
              >{{ displayValue() }}</span
            >
            @if (unit() && hasValue()) {
              <span
                class="text-xs text-base-content-muted"
                data-testid="stat-card-unit"
                >{{ unit() }}</span
              >
            }
          </p>
          @if (subLine()) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="stat-card-sub"
            >
              {{ subLine() }}
            </p>
          }
          <ng-content />
        }
      }
    </div>
  `,
})
export class StatCardComponent {
  /** What the number counts ("Connectors"). */
  public readonly label = input.required<string>();

  /** The number or short figure ("3/12"); `null` renders "—". */
  public readonly value = input<number | string | null>(null);

  /** Word after the value ("servers"). */
  public readonly unit = input<string | null>(null);

  /** One line of context under the value. */
  public readonly subLine = input<string | null>(null);

  /** Decorative icon in the corner. */
  public readonly icon = input<LucideIconData | null>(null);

  /** Colour of the icon. @default 'neutral' */
  public readonly tone = input<StatCardTone>('neutral');

  /** Load state of the slice the value comes from. @default 'ready' */
  public readonly state = input<'loading' | 'ready' | 'error'>('ready');

  /** Shown in the error state; a generic line when absent. */
  public readonly errorMessage = input<string | null>(null);

  /** The user asked to retry the failed load. */
  public readonly retryRequested = output<void>();

  protected readonly ErrorIcon = CircleAlert;
  protected readonly RetryIcon = RefreshCw;
  protected readonly labelId = `ptah-stat-card-${nextStatCardId++}`;

  protected readonly toneClass = computed(() => TONE_CLASSES[this.tone()]);

  protected readonly hasValue = computed(() => {
    const value = this.value();
    if (value === null) return false;
    return typeof value === 'number'
      ? Number.isFinite(value)
      : value.trim() !== '';
  });

  protected readonly displayValue = computed(() => {
    const value = this.value();
    if (!this.hasValue() || value === null) return '—';
    return typeof value === 'number' ? value.toLocaleString() : value;
  });
}
