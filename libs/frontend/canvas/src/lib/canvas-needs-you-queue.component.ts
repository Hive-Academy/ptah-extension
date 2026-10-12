import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  AgentPermissionResponder,
  TabManagerService,
} from '@ptah-extension/chat';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { CanvasStore } from './canvas.store';
import {
  buildNeedsYouItems,
  type NeedsYouItem,
} from './canvas-needs-you-queue';

@Component({
  selector: 'ptah-canvas-needs-you-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativePopoverComponent],
  template: `
    <ptah-native-popover
      [isOpen]="open()"
      placement="bottom-end"
      [hasBackdrop]="true"
      backdropClass="transparent"
      (closed)="open.set(false)"
    >
      <button
        trigger
        type="button"
        class="btn btn-xs gap-1 border border-base-300"
        [class.btn-warning]="items().length > 0"
        [class.btn-ghost]="items().length === 0"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        (click)="open.set(!open())"
      >
        {{ items().length ? items().length + ' need you' : 'All clear' }}
      </button>
      <div
        content
        class="w-80 max-w-[90vw] max-h-96 overflow-y-auto"
        role="dialog"
        aria-label="Requests that need you"
      >
        @if (items().length === 0) {
          <p class="p-3 text-sm text-base-content/70">No session needs you.</p>
        } @else {
          <ul
            aria-label="Requests that need you"
            class="divide-y divide-base-300"
          >
            @for (item of items(); track item.key) {
              <li class="p-2 space-y-1.5">
                <div class="font-semibold text-sm truncate">
                  {{ item.sessionLabel }}
                </div>
                <div class="text-xs text-base-content/70">
                  {{ item.requester }}
                </div>
                <p class="text-sm break-words">{{ item.summary }}</p>
                <div class="flex gap-1">
                  @if (item.kind !== 'question') {
                    <button
                      type="button"
                      class="btn btn-xs btn-success"
                      [disabled]="answering().has(item.key)"
                      [attr.aria-label]="
                        'Allow ' + item.requester + ' in ' + item.sessionLabel
                      "
                      (click)="answer(item, 'allow')"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-error"
                      [disabled]="answering().has(item.key)"
                      [attr.aria-label]="
                        'Deny ' + item.requester + ' in ' + item.sessionLabel
                      "
                      (click)="answer(item, 'deny')"
                    >
                      Deny
                    </button>
                  }
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    (click)="openSession(item)"
                  >
                    Open session
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </ptah-native-popover>
  `,
})
export class CanvasNeedsYouQueueComponent {
  private readonly permissions = inject(PermissionHandlerService);
  private readonly agents = inject(AgentMonitorStore);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly canvas = inject(CanvasStore);
  private readonly tabs = inject(TabManagerService);

  readonly open = signal(false);
  readonly answering = signal<ReadonlySet<string>>(new Set());
  readonly items = computed(() => {
    this.permissions.routingTargetRevision();
    const tiles = this.canvas.tiles().map((tile) => {
      const tab = this.tabs
        .tabs()
        .find((candidate) => candidate.id === tile.tabId);
      return {
        tabId: tile.tabId,
        sessionId: tab?.claudeSessionId ?? null,
        title: tab?.title ?? 'Session',
      };
    });
    const items = buildNeedsYouItems(
      this.permissions.permissionRequests(),
      this.permissions.questionRequests(),
      this.agents.pendingPermissions(),
      tiles,
      (id) => this.permissions.targetTabsFor(id),
      (id) => this.permissions.questionTargetTabsFor(id),
    );
    return items;
  });

  private readonly clearAnsweredItems = effect(() => {
    const active = new Set(this.items().map((item) => item.key));
    const pending = this.answering();
    if ([...pending].some((key) => !active.has(key))) {
      this.answering.set(
        new Set([...pending].filter((key) => active.has(key))),
      );
    }
  });

  answer(item: NeedsYouItem, decision: 'allow' | 'deny'): void {
    if (
      this.answering().has(item.key) ||
      !this.items().some((current) => current.key === item.key)
    )
      return;
    this.answering.update((keys) => new Set([...keys, item.key]));
    try {
      if (item.kind === 'lane-permission' && item.agentId) {
        const posted = this.responder.respondLane(
          item.agentId,
          item.requestId,
          decision,
          decision === 'deny' ? 'User denied' : undefined,
        );
        if (!posted) {
          this.answering.update((keys) => {
            const next = new Set(keys);
            next.delete(item.key);
            return next;
          });
        }
      } else if (item.kind === 'permission') {
        const request = this.permissions
          .permissionRequests()
          .find((candidate) => candidate.id === item.requestId);
        if (request)
          this.responder.respondSession(request, decision, item.tabId);
      }
    } catch (error) {
      this.answering.update((keys) => {
        const next = new Set(keys);
        next.delete(item.key);
        return next;
      });
      throw error;
    }
  }

  openSession(item: NeedsYouItem): void {
    this.open.set(false);
    this.canvas.focusTile(item.tabId);
  }
}
