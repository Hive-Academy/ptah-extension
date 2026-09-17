import {
  afterNextRender,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  OnChanges,
  signal,
} from '@angular/core';

const MESSAGE_SLOT_SELECTOR = '[data-ptah-transcript-message-id]';
const EMPTY_MESSAGE_IDS: ReadonlySet<string> = new Set();

interface AnchorSnapshot {
  readonly messageId: string;
  readonly offset: number;
}

interface TranscriptMessageIdentity {
  readonly id: string;
}

/**
 * Preserves the first visible message when an older-history page is inserted
 * at the exact top boundary, where Chromium does not select a native scroll
 * anchor. Every other scroll position remains owned by native anchoring.
 *
 * The directive sits on the scroll container. Its input change runs before
 * Angular reconciles the descendant `@for`, so it can measure the old DOM;
 * `afterNextRender` then measures the same persistent message slot and performs
 * the single compensating `scrollTop` write.
 */
@Directive({
  selector: '[ptahTranscriptPrependAnchor]',
  exportAs: 'ptahTranscriptPrependAnchor',
})
export class TranscriptPrependAnchorDirective implements OnChanges {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly messages = input.required<readonly TranscriptMessageIdentity[]>({
    alias: 'ptahTranscriptPrependAnchor',
  });
  readonly tabId = input.required<string>();
  readonly sessionId = input<string | null>(null);
  readonly active = input.required<boolean>();
  readonly historyReplaying = input.required<boolean>();
  readonly pinnedToBottom = input.required<boolean>();

  private previousMessages: readonly TranscriptMessageIdentity[] = [];
  private previousTabId: string | null = null;
  private previousSessionId: string | null = null;
  private wasActive = false;
  private revision = 0;
  private readonly forcedMounts = signal(EMPTY_MESSAGE_IDS);

  /** Keeps the current prepended page real-sized through the anchor write. */
  isForcedMounted(messageId: string): boolean {
    return this.forcedMounts().has(messageId);
  }

  ngOnChanges(): void {
    // Not an effect: this must read the old DOM before Angular reconciles the
    // descendant @for; signal effects run after that pre-order lifecycle point.
    const messages = this.messages();
    const tabId = this.tabId();
    const sessionId = this.sessionId();
    const active = this.active();
    const revision = ++this.revision;
    this.forcedMounts.set(EMPTY_MESSAGE_IDS);

    const isPrepend =
      this.wasActive &&
      active &&
      tabId === this.previousTabId &&
      sessionId === this.previousSessionId &&
      isStrictHeadPrepend(this.previousMessages, messages);

    if (
      isPrepend &&
      !this.historyReplaying() &&
      !this.pinnedToBottom() &&
      this.host.nativeElement.scrollTop === 0
    ) {
      const anchor = this.findFirstVisibleSlot();
      if (anchor) {
        const prependedCount = messages.length - this.previousMessages.length;
        this.forcedMounts.set(
          new Set(
            messages.slice(0, prependedCount).map((message) => message.id),
          ),
        );
        this.restoreAfterRender(anchor, revision);
      }
    }

    this.previousMessages = messages;
    this.previousTabId = tabId;
    this.previousSessionId = sessionId;
    this.wasActive = active;
  }

  private findFirstVisibleSlot(): AnchorSnapshot | null {
    const root = this.host.nativeElement;
    const rootRect = root.getBoundingClientRect();
    // Slots are in transcript order: measure only offscreen-above slots plus
    // the first viewport candidate, never the entire tail of a long history.
    for (const slot of Array.from(
      root.querySelectorAll<HTMLElement>(MESSAGE_SLOT_SELECTOR),
    )) {
      const rect = slot.getBoundingClientRect();
      if (rect.top >= rootRect.bottom) return null;
      if (rect.bottom > rootRect.top && rect.top < rootRect.bottom) {
        const messageId = slot.dataset['ptahTranscriptMessageId'];
        if (messageId) {
          return { messageId, offset: rect.top - rootRect.top };
        }
      }
    }
    return null;
  }

  private restoreAfterRender(anchor: AnchorSnapshot, revision: number): void {
    afterNextRender(
      () => {
        if (revision !== this.revision) return;
        this.restoreAnchor(anchor);
        this.forcedMounts.set(EMPTY_MESSAGE_IDS);
      },
      { injector: this.injector },
    );
  }

  private restoreAnchor(anchor: AnchorSnapshot): void {
    const root = this.host.nativeElement;
    const rootTop = root.getBoundingClientRect().top;
    const slot = Array.from(
      root.querySelectorAll<HTMLElement>(MESSAGE_SLOT_SELECTOR),
    ).find(
      (candidate) =>
        candidate.dataset['ptahTranscriptMessageId'] === anchor.messageId,
    );
    if (!slot) return;

    const nextOffset = slot.getBoundingClientRect().top - rootTop;
    const delta = nextOffset - anchor.offset;
    if (delta <= 0 || delta > root.scrollHeight) return;
    root.scrollTop = root.scrollTop + delta;
  }
}

function isStrictHeadPrepend(
  previous: readonly TranscriptMessageIdentity[],
  next: readonly TranscriptMessageIdentity[],
): boolean {
  if (previous.length === 0 || next.length <= previous.length) return false;
  const suffixStart = next.length - previous.length;
  for (let index = 0; index < previous.length; index++) {
    if (next[suffixStart + index].id !== previous[index].id) return false;
  }
  return true;
}
