/**
 * CopilotOutputComponent
 *
 * Renders Copilot CLI agent output using the rich ExecutionNode pipeline.
 * Injects AgentMonitorTreeBuilderService to convert flat CliOutputSegment[]
 * into an ExecutionNode tree, then renders each root node with ExecutionNodeComponent.
 *
 * TASK_2025_177: Added stats bar for token usage, model, cost, and duration display.
 * Usage segments are filtered out of the tree so they only appear in the stats bar.
 *
 * This gives Copilot agents the same rich rendering as Ptah CLI:
 * - Stats bar showing model, token counts, cost, and duration
 * - Collapsible tool cards with headers and icons
 * - Structured tool input/output display
 * - Thinking block rendering
 * - Markdown text rendering
 *
 * Auto-scrolls to bottom on new content using the same pattern as PtahCliOutputComponent.
 */

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
import type { CliOutputSegment } from '@ptah-extension/shared';
import { ExecutionNodeComponent } from '../../organisms/execution/execution-node.component';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import {
  extractCopilotStats,
  isUsageSegment,
  formatTokens,
  formatDuration,
  type CliAgentStats,
} from './stats-bar.utils';

@Component({
  selector: 'ptah-copilot-output',
  standalone: true,
  imports: [ExecutionNodeComponent],
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
        <span class="text-[9px] font-mono text-base-content/50">
          {{ stats.model }}
        </span>
        } @if (stats.inputTokens !== undefined) {
        <span class="text-[9px] font-mono text-info/70">
          &#8593; {{ fmtTokens(stats.inputTokens) }}
        </span>
        } @if (stats.outputTokens !== undefined) {
        <span class="text-[9px] font-mono text-accent/70">
          &#8595; {{ fmtTokens(stats.outputTokens) }}
        </span>
        } @if (stats.cost) {
        <span class="text-[9px] font-mono text-warning/70">
          {{ stats.cost }}
        </span>
        } @if (stats.durationMs !== undefined) {
        <span class="text-[9px] font-mono text-base-content/40 ml-auto">
          {{ fmtDuration(stats.durationMs) }}
        </span>
        }
      </div>
      }

      <!-- ExecutionNode tree rendering -->
      <div class="p-2 space-y-1">
        @for (node of executionNodes(); track node.id) {
        <ptah-execution-node [node]="node" [isStreaming]="isStreaming()" />
        }
      </div>
    </div>
  `,
})
export class CopilotOutputComponent {
  /** Agent ID for per-agent cache isolation in the tree builder */
  readonly agentId = input.required<string>();

  /** Structured output segments from the Copilot agent */
  readonly segments = input.required<CliOutputSegment[]>();

  /** Whether the agent is still running (passed through to ExecutionNodeComponent) */
  readonly isStreaming = input<boolean>(false);

  /** Triggers auto-scroll when value changes (incremented externally) */
  readonly scrollTrigger = input<number>(0);

  private readonly treeBuilder = inject(AgentMonitorTreeBuilderService);

  /** Segments with usage info filtered out (usage is shown in stats bar, not tree) */
  private readonly treeSegments = computed(() =>
    this.segments().filter((s) => !isUsageSegment(s))
  );

  /** Computed ExecutionNode tree from non-usage segments.
   *  When agent is done, finalize orphaned tools (interrupted before completion). */
  readonly executionNodes = computed(() => {
    const tree = this.treeBuilder.buildTreeFromSegments(
      this.agentId(),
      this.treeSegments()
    );
    if (!this.isStreaming()) {
      return this.treeBuilder.finalizeOrphanedTools(tree);
    }
    return tree;
  });

  /**
   * Extract stats (model, tokens, cost, duration) from info-type segments.
   * Copilot emits usage as: "Usage: model: gpt-5.3-codex, 80903 input, 4645 output, $1.0000, 64.6s"
   */
  readonly modelStats = computed((): CliAgentStats | null => {
    const infoSegments = this.segments().filter((s) => s.type === 'info');
    return extractCopilotStats(infoSegments);
  });

  /** Auto-scroll container reference */
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  constructor() {
    // Auto-scroll effect: scrolls to bottom when new content arrives.
    effect(() => {
      this.executionNodes();
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
    return formatDuration(ms);
  }
}
