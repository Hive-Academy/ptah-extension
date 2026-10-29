import {
  Component,
  input,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  AgentCardOutputComponent,
  formatAgentDuration,
  type RenderSegment,
  type StderrSegment,
} from '@ptah-extension/chat-ui';
import { LaneTranscriptComponent } from '../../organisms/transcript/lane-transcript.component';
import { LANE_COLUMN_CLASS } from '../execution-header/lane-column';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import {
  extractCliAgentStats,
  isUsageSegment,
  formatTokens,
} from './stats-bar.utils';

@Component({
  selector: 'ptah-cli-agent-output',
  standalone: true,
  imports: [LaneTranscriptComponent, AgentCardOutputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #outputContainer
      class="border-t border-base-content/5 h-full overflow-y-auto"
      [class.!border-0]="presentation() === 'flat'"
    >
      <!-- Stats bar (only shown when stats are available) -->
      @if (presentation() === 'card' && modelStats(); as stats) {
        <div
          class="flex items-center gap-3 px-2 py-1 bg-base-200/50 border-b border-base-content/5"
        >
          @if (stats.model) {
            <span class="text-[9px] font-mono text-base-content-muted">
              {{ stats.model }}
            </span>
          }
          @if (stats.inputTokens !== undefined) {
            <span class="text-[9px] font-mono text-info/70">
              &#8593; {{ fmtTokens(stats.inputTokens) }}
            </span>
          }
          @if (stats.outputTokens !== undefined) {
            <span class="text-[9px] font-mono text-accent/70">
              &#8595; {{ fmtTokens(stats.outputTokens) }}
            </span>
          }
          @if (stats.totalTokens !== undefined) {
            <span class="text-[9px] font-mono text-info/70">
              Reported total: {{ fmtTokens(stats.totalTokens) }} tokens
            </span>
          }
          @if (stats.costUsd !== undefined) {
            <span class="text-[9px] font-mono text-warning/70">
              {{ '$' + stats.costUsd.toFixed(4) }}
            </span>
          }
          @if (
            stats.durationMs !== undefined && fmtDuration(stats.durationMs)
          ) {
            <span class="text-[9px] font-mono text-base-content-muted ml-auto">
              {{ fmtDuration(stats.durationMs) }}
            </span>
          }
        </div>
      }

      <!-- Raw stdout duplicates the structured tree, so it shows only for a
           lane that has nothing structured to show. -->
      @if (showStdoutFallback()) {
        <div [class]="rowClass()">
          <ptah-agent-card-output
            [segments]="stdoutSegments()"
            [stderrSegments]="[]"
            [embedded]="true"
          />
        </div>
      }

      <!-- ExecutionNode tree rendering -->
      <ptah-lane-transcript
        [laneId]="agentId()"
        [nodes]="executionNodes()"
        [events]="streamEvents()"
        [isStreaming]="isStreaming()"
      />
      <div [class]="rowClass()">
        @for (seg of stderrSegments(); track $index) {
          @if (seg.type === 'error') {
            <div
              class="bg-error/10 rounded px-2 py-1 border border-error/20 mt-1"
            >
              <pre
                class="text-[10px] font-mono text-error whitespace-pre-wrap break-words m-0 leading-relaxed"
                >{{ seg.content }}</pre>
            </div>
          } @else {
            <div
              class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5 mt-1"
            >
              <pre
                class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                >{{ seg.content }}</pre>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class CliAgentOutputComponent {
  /** Agent ID for per-agent cache isolation in the tree builder */
  readonly agentId = input.required<string>();
  readonly presentation = input<'card' | 'flat'>('card');
  /** A flat lane puts its rows in the main chat column, like the transcript. */
  protected readonly rowClass = computed(() =>
    this.presentation() === 'flat' ? LANE_COLUMN_CLASS : '',
  );

  readonly segments = input<CliOutputSegment[]>([]);
  readonly stdoutSegments = input<RenderSegment[]>([]);
  readonly stderrSegments = input<StderrSegment[]>([]);
  readonly streamEvents = input<FlatStreamEventUnion[]>([]);
  readonly streamRevision = input<number>(0);

  /** Whether the agent is still running (passed through to ExecutionNodeComponent) */
  readonly isStreaming = input<boolean>(false);

  /** Triggers auto-scroll when value changes (incremented externally) */
  readonly scrollTrigger = input<number>(0);

  private readonly treeBuilder = inject(AgentMonitorTreeBuilderService);

  /** Segments with usage info filtered out (usage is shown in stats bar, not tree) */
  private readonly treeSegments = computed(() =>
    this.segments().filter((s) => !isUsageSegment(s)),
  );

  /** Computed ExecutionNode tree from non-usage segments.
   *  When agent is done, finalize orphaned tools (interrupted before completion). */
  readonly executionNodes = computed(() => {
    // The store appends events in place; the revision invalidates this computed.
    this.streamRevision();
    const events = this.streamEvents();
    const hasTextDeltas = events.some((event) => event.eventType === 'text_delta');
    const tree = events.length > 0
      ? [
          ...this.treeBuilder.buildTree(this.agentId(), events),
          // The CLI emits peer turns and terminal/crash errors as segments only.
          // Keep them beside the event tree without repeating ordinary stdout.
          // Without text deltas, the assistant text also exists only as segments.
          ...this.treeBuilder.buildTreeFromSegments(
            this.agentId(),
            this.treeSegments().filter(
              (segment) =>
                segment.type === 'error' ||
                (!hasTextDeltas && segment.type === 'text') ||
                (segment.type === 'info' &&
                  segment.content.startsWith('Message from unverified peer')),
            ),
          ),
        ]
      : this.treeBuilder.buildTreeFromSegments(
          this.agentId(),
          this.treeSegments(),
        );
    if (!this.isStreaming()) {
      return this.treeBuilder.finalizeOrphanedTools(tree);
    }
    return tree;
  });

  readonly modelStats = computed(() => extractCliAgentStats(this.segments()));

  /** Stdout is the output only for a lane that emits no structured content. */
  protected readonly showStdoutFallback = computed(
    () =>
      this.stdoutSegments().length > 0 && this.executionNodes().length === 0,
  );

  /** Auto-scroll container reference */
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  constructor() {
    effect(() => {
      this.executionNodes();
      this.stdoutSegments();
      this.scrollTrigger();
      const el = this.outputContainer()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }

  /** Format token count for template use */
  fmtTokens(count: number): string {
    return formatTokens(count);
  }

  /** Format duration for template use */
  fmtDuration(ms: number): string {
    return formatAgentDuration(ms) ?? '';
  }
}
