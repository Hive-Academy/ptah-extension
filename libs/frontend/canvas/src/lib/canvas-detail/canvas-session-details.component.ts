import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import {
  SessionGitStatsStore,
  sessionWorkingRoot,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  summarizeTodos,
  sameGitState,
  todoTitle,
  gitTitle,
  type CompactTodoState,
} from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';

/** Session accounting from the tab snapshot; missing sources remain unavailable. */
@Component({
  selector: 'ptah-canvas-session-details',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto bg-base-100' },
  template: `
    <aside class="p-4 space-y-4" aria-label="Session details">
      <h3 class="text-sm font-semibold">Session details</h3>
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span>Context</span>
          <span>{{
            contextPercent() === null ? '—' : contextPercent() + '%'
          }}</span>
        </div>
        <progress
          class="progress progress-primary w-full"
          [value]="contextPercent() ?? 0"
          max="100"
          [attr.aria-label]="'Context usage'"
          [attr.aria-valuetext]="
            contextPercent() === null ? 'Unavailable' : contextPercent() + '%'
          "
        ></progress>
      </div>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Tokens</dt>
          <dd>{{ tokens() === null ? '—' : (tokens() | number) }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Cost</dt>
          <dd>
            {{ cost() === null ? '—' : '$' + (cost() | number: '1.2-4') }}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Turns</dt>
          <dd>{{ turns() === null ? '—' : turns() }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Todos</dt>
          <dd class="min-w-0 max-w-36 flex gap-1" [title]="todoTitle()">
            @if (todos().kind === 'known') {
              <span class="shrink-0">{{ todoCount() }}</span>
              @if (todoActive()) {
                <span class="truncate">{{ todoActive() }}</span>
              }
            } @else {
              —
            }
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Git</dt>
          <dd class="truncate max-w-36" [title]="branch() ?? ''">
            {{ branch() ?? '—' }}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt>Changes</dt>
          <dd class="font-mono" [title]="changesTitle()">
            @if (gitStats().kind === 'known') {
              <span class="text-success">+{{ additions() }}</span>
              <span class="text-error"> −{{ deletions() }}</span>
              @if (partial()) {
                <span>+</span>
              }
            } @else {
              —
            }
          </dd>
        </div>
      </dl>
    </aside>
  `,
  imports: [DecimalPipe],
})
export class CanvasSessionDetailsComponent {
  private readonly tabs = inject(TabManagerService);
  private readonly gitStore = inject(SessionGitStatsStore);
  private readonly vscode = inject(VSCodeService);
  readonly tabId = input.required<string>();
  readonly tab = computed(
    () => this.tabs.tabs().find((tab) => tab.id === this.tabId()) ?? null,
  );
  readonly contextPercent = computed(() => {
    const stats = this.tab()?.liveModelStats;
    return stats?.contextKnown && Number.isFinite(stats.contextPercent)
      ? Math.max(0, Math.min(100, Math.round(stats.contextPercent)))
      : null;
  });
  readonly tokens = computed(
    () => this.tab()?.sessionStats?.tokenCount ?? null,
  );
  readonly cost = computed(() => this.tab()?.sessionStats?.totalCost ?? null);
  readonly turns = computed(
    () => this.tab()?.sessionStats?.messageCount ?? null,
  );
  readonly branch = computed(() => this.tab()?.agentOrigin?.branch ?? null);
  readonly todos = computed(() => {
    const tab = this.tab();
    return tab
      ? summarizeTodos(
          tab.messages ?? [],
          tab.streamingState ?? null,
          tab.lastCompactionAt ?? 0,
        )
      : ({ kind: 'none' } satisfies CompactTodoState);
  });
  readonly todoTitle = computed(() => todoTitle(this.todos()));
  readonly todoCount = computed(() => {
    const todo = this.todos();
    return todo.kind === 'known' ? `${todo.done}/${todo.total}` : '';
  });
  readonly todoActive = computed(() => {
    const todo = this.todos();
    return todo.kind === 'known' ? todo.active : null;
  });
  readonly gitRoot = computed(() => {
    const tab = this.tab();
    return tab
      ? sessionWorkingRoot(
          tab,
          this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.workspacePath ??
            null,
          this.vscode.config().workspaceRoot,
        )
      : null;
  });
  readonly gitStats = computed(() => this.gitStore.stateFor(this.gitRoot()), {
    equal: sameGitState,
  });
  readonly changesTitle = computed(() => gitTitle(this.gitStats()));
  readonly additions = computed(() => {
    const git = this.gitStats();
    return git.kind === 'known' ? git.additions : 0;
  });
  readonly deletions = computed(() => {
    const git = this.gitStats();
    return git.kind === 'known' ? git.deletions : 0;
  });
  readonly partial = computed(() => {
    const git = this.gitStats();
    return git.kind === 'known' && git.partial;
  });

  constructor() {
    effect((onCleanup) => {
      const root = this.gitRoot();
      const tabId = this.tabId();
      if (root) onCleanup(this.gitStore.track(root, tabId));
    });
  }
}
