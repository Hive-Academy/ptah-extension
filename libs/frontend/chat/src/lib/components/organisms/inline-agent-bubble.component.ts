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
  DestroyRef,
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
        <!-- TASK_2025_099: Show summaryContent from real-time file watcher -->
        @if (hasSummaryContent()) {
        <div class="text-[11px] text-base-content/80 whitespace-pre-wrap py-2">
          {{ summaryContent() }}
          @if (isStreaming()) {
          <ptah-typing-cursor colorClass="text-base-content/60" />
          }
        </div>
        } @if (hasChildren()) {
        <!-- Render all children in chronological order (text + tools interleaved) -->
        @for (child of node().children; track child.id) {
        <ptah-execution-node
          [node]="child"
          [isStreaming]="isStreaming()"
          [getPermissionForTool]="getPermissionForTool()"
          (permissionResponded)="permissionResponded.emit($event)"
        />
        } @if (isStreaming() && !hasSummaryContent()) {
        <div
          class="flex items-center gap-1 text-[10px] text-base-content/40 mt-2"
        >
          <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin" />
          <span>Agent working</span>
          <ptah-typing-cursor colorClass="text-base-content/40" />
        </div>
        } } @else if (!hasSummaryContent()) {
        <!-- No children and no summary content yet -->
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
  private readonly destroyRef = inject(DestroyRef);

  /**
   * MutationObserver for auto-scroll behavior.
   * Watches DOM mutations to trigger scroll after recursive ExecutionNode tree completes.
   */
  private observer: MutationObserver | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly SCROLL_DEBOUNCE_MS = 50;

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
    // Setup observer after initial render
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector }
    );

    // Re-setup observer when component expands (container re-enters DOM)
    // The #contentContainer is conditionally rendered with @if (!isCollapsed())
    effect(() => {
      const collapsed = this.isCollapsed();
      if (!collapsed) {
        // Container is visible - setup/re-setup observer
        // Use afterNextRender to ensure DOM is ready
        afterNextRender(
          () => {
            this.setupMutationObserver();
          },
          { injector: this.injector }
        );
      }
    });

    // Cleanup on component destruction
    this.destroyRef.onDestroy(() => {
      this.cleanup();
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

  /**
   * Setup MutationObserver to watch for DOM changes in content container.
   * This ensures scroll happens after recursive ExecutionNode tree completes rendering.
   * Handles re-connection when component is expanded after being collapsed.
   */
  private setupMutationObserver(): void {
    const container = this.contentContainerRef()?.nativeElement;
    if (!container) return;

    // Disconnect existing observer if any (handles re-connection on expand)
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      this.scheduleScroll();
    });

    // Watch for any DOM changes in the container subtree
    this.observer.observe(container, {
      childList: true, // New nodes added/removed
      subtree: true, // Watch entire subtree (recursive components)
      characterData: true, // Text content changes (streaming text)
    });
  }

  /**
   * Schedule a scroll to bottom with debouncing.
   * Only scrolls when streaming and expanded.
   */
  private scheduleScroll(): void {
    const isStreaming = this.node().status === 'streaming';
    const isCollapsed = this.isCollapsed();

    // Only scroll when streaming and expanded
    if (!isStreaming || isCollapsed) return;

    // Clear previous debounce (trailing debounce pattern)
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    // Schedule scroll after debounce period
    this.scrollTimeoutId = setTimeout(() => {
      this.scrollAgentContentToBottom();
      this.scrollTimeoutId = null;
    }, this.SCROLL_DEBOUNCE_MS);
  }

  /**
   * Cleanup observer and timeout on component destruction.
   */
  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
  }

  // Computed: is agent streaming
  readonly isStreaming = computed(() => this.node().status === 'streaming');

  // Computed: was agent interrupted (TASK_2025_098)
  readonly isInterrupted = computed(() => this.node().status === 'interrupted');

  // Computed: agent color based on type
  // Built-in Claude agents get fixed oklch colors for theme consistency
  // Custom agents get dynamically generated colors based on name hash
  readonly agentColor = computed(() => {
    const agentType = this.node().agentType || '';

    // Built-in Claude Code agents with oklch colors for theme consistency
    // Using oklch ensures colors work well on both light and dark backgrounds
    const builtinColors: Record<string, string> = {
      Explore: 'oklch(0.6 0.18 145)', // Green
      Plan: 'oklch(0.55 0.2 300)', // Purple
      'general-purpose': 'oklch(0.55 0.2 265)', // Indigo
      'claude-code-guide': 'oklch(0.6 0.18 210)', // Sky blue
      'statusline-setup': 'oklch(0.55 0.05 250)', // Slate
    };

    if (builtinColors[agentType]) {
      return builtinColors[agentType];
    }

    // Generate consistent color for custom agents based on name hash
    return this.generateColorFromString(agentType);
  });

  /**
   * Generate a consistent oklch color from a string
   * Same string always produces the same color
   * TASK_2025_100 Batch 4: Updated default fallback to theme-aware oklch format
   * TASK_2025_100 QA Fix: Converted from HSL to oklch for theme consistency
   */
  private generateColorFromString(str: string): string {
    if (!str) return 'oklch(var(--bc) / 0.5)'; // Theme-aware gray for empty strings

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert hash to hue (0-360)
    const hue = Math.abs(hash % 360);

    // Use oklch for theme-aware generated colors
    // L=0.55 provides good contrast on both light and dark backgrounds
    // C=0.15 gives vibrant but not oversaturated colors
    return `oklch(0.55 0.15 ${hue})`;
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

  /**
   * Computed signal: whether agent has children (tool calls)
   * Using computed() ensures Angular tracks changes properly with OnPush
   */
  readonly hasChildren = computed(() => {
    return (this.node().children?.length ?? 0) > 0;
  });

  /**
   * TASK_2025_099: Computed signal for real-time summary content
   * Using computed() ensures Angular re-renders when summaryContent changes
   */
  readonly hasSummaryContent = computed(() => {
    const content = this.node().summaryContent;
    return !!content && content.length > 0;
  });

  /**
   * TASK_2025_099: Computed signal for the actual summary content
   * Direct signal binding for reactive updates
   */
  readonly summaryContent = computed(() => {
    return this.node().summaryContent || '';
  });

  protected toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }
}
