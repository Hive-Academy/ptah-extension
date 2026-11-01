import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { LoaderCircle, LucideAngularModule } from 'lucide-angular';
import type { BackgroundTaskSnapshotEntry } from '@ptah-extension/shared';

export interface BackgroundTaskTile extends BackgroundTaskSnapshotEntry {
  readonly firstSeenAt: number;
}

/** Compact, non-interactive running-task status above the composer. */
@Component({
  selector: 'ptah-background-task-tiles',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `
    @if (visibleTasks().length) {
      <div
        class="flex justify-end gap-1 px-2 pb-1"
        role="list"
        aria-label="Running background tasks"
      >
        @for (task of visibleTasks(); track task.taskId) {
          <span
            role="listitem"
            tabindex="0"
            class="group relative inline-flex h-7 max-w-[140px] shrink-0 items-center gap-1.5 rounded-full border border-base-content/15 bg-base-200 px-1 text-xs text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
            [attr.aria-label]="shortLabel(task)"
            [attr.aria-describedby]="tooltipId('task:' + task.taskId)"
            (focus)="showTooltip()"
            (mouseleave)="showTooltip()"
            (keydown.escape)="dismissTooltip(task.taskId, $event)"
            data-test="background-task-tile"
          >
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-base-300"
            >
              <lucide-angular
                [img]="LoaderIcon"
                class="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            </span>
            <span class="min-w-0 truncate">{{ label(task) }}</span>
            <span
              role="tooltip"
              [id]="tooltipId('task:' + task.taskId)"
              [style.display]="
                dismissedTooltip() === task.taskId ? 'none' : null
              "
              class="pointer-events-none absolute bottom-full right-0 z-50 mb-1 hidden w-max max-w-80 whitespace-pre-wrap break-words rounded-lg border border-base-content/15 bg-base-200 p-2 text-left text-xs text-base-content shadow-lg group-hover:block group-focus:block"
              >{{ tooltipText(task) }}</span
            >
          </span>
        }
        @if (overflowTasks().length) {
          <span
            role="listitem"
            tabindex="0"
            class="group relative inline-flex h-7 shrink-0 items-center rounded-full border border-base-content/15 bg-base-200 px-2 text-xs text-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
            [attr.aria-label]="
              '+' + overflowTasks().length + ' more running tasks'
            "
            [attr.aria-describedby]="tooltipId('overflow')"
            (focus)="showTooltip()"
            (mouseleave)="showTooltip()"
            (keydown.escape)="dismissTooltip('overflow', $event)"
            data-test="background-task-overflow"
          >
            +{{ overflowTasks().length }}
            <span
              role="tooltip"
              [id]="tooltipId('overflow')"
              [style.display]="
                dismissedTooltip() === 'overflow' ? 'none' : null
              "
              class="pointer-events-none absolute bottom-full right-0 z-50 mb-1 hidden w-max max-w-80 whitespace-pre-wrap break-words rounded-lg border border-base-content/15 bg-base-200 p-2 text-left text-xs text-base-content shadow-lg group-hover:block group-focus:block"
              >{{ overflowText() }}</span
            >
          </span>
        }
      </div>
    }
  `,
})
export class BackgroundTaskTilesComponent {
  private static nextInstanceId = 0;
  readonly tasks = input.required<readonly BackgroundTaskTile[]>();
  readonly now = input(Date.now());
  protected readonly LoaderIcon = LoaderCircle;
  protected readonly dismissedTooltip = signal<string | null>(null);
  private readonly tooltipPrefix = `background-task-tooltip-${BackgroundTaskTilesComponent.nextInstanceId++}`;
  protected readonly visibleTasks = computed(() =>
    this.tasks().slice(0, this.tasks().length > 4 ? 3 : 4),
  );
  protected readonly overflowTasks = computed(() =>
    this.tasks().slice(this.visibleTasks().length),
  );

  protected tooltipId(taskId: string): string {
    return `${this.tooltipPrefix}-${encodeURIComponent(taskId)}`;
  }

  protected shortLabel(task: BackgroundTaskTile): string {
    return `Running ${task.taskType}: ${task.description}`;
  }

  protected showTooltip(): void {
    this.dismissedTooltip.set(null);
  }

  protected dismissTooltip(taskId: string, event: Event): void {
    this.dismissedTooltip.set(taskId);
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
  }

  protected label(task: BackgroundTaskTile): string {
    return task.command ?? task.description;
  }

  protected tooltipText(task: BackgroundTaskTile): string {
    const elapsed = Math.max(
      0,
      Math.floor((this.now() - task.firstSeenAt) / 1000),
    );
    const minutes = Math.floor(elapsed / 60);
    const time = minutes ? `${minutes}m ${elapsed % 60}s` : `${elapsed}s`;
    return `${task.taskType}\n${this.label(task)}\nElapsed: ${time}`;
  }

  protected overflowText(): string {
    return this.overflowTasks()
      .map((task) => this.label(task))
      .join('\n');
  }
}
