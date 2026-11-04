import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { AttachmentTrayComponent } from '@ptah-extension/chat';
import {
  COMPOSER_CARD_BORDER_CLASS,
  COMPOSER_CARD_CLASS,
  COMPOSER_SEND_BUTTON_CLASS,
  COMPOSER_TEXTAREA_CLASS,
  COMPOSER_TOOLBAR_CLASS,
} from '@ptah-extension/chat-ui';
import { ArrowUp, ImagePlus, LucideAngularModule, Paperclip } from 'lucide-angular';
import { ProposalFlowStore } from './proposal-flow.store';
import type { ProposalSessionStatus } from './proposal-session-status';
import { ReplyDraftStore } from './reply-draft.store';

@Component({
  selector: 'ptah-reply-composer',
  standalone: true,
  imports: [AttachmentTrayComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (flow.session.record()) {
      <div class="hidden min-[721px]:flex flex-col min-h-0 gap-2 border-t border-base-300 px-4 py-3"
           role="group" aria-label="Reply to the agent" data-testid="reply-composer">
        @if (status() === 'working' || status() === 'loading') {
          <p id="reply-working-hint" class="shrink-0 text-xs text-base-content-muted">
            You can write a reply while the agent works. It sends when you press Send.
          </p>
        }
        <div [class]="cardClass" class="min-h-0"
             data-glass-surface="tile"
             (dragover)="$event.preventDefault()" (drop)="draft.attachments.onDrop($event)">
          <label for="reply-composer-input" class="sr-only">Reply to the agent</label>
          <textarea #replyInput id="reply-composer-input"
                    [class]="textareaClass" class="reply-textarea shrink-0"
                    style="field-sizing: content"
                    placeholder="Ask for a change, answer a question, or paste a file."
                    [attr.aria-describedby]="(status() === 'working' || status() === 'loading' ? 'reply-working-hint ' : '') + 'reply-attachment-hint'"
                    [value]="draft.reply()" (input)="onInput($event)"
                    (paste)="draft.attachments.onPaste($event)"
                    (keydown.enter)="onEnter($event)"></textarea>
          <div class="min-h-0 shrink overflow-y-auto px-2.5 pb-1" data-testid="reply-tray">
            <ptah-attachment-tray [showPickButtons]="false" />
          </div>
          <div [class]="toolbarClass" class="shrink-0">
            <button type="button" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base-content-muted hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                    aria-label="Attach files" title="Attach files"
                    (click)="draft.attachments.pickFiles()">
              <lucide-angular [img]="PaperclipIcon" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base-content-muted hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                    aria-label="Attach images" title="Attach images"
                    (click)="draft.attachments.pickImages()">
              <lucide-angular [img]="ImagePlusIcon" class="h-4 w-4" aria-hidden="true" />
            </button>
            <span id="reply-attachment-hint" class="min-w-0 flex-1 text-xs text-base-content-muted">
              Attachments are not saved if you leave this page
            </span>
            <button type="button" [class]="sendClass"
                    class="motion-reduce:enabled:hover:scale-100 motion-reduce:enabled:active:scale-100 motion-reduce:transition-none"
                    aria-label="Send reply" title="Send reply" [disabled]="!draft.canSend()"
                    (click)="submit()">
              @if (draft.sending()) {
                <span class="loading loading-spinner loading-xs motion-reduce:animate-none" aria-hidden="true"></span>
              } @else {
                <lucide-angular [img]="ArrowUpIcon" class="h-4 w-4" aria-hidden="true" />
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @container session-log (max-height: 499.98px) {
      .reply-textarea { max-height: calc(3lh + 1rem); }
    }
  `],
})
export class ReplyComposerComponent {
  readonly status = input.required<ProposalSessionStatus>();
  readonly draft = inject(ReplyDraftStore);
  readonly flow = inject(ProposalFlowStore);
  protected readonly cardClass = `${COMPOSER_CARD_CLASS} ${COMPOSER_CARD_BORDER_CLASS}`;
  protected readonly textareaClass = COMPOSER_TEXTAREA_CLASS;
  protected readonly toolbarClass = COMPOSER_TOOLBAR_CLASS;
  protected readonly sendClass = COMPOSER_SEND_BUTTON_CLASS;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly PaperclipIcon = Paperclip;
  protected readonly ImagePlusIcon = ImagePlus;
  private readonly replyInput = viewChild<ElementRef<HTMLTextAreaElement>>('replyInput');

  focus(): void {
    this.replyInput()?.nativeElement.focus({ preventScroll: true });
  }

  onInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.draft.setReply(target.value);
  }

  onEnter(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.isComposing || event.shiftKey) return;
    event.preventDefault();
    if (this.draft.canSend()) void this.submit();
  }

  async submit(): Promise<void> {
    if (await this.draft.send()) this.focus();
  }
}
