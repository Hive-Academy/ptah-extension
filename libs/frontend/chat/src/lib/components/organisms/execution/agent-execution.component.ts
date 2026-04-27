import {
  Component,
  input,
  output,
  signal,
  computed,
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
import {
  AgentSummaryComponent,
  TypingCursorComponent,
} from '@ptah-extension/chat-ui';
import { ExecutionNodeComponent } from './execution-node.component';
import { AutoAnimateDirective } from '../../../directives/auto-animate.directive';
import type {
  ExecutionNode,
  AgentInfo,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

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
  imports: [
    LucideAngularModule,
    AgentSummaryComponent,
    ExecutionNodeComponent,
    TypingCursorComponent,
    AutoAnimateDirective,
  ],
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
              class="w-3.5 h-3.5 text-secondary"
            />
            <span class="text-[11px] font-medium text-base-content/70">
              Summary
              @if (isStreaming() && !agentInfo().summaryContent) {
                <lucide-angular
                  [img]="LoaderIcon"
                  class="w-3 h-3 animate-spin ml-1 inline-block"
                />
              }
            </span>
          </button>

          <!-- Summary Content (grid-rows collapse for smooth height anim) -->
          <div
            class="ae-collapse-wrapper"
            [class.ae-collapsed]="summaryCollapsed()"
          >
            <div class="ae-collapse-inner">
              <div class="px-2.5 py-2 max-h-64 overflow-y-auto">
                @if (agentInfo().summaryContent) {
                  <div animate.enter="ae-fade-in">
                    <ptah-agent-summary
                      [content]="agentInfo().summaryContent!"
                    />
                    @if (isStreaming()) {
                      <ptah-typing-cursor colorClass="text-base-content/50" />
                    }
                  </div>
                } @else {
                  <div
                    class="flex items-center gap-2 text-[11px] text-base-content/40 italic"
                    animate.enter="ae-fade-in"
                  >
                    <lucide-angular
                      [img]="LoaderIcon"
                      class="w-3 h-3 animate-spin"
                    />
                    <span>Loading summary...</span>
                  </div>
                }
              </div>
            </div>
          </div>
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
            <lucide-angular [img]="WrenchIcon" class="w-3.5 h-3.5 text-info" />
            <span class="text-[11px] font-medium text-base-content/70">
              Execution
              @if (isStreaming()) {
                <span class="text-base-content/40 ml-1"
                  >({{ toolCount() }} tools running...)</span
                >
              } @else if (toolCount() > 0) {
                <span class="text-base-content/40 ml-1"
                  >({{ toolCount() }} tools)</span
                >
              }
            </span>
            @if (
              !hasExecutionNodes() && agentInfo().hasExecution && isStreaming()
            ) {
              <lucide-angular
                [img]="LoaderIcon"
                class="w-3 h-3 text-base-content/40 animate-spin ml-auto"
              />
            }
          </button>

          <!-- Execution Content (grid-rows collapse for smooth height anim) -->
          <div
            class="ae-collapse-wrapper"
            [class.ae-collapsed]="executionCollapsed()"
          >
            <div class="ae-collapse-inner">
              <div class="px-2.5 py-2 max-h-96 overflow-y-auto" [auto-animate]>
                @if (hasExecutionNodes()) {
                  @for (
                    child of executionTree()?.children || [];
                    track child.id
                  ) {
                    <ptah-execution-node
                      [node]="child"
                      [isStreaming]="isStreaming()"
                      [getPermissionForTool]="getPermissionForTool()"
                      (permissionResponded)="permissionResponded.emit($event)"
                    />
                  }
                } @else {
                  <div
                    class="flex items-center gap-2 text-[11px] text-base-content/40 italic"
                    animate.enter="ae-fade-in"
                  >
                    <lucide-angular
                      [img]="LoaderIcon"
                      class="w-3 h-3 animate-spin"
                    />
                    <span>Loading execution details...</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Empty State (no summary or execution) -->
      @if (
        !agentInfo().hasSummary &&
        !agentInfo().summaryContent &&
        !agentInfo().hasExecution &&
        !hasExecutionNodes()
      ) {
        @if (agentInfo().isInterrupted) {
          <!-- Interrupted state (loaded from history with no data) -->
          <div
            class="flex items-center gap-2 text-[11px] text-warning/70 px-2 py-3"
          >
            <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5" />
            <span>Agent execution was interrupted</span>
          </div>
        } @else if (isStreaming()) {
          <!-- Streaming but no content yet -->
          <div
            class="flex items-center gap-2 text-[11px] text-base-content/40 italic px-2 py-3"
          >
            <lucide-angular
              [img]="LoaderIcon"
              class="w-3.5 h-3.5 animate-spin"
            />
            <span>Agent execution in progress...</span>
          </div>
        } @else {
          <!-- Completed with no content (unusual) -->
          <div
            class="flex items-center gap-2 text-[11px] text-base-content/40 italic px-2 py-3"
          >
            <span>No execution data available</span>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Grid-rows collapse pattern: animates height without JS measurement.
         Same pattern as message-bubble + inline-agent-bubble. */
      .ae-collapse-wrapper {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows 220ms ease-out;
      }
      .ae-collapse-wrapper.ae-collapsed {
        grid-template-rows: 0fr;
      }
      .ae-collapse-inner {
        min-height: 0;
        overflow: hidden;
      }

      @keyframes aeFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      :host ::ng-deep .ae-fade-in {
        animation: aeFadeIn 160ms ease-out both;
      }

      @media (prefers-reduced-motion: reduce) {
        .ae-collapse-wrapper {
          transition: none !important;
        }
        :host ::ng-deep .ae-fade-in {
          animation: none !important;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentExecutionComponent {
  readonly agentInfo = input.required<AgentInfo>();
  readonly executionTree = input.required<ExecutionNode | null>();

  /**
   * Permission lookup function forwarded from parent.
   * Optional — when not bound, child tool cards render without permission
   * affordances (same fallback path as inline-agent-bubble). Mirrors the
   * shape declared on `InlineAgentBubbleComponent` and `ExecutionNodeComponent`
   * so this wrapper is a transparent forwarder for the permission flow.
   */
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();

  /**
   * Emits when user responds to a permission request bubbling up from a
   * nested tool-call node. Parents that don't bind this output simply drop
   * the event, but tools rendered through this path will no longer silently
   * lose the permission flow when forwarding IS wired up.
   */
  readonly permissionResponded = output<PermissionResponse>();

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

  // Computed signals for streaming state
  readonly isStreaming = computed(() => this.agentInfo().isStreaming === true);

  readonly toolCount = computed(() => {
    const tree = this.executionTree();
    return tree?.children?.filter((c) => c.type === 'tool').length ?? 0;
  });

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
