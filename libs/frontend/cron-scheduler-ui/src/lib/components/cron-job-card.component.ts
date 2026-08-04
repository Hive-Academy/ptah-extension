/**
 * CronJobCardComponent — one scheduled job as a card.
 *
 * Replaces the table row that used to carry this data. Pure presentation: it
 * owns no state, reads nothing from the store and emits an event for every
 * action so the tab stays the single place that talks to `CronStateService`.
 *
 * The card body deliberately shows WHEN a job last ran, never HOW it went —
 * see the data-limit note in `cron-format.ts`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  LucideAngularModule,
  Pencil,
  Play,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-angular';
import type { ScheduledJobDto } from '@ptah-extension/shared';
import { NativeCardComponent } from '@ptah-extension/ui';

import {
  buildJobMetrics,
  jobDotClass,
  jobStatusLabel,
  jobTone,
} from './cron-format';

@Component({
  selector: 'ptah-cron-job-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, NativeCardComponent],
  template: `
    <ptah-native-card
      class="block rounded-xl"
      [class.ring-2]="selected()"
      [class.ring-primary]="selected()"
      [tone]="tone()"
      [spine]="true"
      [clickable]="true"
      density="compact"
      [ariaLabel]="'Open details for ' + job().name"
      data-testid="cron-job-card"
      (activated)="opened.emit()"
    >
      <div card-header class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-medium" [title]="job().name">
            {{ job().name }}
          </h3>
          <p class="mt-0.5 truncate text-xs text-base-content/60">
            {{ job().timezone }}
          </p>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1.5">
          <span
            class="inline-block size-1.5 rounded-full"
            [class]="dotClass()"
            aria-hidden="true"
          ></span>
          <span class="text-xs text-base-content/70">{{ statusLabel() }}</span>
        </span>
      </div>

      <dl class="grid gap-2 text-xs sm:grid-cols-3">
        @for (metric of metrics(); track metric.label) {
          <div class="min-w-0">
            <dt
              class="text-[10px] uppercase tracking-wide text-base-content/50"
            >
              {{ metric.label }}
            </dt>
            <dd
              class="truncate text-base-content/80"
              [class.font-mono]="metric.mono"
              [title]="metric.value"
            >
              {{ metric.value }}
            </dd>
            @if (metric.hint) {
              <dd class="truncate text-base-content/50" [title]="metric.hint">
                {{ metric.hint }}
              </dd>
            }
          </div>
        }
      </dl>

      <div
        card-footer
        class="flex items-center justify-end gap-0.5 border-t border-base-300/70 pt-2"
      >
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
          aria-label="Run now"
          title="Run now"
          (click)="runNow.emit()"
        >
          <lucide-angular
            [img]="PlayIcon"
            class="size-3.5"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
          aria-label="Edit job"
          title="Edit job"
          (click)="edit.emit()"
        >
          <lucide-angular
            [img]="PencilIcon"
            class="size-3.5"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150"
          [attr.aria-label]="job().enabled ? 'Disable job' : 'Enable job'"
          [attr.title]="job().enabled ? 'Disable job' : 'Enable job'"
          (click)="toggled.emit()"
        >
          <lucide-angular
            [img]="job().enabled ? PowerOffIcon : PowerIcon"
            class="size-3.5"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-base-content/50 transition-colors duration-150 hover:text-error"
          aria-label="Delete job"
          title="Delete job"
          (click)="removed.emit()"
        >
          <lucide-angular
            [img]="Trash2Icon"
            class="size-3.5"
            aria-hidden="true"
          />
        </button>
      </div>
    </ptah-native-card>
  `,
})
export class CronJobCardComponent {
  /** The schedule this card renders. */
  public readonly job = input.required<ScheduledJobDto>();

  /** Human rendering of `job.cronExpr`, resolved by the parent tab. */
  public readonly description = input<string>('');

  /** True when this job is the one open in the detail drawer. */
  public readonly selected = input<boolean>(false);

  /** Card surface activated — the parent should open the detail drawer. */
  public readonly opened = output<void>();

  /** "Run now" pressed. */
  public readonly runNow = output<void>();

  /** "Edit job" pressed. */
  public readonly edit = output<void>();

  /** Enable/disable pressed. */
  public readonly toggled = output<void>();

  /** "Delete job" pressed. */
  public readonly removed = output<void>();

  protected readonly PlayIcon = Play;
  protected readonly PencilIcon = Pencil;
  protected readonly PowerIcon = Power;
  protected readonly PowerOffIcon = PowerOff;
  protected readonly Trash2Icon = Trash2;

  protected readonly tone = computed(() => jobTone(this.job()));
  protected readonly dotClass = computed(() => jobDotClass(this.job()));
  protected readonly statusLabel = computed(() => jobStatusLabel(this.job()));
  protected readonly metrics = computed(() =>
    buildJobMetrics(this.job(), this.description()),
  );
}
