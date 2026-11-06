import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ChevronDown, LucideAngularModule, X } from 'lucide-angular';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';

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
          [value]="draft()" [disabled]="sending()" [placeholder]="'Message ' + laneLabel() + '…'"
          (input)="setDraft($event)" (keydown.enter)="onEnter($event)"
          (keydown.control.enter)="onEnter($event)" (keydown.meta.enter)="onEnter($event)"></textarea>
      } @else {
        <input [id]="fieldId()" type="text" class="input input-bordered input-sm min-w-0 flex-1 text-sm"
          [value]="draft()" [disabled]="sending()" [placeholder]="'Message ' + laneLabel() + '…'"
          (input)="setDraft($event)" (keydown.enter)="onEnter($event)"
          (keydown.control.enter)="onEnter($event)" (keydown.meta.enter)="onEnter($event)" />
      }

      @if (stopped()) {
        <button type="button" class="btn btn-primary btn-sm shrink-0" [disabled]="queueDisabled()"
          (click)="send('queue')">Resume with message</button>
      } @else {
        <div class="relative inline-flex shrink-0">
          <button type="button" class="btn btn-primary btn-sm rounded-r-none" [disabled]="queueDisabled()"
            [title]="state().queueDisabledReason ?? ''" (click)="send('queue')">Send</button>
          <button type="button" class="btn btn-primary btn-sm rounded-l-none border-l border-primary-content/20 px-2"
            [attr.aria-expanded]="menuOpen()" aria-label="Send options" aria-haspopup="menu"
            (click)="menuOpen.set(!menuOpen())">
            <lucide-angular [img]="ChevronIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          @if (menuOpen()) {
            <div role="menu" class="absolute bottom-full left-0 z-20 mb-1 min-w-40 rounded-box border border-base-content/20 bg-base-100 p-1 shadow-lg">
              <button type="button" role="menuitem" class="btn btn-ghost btn-sm w-full justify-start"
                [disabled]="nowDisabled()" [title]="state().nowDisabledReason ?? ''"
                (click)="requestNow()">Send now</button>
            </div>
          }
        </div>
      }
      </div>
      <p class="min-h-4 text-xs text-base-content/70" aria-live="polite">{{ hint() }}</p>
      @if (error(); as message) { <p class="min-h-4 text-xs text-error" role="alert">{{ message }}</p> }

      @if (confirmLoss()) {
        <div role="alertdialog" aria-label="Confirm Send now" class="absolute bottom-full left-0 z-30 rounded-box border border-warning bg-base-100 p-2 text-sm shadow-lg">
          <p class="text-warning">Partial work in this turn will be discarded.</p>
          <div class="mt-2 flex gap-2">
            <button type="button" class="btn btn-warning btn-sm" (click)="confirmNow()">Send now</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="closeOverlays()">Keep current turn</button>
          </div>
        </div>
      }

      @if (queuedReceipts().length > 0) {
        <div class="border-t border-base-content/20 pt-1 text-xs text-base-content/70" aria-live="polite">
          {{ queuedReceipts().length }} queued · last: {{ lastReceiptLabel() }}
          @for (receipt of queuedReceipts(); track receipt.id) {
            <button type="button" class="btn btn-ghost btn-xs ml-1" [disabled]="sending()"
              [attr.aria-label]="'Cancel queued message ' + receipt.id" (click)="cancel(receipt.id)">
              <lucide-angular [img]="CancelIcon" class="h-3 w-3" aria-hidden="true" /> Cancel
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class LaneComposerComponent {
  private readonly store = inject(AgentMonitorStore);
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
  protected readonly CancelIcon = X;
  protected readonly state = computed(() => this.store.composerState(this.agentId()));
  protected readonly queuedReceipts = computed(() =>
    (this.store.receipts().get(this.agentId()) ?? []).filter(receipt => receipt.state === 'accepted' && receipt.delivery === 'queue'),
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
    if (this.stopped()) return `Resume with message will ${this.resumeDescription().toLowerCase()}`;
    if (!this.state().queue || !this.state().now) return 'Checking message options…';
    const now = this.state().now;
    const nowText = now?.mode === 'steer' ? 'steers into the running turn'
      : now?.mode === 'interrupt-resume' ? 'interrupts and restarts the turn'
      : `not supported by ${this.cli()}`;
    return `Send: queued for next turn · Send now: ${nowText}`;
  });

  constructor() {
    effect(() => {
      const agentId = this.agentId();
      this.draft.set('');
      this.error.set(null);
      this.closeOverlays();
      void this.loadPreviews(agentId);
    });
  }

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
    if (key.shiftKey && this.variant() === 'full') return;
    key.preventDefault();
    if (key.ctrlKey || key.metaKey) this.requestNow();
    else void this.send('queue');
  }

  protected requestNow(): void {
    this.menuOpen.set(false);
    if (this.stopped() || this.nowDisabled()) return;
    if (this.state().now?.lossDisclosure?.confirmationRequired) this.confirmLoss.set(true);
    else void this.send('now');
  }

  protected confirmNow(): void {
    this.confirmLoss.set(false);
    void this.send('now', true);
  }

  protected closeOverlays(): void {
    this.menuOpen.set(false);
    this.confirmLoss.set(false);
  }

  protected async send(delivery: 'queue' | 'now', allowPartialTurnLoss = false): Promise<void> {
    if (delivery === 'now' ? this.nowDisabled() : this.queueDisabled()) return;
    const agentId = this.agentId();
    const text = this.draft().trim();
    this.sending.set(true);
    this.error.set(null);
    try {
      const outcome = await this.store.sendMessage(agentId, text, delivery, allowPartialTurnLoss);
      if (this.agentId() !== agentId) return;
      if (outcome.mode === 'unsupported' || (outcome.receipt && !['accepted', 'started'].includes(outcome.receipt.state))) {
        this.error.set(outcome.detail ?? 'Could not send your message. Try again.');
        return;
      }
      if (outcome.receipt?.state === 'accepted' || outcome.receipt?.state === 'started') {
        if (this.draft().trim() === text) this.draft.set('');
        this.accepted.emit();
      }
    } catch {
      if (this.agentId() === agentId) this.error.set('Could not send your message. Try again.');
    } finally {
      if (this.agentId() === agentId) this.sending.set(false);
    }
  }

  protected async cancel(messageId: string): Promise<void> {
    const agentId = this.agentId();
    this.sending.set(true);
    try {
      await this.store.cancelMessage(agentId, messageId);
    } catch {
      this.error.set('Could not cancel the queued message. Try again.');
    } finally {
      if (this.agentId() === agentId) this.sending.set(false);
    }
  }
}
