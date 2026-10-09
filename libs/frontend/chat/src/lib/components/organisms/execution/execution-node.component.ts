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
import {
  SurfaceMarkdownPipe,
  StreamingMarkdownRenderer,
} from '@ptah-extension/markdown';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { INCREMENTAL_STREAMING_PRESENTATION_ENABLED } from '../../../services/scroll-dirty.service';
import { LucideAngularModule, Info } from 'lucide-angular';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';
import {
  AgentSummaryComponent,
  ThinkingBlockComponent,
} from '@ptah-extension/chat-ui';
// Used only inside `@defer`, so the compiler loads the `ptah-ui` entry (the
// fence pipeline, zod and the declarative renderer) as a lazy chunk. Same
// contract as `@ptah-extension/chat-ui/change-set-card` in the transcript.
import { PtahUiMessageTextComponent } from '@ptah-extension/chat-ui/ptah-ui';
import { ToolCallItemComponent } from '../../molecules/tool-execution/tool-call-item.component';
import { WorkflowCardComponent } from './workflow-card.component';
import { TaskCardComponent } from './task-card.component';
import { MonitorCardComponent } from './monitor-card.component';
import { SendMessageChipComponent } from './send-message-chip.component';
import { ScheduleWakeupChipComponent } from './schedule-wakeup-chip.component';
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
  TurnSourceSnapshot,
} from '@ptah-extension/shared';
import { hasPtahUiFenceLine } from './ptah-ui-fence-line';

/**
 * What a top-level assistant text node needs to render `ptah-ui` fences
 * (TASK_2026_610, component 10). The message bubble builds it on Electron
 * only; everywhere else it is `null` and the text renders exactly as before.
 */
export interface PtahUiNodeContext {
  readonly messageId: string;
  /** Transcript order of the message; higher is newer. */
  readonly orderKey: number;
  /**
   * The turn's host data (PR C), threaded from the transcript's
   * `ptahUiSnapshots` map: what `$diff`/`$tests`/`$usage` resolve from.
   * Optional so pre-PR-C context literals keep compiling; production always
   * sets it, and `null` (the VS Code / absent case) resolves every binding to
   * `unavailable`. Compared by identity — the transcript keeps an unchanged
   * turn's snapshot object stable, so only a real source change re-renders.
   */
  readonly snapshot?: TurnSourceSnapshot | null;
}

/** Context equality by value, so a new message object does not re-render the host. */
export function samePtahUiContext(
  left: PtahUiNodeContext | null,
  right: PtahUiNodeContext | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.messageId === right.messageId &&
      left.orderKey === right.orderKey &&
      (left.snapshot ?? null) === (right.snapshot ?? null))
  );
}

/**
 * Which dedicated SDK-tool card a `tool` node should render instead of the
 * generic tool-call item. `null` means "fall through to the tool card".
 */
type SdkCardKind =
  'workflow' | 'task' | 'monitor' | 'sendMessage' | 'scheduleWakeup' | null;

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
    SurfaceMarkdownPipe,
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
    // Used only inside `@defer` (see the import above).
    PtahUiMessageTextComponent,
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
        } @else if (ptahUiHost(); as host) {
          <!-- ptah-ui: Electron top-level assistant text with a fence line.
               Mounting is decided here, from raw text, by control flow; no
               marker ever enters the HTML, so agent HTML cannot forge a block.
               No fade class: this branch is entered mid-stream when the
               opener arrives, and a replayed fade would flash the text. The
               placeholder and a chunk-load error render today's markdown. -->
          <div
            class="prose prose-sm prose-invert max-w-none my-2 exec-text-branch"
          >
            @defer (on immediate) {
              <ptah-ui-message-text
                [text]="renderedContent()"
                [messageId]="host.messageId"
                [nodeId]="node().id"
                [orderKey]="host.orderKey"
                [active]="surfaceActive()"
                [snapshot]="host.snapshot ?? null"
              />
            } @placeholder {
              <markdown
                [data]="renderedContent() | surfaceMarkdown: surfaceActive()"
              />
            } @error {
              <markdown
                [data]="renderedContent() | surfaceMarkdown: surfaceActive()"
              />
            }
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
            @if (incrementalStreamingEnabled && isNodeStreaming()) {
              <div [innerHTML]="streamingHtml()"></div>
            } @else {
              <markdown
                [data]="renderedContent() | surfaceMarkdown: surfaceActive()"
              />
            }
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
            <!-- SendMessage tool: agent-to-agent message chip. A resumed
                 subagent streams under the SendMessage tool_use id, so its
                 agent node arrives as a child and must render here. -->
            <div [class.exec-fade-in]="!isFinalizing()">
              <ptah-send-message-chip [node]="node()" />
              @if (node().children.length > 0) {
                <div class="exec-children">
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
              <div class="exec-children">
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
        <!-- Message node unwraps to its children. The ptah-ui context is
             forwarded HERE ONLY: agent, tool and SendMessage recursions above
             never pass it, so subagent, tool and nested text stay code. The
             turn-source snapshot rides INSIDE the context (PR C), so it
             reaches this message's assistant text only — never a subagent's. -->
        <div class="exec-children">
          @for (child of node().children; track child.id) {
            <ptah-execution-node
              [node]="child"
              [isStreaming]="isStreaming()"
              [isFinalizing]="isFinalizing()"
              [getPermissionForTool]="getPermissionForTool()"
              [ptahUi]="ptahUi()"
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

  /**
   * `ptah-ui` fence rendering for top-level assistant text. Set by the message
   * bubble on Electron only and forwarded only through `message` nodes; `null`
   * (the default, and always in VS Code) keeps today's markdown path.
   */
  readonly ptahUi = input<PtahUiNodeContext | null>(null);
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
  private frameGeneration = 0;
  // Non-optional on purpose. This library is `scope:webview`, so the only host
  // is the webview, which binds the token at the composition root, per route
  // and through `SurfaceActiveDirective`. An optional inject would fall back to
  // "always active" and silently never throttle — the gate would be dead with
  // no error and no failing test.
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);
  protected readonly incrementalStreamingEnabled = inject(
    INCREMENTAL_STREAMING_PRESENTATION_ENABLED,
  );
  private readonly streamingMarkdown = new StreamingMarkdownRenderer();
  private readonly _streamingHtml = signal('');
  protected readonly streamingHtml = this._streamingHtml.asReadonly();

  constructor() {
    effect(() => {
      const content = this.node().content ?? '';
      if (!this.surfaceActive()) {
        this.pendingFrame?.cancel();
        this.pendingFrame = null;
        this.frameGeneration++;
        this.pendingContent = content;
        return;
      }

      // Settled node (or a restored transcript): the value is final, so pay
      // the render now rather than one frame late.
      if (!this.isNodeStreaming()) {
        this.publishNow(content);
        return;
      }

      this.pendingContent = content;
      if (this.pendingFrame) return;
      const generation = ++this.frameGeneration;
      this.pendingFrame = scheduleFrame(() => {
        if (generation !== this.frameGeneration) return;
        this.pendingFrame = null;
        if (!this.surfaceActive()) return;
        const pending = this.pendingContent;
        this.pendingContent = null;
        if (pending !== null) this.publishStreaming(pending);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.frameGeneration++;
      this.pendingFrame?.cancel();
      this.pendingFrame = null;
      this.pendingContent = null;
    });
  }

  /** Drop any queued frame and render `content` on this tick. */
  private publishNow(content: string): void {
    this.frameGeneration++;
    this.pendingFrame?.cancel();
    this.pendingFrame = null;
    this.pendingContent = null;
    this._renderedContent.set(content);
    this._streamingHtml.set('');
  }

  private publishStreaming(content: string): void {
    this._renderedContent.set(content);
    if (this.incrementalStreamingEnabled) {
      this._streamingHtml.set(this.streamingMarkdown.render(content));
    }
  }

  /**
   * The context to render this text through the `ptah-ui` host, or `null` for
   * today's markdown. The fence scan runs only when a context exists, so in
   * VS Code the text is never scanned and the lazy chunk is never requested.
   */
  protected readonly ptahUiHost = computed(
    (): PtahUiNodeContext | null => {
      const context = this.ptahUi();
      if (context === null || this.isNodeStreaming()) return null;
      return hasPtahUiFenceLine(this.renderedContent()) ? context : null;
    },
    { equal: samePtahUiContext },
  );

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
