import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Moon,
  ChevronDown,
  ChevronUp,
} from 'lucide-angular';
import {
  SdkBackgroundTaskSummary,
  SdkSessionCronSummary,
} from '@ptah-extension/shared';

/**
 * AwaitingBackgroundIndicatorComponent — pill rendered when a tab's
 * SessionStatus is `'awaiting-background'` or `'sleeping'`. Presentational
 * only.
 *
 * - With `tasks`: "Working in background — N task(s)"; expands to list the
 *   in-flight `SdkBackgroundTaskSummary` entries on click.
 * - With no `tasks` and `crons`: "Sleeping — N scheduled wakeup(s)"; the raw
 *   cron `schedule` strings go in the title attribute. No cron parsing here —
 *   the SDK's own string is the truth (TASK_2026_360).
 */
@Component({
  selector: 'ptah-awaiting-background-indicator',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="inline-flex flex-col gap-1 text-xs"
      [attr.data-test]="'awaiting-background-indicator'"
      [attr.data-mode]="mode()"
    >
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-base-200/60 text-base-content-muted animate-pulse-slow hover:bg-base-200 transition-colors"
        [attr.aria-expanded]="hasTasks() ? expanded() : null"
        [attr.aria-label]="ariaLabel()"
        [attr.title]="title()"
        [disabled]="!hasTasks()"
        (click)="toggleExpanded()"
      >
        <lucide-angular
          [img]="MoonIcon"
          class="w-3 h-3 flex-shrink-0"
          [attr.data-test]="'awaiting-background-icon'"
        />
        <span class="truncate">{{ label() }}</span>
        @if (hasTasks()) {
          <lucide-angular
            [img]="expanded() ? ChevronUpIcon : ChevronDownIcon"
            class="w-3 h-3 flex-shrink-0 opacity-60"
          />
        }
      </button>

      @if (expanded() && hasTasks()) {
        <ul
          class="flex flex-col gap-0.5 pl-4 text-[10px] text-base-content-muted"
          role="list"
          [attr.data-test]="'awaiting-background-task-list'"
        >
          @for (task of tasks(); track task.id) {
            <li class="flex items-center gap-1.5 truncate">
              <span class="badge badge-ghost badge-xs">{{ task.type }}</span>
              <span class="truncate" [title]="task.description">{{
                task.description
              }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AwaitingBackgroundIndicatorComponent {
  readonly taskCount = input<number>(0);
  readonly tasks = input<readonly SdkBackgroundTaskSummary[]>([]);
  /** Session crons (ScheduleWakeup / loop) that will wake the session. */
  readonly crons = input<readonly SdkSessionCronSummary[]>([]);

  protected readonly MoonIcon = Moon;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  private readonly _expanded = signal(false);
  readonly expanded = this._expanded.asReadonly();

  /** `sleeping` only when there is no background work left to wait on. */
  protected readonly mode = computed<'working' | 'sleeping'>(() =>
    this.tasks().length === 0 && this.crons().length > 0
      ? 'sleeping'
      : 'working',
  );

  protected readonly label = computed<string>(() => {
    if (this.mode() === 'sleeping') {
      return `Sleeping — ${this.crons().length} scheduled wakeup(s)`;
    }
    return `Working in background — ${this.taskCount()} task(s)`;
  });

  /** Raw schedules, one per line, for the hover tooltip. */
  protected readonly title = computed<string | null>(() => {
    if (this.mode() !== 'sleeping') return null;
    return this.crons()
      .map((cron) => cron.schedule)
      .join('\n');
  });

  protected hasTasks(): boolean {
    return this.tasks().length > 0;
  }

  protected ariaLabel(): string {
    return this.label();
  }

  toggleExpanded(): void {
    if (!this.hasTasks()) return;
    this._expanded.update((v) => !v);
  }
}
