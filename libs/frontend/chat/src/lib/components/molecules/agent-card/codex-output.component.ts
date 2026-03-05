/**
 * CodexOutputComponent
 *
 * TASK_2025_177: Rewritten to use ExecutionNode tree rendering (matching
 * CopilotOutputComponent / GeminiOutputComponent pattern) instead of flat
 * segment rendering. Also adds a stats bar for token usage display.
 *
 * Features:
 * - ExecutionNode tree with collapsible tool cards
 * - Stats bar showing input/output token counts
 * - Auto-scrolls to bottom on new content
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
  extractCodexStats,
  isUsageSegment,
  formatTokens,
  type CliAgentStats,
} from './stats-bar.utils';

@Component({
  selector: 'ptah-codex-output',
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
export class CodexOutputComponent {
  /** Agent ID for per-agent cache isolation in the tree builder */
  readonly agentId = input.required<string>();

  /** Structured output segments from the Codex agent */
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

  /** Computed ExecutionNode tree from non-usage segments */
  readonly executionNodes = computed(() => {
    return this.treeBuilder.buildTreeFromSegments(
      this.agentId(),
      this.treeSegments()
    );
  });

  /**
   * Extract stats (tokens) from info-type segments.
   * Codex emits usage as: "Usage: N input, M output tokens"
   */
  readonly modelStats = computed((): CliAgentStats | null => {
    const infoSegments = this.segments().filter((s) => s.type === 'info');
    return extractCodexStats(infoSegments);
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
}
