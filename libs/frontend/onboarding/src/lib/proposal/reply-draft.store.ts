import { computed, inject, Injectable, signal, type OnDestroy } from '@angular/core';
import { ComposerAttachmentsService } from '@ptah-extension/chat';
import { ProposalFlowStore } from './proposal-flow.store';

/** Page-scoped ephemeral reply shared by the log composer and the narrow-screen sheet. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped, provided by ProposalWorkspacePage; see the class note.
@Injectable()
export class ReplyDraftStore implements OnDestroy {
  private readonly flow = inject(ProposalFlowStore);
  readonly attachments = inject(ComposerAttachmentsService);
  readonly reply = signal('');
  readonly sending = signal(false);
  readonly announcement = signal('');
  readonly canSend = computed(
    () => !!this.reply().trim() && !this.sending() && this.attachments.pendingReads() === 0,
  );
  private destroyed = false;

  setReply(text: string): void {
    this.reply.set(text);
  }

  async send(): Promise<boolean> {
    if (this.destroyed || !this.canSend()) return false;
    const text = this.reply().trim();
    this.sending.set(true);
    try {
      this.announcement.set('');
      const snapshot = this.attachments.snapshotForSend();
      const sent = await this.flow.session.send(text, snapshot.options);
      if (this.destroyed) return false;
      if (sent) {
        snapshot.removeSent();
        if (this.reply().trim() === text) this.reply.set('');
        this.announcement.set('Reply sent');
        return true;
      }
      this.announcement.set('Reply could not be sent. Try again.');
      return false;
    } catch {
      if (!this.destroyed) this.announcement.set('Reply could not be sent. Try again.');
      return false;
    } finally {
      this.sending.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}
