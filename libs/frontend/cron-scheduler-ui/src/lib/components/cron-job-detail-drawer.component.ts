/**
 * CronJobDetailDrawerComponent — the detail surface for one scheduled job.
 *
 * Card grids answer "what schedules exist"; this drawer answers "what is this
 * one doing". It is the ONLY place run outcomes appear, because outcomes come
 * from `cron:runs`, which is fetched for the selected job alone (see the
 * data-limit note in `cron-format.ts`).
 *
 * Control contract mirrors `NativeDrawerComponent`: the parent owns visibility
 * (here implied by `job !== null`) and the drawer only requests closure.
 *
 * NG8011: every projected slot node gets its own single-root `@if`. Putting
 * `[drawer-header]`, the body and `[drawer-footer]` inside one shared `@if`
 * would silently collapse them all into the default slot.
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
import type { JobRunDto, ScheduledJobDto } from '@ptah-extension/shared';
import { NativeDrawerComponent } from '@ptah-extension/ui';

import {
  buildJobMetrics,
  formatTime,
  jobDotClass,
  jobStatusLabel,
  runStatusDotClass,
} from './cron-format';

@Component({
  selector: 'ptah-cron-job-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, NativeDrawerComponent],
  template: `
    <ptah-native-drawer
      [isOpen]="job() !== null"
      ariaLabel="Schedule details"
      widthClass="w-full max-w-xl"
      (closed)="closed.emit()"
    >
      @if (job(); as j) {
        <div drawer-header class="min-w-0">
          <h2 class="truncate text-sm font-semibold" [title]="j.name">
            {{ j.name }}
          </h2>
          <p
            class="mt-0.5 flex items-center gap-1.5 text-xs text-base-content-muted"
          >
            <span
              class="inline-block size-1.5 rounded-full"
              [class]="dotClass()"
              aria-hidden="true"
            ></span>
            <span>{{ statusLabel() }}</span>
            <span aria-hidden="true">·</span>
            <span class="truncate">{{ j.timezone }}</span>
          </p>
        </div>
      }

      @if (job(); as j) {
        <div class="flex flex-col gap-5">
          <dl class="grid gap-3 text-xs sm:grid-cols-3">
            @for (metric of metrics(); track metric.label) {
              <div class="min-w-0">
                <dt
                  class="text-[10px] uppercase tracking-wide text-base-content-muted"
                >
                  {{ metric.label }}
                </dt>
                <dd
                  class="break-words text-base-content-muted"
                  [class.font-mono]="metric.mono"
                >
                  {{ metric.value }}
                </dd>
                @if (metric.hint) {
                  <dd class="break-words text-base-content-muted">
                    {{ metric.hint }}
                  </dd>
                }
              </div>
            }
          </dl>

          <section aria-label="Prompt">
            <h3
              class="text-[10px] uppercase tracking-wide text-base-content-muted"
            >
              Prompt
            </h3>
            <pre
              class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-base-300 bg-base-200/40 p-3 font-mono text-xs"
              >{{ j.prompt }}</pre
            >
          </section>

          @if (j.workspaceRoot) {
            <section aria-label="Workspace">
              <h3
                class="text-[10px] uppercase tracking-wide text-base-content-muted"
              >
                Workspace
              </h3>
              <p
                class="mt-1 break-all font-mono text-xs text-base-content-muted"
              >
                {{ j.workspaceRoot }}
              </p>
            </section>
          }

          <section aria-label="Run history">
            <header class="flex items-center justify-between gap-3">
              <h3
                class="text-[10px] uppercase tracking-wide text-base-content-muted"
              >
                Run history
              </h3>
              <span class="text-xs text-base-content-muted">
                Last {{ runs().length }} runs
              </span>
            </header>
            @if (runs().length === 0) {
              <p class="mt-2 text-xs text-base-content-muted">
                No runs recorded yet.
              </p>
            } @else {
              <ul
                class="mt-2 divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300"
              >
                @for (run of runs(); track run.id) {
                  <li
                    class="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="cron-run-row"
                  >
                    <span class="font-mono text-xs">{{
                      time(run.scheduledFor)
                    }}</span>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block size-1.5 rounded-full"
                        [class]="statusDotClass(run)"
                        aria-hidden="true"
                      ></span>
                      <span class="text-xs text-base-content-muted">
                        {{ run.status }}
                      </span>
                    </span>
                    <span class="truncate text-xs text-base-content-muted">
                      {{ run.resultSummary || run.errorMessage || '' }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      }

      @if (job(); as j) {
        <div
          drawer-footer
          class="flex flex-wrap items-center gap-2 border-t border-base-300 px-4 py-3"
        >
          <button
            type="button"
            class="btn btn-primary btn-sm transition-colors duration-150"
            data-testid="cron-drawer-run-now"
            (click)="runNow.emit()"
          >
            <lucide-angular
              [img]="PlayIcon"
              class="size-3.5"
              aria-hidden="true"
            />
            Run now
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm transition-colors duration-150"
            data-testid="cron-drawer-edit"
            (click)="edit.emit()"
          >
            <lucide-angular
              [img]="PencilIcon"
              class="size-3.5"
              aria-hidden="true"
            />
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm transition-colors duration-150"
            data-testid="cron-drawer-toggle"
            (click)="toggled.emit()"
          >
            <lucide-angular
              [img]="j.enabled ? PowerOffIcon : PowerIcon"
              class="size-3.5"
              aria-hidden="true"
            />
            {{ j.enabled ? 'Disable' : 'Enable' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm ml-auto text-error transition-colors duration-150"
            data-testid="cron-drawer-delete"
            (click)="removed.emit()"
          >
            <lucide-angular
              [img]="Trash2Icon"
              class="size-3.5"
              aria-hidden="true"
            />
            Delete
          </button>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class CronJobDetailDrawerComponent {
  /** Selected job, or `null` when the drawer should stay closed. */
  public readonly job = input<ScheduledJobDto | null>(null);

  /** Run history for {@link job}, newest first. */
  public readonly runs = input<readonly JobRunDto[]>([]);

  /** Human rendering of `job.cronExpr`, resolved by the parent tab. */
  public readonly description = input<string>('');

  /** Drawer requests closure (Escape, backdrop, close button). */
  public readonly closed = output<void>();

  /** "Run now" pressed. */
  public readonly runNow = output<void>();

  /** "Edit" pressed. */
  public readonly edit = output<void>();

  /** Enable/disable pressed. */
  public readonly toggled = output<void>();

  /** "Delete" pressed. */
  public readonly removed = output<void>();

  protected readonly PlayIcon = Play;
  protected readonly PencilIcon = Pencil;
  protected readonly PowerIcon = Power;
  protected readonly PowerOffIcon = PowerOff;
  protected readonly Trash2Icon = Trash2;

  protected readonly metrics = computed(() => {
    const j = this.job();
    return j === null ? [] : buildJobMetrics(j, this.description());
  });

  protected readonly dotClass = computed(() => {
    const j = this.job();
    return j === null ? '' : jobDotClass(j);
  });

  protected readonly statusLabel = computed(() => {
    const j = this.job();
    return j === null ? '' : jobStatusLabel(j);
  });

  protected time(epochMs: number | null): string {
    return formatTime(epochMs);
  }

  protected statusDotClass(run: JobRunDto): string {
    return runStatusDotClass(run.status);
  }
}
