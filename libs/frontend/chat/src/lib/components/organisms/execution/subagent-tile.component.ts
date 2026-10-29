import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  Injector,
} from '@angular/core';
import {
  Bot,
  Check,
  CircleX,
  LoaderCircle,
  ArrowUpRight,
  ShieldAlert,
  LucideAngularModule,
} from 'lucide-angular';
import type { ExecutionNode, PermissionRequest } from '@ptah-extension/shared';
import {
  AgentMonitorStore,
  SubagentExecutionStore,
} from '@ptah-extension/chat-streaming';
import { formatAgentElapsed } from '@ptah-extension/chat-ui';
import { SESSION_CARD_ACTIONS, SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { laneKey } from '../../molecules/compact-session/compact-lane-rows';
import { BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionHistoryReplayer } from '../../../services/chat-store/session-history-replayer.service';

/** One transcript row for an agent. The full execution tree lives in the selected lane. */
@Component({
  selector: 'ptah-subagent-tile',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="my-1 rounded-lg border border-base-content/10 bg-base-200/40 px-3 py-2 text-xs"
      data-testid="subagent-tile"
    >
      <button
        type="button"
        class="flex items-center gap-2 min-w-0 w-full text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        [disabled]="!canOpen()"
        [attr.aria-label]="'Open ' + name() + ' agent lane'"
        (click)="openLane()"
        data-testid="subagent-open"
      >
        <lucide-angular
          [img]="BotIcon"
          class="w-4 h-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span class="font-medium truncate" data-testid="subagent-name">{{
          name()
        }}</span>
        @switch (status()) {
          @case ('completed') {
            <lucide-angular
              [img]="CheckIcon"
              class="w-3 h-3 text-success"
              aria-hidden="true"
            />
          }
          @case ('error') {
            <lucide-angular
              [img]="ErrorIcon"
              class="w-3 h-3 text-error"
              aria-hidden="true"
            />
          }
          @case ('stopped') {
            <lucide-angular
              [img]="ErrorIcon"
              class="w-3 h-3 text-base-content-muted"
              aria-hidden="true"
            />
          }
          @case ('loading') {
            <span class="w-3 h-3 rounded-full border border-base-content-muted" aria-hidden="true"></span>
          }
          @default {
            <lucide-angular
              [img]="RunningIcon"
              class="w-3 h-3 text-info"
              aria-hidden="true"
            />
          }
        }
        <span class="text-base-content-muted" data-testid="subagent-status">{{
          statusLabel()
        }}</span>
        <span class="ml-auto whitespace-nowrap text-base-content-muted"
          >{{ toolCount() }} tools</span
        >
        @if (duration(); as elapsed) {
          <span class="whitespace-nowrap text-base-content-muted">{{
            elapsed
          }}</span>
        }
        <lucide-angular
          [img]="OpenIcon"
          class="w-3.5 h-3.5"
          aria-hidden="true"
        />
      </button>
      @if (activity(); as line) {
        <p
          class="truncate text-base-content-muted mt-1"
          data-testid="subagent-activity"
        >
          {{ line }}
        </p>
      }
      @if (pendingPermission(); as permission) {
        <button
          type="button"
          class="badge badge-warning badge-sm mt-1 gap-1"
          [disabled]="!canOpen()"
          [attr.aria-label]="'Review pending permission for ' + name()"
          (click)="openPermission(permission)"
          data-testid="subagent-permission"
        >
          <lucide-angular
            [img]="PermissionIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
          Permission needed
        </button>
      }
    </div>
  `,
})
export class SubagentTileComponent {
  readonly node = input.required<ExecutionNode>();
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  private readonly monitor = inject(AgentMonitorStore, { optional: true });
  private readonly backgroundAgents = inject(BackgroundAgentStore, { optional: true });
  private readonly injector = inject(Injector);
  private readonly context = inject(SESSION_CONTEXT, { optional: true });
  private readonly executions = inject(SubagentExecutionStore);
  private readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });

  protected readonly BotIcon = Bot;
  protected readonly CheckIcon = Check;
  protected readonly ErrorIcon = CircleX;
  protected readonly RunningIcon = LoaderCircle;
  protected readonly OpenIcon = ArrowUpRight;
  protected readonly PermissionIcon = ShieldAlert;
  protected readonly canOpen = computed(
    () => !!this.actions && !!this.node().toolCallId,
  );
  protected readonly record = computed(() => {
    const id = this.node().toolCallId;
    return id ? this.monitor?.subagents().get(id) : undefined;
  });
  protected readonly name = computed(
    () =>
      this.record()?.teammateName ||
      this.node().agentType ||
      this.node().agentDescription ||
      'Subagent',
  );
  protected readonly tree = computed(() => {
    const key = this.node().toolCallId;
    if (key) this.executions.revisionFor(key);
    return key ? this.executions.treeFor(key) : [];
  });
  protected readonly activity = computed(() => {
    const tree = this.tree();
    if (tree.length > 0) {
      const latest = (nodes: readonly ExecutionNode[]): string | undefined => {
        for (let index = nodes.length - 1; index >= 0; index--) {
          const node = nodes[index];
          const child = latest(node.children);
          if (child) return child;
          if (node.type === 'tool' && node.toolName) return node.toolName;
          if (node.type === 'text' && node.content) return node.content;
        }
        return undefined;
      };
      return latest(tree)?.slice(0, 240);
    }
    return (
      this.record()?.latestSummary ||
      this.record()?.lastToolName ||
      this.node().agentDescription ||
      this.node().content
    );
  });
  protected readonly status = computed(() => {
    const recordStatus = this.record()?.status;
    if (recordStatus === 'failed') return 'error';
    if (recordStatus === 'stopped' || recordStatus === 'killed')
      return 'stopped';
    if (recordStatus === 'completed') return 'completed';
    if (this.historyReplaying()) return 'loading';
    const id = this.node().toolCallId;
    if (this.node().isBackground || recordStatus === 'background' ||
      (id && this.backgroundAgents?.isBackgroundAgent(id))) return 'background';
    if (this.node().status === 'error') return 'error';
    if (
      this.node().status === 'interrupted' ||
      this.node().status === 'resumed'
    )
      return 'stopped';
    if (this.node().status === 'complete') return 'completed';
    return 'running';
  });
  private historyReplaying(): boolean {
    // Isolated tile consumers can omit the session services entirely.
    try {
      const tabId = this.context?.() ?? this.injector.get(TabManagerService, null)?.activeTabId();
      return !!tabId && !!this.injector.get(SessionHistoryReplayer, null)?.replayingTabIds().has(tabId);
    } catch {
      // degradation-audit: optional-capability - a tile mounted without the
      // session services shows its own status instead of "Loading".
      return false;
    }
  }
  protected readonly statusLabel = computed(
    () =>
      ({
        running: 'Running',
        background: 'In background',
        loading: 'Loading',
        completed: 'Completed',
        error: 'Failed',
        stopped: 'Stopped',
      })[this.status()],
  );
  protected readonly toolCount = computed(() => {
    const count = (nodes: readonly ExecutionNode[]): number =>
      nodes.reduce(
        (total, child) =>
          total + (child.type === 'tool' ? 1 : 0) + count(child.children),
        0,
      );
    const tree = this.tree();
    return tree.length > 0
      ? count(tree)
      : (this.record()?.toolUses ?? count(this.node().children));
  });
  protected readonly duration = computed(() =>
    formatAgentElapsed(
      this.record()?.durationMs ??
        this.node().duration ??
        (this.node().startTime && this.node().endTime
          ? this.node().endTime! - this.node().startTime!
          : undefined),
    ),
  );
  protected readonly pendingPermission = computed(() =>
    this.findPendingPermission(),
  );
  private findPendingPermission(): PermissionRequest | null {
    const lookup = this.getPermissionForTool();
    if (!lookup) return null;
    const find = (
      nodes: readonly ExecutionNode[],
    ): PermissionRequest | null => {
      for (const child of nodes) {
        if (child.type === 'tool' && child.toolCallId) {
          const permission = lookup(child.toolCallId);
          if (permission) return permission;
        }
        const nested = find(child.children);
        if (nested) return nested;
      }
      return null;
    };
    return find(this.node().children);
  }

  protected openLane(): void {
    const id = this.node().toolCallId;
    if (id && this.actions)
      this.actions.openLane(
        laneKey(
          this.record()?.status === 'background' ? 'background' : 'subagent',
          id,
        ),
      );
  }

  protected openPermission(permission: PermissionRequest): void {
    // A permission may disappear between render and activation.
    if (this.findPendingPermission()?.id === permission.id) this.openLane();
  }
}
