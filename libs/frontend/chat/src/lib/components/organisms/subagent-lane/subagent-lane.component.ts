import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { LucideAngularModule, MessageSquare, Moon, Square } from 'lucide-angular';
import { AgentMonitorStore, type SubagentRecord } from '@ptah-extension/chat-streaming';
import { AgentSteerInputComponent, AgentSummaryComponent, agentRunLabel } from '@ptah-extension/chat-ui';
import type { ExecutionNode, PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { ExecutionHeaderComponent } from '../../molecules/execution-header/execution-header.component';
import { SubagentUsageSummaryComponent } from '../../molecules/agent-card/subagent-usage-summary.component';
import { ExecutionNodeComponent } from '../execution/execution-node.component';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { formatTokens } from '../../molecules/agent-card/stats-bar.utils';
import { summarizeExecutionNodes } from '../../../utils/message-summary.utils';
import { subagentProgressText } from '../../../utils/subagent-progress.utils';

@Component({
  selector: 'ptah-subagent-lane',
  standalone: true,
  imports: [SlicePipe, LucideAngularModule, AgentSteerInputComponent, AgentSummaryComponent, ExecutionHeaderComponent, SubagentUsageSummaryComponent, ExecutionNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-execution-header
      kind="subagent"
      [label]="label()"
      [live]="live()"
      [peek]="progress()"
      [toolCount]="summary().toolCount || (record().toolUses ?? 0)"
      [filesChanged]="summary().filesChanged"
      [extraMeta]="meta()"
      [controlsId]="'subagent-lane-details-' + record().parentToolUseId"
    >
      @if (context(); as ctx) {
        <div executionHeaderActions class="flex shrink-0 items-center gap-0.5">
          @if (ctx.entry.canBackground) {
            <button type="button" class="btn btn-ghost btn-xs btn-square"
              [attr.aria-label]="'Send ' + name() + ' to background'"
              [disabled]="backgroundPending()" (click)="onBackground(ctx)">
              <lucide-angular [img]="MoonIcon" class="h-3 w-3" aria-hidden="true" />
            </button>
          }
          @if (ctx.entry.stoppable) {
            <button type="button" class="btn btn-ghost btn-xs btn-square"
              [attr.aria-label]="'Stop ' + name()" [disabled]="stopPending()" (click)="onStop(ctx)">
              <lucide-angular [img]="SquareIcon" class="h-3 w-3 text-error" aria-hidden="true" />
            </button>
          }
          @if (ctx.entry.steerable) {
            <button #steerToggle type="button" class="btn btn-ghost btn-xs btn-square"
              [attr.aria-label]="'Message ' + name()" [attr.aria-expanded]="steerOpen()"
              [attr.aria-controls]="'subagent-steer-' + record().parentToolUseId"
              (click)="toggleSteer()">
              <lucide-angular [img]="MessageIcon" class="h-3 w-3" aria-hidden="true" />
            </button>
          }
        </div>
      }
      <ptah-subagent-usage-summary class="block pt-1.5" [record]="record()" />
      <dl class="space-y-1 py-1">
        @if (record().usage?.model) { <div><dt class="inline font-medium">Model: </dt><dd class="inline">{{ record().usage?.model }}</dd></div> }
        @if (record().description) { <div><dt class="inline font-medium">Task: </dt><dd class="inline">{{ record().description }}</dd></div> }
        @if (record().parentSessionId) {
          <div><dt class="inline font-medium">Parent: </dt><dd class="inline font-mono" [title]="record().parentSessionId">{{ record().parentSessionId | slice: 0 : 8 }}&hellip;</dd></div>
        }
      </dl>
    </ptah-execution-header>
    @if (commandError(); as err) {
      <p role="alert" class="py-1 text-xs text-error" data-testid="subagent-command-error">{{ err.message }}</p>
    }
    @if (steerOpen() && context()?.entry?.steerable) {
      <ptah-agent-steer-input class="block" [id]="'subagent-steer-' + record().parentToolUseId"
        [steerable]="true" [pending]="steerPending()" (keydown.escape)="closeSteer($event)"
        [clearOnSubmit]="false" [placeholder]="'Steer ' + name() + '...'"
        (steer)="onSteer($event)" />
      @if (steerFailed()) {
        <p role="alert" class="py-1 text-xs text-error">Could not send your message. Try again.</p>
      }
    }
    <div class="space-y-2 pt-2">
      @if (summaryContent()) {
        <ptah-agent-summary [content]="summaryContent()!" />
      }
      @for (node of nodes(); track node.id) {
        <ptah-execution-node [node]="node" [agentTileMode]="false"
          [getPermissionForTool]="getPermissionForTool()"
          (permissionResponded)="permissionResponded.emit($event)" />
      } @empty {
        @if (!summaryContent() && !suppressEmpty()) {
          <p class="text-xs text-base-content-muted">{{ live() ? 'Starting agent' : 'No output recorded' }}</p>
        }
      }
    </div>
  `,
})
export class SubagentLaneComponent {
  readonly record = input.required<SubagentRecord>();
  readonly sessionId = input<string | null>(null);
  readonly nodes = input<readonly ExecutionNode[]>([]);
  readonly summaryContent = input<string | null>(null);
  readonly suppressEmpty = input(false);
  readonly getPermissionForTool = input<((toolCallId: string) => PermissionRequest | null) | undefined>();
  readonly permissionResponded = output<PermissionResponse>();

  protected readonly tray = inject(SessionAgentTrayService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly steerToggle = viewChild<ElementRef<HTMLButtonElement>>('steerToggle');
  protected readonly MoonIcon = Moon;
  protected readonly SquareIcon = Square;
  protected readonly MessageIcon = MessageSquare;
  protected readonly steerOpen = signal(false);
  protected readonly steerPending = signal(false);
  protected readonly steerFailed = signal(false);
  protected readonly stopPending = signal(false);
  protected readonly backgroundPending = signal(false);
  protected readonly context = computed(() => this.tray.contextsFor(this.sessionId()).get(this.record().parentToolUseId) ?? null);
  protected readonly name = computed(() => this.record().teammateName || this.record().agentType || this.record().agentId || 'Sub-agent');
  protected readonly live = computed(() => ['running', 'pending', 'background'].includes(this.record().status));
  protected readonly label = computed(() => {
    const record = this.record();
    const live = this.live();
    if (live) this.monitor.tick();
    return agentRunLabel({ running: live, startedAt: record.startedAt, endedAt: record.completedAt, reportedMs: record.durationMs }, Date.now());
  });
  protected readonly progress = computed(() => subagentProgressText(this.record()));
  protected readonly summary = computed(() => summarizeExecutionNodes(this.nodes()));
  protected readonly meta = computed(() => {
    const record = this.record();
    const meta: string[] = [];
    if (record.totalTokens !== undefined && Number.isFinite(record.totalTokens) && record.totalTokens > 0) meta.push(`${formatTokens(record.totalTokens)} tokens`);
    if (record.status === 'background') meta.push('Background');
    return meta;
  });
  protected readonly commandError = computed(() => {
    const error = this.monitor.subagentRpcError();
    return error?.parentToolUseId === this.record().parentToolUseId ? error : null;
  });

  protected toggleSteer(): void {
    if (this.steerOpen()) {
      this.steerOpen.set(false);
      return;
    }
    this.steerOpen.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('ptah-agent-steer-input input')?.focus(), { injector: this.injector });
  }

  protected closeSteer(event: Event): void {
    event.stopPropagation();
    this.steerOpen.set(false);
    this.steerToggle()?.nativeElement.focus();
  }

  protected async onStop(ctx: TrayAgentContext): Promise<void> {
    if (this.stopPending() || !ctx.taskId) return;
    this.stopPending.set(true);
    try {
      await this.monitor.stopAgent(ctx.taskId, ctx.sessionId);
    } finally {
      this.stopPending.set(false);
    }
  }

  protected async onBackground(ctx: TrayAgentContext): Promise<void> {
    if (this.backgroundPending() || !ctx.sessionId) return;
    this.backgroundPending.set(true);
    try {
      await this.monitor.backgroundAgent(ctx.sessionId, ctx.entry.id);
    } finally {
      this.backgroundPending.set(false);
    }
  }

  protected async onSteer(text: string): Promise<void> {
    const context = this.context();
    if (!context || !context.entry.steerable) return;
    this.steerFailed.set(false);
    this.steerPending.set(true);
    try {
      if (await this.tray.steer(context, text)) this.steerOpen.set(false);
      else this.steerFailed.set(true);
    } finally {
      this.steerPending.set(false);
    }
  }
}
