/**
 * PtahCliOutputComponent
 *
 * Renders Ptah CLI agent output using the rich ExecutionNode pipeline.
 * Injects AgentMonitorTreeBuilderService to convert flat FlatStreamEventUnion[]
 * into an ExecutionNode tree, then renders each root node with ExecutionNodeComponent.
 *
 * This gives Ptah CLI agents the same rich rendering as the main chat:
 * - Collapsible tool cards with headers and icons
 * - Structured tool input/output display
 * - Recursive agent-within-agent nesting
 * - Thinking block rendering
 * - Markdown text rendering
 *
 * Auto-scrolls to bottom on new content using the same pattern as AgentCardOutputComponent.
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
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { ExecutionNodeComponent } from '../../organisms/execution/execution-node.component';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';

@Component({
  selector: 'ptah-ptah-cli-output',
  standalone: true,
  imports: [ExecutionNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #outputContainer
      class="border-t border-base-content/5 h-full overflow-y-auto"
    >
      <div class="p-2 space-y-1">
        @for (node of executionNodes(); track node.id) {
        <ptah-execution-node [node]="node" [isStreaming]="isStreaming()" />
        }
      </div>
    </div>
  `,
})
export class PtahCliOutputComponent {
  /** Agent ID for per-agent cache isolation in the tree builder */
  readonly agentId = input.required<string>();

  /** Flat streaming events from MonitoredAgent.streamEvents */
  readonly streamEvents = input.required<FlatStreamEventUnion[]>();

  /** Whether the agent is still running (passed through to ExecutionNodeComponent) */
  readonly isStreaming = input<boolean>(false);

  /** Triggers auto-scroll when value changes (incremented externally) */
  readonly scrollTrigger = input<number>(0);

  private readonly treeBuilder = inject(AgentMonitorTreeBuilderService);

  /** Computed ExecutionNode tree from flat events (memoized by treeBuilder).
   *  When the agent is no longer streaming, finalize any orphaned tools
   *  (tools that never received a result before the session ended). */
  readonly executionNodes = computed(() => {
    const tree = this.treeBuilder.buildTree(
      this.agentId(),
      this.streamEvents()
    );
    // When agent is done, mark orphaned streaming tools as interrupted
    if (!this.isStreaming()) {
      return this.treeBuilder.finalizeOrphanedTools(tree);
    }
    return tree;
  });

  /** Auto-scroll container reference */
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  constructor() {
    // Auto-scroll effect: scrolls to bottom when new content arrives.
    // Same pattern as AgentCardOutputComponent.
    effect(() => {
      // Read signals to track changes and trigger re-evaluation
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
}
