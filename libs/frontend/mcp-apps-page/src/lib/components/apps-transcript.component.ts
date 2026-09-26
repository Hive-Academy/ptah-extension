import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import {
  ExecutionNodeComponent,
  PermissionRequestCardComponent,
  QuestionCardComponent,
} from '@ptah-extension/chat';
import {
  ExecutionTreeBuilderService,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  AskUserQuestionResponse,
  ExecutionNode,
  PermissionResponse,
} from '@ptah-extension/shared';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsSurfaceOperations } from '../services/apps-surface-operations.service';
import {
  compareTranscriptItems,
  type AppsTranscriptItem,
} from './apps-transcript-order';

/**
 * `AppsTranscriptComponent` — the Apps conversation and the prompts of THIS
 * page's surface (implementation-plan.md:656-661).
 *
 * Holds no state. The agent output is
 * `ExecutionTreeBuilderService.buildTree(streamingState, 'apps:' + surfaceId)`,
 * rendered by the chat lib's `ExecutionNodeComponent`, so assistant markdown
 * and tool results go through the chat lib's existing markdown path (Req 3.5);
 * user text is rendered as plain interpolated text. Typed turns
 * (`AppsSessionService.userBubbles`) and the "Submitted: …" turns the host
 * started (`AppsSurfaceOperations.submittedBubbles`, stamped at send time)
 * are merged with the agent nodes by wall-clock time, a bubble first on a tie
 * (`compareTranscriptItems`; the harness precedent,
 * `harness-builder-view.component.ts:566-600`).
 *
 * Permission and question prompts are filtered to this page's streaming
 * surface id only (Req 2.3), so a prompt of the coding chat or the harness
 * never renders here.
 */
@Component({
  selector: 'ptah-apps-transcript',
  standalone: true,
  imports: [
    ExecutionNodeComponent,
    PermissionRequestCardComponent,
    QuestionCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
      }
    `,
  ],
  template: `
    <div
      #scrollContainer
      class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3"
      role="log"
      aria-label="Apps conversation transcript"
    >
      @for (item of items(); track item.key) {
        @if (item.kind === 'user') {
          <div class="flex justify-end" data-testid="apps-user-turn">
            <div
              class="bg-base-200 text-base-content rounded-lg px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap break-words"
            >
              {{ item.text }}
            </div>
          </div>
        } @else {
          <ptah-execution-node
            [node]="item.node"
            [isStreaming]="isProcessing()"
          />
        }
      }

      @if (isProcessing() && nodes().length === 0) {
        <div
          class="flex justify-start"
          role="status"
          aria-label="The agent is working"
        >
          <span
            class="loading loading-dots loading-sm text-base-content-muted"
            aria-hidden="true"
          ></span>
        </div>
      }

      @for (request of permissions(); track request.id) {
        <ptah-permission-request-card
          [request]="request"
          (responded)="onPermissionResponse($event)"
        />
      }

      @for (question of questions(); track question.id) {
        <ptah-question-card
          [request]="question"
          (answered)="onQuestionResponse($event)"
        />
      }
    </div>
  `,
})
export class AppsTranscriptComponent {
  private readonly session = inject(AppsSessionService);
  private readonly operations = inject(AppsSurfaceOperations);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  private readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('scrollContainer');

  protected readonly isProcessing = this.session.isProcessing;

  protected readonly nodes = computed<readonly ExecutionNode[]>(() => {
    const surfaceId = this.session.surfaceId();
    const state = this.session.streamingState();
    if (surfaceId === null || state.events.size === 0) return [];
    return this.treeBuilder.buildTree(state, 'apps:' + surfaceId);
  });

  public readonly items = computed<readonly AppsTranscriptItem[]>(() => {
    const typed = this.session
      .userBubbles()
      .map((bubble, index): AppsTranscriptItem => ({
        kind: 'user',
        key: `user-${index}`,
        at: bubble.at,
        text: bubble.text,
      }));
    const submitted = this.operations
      .submittedBubbles()
      .map((bubble, index): AppsTranscriptItem => ({
        kind: 'user',
        key: `submitted-${index}`,
        at: bubble.at,
        text: bubble.text,
      }));
    const nodes = this.nodes().map((node): AppsTranscriptItem => ({
      kind: 'node',
      key: `node-${node.id}`,
      // A node without a start time is still being built: it goes last, never
      // before the turn that caused it.
      at: node.startTime ?? Number.POSITIVE_INFINITY,
      node,
    }));
    return [...typed, ...submitted, ...nodes].sort(compareTranscriptItems);
  });

  /** Prompts targeted at this page's streaming surface only (Req 2.3). */
  public readonly permissions = computed(() => {
    this.permissionHandler.routingTargetRevision();
    const surfaceId = this.session.surfaceId();
    if (surfaceId === null) return [];
    return this.permissionHandler
      .permissionRequests()
      .filter((request) =>
        this.permissionHandler.targetTabsFor(request.id).includes(surfaceId),
      );
  });

  /** The question twin of `permissions` (`questionTargetTabsFor`). */
  public readonly questions = computed(() => {
    this.permissionHandler.routingTargetRevision();
    const surfaceId = this.session.surfaceId();
    if (surfaceId === null) return [];
    return this.permissionHandler
      .questionRequests()
      .filter((question) =>
        this.permissionHandler
          .questionTargetTabsFor(question.id)
          .includes(surfaceId),
      );
  });

  public constructor() {
    // Keep the newest turn in view after each render that changed the
    // transcript; runs in the render phase, no timer.
    afterRenderEffect(() => {
      this.items();
      this.permissions();
      this.questions();
      const container = this.scrollContainer()?.nativeElement;
      if (container !== undefined) container.scrollTop = container.scrollHeight;
    });
  }

  protected onPermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  protected onQuestionResponse(response: AskUserQuestionResponse): void {
    this.permissionHandler.handleQuestionResponse(response);
  }
}
