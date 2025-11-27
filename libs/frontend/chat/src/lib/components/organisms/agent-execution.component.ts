import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  FileText,
  Wrench,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-angular';
import { AgentSummaryComponent } from '../molecules/agent-summary.component';
import { ExecutionNodeComponent } from './execution-node.component';
import type { ExecutionNode, AgentInfo } from '@ptah-extension/shared';

/**
 * AgentExecutionComponent - Dual-section agent bubble with Summary + Execution
 *
 * Complexity Level: 3 (Complex organism with sections)
 * Patterns: Collapsible sections, Streaming-safe rendering
 *
 * This component displays agent execution in two distinct sections:
 *
 * 1. **Summary Section** (top):
 *    - Real-time progress updates from Claude CLI
 *    - XML-like format with <function_calls>, <thinking> tags
 *    - Parsed and displayed by AgentSummaryComponent
 *
 * 2. **Execution Section** (bottom):
 *    - Actual tool calls (Read, Write, Bash, etc.)
 *    - Detailed execution trace with inputs/outputs
 *    - Rendered by ExecutionNodeComponent
 *
 * Streaming Safety:
 * - Either section may be missing during streaming
 * - Shows appropriate loading/empty states
 * - Gracefully handles partial data
 */
@Component({
  selector: 'ptah-agent-execution',
  standalone: true,
  imports: [LucideAngularModule, AgentSummaryComponent, ExecutionNodeComponent],
  template: `
    <div class="flex flex-col gap-2">
      <!-- Summary Section -->
      @if (agentInfo().hasSummary || agentInfo().summaryContent) {
      <div class="border border-base-300/50 rounded-lg overflow-hidden">
        <!-- Summary Header (collapsible) -->
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 bg-base-300/30 hover:bg-base-300/50 transition-colors text-left"
          (click)="toggleSummary()"
          [attr.aria-expanded]="!summaryCollapsed()"
        >
          <lucide-angular
            [img]="summaryCollapsed() ? ChevronRightIcon : ChevronDownIcon"
            class="w-3.5 h-3.5 text-base-content/50"
          />
          <lucide-angular
            [img]="FileTextIcon"
            class="w-3.5 h-3.5 text-purple-400"
          />
          <span class="text-[11px] font-medium text-base-content/70"
            >Summary</span
          >
          @if (!agentInfo().summaryContent && agentInfo().hasSummary) {
          <lucide-angular
            [img]="LoaderIcon"
            class="w-3 h-3 text-base-content/40 animate-spin ml-auto"
          />
          }
        </button>

        <!-- Summary Content -->
        @if (!summaryCollapsed()) {
        <div class="px-2.5 py-2 max-h-64 overflow-y-auto">
          @if (agentInfo().summaryContent) {
          <ptah-agent-summary [content]="agentInfo().summaryContent!" />
          } @else {
          <div
            class="flex items-center gap-2 text-[11px] text-base-content/40 italic"
          >
            <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
            <span>Loading summary...</span>
          </div>
          }
        </div>
        }
      </div>
      }

      <!-- Execution Section -->
      @if (agentInfo().hasExecution || hasExecutionNodes()) {
      <div class="border border-base-300/50 rounded-lg overflow-hidden">
        <!-- Execution Header (collapsible) -->
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 bg-base-300/30 hover:bg-base-300/50 transition-colors text-left"
          (click)="toggleExecution()"
          [attr.aria-expanded]="!executionCollapsed()"
        >
          <lucide-angular
            [img]="executionCollapsed() ? ChevronRightIcon : ChevronDownIcon"
            class="w-3.5 h-3.5 text-base-content/50"
          />
          <lucide-angular
            [img]="WrenchIcon"
            class="w-3.5 h-3.5 text-blue-400"
          />
          <span class="text-[11px] font-medium text-base-content/70">
            Execution @if (executionTree()?.children?.length) {
            <span class="text-base-content/40 ml-1"
              >({{ executionTree()?.children?.length }} tools)</span
            >
            }
          </span>
          @if (!hasExecutionNodes() && agentInfo().hasExecution) {
          <lucide-angular
            [img]="LoaderIcon"
            class="w-3 h-3 text-base-content/40 animate-spin ml-auto"
          />
          }
        </button>

        <!-- Execution Content -->
        @if (!executionCollapsed()) {
        <div class="px-2.5 py-2 max-h-96 overflow-y-auto">
          @if (hasExecutionNodes()) { @for (child of executionTree()?.children
          || []; track child.id) {
          <ptah-execution-node [node]="child" />
          } } @else {
          <div
            class="flex items-center gap-2 text-[11px] text-base-content/40 italic"
          >
            <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
            <span>Loading execution details...</span>
          </div>
          }
        </div>
        }
      </div>
      }

      <!-- Empty State (no summary or execution) -->
      @if (!agentInfo().hasSummary && !agentInfo().summaryContent &&
      !agentInfo().hasExecution && !hasExecutionNodes()) { @if
      (agentInfo().isInterrupted) {
      <!-- Interrupted state (loaded from history with no data) -->
      <div
        class="flex items-center gap-2 text-[11px] text-warning/70 px-2 py-3"
      >
        <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5" />
        <span>Agent execution was interrupted</span>
      </div>
      } @else {
      <!-- In-progress state (live streaming) -->
      <div
        class="flex items-center gap-2 text-[11px] text-base-content/40 italic px-2 py-3"
      >
        <lucide-angular [img]="LoaderIcon" class="w-3.5 h-3.5 animate-spin" />
        <span>Agent execution in progress...</span>
      </div>
      } }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentExecutionComponent {
  readonly agentInfo = input.required<AgentInfo>();
  readonly executionTree = input.required<ExecutionNode | null>();

  // Icons
  readonly FileTextIcon = FileText;
  readonly WrenchIcon = Wrench;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly LoaderIcon = Loader2;
  readonly AlertCircleIcon = AlertCircle;

  // Section collapse state
  readonly summaryCollapsed = signal(false);
  readonly executionCollapsed = signal(false);

  protected toggleSummary(): void {
    this.summaryCollapsed.update((v) => !v);
  }

  protected toggleExecution(): void {
    this.executionCollapsed.update((v) => !v);
  }

  protected hasExecutionNodes(): boolean {
    const tree = this.executionTree();
    return !!(tree?.children && tree.children.length > 0);
  }
}
