import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Moon,
  ChevronDown,
  ChevronUp,
} from 'lucide-angular';
import { SdkBackgroundTaskSummary } from '@ptah-extension/shared';

/**
 * AwaitingBackgroundIndicatorComponent — pill rendered when a tab's SessionStatus
 * is `'awaiting-background'`. Presentational only; expands to list in-flight
 * `SdkBackgroundTaskSummary` entries on click.
 */
@Component({
  selector: 'ptah-awaiting-background-indicator',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="inline-flex flex-col gap-1 text-xs"
      [attr.data-test]="'awaiting-background-indicator'"
    >
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-base-200/60 text-base-content/70 animate-pulse-slow hover:bg-base-200 transition-colors"
        [attr.aria-expanded]="hasTasks() ? expanded() : null"
        [attr.aria-label]="ariaLabel()"
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
          class="flex flex-col gap-0.5 pl-4 text-[10px] text-base-content/60"
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

  protected readonly MoonIcon = Moon;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  private readonly _expanded = signal(false);
  readonly expanded = this._expanded.asReadonly();

  protected hasTasks(): boolean {
    return this.tasks().length > 0;
  }

  protected label(): string {
    const count = this.taskCount();
    return `Working in background — ${count} task(s)`;
  }

  protected ariaLabel(): string {
    return this.label();
  }

  toggleExpanded(): void {
    if (!this.hasTasks()) return;
    this._expanded.update((v) => !v);
  }
}
