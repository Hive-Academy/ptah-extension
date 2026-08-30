import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { LucideAngularModule, Info } from 'lucide-angular';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';
import {
  AgentSummaryComponent,
  ThinkingBlockComponent,
} from '@ptah-extension/chat-ui';
import { ToolCallItemComponent } from '../../molecules/tool-execution/tool-call-item.component';
import { WorkflowCardComponent } from './workflow-card.component';
import { TaskCardComponent } from './task-card.component';
import { MonitorCardComponent } from './monitor-card.component';
import { SendMessageChipComponent } from './send-message-chip.component';
import { ScheduleWakeupChipComponent } from './schedule-wakeup-chip.component';
import { AutoAnimateDirective } from '../../../directives/auto-animate.directive';
import {
  isWorkflowTool,
  isTaskManagementTool,
  isMonitorTool,
  isSendMessageTool,
  isScheduleWakeupTool,
} from '@ptah-extension/shared';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

/**
 * Which dedicated SDK-tool card a `tool` node should render instead of the
 * generic tool-call item. `null` means "fall through to the tool card".
 */
type SdkCardKind =
  | 'workflow'
  | 'task'
  | 'monitor'
  | 'sendMessage'
  | 'scheduleWakeup'
  | null;

/** Trailing-edge delay used when no animation frame source exists (SSR, node). */
const FALLBACK_FRAME_MS = 50;

/** Cancellable handle returned by {@link scheduleFrame}. */
interface FrameHandle {
  cancel(): void;
}

/**
 * Run `cb` on the next painted frame.
 *
 * `requestAnimationFrame` — not a fixed timer — is the right primitive for a
 * streaming render throttle because it is *self-limiting*: when the main
 * thread is loaded the browser paints less often, so the markdown re-render
 * rate drops with it instead of competing with the work that is already late.
 * A `setInterval`/`setTimeout` throttle keeps firing at its nominal rate under
 * exactly the load we are trying to relieve.
 *
 * The timer branch is the fallback for environments with no rAF at all.
 * `requestAnimationFrame` is resolved at call time so a test double installed
 * on the global object is honoured.
 */
function scheduleFrame(cb: () => void): FrameHandle {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => cb());
    return { cancel: () => cancelAnimationFrame(id) };
  }
  const id = setTimeout(cb, FALLBACK_FRAME_MS);
  return { cancel: () => clearTimeout(id) };
}

/**
 * ExecutionNodeComponent - THE KEY RECURSIVE COMPONENT
 *
 * Complexity Level: 3 (Complex recursive organism)
 * Patterns: Recursive composition, Discriminated union rendering
 *
 * This is the revolutionary component that enables nested agent visualization.
 * It recursively renders ExecutionNode trees of ANY depth:
 * - Agents INSIDE agents
 * - Tools INSIDE agents
 * - Results INSIDE tools
 *
 * The @switch directive discriminates on node.type and renders appropriate
 * child components, which may recursively render more ExecutionNodeComponents.
 *
 * This creates the visual nesting that mirrors Claude CLI terminal output,
 * something NO other VS Code extension can do.
 */
@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  imports: [
    MarkdownModule,
    LucideAngularModule,
    InlineAgentBubbleComponent, // Required in imports even with @defer - Angular needs to know about it
    AgentSummaryComponent,
    ThinkingBlockComponent,
    ToolCallItemComponent,
    WorkflowCardComponent,
    TaskCardComponent,
    MonitorCardComponent,
    SendMessageChipComponent,
    ScheduleWakeupChipComponent,
    AutoAnimateDirective,
  ],
  template: `
    @switch (node().type) {
      @case ('text') {
        <!-- Wrap each branch in fade-in keyframe so flipping between
             agent-summary and markdown cross-fades instead of popping. -->
        @if (isAgentSummaryContent()) {
          <!-- animate.enter is gated to !isFinalizing() so the fade wave
               doesn't stack on top of the finalize layout settle. We swap to
               a class-driven keyframe so the gate can flip dynamically
               (animate.enter is a static dir). -->
          <div class="exec-text-branch" [class.exec-fade-in]="!isFinalizing()">
            <ptah-agent-summary [content]="node().content || ''" />
          </div>
        } @else {
          <div
            class="prose prose-sm prose-invert max-w-none my-2 exec-text-branch"
            [class.exec-fade-in]="!isFinalizing()"
          >
            <!-- renderedContent() is the throttled mirror of node().content:
                 at most one new string per painted frame while the node
                 streams, and the exact final string the moment it settles.
                 Every value still goes through ngx-markdown, so DOMPurify
                 remains the only path AI text takes to the DOM. -->
            <markdown [data]="renderedContent()" />
          </div>
        }
      }
      @case ('thinking') {
        <ptah-thinking-block [node]="node()" />
      }
      @case ('tool') {
        @switch (sdkCardKind()) {
          @case ('workflow') {
            <!-- Workflow tool_use: render a compact "Workflow launched" chip
                 that opens the Agents monitor panel. Progress is watched there,
                 never inline in the transcript. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-workflow-card [node]="node()" />
            </div>
          }
          @case ('task') {
            <!-- Task-management tool (TaskCreate/Update/List/…): compact card. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-task-card [node]="node()" />
            </div>
          }
          @case ('monitor') {
            <!-- Monitor tool: background event-watch card. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-monitor-card [node]="node()" />
            </div>
          }
          @case ('sendMessage') {
            <!-- SendMessage tool: agent-to-agent message chip. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-send-message-chip [node]="node()" />
            </div>
          }
          @case ('scheduleWakeup') {
            <!-- ScheduleWakeup tool: loop-pacing wakeup chip. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-schedule-wakeup-chip [node]="node()" />
            </div>
          }
          @default {
            <ptah-tool-call-item
              [node]="node()"
              [permission]="
                getPermissionForTool()?.(node().toolCallId ?? '') ?? undefined
              "
              (permissionResponded)="permissionResponded.emit($event)"
            >
              <!-- RECURSIVE: Render nested children (tool results, sub-tools) -->
              <div
                [auto-animate]
                [autoAnimateDisabled]="flipAnimationDisabled()"
                class="exec-children"
              >
                @for (child of node().children; track child.id) {
                  <ptah-execution-node
                    [node]="child"
                    [isStreaming]="isStreaming()"
                    [isFinalizing]="isFinalizing()"
                    [getPermissionForTool]="getPermissionForTool()"
                    (permissionResponded)="permissionResponded.emit($event)"
                  />
                }
              </div>
            </ptah-tool-call-item>
          }
        }
      }
      @case ('agent') {
        <!--
      Pass nodeTemplate so the bubble can render its children recursively
      without importing ExecutionNodeComponent. @defer was previously used
      here but was removed because the defer block re-fired on every input
      identity change, causing a remount of the agent bubble whenever the
      tree built a fresh node reference. InlineAgentBubbleComponent is
      already in the imports array and the import cycle is already broken
      via nodeTemplate, so a direct render is safe and zoneless-stable.
      animate.enter is gated by isFinalizing() to avoid fade waves during
      the finalize burst.
    -->
        <div [class.exec-fade-in]="!isFinalizing()">
          <ptah-inline-agent-bubble
            [node]="node()"
            [getPermissionForTool]="getPermissionForTool()"
            [nodeTemplate]="bubbleChildTemplate"
            [isFinalizing]="isFinalizing()"
            (permissionResponded)="permissionResponded.emit($event)"
          />
        </div>
        <ng-template #bubbleChildTemplate let-child>
          <ptah-execution-node
            [node]="child"
            [isStreaming]="isStreaming()"
            [isFinalizing]="isFinalizing()"
            [getPermissionForTool]="getPermissionForTool()"
            (permissionResponded)="permissionResponded.emit($event)"
          />
        </ng-template>
      }
      @case ('message') {
        <!-- Message node unwraps to its children -->
        <div
          [auto-animate]
          [autoAnimateDisabled]="flipAnimationDisabled()"
          class="exec-children"
        >
          @for (child of node().children; track child.id) {
            <ptah-execution-node
              [node]="child"
              [isStreaming]="isStreaming()"
              [isFinalizing]="isFinalizing()"
              [getPermissionForTool]="getPermissionForTool()"
              (permissionResponded)="permissionResponded.emit($event)"
            />
          }
        </div>
      }
      @case ('system') {
        <!-- System messages (session init, etc.) -->
        <div class="alert alert-info my-2 text-xs">
          <lucide-angular [img]="InfoIcon" class="w-4 h-4" />
          <span>{{ node().content }}</span>
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .exec-children {
        display: flex;
        flex-direction: column;
      }

      @keyframes execFadeIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .exec-fade-in {
        animation: execFadeIn 280ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      }

      .exec-defer-placeholder {
        min-height: 2.5rem;
        animation: execFadeIn 200ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      }

      @media (prefers-reduced-motion: reduce) {
        .exec-fade-in,
        .exec-defer-placeholder {
          animation: none !important;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionNodeComponent {
  readonly node = input.required<ExecutionNode>();

  /** Global streaming state passed from parent */
  readonly isStreaming = input<boolean>(false);

  /**
   * Whether the chat is currently in the streaming → finalized transition
   * window. When true, animate.enter is suppressed via class binding so the
   * cross-fade doesn't stack on top of the layout settle (which produced
   * the visible "flicker"). Forwarded down through the recursive tree from
   * chat-view.
   */
  readonly isFinalizing = input<boolean>(false);

  /**
   * Permission lookup function forwarded from parent
   * Enables tool cards to check if they have pending permissions
   */
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();

  /**
   * Emits when user responds to permission request
   * Bubbles up from tool-call-item through component tree
   */
  readonly permissionResponded = output<PermissionResponse>();
  readonly InfoIcon = Info;

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Whether this node's own content is still growing.
   *
   * `isStreaming` is the per-message flag forwarded from the bubble; a node
   * can also carry `status: 'streaming'` on its own (agent-card outputs feed
   * nodes in without the bubble's flag). Either one means "more deltas are
   * coming", which is the only window where throttling is worth its latency.
   */
  protected readonly isNodeStreaming = computed(
    () => this.isStreaming() || this.node().status === 'streaming',
  );

  /**
   * Gate for the `[auto-animate]` FLIP containers.
   *
   * The directive installs a MutationObserver and measures
   * `getBoundingClientRect()` for every child on every mutation — a forced
   * synchronous layout per streamed chunk, on a subtree that is changing many
   * times a second. Disabling it while chunks arrive (and through the
   * finalize burst, where the whole tree re-lays out at once) keeps the FLIP
   * animation for the case it was added for: a settled tree gaining a child.
   */
  protected readonly flipAnimationDisabled = computed(
    () => this.isNodeStreaming() || this.isFinalizing(),
  );

  /**
   * The string handed to `<markdown>`.
   *
   * Kept deliberately behind the raw `node().content`. Each new value costs a
   * full `marked` tokenize (plus five custom extensions), a DOMPurify pass and
   * a DOM re-parse over the WHOLE message, so driving it straight from the
   * delta stream is O(message length²) per turn. Signal equality (`Object.is`)
   * also means an unchanged string never reaches the renderer at all — which
   * is what the old `_renderCache` was reaching for, except it keyed on a
   * fingerprint containing the content *length*, so an appending stream missed
   * on every single delta and the map only ever added bookkeeping.
   */
  private readonly _renderedContent = signal('');
  protected readonly renderedContent = this._renderedContent.asReadonly();

  /** Newest content not yet published to {@link _renderedContent}. */
  private pendingContent: string | null = null;
  private pendingFrame: FrameHandle | null = null;

  constructor() {
    effect(() => {
      const content = this.node().content ?? '';

      // Settled node (or a restored transcript): the value is final, so pay
      // the render now rather than one frame late.
      if (!this.isNodeStreaming()) {
        this.publishNow(content);
        return;
      }

      this.pendingContent = content;
      if (this.pendingFrame) return;
      this.pendingFrame = scheduleFrame(() => {
        this.pendingFrame = null;
        const pending = this.pendingContent;
        this.pendingContent = null;
        if (pending !== null) this._renderedContent.set(pending);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.pendingFrame?.cancel();
      this.pendingFrame = null;
      this.pendingContent = null;
    });
  }

  /** Drop any queued frame and render `content` on this tick. */
  private publishNow(content: string): void {
    this.pendingFrame?.cancel();
    this.pendingFrame = null;
    this.pendingContent = null;
    this._renderedContent.set(content);
  }

  /**
   * Detect if text content contains Claude's XML-like agent summary format.
   * This format includes <function_calls>, <invoke>, <thinking>, <parameter> tags.
   */
  protected isAgentSummaryContent = computed(() => {
    const content = this.node().content;
    if (!content || this.node().type !== 'text') return false;
    return (
      content.includes('<function_calls>') ||
      content.includes('<thinking>') ||
      content.includes('<invoke name=')
    );
  });

  /**
   * Which dedicated SDK-tool card this `tool` node should render, if any.
   *
   * Newer Claude Agent SDK tools each get a purpose-built compact card/chip
   * instead of the generic tool-call item. `null` (the common case) falls
   * through to {@link ToolCallItemComponent} — preserving the recursive
   * tool-result rendering for every ordinary tool.
   */
  protected sdkCardKind = computed<SdkCardKind>(() => {
    const name = this.node().toolName;
    if (!name) return null;
    if (isWorkflowTool(name)) return 'workflow';
    if (isTaskManagementTool(name)) return 'task';
    if (isMonitorTool(name)) return 'monitor';
    if (isSendMessageTool(name)) return 'sendMessage';
    if (isScheduleWakeupTool(name)) return 'scheduleWakeup';
    return null;
  });
}
