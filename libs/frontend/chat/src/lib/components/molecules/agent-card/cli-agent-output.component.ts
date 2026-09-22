import {
  Component,
  input,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  model,
  viewChild,
} from '@angular/core';
import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  AgentCardOutputComponent,
  type RenderSegment,
  type StderrSegment,
} from '@ptah-extension/chat-ui';
import { ExecutionNodeComponent } from '../../organisms/execution/execution-node.component';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import {
  extractCliAgentStats,
  isUsageSegment,
  formatTokens,
  formatDuration,
} from './stats-bar.utils';

@Component({
  selector: 'ptah-cli-agent-output',
  standalone: true,
  imports: [ExecutionNodeComponent, AgentCardOutputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #outputContainer
      class="border-t border-base-content/5 h-full overflow-y-auto"
    >
      <!-- Stats bar (only shown when stats are available) -->
      @if (modelStats(); as stats) {
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
          @if (stats.durationMs !== undefined) {
            <span class="text-[9px] font-mono text-base-content-muted ml-auto">
              {{ fmtDuration(stats.durationMs) }}
            </span>
          }
        </div>
      }

      <!-- Raw stdout stays reachable but collapsed: adapters emit it alongside
           the structured segments, so leaving it open would duplicate the tree
           in the flat style this component exists to replace. -->
      @if (stdoutSegments().length > 0) {
        <details
          class="mx-2 mt-1 bg-base-200/30 rounded border border-base-content/5 overflow-hidden"
          [open]="rawStdoutOpen()"
          (toggle)="onRawStdoutToggle($event)"
        >
          <summary
            class="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none hover:bg-base-200/50 transition-colors"
          >
            <span class="text-[10px] font-medium text-base-content-muted"
              >Raw stdout</span
            >
          </summary>
          <ptah-agent-card-output
            [segments]="stdoutSegments()"
            [stderrSegments]="[]"
            [embedded]="true"
          />
        </details>
      }

      <!-- ExecutionNode tree rendering -->
      <div class="p-2 space-y-1">
        @for (node of executionNodes(); track node.id) {
          <ptah-execution-node [node]="node" [isStreaming]="isStreaming()" />
        }
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
    const tree =
      events.length > 0
        ? this.treeBuilder.buildTree(this.agentId(), events)
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

  /** Whether the raw stdout disclosure is open. Starts open so a lane that has
   *  only stdout shows its output instead of an empty-looking card. Owned by
   *  the card, which outlives this component's remount on card collapse. */
  readonly rawStdoutOpen = model(true);

  /** Latches once the auto-collapse has fired, so it never overrides a later
   *  manual toggle. Lifted alongside `rawStdoutOpen` — a latch that reset on
   *  remount would re-collapse a disclosure the user had opened. */
  readonly rawStdoutAutoCollapsed = model(false);

  /** Auto-scroll container reference */
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  constructor() {
    // Collapse the raw transcript exactly once, as the first structured content
    // arrives — that is the moment it would start duplicating the tree.
    effect(() => {
      const hasRichContent =
        this.executionNodes().length > 0 || this.stderrSegments().length > 0;
      if (hasRichContent && !this.rawStdoutAutoCollapsed()) {
        this.rawStdoutAutoCollapsed.set(true);
        this.rawStdoutOpen.set(false);
      }
    });

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

  /** Keep the signal and the DOM in step so a manual toggle survives the next
   *  change-detection pass, which would otherwise reapply `[open]`. */
  onRawStdoutToggle(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLDetailsElement) {
      this.rawStdoutOpen.set(target.open);
    }
  }

  /** Format token count for template use */
  fmtTokens(count: number): string {
    return formatTokens(count);
  }

  /** Format duration for template use */
  fmtDuration(ms: number): string {
    return formatDuration(ms);
  }
}
