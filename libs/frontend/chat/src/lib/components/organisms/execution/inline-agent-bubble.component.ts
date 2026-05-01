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
  TemplateRef,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  ChevronRight,
  Loader2,
  StopCircle,
  // TASK_2025_109: PlayCircle removed - Resume button no longer needed
} from 'lucide-angular';
// TASK_2026_103 wave B2: ExecutionNodeComponent import removed to break the
// execution-node ↔ inline-agent-bubble file-import cycle. Recursive rendering
// of children is now delegated to a TemplateRef supplied by the parent
// (ExecutionNodeComponent) via `nodeTemplate` input + ngTemplateOutlet.
import {
  TypingCursorComponent,
  CostBadgeComponent,
  TokenBadgeComponent,
  DurationBadgeComponent,
  generateAgentColorOklch,
  formatOklch,
  isThemeFallbackColor,
} from '@ptah-extension/chat-ui';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { formatModelDisplayName } from '@ptah-extension/shared';
import { AutoAnimateDirective } from '../../../directives/auto-animate.directive';

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
  imports: [
    LucideAngularModule,
    TypingCursorComponent,
    CostBadgeComponent,
    TokenBadgeComponent,
    DurationBadgeComponent,
    NgClass,
    NgTemplateOutlet,
    AutoAnimateDirective,
  ],
  template: `
    <!-- TASK_2025_109: Enhanced styling for interrupted agents -->
    <!-- Interrupted agents get warning border + tinted background to stand out -->
    <!-- Background agents get dashed border + info tint -->
    <div
      class="my-3 border-l-2 rounded-lg overflow-hidden transition-colors"
      [ngClass]="{
        'bg-base-200/50': !isInterrupted() && !isResumed() && !isBackground(),
        'bg-warning/10': isInterrupted(),
        'border-warning': isInterrupted(),
        'ring-1': isInterrupted() || isResumed() || isBackground(),
        'ring-warning/30': isInterrupted(),
        'streaming-border-glow': isStreaming() && !isBackground(),
        'bg-info/5': isBackground() && !isInterrupted() && !isResumed(),
        'border-dashed': isBackground() || isResumed(),
        'ring-info/20': isBackground() && !isInterrupted() && !isResumed(),
        'bg-success/5': isResumed(),
        'ring-success/30': isResumed(),
      }"
      [style.border-left-color]="
        isInterrupted() ? null : isResumed() ? null : agentColor()
      "
      [class.border-success]="isResumed()"
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

        <!-- Agent type + description (inline only when expanded) -->
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <span class="text-[11px] font-semibold text-base-content/80">
            {{ node().agentType }}
          </span>
          @if (!isCollapsed() && node().agentDescription) {
            <span
              class="text-[10px] text-base-content/50 truncate"
              [title]="node().agentDescription"
            >
              {{ node().agentDescription }}
            </span>
          }
        </div>

        <!-- Streaming/Interrupted/Background badge or stats -->
        @if (isBackground() && isStreaming()) {
          <span class="badge badge-xs badge-info gap-1 flex-shrink-0">
            <lucide-angular
              [img]="LoaderIcon"
              class="w-2.5 h-2.5 animate-spin"
            />
            <span class="text-[9px]">Background</span>
          </span>
        } @else if (isBackground() && !isInterrupted() && !isStreaming()) {
          <span
            class="badge badge-xs badge-outline badge-info gap-1 flex-shrink-0"
          >
            <span class="text-[9px]">Background</span>
          </span>
        } @else if (isStreaming()) {
          <span class="badge badge-xs badge-info gap-1 flex-shrink-0">
            <lucide-angular
              [img]="LoaderIcon"
              class="w-2.5 h-2.5 animate-spin"
            />
            <span class="text-[9px]">Streaming</span>
          </span>
        } @else if (isResumed()) {
          <!-- TASK_2025_211: Resumed indicator — agent was interrupted then continued -->
          <span
            class="badge badge-sm badge-success gap-1 flex-shrink-0"
            title="This agent was resumed in a new session."
          >
            <span class="text-[10px] font-medium">Resumed</span>
          </span>
        } @else if (isInterrupted()) {
          <!-- TASK_2025_109: Enhanced interrupted indicator with auto-resume hint -->
          <span
            class="badge badge-sm badge-warning gap-1 flex-shrink-0"
            title="This agent was interrupted. It will auto-resume when you send a message."
          >
            <lucide-angular [img]="StopCircleIcon" class="w-3 h-3" />
            <span class="text-[10px] font-medium">Interrupted</span>
          </span>
        } @else if (hasChildren()) {
          <span class="badge badge-xs badge-ghost text-[9px] flex-shrink-0">
            {{ childStats() }}
          </span>
        }
      </button>

      <!-- Card description (visible when collapsed for card-like appearance) -->
      @if (isCollapsed() && node().agentDescription) {
        <button
          type="button"
          class="w-full text-left px-3 pb-2 cursor-pointer hover:bg-base-300/30 transition-colors"
          aria-label="Expand agent"
          (click)="toggleCollapse()"
        >
          <p
            class="text-[11px] text-base-content/60 leading-relaxed line-clamp-2"
          >
            {{ node().agentDescription }}
          </p>
        </button>
      }

      <!-- Collapsible Content: INTERLEAVED TIMELINE (text + tools in order).
           Uses CSS grid 0fr/1fr rows transition for smooth height collapse
           without measuring in JS. Inner container handles the actual scroll
           and child animations via auto-animate. -->
      <div
        class="agent-collapse-wrapper"
        [class.agent-collapsed]="isCollapsed()"
      >
        <div class="agent-collapse-inner">
          <div
            #contentContainer
            class="px-3 pb-2 max-h-80 overflow-y-auto border-t border-base-300/30"
            [auto-animate]
          >
            <!-- TASK_2025_102 FIX: summaryContent is now rendered as a text child node
             instead of a separate block. This ensures agent text is properly
             interleaved with tool calls in chronological order. -->
            @if (hasChildren()) {
              <!--
              TASK_2026_103 wave B2: recursive child rendering is delegated to
              a parent-supplied TemplateRef to break the file-import cycle
              between this component and ExecutionNodeComponent. The parent
              (ExecutionNodeComponent itself) provides the template via the
              nodeTemplate input; we just stamp it once per child.
            -->
              @for (child of node().children; track child.id) {
                <ng-container
                  [ngTemplateOutlet]="nodeTemplate() ?? null"
                  [ngTemplateOutletContext]="{ $implicit: child }"
                />
              }
              @if (isStreaming()) {
                <div
                  class="flex items-center gap-1 text-[10px] text-base-content/40 mt-2"
                >
                  <lucide-angular
                    [img]="LoaderIcon"
                    class="w-3 h-3 animate-spin"
                  />
                  <span>Agent working</span>
                  <ptah-typing-cursor colorClass="text-base-content/40" />
                </div>
              }
            } @else {
              <!-- No children yet -->
              @if (isStreaming()) {
                <div
                  class="flex items-center gap-2 text-[10px] text-base-content/40 py-2"
                >
                  <lucide-angular
                    [img]="LoaderIcon"
                    class="w-3 h-3 animate-spin"
                  />
                  <span>Starting agent execution</span>
                  <ptah-typing-cursor colorClass="text-base-content/40" />
                </div>
              } @else {
                <div class="text-[10px] text-base-content/40 py-2">
                  No execution data
                </div>
              }
            }
          </div>
        </div>
      </div>

      <!-- Agent Stats Footer (shown when stats available and not streaming) -->
      @if (hasStats() && !isStreaming()) {
        <!-- TASK_2026_TREE_STABILITY Fix 5/8: animate.enter/leave gated by
             !isFinalizing() — applied as a conditional class so the cross-fade
             doesn't run during the finalize burst (which already includes a
             layout settle). animate.enter is a static directive, so we ALSO
             keep the directive but add a class-based suppression via
             prefers-reduced-motion-style override below: when [data-finalizing]
             is set on the host, the keyframes are no-ops. -->
        <div
          class="flex items-center gap-1.5 px-3 py-1.5 border-t border-white/5 text-base-content/70 rounded-b-lg"
          [style.background-color]="footerBgColor()"
          [attr.data-finalizing]="isFinalizing() ? '' : null"
          animate.enter="agent-fade-in"
          animate.leave="agent-fade-out"
        >
          @if (modelDisplayName()) {
            <span
              class="badge badge-xs text-[9px] font-medium flex-shrink-0 border-white/20 text-white/80"
              [style.background-color]="agentColor()"
              [title]="rawModelId() || ''"
            >
              {{ modelDisplayName() }}
            </span>
          }
          @if (agentTokenUsage()) {
            <ptah-token-badge [tokens]="agentTokenUsage()!" />
          }
          @if (agentCost() > 0) {
            <ptah-cost-badge [cost]="agentCost()" />
          }
          @if (agentDuration()) {
            <ptah-duration-badge [durationMs]="agentDuration()!" />
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .streaming-border-glow {
        animation: agent-border-glow 2s ease-in-out infinite;
      }
      @keyframes agent-border-glow {
        0%,
        100% {
          box-shadow: 0 0 6px 1px oklch(var(--in) / 0.2);
          border-color: oklch(var(--in) / 0.4);
        }
        50% {
          box-shadow: 0 0 2px 0 oklch(var(--in) / 0.05);
          border-color: oklch(var(--in) / 0.15);
        }
      }

      /* Grid-rows collapse pattern: animate height without measuring in JS.
         Wrapper transitions grid-template-rows from 1fr → 0fr; inner has
         min-height: 0 + overflow: hidden so the child clips smoothly. */
      .agent-collapse-wrapper {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows 320ms cubic-bezier(0.22, 0.61, 0.36, 1);
      }
      .agent-collapse-wrapper.agent-collapsed {
        grid-template-rows: 0fr;
      }
      .agent-collapse-inner {
        min-height: 0;
        overflow: hidden;
      }

      @keyframes agentFadeIn {
        from {
          opacity: 0;
          transform: translateY(3px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes agentFadeOut {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-2px);
        }
      }
      :host ::ng-deep .agent-fade-in {
        animation: agentFadeIn 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      }
      :host ::ng-deep .agent-fade-out {
        animation: agentFadeOut 180ms cubic-bezier(0.4, 0, 0.2, 1) both;
      }

      /* TASK_2026_TREE_STABILITY Fix 5/8: Suppress fade keyframes while a
         finalize transition is in flight — avoids cross-fade waves stacking
         on top of the layout settle when the streaming bubble swaps over to
         the finalized representation. */
      :host ::ng-deep [data-finalizing] .agent-fade-in,
      :host ::ng-deep [data-finalizing] .agent-fade-out,
      :host ::ng-deep [data-finalizing].agent-fade-in,
      :host ::ng-deep [data-finalizing].agent-fade-out {
        animation: none !important;
      }

      @media (prefers-reduced-motion: reduce) {
        :host ::ng-deep .streaming-border-glow {
          animation: none;
          box-shadow: 0 0 4px 1px oklch(var(--in) / 0.15);
          border-color: oklch(var(--in) / 0.3);
        }
        .agent-collapse-wrapper {
          transition: none !important;
        }
        :host ::ng-deep .agent-fade-in,
        :host ::ng-deep .agent-fade-out {
          animation: none !important;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InlineAgentBubbleComponent {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly agentMonitorStore = inject(AgentMonitorStore);

  /**
   * MutationObserver for auto-scroll behavior.
   * Watches DOM mutations to trigger scroll after recursive ExecutionNode tree completes.
   */
  private observer: MutationObserver | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly SCROLL_DEBOUNCE_MS = 50;

  /**
   * Flag to prevent multiple afterNextRender callbacks from being queued
   * when user rapidly toggles collapse/expand.
   */
  private observerSetupPending = false;

  readonly node = input.required<ExecutionNode>();

  /**
   * Permission lookup function forwarded from parent
   */
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();

  /**
   * TASK_2026_103 wave B2: parent-supplied template used to recursively render
   * child execution nodes. Decoupling this template from a static import of
   * ExecutionNodeComponent breaks the inline-agent-bubble ↔ execution-node
   * file-import cycle. The parent (ExecutionNodeComponent) passes an
   * `<ng-template let-child>` whose body invokes `<ptah-execution-node>`.
   */
  readonly nodeTemplate = input<TemplateRef<{
    $implicit: ExecutionNode;
  }> | null>(null);

  /**
   * TASK_2026_TREE_STABILITY Fix 5/8: Whether the chat is currently in the
   * streaming → finalized handoff window. Forwarded from chat-view through
   * ExecutionNodeComponent. When true, fade keyframes are suppressed via a
   * `[data-finalizing]` attribute so cross-fades don't stack on the layout
   * settle.
   */
  readonly isFinalizing = input<boolean>(false);

  /**
   * Emits when user responds to permission request
   * Bubbles up from nested execution nodes
   */
  readonly permissionResponded = output<PermissionResponse>();

  // TASK_2025_109: resumeRequested output removed - Resume button no longer needed
  // Subagent resumption is now handled via context injection in chat:continue RPC.

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
  // TASK_2025_109: PlayCircleIcon removed - Resume button no longer needed

  // Collapse state - expanded by default, auto-collapsed for background agents
  readonly isCollapsed = signal(false);

  // TASK_2025_109: isResuming signal removed - Resume button no longer needed

  constructor() {
    // Auto-collapse background agents so they don't interfere with the
    // active session's streaming. Users can manually expand if needed.
    // Runs once on init and when a node transitions to background mid-stream.
    effect(() => {
      if (this.isBackground()) {
        this.isCollapsed.set(true);
      }
    });

    // Setup observer after initial render
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector },
    );

    // Re-setup observer when component expands (container re-enters DOM)
    // The #contentContainer is conditionally rendered with @if (!isCollapsed())
    effect(() => {
      const collapsed = this.isCollapsed();
      if (!collapsed && !this.observerSetupPending) {
        // Container is visible - setup/re-setup observer
        // Use afterNextRender to ensure DOM is ready
        // Set flag to prevent multiple queued setups on rapid toggle
        this.observerSetupPending = true;
        afterNextRender(
          () => {
            this.setupMutationObserver();
            this.observerSetupPending = false;
          },
          { injector: this.injector },
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
    // TASK_2025_264 P5: Removed characterData (fired on every text node change during
    // streaming, causing excessive scroll callbacks). childList + subtree is sufficient
    // because Angular's change detection adds new DOM elements for streaming content.
    this.observer.observe(container, {
      childList: true, // New nodes added/removed
      subtree: true, // Watch entire subtree (recursive components)
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
      // Re-check conditions - may have changed during debounce period
      const stillStreaming = this.node().status === 'streaming';
      const nowCollapsed = this.isCollapsed();
      if (stillStreaming && !nowCollapsed) {
        this.scrollAgentContentToBottom();
      }
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

  // Computed: was agent resumed (TASK_2025_211 — interrupted then continued in new agent)
  // Checks both the node's own status and the AgentMonitorStore's resume tracking.
  // Matches by specific node ID to avoid false positives with multiple agents of same type.
  readonly isResumed = computed(() => {
    const node = this.node();
    if (node.status === 'resumed') return true;
    // If node is interrupted, check if THIS specific node was subsequently resumed
    if (node.status === 'interrupted') {
      const description = node.agentDescription || node.content || '';
      return this.agentMonitorStore.isAgentResumed(
        node.id,
        node.toolCallId ?? undefined,
        description,
      );
    }
    return false;
  });

  // Computed: is background agent
  readonly isBackground = computed(() => this.node().isBackground === true);

  // TASK_2025_109: isResumable computed removed - Resume button no longer needed
  // Subagent resumption is now handled via context injection in chat:continue RPC.

  // Structured agent color { l, c, h } — preferred internal representation.
  // Built-in Claude agents get fixed oklch values for theme consistency;
  // custom agents get a hashed hue. Empty/falsy types yield a sentinel that
  // routes to the `oklch(var(--bc) / α)` theme-aware fallback in formatOklch.
  readonly agentColorOklch = computed(() =>
    generateAgentColorOklch(this.node().agentType || ''),
  );

  // CSS string for the main agent color (used for border, avatar, etc.).
  readonly agentColor = computed(() => formatOklch(this.agentColorOklch()));

  /**
   * Computed: footer background color — a subtle 10%-alpha tint derived
   * directly from the structured agent color (no string round-tripping).
   * For the theme-aware sentinel we drop to a 5% `oklch(var(--bc) / 0.05)`
   * fallback so we don't fabricate l/c/h that would mis-render.
   */
  readonly footerBgColor = computed(() => {
    const color = this.agentColorOklch();
    if (isThemeFallbackColor(color)) {
      return 'oklch(var(--bc) / 0.05)';
    }
    return formatOklch(color, 0.1);
  });

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

  // Computed: agent cost for badge display
  readonly agentCost = computed(() => this.node().cost ?? 0);

  /**
   * Computed signal: whether agent has children (tool calls)
   * Using computed() ensures Angular tracks changes properly with OnPush
   */
  readonly hasChildren = computed(() => {
    return (this.node().children?.length ?? 0) > 0;
  });

  /**
   * Computed: raw model ID from the agent node (e.g., "claude-sonnet-4-20250514")
   * Used for both display name formatting and tooltip.
   */
  readonly rawModelId = computed(
    () => this.node().agentModel || this.node().model || null,
  );

  /**
   * Computed: human-readable model display name (e.g., "Sonnet 4", "Opus 4.5")
   * Uses agentModel (preferred) or model field, formatted via shared utility.
   * Returns null if no model info is available.
   */
  readonly modelDisplayName = computed(() => {
    const model = this.rawModelId();
    if (!model) return null;
    return formatModelDisplayName(model);
  });

  /**
   * Computed: aggregated token usage for the agent
   * Returns null if no token data is available.
   */
  readonly agentTokenUsage = computed(() => this.node().tokenUsage ?? null);

  /**
   * Computed: aggregated duration for the agent in milliseconds
   * Returns null if no duration data is available.
   * Note: DurationBadgeComponent handles unit normalization (seconds vs ms).
   */
  readonly agentDuration = computed(() => this.node().duration ?? null);

  /**
   * Computed: whether we have any stats to show in the footer
   * At least one stat must be available for the footer to render.
   */
  readonly hasStats = computed(() => {
    return !!(
      this.modelDisplayName() ||
      this.agentTokenUsage() ||
      this.agentCost() > 0 ||
      this.agentDuration() !== null
    );
  });

  // TASK_2025_102: Removed hasSummaryContent and summaryContent computed signals.
  // summaryContent is now rendered as a text child node via ExecutionNodeComponent,
  // so these signals are no longer needed in this component.

  protected toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }
}
