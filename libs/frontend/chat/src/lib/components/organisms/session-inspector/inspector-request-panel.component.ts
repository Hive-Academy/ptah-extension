import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  LoaderCircle,
  LucideAngularModule,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-angular';
import { AgentPermissionResponder } from '../../../services/agent-permission-responder';
import {
  SessionInspectorStore,
  type InspectorRequest,
} from '../../../services/session-inspector';

type Decision = 'allow' | 'deny';

/**
 * The inline `Review` panel of one permission request (design 4.5).
 *
 * `Allow` / `Deny` go through today's handlers: session permissions through
 * `AgentPermissionResponder.respondSession`, lane permissions through
 * `respondLane`, each after the compact card's stale re-check. While sending
 * both buttons are disabled and a second activation is ignored. A throw keeps
 * the request pending and offers `Retry` with the same decision. A request
 * that left the store (answered elsewhere, timed out, lane ended) shows the
 * closed-elsewhere status with `Close`.
 */
@Component({
  selector: 'ptah-inspector-request-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let req = request();
    <div
      #region
      role="region"
      tabindex="-1"
      class="mt-2 rounded-md border border-surface-border bg-surface-1 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ptah-focus-ring,currentColor)]"
      [attr.aria-label]="'Permission request from ' + req.ownerName"
      [attr.aria-busy]="sending() ? 'true' : null"
      (keydown.escape)="onEscape($event)"
    >
      @if (closedElsewhere()) {
        <p role="status" class="text-xs text-base-content-muted">
          This request is no longer pending. It was answered elsewhere or the
          lane ended.
        </p>
        <div class="mt-2 flex">
          <button
            type="button"
            class="inline-flex h-7 min-w-[56px] items-center justify-center rounded-md border border-surface-border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            (click)="close()"
          >
            Close
          </button>
        </div>
      } @else {
        <p class="text-xs">
          {{ req.ownerName }}@if (ownerKindLabel()) {
            <span class="text-base-content-muted"> · {{ ownerKindLabel() }}</span>
          }
        </p>
        <p
          class="mt-1 break-all font-mono text-[11px] leading-[1.45] [overflow-wrap:anywhere]"
        >
          @if (req.toolName) {
            <span class="font-semibold">{{ req.toolName }}</span>
          }
          {{ req.command }}
        </p>
        @if (failedDecision() !== null) {
          <div role="alert" class="mt-2 flex items-center gap-1.5 text-xs text-state-err">
            <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1">Could not send your response</span>
            <button
              type="button"
              class="inline-flex h-6 min-w-[42px] items-center justify-center px-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              [disabled]="sending()"
              (click)="retry()"
            >
              Retry
            </button>
          </div>
        }
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex h-7 min-w-[56px] items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--state-ink-done)_55%,transparent)] px-3 text-xs font-medium text-state-done disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            [disabled]="sending()"
            (click)="respond('allow')"
          >
            @if (sending() && activeDecision() === 'allow') {
              <lucide-angular [img]="LoaderIcon" class="mr-1 size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            }
            Allow
          </button>
          <button
            type="button"
            class="inline-flex h-7 min-w-[56px] items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--state-ink-err)_55%,transparent)] px-3 text-xs font-medium text-state-err disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            [disabled]="sending()"
            (click)="respond('deny')"
          >
            @if (sending() && activeDecision() === 'deny') {
              <lucide-angular [img]="LoaderIcon" class="mr-1 size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            }
            Deny
          </button>
          @if (hasLaneSurface() && req.ownerKey !== 'orchestrator') {
            <button
              type="button"
              class="ml-auto inline-flex h-6 items-center text-xs font-medium text-[var(--ptah-link)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              (click)="laneRequested.emit(req.ownerKey)"
            >
              Open lane
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class InspectorRequestPanelComponent {
  private readonly responder = inject(AgentPermissionResponder);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly agentStore = inject(AgentMonitorStore);

  readonly request = input.required<InspectorRequest>();
  /** Whether the request is still open in the inspector model. */
  readonly pending = input.required<boolean>();
  readonly tabId = input.required<string>();
  readonly hasLaneSurface = input<boolean>(false);
  /** Kind of the requester for the `{name} · {kind}` line; empty to omit. */
  readonly ownerKindLabel = input<string>('');

  /** The user closed the panel (Esc or `Close`). */
  readonly closed = output<void>();
  readonly laneRequested = output<string>();
  /** Outcome text for the inspector's polite live region. */
  readonly announced = output<string>();
  /** A response was sent; the request will leave the store. */
  readonly answered = output<void>();

  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly LoaderIcon = LoaderCircle;

  private readonly region = viewChild<ElementRef<HTMLElement>>('region');

  protected readonly sending = signal(false);
  protected readonly activeDecision = signal<Decision | null>(null);
  protected readonly failedDecision = signal<Decision | null>(null);
  /** The stale re-check found the request gone before it was sent. */
  private readonly stale = signal(false);

  protected readonly closedElsewhere = computed(
    () => !this.pending() || this.stale(),
  );

  protected respond(decision: Decision): void {
    if (this.sending() || this.closedElsewhere()) return;
    const request = this.request();
    this.sending.set(true);
    this.activeDecision.set(decision);
    try {
      if (!this.send(request, decision)) {
        this.stale.set(true);
        return;
      }
      this.failedDecision.set(null);
      this.announced.emit(
        `${decision === 'allow' ? 'Allowed' : 'Denied'} ${request.command}.`,
      );
      this.answered.emit();
    } catch (error: unknown) {
      // The handlers throw only when the host message could not be posted;
      // the request stays pending and counted, so the user can retry.
      console.error('[SessionInspector] Could not send a permission response', error);
      this.failedDecision.set(decision);
      this.announced.emit(
        'Could not send your answer. The request is still waiting.',
      );
      this.region()?.nativeElement.focus();
    } finally {
      this.sending.set(false);
      this.activeDecision.set(null);
    }
  }

  protected retry(): void {
    const decision = this.failedDecision();
    if (decision) this.respond(decision);
  }

  protected close(): void {
    this.announced.emit('Closed.');
    this.closed.emit();
  }

  protected onEscape(event: Event): void {
    // The sheet's own Esc handler must not also close the inspector.
    event.stopPropagation();
    this.closed.emit();
  }

  /**
   * Send through today's handler after the compact card's stale re-check.
   * `false` when the request is no longer open (nothing was sent).
   */
  private send(request: InspectorRequest, decision: Decision): boolean {
    if (request.source === 'session') {
      const permission = this.permissionHandler
        .permissionRequests()
        .find((candidate) => candidate.id === request.requestId);
      if (!permission) return false;
      this.responder.respondSession(permission, decision, this.tabId());
      return true;
    }
    const agentId = request.agentId;
    if (!agentId) return false;
    const stillQueued =
      this.agentStore
        .agentsById()
        .get(agentId)
        ?.permissionQueue.some(
          (queued) => queued.requestId === request.requestId,
        ) ?? false;
    if (!stillQueued) return false;
    return this.responder.respondLane(
      agentId,
      request.requestId,
      decision,
      decision === 'deny' ? 'User denied' : undefined,
    );
  }
}

/**
 * The request lines of one owner (an AGENTS row or the Orchestrator card):
 * the OLDEST pending request first (FIFO), `+N more` for the rest, and at
 * most one open `Review` panel. `Answer` never re-implements the question
 * UI: it emits the request id for the host to route to the question card.
 * The host element carries the indentation.
 */
@Component({
  selector: 'ptah-inspector-request-lines',
  standalone: true,
  imports: [LucideAngularModule, InspectorRequestPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let list = requests();
    @if (list.length > 0) {
      <ul class="grid gap-1.5">
        @for (req of visible(); track req.requestId) {
          <li class="flex items-start gap-1.5 text-xs text-state-need">
            <lucide-angular [img]="ShieldIcon" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <p class="min-w-0 flex-1 leading-[1.45] [overflow-wrap:anywhere]">
              @if (req.kind === 'permission') {
                <span class="font-semibold">Needs permission:</span>
                <span class="font-mono text-[11px]"> {{ req.command }}</span>
              } @else {
                <span class="font-semibold">Asked you:</span>
                {{ req.questionPreview ?? req.command }}
              }
            </p>
            <button
              type="button"
              data-request-button
              class="inline-flex h-7 min-w-[56px] shrink-0 items-center justify-center self-start rounded-md border border-[color-mix(in_srgb,var(--state-ink-need)_55%,transparent)] px-2.5 text-[11px] font-medium text-state-need focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              [attr.aria-expanded]="req.kind === 'permission' ? openRequest()?.requestId === req.requestId : null"
              [attr.aria-label]="buttonLabel(req)"
              (click)="activate(req)"
            >
              {{ req.kind === 'permission' ? 'Review' : 'Answer' }}
            </button>
          </li>
          @if (req.kind === 'question' && answerMissed(req.requestId)) {
            <li>
              <div role="alert" class="flex items-center gap-1.5 pl-[18px] text-xs text-state-err">
                <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1">Could not find this question in the chat</span>
                <button
                  type="button"
                  class="inline-flex h-6 min-w-[42px] items-center justify-center px-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  [attr.aria-label]="'Retry answering question from ' + req.ownerName"
                  (click)="retryAnswer(req)"
                >
                  Retry
                </button>
              </div>
            </li>
          }
        }
      </ul>
      @if (list.length > 1) {
        <button
          type="button"
          class="mt-1 inline-flex h-6 min-w-6 items-center px-1.5 text-[11px] font-medium text-state-need underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [attr.aria-expanded]="expanded()"
          [attr.aria-label]="'Show ' + (list.length - 1) + ' more requests from ' + ownerName()"
          (click)="expanded.set(!expanded())"
        >
          +{{ list.length - 1 }} more
        </button>
      }
    }
    @if (openRequest(); as open) {
      <ptah-inspector-request-panel
        [request]="open"
        [pending]="isPending(open.requestId)"
        [tabId]="tabId()"
        [hasLaneSurface]="hasLaneSurface()"
        [ownerKindLabel]="ownerKindLabel()"
        (closed)="closePanel()"
        (answered)="closePanel()"
        (laneRequested)="laneRequested.emit($event)"
        (announced)="announced.emit($event)"
      />
    }
  `,
})
export class InspectorRequestLinesComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly store = inject(SessionInspectorStore);

  /** The owner's open requests, FIFO. */
  readonly requests = input.required<readonly InspectorRequest[]>();
  readonly ownerName = input.required<string>();
  readonly ownerKindLabel = input<string>('');
  readonly tabId = input.required<string>();
  readonly hasLaneSurface = input<boolean>(false);

  readonly answerRequested = output<string>();
  readonly laneRequested = output<string>();
  readonly announced = output<string>();
  /** The panel closed and no request button is left to take focus. */
  readonly focusReleased = output<void>();

  protected readonly ShieldIcon = ShieldAlert;
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly expanded = signal(false);
  protected readonly openRequest = signal<InspectorRequest | null>(null);

  protected readonly visible = computed(() => {
    const list = this.requests();
    return this.expanded() ? list : list.slice(0, 1);
  });

  protected isPending(requestId: string): boolean {
    return this.requests().some((req) => req.requestId === requestId);
  }

  protected buttonLabel(req: InspectorRequest): string {
    return req.kind === 'permission'
      ? `Review permission request from ${req.ownerName}: ${req.command}`
      : `Answer question from ${req.ownerName}: ${req.questionPreview ?? req.command}`;
  }

  /** The host reported that it found no question card for `requestId`. */
  protected answerMissed(requestId: string): boolean {
    return this.store.answerMissed(requestId);
  }

  /** Clear the miss and route the answer to the host again. */
  protected retryAnswer(req: InspectorRequest): void {
    this.store.clearAnswerMiss(req.requestId);
    this.answerRequested.emit(req.requestId);
  }

  protected activate(req: InspectorRequest): void {
    if (req.kind === 'question') {
      this.store.clearAnswerMiss(req.requestId);
      this.answerRequested.emit(req.requestId);
      return;
    }
    this.openRequest.set(
      this.openRequest()?.requestId === req.requestId ? null : req,
    );
  }

  /** Close the panel; focus the next request button, else release focus. */
  protected closePanel(): void {
    this.openRequest.set(null);
    afterNextRender(
      () => {
        const next = this.host.nativeElement.querySelector<HTMLElement>(
          '[data-request-button]',
        );
        if (next) next.focus();
        else this.focusReleased.emit();
      },
      { injector: this.injector },
    );
  }
}
