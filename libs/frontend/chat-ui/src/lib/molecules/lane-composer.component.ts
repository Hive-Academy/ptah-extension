import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ChevronDown, LucideAngularModule, Pencil } from 'lucide-angular';
import { AgentDeliveryStore, AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { AgentDeliveryReceipt } from '@ptah-extension/shared';

/** One delivery contract for a lane, shown at full or compact width. */
@Component({
  selector: 'ptah-lane-composer',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="relative min-w-0 space-y-1.5" (keydown.escape)="closeOverlays()">
      <label class="sr-only" [for]="fieldId()">Message {{ laneLabel() }}</label>
      <div class="flex min-w-0 items-start gap-2" [class.flex-col]="variant() === 'full'">
      @if (variant() === 'full') {
        <textarea [id]="fieldId()" rows="2" class="textarea textarea-bordered w-full text-sm"
          [value]="draft()" [readonly]="confirmLoss()" [placeholder]="'Message ' + laneLabel() + '…'" (focus)="refreshPreviews()"
          (input)="setDraft($event)" (keydown.enter)="onEnter($event)"
          (keydown.control.enter)="onEnter($event)" (keydown.meta.enter)="onEnter($event)"></textarea>
      } @else {
        <input [id]="fieldId()" type="text" class="input input-bordered input-sm min-w-0 flex-1 text-sm"
          [value]="draft()" [readonly]="confirmLoss()" [placeholder]="'Message ' + laneLabel() + '…'" (focus)="refreshPreviews()"
          (input)="setDraft($event)" (keydown.enter)="onEnter($event)"
          (keydown.control.enter)="onEnter($event)" (keydown.meta.enter)="onEnter($event)" />
      }

      <div class="flex items-center gap-2 self-end">
      <ng-content select="[laneControls]" />
      @if (stopped()) {
        <button type="button" class="btn btn-primary btn-sm shrink-0" [disabled]="queueDisabled()"
          (click)="send('queue')">Resume with message</button>
      } @else {
        <div class="relative inline-flex shrink-0">
          <button type="button" class="btn btn-primary btn-sm rounded-r-none" [disabled]="queueDisabled()"
            [title]="state().queueDisabledReason ?? ''" (click)="send('queue')">Send</button>
          <button type="button" class="btn btn-primary btn-sm rounded-l-none border-l border-primary-content/20 px-2"
            [attr.aria-expanded]="menuOpen()" aria-label="Send options"
            (click)="menuOpen.set(!menuOpen()); refreshPreviews()">
            <lucide-angular [img]="ChevronIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          @if (menuOpen()) {
            <div class="absolute bottom-full left-0 z-20 mb-1 min-w-40 rounded-box border border-base-content/20 bg-base-100 p-1 shadow-lg">
              <button #sendNowButton type="button" class="btn btn-ghost btn-sm w-full justify-start"
                [disabled]="nowDisabled()" [title]="state().nowDisabledReason ?? ''"
                (click)="requestNow()">Send now</button>
            </div>
          }
        </div>
      }
      </div>
      </div>
      <p class="min-h-4 text-xs text-base-content-muted" aria-live="polite">{{ hint() }}</p>
      @if (error(); as message) { <p class="min-h-4 text-xs text-error" role="alert">{{ message }}</p> }
      @if (!state().queue || !state().now) { <button type="button" class="btn btn-ghost btn-xs" (click)="refreshPreviews()">Retry message options</button> }

      @if (confirmLoss()) {
        <div role="alertdialog" aria-modal="true" aria-label="Confirm Send now" class="absolute bottom-full left-0 z-30 rounded-box border border-warning bg-base-100 p-2 text-sm shadow-lg" (keydown.tab)="trapDialog($event)">
          <p class="text-warning">{{ state().now?.lossDisclosure?.text ?? 'Partial work in this turn will be discarded.' }}</p>
          <div class="mt-2 flex gap-2">
            <button #confirmButton type="button" class="btn btn-warning btn-sm" (click)="confirmNow()">Send now</button>
            <button #cancelButton type="button" class="btn btn-ghost btn-sm" (click)="closeOverlays()">Keep current turn</button>
          </div>
        </div>
      }

      @if (queuedReceipts().length > 0) {
        <div class="border-t border-base-content/20 pt-1 text-xs text-base-content-muted" aria-live="polite">
          {{ queuedReceipts().length }} queued · last: {{ lastReceiptLabel() }}
          @for (receipt of queuedReceipts(); track receipt.id) {
            <button type="button" class="btn btn-ghost btn-xs ml-1" [disabled]="sending()"
              [attr.aria-label]="'Edit queued message: ' + (receipt.preview ?? '').slice(0, 40)" (click)="cancel(receipt.id)">
              <lucide-angular [img]="EditIcon" class="h-3 w-3" aria-hidden="true" /> Edit
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class LaneComposerComponent {
  private readonly monitor = inject(AgentMonitorStore);
  private readonly store = inject(AgentDeliveryStore);
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly sendNowButton = viewChild<ElementRef<HTMLButtonElement>>('sendNowButton');
  private readonly returnFocus = signal(false);
  /** Shared across composer mounts so a tab switch does not discard accepted text. */
  private static readonly acceptedText = new Map<string, { agentId: string; text: string }>();
  private readonly cancelling = new Set<string>();
  /** The last submission that did not reach the backend; a retry of the same text reuses its key. */
  private submission: { readonly agentId: string; readonly text: string; readonly delivery: 'queue' | 'now'; readonly key: string } | null = null;
  private static nextId = 0;
  readonly agentId = input.required<string>();
  readonly laneLabel = input('lane');
  readonly cli = input('CLI');
  readonly variant = input<'full' | 'compact'>('full');
  readonly stopped = input(false);
  readonly resumePath = input<string | null>(null);
  readonly accepted = output<void>();
  protected readonly fieldId = signal(`lane-message-${++LaneComposerComponent.nextId}`);
  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly menuOpen = signal(false);
  protected readonly confirmLoss = signal(false);
  protected readonly ChevronIcon = ChevronDown;
  protected readonly EditIcon = Pencil;
  protected readonly state = computed(() => this.store.composerState(this.agentId()));
  private readonly previewKey = computed(() => `${this.stopped()}:${this.monitor.agentsById().get(this.agentId())?.status ?? ''}:${this.state().queue?.mode ?? ''}:${this.state().now?.mode ?? ''}`);
  protected readonly queuedReceipts = computed(() =>
    (this.store.receipts().get(this.agentId()) ?? []).filter(receipt => receipt.state === 'accepted' && receipt.delivery === 'queue' && receipt.sender === 'user'),
  );
  protected readonly lastReceiptLabel = computed(() => {
    const receipts = this.store.receipts().get(this.agentId()) ?? [];
    return receipts.length ? this.store.receiptLabel(receipts[receipts.length - 1]) : '';
  });
  protected readonly queueDisabled = computed(() => this.sending() || !this.draft().trim() || !this.state().queue || !!this.state().queueDisabledReason);
  protected readonly nowDisabled = computed(() => this.sending() || !this.draft().trim() || !this.state().now || !!this.state().nowDisabledReason);
  protected readonly resumeDescription = computed(() => {
    const preview = this.state().queue;
    if (!preview) return 'Checking resume path…';
    if (!preview.usesResume) return 'Start fresh handoff';
    return this.resumePath() ?? 'Resume saved conversation';
  });
  protected readonly hint = computed(() => {
    if (this.stopped()) return `Resume with message: ${this.resumeDescription()}`;
    if (!this.state().queue || !this.state().now) return 'Checking message options…';
    const now = this.state().now;
    const nowText = now?.mode === 'steer' ? 'steers into the running turn'
      : now?.mode === 'interrupt-resume' ? 'interrupts and restarts the turn'
      : `not supported by ${this.cli()}${this.state().nowDisabledReason ? `: ${this.state().nowDisabledReason}` : ''}`;
    return `Send: queued for next turn · Send now: ${nowText}`;
  });

  constructor() {
    let previousPreviewKey: string | undefined;
    effect(() => {
      const agentId = this.agentId();
      this.draft.set('');
      this.error.set(null);
      this.sending.set(false);
      untracked(() => { this.menuOpen.set(false); this.confirmLoss.set(false); this.returnFocus.set(false); });
      void this.loadPreviews(agentId);
    });
    effect(() => {
      const status = this.previewKey();
      const id = this.agentId();
      if (previousPreviewKey === undefined) { previousPreviewKey = status; return; }
      if (previousPreviewKey === status) return;
      previousPreviewKey = status;
      untracked(() => void this.loadPreviews(id));
    });
    effect(() => {
      const receipts = this.store.receipts().get(this.agentId()) ?? [];
      untracked(() => {
        for (const receipt of receipts) this.processReceipt(receipt);
      });
    });
    effect(() => {
      // Text recovered from an undelivered message ("Recover text") lands in this draft.
      const agentId = this.agentId();
      if (!this.store.recovered().has(agentId)) return;
      untracked(() => {
        const text = this.store.takeRecovered(agentId);
        if (text) this.restore(text);
      });
    });
    effect(() => {
      const target = this.confirmLoss() ? this.confirmButton() : this.returnFocus() ? this.sendNowButton() : undefined;
      if (!target) { if (this.returnFocus() && !this.menuOpen()) untracked(() => this.returnFocus.set(false)); return; }
      target.nativeElement.focus();
      untracked(() => this.returnFocus.set(false));
    });
  }

  private processReceipt(receipt: AgentDeliveryReceipt): void {
    if (this.cancelling.has(receipt.id)) return;
    const pending = LaneComposerComponent.acceptedText.get(receipt.id);
    const text = pending?.agentId === this.agentId() ? pending.text : undefined;
    if (!text) return;
    if (receipt.state === 'failed' || receipt.state === 'expired' || receipt.state === 'interrupted-undelivered') {
      this.restore(text);
      const reason = receipt.reason === 'agent_stopped' ? 'The lane stopped before receiving this message.'
        : receipt.reason === 'host-restarted' ? 'The host restarted before delivery.'
        : receipt.state === 'expired' ? 'The queued message expired before delivery.'
        : receipt.state === 'interrupted-undelivered' ? 'Resume the lane to send it again.'
        : 'Message was not sent.';
      this.error.set(`${this.store.receiptStatus(receipt).label}: ${reason}`);
      LaneComposerComponent.acceptedText.delete(receipt.id);
    } else if (receipt.state === 'settled') LaneComposerComponent.acceptedText.delete(receipt.id);
  }

  protected refreshPreviews(): void { void this.loadPreviews(this.agentId()); }
  private restore(text: string): void { this.draft.update(draft => draft.trim() ? `${draft}\n${text}` : text); }

  private async loadPreviews(agentId: string): Promise<void> {
    try {
      await Promise.all([this.store.previewMessage(agentId, 'queue'), this.store.previewMessage(agentId, 'now')]);
    } catch {
      if (this.agentId() === agentId) this.error.set('Message options unavailable. Try again.');
    }
  }

  protected setDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    this.error.set(null);
  }

  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.isComposing || key.keyCode === 229) return;
    if (key.shiftKey && this.variant() === 'full') return;
    key.preventDefault();
    if (key.ctrlKey || key.metaKey) this.requestNow();
    else void this.send('queue');
  }

  protected requestNow(): void {
    this.menuOpen.set(false);
    if (this.stopped() || this.nowDisabled()) return;
    if (this.state().now?.lossDisclosure?.confirmationRequired) {
      this.confirmLoss.set(true);
    }
    else void this.send('now');
  }

  protected confirmNow(): void {
    this.confirmLoss.set(false);
    this.menuOpen.set(false);
    this.returnFocus.set(false);
    void this.send('now', true);
  }

  protected trapDialog(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const first = this.confirmButton()?.nativeElement;
    const last = this.cancelButton()?.nativeElement;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  protected closeOverlays(): void {
    if (this.confirmLoss()) { this.menuOpen.set(true); this.returnFocus.set(true); }
    else this.menuOpen.set(false);
    this.confirmLoss.set(false);
  }

  protected async send(delivery: 'queue' | 'now', allowPartialTurnLoss = false): Promise<void> {
    if (delivery === 'now' ? this.nowDisabled() : this.queueDisabled()) return;
    const agentId = this.agentId();
    const draftText = this.draft().trim();
    let text = draftText;
    let earlierQueuedId: string | null = null;
    this.sending.set(true);
    this.error.set(null);
    try {
      if (delivery === 'queue') {
        const queued = this.queuedReceipts()[0];
        if (queued) {
          const earlier = LaneComposerComponent.acceptedText.get(queued.id);
          if (earlier?.agentId === agentId) { earlierQueuedId = queued.id; text = `${earlier.text}\n${draftText}`; }
        }
      }
      const outcome = await this.store.sendMessage(agentId, text, delivery, allowPartialTurnLoss, this.submissionKey(agentId, text, delivery));
      this.submission = null;
      if (this.agentId() !== agentId) return;
      const limitHeld = outcome.receipt?.state === 'blocked-retryable' && outcome.receipt.reason === 'lane-at-limit';
      if ((outcome.mode === 'unsupported' && !limitHeld) || (outcome.receipt && !['accepted', 'started'].includes(outcome.receipt.state) && !limitHeld)) {
        this.error.set(outcome.detail ?? 'Could not send your message. Try again.');
        this.refreshPreviews();
        return;
      }
      if (!outcome.receipt) { this.error.set('No message receipt was returned. Try again.'); return; }
      if (outcome.receipt?.state === 'accepted' || outcome.receipt?.state === 'started' || limitHeld) {
        if (this.draft().trim() === draftText) this.draft.set('');
        if (outcome.receipt.state === 'accepted' || limitHeld) {
          const acceptedText = LaneComposerComponent.acceptedText;
          acceptedText.set(outcome.receipt.id, { agentId, text });
          let agentCount = [...acceptedText.values()].filter(item => item.agentId === agentId).length;
          for (const [id, pending] of acceptedText) {
            if (acceptedText.size <= 32 && agentCount <= 8) break;
            if (pending.agentId === agentId || acceptedText.size > 32) {
              acceptedText.delete(id);
              if (pending.agentId === agentId) agentCount--;
            }
          }
          const latest = this.store.receipt(agentId, outcome.receipt.id);
          if (latest) this.processReceipt(latest);
        }
        if (earlierQueuedId) {
          // The combined message already carries the earlier text, so the
          // earlier receipt must never restore it into the draft, even when
          // its cancel push arrives before this RPC resolves.
          LaneComposerComponent.acceptedText.delete(earlierQueuedId);
          this.cancelling.add(earlierQueuedId);
          try {
            const cancelled = await this.store.cancelMessage(agentId, earlierQueuedId);
            if (cancelled.reason !== 'cancelled-by-user') this.error.set('Earlier message already started; both messages may be delivered.');
          } catch {
            this.error.set('Could not cancel the earlier message; both messages may be delivered.');
          } finally {
            this.cancelling.delete(earlierQueuedId);
          }
        }
        this.accepted.emit();
      }
    } catch {
      if (this.agentId() === agentId) {
        this.error.set('Could not send your message. Try again.');
        this.refreshPreviews();
      }
    } finally {
      if (this.agentId() === agentId) this.sending.set(false);
    }
  }

  /** Reuse the key of an identical submission that failed in transit, so the backend can dedupe it. */
  private submissionKey(agentId: string, text: string, delivery: 'queue' | 'now'): string {
    const prior = this.submission;
    if (prior && prior.agentId === agentId && prior.text === text && prior.delivery === delivery) return prior.key;
    this.submission = { agentId, text, delivery, key: this.store.newIdempotencyKey() };
    return this.submission.key;
  }

  protected async cancel(messageId: string): Promise<void> {
    const agentId = this.agentId();
    this.sending.set(true);
    this.cancelling.add(messageId);
    try {
      // After a reload the text lives only in the backend: read it before the cancel drops it.
      const local = LaneComposerComponent.acceptedText.get(messageId);
      let text: string;
      if (local?.agentId === agentId) text = local.text;
      else {
        try {
          text = await this.store.recoverQueuedText(agentId, messageId);
        } catch {
          // The cancel would drop the only copy of the text, so Edit stops and
          // the queued message stays for a retry.
          this.error.set('Could not load the queued message to edit. Try again.');
          return;
        }
      }
      const receipt = await this.store.cancelMessage(agentId, messageId);
      if (receipt.reason === 'cancelled-by-user') {
        this.restore(text);
        LaneComposerComponent.acceptedText.delete(messageId);
      } else this.error.set('Message already started and could not be cancelled.');
    } catch {
      this.error.set('Could not cancel the queued message. Try again.');
    } finally {
      this.cancelling.delete(messageId);
      if (this.agentId() === agentId) this.sending.set(false);
    }
  }
}
