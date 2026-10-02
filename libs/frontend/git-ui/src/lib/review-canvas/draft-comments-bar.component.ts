import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  ReviewCommentDraftStore,
  reviewDraftOwnerKey,
  type ReviewCommentDraft,
  type ReviewDraftOwner,
} from '../services/review-comment-draft.store';

/** A message scoped to the owner it was produced for. */
interface OwnerMessage {
  readonly key: string;
  readonly text: string;
}

/**
 * DraftCommentsBarComponent — the review canvas footer (design-spec §6.1,
 * §6.3; Requirement 6.7): "✎ N draft comments", a popover listing the drafts
 * (each removable), and the one primary action "Send to agent".
 *
 * Sending goes through `ReviewCommentDraftStore.send`, which delivers one
 * message through `AGENT_FEEDBACK_SENDER` and clears the drafts only on
 * `sent: true`. A failure keeps them and shows the sender's sentence here.
 *
 * The bar is absent at zero drafts. The live region sits outside it so the
 * "sent" announcement survives the bar disappearing.
 */
@Component({
  selector: 'ptah-draft-comments-bar',
  standalone: true,
  imports: [NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (drafts().length > 0) {
      <div
        class="bg-base-200 border-t border-base-content/10 px-3 py-1.5 flex flex-wrap items-center justify-between gap-1 text-xs"
        data-testid="draft-comments-bar"
      >
        <ptah-native-popover
          [isOpen]="listOpen()"
          placement="top-start"
          [hasBackdrop]="true"
          backdropClass="transparent"
          (closed)="listOpen.set(false)"
        >
          <button
            trigger
            type="button"
            class="btn btn-ghost btn-xs"
            aria-haspopup="true"
            [attr.aria-expanded]="listOpen()"
            data-testid="draft-comments-toggle"
            (click)="listOpen.set(!listOpen())"
          >
            <span aria-hidden="true">✎</span> {{ countLabel() }}
          </button>
          <div content class="w-80 max-h-48 overflow-y-auto">
            <ul aria-label="Draft comments" data-testid="draft-comments-list">
              @for (draft of drafts(); track draft.id) {
                <li
                  class="flex items-center justify-between gap-2 px-2 py-1 text-[11px] border-b border-base-content/10 last:border-0"
                >
                  <span class="min-w-0 truncate" [attr.title]="describe(draft)">
                    <span class="font-mono">{{ location(draft) }}</span>
                    @if (draft.body.trim()) {
                      <span class="text-base-content-muted">
                        — {{ draft.body }}</span
                      >
                    }
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    [attr.aria-label]="'Remove draft comment on ' + location(draft)"
                    data-testid="draft-comment-remove"
                    (click)="remove(draft)"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </li>
              }
            </ul>
          </div>
        </ptah-native-popover>

        @if (error(); as message) {
          <span
            class="text-error min-w-0 flex-1 basis-full sm:basis-auto"
            role="alert"
            data-testid="draft-comments-error"
            >{{ message }}</span
          >
        }

        <button
          type="button"
          class="btn btn-primary btn-xs"
          [attr.aria-disabled]="sending() || null"
          [attr.aria-busy]="sending() || null"
          data-testid="draft-comments-send"
          (click)="send()"
        >
          {{ sending() ? 'Sending…' : 'Send to agent' }}
        </button>
      </div>
    }
    <span class="sr-only" role="status" data-testid="draft-comments-status">{{
      announcement()
    }}</span>
  `,
})
export class DraftCommentsBarComponent {
  private readonly store = inject(ReviewCommentDraftStore);

  /** Whose drafts this canvas shows and sends. */
  readonly owner = input.required<ReviewDraftOwner>();

  protected readonly listOpen = signal(false);
  private readonly lastError = signal<OwnerMessage | null>(null);
  private readonly lastAnnouncement = signal<OwnerMessage | null>(null);

  private readonly ownerKey = computed(() => reviewDraftOwnerKey(this.owner()));

  protected readonly drafts = computed(() =>
    this.store.draftsFor(this.owner()),
  );
  protected readonly sending = computed(() =>
    this.store.isSending(this.owner()),
  );

  protected readonly countLabel = computed(() => {
    const count = this.drafts().length;
    return count === 1 ? '1 draft comment' : `${count} draft comments`;
  });

  /** Messages belong to the owner they were produced for. */
  protected readonly error = computed(() => {
    const error = this.lastError();
    return error?.key === this.ownerKey() ? error.text : null;
  });
  protected readonly announcement = computed(() => {
    const note = this.lastAnnouncement();
    return note?.key === this.ownerKey() ? note.text : '';
  });

  protected location(draft: ReviewCommentDraft): string {
    return `${draft.path} L${draft.startLine}-L${draft.endLine}`;
  }

  protected describe(draft: ReviewCommentDraft): string {
    const body = draft.body.trim();
    return body ? `${this.location(draft)} — ${body}` : this.location(draft);
  }

  protected remove(draft: ReviewCommentDraft): void {
    this.store.remove(this.owner(), draft.id);
    if (this.drafts().length === 0) this.listOpen.set(false);
  }

  protected async send(): Promise<void> {
    if (this.sending()) return;
    const owner = this.owner();
    const key = reviewDraftOwnerKey(owner);
    const count = this.drafts().length;
    this.listOpen.set(false);
    this.lastError.set(null);
    this.lastAnnouncement.set(null);
    const result = await this.store.send(owner);
    if (result.sent) {
      this.lastAnnouncement.set({
        key,
        text:
          count === 1
            ? 'Sent 1 comment to the agent.'
            : `Sent ${count} comments to the agent.`,
      });
    } else {
      this.lastError.set({
        key,
        text: result.error ?? 'The comments could not be sent.',
      });
    }
  }
}
