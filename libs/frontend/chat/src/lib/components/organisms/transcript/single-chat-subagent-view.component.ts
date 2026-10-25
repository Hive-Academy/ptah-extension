import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ArrowLeft, Bot, LucideAngularModule } from 'lucide-angular';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ChatStore } from '../../../services/chat.store';
import { ExecutionNodeComponent } from '../execution/execution-node.component';
import { LaneTranscriptComponent } from './lane-transcript.component';
import { SubagentLaneComponent } from '../subagent-lane/subagent-lane.component';

/**
 * Single chat view: one sub-agent opened in place over its transcript.
 *
 * With a monitor record for the agent it renders the store-backed
 * `ptah-subagent-lane` (stats bar and always-visible message input), the same
 * lane the canvas shows. Without one it keeps the live agent header and renders its children through
 * the same lane transcript. Either
 * way pending permissions stay answerable through the same `ChatStore` path
 * the transcript bubbles use. Back is the only way out; the transcript
 * restores its scroll and focus.
 */
@Component({
  selector: 'ptah-single-chat-subagent-view',
  standalone: true,
  imports: [
    LucideAngularModule,
    ExecutionNodeComponent,
    LaneTranscriptComponent,
    SubagentLaneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col min-h-0 bg-base-100',
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <section
      class="flex flex-col flex-1 min-h-0"
      [attr.aria-label]="name() + ' agent'"
      data-testid="single-chat-subagent-view"
    >
      <header
        class="flex items-center gap-2 px-2 py-1.5 border-b border-base-content/10 bg-base-200/40 flex-shrink-0"
      >
        <button
          #backButton
          type="button"
          class="btn btn-ghost btn-xs gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="Back to the conversation"
          data-testid="subagent-view-back"
          (click)="back.emit()"
        >
          <lucide-angular
            [img]="BackIcon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
          Back
        </button>
        <lucide-angular
          [img]="BotIcon"
          class="w-4 h-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <h2
          class="text-xs font-medium truncate"
          data-testid="subagent-view-name"
        >
          {{ name() }}
        </h2>
      </header>
      <div
        class="flex-1 min-h-0 overflow-y-auto py-2"
        data-testid="subagent-view-body"
      >
        @if (record(); as rec) {
          <ptah-subagent-lane
            class="block"
            [record]="rec"
            [sessionId]="rec.parentSessionId ?? null"
            [getPermissionForTool]="getPermissionForTool"
            (permissionResponded)="onPermissionResponse($event)"
          />
        } @else {
          <ptah-execution-node
            [node]="fallbackHeader()"
            [isStreaming]="isStreaming()"
            [agentTileMode]="false"
            [getPermissionForTool]="getPermissionForTool"
            (permissionResponded)="onPermissionResponse($event)"
          />
          <ptah-lane-transcript
            [laneId]="node().id"
            [nodes]="node().children"
            [isStreaming]="isStreaming()"
            [getPermissionForTool]="getPermissionForTool"
            (permissionResponded)="onPermissionResponse($event)"
          />
        }
      </div>
    </section>
  `,
})
export class SingleChatSubagentViewComponent {
  private readonly chatStore = inject(ChatStore);
  private readonly monitor = inject(AgentMonitorStore);

  /**
   * Live agent node. The transcript closes the view when the node is gone,
   * so it never passes a missing one.
   */
  readonly node = input.required<ExecutionNode>();
  /** Whether the message holding the agent is still streaming. */
  readonly isStreaming = input<boolean>(false);
  readonly back = output<void>();

  protected readonly BackIcon = ArrowLeft;
  protected readonly BotIcon = Bot;

  private readonly backButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('backButton');

  /** The monitor record keyed by the agent's Task tool call, when known. */
  protected readonly record = computed(
    () => this.monitor.subagents().get(this.node().toolCallId ?? '') ?? null,
  );

  /** Keep the fallback agent's controls and metadata outside its message list. */
  protected readonly fallbackHeader = computed(() => ({
    ...this.node(),
    children: [],
  }));
  protected readonly name = computed(() => {
    const agent = this.node();
    return agent.agentType || agent.agentDescription || 'Subagent';
  });

  /** Same lookup the transcript bubbles pass to their execution trees. */
  protected readonly getPermissionForTool = (
    toolCallId: string,
  ): PermissionRequest | null =>
    this.chatStore.getPermissionForTool(toolCallId);

  constructor() {
    // Move focus into the view so keyboard users land on its only exit.
    afterNextRender(() => this.backButton().nativeElement.focus());
  }

  protected onPermissionResponse(response: PermissionResponse): void {
    this.chatStore.handlePermissionResponse(response);
  }

  /**
   * Escape leaves the view unless a control inside already handled it or the
   * key was pressed in an editable field: leaving destroys the view, and with
   * it a draft such as the "Message this agent" text (codex-review-R9n
   * finding 1).
   */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented || isEditable(event.target)) return;
    event.preventDefault();
    this.back.emit();
  }
}

/** Text the user is writing: a form field or a contenteditable region. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}
