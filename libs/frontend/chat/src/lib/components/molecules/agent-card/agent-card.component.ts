/**
 * Agent Card Component
 *
 * Thin orchestrator that composes header, permission, and output sub-components.
 * Displays a single monitored agent in the agent monitor sidebar.
 */

import {
  Component,
  input,
  output,
  computed,
  signal,
  inject,
  Injector,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { LucideAngularModule, Play, Square, X } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { CliAgentOutputComponent } from './cli-agent-output.component';
import { AgentCardHeaderComponent } from './agent-card-header.component';
import { laneGuardStopText } from './agent-card-header.component';
import { CliLaneUsageSummaryComponent } from './cli-lane-usage-summary.component';
import { ExecutionHeaderComponent } from '../execution-header/execution-header.component';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import { cliActivity } from '../../../services/session-agents/session-agent-roster';
import { summarizeExecutionNodes } from '../../../utils/message-summary.utils';
import { cliLaneStats } from '../../../utils/lane-stats.adapters';
import {
  createAgentOutputParser,
  createStderrParser,
} from './agent-card.utils';
import {
  AgentLaneStatsComponent,
  agentRunDurationMs,
  agentRunLabel,
  formatAgentDuration,
  type RenderSegment,
  type StderrSegment,
} from '@ptah-extension/chat-ui';

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [
    SlicePipe,
    LucideAngularModule,
    AgentCardHeaderComponent,
    ExecutionHeaderComponent,
    CliLaneUsageSummaryComponent,
    AgentLaneStatsComponent,
    CliAgentOutputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border border-base-content/10 rounded-lg overflow-hidden bg-base-100 flex flex-col h-full"
      [class.!border-0]="presentation() === 'flat'"
      [class.!rounded-none]="presentation() === 'flat'"
      [class.!bg-transparent]="presentation() === 'flat'"
      [class.!overflow-visible]="presentation() === 'flat'"
      [class.text-[13px]]="presentation() === 'flat'"
      [class.leading-[1.6]]="presentation() === 'flat'"
    >
      @if (presentation() === 'flat') {
        <ptah-execution-header
          class="block flex-shrink-0"
          kind="cli"
          [label]="laneLabel()"
          [live]="agent().status === 'running'"
          [peek]="lanePeek()"
          [toolCount]="laneSummary().toolCount"
          [filesChanged]="laneSummary().filesChanged"
          [extraMeta]="laneMeta()"
          [metaTone]="
            agent().status === 'failed' ||
            agent().status === 'timeout' ||
            agent().status === 'stopped' ||
            laneStopReason()
              ? 'warning'
              : 'muted'
          "
          [controlsId]="'cli-lane-details-' + agent().agentId"
        >
          <div
            executionHeaderActions
            class="flex shrink-0 items-center gap-0.5"
          >
            @if (agent().status === 'running') {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square"
                [disabled]="isStopping()"
                [attr.aria-label]="'Stop ' + laneName()"
                (click)="stopAgent($event)"
              >
                @if (isStopping()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  <lucide-angular
                    [img]="SquareIcon"
                    class="h-3 w-3 text-error"
                    aria-hidden="true"
                  />
                }
              </button>
            } @else if (agent().cliSessionId) {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square"
                [disabled]="isResuming()"
                [attr.aria-label]="'Resume ' + laneName() + ' session'"
                (click)="resumeAgent($event)"
              >
                @if (isResuming()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  <lucide-angular
                    [img]="PlayIcon"
                    class="h-3 w-3 text-success"
                    aria-hidden="true"
                  />
                }
              </button>
            }
            @if (closable()) {
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square"
                [attr.aria-label]="'Remove ' + laneName() + ' column'"
                (click)="closeLane.emit(agent().agentId)"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="h-3 w-3"
                  aria-hidden="true"
                />
              </button>
            }
          </div>
          <dl class="space-y-1 py-1">
            <div>
              <dt class="inline font-medium">Status:</dt>
              <dd class="ms-1 inline">{{ laneStatus() }}</dd>
            </div>
            @if (agent().task) {
              <div>
                <dt class="inline font-medium">Task:</dt>
                <dd class="ms-1 inline">{{ agent().task }}</dd>
              </div>
            }
            @if (agent().cliSessionId) {
              <div>
                <dt class="inline font-medium">CLI session:</dt>
                <dd class="ms-1 inline break-all font-mono">
                  {{ agent().cliSessionId }}
                </dd>
              </div>
            }
            @if (agent().parentSessionId) {
              <div>
                <dt class="inline font-medium">Parent:</dt>
                <dd class="ms-1 inline break-all font-mono">
                  {{ agent().parentSessionId }}
                </dd>
              </div>
            }
          </dl>
        </ptah-execution-header>
        <!-- Outside the collapsible details, so it is always visible. -->
        <ptah-agent-lane-stats
          class="block flex-shrink-0"
          [stats]="laneStats()"
        />
      } @else {
        <!-- Card header -->
        <ptah-agent-card-header
          class="block flex-shrink-0"
          [agent]="agent()"
          [elapsedDisplay]="elapsedDisplay()"
          [isStopping]="isStopping()"
          [isResuming]="isResuming()"
          [closable]="closable()"
          presentation="card"
          (toggleExpanded)="toggleExpanded.emit()"
          (stopAgent)="stopAgent($event)"
          (resumeAgent)="resumeAgent($event)"
          (closeLane)="closeLane.emit(agent().agentId)"
        />

        <ptah-cli-lane-usage-summary
          class="block px-2 pt-1.5 flex-shrink-0"
          [agent]="agent()"
        />
      }

      @if (presentation() === 'flat' || agent().expanded) {
        <!-- Task description (collapsible, default collapsed) -->
        @if (presentation() === 'card') {
          <details class="border-t border-base-content/10 flex-shrink-0">
            <summary
              class="px-2 py-0.5 cursor-pointer select-none hover:bg-base-200/30 transition-colors flex items-center gap-1.5"
              [class.!px-0]="presentation() === 'flat'"
            >
              <span class="text-[10px] font-medium text-base-content-muted"
                >Task</span
              >
              @if (agent().parentSessionId) {
                <span
                  class="text-[9px] text-base-content-muted ml-auto"
                  [title]="'Parent session: ' + agent().parentSessionId!"
                  >Parent:
                  {{ agent().parentSessionId! | slice: 0 : 8 }}&hellip;</span
                >
              }
            </summary>
            <div class="px-2 pb-1" [class.!px-0]="presentation() === 'flat'">
              <p
                class="text-[11px] leading-snug text-base-content-muted line-clamp-3"
              >
                {{ agent().task }}
              </p>
            </div>
          </details>
        }

        <!-- Output -->
        @if (
          agent().stdout ||
          agent().stderr ||
          agent().segments.length > 0 ||
          agent().streamEvents.length > 0
        ) {
          <ptah-cli-agent-output
            class="block flex-1 min-h-0 overflow-hidden"
            [agentId]="agent().agentId"
            [segments]="agent().segments"
            [stdoutSegments]="parsedOutput()"
            [streamEvents]="agent().streamEvents"
            [streamRevision]="agent().streamRevision"
            [stderrSegments]="parsedStderr()"
            [isStreaming]="agent().status === 'running'"
            [scrollTrigger]="scrollTrigger()"
            [presentation]="presentation()"
            [(rawStdoutOpen)]="rawStdoutOpen"
            [(rawStdoutAutoCollapsed)]="rawStdoutAutoCollapsed"
          />
        }
      }
    </div>
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly closable = input(false);
  readonly presentation = input<'card' | 'flat'>('card');
  readonly toggleExpanded = output<void>();
  readonly closeLane = output<string>();

  private readonly store = inject(AgentMonitorStore);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly injector = inject(Injector);
  protected readonly SquareIcon = Square;
  protected readonly PlayIcon = Play;
  protected readonly XIcon = X;
  protected readonly laneName = computed(
    () => this.agent().displayName || this.agent().cli,
  );

  readonly isStopping = signal(false);
  readonly isResuming = signal(false);

  /** Raw stdout disclosure state. Held here rather than in the output component
   *  because `@if (agent().expanded)` unmounts that component on card collapse,
   *  which would discard a disclosure the user had opened. */
  readonly rawStdoutOpen = signal(true);
  readonly rawStdoutAutoCollapsed = signal(false);

  /**
   * Elapsed time display derived from the store's shared tick signal.
   * No per-card setInterval — the store drives a single 1s timer.
   * Freezes at completedAt when the agent finishes (no more ticking).
   */
  readonly elapsedDisplay = computed(() => {
    const a = this.agent();
    if (a.status === 'running') this.store.tick();
    const duration = agentRunDurationMs(
      {
        running: a.status === 'running',
        startedAt: a.startedAt,
        endedAt: a.completedAt,
      },
      Date.now(),
    );
    return duration === null ? '' : (formatAgentDuration(duration) ?? '');
  });

  protected readonly laneLabel = computed(() => {
    const a = this.agent();
    if (a.status === 'running') this.store.tick();
    return agentRunLabel(
      {
        running: a.status === 'running',
        startedAt: a.startedAt,
        endedAt: a.completedAt,
      },
      Date.now(),
    );
  });
  protected readonly lanePeek = computed(() => cliActivity(this.agent()));
  protected readonly laneStatus = computed(() => {
    switch (this.agent().status) {
      case 'failed':
        return 'Failed';
      case 'timeout':
        return 'Timed out';
      case 'stopped':
        return 'Stopped';
      case 'running':
        return 'Running';
      default:
        return 'Completed';
    }
  });
  protected readonly laneStopReason = computed(() =>
    this.agent().status === 'running'
      ? null
      : laneGuardStopText(this.agent().stopReason),
  );
  protected readonly laneNodes = computed(() => {
    if (this.presentation() !== 'flat') return [];
    const a = this.agent();
    const treeBuilder = this.injector.get(AgentMonitorTreeBuilderService);
    return a.streamEvents.length > 0
      ? treeBuilder.buildTree(a.agentId, a.streamEvents)
      : treeBuilder.buildTreeFromSegments(
          a.agentId,
          a.segments.filter(
            (segment) =>
              !(segment.type === 'info' && segment.usage !== undefined),
          ),
        );
  });
  protected readonly laneSummary = computed(() =>
    summarizeExecutionNodes(this.laneNodes()),
  );
  /** Tokens, model and cost live in the lane stats bar, not in the header meta. */
  protected readonly laneStats = computed(() => cliLaneStats(this.agent()));
  protected readonly laneMeta = computed(() => {
    const a = this.agent();
    const meta: string[] = [];
    if (
      a.status === 'failed' ||
      a.status === 'timeout' ||
      a.status === 'stopped'
    )
      meta.push(this.laneStatus());
    const stopReason = this.laneStopReason();
    if (stopReason) meta.push(stopReason);
    return meta;
  });

  /**
   * Per-card parsers. Output only grows by appending between trims, so each
   * update re-parses the tail instead of the whole 50-100 KB buffer.
   */
  private readonly parseStdout = createAgentOutputParser();
  private readonly parseStderrBuffer = createStderrParser();

  /** The raw buffers, so a change to any other agent field does not re-parse. */
  private readonly stdout = computed(() => this.agent().stdout);
  private readonly stderr = computed(() => this.agent().stderr);

  /** Keep raw stdout available alongside structured output. */
  readonly parsedOutput = computed((): RenderSegment[] => {
    const stdout = this.stdout();
    return stdout ? this.parseStdout(stdout) : [];
  });

  /**
   * Parse stderr into informational vs error segments.
   */
  readonly parsedStderr = computed((): StderrSegment[] => {
    const stderr = this.stderr();
    return stderr ? this.parseStderrBuffer(stderr) : [];
  });

  /** Trigger for auto-scroll in the output component */
  readonly scrollTrigger = computed(() => {
    const a = this.agent();
    return (
      a.stdout.length +
      a.stderr.length +
      a.segments.length +
      a.streamEvents.length
    );
  });

  /** Stop a running agent via RPC */
  async stopAgent(event: Event): Promise<void> {
    event.stopPropagation();
    const agentId = this.agent().agentId;
    this.isStopping.set(true);
    try {
      await this.rpcService.call('agent:stop', { agentId });
    } finally {
      this.isStopping.set(false);
    }
  }

  /** Resume a completed/failed CLI agent session via RPC */
  async resumeAgent(event: Event): Promise<void> {
    event.stopPropagation();
    const agent = this.agent();
    if (!agent.cliSessionId) return;

    this.isResuming.set(true);
    try {
      await this.rpcService.call('agent:resumeCliSession', {
        cliSessionId: agent.cliSessionId,
        cli: agent.cli,
        task: agent.task,
        parentSessionId: agent.parentSessionId,
        ptahCliId: agent.ptahCliId,
        previousAgentId: agent.agentId,
      });
    } finally {
      this.isResuming.set(false);
    }
  }
}
