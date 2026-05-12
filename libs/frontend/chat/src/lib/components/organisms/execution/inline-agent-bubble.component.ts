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
  ChevronUp,
  Loader2,
  StopCircle,
  Square,
  Send,
  CheckCircle2,
  XCircle,
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

      <!-- Phase 3: SDK task_* per-subagent status row.
           Only renders when a SubagentRecord exists for this node's toolCallId.
           Keyed by parentToolUseId — fed by agent_start / agent_progress /
           agent_status / agent_completed events through AgentMonitorStore. -->
      @if (subagentRecord(); as rec) {
        <div
          class="flex items-center gap-2 px-3 py-1 text-[10px] border-t border-base-300/30 bg-base-100/40"
          data-testid="subagent-status-row"
        >
          <!-- Status badge -->
          @switch (rec.status) {
            @case ('running') {
              <span
                class="badge badge-xs badge-info gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="running"
              >
                <span
                  class="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                ></span>
                <span class="text-[9px]">running</span>
              </span>
            }
            @case ('completed') {
              <span
                class="badge badge-xs badge-success gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="completed"
              >
                <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
                <span class="text-[9px]">completed</span>
              </span>
            }
            @case ('failed') {
              <span
                class="badge badge-xs badge-error gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="failed"
              >
                <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
                <span class="text-[9px]">failed</span>
              </span>
            }
            @case ('killed') {
              <span
                class="badge badge-xs badge-error gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="killed"
              >
                <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
                <span class="text-[9px]">failed</span>
              </span>
            }
            @case ('stopped') {
              <span
                class="badge badge-xs badge-warning gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="stopped"
              >
                <lucide-angular [img]="StopCircleIcon" class="w-2.5 h-2.5" />
                <span class="text-[9px]">stopped</span>
              </span>
            }
            @case ('pending') {
              <span
                class="badge badge-xs badge-ghost gap-1 flex-shrink-0"
                data-testid="subagent-status-badge"
                data-status="pending"
              >
                <lucide-angular
                  [img]="LoaderIcon"
                  class="w-2.5 h-2.5 animate-spin"
                />
                <span class="text-[9px]">pending</span>
              </span>
            }
          }

          <!-- Progress sub-line: italic, muted, ellipsis-truncated single line -->
          @if (progressLine(); as line) {
            <span
              class="flex-1 min-w-0 italic text-[9px] text-base-content/50 truncate"
              data-testid="subagent-progress-line"
              [title]="line"
            >
              {{ line }}
            </span>
          } @else {
            <span class="flex-1"></span>
          }

          <!-- Stop button: only when running and we have a taskId to stop. -->
          @if (canStop()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content/60 hover:text-error"
              (click)="onStopClick($event)"
              [disabled]="stopPending()"
              data-testid="subagent-stop-button"
              title="Stop this subagent"
              aria-label="Stop subagent"
            >
              <lucide-angular [img]="SquareIcon" class="w-3 h-3" />
            </button>
          }

          <!-- Send-message toggle (collapsed by default) -->
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content/50"
            (click)="toggleSendInput($event)"
            data-testid="subagent-send-toggle"
            [attr.aria-expanded]="sendInputExpanded()"
            [title]="sendInputExpanded() ? 'Hide send input' : 'Send a message'"
          >
            <lucide-angular
              [img]="sendInputExpanded() ? ChevronUpIcon : ChevronDownIcon"
              class="w-3 h-3"
            />
            <span class="text-[9px]">Send a message</span>
          </button>
        </div>

        <!-- Send-message input (collapsed by default). -->
        @if (sendInputExpanded()) {
          <div
            class="flex items-start gap-2 px-3 py-2 border-t border-base-300/30 bg-base-100/30"
            data-testid="subagent-send-form"
          >
            <textarea
              #sendTextarea
              class="textarea textarea-bordered textarea-xs flex-1 text-[11px] resize-none leading-snug min-h-0"
              [class.textarea-disabled]="!canSendMessage()"
              [disabled]="!canSendMessage()"
              [title]="canSendMessage() ? '' : 'Agent is no longer running'"
              [attr.aria-label]="'Send a message to this subagent'"
              placeholder="Send a message to this agent…"
              rows="1"
              [value]="sendDraft()"
              (input)="onSendDraftInput($event)"
              (keydown)="onSendKeydown($event)"
              data-testid="subagent-send-textarea"
            ></textarea>
            <button
              type="button"
              class="btn btn-primary btn-xs px-2 min-h-0 h-7 flex-shrink-0"
              [disabled]="!canSubmitSend()"
              (click)="onSendSubmit()"
              data-testid="subagent-send-submit"
              title="Send (Cmd/Ctrl+Enter)"
              aria-label="Send message"
            >
              <lucide-angular [img]="SendIcon" class="w-3 h-3" />
            </button>
          </div>
          @if (showSentToast()) {
            <div
              class="px-3 py-1 text-[10px] text-success/80 italic"
              data-testid="subagent-sent-toast"
              animate.enter="agent-fade-in"
            >
              sent ✓
            </div>
          }
        }
      }

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
  readonly ChevronUpIcon = ChevronUp;
  readonly LoaderIcon = Loader2;
  readonly StopCircleIcon = StopCircle;
  readonly SquareIcon = Square;
  readonly SendIcon = Send;
  readonly CheckIcon = CheckCircle2;
  readonly XIcon = XCircle;
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

  // ───────────────────────────────────────────────────────────────────
  // Phase 3: subagent visibility + bidirectional messaging
  // ───────────────────────────────────────────────────────────────────

  /** parentToolUseId for the SDK task this bubble represents. */
  readonly parentToolUseId = computed(() => this.node().toolCallId ?? null);

  /** Reactive lookup of the subagent record from AgentMonitorStore. */
  readonly subagentRecord = computed(() => {
    const key = this.parentToolUseId();
    if (!key) return undefined;
    return this.agentMonitorStore.subagents().get(key);
  });

  /** Single-line progress text shown next to the status badge. */
  readonly progressLine = computed(() => {
    const rec = this.subagentRecord();
    if (!rec) return null;
    if (rec.latestSummary) return rec.latestSummary;
    if (rec.lastToolName) return `last: ${rec.lastToolName}`;
    if (rec.description) return rec.description;
    return null;
  });

  /** Stop button is only valid while running AND we know a taskId. */
  readonly canStop = computed(() => {
    const rec = this.subagentRecord();
    return !!rec && rec.status === 'running' && !!rec.taskId;
  });

  /** Whether the send-message textarea should accept input. */
  readonly canSendMessage = computed(() => {
    const rec = this.subagentRecord();
    return !!rec && rec.status === 'running';
  });

  // Send-message UI state
  readonly sendInputExpanded = signal(false);
  readonly sendDraft = signal('');
  readonly sendPending = signal(false);
  readonly stopPending = signal(false);
  readonly showSentToast = signal(false);
  private sentToastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Submit-button enablement: text non-empty AND record is running. */
  readonly canSubmitSend = computed(() => {
    return (
      this.canSendMessage() &&
      !this.sendPending() &&
      this.sendDraft().trim().length > 0
    );
  });

  protected toggleSendInput(event: Event): void {
    event.stopPropagation();
    this.sendInputExpanded.update((v) => !v);
  }

  protected onSendDraftInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.sendDraft.set(target.value);
    // Auto-grow up to ~3 lines
    target.style.height = 'auto';
    const max = 72; // ~3 lines @ 24px line-height
    target.style.height = Math.min(target.scrollHeight, max) + 'px';
  }

  protected onSendKeydown(event: KeyboardEvent): void {
    // Cmd/Ctrl+Enter submits
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.onSendSubmit();
    }
  }

  protected async onSendSubmit(): Promise<void> {
    if (!this.canSubmitSend()) return;
    const key = this.parentToolUseId();
    if (!key) return;
    const text = this.sendDraft().trim();
    this.sendPending.set(true);
    let sent = false;
    try {
      sent = await this.agentMonitorStore.sendMessageToAgent(key, text);
    } finally {
      this.sendPending.set(false);
    }
    if (sent) {
      this.sendDraft.set('');
      this.flashSentToast();
    }
    // On failure the draft is preserved so the user can retry; the store's
    // subagentRpcError signal surfaces the error inline via the template.
  }

  protected async onStopClick(event: Event): Promise<void> {
    event.stopPropagation();
    const rec = this.subagentRecord();
    if (!rec || !rec.taskId) return;
    this.stopPending.set(true);
    try {
      await this.agentMonitorStore.stopAgent(rec.taskId);
    } finally {
      this.stopPending.set(false);
    }
  }

  private flashSentToast(): void {
    if (this.sentToastTimer) clearTimeout(this.sentToastTimer);
    this.showSentToast.set(true);
    this.sentToastTimer = setTimeout(() => {
      this.showSentToast.set(false);
      this.sentToastTimer = null;
    }, 2000);
  }
}
