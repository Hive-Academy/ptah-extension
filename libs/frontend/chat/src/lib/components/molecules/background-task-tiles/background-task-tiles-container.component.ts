import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { BackgroundTaskStore } from '@ptah-extension/chat-streaming';
import { isAgentTaskType } from '@ptah-extension/shared';
import {
  BackgroundTaskTilesComponent,
  type BackgroundTaskTile,
} from './background-task-tiles.component';

/** Resolves this chat view's tab to the live SDK task snapshot. */
@Component({
  selector: 'ptah-background-task-tiles-container',
  imports: [BackgroundTaskTilesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `<ptah-background-task-tiles [tasks]="tiles()" [now]="now()" />`,
})
export class BackgroundTaskTilesContainerComponent {
  readonly tabId = input<string | null>(null);
  private readonly tabManager = inject(TabManagerService);
  private readonly backgroundTasks = inject(BackgroundTaskStore);
  protected readonly now = signal(Date.now());

  private readonly sessionId = computed(() => {
    const tabId = this.tabId();
    return tabId
      ? (this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab
          .claudeSessionId ?? null)
      : null;
  });

  protected readonly tiles = computed<readonly BackgroundTaskTile[]>(() => {
    const sessionId = this.sessionId();
    return this.backgroundTasks
      .tasksForSession(sessionId)
      .filter((task) => !isAgentTaskType(task.taskType))
      .map((task) => ({
        ...task,
        firstSeenAt:
          this.backgroundTasks.firstSeenAt(sessionId, task.taskId) ??
          Date.now(),
      }));
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.tiles().length) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 1_000);
      onCleanup(() => clearInterval(timer));
    });
  }
}
