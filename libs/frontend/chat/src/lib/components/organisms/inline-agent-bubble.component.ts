import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
  afterNextRender,
  inject,
  Injector,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  ChevronRight,
  Loader2,
  StopCircle,
} from 'lucide-angular';
import { ExecutionNodeComponent } from './execution-node.component';
import { TypingCursorComponent } from '../atoms/typing-cursor.component';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

/**
 * InlineAgentBubbleComponent - Unified agent rendering for both streaming and replay
 *
 * This component renders an agent as an inline bubble within the main Claude response:
 * - Colored avatar with agent initial
 * - Agent type header with streaming badge
 * - Collapsible content with INTERLEAVED timeline (text + tools in order)
 * - No separate Summary/Execution sections - unified chronological view
 *
 * The children array contains both text nodes (agent's thoughts/explanations)
 * and tool nodes (actual tool calls) in chronological order, creating a natural
 * flow that matches how agents actually execute.
 *
 * Used by ExecutionNodeComponent when rendering 'agent' type nodes.
 */
@Component({
  selector: 'ptah-inline-agent-bubble',
  imports: [LucideAngularModule, ExecutionNodeComponent, TypingCursorComponent],
  template: `
    <div
      class="my-3 border-l-2 rounded-lg bg-base-200/50 overflow-hidden"
      [style.border-left-color]="agentColor()"
    >
      <!-- Agent Header (clickable to toggle) -->
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-300/30 transition-colors text-left"
        (click)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
      >
        <!-- Expand/Collapse chevron -->
        <lucide-angular
          [img]="isCollapsed() ? ChevronRightIcon : ChevronDownIcon"
          class="w-3.5 h-3.5 text-base-content/50 flex-shrink-0"
        />

        <!-- Colored avatar -->
        <div
          class="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          [style.background-color]="agentColor()"
        >
          <span class="text-white text-[10px] font-bold">
            {{ agentInitial() }}
          </span>
        </div>

        <!-- Agent type + description -->
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <span class="text-[11px] font-semibold text-base-content/80">
            {{ node().agentType }}
          </span>
          @if (node().agentDescription) {
          <span
            class="text-[10px] text-base-content/50 truncate"
            [title]="node().agentDescription"
          >
            {{ node().agentDescription }}
          </span>
          }
        </div>

        <!-- Streaming/Interrupted badge or stats -->
        @if (isStreaming()) {
        <span class="badge badge-xs badge-info gap-1 flex-shrink-0">
          <lucide-angular [img]="LoaderIcon" class="w-2.5 h-2.5 animate-spin" />
          <span class="text-[9px]">Streaming</span>
        </span>
        } @else if (isInterrupted()) {
        <span class="badge badge-xs badge-warning gap-1 flex-shrink-0">
          <lucide-angular [img]="StopCircleIcon" class="w-2.5 h-2.5" />
          <span class="text-[9px]">Stopped</span>
        </span>
        } @else if (hasChildren()) {
        <span class="badge badge-xs badge-ghost text-[9px] flex-shrink-0">
          {{ childStats() }}
        </span>
        }
      </button>

      <!-- Collapsible Content: INTERLEAVED TIMELINE (text + tools in order) -->
      @if (!isCollapsed()) {
      <div
        #contentContainer
        class="px-3 pb-2 max-h-80 overflow-y-auto border-t border-base-300/30"
      >
        @if (hasChildren()) {
        <!-- Render all children in chronological order (text + tools interleaved) -->
        @for (child of node().children; track child.id) {
        <ptah-execution-node
          [node]="child"
          [isStreaming]="isStreaming()"
          [getPermissionForTool]="getPermissionForTool()"
          (permissionResponded)="permissionResponded.emit($event)"
        />
        } @if (isStreaming()) {
        <div
          class="flex items-center gap-1 text-[10px] text-base-content/40 mt-2"
        >
          <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
          <span>Agent working</span>
          <ptah-typing-cursor colorClass="text-base-content/40" />
        </div>
        } } @else {
        <!-- No children yet -->
        @if (isStreaming()) {
        <div
          class="flex items-center gap-2 text-[10px] text-base-content/40 py-2"
        >
          <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
          <span>Starting agent execution</span>
          <ptah-typing-cursor colorClass="text-base-content/40" />
        </div>
        } @else {
        <div class="text-[10px] text-base-content/40 py-2">
          No execution data
        </div>
        } }
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InlineAgentBubbleComponent {
  private readonly injector = inject(Injector);

  readonly node = input.required<ExecutionNode>();

  /**
   * Permission lookup function forwarded from parent
   */
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();

  /**
   * Emits when user responds to permission request
   * Bubbles up from nested execution nodes
   */
  readonly permissionResponded = output<PermissionResponse>();

  /**
   * TASK_2025_096 FIX: ViewChild reference for auto-scroll container.
   * Uses signal-based viewChild (Angular 20+ pattern).
   */
  private readonly contentContainerRef =
    viewChild<ElementRef<HTMLElement>>('contentContainer');

  // Icons
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly LoaderIcon = Loader2;
  readonly StopCircleIcon = StopCircle;

  // Collapse state - expanded by default
  readonly isCollapsed = signal(false);

  constructor() {
    // TASK_2025_096 FIX: Auto-scroll agent content when new children arrive
    effect(() => {
      const children = this.node().children;
      const isStreaming = this.node().status === 'streaming';
      const collapsed = this.isCollapsed();

      // Only scroll when streaming, expanded, and has children
      if (isStreaming && !collapsed && children && children.length > 0) {
        // Use afterNextRender instead of setTimeout for proper lifecycle handling
        // This ensures DOM is ready and provides automatic cleanup
        afterNextRender(
          () => {
            this.scrollAgentContentToBottom();
          },
          { injector: this.injector }
        );
      }
    });
  }

  /**
   * TASK_2025_096 FIX: Scroll agent content container to bottom
   */
  private scrollAgentContentToBottom(): void {
    const containerRef = this.contentContainerRef();
    if (!containerRef) return;

    const container = containerRef.nativeElement;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }

  // Computed: is agent streaming
  readonly isStreaming = computed(() => this.node().status === 'streaming');

  // Computed: was agent interrupted (TASK_2025_098)
  readonly isInterrupted = computed(() => this.node().status === 'interrupted');

  // Computed: agent color based on type
  // Built-in Claude agents get fixed colors for brand consistency
  // Custom agents get dynamically generated colors based on name hash
  readonly agentColor = computed(() => {
    const agentType = this.node().agentType || '';

    // Built-in Claude Code agents with fixed brand colors
    const builtinColors: Record<string, string> = {
      Explore: '#22c55e',
      Plan: '#a855f7',
      'general-purpose': '#6366f1',
      'claude-code-guide': '#0ea5e9',
      'statusline-setup': '#64748b',
    };

    if (builtinColors[agentType]) {
      return builtinColors[agentType];
    }

    // Generate consistent color for custom agents based on name hash
    return this.generateColorFromString(agentType);
  });

  /**
   * Generate a consistent HSL color from a string
   * Same string always produces the same color
   */
  private generateColorFromString(str: string): string {
    if (!str) return '#717171'; // Default gray for empty strings

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert hash to hue (0-360)
    const hue = Math.abs(hash % 360);

    // Use consistent saturation and lightness for readable colors
    return `hsl(${hue}, 65%, 45%)`;
  }

  // Computed: agent initial letter
  readonly agentInitial = computed(() => {
    const agentType = this.node().agentType || '';
    return agentType.charAt(0).toUpperCase();
  });

  // Computed: child statistics for badge display
  readonly childStats = computed(() => {
    const children = this.node().children ?? [];
    const toolCount = children.filter((c) => c.type === 'tool').length;
    const textCount = children.filter((c) => c.type === 'text').length;

    if (toolCount > 0 && textCount > 0) {
      return `${toolCount} tools`;
    } else if (toolCount > 0) {
      return `${toolCount} tools`;
    } else if (textCount > 0) {
      return `${textCount} items`;
    }
    return '';
  });

  protected hasChildren(): boolean {
    return (this.node().children?.length ?? 0) > 0;
  }

  protected toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }
}
