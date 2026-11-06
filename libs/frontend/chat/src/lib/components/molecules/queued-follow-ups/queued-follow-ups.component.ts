import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { LucideAngularModule, Clock } from 'lucide-angular';
import {
  QueuedFollowUpStore,
  type QueuedFollowUpEntry,
} from '@ptah-extension/chat-state';
import { FollowUpQueueService } from '../../../services/chat-store/follow-up-queue.service';

const PREVIEW_LENGTH = 100;

/**
 * The follow-ups waiting for this composer's tab and session (TASK_2026_884):
 * a short text preview each, Withdraw (the text goes back to the composer to
 * edit), and — for a Codex session only — "Send now", which moves the item
 * into the running turn. Reconciles with the backend list when the session
 * view opens. Text is rendered through interpolation only.
 */
@Component({
  selector: 'ptah-queued-follow-ups',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (items().length > 0) {
      <section
        class="px-4 pb-2 border-t border-primary/20 bg-primary/5"
        data-glass-surface="plate"
        aria-label="Queued messages"
      >
        <ul class="flex flex-col gap-1 py-2">
          @for (item of items(); track item.clientMessageId) {
            <li class="flex items-start gap-2 text-xs" data-testid="queued-follow-up-item">
              <lucide-angular
                [img]="ClockIcon"
                class="w-3.5 h-3.5 mt-0.5 text-primary flex-shrink-0"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-base-content" [title]="item.content">
                  {{ preview(item.content) }}
                </p>
                <p class="text-base-content-muted">{{ statusLabel(item) }}</p>
                @if (item.note) {
                  <p class="text-warning" role="status">{{ item.note }}</p>
                }
              </div>
              @if (sendNowAvailable() && item.phase === 'queued') {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  data-testid="queued-follow-up-send-now"
                  [disabled]="pending().has(item.clientMessageId)"
                  [attr.aria-label]="(isClaude() ? 'Interrupt and send: ' : 'Send now: ') + preview(item.content)"
                  (click)="sendNow(item)"
                >
                  {{ isClaude() ? 'Interrupt & send' : 'Send now' }}
                </button>
              }
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-testid="queued-withdraw"
                title="Withdraw and put the text back in the composer"
                [disabled]="
                  item.phase === 'submitting' ||
                  pending().has(item.clientMessageId)
                "
                [attr.aria-label]="'Withdraw: ' + preview(item.content)"
                (click)="withdraw(item)"
              >
                Withdraw
              </button>
            </li>
          }
        </ul>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuedFollowUpsComponent {
  private readonly store = inject(QueuedFollowUpStore);
  private readonly followUps = inject(FollowUpQueueService);

  /** The tab this composer sends from. */
  readonly tabId = input<string | null>(null);
  /** The session the tab shows; items of an earlier session are not listed. */
  readonly sessionId = input<string | null>(null);

  readonly ClockIcon = Clock;

  /** Items with an action in flight, so a double click sends nothing twice. */
  protected readonly pending = signal<ReadonlySet<string>>(new Set());

  protected readonly items = computed<readonly QueuedFollowUpEntry[]>(() => {
    const tabId = this.tabId();
    return tabId ? this.store.forView(tabId, this.sessionId()) : [];
  });

  protected readonly sendNowAvailable = computed(() => {
    const tabId = this.tabId();
    return tabId !== null && this.followUps.canSendNow(tabId);
  });
  protected readonly isClaude = computed(() => {
    const tabId = this.tabId();
    return tabId !== null && this.followUps.isClaudeSession(tabId);
  });

  constructor() {
    effect(() => {
      const tabId = this.tabId();
      const sessionId = this.sessionId();
      if (!tabId || !sessionId) return;
      untracked(() => void this.followUps.reconcile(tabId, sessionId));
    });
  }

  protected preview(content: string): string {
    const flat = content.replace(/\s+/g, ' ').trim();
    return flat.length > PREVIEW_LENGTH
      ? `${flat.slice(0, PREVIEW_LENGTH)}…`
      : flat;
  }

  protected statusLabel(item: QueuedFollowUpEntry): string {
    switch (item.phase) {
      case 'held':
        return item.isCommand
          ? 'Runs when this turn finishes'
          : 'Waiting to queue';
      case 'submitting':
        return 'Queuing…';
      case 'queued':
        return 'Queued for the next turn';
    }
  }

  protected async withdraw(item: QueuedFollowUpEntry): Promise<void> {
    await this.track(item, () =>
      this.followUps.withdraw(item, { restore: true }),
    );
  }

  protected async sendNow(item: QueuedFollowUpEntry): Promise<void> {
    await this.track(item, () => this.followUps.sendNow(item));
  }

  private async track(
    item: QueuedFollowUpEntry,
    action: () => Promise<unknown>,
  ): Promise<void> {
    const id = item.clientMessageId;
    if (this.pending().has(id)) return;
    this.pending.update((current) => new Set(current).add(id));
    try {
      await action();
    } finally {
      this.pending.update((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }
}
